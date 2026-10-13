/**
 * Schritt C-39b (Nutzertest E-2 bis E-5): Die eigenen Overlays sind Dialoge – für Vorleser und Tastatur –
 * und haben Abstand. Im Browser prüft es der Smoke-Test „overlay_dialog“ (Desktop und Handy).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const dialog = quelle("../src/shell/dialog.ts");

test("alsModal(): Rolle, aria-modal, Titel, Fokus – und frei, sobald die Hülle weg ist, gleich auf welchem Weg", () => {
  const als = dialog.slice(dialog.indexOf("export function alsModal("));
  assert.match(als, /karte\.setAttribute\("role", "dialog"\);\n\s+karte\.setAttribute\("aria-modal", "true"\);\n\s+beschrifte\(karte\);\n\s+const gibFrei = sperreApp\(\);/);
  assert.match(als, /if \(huelle\.isConnected\) return;\n\s+beobachter\.disconnect\(\);\n\s+gibFrei\(\);/);
});

test("die Sperre der App zählt alle offenen Dialoge – frei erst nach dem letzten, in jeder Reihenfolge", () => {
  assert.match(dialog, /if \(app && offen === 0\) app\.inert = false;/);
  // Bis C-39b merkte sich jeder Dialog den Stand vor ihm – schloss der erste zuerst, blieb die App gesperrt
  assert.doesNotMatch(dialog, /warInert/);
  assert.match(dialog, /if \(frei\) return;\n\s+frei = true;\n\s+offen--;/, "jede Freigabe zählt nur einmal");
});

test("jedes eigene Overlay geht durch alsModal()", () => {
  const app = quelle("../src/shell/app.ts");
  assert.match(app, /document\.body\.appendChild\(box\);\n\s+alsModal\(box, modal\);/, "Merkphrase");
  assert.match(quelle("../src/shell/tresor.ts"), /alsModal\(box, modal\);\n\s+return box;/, "Tresor");
  assert.match(quelle("../src/shell/notfall.ts"), /eingabe\.focus\(\);\n\s+alsModal\(box, modal\);/, "Notfall");
  const wallet = quelle("../src/shell/eingebaute-wallet.ts");
  assert.equal(wallet.match(/document\.body\.appendChild\(box\);\n\s+alsModal\(box, box\.firstElementChild as HTMLElement\);/g)?.length, 3, "eingebaute Wallet: drei");
  const ein = quelle("../src/shell/einrichtung-ui.ts");
  assert.match(ein, /document\.body\.appendChild\(box\);\n[^\n]*\n\s+alsModal\(box, box\);/, "Einrichtung");
  // Je Seite nach ihrer Überschrift benannt, der Fokus auf dem ersten Knopf
  assert.match(ein, /box\.replaceChildren\(karte\);\n\s+beschrifte\(box\);\n\s+karte\.querySelector<HTMLElement>\("button, select, input"\)\?\.focus\(\);/);
  // Keine eigenen Hüllen mehr ohne alsModal()
  for (const datei of ["shell/app.ts", "shell/tresor.ts", "shell/notfall.ts", "shell/eingebaute-wallet.ts"]) {
    const q = quelle(`../src/${datei}`);
    assert.equal((q.match(/"modal-backdrop"/g) ?? []).length, (q.match(/alsModal\(/g) ?? []).length, datei);
  }
});

test("Abstände und Knopfbreiten: in der Einrichtung untereinander und gleich breit, bei der Merkphrase nebeneinander", () => {
  const css = quelle("../src/shell/app.css");
  assert.match(css, /\.ein-knoepfe \{ display: flex; flex-direction: column; gap: 8px; margin-top: 16px; \}\n\.ein-knoepfe button \{ width: 100%; margin: 0;/);
  assert.match(css, /\.bk-knoepfe \{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; \}/);
  assert.match(css, /\.onboarding-card p \{ line-height: 1\.55; margin: 0 0 8px; \}/);
  const ein = quelle("../src/shell/einrichtung-ui.ts");
  assert.equal(ein.match(/knoepfe\(knopf\(/g)?.length, 4, "alle vier Seiten mit Knöpfen");
  assert.doesNotMatch(ein, /KNOPF_STIL|HAUPT_STIL/);
});
