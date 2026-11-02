/**
 * Diagnose für den CI-Job auf ARM64 (VKi2): Zeigt der Echttest kein Bild, startet dieses Skript Wine wie das Bild – einmal
 * ohne Sandbox, einmal in ihr – mit Protokoll von Wine und gibt aus, welche Farbe der Bildschirm zeigt und wie das Protokoll
 * endet. Nur in der CI und nur bei Fehlern (`if: failure()`); nie im Knoten.
 *
 *   node --import tsx test/fixtures/wine/diagnose.mts
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wineAusUmgebung } from "../../../src/bildstrom.js";
import { sandboxDienst } from "../../../src/sandbox.js";

const ANZEIGE = ":77";
const wine = wineAusUmgebung({});
if (!wine) throw new Error("kein Wine");
const d = mkdtempSync(join(tmpdir(), "wine-diagnose-"));
const arbeit = join(d, "arbeit");
mkdirSync(arbeit);
execFileSync("x86_64-w64-mingw32-gcc", ["-O2", "-mwindows", "-o", join(arbeit, "main.exe"), new URL("./fenster.c", import.meta.url).pathname]);

const xvfb = spawn("Xvfb", [ANZEIGE, "-screen", "0", "640x480x24", "-nolisten", "tcp", "-noreset"], { stdio: "ignore" });
for (let i = 0; i < 100 && !existsSync("/tmp/.X11-unix/X77"); i++) await new Promise((r) => setTimeout(r, 50));
const farbe = () => execFileSync("/usr/bin/python3", ["-c",
  "from Xlib import display, X; d=display.Display(':77'); i=d.screen().root.get_image(160,120,1,1,X.ZPixmap,0xffffffff); b=i.data; print(b[2],b[1],b[0])"]).toString().trim();
const ende = (datei: string) => (existsSync(datei) ? readFileSync(datei, "utf8").split("\n").filter((z) => !/fixme:|Fontconfig/.test(z)).slice(-40).join("\n") : "(kein Protokoll)");
const warte = async (s: number) => {
  for (let i = 0; i < s; i++) {
    const f = farbe();
    if (f === "0 192 0") return `grün nach ${i} s`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return `nach ${s} s: ${farbe()}`;
};
const umgebung = { WINEDEBUG: "err+all,fixme-all", WINEDLLOVERRIDES: "mscoree,mshtml=;winemenubuilder.exe=d" };

console.log(`== Wine ${wine} auf ${process.arch}, ohne Sandbox`);
const ohne = spawn("/bin/sh", ["-c", `"$0" "$@" > "${d}/ohne.log" 2>&1`, wine, "explorer", "/desktop=freedom,640x480", `Z:${arbeit.replaceAll("/", "\\")}\\main.exe`],
  { env: { ...process.env, ...umgebung, DISPLAY: ANZEIGE, WINEPREFIX: join(d, "praefix") }, stdio: "ignore", detached: true });
console.log(await warte(60));
try { process.kill(-ohne.pid!); } catch { /* schon weg */ }
await new Promise<void>((r) => execFile(join(wine, "..", "wineserver"), ["-k"], { env: { ...process.env, WINEPREFIX: join(d, "praefix") } }, () => r()));
console.log(ende(join(d, "ohne.log")));

console.log(`== Wine in der Sandbox`);
const mit = sandboxDienst(["/usr/bin/env", `DISPLAY=${ANZEIGE}`, "WINEPREFIX=/home/agent/.wine", `WINEDEBUG=${umgebung.WINEDEBUG}`,
  `WINEDLLOVERRIDES=${umgebung.WINEDLLOVERRIDES}`, "/bin/sh", "-c", '"$0" "$@" > /arbeit/mit.log 2>&1', wine, "explorer", "/desktop=freedom,640x480",
  "Z:\\arbeit\\main.exe"], { arbeit, nurLesbar: [{ quelle: "/tmp/.X11-unix", ziel: "/tmp/.X11-unix" }] });
console.log(await warte(90));
mit.beende();
await mit.ende;
console.log(ende(join(arbeit, "mit.log")));
xvfb.kill();
process.exit(0);
