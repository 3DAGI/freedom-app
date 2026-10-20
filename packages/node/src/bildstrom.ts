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
 * Kodiert wird nach dem Angebot der App (VKg2c2): mit der Nummer des Formats aus dem Angebot, H.264 über NVENC, wo der Knoten
 * es hat (nur die Bild-Sandbox bekommt dann die GPU), sonst VP8 in Software (`bildKodierer()`).
 *
 * Angebot und Antwort reisen nur versiegelt in der Code-Aktion `bild` (PROTOCOL.md §34), beide nur mit Relay-Kandidaten.
 * Je Projekt ein Bild, auf dem Knoten höchstens `BILD_GRENZEN.gesamt`; ein neues Angebot ersetzt das alte. Es endet mit der
 * Verbindung, mit dem Programm, mit `bild-ende` oder wenn der Zugang zum TURN abläuft. Ins Log nur Zahlen.
 */
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/**
 * Was gezeigt wird: `.freedom/start` (eine echte Datei in einem echten Ordner, mit `sh`), sonst `main.py` (mit dem Python
 * aus `.venv`, wo es eins gibt). Mit Browser (VKg2c1) dann ein Web-Projekt: mit Skript `dev` in `package.json` der
 * Dev-Server, sonst `index.html`. Sonst null – dann sagt die App, wie man ein Programm nennt.
 */
export function bildBefehl(projektOrdner: string, web?: { browser: string; breite: number; hoehe: number }): string[] | null {
  const ist = (pfad: string, art: "datei" | "ordner") => {
    try {
      const st = lstatSync(join(projektOrdner, pfad));
      return art === "datei" ? st.isFile() : st.isDirectory();
    } catch {
      return false;
    }
  };
  if (ist(".freedom", "ordner") && ist(".freedom/start", "datei")) return ["/bin/sh", "/arbeit/.freedom/start"];
  if (ist("main.py", "datei")) {
    const venv = ist(".venv", "ordner") && existsSync(join(projektOrdner, ".venv", "bin", "python3"));
    return [venv ? "/arbeit/.venv/bin/python3" : "python3", "/arbeit/main.py"];
  }
  if (!web) return null;
  if (devBefehl(projektOrdner)) return ["/bin/sh", "-c", WEB_DEV_START, web.browser, ...browserArgumente(web, `http://127.0.0.1:${DEV_PORT}/`)];
  return ist("index.html", "datei") ? [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")] : null;
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
  /** Was das Programm außer dem Bildschirm lesen darf – mit Browser dessen Ordner und die Schriften. */
  private readonly programmLesbar: ReadonlyArray<{ quelle: string; ziel: string }>;

  constructor(private readonly ablage: Pick<ProjektAblage, "ort">, private readonly o: {
    turn: TurnDienst; ziel: TurnZiel;
    /** Python mit PyGObject und GStreamer in der Sandbox (Vorgabe `python3`). */
    python?: string; bwrap?: string;
    /** Kodierer (VKg2c2, `bildKodierer()`), Vorgabe `vp8`; `gpu`: die Bild-Sandbox bekommt die GPU (nur mit NVENC). */
    kodierer?: "vp8" | "h264"; gpu?: boolean;
    /** Chromium für Web-Projekte (VKg2c1, `browserAusUmgebung()`) – ohne zeigt das Bild nur Programme. */
    browser?: string;
    /** Zusätzlich nur lesbar für das Programm (Tests: Node außerhalb von `/usr` für `npm run dev`). */
    nurLesbar?: ReadonlyArray<{ quelle: string; ziel: string }>;
    /** Nur für Tests: statt `bildBefehl()`. */
    befehl?: (projektOrdner: string) => readonly string[] | null;
    /** Nur für Tests: statt `sandboxDienst()`. */
    starte?: Starte;
  }) {
    this.sandbox = o.starte ?? ((befehl, ort) => sandboxDienst(befehl, { ...ort, ...(o.bwrap ? { bwrap: o.bwrap } : {}) }));
    this.programmLesbar = [...(o.browser ? browserLesbar(o.browser) : []), ...(o.nurLesbar ?? [])];
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
    const befehl = this.o.befehl ? this.o.befehl(ort) : bildBefehl(ort, browser ? { browser, ...groesse } : undefined);
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
    // Das Programm erst, wenn der Bildschirm steht – in seiner eigenen Sandbox, mit dem Socket des Bildschirms nur lesbar
    const bis = Date.now() + BILD_GRENZEN.startMs;
    while (!vorbei && !existsSync(join(x11, "X99")) && Date.now() < bis) await new Promise((r) => setTimeout(r, 50));
    if (!vorbei && existsSync(join(x11, "X99"))) {
      programm = this.sandbox(["/usr/bin/env", `DISPLAY=${ANZEIGE}`, ...befehl], {
        arbeit: ort,
        nurLesbar: [{ quelle: x11, ziel: BILD_IN_SANDBOX.x11 }, ...this.programmLesbar],
      });
      void programm.ende.then(eintrag.beende);
    }
    // endet die Bild-Sandbox (oder das Programm, das sie mitnimmt), nicht bis zur Frist warten
    const zeile = await Promise.race([ersteZeile(b.aus!, BILD_GRENZEN.antwortBytes, Math.max(0, bis - Date.now())), b.ende.then(() => null)]);
    let antwort: unknown;
    let kodierer: unknown;
    try {
      ({ antwort, kodierer } = zeile === null ? {} : (JSON.parse(zeile) as { antwort?: unknown; kodierer?: unknown }));
    } catch {
      antwort = null;
    }
    if (vorbei || !istBildSdp(antwort)) return abgelehnt();
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
