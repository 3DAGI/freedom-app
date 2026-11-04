/**
 * Bildstrom für Programme ohne Web (VKg2a2): Bild und Programm in zwei Sandboxen – den Zugang zum TURN, den Tunnel und die
 * Antwort an die App sieht nur die Bild-Sandbox; das Programm teilt mit ihr nur den Socket des Bildschirms. Angebot und
 * Antwort nur mit Relay-Kandidaten, je Projekt ein Bild, höchstens zwei.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { connect, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import {
  KIND_DVM_KNOTEN_CODE, LocalSigner, MemoryRelay, OutboxPool, baueCodeAuftrag, generateKeypair, getTag, istBildSdp,
  leseCodeAntwort, neueKopplung, openPrivateJobResponse, type CodeAktion,
} from "@freedomstack/protocol";
import {
  BILD_GRENZEN, BILD_IN_SANDBOX, BLENDER_ORTE, BLENDER_START, BildStrom, GODOT_IN_SANDBOX, GODOT_ORTE, GODOT_START, INKSCAPE_ORTE, INKSCAPE_START,
  KICAD_ORTE, KICAD_START,
  LIBREOFFICE_DATEIEN, LIBREOFFICE_ORTE, LIBREOFFICE_START, OPENSCAD_ORTE, OPENSCAD_START,
  WEB_DEV_START, WINE_ORTE, bildBefehl, bildFehlt, bildHinweise, bildKodierer, blenderAusUmgebung, blenderBefehl, browserArgumente, godotArgumente, godotAusUmgebung, kicadAusUmgebung,
  X11_UMWEG, inkscapeAusUmgebung, inkscapeBefehl, kicadBefehl, libreofficeAusUmgebung, libreofficeBefehl, nvencDa, openscadAusUmgebung, openscadBefehl, wineAusUmgebung, wineBefehl,
  wineLesbar,
} from "../src/bildstrom.js";
import { DEV_PORT } from "../src/dev-server.js";
import { BROWSER_ORTE } from "../src/mcp-katalog.js";
import { DvmProvider } from "../src/dvm-provider.js";
import { CodeAbgelehnt, ProjektAblage } from "../src/projekte.js";
import { fuehreAus, pruefeSandbox, type sandboxDienst } from "../src/sandbox.js";
import { turnZugang } from "../src/turn.js";

const tmp = (n: string) => mkdtempSync(join(tmpdir(), `vkg2a2-${n}-`));
const FINGER = `a=fingerprint:sha-256 ${Array(32).fill("AB").join(":")}`;
const sdp = (...kandidaten: string[]) => ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", FINGER, ...kandidaten.map((k) => `a=${k}`), ""].join("\r\n");
const RELAY = "candidate:1 1 udp 33562623 203.0.113.9 49160 typ relay raddr 0.0.0.0 rport 0";
const ANGEBOT = sdp(RELAY);
const ANTWORT = sdp("candidate:4 1 UDP 337641727 203.0.113.9 49170 typ relay raddr 127.0.0.1 rport 9");
const TURN = { urls: ["turn:turn.example:3478?transport=tcp"], geheimnis: "g".repeat(40), gueltigSek: 600 };
const ZIEL = { host: "127.0.0.1", port: 9, tls: false };

function ablage(...projekte: string[]) {
  const a = new ProjektAblage(join(tmp("ablage"), "projekte"));
  for (const p of projekte) mkdirSync(a.ort(p), { recursive: true });
  return a;
}

test("VKg2a2: Programm – .freedom/start, sonst main.py (mit .venv), nur echte Dateien", () => {
  const a = ablage("start", "py", "venv", "nichts", "verweis", "ordner-verweis");
  mkdirSync(join(a.ort("start"), ".freedom"));
  writeFileSync(join(a.ort("start"), ".freedom", "start"), "python3 spiel.py\n");
  writeFileSync(join(a.ort("start"), "main.py"), "");
  assert.deepEqual(bildBefehl(a.ort("start")), ["/bin/sh", "/arbeit/.freedom/start"]);
  writeFileSync(join(a.ort("py"), "main.py"), "");
  assert.deepEqual(bildBefehl(a.ort("py")), ["python3", "/arbeit/main.py"]);
  writeFileSync(join(a.ort("venv"), "main.py"), "");
  mkdirSync(join(a.ort("venv"), ".venv", "bin"), { recursive: true });
  symlinkSync("/usr/bin/python3", join(a.ort("venv"), ".venv", "bin", "python3"));
  assert.deepEqual(bildBefehl(a.ort("venv")), ["/arbeit/.venv/bin/python3", "/arbeit/main.py"]);
  assert.equal(bildBefehl(a.ort("nichts")), null);
  symlinkSync(join(a.ort("py"), "main.py"), join(a.ort("verweis"), "main.py"));
  assert.equal(bildBefehl(a.ort("verweis")), null, "ein Verweis zählt nicht");
  symlinkSync(join(a.ort("start"), ".freedom"), join(a.ort("ordner-verweis"), ".freedom"));
  assert.equal(bildBefehl(a.ort("ordner-verweis")), null, "auch kein Ordner hinter einem Verweis");
});

test("VKg2c1: Web-Projekte mit Browser – Dev-Server, sonst index.html; Programme gehen vor, ohne Browser kein Web", () => {
  const a = ablage("dev", "seite", "beides", "py", "leer", "verweis");
  const web = { browser: "/usr/lib/chromium/chromium", breite: 800, hoehe: 600 };
  writeFileSync(join(a.ort("dev"), "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  writeFileSync(join(a.ort("dev"), "index.html"), "<p>");
  assert.deepEqual(bildBefehl(a.ort("dev"), web),
    ["/bin/sh", "-c", WEB_DEV_START, web.browser, ...browserArgumente(web, `http://127.0.0.1:${DEV_PORT}/`)]);
  writeFileSync(join(a.ort("seite"), "index.html"), "<p>");
  writeFileSync(join(a.ort("seite"), "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
  assert.deepEqual(bildBefehl(a.ort("seite"), web), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")]);
  writeFileSync(join(a.ort("py"), "main.py"), "");
  writeFileSync(join(a.ort("py"), "index.html"), "<p>");
  assert.deepEqual(bildBefehl(a.ort("py"), web), ["python3", "/arbeit/main.py"], "ein Programm geht vor");
  assert.equal(bildBefehl(a.ort("seite")), null, "ohne Browser kein Web");
  assert.equal(bildBefehl(a.ort("leer"), web), null);
  symlinkSync(join(a.ort("seite"), "index.html"), join(a.ort("verweis"), "index.html"));
  assert.equal(bildBefehl(a.ort("verweis"), web), null, "ein Verweis zählt nicht");
  const arg = browserArgumente(web, "file:///arbeit/index.html");
  for (const x of ["--no-sandbox", "--kiosk", "--window-size=800,600", "--user-data-dir=/tmp/chromium", "--disable-background-networking"]) assert.ok(arg.includes(x), x);
  assert.equal(arg.at(-1), "file:///arbeit/index.html");
});

test("VKg2c1: Dev-Server im Bild – erst `npm run dev` mit PORT und HOST, Chromium erst, wenn er antwortet", { timeout: 30_000 }, async () => {
  const d = tmp("devstart");
  // ein npm, das wie Vite nach einer Weile auf PORT lauscht, und ein Browser, der nur aufschreibt, womit er kam
  writeFileSync(join(d, "npm"), `#!/bin/sh\necho "$PORT $HOST $*" > "${d}/npm.txt"\nsleep 1\nexec python3 -m http.server "$PORT" --bind "$HOST"\n`);
  writeFileSync(join(d, "browser"), `#!/bin/sh\npython3 -c 'import urllib.request,sys; urllib.request.urlopen(sys.argv[1], timeout=5)' "$2" && echo "$*" > "${d}/browser.txt"\nkill 0\n`);
  for (const f of ["npm", "browser"]) chmodSync(join(d, f), 0o755);
  const sh = spawn("/bin/sh", ["-c", WEB_DEV_START, join(d, "browser"), "--kiosk", `http://127.0.0.1:${DEV_PORT}/`],
    { env: { PATH: `${d}:/usr/bin:/bin` }, stdio: "ignore", detached: true });
  await new Promise((r) => sh.once("close", r));
  try {
    process.kill(-sh.pid!);
  } catch { /* schon zu */ }
  assert.equal(readFileSync(join(d, "npm.txt"), "utf8"), `${DEV_PORT} 127.0.0.1 run dev\n`);
  assert.equal(readFileSync(join(d, "browser.txt"), "utf8"), `--kiosk http://127.0.0.1:${DEV_PORT}/\n`, "der Browser kam erst, als der Server antwortete");
});

