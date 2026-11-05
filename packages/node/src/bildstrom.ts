/**
 * Bildstrom für Programme ohne Web (VKg2a2, Entscheidung VKg-W2 vom 18.10.2026, `docs/VIBECODEN-ENTWURF.md` VKg2): Der
 * Knoten zeigt das Programm eines Projekts auf einem virtuellen Bildschirm und schickt das Bild über WebRTC an die App – nur
 * über den eigenen TURN (B-13). Zwei Sandboxen, beide ohne Netz:
 * - **Bild:** `motor/freedom_bild.py` – Xvfb, GStreamer `webrtcbin`, Eingaben aus dem Datenkanal über XTest (VKg2a3). Den TURN
 *   erreicht sie nur über den Tunnel aus `turn-tunnel.ts` (nur die Relay-Adressen aus dem Angebot der App); den Zugang
 *   bekommt sie über stdin.
 * - **Programm:** der Code des Projekts, mit `/arbeit` wie beim Motor. Mit der Bild-Sandbox teilt es nur den Socket des
 *   Bildschirms – nie den Zugang zum TURN, nie den Tunnel, nie die Ausgabe, aus der der Knoten die Antwort an die App liest
 *   (eine untergeschobene Antwort ließe die App sonst einen fremden Rechner anrufen und trüge Daten in ICE-Feldern hinaus).
 *
 * Web-Projekte (VKg2c1) zeigt Chromium im Bild – mit dem Dev-Server wie in der Vorschau (VKg1c) oder `index.html`, beides in
 * der Sandbox des Programms. So geht auch eine Web-App unterwegs nur über den TURN, ohne Adresse des Knotens.
 *
 * Godot-Projekte (VKk3a) zeigt Godot selbst, ebenfalls in der Sandbox des Programms – erst importiert wie im Editor, dann das
 * Spiel, gerechnet in Software (`GODOT_START`, `godotArgumente()`). Windows-Programme (VKi1, `main.exe`) laufen dort in Wine
 * auf einer eigenen Arbeitsfläche (`wineBefehl()`).
 *
 * Kodiert wird nach dem Angebot der App (VKg2c2): mit der Nummer des Formats aus dem Angebot, H.264 über NVENC, wo der Knoten
 * es hat (nur die Bild-Sandbox bekommt dann die GPU), sonst VP8 in Software (`bildKodierer()`).
 *
 * Angebot und Antwort reisen nur versiegelt in der Code-Aktion `bild` (PROTOCOL.md §34), beide nur mit Relay-Kandidaten.
 * Je Projekt ein Bild, auf dem Knoten höchstens `BILD_GRENZEN.gesamt`; ein neues Angebot ersetzt das alte. Es endet mit der
 * Verbindung, mit dem Programm, mit `bild-ende` oder wenn der Zugang zum TURN abläuft. Ins Log nur Zahlen.
 */
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { istBildSdp } from "@freedomstack/protocol";
import { DEV_GRENZEN, DEV_PORT, devBefehl } from "./dev-server.js";
import { STARTSKRIPT } from "./hermes-motor.js";
import { browserLesbar } from "./mcp-katalog.js";
import { CodeAbgelehnt, type ProjektAblage } from "./projekte.js";
import { sandboxDienst } from "./sandbox.js";
import { type TurnDienst, turnZugang } from "./turn.js";
import { oeffneTurnTunnel, relayAdressen, type TurnZiel } from "./turn-tunnel.js";

export const BILD_GRENZEN = {
  /** Bilder auf dem Knoten zugleich. */
  gesamt: 2,
  /** So lange darf es dauern, bis die Antwort für die App steht. */
  startMs: 20_000,
  /** Die Antwort der Bild-Sandbox (eine Zeile JSON), in Byte. */
  antwortBytes: 64 * 1024,
} as const;

export const BILDSKRIPT = fileURLToPath(new URL("../motor/freedom_bild.py", import.meta.url));
/** In der Bild-Sandbox: der Ordner mit dem Socket des Tunnels und der Port, an dem `freedom_motor.py` ihn anbietet. */
export const BILD_IN_SANDBOX = { ordner: "/bild", sockel: "/bild/turn.sock", port: 3478, x11: "/tmp/.X11-unix" } as const;
const ANZEIGE = ":99";

/** Feste Sätze fürs Log – warum es kein Bild gibt. */
export const BILD_TEXT = {
  xvfb: "Xvfb fehlt (apt install xvfb)",
  gstreamer: "GStreamer mit webrtcbin, PyGObject oder python-xlib fehlen (apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-nice gir1.2-gst-plugins-bad-1.0 python3-gi python3-xlib)",
} as const;

const PRUEFUNG = "import gi; gi.require_version('Gst','1.0'); gi.require_version('GstWebRTC','1.0'); gi.require_version('GstSdp','1.0'); "
  + "from gi.repository import Gst, GstWebRTC, GstSdp; Gst.init(None); import Xlib.ext.xtest; "
  + "assert all(Gst.ElementFactory.find(e) for e in ('webrtcbin','nicesrc','ximagesrc','videoconvert','vp8enc','rtpvp8pay'))";

/** Kodierer der Bild-Sandbox – mit Namen fürs Log (nur diese, nie Text aus der Sandbox). */
export const KODIERER_NAME: Record<string, string> = { vp8enc: "VP8", nvh264enc: "H.264 über NVENC" };

/**
 * Kodierer aus der Umgebung: `BILD_KODIERER` leer oder `auto` – H.264 über NVENC, wo es ihn gibt, sonst VP8; `vp8` –
 * immer VP8 in Software. H.264 nur über NVENC und nur, wenn das Angebot der App es nennt – sonst VP8. null: ungültig.
 */
export function bildKodierer(env: { BILD_KODIERER?: string }, nvenc: boolean): "vp8" | "h264" | null {
  const wahl = env.BILD_KODIERER?.trim().toLowerCase();
  if (!wahl || wahl === "auto") return nvenc ? "h264" : "vp8";
  return wahl === "vp8" ? "vp8" : null;
}

/** Kann die Bild-Sandbox mit NVENC kodieren? GStreamer kennt `nvh264enc` (nvcodec meldet ihn nur mit einer GPU) und es gibt die Geräte. */
export async function nvencDa(python = "python3", geraet = "/dev/nvidiactl"): Promise<boolean> {
  if (!existsSync(geraet)) return false;
  const pruefung = "import gi; gi.require_version('Gst','1.0'); from gi.repository import Gst; Gst.init(None); assert Gst.ElementFactory.find('nvh264enc')";
  return new Promise<boolean>((r) => execFile(python, ["-c", pruefung], { timeout: 30_000 }, (e) => r(!e)));
}

