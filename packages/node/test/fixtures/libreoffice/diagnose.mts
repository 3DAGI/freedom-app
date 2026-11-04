/**
 * Diagnose für den Testjob (VKk4d): Zeigt der Echttest mit LibreOffice kein Bild, startet dieses Skript LibreOffice wie das
 * Bild – einmal ohne Sandbox, einmal in ihr (mit `LIBREOFFICE_START`) – auf einem eigenen Bildschirm und gibt aus, welche Fenster
 * es dort gibt, welche Farbe an der Stelle des Tests steht und wie das Protokoll endet. Nur in der CI und nur bei Fehlern
 * (`if: failure()`); nie im Knoten.
 *
 *   node --import tsx test/fixtures/libreoffice/diagnose.mts
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIBREOFFICE_START, libreofficeAusUmgebung } from "../../../src/bildstrom.js";
import { sandboxDienst } from "../../../src/sandbox.js";

const ANZEIGE = ":78";
const soffice = libreofficeAusUmgebung({});
if (!soffice) throw new Error("kein LibreOffice");
const d = mkdtempSync(join(tmpdir(), "libreoffice-diagnose-"));
const arbeit = join(d, "arbeit");
mkdirSync(arbeit);
writeFileSync(join(arbeit, "main.fodt"), `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
 <office:automatic-styles><style:page-layout style:name="seite"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"
  fo:background-color="#00c000" draw:fill="solid" draw:fill-color="#00c000"/></style:page-layout></office:automatic-styles>
 <office:master-styles><style:master-page style:name="Standard" style:page-layout-name="seite"/></office:master-styles>
 <office:body><office:text><text:p>Freedom</text:p></office:text></office:body>
</office:document>
`);

const xvfb = spawn("Xvfb", [ANZEIGE, "-screen", "0", "640x480x24", "-nolisten", "tcp", "-noreset", "-extension", "MIT-SHM"], { stdio: "ignore" });
for (let i = 0; i < 100 && !existsSync("/tmp/.X11-unix/X78"); i++) await new Promise((r) => setTimeout(r, 50));
/** Farbe an der Stelle des Tests (0,3 und 0,6 von 640×480) und die Fenster der obersten Ebene mit Größe und Namen. */
const bild = () => execFileSync("/usr/bin/python3", ["-c", `
from Xlib import display, X
d = display.Display("${ANZEIGE}"); r = d.screen().root
b = r.get_image(192, 288, 1, 1, X.ZPixmap, 0xffffffff).data
print("Farbe", b[2], b[1], b[0])
for w in r.query_tree().children:
    a = w.get_attributes(); g = w.get_geometry()
    if a.map_state == X.IsViewable: print("Fenster", g.x, g.y, g.width, g.height, repr(w.get_wm_name()))
`]).toString().trim();
const warte = async (s: number) => {
  for (let i = 0; i < s; i++) {
    if (bild().startsWith("Farbe 0 192 0")) return `grün nach ${i} s`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return `nach ${s} s nicht grün`;
};
const ende = (datei: string) => (existsSync(datei) ? readFileSync(datei, "utf8").split("\n").slice(-60).join("\n") : "(kein Protokoll)");

console.log(`LibreOffice ${soffice} auf ${process.arch}: ${execFileSync(soffice, ["--version"]).toString().trim()}`);

console.log("== ohne Sandbox");
const heim = join(d, "heim");
mkdirSync(heim);
const log = join(d, "ohne.log");
const k = spawn("/bin/sh", ["-c", `"$0" --norestore --nologo "$1" > "${log}" 2>&1`, soffice, join(arbeit, "main.fodt")],
  { env: { ...process.env, HOME: heim, DISPLAY: ANZEIGE, SAL_USE_VCLPLUGIN: "gen" }, stdio: "ignore", detached: true });
console.log(await warte(60));
console.log(bild());
try { process.kill(-k.pid!, "SIGKILL"); } catch { /* schon weg */ }
console.log(ende(log));
await new Promise((r) => setTimeout(r, 2000));

console.log("== in der Sandbox (wie das Bild)");
const s = sandboxDienst(["/usr/bin/env", `DISPLAY=${ANZEIGE}`, "/bin/sh", "-c", `exec > /arbeit/sandbox.log 2>&1\n${LIBREOFFICE_START}`, soffice, "/arbeit/main.fodt"],
  { arbeit, nurLesbar: [{ quelle: "/tmp/.X11-unix", ziel: "/tmp/.X11-unix" }] });
console.log(await warte(60));
console.log(bild());
s.beende();
await s.ende;
console.log(ende(join(arbeit, "sandbox.log")));
console.log(`im Projekt: ${execFileSync("ls", ["-a", arbeit]).toString().trim().split("\n").join(" ")}`);
xvfb.kill();
process.exit(0);