test("VKk3a: Godot-Projekte – project.godot nur mit Godot, nach .freedom/start, vor main.py und Web, nur eine echte Datei", () => {
  const a = ablage("spiel", "start", "verweis", "ordner");
  const g = { breite: 800, hoehe: 600 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const godot = ["/bin/sh", "-c", GODOT_START, GODOT_IN_SANDBOX, ...godotArgumente(g)];
  for (const [f, inhalt] of [["project.godot", "config_version=5\n"], ["main.py", ""], ["index.html", "<p>"]]) writeFileSync(join(a.ort("spiel"), f!), inhalt!);
  assert.deepEqual(bildBefehl(a.ort("spiel"), undefined, { ...g, godot: true }), godot, "vor main.py");
  assert.deepEqual(bildBefehl(a.ort("spiel"), web, { ...g, godot: true }), godot, "vor Web");
  assert.deepEqual(bildBefehl(a.ort("spiel"), undefined, g), ["python3", "/arbeit/main.py"], "ohne Godot zählt project.godot nicht");
  mkdirSync(join(a.ort("start"), ".freedom"));
  writeFileSync(join(a.ort("start"), ".freedom", "start"), "");
  writeFileSync(join(a.ort("start"), "project.godot"), "");
  assert.deepEqual(bildBefehl(a.ort("start"), undefined, { ...g, godot: true }), ["/bin/sh", "/arbeit/.freedom/start"], "der eigene Startbefehl geht vor");
  symlinkSync(join(a.ort("spiel"), "project.godot"), join(a.ort("verweis"), "project.godot"));
  assert.equal(bildBefehl(a.ort("verweis"), undefined, { ...g, godot: true }), null, "ein Verweis zählt nicht");
  mkdirSync(join(a.ort("ordner"), "project.godot"));
  assert.equal(bildBefehl(a.ort("ordner"), undefined, { ...g, godot: true }), null, "ein Ordner auch nicht");
  // das Spiel, nie der Editor: X11, OpenGL in Software, ohne Ton, so groß wie das Bild
  assert.deepEqual(godotArgumente(g), ["--path", "/arbeit", "--display-driver", "x11", "--rendering-method", "gl_compatibility",
    "--rendering-driver", "opengl3", "--audio-driver", "Dummy", "--resolution", "800x600", "--position", "0,0"]);
});

test("VKk3a: Godot aus der Umgebung – GODOT als absoluter Pfad einer Datei, sonst die Orte; mit aus, ungültig oder ohne Fund keins", () => {
  const d = tmp("godot");
  const datei = join(d, "godot");
  writeFileSync(datei, "");
  assert.equal(godotAusUmgebung({ GODOT: datei }, []), datei);
  assert.equal(godotAusUmgebung({ GODOT: "aus" }, [datei]), null);
  assert.equal(godotAusUmgebung({ GODOT: "godot" }, [datei]), null, "relativ");
  assert.equal(godotAusUmgebung({ GODOT: `${d}/./godot` }, [datei]), null, "nicht in Normalform");
  assert.equal(godotAusUmgebung({ GODOT: d }, [datei]), null, "ein Ordner");
  assert.equal(godotAusUmgebung({ GODOT: join(d, "fehlt") }, [datei]), null, "ein falscher Pfad heißt nicht: dann eben woanders");
  assert.equal(godotAusUmgebung({ GODOT: " " }, [join(d, "fehlt"), datei]), datei, "leer wie nicht gesetzt");
  assert.equal(godotAusUmgebung({}, [join(d, "fehlt")]), null);
  assert.deepEqual(GODOT_ORTE, ["/usr/local/bin/godot", "/usr/bin/godot"], "das Docker-Bild legt es nach /usr/local/bin");
});

test("VKk3a: Start – erst der Import ohne Bildschirm, dann wird die Shell zum Spiel, auch wenn der Import scheitert", async () => {
  for (const importGeht of [true, false]) {
    const d = tmp("godot-start");
    const aufrufe = join(d, "aufrufe.txt");
    // ein Godot, das nur aufschreibt, womit es kam – und als Spiel seine Prozessnummer
    writeFileSync(join(d, "godot"), `#!/bin/sh\necho "$*" >> "${aufrufe}"\ncase "$*" in *--import*) exit ${importGeht ? 0 : 1};; esac\necho "$$" >> "${aufrufe}"\n`);
    chmodSync(join(d, "godot"), 0o755);
    const g = { breite: 320, hoehe: 200 };
    const sh = spawn("/bin/sh", ["-c", GODOT_START, join(d, "godot"), ...godotArgumente(g)], { stdio: "ignore" });
    const code = await new Promise((r) => sh.once("close", r));
    assert.equal(code, 0);
    assert.deepEqual(readFileSync(aufrufe, "utf8").trim().split("\n"),
      ["--headless --path /arbeit --import", godotArgumente(g).join(" "), String(sh.pid)], "exec: das Spiel ist der Prozess der Sandbox");
  }
});

test("VKi1: Windows-Programme – main.exe nur mit Wine, nach main.py und Godot, vor Web, nur eine echte Datei", () => {
  const a = ablage("exe", "beides", "godot", "verweis", "ordner");
  const g = { breite: 1024, hoehe: 768 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const mitWine = { ...g, wine: "/usr/bin/wine" };
  for (const [f, inhalt] of [["main.exe", "MZ"], ["index.html", "<p>"]]) writeFileSync(join(a.ort("exe"), f!), inhalt!);
  assert.deepEqual(bildBefehl(a.ort("exe"), web, mitWine), wineBefehl("/usr/bin/wine", g), "vor Web");
  assert.deepEqual(bildBefehl(a.ort("exe"), web, g), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")], "ohne Wine zählt main.exe nicht");
  for (const f of ["main.exe", "main.py"]) writeFileSync(join(a.ort("beides"), f), "");
  assert.deepEqual(bildBefehl(a.ort("beides"), undefined, mitWine), ["python3", "/arbeit/main.py"], "main.py geht vor");
  for (const f of ["main.exe", "project.godot"]) writeFileSync(join(a.ort("godot"), f), "");
  assert.equal(bildBefehl(a.ort("godot"), undefined, { ...mitWine, godot: true })![2], GODOT_START, "ein Godot-Projekt geht vor");
  symlinkSync(join(a.ort("exe"), "main.exe"), join(a.ort("verweis"), "main.exe"));
  assert.equal(bildBefehl(a.ort("verweis"), undefined, mitWine), null, "ein Verweis zählt nicht");
  mkdirSync(join(a.ort("ordner"), "main.exe"));
  assert.equal(bildBefehl(a.ort("ordner"), undefined, mitWine), null, "ein Ordner auch nicht");
});

test("VKi1: Wine – eigenes Präfix im Home der Sandbox, ohne Mono, Gecko und Menü, eine Arbeitsfläche so groß wie das Bild", () => {
  const b = wineBefehl("/usr/lib/wine/wine64", { breite: 800, hoehe: 600 });
  assert.deepEqual(b, ["/usr/bin/env", "WINEPREFIX=/home/agent/.wine", "WINEDEBUG=-all", "WINEDLLOVERRIDES=mscoree,mshtml=;winemenubuilder.exe=d",
    "/usr/lib/wine/wine64", "explorer", "/desktop=freedom,800x600", "Z:\\arbeit\\main.exe"]);
  assert.ok(!b.some((t) => t.startsWith("WINEPREFIX=/arbeit")), "das Präfix nie im Projekt");
});

test("VKi1: Wine aus der Distribution – nur die Orte unter /usr, WINE=aus schaltet ab, ein eigener Pfad zählt nicht", () => {
  const d = tmp("wine");
  const datei = join(d, "wine");
  writeFileSync(datei, "");
  assert.equal(wineAusUmgebung({}, [join(d, "fehlt"), datei]), datei);
  assert.equal(wineAusUmgebung({ WINE: "aus" }, [datei]), null);
  assert.equal(wineAusUmgebung({ WINE: datei }, [join(d, "fehlt")]), null, "kein eigener Pfad – Wine sind viele Dateien unter /usr");
  assert.equal(wineAusUmgebung({}, [d]), null, "ein Ordner ist kein Wine");
  assert.deepEqual(WINE_ORTE, ["/usr/lib/wine/wine64", "/usr/bin/wine"]);
  assert.ok(WINE_ORTE.every((o) => o.startsWith("/usr/")), "die Sandbox sieht /usr ohnehin – nichts weiter einbinden");
});

test("VKk4a: OpenSCAD-Modelle – main.scad nur mit OpenSCAD, nach main.py und main.exe, vor Web, nur eine echte Datei", () => {
  const a = ablage("modell", "beides", "exe", "verweis", "ordner");
  const g = { breite: 1024, hoehe: 768 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const mit = { ...g, openscad: "/usr/bin/openscad" };
  for (const [f, inhalt] of [["main.scad", "cube(1);"], ["index.html", "<p>"]]) writeFileSync(join(a.ort("modell"), f!), inhalt!);
  assert.deepEqual(bildBefehl(a.ort("modell"), web, mit), openscadBefehl("/usr/bin/openscad", g), "vor Web");
  assert.deepEqual(bildBefehl(a.ort("modell"), web, g), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")], "ohne OpenSCAD zählt main.scad nicht");
  for (const f of ["main.scad", "main.py"]) writeFileSync(join(a.ort("beides"), f), "");
  assert.deepEqual(bildBefehl(a.ort("beides"), undefined, mit), ["python3", "/arbeit/main.py"], "main.py geht vor");
  for (const f of ["main.scad", "main.exe"]) writeFileSync(join(a.ort("exe"), f), "");
  assert.deepEqual(bildBefehl(a.ort("exe"), undefined, { ...mit, wine: "/usr/bin/wine" }), wineBefehl("/usr/bin/wine", g), "main.exe geht vor");
  symlinkSync(join(a.ort("modell"), "main.scad"), join(a.ort("verweis"), "main.scad"));
  assert.equal(bildBefehl(a.ort("verweis"), undefined, mit), null, "ein Verweis zählt nicht");
  mkdirSync(join(a.ort("ordner"), "main.scad"));
  assert.equal(bildBefehl(a.ort("ordner"), undefined, mit), null, "ein Ordner auch nicht");
});

test("VKk4a: OpenSCAD aus der Distribution – nur die Orte unter /usr, OPENSCAD=aus schaltet ab, ein eigener Pfad zählt nicht", () => {
  const d = tmp("openscad");
  const datei = join(d, "openscad");
  writeFileSync(datei, "");
  assert.equal(openscadAusUmgebung({}, [join(d, "fehlt"), datei]), datei);
  assert.equal(openscadAusUmgebung({ OPENSCAD: "aus" }, [datei]), null);
  assert.equal(openscadAusUmgebung({ OPENSCAD: datei }, [join(d, "fehlt")]), null, "kein eigener Pfad – mit Qt und CGAL viele Dateien unter /usr");
  assert.equal(openscadAusUmgebung({}, [d]), null, "ein Ordner ist kein OpenSCAD");
  assert.deepEqual(OPENSCAD_ORTE, ["/usr/bin/openscad"]);
});

test("VKk4a: Start – Einstellungen im Home der Sandbox (Größe, Neuladen, ohne Customizer), dann wird die Shell zu OpenSCAD", async () => {
  const d = tmp("openscad-start");
  const heim = join(d, "heim");
  mkdirSync(heim);
  const aufrufe = join(d, "aufrufe.txt");
  // ein OpenSCAD, das nur aufschreibt, womit es kam, und seine Prozessnummer
  writeFileSync(join(d, "openscad"), `#!/bin/sh\necho "$*" >> "${aufrufe}"\necho "$$" >> "${aufrufe}"\n`);
  chmodSync(join(d, "openscad"), 0o755);
  const befehl = openscadBefehl(join(d, "openscad"), { breite: 800, hoehe: 600 });
  assert.deepEqual(befehl.slice(0, 3), ["/bin/sh", "-c", OPENSCAD_START]);
  const sh = spawn(befehl[0]!, befehl.slice(1), { stdio: "ignore", env: { PATH: process.env.PATH, HOME: heim } });
  assert.equal(await new Promise((r) => sh.once("close", r)), 0);
  assert.deepEqual(readFileSync(aufrufe, "utf8").trim().split("\n"), ["/arbeit/main.scad", String(sh.pid)], "exec: OpenSCAD ist der Prozess der Sandbox");
  assert.equal(readFileSync(join(heim, ".config", "OpenSCAD", "OpenSCAD.conf"), "utf8"),
    "[design]\nautoReload=true\n[view]\nhideCustomizer=true\nhideErrorLog=true\n[window]\nsize=@Size(800 600)\nposition=@Point(0 0)\n");
});

test("VKk4b: Schaltpläne – main.kicad_sch nur mit KiCad, nach main.scad, vor Web, nur eine echte Datei", () => {
  const a = ablage("plan", "scad", "verweis", "ordner");
  const g = { breite: 1024, hoehe: 768 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const mit = { ...g, kicad: "/usr/bin/eeschema" };
  for (const [f, inhalt] of [["main.kicad_sch", "(kicad_sch)"], ["index.html", "<p>"]]) writeFileSync(join(a.ort("plan"), f!), inhalt!);
  assert.deepEqual(bildBefehl(a.ort("plan"), web, mit), kicadBefehl("/usr/bin/eeschema"), "vor Web");
  assert.deepEqual(kicadBefehl("/usr/bin/eeschema"), ["/bin/sh", "-c", KICAD_START, "/usr/bin/eeschema", "/arbeit/main.kicad_sch"]);
  assert.deepEqual(bildBefehl(a.ort("plan"), web, g), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")], "ohne KiCad zählt main.kicad_sch nicht");
  for (const f of ["main.kicad_sch", "main.scad"]) writeFileSync(join(a.ort("scad"), f), "");
  assert.deepEqual(bildBefehl(a.ort("scad"), undefined, { ...mit, openscad: "/usr/bin/openscad" }), openscadBefehl("/usr/bin/openscad", g), "main.scad geht vor");
  symlinkSync(join(a.ort("plan"), "main.kicad_sch"), join(a.ort("verweis"), "main.kicad_sch"));
  assert.equal(bildBefehl(a.ort("verweis"), undefined, mit), null, "ein Verweis zählt nicht");
  mkdirSync(join(a.ort("ordner"), "main.kicad_sch"));
  assert.equal(bildBefehl(a.ort("ordner"), undefined, mit), null, "ein Ordner auch nicht");
});

test("VKk4b: KiCad aus der Distribution – nur die Orte unter /usr, KICAD=aus schaltet ab, ein eigener Pfad zählt nicht", () => {
  const d = tmp("kicad");
  const datei = join(d, "eeschema");
  writeFileSync(datei, "");
  assert.equal(kicadAusUmgebung({}, [join(d, "fehlt"), datei]), datei);
  assert.equal(kicadAusUmgebung({ KICAD: "aus" }, [datei]), null);
  assert.equal(kicadAusUmgebung({ KICAD: datei }, [join(d, "fehlt")]), null, "kein eigener Pfad – mit wxWidgets viele Dateien unter /usr");
  assert.equal(kicadAusUmgebung({}, [d]), null, "ein Ordner ist kein KiCad");
  assert.deepEqual(KICAD_ORTE, ["/usr/bin/eeschema"]);
});

test("VKk4b: Start – Einstellungen im Home, Sperrdatei weg, Neustart nach einer Änderung, hart nach drei Sekunden, Ende mit dem Editor", { timeout: 60_000 }, async () => {
  const d = tmp("kicad-start");
  const [heim, projekt] = [join(d, "heim"), join(d, "projekt")];
  for (const o of [heim, projekt]) mkdirSync(o);
  const plan = join(projekt, "main.kicad_sch");
  writeFileSync(plan, "(kicad_sch eins)");
  writeFileSync(join(projekt, "~main.kicad_sch.lck"), "{}");
  const aufrufe = join(d, "aufrufe.txt");
  // ein eeschema, das aufschreibt, womit es kam, und das Ende überhört (wie bei einer Rückfrage zum Speichern)
  writeFileSync(join(d, "eeschema"), `#!/bin/sh\ntrap '' TERM\necho "$* $$" >> "${aufrufe}"\nwhile :; do sleep 0.2; done\n`);
  chmodSync(join(d, "eeschema"), 0o755);
  const sh = spawn("/bin/sh", ["-c", KICAD_START, join(d, "eeschema"), plan], { stdio: "ignore", env: { PATH: process.env.PATH, HOME: heim } });
  const zu = new Promise((r) => sh.once("close", r));
  const zeilen = async (n: number) => {
    for (const bis = Date.now() + 20_000; Date.now() < bis;) {
      const z = existsSync(aufrufe) ? readFileSync(aufrufe, "utf8").trim().split("\n") : [];
      if (z.length >= n) return z;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`nicht ${n} Starts`);
  };
  try {
    const [erste] = await zeilen(1);
    assert.equal(erste!.split(" ")[0], plan);
    assert.ok(!existsSync(join(projekt, "~main.kicad_sch.lck")), "die alte Sperrdatei ist vor dem Start weg");
    for (const v of ["6.0", "7.0", "8.0", "9.0"]) {
      const ordner = join(heim, ".config", "kicad", v);
      assert.equal(readFileSync(join(ordner, "kicad_common.json"), "utf8"), "{}\n", `${v}: kein Willkommensdialog`);
      for (const t of ["sym-lib-table", "fp-lib-table"]) {
        const vorlage = `/usr/share/kicad/template/${t}`;
        assert.equal(readFileSync(join(ordner, t), "utf8"), existsSync(vorlage) ? readFileSync(vorlage, "utf8") : `(${t.replaceAll("-", "_")} (version 7))\n`, `${v}/${t}`);
      }
    }
    const pid1 = Number(erste!.split(" ").at(-1));
    writeFileSync(plan, "(kicad_sch zwei)");
    const t0 = Date.now();
    const [, zweite] = await zeilen(2);
    const pid2 = Number(zweite!.split(" ").at(-1));
    assert.notEqual(pid2, pid1, "ein neuer Editor");
    assert.ok(Date.now() - t0 >= 3000, "erst nach drei Sekunden hart beendet");
    assert.throws(() => process.kill(pid1, 0), "der alte ist weg");
    // endet der Editor von selbst, endet das Programm
    process.kill(pid2, "SIGKILL");
    assert.equal(await zu, 0);
  } finally {
    try { process.kill(sh.pid!, "SIGKILL"); } catch { /* schon weg */ }
  }
});

test("VKk5: Hinweise für den Motor – nur die Programme des Knotens, in der Reihenfolge von bildBefehl()", () => {
  const wenig = bildHinweise({});
  for (const d of [".freedom/start", "main.py"]) assert.ok(wenig.includes(`\`${d}\``), d);
  for (const d of ["project.godot", "main.exe", "main.scad", "main.kicad_sch", "main.blend", "main.odt", "index.html", "main.svg"]) assert.ok(!wenig.includes(d), `${d} nur mit dem Programm`);
  const alles = bildHinweise({ godot: true, wine: true, openscad: true, kicad: true, blender: true, libreoffice: true, browser: true, inkscape: true });
  const reihe = [".freedom/start", "project.godot", "main.py", "main.exe", "main.scad", "main.kicad_sch", "main.blend", "main.odt", "index.html", "main.svg"];
  const stellen = reihe.map((d) => alles.indexOf(`\`${d}\``));
  assert.ok(stellen.every((s) => s >= 0), "alle genannt");
  assert.deepEqual([...stellen].sort((x, y) => x - y), stellen, "in der genannten Reihenfolge");
  assert.ok(!/\.png|screenshot/i.test(alles), "keine Bilder aus dem Terminal versprechen");
  for (const d of LIBREOFFICE_DATEIEN) assert.ok(alles.includes(`\`${d}\``), `${d} genannt`);
  // Liegen alle Dateien ab der i-ten im Projekt, startet das Bild die i-te – wie die Hinweise sagen
  const g = { breite: 640, hoehe: 480 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const programme = {
    ...g, godot: true, wine: "/usr/bin/wine", openscad: "/usr/bin/openscad", kicad: "/usr/bin/eeschema", blender: "/usr/bin/blender", libreoffice: "/usr/bin/soffice",
    inkscape: "/usr/bin/inkscape",
  };
  const erwartet = [
    ["/bin/sh", "/arbeit/.freedom/start"], ["/bin/sh", "-c", GODOT_START, GODOT_IN_SANDBOX, ...godotArgumente(g)], ["python3", "/arbeit/main.py"],
    wineBefehl("/usr/bin/wine", g), openscadBefehl("/usr/bin/openscad", g), kicadBefehl("/usr/bin/eeschema"), blenderBefehl("/usr/bin/blender"),
    libreofficeBefehl("/usr/bin/soffice", "main.odt"), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")], inkscapeBefehl("/usr/bin/inkscape"),
  ];
  for (let i = 0; i < reihe.length; i++) {
    const a = ablage("reihe");
    for (const d of reihe.slice(i)) {
      mkdirSync(dirname(join(a.ort("reihe"), d)), { recursive: true });
      writeFileSync(join(a.ort("reihe"), d), "");
    }
    assert.deepEqual(bildBefehl(a.ort("reihe"), web, programme), erwartet[i], reihe[i]);
  }
});

test("VKk4c: Szenen – main.blend nur mit Blender, nach main.kicad_sch, vor Web, nur eine echte Datei", () => {
  const a = ablage("szene", "plan", "verweis", "ordner");
  const g = { breite: 1024, hoehe: 768 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const mit = { ...g, blender: "/usr/bin/blender" };
  for (const [f, inhalt] of [["main.blend", "BLENDER"], ["index.html", "<p>"]]) writeFileSync(join(a.ort("szene"), f!), inhalt!);
  assert.deepEqual(bildBefehl(a.ort("szene"), web, mit), blenderBefehl("/usr/bin/blender"), "vor Web");
  assert.deepEqual(blenderBefehl("/usr/bin/blender"), ["/bin/sh", "-c", BLENDER_START, "/usr/bin/blender", "/arbeit/main.blend"]);
  assert.deepEqual(bildBefehl(a.ort("szene"), web, g), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")], "ohne Blender zählt main.blend nicht");
  for (const f of ["main.blend", "main.kicad_sch"]) writeFileSync(join(a.ort("plan"), f), "");
  assert.deepEqual(bildBefehl(a.ort("plan"), undefined, { ...mit, kicad: "/usr/bin/eeschema" }), kicadBefehl("/usr/bin/eeschema"), "main.kicad_sch geht vor");
  symlinkSync(join(a.ort("szene"), "main.blend"), join(a.ort("verweis"), "main.blend"));
  assert.equal(bildBefehl(a.ort("verweis"), undefined, mit), null, "ein Verweis zählt nicht");
  mkdirSync(join(a.ort("ordner"), "main.blend"));
  assert.equal(bildBefehl(a.ort("ordner"), undefined, mit), null, "ein Ordner auch nicht");
});

test("VKk4c: Blender aus der Distribution – nur die Orte unter /usr, BLENDER=aus schaltet ab, ein eigener Pfad zählt nicht", () => {
  const d = tmp("blender");
  const datei = join(d, "blender");
  writeFileSync(datei, "");
  assert.equal(blenderAusUmgebung({}, [join(d, "fehlt"), datei]), datei);
  assert.equal(blenderAusUmgebung({ BLENDER: "aus" }, [datei]), null);
  assert.equal(blenderAusUmgebung({ BLENDER: datei }, [join(d, "fehlt")]), null, "kein eigener Pfad – mit Python und Bibliotheken viele Dateien unter /usr");
  assert.equal(blenderAusUmgebung({}, [d]), null, "ein Ordner ist kein Blender");
  assert.deepEqual(BLENDER_ORTE, ["/usr/bin/blender"]);
});

test("VKk4c: Start – erst die Einstellungen ohne Bildschirm und ohne Begrüßung, dann Blender, neu nach jeder Änderung", { timeout: 60_000 }, async () => {
  const d = tmp("blender-start");
  const szene = join(d, "main.blend");
  writeFileSync(szene, "eins");
  const aufrufe = join(d, "aufrufe.txt");
  // ein Blender, das aufschreibt, womit es kam; mit -b endet es gleich (Einstellungen), sonst läuft es wie das Fenster
  writeFileSync(join(d, "blender"), `#!/bin/sh\necho "$* $$" >> "${aufrufe}"\n[ "$1" = "-b" ] && exit 0\nexec sleep 600\n`);
  chmodSync(join(d, "blender"), 0o755);
  const sh = spawn("/bin/sh", ["-c", BLENDER_START, join(d, "blender"), szene], { stdio: "ignore" });
  const zu = new Promise((r) => sh.once("close", r));
  const zeilen = async (n: number) => {
    for (const bis = Date.now() + 20_000; Date.now() < bis;) {
      const z = existsSync(aufrufe) ? readFileSync(aufrufe, "utf8").trim().split("\n") : [];
      if (z.length >= n) return z;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`nicht ${n} Aufrufe`);
  };
  try {
    const [einstellungen, erste] = await zeilen(2);
    assert.match(einstellungen!, /^-b --factory-startup --python-expr import bpy; bpy\.context\.preferences\.view\.show_splash = False; bpy\.ops\.wm\.save_userpref\(\) \d+$/,
      "ohne Bildschirm, ohne Begrüßung gespeichert");
    assert.equal(erste!.split(" ")[0], szene);
    writeFileSync(szene, "zwei");
    const [, , zweite] = await zeilen(3);
    assert.equal(zweite!.split(" ")[0], szene, "neu gestartet, die Einstellungen nur einmal");
    process.kill(Number(zweite!.split(" ").at(-1)), "SIGKILL");
    assert.equal(await zu, 0);
  } finally {
    try { process.kill(sh.pid!, "SIGKILL"); } catch { /* schon weg */ }
  }
});

test("VKk4c: Blender im Bildstrom – main.blend in der Sandbox des Programms, nichts weiter eingebunden; ohne Blender kein Programm", async () => {
  const a = ablage("szene");
  writeFileSync(join(a.ort("szene"), "main.blend"), "BLENDER");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, blender: "/usr/bin/blender" });
  try {
    assert.equal(await b.starte("szene", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    const programm = starts[1]!;
    assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", ...blenderBefehl("/usr/bin/blender")]);
    assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms");
    assert.equal(programm.ort.gpu, undefined);
  } finally {
    b.beendeAlle();
  }
  const ohne = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: attrappe(() => JSON.stringify({ antwort: ANTWORT })).starte });
  await assert.rejects(ohne.starte("szene", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
});

test("VKk4d: Dokumente – die erste aus LIBREOFFICE_DATEIEN nur mit LibreOffice, nach main.blend, vor Web, nur echte Dateien", () => {
  const a = ablage("dok", "reihe", "szene", "verweis", "ordner");
  const g = { breite: 1024, hoehe: 768 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const mit = { ...g, libreoffice: "/usr/bin/soffice" };
  for (const [f, inhalt] of [["main.fodt", "<office:document/>"], ["index.html", "<p>"]]) writeFileSync(join(a.ort("dok"), f!), inhalt!);
  assert.deepEqual(bildBefehl(a.ort("dok"), web, mit), libreofficeBefehl("/usr/bin/soffice", "main.fodt"), "vor Web");
  assert.deepEqual(libreofficeBefehl("/usr/bin/soffice", "main.fodt"), ["/bin/sh", "-c", LIBREOFFICE_START, "/usr/bin/soffice", "/arbeit/main.fodt", X11_UMWEG]);
  assert.deepEqual(bildBefehl(a.ort("dok"), web, g), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")], "ohne LibreOffice zählt kein Dokument");
  // liegen alle ab der i-ten im Projekt, zeigt das Bild die i-te
  assert.equal(LIBREOFFICE_DATEIEN.length, 11);
  for (let i = LIBREOFFICE_DATEIEN.length - 1; i >= 0; i--) {
    writeFileSync(join(a.ort("reihe"), LIBREOFFICE_DATEIEN[i]!), "");
    assert.deepEqual(bildBefehl(a.ort("reihe"), undefined, mit), libreofficeBefehl("/usr/bin/soffice", LIBREOFFICE_DATEIEN[i]!), LIBREOFFICE_DATEIEN[i]);
  }
  for (const f of ["main.odt", "main.blend"]) writeFileSync(join(a.ort("szene"), f), "");
  assert.deepEqual(bildBefehl(a.ort("szene"), undefined, { ...mit, blender: "/usr/bin/blender" }), blenderBefehl("/usr/bin/blender"), "main.blend geht vor");
  // ein Verweis oder ein Ordner zählt nicht – dann die nächste echte Datei
  symlinkSync(join(a.ort("dok"), "main.fodt"), join(a.ort("verweis"), "main.odt"));
  assert.equal(bildBefehl(a.ort("verweis"), undefined, mit), null, "ein Verweis zählt nicht");
  writeFileSync(join(a.ort("verweis"), "main.docx"), "");
  assert.deepEqual(bildBefehl(a.ort("verweis"), undefined, mit), libreofficeBefehl("/usr/bin/soffice", "main.docx"), "die nächste echte Datei");
  mkdirSync(join(a.ort("ordner"), "main.odt"));
  assert.equal(bildBefehl(a.ort("ordner"), undefined, mit), null, "ein Ordner auch nicht");
});

test("VKk4d: LibreOffice aus der Distribution – nur die Orte unter /usr, LIBREOFFICE=aus schaltet ab, ein eigener Pfad zählt nicht", () => {
  const d = tmp("libreoffice");
  const datei = join(d, "soffice");
  writeFileSync(datei, "");
  assert.equal(libreofficeAusUmgebung({}, [join(d, "fehlt"), datei]), datei);
  assert.equal(libreofficeAusUmgebung({ LIBREOFFICE: "aus" }, [datei]), null);
  assert.equal(libreofficeAusUmgebung({ LIBREOFFICE: datei }, [join(d, "fehlt")]), null, "kein eigener Pfad – LibreOffice sind viele Dateien unter /usr");
  assert.equal(libreofficeAusUmgebung({}, [d]), null, "ein Ordner ist kein LibreOffice");
  assert.deepEqual(LIBREOFFICE_ORTE, ["/usr/bin/soffice"]);
});

test("VKk4d: Start – Einstellungen ohne Tipp und ohne Sperrdatei, über X11, ohne Wiederherstellung, neu nach jeder Änderung", { timeout: 60_000 }, async () => {
  const d = tmp("libreoffice-start");
  const heim = join(d, "heim");
  mkdirSync(heim);
  const dok = join(d, "main.fodt");
  writeFileSync(dok, "eins");
  const aufrufe = join(d, "aufrufe.txt");
  // ein soffice, das aufschreibt, womit es kam, und läuft wie das Fenster
  writeFileSync(join(d, "soffice"), `#!/bin/sh\necho "$SAL_USE_VCLPLUGIN $* $$" >> "${aufrufe}"\nexec sleep 600\n`);
  chmodSync(join(d, "soffice"), 0o755);
  const sh = spawn("/bin/sh", ["-c", LIBREOFFICE_START, join(d, "soffice"), dok], { stdio: "ignore", env: { PATH: process.env.PATH, HOME: heim } });
  const zu = new Promise((r) => sh.once("close", r));
  const zeilen = async (n: number) => {
    for (const bis = Date.now() + 20_000; Date.now() < bis;) {
      const z = existsSync(aufrufe) ? readFileSync(aufrufe, "utf8").trim().split("\n") : [];
      if (z.length >= n) return z;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`nicht ${n} Aufrufe`);
  };
  try {
    const [erste] = await zeilen(1);
    assert.match(erste!, new RegExp(`^gen --norestore --nologo ${dok} \\d+$`), "über X11, ohne Wiederherstellung");
    const xcu = readFileSync(join(heim, ".config", "libreoffice", "4", "user", "registrymodifications.xcu"), "utf8");
    for (const n of ["ShowTipOfTheDay", "UseLocking"]) {
      assert.match(xcu, new RegExp(`<item oor:path="/org\\.openoffice\\.Office\\.Common/Misc"><prop oor:name="${n}" oor:op="fuse"><value>false</value></prop></item>`), n);
    }
    writeFileSync(dok, "zwei");
    const [, zweite] = await zeilen(2);
    assert.notEqual(zweite!.split(" ").at(-1), erste!.split(" ").at(-1), "neu gestartet");
    process.kill(Number(zweite!.split(" ").at(-1)), "SIGKILL");
    assert.equal(await zu, 0);
  } finally {
    try { process.kill(sh.pid!, "SIGKILL"); } catch { /* schon weg */ }
  }
});

test("VKk4d: LibreOffice im Bildstrom – das Dokument in der Sandbox des Programms, nichts weiter eingebunden; ohne LibreOffice kein Programm", async () => {
  const a = ablage("dok");
  writeFileSync(join(a.ort("dok"), "main.xlsx"), "PK");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, libreoffice: "/usr/bin/soffice" });
  try {
    assert.equal(await b.starte("dok", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    const programm = starts[1]!;
    assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", ...libreofficeBefehl("/usr/bin/soffice", "main.xlsx")]);
    assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms – /etc/libreoffice bringt die Sandbox mit");
    assert.equal(programm.ort.gpu, undefined);
  } finally {
    b.beendeAlle();
  }
  const ohne = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: attrappe(() => JSON.stringify({ antwort: ANTWORT })).starte });
  await assert.rejects(ohne.starte("dok", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
});

test("VKk4e: Zeichnungen – main.svg nur mit Inkscape, nach Web (Dev-Server und index.html gehen vor), auch ohne Browser, nur eine echte Datei", () => {
  const a = ablage("zeichnung", "web", "dev", "verweis", "ordner");
  const g = { breite: 1024, hoehe: 768 };
  const web = { browser: "/usr/lib/chromium/chromium", ...g };
  const mit = { ...g, inkscape: "/usr/bin/inkscape" };
  writeFileSync(join(a.ort("zeichnung"), "main.svg"), "<svg/>");
  assert.deepEqual(bildBefehl(a.ort("zeichnung"), web, mit), inkscapeBefehl("/usr/bin/inkscape"));
  assert.deepEqual(bildBefehl(a.ort("zeichnung"), undefined, mit), inkscapeBefehl("/usr/bin/inkscape"), "auch ohne Browser");
  assert.deepEqual(inkscapeBefehl("/usr/bin/inkscape"), ["/bin/sh", "-c", INKSCAPE_START, "/usr/bin/inkscape", "/arbeit/main.svg"]);
  assert.equal(bildBefehl(a.ort("zeichnung"), web, g), null, "ohne Inkscape zählt main.svg nicht");
  // ein Logo im Web-Projekt verdrängt die Seite nicht
  for (const [f, inhalt] of [["main.svg", "<svg/>"], ["index.html", "<p>"]]) writeFileSync(join(a.ort("web"), f!), inhalt!);
  assert.deepEqual(bildBefehl(a.ort("web"), web, mit), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")], "index.html geht vor");
  assert.deepEqual(bildBefehl(a.ort("web"), undefined, mit), inkscapeBefehl("/usr/bin/inkscape"), "ohne Browser bleibt die Zeichnung");
  for (const [f, inhalt] of [["main.svg", "<svg/>"], ["package.json", JSON.stringify({ scripts: { dev: "vite" } })]]) writeFileSync(join(a.ort("dev"), f!), inhalt!);
  assert.equal(bildBefehl(a.ort("dev"), web, mit)?.[2], WEB_DEV_START, "der Dev-Server geht vor");
  symlinkSync(join(a.ort("zeichnung"), "main.svg"), join(a.ort("verweis"), "main.svg"));
  assert.equal(bildBefehl(a.ort("verweis"), undefined, mit), null, "ein Verweis zählt nicht");
  mkdirSync(join(a.ort("ordner"), "main.svg"));
  assert.equal(bildBefehl(a.ort("ordner"), undefined, mit), null, "ein Ordner auch nicht");
});

test("VKk4e: Inkscape aus der Distribution – nur die Orte unter /usr, INKSCAPE=aus schaltet ab, ein eigener Pfad zählt nicht", () => {
  const d = tmp("inkscape");
  const datei = join(d, "inkscape");
  writeFileSync(datei, "");
  assert.equal(inkscapeAusUmgebung({}, [join(d, "fehlt"), datei]), datei);
  assert.equal(inkscapeAusUmgebung({ INKSCAPE: "aus" }, [datei]), null);
  assert.equal(inkscapeAusUmgebung({ INKSCAPE: datei }, [join(d, "fehlt")]), null, "kein eigener Pfad – mit GTK viele Dateien unter /usr");
  assert.equal(inkscapeAusUmgebung({}, [d]), null, "ein Ordner ist kein Inkscape");
  assert.deepEqual(INKSCAPE_ORTE, ["/usr/bin/inkscape"]);
});

test("VKk4e: Start – Inkscape mit der Datei, neu nach jeder Änderung, Ende mit dem Programm", { timeout: 60_000 }, async () => {
  const d = tmp("inkscape-start");
  const svg = join(d, "main.svg");
  writeFileSync(svg, "eins");
  const aufrufe = join(d, "aufrufe.txt");
  writeFileSync(join(d, "inkscape"), `#!/bin/sh\necho "$* $$" >> "${aufrufe}"\nexec sleep 600\n`);
  chmodSync(join(d, "inkscape"), 0o755);
  const sh = spawn("/bin/sh", ["-c", INKSCAPE_START, join(d, "inkscape"), svg], { stdio: "ignore" });
  const zu = new Promise((r) => sh.once("close", r));
  const zeilen = async (n: number) => {
    for (const bis = Date.now() + 20_000; Date.now() < bis;) {
      const z = existsSync(aufrufe) ? readFileSync(aufrufe, "utf8").trim().split("\n") : [];
      if (z.length >= n) return z;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`nicht ${n} Aufrufe`);
  };
  try {
    const [erste] = await zeilen(1);
    assert.match(erste!, new RegExp(`^${svg} \\d+$`), "nur die Datei");
    writeFileSync(svg, "zwei");
    const [, zweite] = await zeilen(2);
    assert.notEqual(zweite!.split(" ").at(-1), erste!.split(" ").at(-1), "neu gestartet");
    process.kill(Number(zweite!.split(" ").at(-1)), "SIGKILL");
    assert.equal(await zu, 0);
  } finally {
    try { process.kill(sh.pid!, "SIGKILL"); } catch { /* schon weg */ }
  }
});

test("VKk4e: Inkscape im Bildstrom – main.svg in der Sandbox des Programms, nichts weiter eingebunden; ohne Inkscape kein Programm", async () => {
  const a = ablage("zeichnung");
  writeFileSync(join(a.ort("zeichnung"), "main.svg"), "<svg/>");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, inkscape: "/usr/bin/inkscape" });
  try {
    assert.equal(await b.starte("zeichnung", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    const programm = starts[1]!;
    assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", ...inkscapeBefehl("/usr/bin/inkscape")]);
    assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms");
    assert.equal(programm.ort.gpu, undefined);
  } finally {
    b.beendeAlle();
  }
  const ohne = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: attrappe(() => JSON.stringify({ antwort: ANTWORT })).starte });
  await assert.rejects(ohne.starte("zeichnung", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
});

test("VKk4b: KiCad im Bildstrom – main.kicad_sch in der Sandbox des Programms, nichts weiter eingebunden; ohne KiCad kein Programm", async () => {
  const a = ablage("plan");
  writeFileSync(join(a.ort("plan"), "main.kicad_sch"), "(kicad_sch)");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, kicad: "/usr/bin/eeschema" });
  try {
    assert.equal(await b.starte("plan", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    const programm = starts[1]!;
    assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", ...kicadBefehl("/usr/bin/eeschema")]);
    assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms");
    assert.equal(programm.ort.gpu, undefined);
  } finally {
    b.beendeAlle();
  }
  const ohne = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: attrappe(() => JSON.stringify({ antwort: ANTWORT })).starte });
  await assert.rejects(ohne.starte("plan", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
});

test("VKk4a: OpenSCAD im Bildstrom – main.scad in der Sandbox des Programms, nichts weiter eingebunden; ohne OpenSCAD kein Programm", async () => {
  const a = ablage("modell");
  writeFileSync(join(a.ort("modell"), "main.scad"), "cube(1);");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, openscad: "/usr/bin/openscad" });
  try {
    assert.equal(await b.starte("modell", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    const programm = starts[1]!;
    assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", ...openscadBefehl("/usr/bin/openscad", { breite: 640, hoehe: 480 })]);
    assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms");
    assert.equal(programm.ort.gpu, undefined, "die Vorschau rechnet in Software");
  } finally {
    b.beendeAlle();
  }
  const ohne = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: attrappe(() => JSON.stringify({ antwort: ANTWORT })).starte });
  await assert.rejects(ohne.starte("modell", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
});

/** Statt bubblewrap: merkt sich, was gestartet würde, und spielt die Bild-Sandbox nach (`antworte`). */
function attrappe(antworte: (eingabe: { turn: string; angebot: string }) => string | null,
  o: { programmEndet?: boolean; verzoegerung?: number; ereignisse?: string[] } = {}) {
  const starts: Array<{ befehl: readonly string[]; ort: Parameters<typeof sandboxDienst>[1]; beendet: boolean }> = [];
  const starte = ((befehl, ort) => {
    const eintrag = { befehl, ort, beendet: false };
    starts.push(eintrag);
    let fertig!: () => void;
    const ende = new Promise<void>((r) => { fertig = r; });
    const beende = () => { eintrag.beendet = true; fertig(); };
    if (!ort.mitEinAusgabe) {
      o.ereignisse?.push("programm");
      if (o.programmEndet) setTimeout(beende, 10);
      return { ende, beende };
    }
    const ein = new PassThrough(), aus = new PassThrough();
    void ende.then(() => aus.end());
    let text = "";
    ein.on("data", (b: Buffer) => {
      text += b.toString();
      if (!text.endsWith("\n")) return;
      // der Bildschirm steht: Socket im geteilten Ordner
      writeFileSync(join(ort.schreibbar!.find((s) => s.ziel === BILD_IN_SANDBOX.x11)!.quelle, "X99"), "");
      const z = antworte(JSON.parse(text));
      setTimeout(() => {
        o.ereignisse?.push("antwort");
        if (z === null) beende();
        else aus.write(`${z}\n`);
      }, o.verzoegerung ?? 30);
    });
    return { ende, beende, ein, aus };
  }) as typeof sandboxDienst;
  return { starte, starts };
}

const abgelehnt = (fall: string) => (e: unknown) => e instanceof CodeAbgelehnt && e.fall === fall;

test("VKi1: das Programm erst nach der Antwort – ein langsamer Start hält sie nicht auf; ohne Antwort gar kein Programm", async () => {
  const a = ablage("spiel");
  writeFileSync(join(a.ort("spiel"), "main.py"), "");
  // die Bild-Sandbox braucht für die Antwort länger, als der Bildschirm zum Stehen braucht
  const ereignisse: string[] = [];
  const ok = attrappe(() => JSON.stringify({ antwort: ANTWORT }), { verzoegerung: 300, ereignisse });
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: ok.starte });
  try {
    assert.equal(await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    assert.deepEqual(ereignisse, ["antwort", "programm"]);
  } finally {
    b.beendeAlle();
  }
  const ohne = attrappe(() => JSON.stringify({ fehler: "gstreamer" }), { verzoegerung: 300 });
  await assert.rejects(new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: ohne.starte }).starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }),
    abgelehnt("code-bild-fehler"));
  assert.equal(ohne.starts.length, 1, "nur die Bild-Sandbox – kein Programm ohne Antwort");
});

test("VKi1: Wine im Bildstrom – main.exe in der Sandbox des Programms, nichts weiter eingebunden; ohne Wine kein Programm", async () => {
  const a = ablage("exe");
  writeFileSync(join(a.ort("exe"), "main.exe"), "MZ");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, wine: "/usr/bin/wine", arch: "x64" }); // ARM64: VKi2
  try {
    assert.equal(await b.starte("exe", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    const programm = starts[1]!;
    assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", ...wineBefehl("/usr/bin/wine", { breite: 640, hoehe: 480 })]);
    assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms");
    assert.equal(programm.ort.gpu, undefined);
  } finally {
    b.beendeAlle();
  }
  const ohne = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: attrappe(() => JSON.stringify({ antwort: ANTWORT })).starte });
  await assert.rejects(ohne.starte("exe", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
});

test("VKi2: auf ARM64 liest Wine die Angaben zum Prozessor – nur lesbar, nur für Wine, auf x86_64 nichts", async () => {
  const cpu = { quelle: "/sys/devices/system/cpu", ziel: "/sys/devices/system/cpu" };
  assert.deepEqual(wineLesbar("x64"), []);
  assert.deepEqual(wineLesbar("arm64"), existsSync(cpu.quelle) ? [cpu] : []);
  const a = ablage("exe", "py");
  writeFileSync(join(a.ort("exe"), "main.exe"), "MZ");
  writeFileSync(join(a.ort("py"), "main.py"), "");
  for (const [arch, projekt, erwartet] of [["arm64", "exe", true], ["arm64", "py", false], ["x64", "exe", false]] as const) {
    const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
    const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, wine: "/usr/bin/wine", arch });
    try {
      await b.starte(projekt, ANGEBOT, { breite: 640, hoehe: 480 });
      const [bild, programm] = starts as [typeof starts[0], typeof starts[0]];
      const hat = programm.ort.nurLesbar!.some((x) => x.ziel === cpu.ziel);
      assert.equal(hat, erwartet && existsSync(cpu.quelle), `${arch} ${projekt}`);
      assert.ok(!bild.ort.nurLesbar!.some((x) => x.ziel === cpu.ziel), "nie für die Bild-Sandbox");
    } finally {
      b.beendeAlle();
    }
  }
});

test("VKk3a: Godot nur für das Programm – die eine Datei nur lesbar, nie für die Bild-Sandbox; ohne Godot kein Programm", async () => {
  const a = ablage("spiel");
  writeFileSync(join(a.ort("spiel"), "project.godot"), "config_version=5\n");
  const godot = join(tmp("godot-datei"), "godot");
  writeFileSync(godot, "");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, godot });
  try {
    assert.equal(await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
    const [bild, programm] = starts as [typeof starts[0], typeof starts[0]];
    assert.deepEqual(programm.befehl,
      ["/usr/bin/env", "DISPLAY=:99", "/bin/sh", "-c", GODOT_START, GODOT_IN_SANDBOX, ...godotArgumente({ breite: 640, hoehe: 480 })]);
    assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11, GODOT_IN_SANDBOX]);
    assert.equal(programm.ort.nurLesbar!.find((s) => s.ziel === GODOT_IN_SANDBOX)!.quelle, godot, "die Datei, nie ihr Ordner");
    assert.equal(programm.ort.gpu, undefined, "gerechnet in Software – die GPU nie für Code des Projekts");
    assert.ok(!bild.ort.nurLesbar!.some((s) => s.quelle === godot || s.ziel === GODOT_IN_SANDBOX), "nicht in der Bild-Sandbox");
  } finally {
    b.beendeAlle();
  }
  const ohne = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: attrappe(() => JSON.stringify({ antwort: ANTWORT })).starte });
  await assert.rejects(ohne.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
});

test("VKg2a2: zwei Sandboxen – Zugang, Tunnel und Antwort nur im Bild, das Programm sieht nur den Bildschirm", async () => {
  const a = ablage("spiel");
  writeFileSync(join(a.ort("spiel"), "main.py"), "");
  let eingabe: { turn: string; angebot: string } | undefined;
  const { starte, starts } = attrappe((e) => { eingabe = e; return JSON.stringify({ antwort: ANTWORT }); });
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte });
  assert.equal(await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
  assert.equal(starts.length, 2);
  const [bild, programm] = starts as [typeof starts[0], typeof starts[0]];
  assert.deepEqual(bild.befehl, ["python3", "/freedom/motor.py", "/bild/turn.sock", "3478", "--", "python3", "/freedom/bild.py", "640", "480", "vp8"]);
  assert.equal(bild.ort.mitEinAusgabe, true);
  assert.equal(bild.ort.gpu, undefined, "ohne NVENC keine GPU");
  assert.ok(bild.ort.nurLesbar!.some((s) => s.ziel === BILD_IN_SANDBOX.ordner && existsSync(join(s.quelle, "turn.sock"))), "der Tunnel nur in der Bild-Sandbox");
  assert.notEqual(bild.ort.arbeit, a.ort("spiel"), "das Projekt nicht in der Bild-Sandbox");
  assert.match(eingabe!.turn, /^turn:\/\/\d+%3A[A-Za-z0-9_-]+:[A-Za-z0-9%]+@127\.0\.0\.1:3478\?transport=tcp$/);
  assert.equal(eingabe!.angebot, ANGEBOT);
  assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", "python3", "/arbeit/main.py"]);
  assert.equal(programm.ort.arbeit, a.ort("spiel"));
  assert.equal(programm.ort.mitEinAusgabe, undefined, "keine Ein- und Ausgabe für Code des Projekts");
  assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms");
  assert.equal(programm.ort.schreibbar, undefined);
  assert.equal(b.hat("spiel"), true);
  assert.equal(b.beende("spiel"), true);
  assert.equal(bild.beendet && programm.beendet, true);
  assert.equal(b.beende("spiel"), false);
});

test("VKg2c2: Kodierer – H.264 über NVENC nur, wo es ihn gibt; die GPU nur für die Bild-Sandbox, nie für das Programm", async () => {
  assert.equal(bildKodierer({}, false), "vp8");
  assert.equal(bildKodierer({}, true), "h264", "mit NVENC von selbst H.264");
  assert.equal(bildKodierer({ BILD_KODIERER: "vp8" }, true), "vp8");
  assert.equal(bildKodierer({ BILD_KODIERER: " Auto " }, true), "h264");
  assert.equal(bildKodierer({ BILD_KODIERER: "auto" }, false), "vp8");
  for (const falsch of ["h264", "av1", "nvenc"]) assert.equal(bildKodierer({ BILD_KODIERER: falsch }, true), null, falsch);
  assert.equal(await nvencDa("python3", "/dev/gibt-es-nicht"), false, "ohne Gerät nie NVENC");
  const a = ablage("spiel");
  writeFileSync(join(a.ort("spiel"), "main.py"), "");
  const { starte, starts } = attrappe(() => JSON.stringify({ antwort: ANTWORT, kodierer: "nvh264enc" }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte, kodierer: "h264", gpu: true });
  assert.equal(await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
  const [bild, programm] = starts as [typeof starts[0], typeof starts[0]];
  assert.equal(bild.befehl.at(-1), "h264");
  assert.equal(bild.ort.gpu, true);
  assert.equal(programm.ort.gpu, undefined, "der Code des Projekts bekommt die GPU nie");
  b.beendeAlle();
});

test("VKg2a2: Ablehnungen – fremde Kandidaten, kein Programm, Fehler im Bild, Programm endet, zu viele", async () => {
  const a = ablage("spiel", "leer", "zwei", "drei");
  for (const p of ["spiel", "zwei", "drei"]) writeFileSync(join(a.ort(p), "main.py"), "");
  const ok = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: ok.starte });
  for (const falsch of [sdp("candidate:1 1 udp 2122260223 192.168.1.5 50000 typ host"), sdp(), "kein sdp"]) {
    await assert.rejects(b.starte("spiel", falsch, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-fehler"));
  }
  await assert.rejects(b.starte("leer", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
  assert.equal(ok.starts.length, 0, "nichts gestartet");

  for (const [name, antwort] of [["fehler", JSON.stringify({ fehler: "gstreamer" })], ["host-kandidat", JSON.stringify({ antwort: sdp("candidate:1 1 udp 1 10.0.0.2 5 typ host") })], ["kaputt", "{"], ["ende", null]] as const) {
    const x = attrappe(() => antwort);
    await assert.rejects(new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: x.starte }).starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-fehler"), name);
    assert.ok(x.starts.every((s) => s.beendet), `${name}: alles beendet`);
  }
  const endet = attrappe(() => null, { programmEndet: true });
  await assert.rejects(new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: endet.starte }).starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-fehler"));

  // je Projekt eins – ein neues Angebot ersetzt das alte; auf dem Knoten höchstens zwei
  await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 });
  await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 });
  assert.equal(ok.starts.filter((s) => s.beendet).length, 2, "das erste Bild samt Programm beendet");
  await b.starte("zwei", ANGEBOT, { breite: 640, hoehe: 480 });
  assert.equal(BILD_GRENZEN.gesamt, 2);
  await assert.rejects(b.starte("drei", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-zu-viele"));
  b.beendeAlle();
  assert.equal(b.hat("spiel") || b.hat("zwei"), false);
});