/** Gibt es hier alles für das Bild? null, sonst ein Satz aus `BILD_TEXT`. Geprüft beim Start, außerhalb der Sandbox (dasselbe `/usr`). */
export async function bildFehlt(python = "python3"): Promise<string | null> {
  const geht = (befehl: string, args: string[]) => new Promise<boolean>((r) => execFile(befehl, args, { timeout: 15_000 }, (e) => r(!e)));
  if (!(await geht("Xvfb", ["-help"]))) return BILD_TEXT.xvfb;
  return (await geht(python, ["-c", PRUEFUNG])) ? null : BILD_TEXT.gstreamer;
}

/**
 * Chromium im Bild (VKg2c1): der ganze Bildschirm ohne Leisten, ohne eigene Sandbox (es läuft in unserer und dürfte darin
 * keine Namensräume anlegen), Profil nur im `/tmp` der Sandbox, ohne Dienste im Hintergrund. WebGL rechnet SwiftShader in
 * Software – Spiele im Browser laufen so auch ohne GPU; diesen Rechenweg trägt nur die Sandbox des Projekts.
 */
export function browserArgumente(groesse: { breite: number; hoehe: number }, adresse: string): string[] {
  return [
    "--no-sandbox", "--test-type", "--kiosk", `--window-size=${groesse.breite},${groesse.hoehe}`, "--window-position=0,0",
    "--user-data-dir=/tmp/chromium", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--password-store=basic",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--noerrdialogs",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", adresse,
  ];
}

/**
 * Web-Projekt mit Dev-Server: `npm run dev` wie in der Vorschau (VKg1c), Chromium (`$0`, Argumente `$@`), sobald er auf
 * `127.0.0.1:5173` antwortet – höchstens `DEV_GRENZEN.startMs`. Ohne Netz, alles in der Sandbox des Programms.
 */
export const WEB_DEV_START = [
  `/usr/bin/env PORT=${DEV_PORT} HOST=127.0.0.1 npm run dev >/dev/null 2>&1 &`,
  `python3 -c 'import socket, time`,
  `for _ in range(${DEV_GRENZEN.startMs / 100}):`,
  `    try:`,
  `        socket.create_connection(("127.0.0.1", ${DEV_PORT}), 1).close()`,
  `        break`,
  `    except OSError:`,
  `        time.sleep(0.1)`,
  `else:`,
  `    raise SystemExit(1)' || exit 1`,
  `exec "$0" "$@"`,
].join("\n");

/** Godot in der Sandbox des Programms (VKk3a): als einzelne Datei nur lesbar hier – nie sein Ordner. */
export const GODOT_IN_SANDBOX = "/freedom/godot";
/** Wo der Knoten Godot sucht – das Docker-Bild legt es mit `VIBECODEN=1` nach `/usr/local/bin` (`scripts/godot-holen.sh`). */
export const GODOT_ORTE: readonly string[] = ["/usr/local/bin/godot", "/usr/bin/godot"];

/** Godot aus der Umgebung: `GODOT` (absoluter Pfad einer Datei), sonst der erste aus `GODOT_ORTE`; null mit `aus`, einem Pfad, der nicht stimmt, oder ohne Fund. */
export function godotAusUmgebung(env: { GODOT?: string }, orte: readonly string[] = GODOT_ORTE): string | null {
  const istDatei = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const wahl = env.GODOT?.trim();
  if (wahl === "aus") return null;
  if (wahl) return isAbsolute(wahl) && normalize(wahl) === wahl && istDatei(wahl) ? wahl : null;
  return orte.find(istDatei) ?? null;
}

/**
 * Ein Godot-Projekt im Bild (VKk3a): erst importieren wie der Editor, ohne Bildschirm – sonst fehlen Texturen und Klänge;
 * dabei entsteht `.godot/` und Godot ergänzt `config/features` in `project.godot`, wie beim Öffnen im Editor. Dann das
 * Spiel, auch wenn der Import scheitert (die Fehler zeigt dann das Spiel). `$0` ist Godot, `$@` die Argumente für das Spiel.
 */
export const GODOT_START = `"$0" --headless --path /arbeit --import\nexec "$0" "$@"`;

/**
 * Das Spiel auf dem ganzen Bildschirm, über X11 (in der Sandbox gibt es kein Wayland). Gerechnet wird in Software – OpenGL
 * über Mesa (`gl_compatibility`); die GPU bekommt nur die Bild-Sandbox, nie das Programm. Ohne Ton – die Sandbox hat keinen.
 */
export function godotArgumente(groesse: { breite: number; hoehe: number }): string[] {
  return [
    "--path", "/arbeit", "--display-driver", "x11", "--rendering-method", "gl_compatibility", "--rendering-driver", "opengl3",
    "--audio-driver", "Dummy", "--resolution", `${groesse.breite}x${groesse.hoehe}`, "--position", "0,0",
  ];
}

/**
 * Wo der Knoten Wine sucht – nur Pakete der Distribution unter `/usr` (Wine sind viele Dateien, nie einen Ordner einbinden):
 * Debian und Ubuntu der Starter selbst, sonst `/usr/bin/wine`.
 */
export const WINE_ORTE: readonly string[] = ["/usr/lib/wine/wine64", "/usr/bin/wine"];

