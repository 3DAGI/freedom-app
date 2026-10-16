/**
 * Schritt C-59 (Oberflächen-Review 15.10.2026): Rückmeldungen. Meldungen einheitlich und für Vorleser über eine
 * Ansage, Skelette statt „—“, solange ein Stand unterwegs ist, Übergänge für Blatt, Popover und Dialoge – bei
 * „weniger Bewegung“ keine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOAST_FEHLER_MS, TOAST_MS } from "../src/shell/ui.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const css = quelle("../src/shell/app.css");
const ui = quelle("../src/shell/ui.ts");
const html = quelle("../src/shell/index.html");

test("Toast: eine Uhr – die neue Meldung ersetzt die alte samt Uhr, Fehler stehen länger, ein Klick schließt", () => {
  const f = ui.slice(ui.indexOf("export function toast("), ui.indexOf("export function ladend("));
  assert.match(f, /clearTimeout\(toastUhr\);[\s\S]*toastUhr = setTimeout\(\(\) => \{ box\.hidden = true; \}, isErr \? TOAST_FEHLER_MS : TOAST_MS\);/);
  assert.match(f, /box\.onclick = \(\) => \{ clearTimeout\(toastUhr\); box\.hidden = true; \};/);
  assert.doesNotMatch(f, /style\.display/);
  assert.ok(TOAST_FEHLER_MS > TOAST_MS && TOAST_MS >= 4000);
});

test("Toast für Vorleser: sichtbare Meldung verborgen, gesagt über Ansage (status) und Alarm (alert)", () => {
  assert.match(html, /<div id="toast" aria-hidden="true" hidden><\/div>/);
  assert.match(html, /<div id="toast-ansage" class="visually-hidden" role="status"><\/div>/);
  assert.match(html, /<div id="toast-alarm" class="visually-hidden" role="alert"><\/div>/);
  assert.match(ui, /document\.getElementById\(isErr \? "toast-alarm" : "toast-ansage"\)/);
  // Zeichen nur fürs Auge: der Alternativtext der Zeichen ist leer
  assert.match(css, /#toast::before \{ content: "✓" \/ "";/);
  assert.match(css, /#toast\.err::before \{ content: "!" \/ "";/);
});

test("Skelett statt „—“, solange ein Stand unterwegs ist – „—“ heißt nur noch „kein Wert“", () => {
  const f = ui.slice(ui.indexOf("export function ladend("));
  assert.match(f, /el\("span", undefined, "skelett-zeile skelett-wert"\)/);
  assert.match(f, /setAttribute\("role", "status"\)/);
  assert.match(f, /beschriftung = t\("bau\.laedt"\)/);
  const gesamt = quelle("../src/shell/wallet-gesamt-ui.ts");
  assert.match(gesamt, /type Stand = number \| null \| "laedt";/);
  assert.match(gesamt, /if \(laedt\.length\) \{\s*if \(einrichten\) einrichten\.hidden = true;\s*ladend\(zahl\);/);
  assert.match(quelle("../src/shell/tabs/waehrung.ts"), /merkeStand\("ln", "laedt"\);\s*ladend\(\$\("#ln-balance"\)\);/);
  assert.match(quelle("../src/shell/tabs/waehrung.ts"), /merkeStand\("solBrowser", "laedt"\);/);
  assert.match(quelle("../src/shell/eingebaute-wallet.ts"), /merkeStand\("solEingebaut", "laedt"\);/);
  const verdienst = quelle("../src/shell/verdienst-ui.ts");
  assert.match(verdienst, /if \(stand\) ladend\(stand\);/);
  assert.match(verdienst, /if \(stand\?\.querySelector\("\.skelett-wert"\)\) stand\.textContent = "—";/);
});

test("Übergänge: Blatt von unten, Popover und Dialoge blenden ein – bei „weniger Bewegung“ keine", () => {
  for (const k of ["fs-pop", "fs-blatt", "fs-blende"]) assert.match(css, new RegExp(`@keyframes ${k} \\{`));
  assert.match(css, /\.ai-optionen, \.menue-schwebend \{ animation: fs-pop/);
  assert.match(css, /\.modal-backdrop \{ animation: fs-blende/);
  assert.match(css, /@media \(max-width: 760px\) \{ \.ai-optionen \{ animation: fs-blatt/);
  const ruhig = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(ruhig, /#toast, \.ai-optionen, \.menue-schwebend, \.modal-backdrop, \.modal-backdrop \.modal \{ animation: none; \}/);
});

test("Smoke: Teil „rueckmeldung“ eingetragen", () => {
  const smoke = quelle("../../../scripts/smoke_test.py");
  assert.match(smoke, /erg\["rueckmeldung"\] = rueckmeldung_pruefen\(browser,/);
  assert.match(smoke, /and erg\.get\("rueckmeldung", \{\}\)\.get\("bestanden"\) is True/);
});