test("VKg2a2: über den Knoten – Angebot und Antwort nur versiegelt, ohne Bild code-bild-aus, bild-ende", async () => {
  const relay = new MemoryRelay(`mem://bild-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair(), k = neueKopplung(kp.pk);
  const a = ablage("spiel");
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], projekte: a,
  }, pool);
  const frage = async (aktion: CodeAktion) => {
    const s = new LocalSigner(generateKeypair().sk);
    await pool.publish((await baueCodeAuftrag({ sitzung: s, kopplung: k, aktion })).wrap);
    await provider.pollOnce();
    return (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s))))
      .flatMap((x) => (x.ok ? [x.response] : []));
  };
  const bild: CodeAktion = { aktion: "bild", projekt: "spiel", sdp: ANGEBOT, breite: 1280, hoehe: 720 };
  assert.equal(getTag((await frage(bild)).find((r) => r.kind === 7000)!, "fall"), "code-bild-aus");
  const gesehen: unknown[] = [];
  (provider as unknown as { cfg: { bild?: unknown } }).cfg.bild = {
    starte: async (...x: unknown[]) => { gesehen.push(x); return ANTWORT; },
    beende: (p: string) => p === "spiel",
  };
  const an = leseCodeAntwort((await frage(bild)).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "bild");
  assert.deepEqual(an, { aktion: "bild", sdp: ANTWORT });
  assert.deepEqual(gesehen, [["spiel", ANGEBOT, { breite: 1280, hoehe: 720 }]]);
  const ende = leseCodeAntwort((await frage({ aktion: "bild-ende", projekt: "spiel" })).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "bild-ende");
  assert.deepEqual(ende, { aktion: "bild-ende", ok: true });
  assert.equal((await relay.query({ kinds: [7000, KIND_DVM_KNOTEN_CODE + 1000] })).length, 0, "nie offen");
});

// --- Ende zu Ende: echtes bubblewrap, Xvfb, GStreamer und coturn ---------------------------------------------------

const pruefung = await pruefeSandbox();
const hat = (p: string) => new Promise<boolean>((r) => execFile(p, ["-h"], (e) => r(!e || (e as NodeJS.ErrnoException).code !== "ENOENT")));
/** Ein Python mit PyGObject, GStreamer und python-xlib – je nach Rechner nicht `python3` (hier 3.11 ohne gi). */
let python: string | undefined;
for (const p of ["/usr/bin/python3", "/usr/bin/python3.12", "/usr/bin/python3.11"]) {
  if (existsSync(p) && (await bildFehlt(p)) === null) {
    python = p;
    break;
  }
}
const ohne = !pruefung.ok ? `Sandbox geht hier nicht (${pruefung.fall})`
  : !python ? "GStreamer, PyGObject, python-xlib oder Xvfb fehlen"
  : !((await hat("turnserver"))) ? "coturn fehlt" : false;

const freierPort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return p;
};

/** Ein echtes coturn auf 127.0.0.1 mit freien Ports – `fn` bekommt Zugang und Ziel, danach endet es. */
async function mitCoturn(fn: (turn: { urls: string[]; geheimnis: string; gueltigSek: number }, port: number) => Promise<void>): Promise<void> {
  const ordner = tmp("e2e");
  const geheimnis = randomBytes(32).toString("hex");
  const turnPort = await freierPort();
  const relay = 49_300 + Math.floor(Math.random() * 500) * 10;
  writeFileSync(join(ordner, "turnserver.conf"), [
    "listening-ip=127.0.0.1", `listening-port=${turnPort}`, "relay-ip=127.0.0.1", `min-port=${relay}`, `max-port=${relay + 9}`,
    "realm=freedom", "use-auth-secret", `static-auth-secret=${geheimnis}`, "fingerprint", "no-cli", "no-tls", "no-dtls",
    "allow-loopback-peers", "log-file=/dev/null", "",
  ].join("\n"));
  const coturn = spawn("turnserver", ["-c", join(ordner, "turnserver.conf"), "--no-stdout-log"], { stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) {
      if (await new Promise<boolean>((r) => { const s = connect(turnPort, "127.0.0.1", () => { s.destroy(); r(true); }); s.once("error", () => r(false)); })) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn({ urls: [`turn:127.0.0.1:${turnPort}?transport=tcp`], geheimnis, gueltigSek: 600 }, turnPort);
  } finally {
    coturn.kill();
  }
}

/**
 * Die App spielt `fixtures/bild/empfaenger.py`: Angebot, Antwort vom Knoten (`starte`), Bilder zählen, Eingaben schicken
 * (mit `farbe` erst, wenn das Bild sie zeigt). Bis `gewirkt()` gilt, wartet der Test – mit Frist, nie eine feste Pause;
 * unter Last kommen Eingaben später an. Zurück die Bilder, die Farbe am Ende und die Zeit bis zur Antwort.
 */
async function empfange(turn: { urls: string[]; geheimnis: string; gueltigSek: number }, turnPort: number, eingaben: unknown[],
  starte: (angebot: string) => Promise<string>, gewirkt: (farbe: number[] | null, bilder: number) => boolean,
  optionen: { farbe?: number[]; pt?: number; frist?: number; stelle?: [number, number] } = {}):
  Promise<{ bilder: number; farbe: number[] | null; antwortMs: number }> {
  const z = turnZugang(turn);
  const app = spawn(python!, [new URL("./fixtures/bild/empfaenger.py", import.meta.url).pathname,
    `turn://${encodeURIComponent(z.nutzer)}:${encodeURIComponent(z.passwort)}@127.0.0.1:${turnPort}`, JSON.stringify(eingaben),
    JSON.stringify(optionen)], { stdio: ["pipe", "pipe", "ignore"] });
  const zeilen: Array<Record<string, unknown>> = [];
  let rest = "";
  const warteAuf = (schluessel: string) => new Promise<Record<string, unknown>>((r) => {
    const sieh = () => { const z = zeilen.find((x) => schluessel in x); if (z) r(z); else setTimeout(sieh, 50); };
    sieh();
  });
  app.stdout.on("data", (d: Buffer) => {
    rest += d.toString();
    for (let i = rest.indexOf("\n"); i >= 0; i = rest.indexOf("\n")) { zeilen.push(JSON.parse(rest.slice(0, i))); rest = rest.slice(i + 1); }
  });
  const angebot = (await warteAuf("angebot")).angebot as string;
  assert.ok(istBildSdp(angebot));
  const t0 = Date.now();
  const antwort = await starte(angebot);
  const antwortMs = Date.now() - t0;
  assert.ok(istBildSdp(antwort), "die Antwort nur mit Relay-Kandidaten");
  app.stdin.write(`${JSON.stringify({ antwort })}\n`);
  const letzte = () => [...zeilen].reverse().find((z) => "farbe" in z) ?? {};
  for (const bis = Date.now() + (optionen.frist ?? 40) * 1000; !gewirkt((letzte().farbe ?? null) as number[] | null, (letzte().bilder ?? 0) as number)
    && !zeilen.some((z) => "fertig" in z) && Date.now() < bis;) {
    await new Promise((r) => setTimeout(r, 100));
  }
  app.stdin.write(`${JSON.stringify({ ende: true })}\n`);
  const ende = await warteAuf("fertig");
  return { bilder: ende.fertig as number, farbe: ende.farbe as number[] | null, antwortMs };
}

