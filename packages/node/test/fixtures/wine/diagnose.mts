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

const exe = `Z:${arbeit.replaceAll("/", "\\")}\\main.exe`;
/** Ohne Sandbox – `vorher` setzt etwa Grenzen wie in der Sandbox. */
async function ohneSandbox(name: string, vorher: string): Promise<void> {
  console.log(`== ${name}`);
  const praefix = join(d, `praefix-${name.replaceAll(" ", "-")}`);
  const log = join(d, `${name.replaceAll(" ", "-")}.log`);
  const k = spawn("/bin/sh", ["-c", `${vorher}"$0" "$@" > "${log}" 2>&1`, wine!, "explorer", "/desktop=freedom,640x480", exe],
    { env: { ...process.env, ...umgebung, DISPLAY: ANZEIGE, WINEPREFIX: praefix }, stdio: "ignore", detached: true });
  console.log(await warte(60));
  try { process.kill(-k.pid!); } catch { /* schon weg */ }
  await new Promise<void>((r) => execFile(join(wine!, "..", "wineserver"), ["-k"], { env: { ...process.env, WINEPREFIX: praefix } }, () => r()));
  console.log(ende(log));
}
/** In der Sandbox – `lesbar` bindet zusätzlich nur lesbar ein. */
async function inSandbox(name: string, lesbar: Array<{ quelle: string; ziel: string }>): Promise<void> {
  console.log(`== ${name}`);
  const log = `${name.replaceAll(" ", "-")}.log`;
  const k = sandboxDienst(["/usr/bin/env", `DISPLAY=${ANZEIGE}`, "WINEPREFIX=/home/agent/.wine", `WINEDEBUG=${umgebung.WINEDEBUG}`,
    `WINEDLLOVERRIDES=${umgebung.WINEDLLOVERRIDES}`, "/bin/sh", "-c", `grep -m1 -i features /proc/cpuinfo > /arbeit/${log}.cpu 2>&1; "$0" "$@" > /arbeit/${log} 2>&1`, wine!,
    "explorer", "/desktop=freedom,640x480", "Z:\\arbeit\\main.exe"], { arbeit, nurLesbar: [{ quelle: "/tmp/.X11-unix", ziel: "/tmp/.X11-unix" }, ...lesbar] });
  console.log(await warte(60));
  k.beende();
  await k.ende;
  console.log(`cpuinfo in der Sandbox: ${ende(join(arbeit, `${log}.cpu`))}`);
  console.log(ende(join(arbeit, log)));
}

console.log(`Wine ${wine} auf ${process.arch}`);
console.log(`cpuinfo außen: ${execFileSync("/bin/sh", ["-c", "grep -m1 -i features /proc/cpuinfo || true"]).toString().trim()}`);
await ohneSandbox("ohne Sandbox", "");
// dieselben Grenzen wie in der Sandbox (SANDBOX_GRENZEN: Speicher je Prozess, Prozesse)
await ohneSandbox("ohne Sandbox mit Grenzen", "ulimit -d 4194304; ");
await inSandbox("in der Sandbox", []);
if (existsSync("/sys/devices/system/cpu")) await inSandbox("in der Sandbox mit sys-cpu", [{ quelle: "/sys/devices/system/cpu", ziel: "/sys/devices/system/cpu" }]);
xvfb.kill();
process.exit(0);
