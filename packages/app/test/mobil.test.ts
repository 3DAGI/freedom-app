/**
 * Schritt C.5a: Feinschliff Mobil – was der Browser-Test („mobil“) nicht
 * messen kann: Safe-Area (Chromium stellt keine Kerbe nach), die Tastatur-
 * Angabe im Viewport und dass die Kopfzeile kein Bild aus dem Netz lädt.
 * Seit C.5b: Hinweisleiste als DOM, gleiche Ränder auf allen Seiten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");
const css = lies("shell/app.css");
const mobil = css.slice(css.indexOf("/* ---------- Mobil (C.5a)"));

test("C.5a: Safe-Area für Kopfzeile, Inhalt und untere Leiste; Viewport lässt die Tastatur den Platz verkleinern", () => {
  assert.match(lies("shell/index.html"), /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*interactive-widget=resizes-content/);
  assert.match(mobil, /#app > header \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-left\)[^}]*env\(safe-area-inset-right\)/);
  assert.match(mobil, /#app > main \{ padding-left: env\(safe-area-inset-left\); padding-right: env\(safe-area-inset-right\); \}/);
  assert.match(mobil, /\.app-nav \{ padding-bottom: env\(safe-area-inset-bottom\);/);
  assert.match(mobil, /body\.tippt \.app-nav \{ display: none; \}/);
});

test("C.5a: Berührflächen mindestens 40 px unter 1024 px, Häkchen nie in voller Breite", () => {
  const block = mobil.slice(mobil.indexOf("@media (max-width: 1023px)"));
  assert.match(block, /#app button, #app select, #app \[role="tab"\], \.dlg-huelle button,\n\s+#app input:not\(\[type="checkbox"\]\)[^{]*\{ min-height: 40px; \}/);
  // Seit C.5b keine Mindestbreite für alle Knöpfe: sie höbe das Mindestmaß der Flex-Elemente auf, und die
  // Settings-Reiter schrumpften unter ihren Text (der Smoke-Test prüft seitdem auch übergelaufenen Text)
  assert.doesNotMatch(css, /#app button \{ min-width: 40px; \}/);
  assert.match(block, /\.comm-dm \.chat-side-head button \{ width: 40px; \}/);
  assert.match(mobil, /input\[type="checkbox"\], input\[type="radio"\] \{ width: 18px; height: 18px;/);
});

test("C.5a: Kopfzeile mit eigenem Bild nur als Anfangsbuchstabe – nie ein Bild aus dem Netz", () => {
  const ui = lies("shell/ui.ts");
  const zeige = ui.slice(ui.indexOf("export function zeigeIdent"), ui.indexOf("\n}\n", ui.indexOf("export function zeigeIdent")));
  assert.match(zeige, /e\.textContent = escrowIdent\(\);/, "der Schlüssel bleibt als Text");
  assert.match(zeige, /e\.dataset\.initial = /);
  assert.doesNotMatch(zeige, /picture|<img|src|fetch|new Image/);
  // Jede Stelle, die die Identität setzt, zeichnet die Kopfzeile über zeigeIdent()
  const app = lies("shell/app.ts");
  assert.doesNotMatch(app, /\$\("#ident"\)\.textContent =/);
  assert.equal((app.match(/zeigeIdent\(\);/g) ?? []).length, 4);
  // Ein neuer Profilname erscheint gleich in der Kopfzeile
  const profil = lies("shell/tabs/profil.ts");
  assert.equal((profil.match(/localStorage\.setItem\("freedom\.profile", [^;]+;\n\s+zeigeIdent\(\);/g) ?? []).length, 2);
  assert.match(css, /header \.ident::before \{\n\s+content: attr\(data-initial\);/);
});

test("C.5a: die untere Leiste weicht nur beim Tippen – Felder, die eine Tastatur öffnen", () => {
  const nav = lies("shell/navigation.ts");
  assert.match(nav, /document\.addEventListener\("focusin", tippt\);/);
  assert.match(nav, /document\.addEventListener\("focusout", \(\) => setTimeout\(tippt, 0\)\);/);
  const sel = nav.slice(nav.indexOf("export function tipptIn"));
  assert.match(sel, /textarea/);
  for (const art of ["checkbox", "radio", "range", "file", "button", "submit", "color"]) assert.match(sel, new RegExp(`:not\\(\\[type='${art}'\\]\\)`), art);
});

test("C.5b: Hinweisleiste als DOM – auf dem Handy nur Titel und Knöpfe, der Text klappt mit „mehr“ auf", () => {
  const app = lies("shell/app.ts");
  const ob = app.slice(app.indexOf("export async function zeigeOnboarding"), app.indexOf("\n}\n", app.indexOf("export async function zeigeOnboarding")));
  assert.doesNotMatch(ob, /innerHTML|insertAdjacentHTML/);
  assert.match(ob, /text\.textContent = schritt\.body;/);
  assert.match(ob, /mehr\.setAttribute\("aria-controls", "ob-body"\);/);
  assert.match(ob, /mehr\.setAttribute\("aria-expanded", String\(auf\)\);/);
  const b = css.slice(css.indexOf("/* ---------- Mobil (C.5b)"));
  assert.match(b, /#ob-mehr \{ display: none; \}/, "am Desktop steht der Text immer da");
  assert.match(b, /#onboarding-bar \.ob-body \{ display: none;/);
  assert.match(b, /#onboarding-bar\.ob-offen \.ob-body \{ display: block;/);
});

test("C.5b: Währung und Verdienen ohne eigenen Rand – Kopf und Inhalt setzen ihn wie auf allen Seiten", () => {
  assert.match(css, /#page-wallet, #page-earn \{ overflow-y: auto; \}/);
  assert.doesNotMatch(css, /#page-wallet, #page-earn \{[^}]*padding/);
});