test("VKg2a2/a3: Ende zu Ende – Bild über den TURN, Tasten und Klick kommen im Programm an, nur aus der eigenen Sandbox", { skip: ohne, timeout: 90_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("spiel");
    copyFileSync(new URL("./fixtures/bild/taster.py", import.meta.url), join(a.ort("spiel"), "taster.py"));
    const b = new BildStrom(a, {
      turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python,
      befehl: () => [python!, "/arbeit/taster.py", "/arbeit/tasten.txt"],
    });
    try {
      // Buchstabe, Großbuchstabe ohne Umschalttaste (Handy), Zeichen ohne Taste, Enter, Klick; dann Unsinn, der nichts tut
      const eingaben = [
        { t: "kd", s: "h" }, { t: "ku", s: "h" }, { t: "kd", s: "A" }, { t: "ku", s: "A" }, { t: "kd", s: "ä" }, { t: "ku", s: "ä" },
        { t: "kd", s: "Enter" }, { t: "ku", s: "Enter" }, { t: "d", x: 0.5, y: 0.25, k: 1 }, { t: "u", x: 0.5, y: 0.25, k: 1 },
        { t: "kd", s: "<script>" }, { t: "d", x: 2, y: -1, k: 9 }, { t: "x" }, "kein objekt", { t: "kd", s: "x".repeat(300) },
      ];
      const datei = join(a.ort("spiel"), "tasten.txt");
      const e = await empfange(turn, turnPort, eingaben, (angebot) => b.starte("spiel", angebot, { breite: 640, hoehe: 480 }),
        () => existsSync(datei) && readFileSync(datei, "utf8").includes("klick"), { farbe: [255, 255, 255] }); // weiß: das Fenster des Programms steht
      console.log(`[bild] Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder empfangen, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(e.bilder >= 20, `Bilder angekommen (${e.bilder})`);
      const tasten = readFileSync(datei, "utf8");
      assert.match(tasten, /^mit-shm nein\nbereit\ntaste h\n(taste 0xffe1\n)?taste A\ntaste (adiaeresis|ä)\ntaste \r\nklick 1 320 120\n$/, tasten);
      assert.equal(b.beende("spiel"), true);
    } finally {
      b.beendeAlle();
    }
  });
});

/** Ein Chromium für den echten Test: wie der Knoten, dazu das von Playwright, wo es installiert ist. */
function testBrowser(): string | undefined {
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const vonPlaywright = pw && existsSync(pw)
    ? readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).map((d) => join(pw, d, "chrome-linux", "chrome"))
    : [];
  return [process.env.MCP_TEST_BROWSER, ...BROWSER_ORTE, ...vonPlaywright].find((p) => p && existsSync(p));
}
const browser = testBrowser();

test("VKg2c1: Ende zu Ende – eine Web-Seite in Chromium im Bild, ein Klick über den Datenkanal ändert sie", { skip: ohne || (!browser && "kein Chromium"), timeout: 90_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("seite");
    writeFileSync(join(a.ort("seite"), "index.html"),
      "<!doctype html><body style='margin:0;height:100vh;background:#00c000' onclick=\"document.body.style.background='#c00000'\"></body>");
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, browser: browser! });
    try {
      const klick = [{ t: "d", x: 0.5, y: 0.5, k: 1 }, { t: "u", x: 0.5, y: 0.5, k: 1 }];
      // vorher grün (darauf wartet der Empfänger), nach dem Klick rot
      const rot = (f: number[] | null) => !!f && f[0]! > 150 && f[1]! < 60 && f[2]! < 60;
      const e = await empfange(turn, turnPort, klick, (angebot) => b.starte("seite", angebot, { breite: 640, hoehe: 480 }), rot, { farbe: [0, 192, 0] });
      console.log(`[bild] Chromium: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(e.bilder >= 20, `Bilder angekommen (${e.bilder})`);
      assert.ok(rot(e.farbe), `nach dem Klick rot (${JSON.stringify(e.farbe)})`);
    } finally {
      b.beendeAlle();
    }
  });
});

