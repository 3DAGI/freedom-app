/**
 * Schritt 11.1b: QR in der App. Ohne DOM geprüft: die Werte des SVG, der
 * Dialog ohne Wert für QR-Felder und die Regeln im Quelltext – Gerätecode nur
 * auf Klick, mit Warnung, verschwindet wieder, nie gespeichert oder
 * exportiert; Kamera nur auf Klick und danach aus; kein innerHTML. Das Zeigen,
 * Verschwinden und Scannen im Browser prüft der Smoke-Test („qr“).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { qrCode } from "@freedomstack/protocol";
import { pruefeWerte } from "../src/shell/dialog.js";
import { QR_SICHTBAR_MS, SCAN_BREITE_MAX, leseQrAusBild, qrSvgDaten } from "../src/shell/qr-ui.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("SVG-Werte: Ruhezone von vier Modulen, Pfad nur aus Zahlen und Befehlen", () => {
  const code = "freedom-geraet:" + "ab".repeat(32) + ":" + "cd".repeat(32);
  const s = qrSvgDaten(code);
  assert.equal(qrCode(code).groesse, 49);
  assert.equal(s.groesse, 57);
  assert.equal(s.viewBox, "0 0 57 57");
  assert.match(s.d, /^(M\d+ \d+h\d+v1h-\d+z)+$/);
  assert.ok(s.d.startsWith("M4 4h7v1h-7z"), "Suchmuster beginnt nach dem Rand");
  // Werbelink mit Umlaut in der Lightning-Adresse: UTF-8
  assert.match(qrSvgDaten("https://beispiel.org/freedom.html?ref=" + "12".repeat(32) + "&ln=grüße@beispiel.org").d, /^M/);
});

test("Dialog: ein QR-Feld liefert keinen Wert und ist nie Pflicht", () => {
  assert.equal(pruefeWerte([{ art: "qr", name: "qr", label: "QR", wert: "x", geheim: true }], {}), null);
  assert.equal(pruefeWerte([{ art: "text", name: "c", label: "C", pflicht: true, scannen: true }], { c: " " })?.feld, "c");
});

test("Gerätecode: nur auf Klick, Warnung vorher, nach 60 s weg, nie gespeichert oder exportiert", () => {
  const qr = ohneKommentare(src("../src/shell/qr-ui.ts"));
  assert.equal(QR_SICHTBAR_MS, 60_000);
  assert.doesNotMatch(qr, /innerHTML|outerHTML|insertAdjacentHTML/, "nur DOM");
  assert.doesNotMatch(qr, /localStorage|sessionStorage|indexedDB|geheim\.|toDataURL|toBlob|createObjectURL|download|clipboard/, "nichts speichern, nichts exportieren");
  // Das Bild entsteht nur im Klick; die Warnung steht schon vorher da
  const knopf = qr.slice(qr.indexOf("export function qrKnopf("), qr.indexOf("interface Erkannt"));
  assert.match(knopf, /hinweis\.textContent = o\.geheim \? t\("qr\.geheimWarnung"\) : "";/);
  assert.equal((knopf.match(/qrSvg\(/g) ?? []).length, 1);
  assert.match(knopf, /\} catch \(e\) \{\s*hinweis\.textContent = fehlerText\(e\);/, "zu lang → Meldung statt Absturz");
  assert.ok(knopf.indexOf("qrSvg(") > knopf.indexOf('zeigen.addEventListener("click"'), "Bild erst nach dem Klick");
  assert.match(knopf, /if \(o\.geheim\) \{\s*hinweis\.textContent = t\("qr\.verschwindet", \{ s: QR_SICHTBAR_MS \/ 1000 \}\);\s*uhr = setTimeout\(verbirg, QR_SICHTBAR_MS\);/);
  // Settings: der Code nur als geheimer QR, der Schlüssel vorher genullt, kein prompt() mehr
  const settings = ["settings", "sicherung", "mesh"].map((d) => src(`../src/shell/tabs/${d}.ts`)).join("\n");
  const hinzu = settings.slice(settings.indexOf("async function fuegeGeraetHinzu("), settings.indexOf("async function entzieheGeraet("));
  assert.doesNotMatch(hinzu, /prompt\(|confirm\(|alert\(/);
  assert.ok(hinzu.indexOf("geraet.sk.fill(0);") < hinzu.indexOf("await dialog({\n      titel: t(\"set.geraetCodeTitel\""), "Schlüssel genullt, bevor der Code gezeigt wird");
  // Überall: ein QR mit dem Gerätecode nur geheim
  for (const datei of ["../src/shell/tabs/settings.ts", "../src/shell/tabs/sicherung.ts", "../src/shell/tabs/mesh.ts", "../src/shell/tabs/earn.ts", "../src/shell/app.ts"]) {
    for (const m of src(datei).matchAll(/art: "qr"[^}]*\}/g)) assert.match(m[0], /geheim: true/, datei);
  }
});

test("Kamera nur auf Klick und danach aus; ohne Erkennung ehrlich „einfügen“", () => {
  const qr = ohneKommentare(src("../src/shell/qr-ui.ts"));
  const scan = qr.slice(qr.indexOf("export function scanKnopf("));
  assert.equal((qr.match(/getUserMedia\(/g) ?? []).length, 1, "nur ein Aufruf");
  assert.ok(scan.indexOf("navigator.mediaDevices.getUserMedia(") > scan.indexOf('start.addEventListener("click"'), "erst nach dem Klick");
  // Seit A-20 überall, wo es eine Kamera-Schnittstelle gibt (jsQR, wo der Browser nichts erkennt) – ohne sie anzufragen
  assert.match(qr, /export async function kannScannen\(\): Promise<boolean> \{\n  return !!navigator\.mediaDevices\?\.getUserMedia;\n\}/, "kannScannen() fragt die Kamera nicht an");
  assert.match(scan, /strom\?\.getTracks\(\)\.forEach\(\(s\) => s\.stop\(\)\);/, "Stoppen beendet die Kamera");
  assert.match(scan, /if \(!box\.isConnected\) return stopp\(\);/, "Dialog zu → Kamera aus");
  assert.match(scan, /stopp\(t\("qr\.gelesen"\)\);/, "nach dem ersten Code aus");
  assert.match(scan, /if \(!ja\) hinweis\.textContent = t\("qr\.keinScan"\);/);
  assert.match(scan, /return stopp\(t\("qr\.keineKamera"\)\);/);
  // Verdrahtet: Import mit Scannen, Werbelink als QR (nicht geheim), Dialog bindet beides ein
  assert.match(src("../src/shell/app.ts"), /name: "eingabe", label: t\("ein\.importFrage"\), pflicht: true, mono: true, scannen: true/);
  assert.match(src("../src/shell/tabs/earn.ts"), /\$\("#referral-qr"\)\?\.replaceChildren\(qrKnopf\(link\.value, \{ beschriftung: t\("earn\.werbelinkQr"\) \}\)\);/);
  const dlg = src("../src/shell/dialog.ts");
  assert.match(dlg, /qrKnopf\(f\.wert, \{ beschriftung: f\.label, geheim: f\.geheim \}\)/);
  assert.match(dlg, /if \(f\.scannen\) box\.append\(scanKnopf\(e\)\);/);
});

/** Ein QR-Code als RGBA-Bild: `skala` Pixel je Modul, vier Module Ruhezone – wie vor einer Kamera. */
function bild(text: string, skala = 4, invertiert = false): { daten: Uint8ClampedArray; breite: number } {
  const q = qrCode(text);
  const breite = (q.groesse + 8) * skala;
  const daten = new Uint8ClampedArray(breite * breite * 4);
  for (let y = 0; y < breite; y++) {
    for (let x = 0; x < breite; x++) {
      const mx = Math.floor(x / skala) - 4;
      const my = Math.floor(y / skala) - 4;
      const dunkel = mx >= 0 && my >= 0 && mx < q.groesse && my < q.groesse && q.module[my]![mx]!;
      const wert = dunkel !== invertiert ? 0 : 255;
      daten.set([wert, wert, wert, 255], (y * breite + x) * 4);
    }
  }
  return { daten, breite };
}