/** Der erste Ort, an dem eine Datei liegt – für Programme der Distribution (Wine, OpenSCAD); null ohne Fund. */
function ersteDatei(orte: readonly string[]): string | null {
  return orte.find((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

/** Wine aus der Distribution (VKi1): der erste aus `WINE_ORTE`; null mit `WINE=aus` oder ohne Fund. */
export function wineAusUmgebung(env: { WINE?: string }, orte: readonly string[] = WINE_ORTE): string | null {
  return env.WINE?.trim() === "aus" ? null : ersteDatei(orte);
}

/**
 * Ein Windows-Programm im Bild (VKi1): `main.exe` in Wine, auf einer eigenen Arbeitsfläche so groß wie das Bild – ohne
 * Fenstermanager hätten die Fenster sonst keine Rahmen. Das Präfix liegt im Home der Sandbox (tmpfs), entsteht bei jedem Start
 * neu (rund 10 s) und vergeht mit ihr; nie im Projekt. Ohne Mono und Gecko (Wine fragte sonst nach einem Download, die Sandbox
 * hat kein Netz) und ohne Verknüpfungen fürs Menü.
 */
export function wineBefehl(wine: string, groesse: { breite: number; hoehe: number }): string[] {
  return [
    "/usr/bin/env", "WINEPREFIX=/home/agent/.wine", "WINEDEBUG=-all", "WINEDLLOVERRIDES=mscoree,mshtml=;winemenubuilder.exe=d",
    wine, "explorer", `/desktop=freedom,${groesse.breite}x${groesse.hoehe}`, "Z:\\arbeit\\main.exe",
  ];
}

/**
 * Was Wine zusätzlich lesen darf (VKi2): auf ARM64 die Angaben zum Prozessor – ohne `/sys/devices/system/cpu` erkennen FEX und
 * box64 (Hangover) die Merkmale falsch, und das Programm endet mit einem unerlaubten Befehl (`c000001d`, gemessen auf
 * `ubuntu-24.04-arm`). Nur lesbar, nur für Wine; auf x86_64 nichts.
 */
export function wineLesbar(arch: string = process.arch): Array<{ quelle: string; ziel: string }> {
  return arch === "arm64" && existsSync("/sys/devices/system/cpu") ? [{ quelle: "/sys/devices/system/cpu", ziel: "/sys/devices/system/cpu" }] : [];
}

/** Wo der Knoten OpenSCAD sucht (VKk4a) – nur das Paket der Distribution unter `/usr` (mit Qt und CGAL viele Dateien). */
export const OPENSCAD_ORTE: readonly string[] = ["/usr/bin/openscad"];

/** OpenSCAD aus der Distribution (VKk4a): der erste aus `OPENSCAD_ORTE`; null mit `OPENSCAD=aus` oder ohne Fund. */
export function openscadAusUmgebung(env: { OPENSCAD?: string }, orte: readonly string[] = OPENSCAD_ORTE): string | null {
  return env.OPENSCAD?.trim() === "aus" ? null : ersteDatei(orte);
}

/**
 * Ein OpenSCAD-Modell im Bild (VKk4a): `main.scad` mit Editor, Vorschau und Konsole, das Fenster so groß wie das Bild, ohne
 * Customizer und Fehlerliste, mit „Automatic Reload and Preview“ – ändert der Agent die Datei, zeigt das Bild das neue Modell.
 * Die Vorschau rechnet Mesa in Software. Die Einstellungen stehen im Home der Sandbox (tmpfs) und vergehen mit ihr. `$0` ist
 * OpenSCAD, `$1` und `$2` die Größe.
 */
export const OPENSCAD_START = [
  `mkdir -p "$HOME/.config/OpenSCAD"`,
  `printf '%s\\n' '[design]' 'autoReload=true' '[view]' 'hideCustomizer=true' 'hideErrorLog=true' '[window]' "size=@Size($1 $2)" 'position=@Point(0 0)' > "$HOME/.config/OpenSCAD/OpenSCAD.conf"`,
  `exec "$0" /arbeit/main.scad`,
].join("\n");

export function openscadBefehl(openscad: string, groesse: { breite: number; hoehe: number }): string[] {
  return ["/bin/sh", "-c", OPENSCAD_START, openscad, String(groesse.breite), String(groesse.hoehe)];
}

/**
 * Neustart nach jeder Änderung (VKk4b, VKk4c, VKk4d, VKk4e) – für Programme, die eine geänderte Datei nicht selbst neu laden: startet `$0`
 * mit `$1` neu, sobald sich Zeit oder Größe der Datei geändert haben und sie eine Sekunde ruhig ist (der Agent schreibt
 * vielleicht in Stücken). Überhört das Programm das Ende (Rückfrage zum Speichern), endet es nach drei Sekunden hart. Endet es
 * von selbst, endet die Schleife. `vorStart` läuft vor jedem Start, `argumente` stehen vor der Datei (Text für die Shell).
 */
function neustartSchleife(vorStart?: string, argumente = ""): string[] {
  return [
    `datei="$1"`,
    `stand() { stat -c '%.9Y %s' "$datei" 2>/dev/null; }`,
    `while :; do`,
    ...(vorStart ? [`  ${vorStart}`] : []),
    `  alt=$(stand)`,
    `  "$0" ${argumente}"$datei" & pid=$!`,
    `  while kill -0 "$pid" 2>/dev/null && [ "$(stand)" = "$alt" ]; do sleep 1; done`,
    `  kill -0 "$pid" 2>/dev/null || exit 0`,
    `  neu=$(stand); sleep 1; while [ "$(stand)" != "$neu" ]; do neu=$(stand); sleep 1; done`,
    `  kill "$pid"; for i in 1 2 3; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done`,
    `  kill -9 "$pid" 2>/dev/null; wait "$pid"`,
    `done`,
  ];
}

/** Wo der Knoten KiCad sucht (VKk4b) – nur der Schaltplan-Editor der Distribution unter `/usr` (mit wxWidgets viele Dateien). */
export const KICAD_ORTE: readonly string[] = ["/usr/bin/eeschema"];

/** KiCad aus der Distribution (VKk4b): der erste aus `KICAD_ORTE`; null mit `KICAD=aus` oder ohne Fund. */
export function kicadAusUmgebung(env: { KICAD?: string }, orte: readonly string[] = KICAD_ORTE): string | null {
  return env.KICAD?.trim() === "aus" ? null : ersteDatei(orte);
}

/**
 * Ein Schaltplan im Bild (VKk4b): `main.kicad_sch` im Schaltplan-Editor von KiCad. Die Einstellungen legt das Skript im Home
 * der Sandbox an (tmpfs) – sonst fragt KiCad beim ersten Start, wie es sich einrichten soll –, mit den Bibliothekstabellen der
 * Distribution, wo es sie gibt, für jede Fassung von 6 bis 9. KiCad lädt eine geänderte Datei nicht von selbst: Das Skript
 * startet den Editor nach jeder Änderung neu (`neustartSchleife()`). Die Sperrdatei, die KiCad neben die Datei legt, löscht es
 * vor jedem Start – nach einem harten Ende bliebe sie liegen. `$0` ist eeschema, `$1` die Datei.
 */
export const KICAD_START = [
  `for v in 6.0 7.0 8.0 9.0; do`,
  `  d="$HOME/.config/kicad/$v"; mkdir -p "$d" && echo '{}' > "$d/kicad_common.json"`,
  `  for t in sym-lib-table fp-lib-table; do`,
  `    if [ -f "/usr/share/kicad/template/$t" ]; then cp "/usr/share/kicad/template/$t" "$d/$t"; else echo "(\${t%-table}_table (version 7))" | tr - _ > "$d/$t"; fi`,
  `  done`,
  `done`,
  ...neustartSchleife(`rm -f "\${1%/*}/~\${1##*/}.lck"`),
].join("\n");

export function kicadBefehl(eeschema: string): string[] {
  return ["/bin/sh", "-c", KICAD_START, eeschema, "/arbeit/main.kicad_sch"];
}

/** Wo der Knoten Blender sucht (VKk4c) – nur das Paket der Distribution unter `/usr` (mit Python und Bibliotheken viele Dateien). */
export const BLENDER_ORTE: readonly string[] = ["/usr/bin/blender"];

/** Blender aus der Distribution (VKk4c): der erste aus `BLENDER_ORTE`; null mit `BLENDER=aus` oder ohne Fund. */
export function blenderAusUmgebung(env: { BLENDER?: string }, orte: readonly string[] = BLENDER_ORTE): string | null {
  return env.BLENDER?.trim() === "aus" ? null : ersteDatei(orte);
}

/**
 * Eine Szene im Bild (VKk4c): `main.blend` in Blender. Erst speichert Blender ohne Bildschirm seine Einstellungen ins Home der
 * Sandbox (tmpfs), ohne Begrüßung – sonst zeigt es beim ersten Start einen Dialog über der Szene. Blender lädt eine geänderte
 * Datei nicht von selbst: Das Skript startet es nach jeder Änderung neu (`neustartSchleife()`); der Agent baut die Szene im
 * Terminal mit `blender -b --python …` und speichert sie als `main.blend`. Die Vorschau rechnet Mesa in Software. `$0` ist
 * Blender, `$1` die Datei.
 */
export const BLENDER_START = [
  `"$0" -b --factory-startup --python-expr "import bpy; bpy.context.preferences.view.show_splash = False; bpy.ops.wm.save_userpref()" > /dev/null 2>&1`,
  ...neustartSchleife(),
].join("\n");

export function blenderBefehl(blender: string): string[] {
  return ["/bin/sh", "-c", BLENDER_START, blender, "/arbeit/main.blend"];
}

/** Wo der Knoten LibreOffice sucht (VKk4d) – nur das Paket der Distribution (`soffice`, ein Verweis nach `/usr/lib/libreoffice`). */
export const LIBREOFFICE_ORTE: readonly string[] = ["/usr/bin/soffice"];

/** LibreOffice aus der Distribution (VKk4d): der erste aus `LIBREOFFICE_ORTE`; null mit `LIBREOFFICE=aus` oder ohne Fund. */
export function libreofficeAusUmgebung(env: { LIBREOFFICE?: string }, orte: readonly string[] = LIBREOFFICE_ORTE): string | null {
  return env.LIBREOFFICE?.trim() === "aus" ? null : ersteDatei(orte);
}

/**
 * Dokumente, die das Bild in LibreOffice zeigt (VKk4d), in dieser Reihenfolge: OpenDocument, dasselbe als flaches XML (Text,
 * den der Agent direkt schreibt), dann die Formate von Microsoft Office. Die erste, die als echte Datei im Projekt liegt, zählt.
 */
export const LIBREOFFICE_DATEIEN: readonly string[] = [
  "main.odt", "main.ods", "main.odp", "main.odg", "main.fodt", "main.fods", "main.fodp", "main.fodg", "main.docx", "main.xlsx", "main.pptx",
];

/**
 * Umweg zum Bildschirm (VKk4d), in Python für die Sandbox des Programms: lauscht auf der abstrakten Adresse des Bildschirms
 * (`@/tmp/.X11-unix/X<n>`, nur im Netz-Namensraum dieser Sandbox) und reicht jede Verbindung an den Socket im geteilten Ordner
 * weiter. Für Programme mit eigenem AppArmor-Profil: Ubuntu bringt für LibreOffice welche mit (`complain`), und unter einem
 * Profil scheitert das Verbinden mit dem Socket – Xvfb hat ihn in einem anderen Mount-Namensraum angelegt, AppArmor findet
 * seinen Pfad nicht („disconnected path“) und antwortet mit `EACCES`, auch im Modus `complain`. libxcb versucht die abstrakte
 * Adresse zuerst; sie hat keinen Pfad. Python selbst hat kein Profil. `argv[1]` ist die Nummer des Bildschirms.
 */
export const X11_UMWEG = [
  "import socket, sys, threading",
  "ziel = '/tmp/.X11-unix/X' + sys.argv[1]",
  "hoeren = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)",
  "hoeren.bind('\\0' + ziel)",
  "hoeren.listen(16)",
  "def pumpe(von, nach):",
  "    try:",
  "        while True:",
  "            daten = von.recv(65536)",
  "            if not daten:",
  "                break",
  "            nach.sendall(daten)",
  "    except OSError:",
  "        pass",
  "    for s in (von, nach):",
  "        try:",
  "            s.shutdown(socket.SHUT_RDWR)",
  "        except OSError:",
  "            pass",
  "while True:",
  "    a, _ = hoeren.accept()",
  "    b = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)",
  "    try:",
  "        b.connect(ziel)",
  "    except OSError:",
  "        a.close()",
  "        b.close()",
  "        continue",
  "    threading.Thread(target=pumpe, args=(a, b), daemon=True).start()",
  "    threading.Thread(target=pumpe, args=(b, a), daemon=True).start()",
].join("\n");

/**
 * Ein Dokument im Bild (VKk4d): eine Datei aus `LIBREOFFICE_DATEIEN` in LibreOffice. Die Einstellungen legt das Skript im Home
 * der Sandbox an (tmpfs): ohne Tipp des Tages und ohne Sperrdatei – sonst läge `.~lock.main.odt#` im Projekt und käme in den
 * Commit. Gezeichnet wird über X11 (`SAL_USE_VCLPLUGIN=gen`, gleich welche Oberflächen installiert sind). LibreOffice lädt eine
 * geänderte Datei nicht von selbst: Das Skript startet es nach jeder Änderung neu (`neustartSchleife()`), mit `--norestore` – nach
 * einem harten Ende fragte es sonst nach der Wiederherstellung. Vor dem ersten Start legt es den Umweg zum Bildschirm an
 * (`X11_UMWEG`, `$2`) und wartet, bis er lauscht – ohne ihn sähe LibreOffice unter dem Profil von Ubuntu keinen Bildschirm. `$0`
 * ist soffice, `$1` die Datei.
 */
export const LIBREOFFICE_START = [
  `d="$HOME/.config/libreoffice/4/user"; mkdir -p "$d"`,
  `cat > "$d/registrymodifications.xcu" <<'XCU'`,
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
  `<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="ShowTipOfTheDay" oor:op="fuse"><value>false</value></prop></item>`,
  `<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseLocking" oor:op="fuse"><value>false</value></prop></item>`,
  `</oor:items>`,
  `XCU`,
  `export SAL_USE_VCLPLUGIN=gen`,
  `if [ -n "$DISPLAY" ]; then`,
  `  /usr/bin/python3 -c "$2" "\${DISPLAY#:}" &`,
  `  for i in $(seq 50); do grep -q "@/tmp/.X11-unix/X\${DISPLAY#:}$" /proc/net/unix && break; sleep 0.1; done`,
  `fi`,
  ...neustartSchleife(undefined, "--norestore --nologo "),
].join("\n");

export function libreofficeBefehl(soffice: string, datei: string): string[] {
  return ["/bin/sh", "-c", LIBREOFFICE_START, soffice, `/arbeit/${datei}`, X11_UMWEG];
}

/** Wo der Knoten Inkscape sucht (VKk4e) – nur das Paket der Distribution unter `/usr` (mit GTK viele Dateien). */
export const INKSCAPE_ORTE: readonly string[] = ["/usr/bin/inkscape"];

/** Inkscape aus der Distribution (VKk4e): der erste aus `INKSCAPE_ORTE`; null mit `INKSCAPE=aus` oder ohne Fund. */
export function inkscapeAusUmgebung(env: { INKSCAPE?: string }, orte: readonly string[] = INKSCAPE_ORTE): string | null {
  return env.INKSCAPE?.trim() === "aus" ? null : ersteDatei(orte);
}

/**
 * Eine Zeichnung im Bild (VKk4e): `main.svg` in Inkscape. Mit einer Datei startet Inkscape ohne Begrüßung und legt nichts neben
 * sie; eine geänderte Datei lädt es nicht von selbst – das Skript startet es nach jeder Änderung neu (`neustartSchleife()`). Ein
 * eigenes AppArmor-Profil bringt Ubuntu für Inkscape nicht mit (anders als für LibreOffice, `X11_UMWEG`). `$0` ist Inkscape, `$1`
 * die Datei.
 */
export const INKSCAPE_START = neustartSchleife().join("\n");

export function inkscapeBefehl(inkscape: string): string[] {
  return ["/bin/sh", "-c", INKSCAPE_START, inkscape, "/arbeit/main.svg"];
}

/** Wo der Knoten GIMP sucht (VKk4f) – nur das Paket der Distribution unter `/usr` (mit GTK und GEGL viele Dateien). */
export const GIMP_ORTE: readonly string[] = ["/usr/bin/gimp"];

/** GIMP aus der Distribution (VKk4f): der erste aus `GIMP_ORTE`; null mit `GIMP=aus` oder ohne Fund. */
export function gimpAusUmgebung(env: { GIMP?: string }, orte: readonly string[] = GIMP_ORTE): string | null {
  return env.GIMP?.trim() === "aus" ? null : ersteDatei(orte);
}

/**
 * Ein Bild im Bild (VKk4f): `main.xcf` in GIMP – sein eigenes Format, Strg+S im Bild speichert ohne Rückfrage dorthin. Ohne
 * Fenstermanager stünde das Fenster, wo `sessionrc` es hinlegt (200,100 mit 1024×768, über den Rand); das Skript schreibt die
 * Vorlage der Distribution (`/etc/gimp/2.0`, in der Sandbox nur lesbar) mit Ort 0,0 und der Größe des Bilds ins Home der
 * Sandbox (tmpfs, nie ins Projekt) – Werkzeugkasten und Docks bleiben. Eine geänderte Datei lädt GIMP nicht von selbst:
 * Neustart über `neustartSchleife()`. `$0` ist GIMP, `$1` die Datei, `$2` und `$3` die Größe.
 */
export const GIMP_START = [
  `mkdir -p "$HOME/.config/GIMP/2.10"`,
  `sed -e 's/(position [0-9]* [0-9]*)/(position 0 0)/' -e "s/(size [0-9]* [0-9]*)/(size $2 $3)/" /etc/gimp/2.0/sessionrc > "$HOME/.config/GIMP/2.10/sessionrc"`,
  ...neustartSchleife(undefined, "--no-splash "),
].join("\n");

export function gimpBefehl(gimp: string, groesse: { breite: number; hoehe: number }): string[] {
  return ["/bin/sh", "-c", GIMP_START, gimp, "/arbeit/main.xcf", String(groesse.breite), String(groesse.hoehe)];
}

/** Wo der Knoten QGIS sucht (VKk4g) – nur das Paket der Distribution unter `/usr` (mit Qt, GDAL und PROJ viele Dateien). */
export const QGIS_ORTE: readonly string[] = ["/usr/bin/qgis"];

/** QGIS aus der Distribution (VKk4g): der erste aus `QGIS_ORTE`; null mit `QGIS=aus` oder ohne Fund. */
export function qgisAusUmgebung(env: { QGIS?: string }, orte: readonly string[] = QGIS_ORTE): string | null {
  return env.QGIS?.trim() === "aus" ? null : ersteDatei(orte);
}

/** Karten, die das Bild in QGIS zeigt (VKk4g): das Projekt als XML (Text), dann als Archiv – die erste echte Datei zählt. */
export const QGIS_DATEIEN: readonly string[] = ["main.qgs", "main.qgz"];

/**
 * Eine Karte im Bild (VKk4g): ein Projekt aus `QGIS_DATEIEN` in QGIS. Die Einstellungen legt das Skript im Home der Sandbox an
 * (tmpfs, nie im Projekt): kein Download fehlender Schriften – sonst versucht QGIS beim ersten Start „Open Sans“ zu laden und
 * meldet über der Karte, dass es scheiterte (die Sandbox hat kein Netz). Ohne Fenstermanager öffnet QGIS sein Fenster in eigener
 * Größe; ein Skript beim Start (`--code`, Python in QGIS) setzt es auf 0,0 und genau die Größe des Bilds – den Ausschnitt der Karte
 * passt QGIS dabei selbst neu ein. Die Statusleiste allein braucht rund 1000 Pixel Breite: Ist das Bild schmaler, blendet das
 * Skript sie aus, sonst ragte die Karte über den Rand. Ein geändertes Projekt lädt QGIS nicht von selbst: Neustart über
 * `neustartSchleife()`. `$0` ist QGIS, `$1` die Datei, `$2` und `$3` die Größe.
 */
export const QGIS_START = [
  `p="$HOME/.local/share/QGIS/QGIS3/profiles/default/QGIS"; mkdir -p "$p"`,
  `printf '%s\\n' '[fonts]' 'downloadMissingFonts=false' > "$p/QGIS3.ini"`,
  `printf '%s\\n' 'from qgis.utils import iface' 'w = iface.mainWindow()' "if w.minimumSizeHint().width() > $2:" '    w.statusBar().hide()' \\`,
  `  '    w.layout().activate()' "w.setGeometry(0, 0, $2, $3)" > "$HOME/.freedom-qgis.py"`,
  ...neustartSchleife(undefined, `--nologo --code "$HOME/.freedom-qgis.py" `),
].join("\n");

export function qgisBefehl(qgis: string, datei: string, groesse: { breite: number; hoehe: number }): string[] {
  return ["/bin/sh", "-c", QGIS_START, qgis, `/arbeit/${datei}`, String(groesse.breite), String(groesse.hoehe)];
}

/**
 * Was gezeigt wird: `.freedom/start` (eine echte Datei in einem echten Ordner, mit `sh`), mit Godot (VKk3a) dann ein
 * Godot-Projekt (`project.godot`), sonst `main.py` (mit dem Python aus `.venv`, wo es eins gibt), mit Wine (VKi1) dann
 * `main.exe`, mit OpenSCAD (VKk4a) dann `main.scad`, mit KiCad (VKk4b) dann `main.kicad_sch`, mit Blender (VKk4c) dann
 * `main.blend`, mit LibreOffice (VKk4d) dann ein Dokument aus `LIBREOFFICE_DATEIEN`. Mit Browser (VKg2c1) dann ein
 * Web-Projekt: mit Skript `dev` in
 * `package.json` der Dev-Server, sonst `index.html`. Mit Inkscape (VKk4e) dann `main.svg`, mit GIMP (VKk4f) dann `main.xcf`, mit
 * QGIS (VKk4g) zuletzt ein Projekt aus `QGIS_DATEIEN`.
 * Sonst null – dann sagt die App,
 * wie man ein Programm nennt.
 */
export function bildBefehl(projektOrdner: string, web?: { browser: string; breite: number; hoehe: number },
  programme?: {
    breite: number; hoehe: number; godot?: boolean; wine?: string; openscad?: string; kicad?: string; blender?: string; libreoffice?: string;
    inkscape?: string; gimp?: string; qgis?: string;
  },
): string[] | null {
  const ist = (pfad: string, art: "datei" | "ordner") => {
    try {
      const st = lstatSync(join(projektOrdner, pfad));
      return art === "datei" ? st.isFile() : st.isDirectory();
    } catch {
      return false;
    }
  };
  if (ist(".freedom", "ordner") && ist(".freedom/start", "datei")) return ["/bin/sh", "/arbeit/.freedom/start"];
  if (programme?.godot && ist("project.godot", "datei")) return ["/bin/sh", "-c", GODOT_START, GODOT_IN_SANDBOX, ...godotArgumente(programme)];
  if (ist("main.py", "datei")) {
    const venv = ist(".venv", "ordner") && existsSync(join(projektOrdner, ".venv", "bin", "python3"));
    return [venv ? "/arbeit/.venv/bin/python3" : "python3", "/arbeit/main.py"];
  }
  if (programme?.wine && ist("main.exe", "datei")) return wineBefehl(programme.wine, programme);
  if (programme?.openscad && ist("main.scad", "datei")) return openscadBefehl(programme.openscad, programme);
  if (programme?.kicad && ist("main.kicad_sch", "datei")) return kicadBefehl(programme.kicad);
  if (programme?.blender && ist("main.blend", "datei")) return blenderBefehl(programme.blender);
  const dokument = programme?.libreoffice ? LIBREOFFICE_DATEIEN.find((d) => ist(d, "datei")) : undefined;
  if (programme?.libreoffice && dokument) return libreofficeBefehl(programme.libreoffice, dokument);
  if (web && devBefehl(projektOrdner)) return ["/bin/sh", "-c", WEB_DEV_START, web.browser, ...browserArgumente(web, `http://127.0.0.1:${DEV_PORT}/`)];
  if (web && ist("index.html", "datei")) return [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")];
  // eine Zeichnung erst nach Web (VKk4e): Ein Logo `main.svg` in einem Web-Projekt soll die Seite nicht verdrängen
  if (programme?.inkscape && ist("main.svg", "datei")) return inkscapeBefehl(programme.inkscape);
  // ebenso ein Bild aus GIMP (VKk4f) – die Quelle eines Logos liegt oft daneben
  if (programme?.gimp && ist("main.xcf", "datei")) return gimpBefehl(programme.gimp, programme);
  // ebenso eine Karte aus QGIS (VKk4g) – das Projekt hinter einer Web-Karte liegt oft daneben
  const karte = programme?.qgis ? QGIS_DATEIEN.find((d) => ist(d, "datei")) : undefined;
  if (programme?.qgis && karte) return qgisBefehl(programme.qgis, karte, programme);
  return null;
}

/**
 * Was der Motor über das Bild wissen muss (VKk5, `SOUL.md` im Home von Hermes): welche Datei das Bild startet, in der
 * Reihenfolge von `bildBefehl()` und nur mit den Programmen, die der Knoten hat – sonst nennte der Agent seine Datei
 * `zahnrad.scad`, und das Bild fände nichts. Englisch wie die Anweisungen in `repo-lauf.ts`. Nur, was geprüft ist: STL aus
 * OpenSCAD und Exporte aus `kicad-cli` gehen im Terminal ohne Bildschirm, ein PNG aus OpenSCAD nicht; Script-Fu aus GIMP geht,
 * PyQGIS und `qgis_process` aus QGIS mit `QT_QPA_PLATFORM=offscreen`.
 */
export function bildHinweise(p: {
  godot?: boolean; wine?: boolean; openscad?: boolean; kicad?: boolean; blender?: boolean; libreoffice?: boolean; browser?: boolean;
  inkscape?: boolean; gimp?: boolean; qgis?: boolean;
}): string {
  const dateien = [
    "- `.freedom/start` – your own start command (a shell script, run with sh in /arbeit)",
    ...(p.godot ? ["- `project.godot` – a Godot 4 project, imported and run as the game"] : []),
    "- `main.py` – run with python3 (with `.venv/bin/python3` if the project has one)",
    ...(p.wine ? ["- `main.exe` – a Windows program in Wine; build it with `x86_64-w64-mingw32-gcc` where it is installed"] : []),
    ...(p.openscad ? ["- `main.scad` – OpenSCAD with editor and preview; it reloads after every save. In the terminal, "
      + "`openscad -o model.stl main.scad` exports meshes; images need the screen, leave them to the view"] : []),
    ...(p.kicad ? ["- `main.kicad_sch` – the KiCad schematic editor; it restarts after every save. In the terminal, "
      + "`kicad-cli sch export svg` and `kicad-cli sch export netlist` work"] : []),
    ...(p.blender ? ["- `main.blend` – Blender; it restarts after every save. In the terminal, build the scene with "
      + "`blender -b --python build.py` and save it with `bpy.ops.wm.save_as_mainfile(filepath=\"/arbeit/main.blend\")`"] : []),
    ...(p.libreoffice ? ["- `main.odt`, `main.ods`, `main.odp`, `main.odg` – LibreOffice, also as flat XML you write as text (`main.fodt`, "
      + "`main.fods`, `main.fodp`, `main.fodg`) or as `main.docx`, `main.xlsx`, `main.pptx`; it restarts after every save. In the terminal, "
      + "`soffice --headless --convert-to pdf main.fodt` works, as do `odt` and `docx`"] : []),
    ...(p.browser ? ["- `package.json` with a `dev` script (started with PORT and HOST set), else `index.html` – shown in Chromium"] : []),
    ...(p.inkscape ? ["- `main.svg` – Inkscape (only if no web project is there); it restarts after every save. In the terminal, "
      + "`inkscape --export-type=pdf main.svg` works"] : []),
    ...(p.gimp ? ["- `main.xcf` – GIMP (only if no web project is there); it restarts after every save. In the terminal, Script-Fu runs "
      + "without the screen, for example to turn another image into `main.xcf`: `gimp -i -b '(let* ((i (car (gimp-file-load 1 \"bild.jpg\" "
      + "\"bild.jpg\")))) (gimp-xcf-save 0 i (car (gimp-image-get-active-drawable i)) \"main.xcf\" \"main.xcf\"))' -b '(gimp-quit 0)'`"] : []),
    ...(p.qgis ? ["- `main.qgs` (or `main.qgz`) – a QGIS project (only if no web project is there); it restarts after every save of the "
      + "project. Keep the layers as files next to it (GeoJSON, GeoPackage) with relative paths, and set a default view – without "
      + "one the map opens empty. In the terminal, QGIS needs `QT_QPA_PLATFORM=offscreen`; build the project with PyQGIS and the "
      + "system Python, for example `QT_QPA_PLATFORM=offscreen /usr/bin/python3 -c 'from qgis.core import *; a = QgsApplication([], "
      + "False); a.initQgis(); p = QgsProject.instance(); l = QgsVectorLayer(\"karte.geojson\", \"karte\", \"ogr\"); p.addMapLayer(l); "
      + "p.setCrs(l.crs()); p.viewSettings().setDefaultViewExtent(QgsReferencedRectangle(l.extent(), l.crs())); p.write(\"main.qgs\"); "
      + "a.exitQgis()'`, and run processing algorithms with `QT_QPA_PLATFORM=offscreen qgis_process run native:buffer "
      + "--INPUT=karte.geojson --DISTANCE=1 --OUTPUT=puffer.geojson`"] : []),
  ];
  return [
    "# Showing the project",
    "",
    "The user can open a live view of the project (\"Bild\") in the FreedomStack app. It runs the first of these files that",
    "exists in /arbeit, on a virtual X11 screen, without network and without a GPU:",
    "",
    ...dateien,
    "",
    "Name the main file accordingly, so the user sees the result. When none fits, write `.freedom/start`.",
    "",
  ].join("\n");
}

/** Die erste Zeile eines Stroms – höchstens `max` Byte, bis `ms`; sonst null. */
function ersteZeile(aus: Readable, max: number, ms: number): Promise<string | null> {
  return new Promise((fertig) => {
    let text = "";
    const ende = (z: string | null) => { clearTimeout(uhr); aus.off("data", nimm); aus.off("close", zu); aus.resume(); fertig(z); };
    const nimm = (b: Buffer) => {
      text += b.toString("utf8");
      const i = text.indexOf("\n");
      if (i >= 0) ende(text.slice(0, i));
      else if (text.length > max) ende(null);
    };
    const zu = () => ende(null);
    const uhr = setTimeout(zu, ms);
    aus.on("data", nimm);
    aus.once("close", zu);
  });
}

interface Laufend { beende: () => void }

type Starte = typeof sandboxDienst;

export class BildStrom {
  private readonly laufend = new Map<string, Laufend>();
  private readonly sandbox: Starte;
  /** Was das Programm außer dem Bildschirm lesen darf – mit Browser dessen Ordner und die Schriften, mit Godot die eine Datei. */
  private readonly programmLesbar: ReadonlyArray<{ quelle: string; ziel: string }>;

  constructor(private readonly ablage: Pick<ProjektAblage, "ort">, private readonly o: {
    turn: TurnDienst; ziel: TurnZiel;
    /** Python mit PyGObject und GStreamer in der Sandbox (Vorgabe `python3`). */
    python?: string; bwrap?: string;
    /** Kodierer (VKg2c2, `bildKodierer()`), Vorgabe `vp8`; `gpu`: die Bild-Sandbox bekommt die GPU (nur mit NVENC). */
    kodierer?: "vp8" | "h264"; gpu?: boolean;
    /** Chromium für Web-Projekte (VKg2c1, `browserAusUmgebung()`) – ohne zeigt das Bild nur Programme. */
    browser?: string;
    /** Godot für Godot-Projekte (VKk3a, `godotAusUmgebung()`) – das Programm sieht es als `GODOT_IN_SANDBOX`. */
    godot?: string;
    /** Wine für `main.exe` (VKi1, `wineAusUmgebung()`) – unter `/usr`, das die Sandbox ohnehin sieht. */
    wine?: string;
    /** OpenSCAD für `main.scad` (VKk4a, `openscadAusUmgebung()`) – unter `/usr`, das die Sandbox ohnehin sieht. */
    openscad?: string;
    /** KiCad für `main.kicad_sch` (VKk4b, `kicadAusUmgebung()`) – unter `/usr`, das die Sandbox ohnehin sieht. */
    kicad?: string;
    /** Blender für `main.blend` (VKk4c, `blenderAusUmgebung()`) – unter `/usr`, das die Sandbox ohnehin sieht. */
    blender?: string;
    /** LibreOffice für Dokumente (VKk4d, `libreofficeAusUmgebung()`) – unter `/usr`, dazu `/etc/libreoffice` aus der Sandbox. */
    libreoffice?: string;
    /** Inkscape für `main.svg` (VKk4e, `inkscapeAusUmgebung()`) – unter `/usr`, das die Sandbox ohnehin sieht. */
    inkscape?: string;
    /** GIMP für `main.xcf` (VKk4f, `gimpAusUmgebung()`) – unter `/usr`, dazu `/etc/gimp` aus der Sandbox. */
    gimp?: string;
    /** QGIS für Karten (VKk4g, `qgisAusUmgebung()`) – unter `/usr`, das die Sandbox ohnehin sieht. */
    qgis?: string;
    /** Nur für Tests: statt `process.arch` (VKi2 – auf ARM64 braucht Wine die Angaben zum Prozessor). */
    arch?: string;
    /** Zusätzlich nur lesbar für das Programm (Tests: Node außerhalb von `/usr` für `npm run dev`). */
    nurLesbar?: ReadonlyArray<{ quelle: string; ziel: string }>;
    /** Nur für Tests: statt `bildBefehl()`. */
    befehl?: (projektOrdner: string) => readonly string[] | null;
    /** Nur für Tests: statt `sandboxDienst()`. */
    starte?: Starte;
  }) {
    this.sandbox = o.starte ?? ((befehl, ort) => sandboxDienst(befehl, { ...ort, ...(o.bwrap ? { bwrap: o.bwrap } : {}) }));
    this.programmLesbar = [
      ...(o.browser ? browserLesbar(o.browser) : []), ...(o.godot ? [{ quelle: o.godot, ziel: GODOT_IN_SANDBOX }] : []), ...(o.nurLesbar ?? []),
    ];
  }

  /** Läuft für das Projekt ein Bild? */
  hat(projekt: string): boolean {
    return this.laufend.has(projekt);
  }

  /** Bild starten: das Angebot der App rein, die Antwort für die App raus – oder `CodeAbgelehnt`. */
  async starte(projekt: string, angebot: string, groesse: { breite: number; hoehe: number }): Promise<string> {
    const ort = this.ablage.ort(projekt);
    const erlaubt = relayAdressen(angebot);
    if (!istBildSdp(angebot) || erlaubt.length === 0) throw new CodeAbgelehnt("code-bild-fehler");
    this.beende(projekt);
    if (this.laufend.size >= BILD_GRENZEN.gesamt) throw new CodeAbgelehnt("code-zu-viele");
    const browser = this.o.browser;
    const programme = {
      ...groesse, ...(this.o.godot ? { godot: true } : {}), ...(this.o.wine ? { wine: this.o.wine } : {}),
      ...(this.o.openscad ? { openscad: this.o.openscad } : {}), ...(this.o.kicad ? { kicad: this.o.kicad } : {}),
      ...(this.o.blender ? { blender: this.o.blender } : {}), ...(this.o.libreoffice ? { libreoffice: this.o.libreoffice } : {}),
      ...(this.o.inkscape ? { inkscape: this.o.inkscape } : {}), ...(this.o.gimp ? { gimp: this.o.gimp } : {}),
      ...(this.o.qgis ? { qgis: this.o.qgis } : {}),
    };
    const befehl = this.o.befehl ? this.o.befehl(ort) : bildBefehl(ort, browser ? { browser, ...groesse } : undefined, programme);
    if (!befehl) throw new CodeAbgelehnt("code-bild-kein-programm");

    // Den Platz gleich belegen – zwei Starts zugleich kämen sonst beide an der Grenze vorbei
    let bild: ReturnType<Starte> | null = null;
    let programm: ReturnType<Starte> | null = null;
    let vorbei = false;
    const eintrag: Laufend = {
      beende: () => {
        if (vorbei) return;
        vorbei = true;
        bild?.beende();
        programm?.beende();
      },
    };
    this.laufend.set(projekt, eintrag);
    const abgelehnt = (): never => {
      eintrag.beende();
      if (this.laufend.get(projekt) === eintrag) this.laufend.delete(projekt);
      throw new CodeAbgelehnt("code-bild-fehler");
    };

    const ordner = mkdtempSync(join(tmpdir(), "freedom-bild-"));
    const [x11, leer] = [join(ordner, "x11"), join(ordner, "arbeit")];
    for (const d of [x11, leer]) mkdirSync(d, { mode: 0o700 });
    const tunnel = await oeffneTurnTunnel({ sockel: join(ordner, "turn.sock"), ziel: this.o.ziel, erlaubt }).catch(() => null);
    if (!tunnel || vorbei) {
      await tunnel?.schliesse();
      rmSync(ordner, { recursive: true, force: true });
      return abgelehnt();
    }
    const z = turnZugang(this.o.turn);
    const turn = `turn://${encodeURIComponent(z.nutzer)}:${encodeURIComponent(z.passwort)}@127.0.0.1:${BILD_IN_SANDBOX.port}?transport=tcp`;
    const py = this.o.python ?? "python3";
    const b = this.sandbox(
      [py, "/freedom/motor.py", BILD_IN_SANDBOX.sockel, String(BILD_IN_SANDBOX.port), "--", py, "/freedom/bild.py", String(groesse.breite), String(groesse.hoehe),
        this.o.kodierer ?? "vp8"],
      {
        arbeit: leer, mitEinAusgabe: true, ...(this.o.gpu ? { gpu: true } : {}),
        nurLesbar: [{ quelle: STARTSKRIPT, ziel: "/freedom/motor.py" }, { quelle: BILDSKRIPT, ziel: "/freedom/bild.py" }, { quelle: ordner, ziel: BILD_IN_SANDBOX.ordner }],
        schreibbar: [{ quelle: x11, ziel: BILD_IN_SANDBOX.x11 }],
      },
    );
    bild = b;
    void b.ende.then(async () => {
      eintrag.beende();
      if (this.laufend.get(projekt) === eintrag) this.laufend.delete(projekt);
      await tunnel.schliesse();
      if (programm) await programm.ende;
      rmSync(ordner, { recursive: true, force: true });
    });

    // stdin bleibt offen: Endet es, endet das Bild (so endet es auch, wenn der Knoten endet)
    b.ein!.write(`${JSON.stringify({ turn, angebot })}\n`);
    // endet die Bild-Sandbox, nicht bis zur Frist warten
    const zeile = await Promise.race([ersteZeile(b.aus!, BILD_GRENZEN.antwortBytes, BILD_GRENZEN.startMs), b.ende.then(() => null)]);
    let antwort: unknown;
    let kodierer: unknown;
    try {
      ({ antwort, kodierer } = zeile === null ? {} : (JSON.parse(zeile) as { antwort?: unknown; kodierer?: unknown }));
    } catch {
      antwort = null;
    }
    if (vorbei || !istBildSdp(antwort) || !existsSync(join(x11, "X99"))) return abgelehnt();
    // Das Programm erst, wenn die Antwort steht (und mit ihr der Bildschirm) – ein Programm, das beim Start den Bildschirm
    // aufhält, verzögerte sonst die Antwort (VKi1: Wine legt sein Präfix an, gemessen 11,7 s statt 0,7 s). In seiner eigenen
    // Sandbox, mit dem Socket des Bildschirms nur lesbar
    programm = this.sandbox(["/usr/bin/env", `DISPLAY=${ANZEIGE}`, ...befehl], {
      arbeit: ort,
      nurLesbar: [
        { quelle: x11, ziel: BILD_IN_SANDBOX.x11 }, ...this.programmLesbar,
        ...(this.o.wine !== undefined && JSON.stringify(befehl) === JSON.stringify(wineBefehl(this.o.wine, groesse)) ? wineLesbar(this.o.arch) : []),
      ],
    });
    void programm.ende.then(eintrag.beende);
    // Mit dem Zugang zum TURN endet auch das Bild – ohne ihn erneuert der TURN die Allokation nicht
    setTimeout(eintrag.beende, Math.max(0, z.bis * 1000 - Date.now())).unref();
    const name = typeof kodierer === "string" && Object.hasOwn(KODIERER_NAME, kodierer) ? KODIERER_NAME[kodierer] : "?";
    console.log(`[bild] gestartet, ${name} (${this.laufend.size} von ${BILD_GRENZEN.gesamt})`);
    return antwort;
  }

  /** Bild eines Projekts beenden – true, wenn eines lief. */
  beende(projekt: string): boolean {
    const l = this.laufend.get(projekt);
    if (!l) return false;
    this.laufend.delete(projekt);
    l.beende();
    return true;
  }

  beendeAlle(): void {
    for (const p of [...this.laufend.keys()]) this.beende(p);
  }
}