/**
 * npm und node sieht die Sandbox nur, wenn sie wirklich unter `/usr` liegen (im Docker-Bild `/usr/local`) – ein Verweis
 * nach `/opt` zählt nicht. Auf Rechnern mit Node anderswo überspringt sich der Test.
 */
const unterUsr = (namen: string[]) => namen.some((p) => existsSync(p) && realpathSync(p).startsWith("/usr/"));
const npmInSandbox = unterUsr(["/usr/local/bin/npm", "/usr/bin/npm"]) && unterUsr(["/usr/local/bin/node", "/usr/bin/node"]);

test("VKg2c1: Ende zu Ende – ein Web-Projekt mit Dev-Server in Chromium im Bild, ein Klick ändert es", {
  skip: ohne || (!browser && "kein Chromium") || (!npmInSandbox && "npm nicht unter /usr (in der Sandbox nicht sichtbar)"), timeout: 120_000,
}, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("app");
    // wie Vite: lauscht auf PORT und HOST aus der Umgebung
    writeFileSync(join(a.ort("app"), "package.json"), JSON.stringify({ scripts: { dev: "node server.mjs" } }));
    writeFileSync(join(a.ort("app"), "server.mjs"), [
      "import { createServer } from 'node:http';",
      "createServer((_q, a) => a.end(\"<!doctype html><body style='margin:0;height:100vh;background:#00c000' onclick=\\\"document.body.style.background='#c00000'\\\"></body>\"))",
      "  .listen(Number(process.env.PORT), process.env.HOST);",
    ].join("\n"));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, browser: browser! });
    try {
      const klick = [{ t: "d", x: 0.5, y: 0.5, k: 1 }, { t: "u", x: 0.5, y: 0.5, k: 1 }];
      const rot = (f: number[] | null) => !!f && f[0]! > 150 && f[1]! < 60 && f[2]! < 60;
      const e = await empfange(turn, turnPort, klick, (angebot) => b.starte("app", angebot, { breite: 640, hoehe: 480 }), rot, { farbe: [0, 192, 0] });
      console.log(`[bild] Dev-Server: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(rot(e.farbe), `nach dem Klick rot (${JSON.stringify(e.farbe)})`);
    } finally {
      b.beendeAlle();
    }
  });
});

/**
 * Godot (VKk3a) – das echte Programm nur, wo GODOT_TEST darauf zeigt: in der CI aus `scripts/godot-holen.sh` (gegen SHA-512
 * geprüft). Den Agenten ist das Starten heruntergeladener Programme hier verwehrt; sie prüfen die Bausteine mit Attrappe.
 */
const godotTest = process.env.GODOT_TEST;

test("VKk3a: Ende zu Ende – ein Godot-Spiel im Bild (OpenGL in Software), ein Klick über den Datenkanal ändert es", {
  skip: ohne || (!godotTest && "Godot fehlt (GODOT_TEST, scripts/godot-holen.sh)"), timeout: 150_000,
}, async () => {
  assert.ok(existsSync(godotTest!), `GODOT_TEST zeigt auf Godot (${godotTest})`);
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("spiel");
    for (const f of ["project.godot", "haupt.tscn", "haupt.gd"]) copyFileSync(new URL(`./fixtures/godot/${f}`, import.meta.url), join(a.ort("spiel"), f));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, godot: godotTest! });
    try {
      const klick = [{ t: "d", x: 0.5, y: 0.5, k: 1 }, { t: "u", x: 0.5, y: 0.5, k: 1 }];
      // vorher grün (darauf wartet der Empfänger: das Spiel läuft), nach dem Klick rot
      const rot = (f: number[] | null) => !!f && f[0]! > 150 && f[1]! < 60 && f[2]! < 60;
      const e = await empfange(turn, turnPort, klick, (angebot) => b.starte("spiel", angebot, { breite: 640, hoehe: 480 }), rot, { farbe: [0, 192, 0] });
      console.log(`[bild] Godot: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(e.bilder >= 20, `Bilder angekommen (${e.bilder})`);
      assert.ok(rot(e.farbe), `nach dem Klick rot (${JSON.stringify(e.farbe)})`);
      assert.ok(existsSync(join(a.ort("spiel"), ".godot")), "importiert wie im Editor");
    } finally {
      b.beendeAlle();
    }
  });
});