test("A-20: jsQR liest einen echten QR-Code aus dem Bild – auch hell auf dunkel; Unsinn ergibt nichts", () => {
  const geraet = "freedom-geraet:" + "ab".repeat(32) + ":" + "cd".repeat(32);
  const b = bild(geraet);
  assert.equal(leseQrAusBild(b.daten, b.breite, b.breite), geraet);
  const werbung = "https://beispiel.org/freedom.html?ref=" + "12".repeat(32) + "&ln=grüße@beispiel.org";
  const w = bild(werbung, 3);
  assert.equal(leseQrAusBild(w.daten, w.breite, w.breite), werbung, "UTF-8 wie beim Zeigen");
  const inv = bild(geraet, 4, true);
  assert.equal(leseQrAusBild(inv.daten, inv.breite, inv.breite), geraet, "Bildschirm im Dunkelmodus");
  const rauschen = new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7919) % 251));
  assert.equal(leseQrAusBild(rauschen, 64, 64), null);
  assert.equal(leseQrAusBild(b.daten, b.breite, b.breite + 1), null, "Größe passt nicht zu den Daten");
  assert.equal(leseQrAusBild(new Uint8ClampedArray(0), 0, 0), null);
});

test("A-20: die Erkennung des Browsers zuerst, sonst jsQR – verkleinert, im Gerät, ohne Netz", () => {
  const qr = ohneKommentare(src("../src/shell/qr-ui.ts"));
  assert.equal(SCAN_BREITE_MAX, 640);
  assert.match(qr, /if \(K && \(await K\.getSupportedFormats\(\)\)\.includes\("qr_code"\)\) return new K\(\{ formats: \["qr_code"\] \}\);/);
  assert.match(qr, /return new JsQrErkenner\(\);/);
  assert.match(qr, /const f = Math\.min\(1, SCAN_BREITE_MAX \/ \(video\.videoWidth \|\| 1\)\);/);
  const scan = qr.slice(qr.indexOf("export function scanKnopf("));
  assert.ok(scan.indexOf("const erkenner = await waehleErkenner();") > scan.indexOf("await video.play();"), "erst wenn das Video läuft");
  assert.doesNotMatch(qr, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/, "das Bild geht nirgends hin");
  const pkg = JSON.parse(src("../package.json")) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies.jsqr, "1.4.0", "exakt gepinnt");
});