/**
 * Wine (VKi1; auf ARM64 Hangover, VKi2) und mingw-w64 zum Bauen des Test-Programms – in der CI installiert, hier je nach Rechner.
 * Mit `WINE_TEST_PFLICHT` (CI-Job auf ARM64) ist der Test rot, statt sich zu überspringen, wenn etwas fehlt.
 */
const wine = wineAusUmgebung({});
const mingw = await hat("x86_64-w64-mingw32-gcc");
const ohneWine = ohne || (!wine && "Wine fehlt (wine64, auf ARM64 Hangover)") || (!mingw && "mingw-w64 fehlt (gcc-mingw-w64-x86-64)");

test("VKi1: Ende zu Ende – ein Windows-Programm in Wine im Bild, ein Klick über den Datenkanal ändert es", {
  skip: process.env.WINE_TEST_PFLICHT ? false : ohneWine, timeout: 150_000,
}, async () => {
  assert.equal(ohneWine, false, `WINE_TEST_PFLICHT: ${ohneWine}`);
  console.log(`[bild] Wine: ${wine} auf ${process.arch}`);
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("fenster");
    await new Promise<void>((r, f) => execFile("x86_64-w64-mingw32-gcc",
      ["-O2", "-mwindows", "-o", join(a.ort("fenster"), "main.exe"), new URL("./fixtures/wine/fenster.c", import.meta.url).pathname], (e) => (e ? f(e) : r())));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, wine: wine! });
    try {
      const klick = [{ t: "d", x: 0.5, y: 0.5, k: 1 }, { t: "u", x: 0.5, y: 0.5, k: 1 }];
      // vorher grün (darauf wartet der Empfänger – Wine legt sein Präfix erst an, rund 10 s), nach dem Klick rot
      const rot = (f: number[] | null) => !!f && f[0]! > 150 && f[1]! < 60 && f[2]! < 60;
      const e = await empfange(turn, turnPort, klick, (angebot) => b.starte("fenster", angebot, { breite: 640, hoehe: 480 }), rot,
        { farbe: [0, 192, 0], frist: 90 });
      console.log(`[bild] Wine: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(e.bilder >= 20, `Bilder angekommen (${e.bilder})`);
      assert.ok(rot(e.farbe), `nach dem Klick rot (${JSON.stringify(e.farbe)})`);
      assert.deepEqual(readdirSync(a.ort("fenster")).sort(), ["main.exe"], "das Präfix liegt nie im Projekt");
    } finally {
      b.beendeAlle();
    }
  });
});

const openscad = openscadAusUmgebung({});
const ohneOpenscad = ohne || (!openscad && "OpenSCAD fehlt (openscad)");
/** Draufsicht aus der Nähe: die Oberseite der Platte füllt die Vorschau. */
const scad = (farbe: string) => `$vpr = [0, 0, 0]; $vpt = [0, 0, 0]; $vpd = 40;\ncolor(${farbe}) cube([200, 200, 10], center = true);\n`;

test("VKk4a: Ende zu Ende – ein OpenSCAD-Modell im Bild; ändert der Agent die Datei, zeigt das Bild das neue Modell", { skip: ohneOpenscad, timeout: 120_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("modell");
    const datei = join(a.ort("modell"), "main.scad");
    writeFileSync(datei, scad("[0, 0.75, 0]"));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, openscad: openscad! });
    try {
      const gruen = (f: number[] | null) => !!f && f[1]! > 100 && f[0]! < 80 && f[2]! < 80;
      const rot = (f: number[] | null) => !!f && f[0]! > 100 && f[1]! < 80 && f[2]! < 80;
      // erst grün, dann ändert der Test die Datei wie der Agent in seiner Sandbox – OpenSCAD lädt neu, das Bild wird rot
      let geaendert = false;
      const gewirkt = (f: number[] | null) => {
        if (!geaendert && gruen(f)) {
          geaendert = true;
          writeFileSync(datei, scad("[0.8, 0, 0]"));
        }
        return geaendert && rot(f);
      };
      // die Vorschau rechts oben, fern der Achsen in der Mitte
      const e = await empfange(turn, turnPort, [], (angebot) => b.starte("modell", angebot, { breite: 640, hoehe: 480 }), gewirkt,
        { frist: 60, stelle: [0.9, 0.15] });
      console.log(`[bild] OpenSCAD: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(geaendert, `erst grün (${JSON.stringify(e.farbe)})`);
      assert.ok(rot(e.farbe), `nach der Änderung rot (${JSON.stringify(e.farbe)})`);
      assert.deepEqual(readdirSync(a.ort("modell")), ["main.scad"], "die Einstellungen liegen nie im Projekt");
    } finally {
      b.beendeAlle();
    }
  });
});

const kicad = kicadAusUmgebung({});
const ohneKicad = ohne || (!kicad && "KiCad fehlt (kicad)");
/** Ein Schaltplan mit einer gefüllten Fläche über das ganze Blatt (KiCad 7). */
const schaltplan = (farbe: string) => `(kicad_sch (version 20230121) (generator eeschema)
  (uuid 0b3f4c1e-1111-4a2b-9c3d-000000000001)
  (paper "A4")
  (lib_symbols)
  (rectangle (start 10 10) (end 287 200) (stroke (width 0) (type default)) (fill (type color) (color ${farbe} 1))
    (uuid 0b3f4c1e-1111-4a2b-9c3d-000000000003))
  (sheet_instances (path "/" (page "1")))
)
`;

test("VKk4b: Ende zu Ende – ein Schaltplan in KiCad im Bild; ändert der Agent die Datei, zeigt das Bild den neuen", { skip: ohneKicad, timeout: 120_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("plan");
    const datei = join(a.ort("plan"), "main.kicad_sch");
    writeFileSync(datei, schaltplan("0 192 0"));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, kicad: kicad! });
    try {
      const gruen = (f: number[] | null) => !!f && f[1]! > 100 && f[0]! < 80 && f[2]! < 80;
      const rot = (f: number[] | null) => !!f && f[0]! > 100 && f[1]! < 80 && f[2]! < 80;
      // erst grün, dann ändert der Test die Datei wie der Agent – das Skript startet den Editor neu, das Bild wird rot
      let geaendert = false;
      const gewirkt = (f: number[] | null) => {
        if (!geaendert && gruen(f)) {
          geaendert = true;
          writeFileSync(datei, schaltplan("200 0 0"));
        }
        return geaendert && rot(f);
      };
      // mitten im Blatt, rechts von Hierarchie und Werkzeugleiste
      const e = await empfange(turn, turnPort, [], (angebot) => b.starte("plan", angebot, { breite: 640, hoehe: 480 }), gewirkt,
        { frist: 60, stelle: [0.6, 0.5] });
      console.log(`[bild] KiCad: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(geaendert, `erst grün (${JSON.stringify(e.farbe)})`);
      assert.ok(rot(e.farbe), `nach der Änderung rot (${JSON.stringify(e.farbe)})`);
      // KiCad legt eine Sperrdatei neben den Plan; endet die Sandbox hart, bleibt sie liegen (KiCads .gitignore nennt *.lck)
      assert.deepEqual(readdirSync(a.ort("plan")).filter((f) => f !== "~main.kicad_sch.lck"), ["main.kicad_sch"], "sonst nichts im Projekt");
    } finally {
      b.beendeAlle();
    }
  });
});

const blender = blenderAusUmgebung({});
const ohneBlender = ohne || (!blender && "Blender fehlt (blender)");
/** Baut main.blend wie der Agent im Terminal: eine Fläche in Draufsicht, im Ansichtsmodus mit der Farbe des Materials. */
const SZENE_PY = `import bpy, sys
r, g, b = (float(x) for x in sys.argv[sys.argv.index("--") + 1].split(","))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_plane_add(size=200)
m = bpy.data.materials.new("farbe")
m.diffuse_color = (r, g, b, 1)
bpy.context.object.data.materials.append(m)
for s in bpy.data.screens:
    for a in s.areas:
        for sp in a.spaces:
            if sp.type == "VIEW_3D":
                sp.shading.type, sp.shading.color_type, sp.shading.light = "SOLID", "MATERIAL", "FLAT"
                sp.region_3d.view_perspective, sp.region_3d.view_rotation, sp.region_3d.view_distance = "ORTHO", (1, 0, 0, 0), 5
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[sys.argv.index("--") + 2])
`;

test("VKk4c: Ende zu Ende – eine Szene in Blender im Bild; baut der Agent sie neu, zeigt das Bild die neue", { skip: ohneBlender, timeout: 150_000 }, async () => {
  const d = tmp("szene-py");
  writeFileSync(join(d, "szene.py"), SZENE_PY);
  const baue = (datei: string, farbe: string) => new Promise<void>((r, f) => execFile(blender!,
    ["-b", "--factory-startup", "--python", join(d, "szene.py"), "--", farbe, datei], { env: { PATH: process.env.PATH, HOME: d } }, (e) => (e ? f(e) : r())));
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("szene");
    const datei = join(a.ort("szene"), "main.blend");
    await baue(datei, "0,0.75,0");
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, blender: blender! });
    try {
      const gruen = (f: number[] | null) => !!f && f[1]! > 100 && f[0]! < 80 && f[2]! < 80;
      const rot = (f: number[] | null) => !!f && f[0]! > 100 && f[1]! < 80 && f[2]! < 80;
      // erst grün, dann baut der Test die Szene neu wie der Agent – das Skript startet Blender neu, das Bild wird rot
      let geaendert: Promise<void> | null = null;
      const gewirkt = (f: number[] | null) => {
        if (!geaendert && gruen(f)) geaendert = baue(datei, "0.8,0,0");
        return !!geaendert && rot(f);
      };
      // in der 3D-Ansicht, links vom Zeiger in der Mitte und unter der Leiste oben
      const e = await empfange(turn, turnPort, [], (angebot) => b.starte("szene", angebot, { breite: 640, hoehe: 480 }), gewirkt,
        { frist: 90, stelle: [0.3, 0.6] });
      console.log(`[bild] Blender: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(geaendert, `erst grün (${JSON.stringify(e.farbe)})`);
      await geaendert;
      assert.ok(rot(e.farbe), `nach dem Neubau rot (${JSON.stringify(e.farbe)})`);
      // Blender legt beim Überschreiben eine Sicherung an (main.blend1) – sonst nichts im Projekt
      assert.deepEqual(readdirSync(a.ort("szene")).filter((f) => f !== "main.blend1"), ["main.blend"], "sonst nichts im Projekt");
    } finally {
      b.beendeAlle();
    }
  });
});

const libreoffice = libreofficeAusUmgebung({});
const ohneLibreoffice = ohne || (!libreoffice && "LibreOffice fehlt (soffice)");
/** Ein Textdokument als flaches XML, wie es der Agent im Terminal schreibt: eine Seite in einer Farbe. */
const dokument = (farbe: string) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
 <office:automatic-styles>
  <style:page-layout style:name="seite"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"
   fo:background-color="#${farbe}" draw:fill="solid" draw:fill-color="#${farbe}"/></style:page-layout>
 </office:automatic-styles>
 <office:master-styles><style:master-page style:name="Standard" style:page-layout-name="seite"/></office:master-styles>
 <office:body><office:text><text:p>Freedom</text:p></office:text></office:body>
</office:document>
`;

test("VKk4d: Ende zu Ende – ein Dokument in LibreOffice im Bild; schreibt der Agent es neu, zeigt das Bild das neue", { skip: ohneLibreoffice, timeout: 150_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("dok");
    const datei = join(a.ort("dok"), "main.fodt");
    writeFileSync(datei, dokument("00c000"));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, libreoffice: libreoffice! });
    try {
      const gruen = (f: number[] | null) => !!f && f[1]! > 100 && f[0]! < 80 && f[2]! < 80;
      const rot = (f: number[] | null) => !!f && f[0]! > 100 && f[1]! < 80 && f[2]! < 80;
      // erst grün, dann schreibt der Test das Dokument neu wie der Agent – das Skript startet LibreOffice neu, das Bild wird rot
      let geaendert = false;
      let imProjekt: string[] = [];
      const gewirkt = (f: number[] | null) => {
        if (!geaendert && gruen(f)) {
          // solange LibreOffice läuft: keine Sperrdatei neben dem Dokument
          imProjekt = readdirSync(a.ort("dok"));
          writeFileSync(datei, dokument("cc0000"));
          geaendert = true;
        }
        return geaendert && rot(f);
      };
      // auf der Seite, links vom Zeiger in der Mitte und unter den Leisten oben
      const e = await empfange(turn, turnPort, [], (angebot) => b.starte("dok", angebot, { breite: 640, hoehe: 480 }), gewirkt,
        { frist: 90, stelle: [0.3, 0.6] });
      console.log(`[bild] LibreOffice: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(geaendert, `erst grün (${JSON.stringify(e.farbe)})`);
      assert.ok(rot(e.farbe), `nach dem Neuschreiben rot (${JSON.stringify(e.farbe)})`);
      assert.deepEqual(imProjekt, ["main.fodt"], "keine Sperrdatei, sonst nichts im Projekt");
      assert.deepEqual(readdirSync(a.ort("dok")), ["main.fodt"], "auch nach dem Neustart");
    } finally {
      b.beendeAlle();
    }
  });
});

test("VKk4d: Umweg zum Bildschirm – in der Sandbox über die abstrakte Adresse, die libxcb zuerst versucht; ohne Umweg gibt es sie dort nicht", {
  skip: ohne, timeout: 60_000,
}, async () => {
  const nummer = 73;
  const xvfb = spawn("Xvfb", [`:${nummer}`, "-screen", "0", "64x64x24", "-nolisten", "tcp", "-noreset", "-extension", "MIT-SHM"], { stdio: "ignore" });
  try {
    for (let i = 0; i < 100 && !existsSync(`/tmp/.X11-unix/X${nummer}`); i++) await new Promise((r) => setTimeout(r, 50));
    // die Begrüßung von X11 über die abstrakte Adresse – das erste Byte der Antwort 1 heißt: angenommen
    const hallo = ["import socket, sys", "s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)", "try:",
      "    s.connect('\\0/tmp/.X11-unix/X' + sys.argv[1])", "except OSError as e:", "    print('keine', e.errno)", "    sys.exit()",
      "s.sendall(b'l\\0\\x0b\\0\\0\\0\\0\\0\\0\\0\\0\\0')", "print('Antwort', s.recv(1)[0])"].join("\n");
    const ort = { arbeit: tmp("x11-umweg"), nurLesbar: [{ quelle: "/tmp/.X11-unix", ziel: BILD_IN_SANDBOX.x11 }] };
    const mit = await fuehreAus(["/bin/sh", "-c", `/usr/bin/python3 -c "$0" ${nummer} &
for i in $(seq 50); do grep -q "@/tmp/.X11-unix/X${nummer}$" /proc/net/unix && break; sleep 0.1; done
/usr/bin/python3 -c "$1" ${nummer}`, X11_UMWEG, hallo], ort, 30_000);
    assert.match(mit.ausgabe, /^Antwort 1$/m, `über den Umweg angenommen (${mit.ausgabe})`);
    const ohneUmweg = await fuehreAus(["/usr/bin/python3", "-c", hallo, String(nummer)], ort, 30_000);
    assert.match(ohneUmweg.ausgabe, /^keine 111$/m, `ohne Umweg ist die Adresse von Xvfb hier nicht zu sehen – eigener Netz-Namensraum (${ohneUmweg.ausgabe})`);
  } finally {
    xvfb.kill();
  }
});

test("VKk4d: im Terminal – soffice --headless wandelt das Dokument in der Sandbox um, mit Schriften", {
  skip: (!pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`) || (!libreoffice && "LibreOffice fehlt (soffice)"), timeout: 150_000,
}, async () => {
  const arbeit = tmp("dok-terminal");
  writeFileSync(join(arbeit, "main.fodt"), dokument("00c000"));
  const r = await fuehreAus(["/bin/sh", "-c", "soffice --headless --convert-to pdf main.fodt && soffice --headless --convert-to odt main.fodt && soffice --headless --convert-to docx main.fodt"], { arbeit }, 120_000);
  assert.equal(r.code, 0, r.ausgabe);
  assert.ok(!r.ausgabe.includes("Fontconfig error"), `Fontconfig findet seine Konfiguration (${r.ausgabe})`);
  assert.equal(readFileSync(join(arbeit, "main.pdf")).subarray(0, 5).toString(), "%PDF-");
  for (const f of ["main.odt", "main.docx"]) assert.equal(readFileSync(join(arbeit, f)).subarray(0, 2).toString(), "PK", f);
  assert.deepEqual(readdirSync(arbeit).sort(), ["main.docx", "main.fodt", "main.odt", "main.pdf"]);
});

const inkscape = inkscapeAusUmgebung({});
const ohneInkscape = ohne || (!inkscape && "Inkscape fehlt (inkscape)");
/** Eine Zeichnung, wie sie der Agent als Text schreibt: eine Fläche in einer Farbe. */
const zeichnung = (farbe: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#${farbe}"/></svg>\n`;

test("VKk4e: Ende zu Ende – eine Zeichnung in Inkscape im Bild; schreibt der Agent sie neu, zeigt das Bild die neue", { skip: ohneInkscape, timeout: 150_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("zeichnung");
    const datei = join(a.ort("zeichnung"), "main.svg");
    writeFileSync(datei, zeichnung("00c000"));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, inkscape: inkscape! });
    try {
      const gruen = (f: number[] | null) => !!f && f[1]! > 100 && f[0]! < 80 && f[2]! < 80;
      const rot = (f: number[] | null) => !!f && f[0]! > 100 && f[1]! < 80 && f[2]! < 80;
      // erst grün, dann schreibt der Test die Zeichnung neu wie der Agent – das Skript startet Inkscape neu, das Bild wird rot
      let geaendert = false;
      const gewirkt = (f: number[] | null) => {
        if (!geaendert && gruen(f)) {
          writeFileSync(datei, zeichnung("cc0000"));
          geaendert = true;
        }
        return geaendert && rot(f);
      };
      // auf der Fläche, neben dem Zeiger in der Mitte
      const e = await empfange(turn, turnPort, [], (angebot) => b.starte("zeichnung", angebot, { breite: 640, hoehe: 480 }), gewirkt,
        { frist: 90, stelle: [0.4, 0.55] });
      console.log(`[bild] Inkscape: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(geaendert, `erst grün (${JSON.stringify(e.farbe)})`);
      assert.ok(rot(e.farbe), `nach dem Neuschreiben rot (${JSON.stringify(e.farbe)})`);
      assert.deepEqual(readdirSync(a.ort("zeichnung")), ["main.svg"], "sonst nichts im Projekt");
    } finally {
      b.beendeAlle();
    }
  });
});

test("VKk4e: im Terminal – inkscape exportiert die Zeichnung in der Sandbox als PDF", {
  skip: (!pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`) || (!inkscape && "Inkscape fehlt (inkscape)"), timeout: 120_000,
}, async () => {
  const arbeit = tmp("zeichnung-terminal");
  writeFileSync(join(arbeit, "main.svg"), zeichnung("00c000"));
  const r = await fuehreAus(["/bin/sh", "-c", "inkscape --export-type=pdf main.svg"], { arbeit }, 90_000);
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(readFileSync(join(arbeit, "main.pdf")).subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual(readdirSync(arbeit).sort(), ["main.pdf", "main.svg"]);
});

/** Die Wahl im Skript selbst: `formate()` und `pipeline_text()` aus `motor/freedom_bild.py`, mit dem Python der Tests. */
function imSkript(code: string): Promise<unknown> {
  const motor = new URL("../motor/", import.meta.url).pathname;
  return new Promise((r, f) => execFile(python ?? "python3", ["-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(motor)}); import freedom_bild as b; ${code}`],
    (e, aus) => (e ? f(e) : r(JSON.parse(aus)))));
}

test("VKg2c2: Formate aus dem Angebot – VP8 und H.264 mit ihren Nummern, H.264 nur mit packetization-mode=1 und Baseline", { skip: !python && "kein Python mit GStreamer" }, async () => {
  // wie Chromium: VP8 96, VP9 98, H.264 in mehreren Profilen, dazu ein Datenkanal mit eigenem rtpmap, der nicht zählt
  const chromium = ["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 102 104 106 108", "a=rtpmap:96 VP8/90000", "a=rtpmap:97 rtx/90000",
    "a=rtpmap:98 VP9/90000", "a=rtpmap:102 H264/90000", "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
    "a=rtpmap:104 H264/90000", "a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
    "a=rtpmap:106 H264/90000", "a=fmtp:106 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "a=rtpmap:108 H264/90000", "a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640034",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "a=rtpmap:120 VP8/90000", ""].join("\r\n");
  assert.deepEqual(await imSkript(`print(json.dumps(b.formate(${JSON.stringify(chromium)})))`),
    { VP8: 96, H264: [106, "42e01f"] }, "Constrained Baseline mit Paketen vor Baseline; ohne packetization-mode=1 und High nie");
  const firefox = ["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 120 124 121 126 97", "a=rtpmap:120 VP8/90000", "a=rtpmap:121 VP9/90000",
    "a=rtpmap:126 H264/90000", "a=fmtp:126 profile-level-id=42e01f;level-asymmetry-allowed=1;packetization-mode=1", ""].join("\r\n");
  assert.deepEqual(await imSkript(`print(json.dumps(b.formate(${JSON.stringify(firefox)})))`), { VP8: 120, H264: [126, "42e01f"] });
  assert.deepEqual(await imSkript(`print(json.dumps(b.formate("v=0\\r\\nm=video 9 X 96\\r\\na=rtpmap:96 VP9/90000\\r\\n")))`), {}, "nur VP9: nichts");
  // die Kette für NVENC: Nummer und Profil aus dem Angebot, Constrained Baseline, SPS und PPS vor jedem Schlüsselbild
  const nv = await imSkript(`print(json.dumps(b.pipeline_text("nvh264enc", 106, "42e01f")))`) as string;
  for (const teil of ["nvh264enc ", "video/x-h264,profile=constrained-baseline", "rtph264pay pt=106 config-interval=-1", "payload=106",
    "packetization-mode=(string)1,profile-level-id=(string)42e01f", "ice-transport-policy=relay"]) assert.ok(nv.includes(teil), teil);
  // die Kette für VP8 baut GStreamer hier wirklich
  assert.equal(await imSkript(`import gi; gi.require_version("Gst", "1.0"); from gi.repository import Gst; Gst.init(None); `
    + `print(json.dumps(Gst.parse_launch(b.pipeline_text("vp8enc", 120)).get_by_name("w") is not None))`), true);
});


test("VKg2c2: Ende zu Ende – die Nummer des Formats aus dem Angebot (VP8 mit 120 wie Firefox); H.264 ohne NVENC wird VP8", {
  skip: ohne, timeout: 150_000,
}, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("spiel");
    copyFileSync(new URL("./fixtures/bild/taster.py", import.meta.url), join(a.ort("spiel"), "taster.py"));
    const befehl = () => [python!, "/arbeit/taster.py", "/arbeit/tasten.txt"];
    const weiss = (f: number[] | null) => !!f && f.every((x) => x > 200);
    const genug = (f: number[] | null, bilder: number) => weiss(f) && bilder >= 20;
    const faelle: Array<{ kodierer: "vp8" | "h264"; pt: number; im: RegExp }> = [
      { kodierer: "vp8", pt: 120, im: /^m=video \d+ \S+ 120\r?$/m },
      { kodierer: "h264", pt: 98, im: /^m=video \d+ \S+ 98\r?$/m }, // H.264 gewünscht, ohne NVENC (hier): VP8
    ];
    for (const f of faelle) {
      const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, befehl, kodierer: f.kodierer });
      try {
        let antwort = "";
        const e = await empfange(turn, turnPort, [], async (angebot) => (antwort = await b.starte("spiel", angebot, { breite: 640, hoehe: 480 })),
          genug, { pt: f.pt });
        console.log(`[bild] VP8 mit ${f.pt}: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
        assert.match(antwort, f.im, `die Antwort nennt ${f.pt}`);
        assert.ok(e.bilder >= 20 && weiss(e.farbe), `${f.pt}: Bild angekommen (${e.bilder}, ${JSON.stringify(e.farbe)})`);
      } finally {
        b.beendeAlle();
      }
    }
  });
});
