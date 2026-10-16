/**
 * C-41 (Oberflächen-Review 15.10.2026): Ein Klick auf die Kennung im Profil kopierte den privaten
 * Schlüssel – ohne Zwischenablage stand er als Meldung im Bild. Jetzt kopiert der Klick nur die
 * öffentliche Kennung; den privaten Schlüssel gibt es nur über einen eigenen Knopf, erst nach einer
 * Warnung, nur im Dialog. Importieren ersetzt eine Identität nur nach Rückfrage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { einstieg as EINSTIEG } from "../src/texte/einstieg.js";
import { profil as PROFIL } from "../src/texte/profil.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = src("../src/shell/app.ts");
const ui = src("../src/shell/identitaet-ui.ts");
const html = src("../src/shell/index.html");

function funktion(text: string, kopf: string): string {
  const start = text.indexOf(kopf);
  assert.ok(start >= 0, `${kopf} nicht gefunden`);
  return text.slice(start, text.indexOf("\n}\n", start));
}

test("C-41: der Klick auf die Kennung kopiert nur die öffentliche (npub), nie den privaten Schlüssel", () => {
  assert.match(app, /nbIdent\.onclick = \(\) => void kopiereKennung\(\);/);
  assert.match(app, /if \(e\.key === "Enter" \|\| e\.key === " "\) \{ e\.preventDefault\(\); void kopiereKennung\(\); \}/);
  assert.doesNotMatch(app, /exportIdentity/, "die alte Funktion kopierte den privaten Schlüssel");
  const kopieren = funktion(ui, "export async function kopiereKennung(");
  assert.match(kopieren, /encodeNpub\(state\.keypair\.pk\)/);
  assert.doesNotMatch(kopieren, /mitRohemSchluessel|encodeNsec|toHex/);
  // „Teilen“ im Profil tut dasselbe, statt einen zweiten Weg daneben zu halten
  assert.match(app, /getElementById\("profile-share"\)\?\.addEventListener\("click", \(\) => void kopiereKennung\(\)\);/);
});

test("C-41: den privaten Schlüssel zeigt nur der eigene Knopf – erst die Warnung, dann nur im Dialog", () => {
  assert.match(html, /<button id="nb-export" class="ghost" type="button" data-i18n="profil\.skZeigen">/);
  assert.match(app, /\$\("#nb-export"\)\?\.addEventListener\("click", \(\) => void zeigePrivatenSchluessel\(\)\);/);
  const zeigen = funktion(ui, "export async function zeigePrivatenSchluessel(");
  const warnung = zeigen.indexOf("await bestaetige(");
  const roh = zeigen.indexOf("mitRohemSchluessel(");
  assert.ok(warnung > 0 && roh > warnung, "erst bestätigen, dann den Schlüssel leihen");
  assert.match(zeigen, /gefahr: true/);
  assert.match(zeigen, /if \(mitBunker\(\)\) \{ toast\(t\("ein\.nurImSigner"\), true\); return; \}/);
  assert.match(zeigen, /felder: \[\{ art: "nurlesen", name: "sk", label: t\("ein\.skFeld"\), wert: nsec \}\]/);
  // nie als Meldung, nie gespeichert, nie von selbst in die Zwischenablage
  assert.doesNotMatch(ui, /toast\([^)]*nsec/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|geheim\./);
  assert.doesNotMatch(zeigen, /clipboard/);
});

test("C-41: Importieren ersetzt eine vorhandene Identität nur nach Rückfrage", () => {
  const imp = funktion(app, "async function importIdentity(");
  const frage = imp.indexOf('await bestaetige({ titel: t("ein.ersetzenTitel")');
  const setzen = imp.indexOf("setzeIdentitaet(fromHex(hex)");
  assert.ok(frage > 0 && setzen > frage, "erst fragen, dann ersetzen");
  // Ausgenommen nur der Import im Willkommen (C-55a, `frisch`): Die Identität dort legte die App gerade selbst an
  assert.match(imp, /if \(state\.keypair && !frisch && !\(await bestaetige\(\{[^}]*gefahr: true \}\)\)\) return false;/);
});

test("C-41: die Texte sagen, was der Klick tut – in beiden Sprachen", () => {
  assert.match(PROFIL["profil.identText"]!.de, /ein Klick kopiert sie \(npub\)/);
  assert.doesNotMatch(PROFIL["profil.identText"]!.de, /kopiert den privaten/);
  assert.match(PROFIL["profil.identText"]!.en, /a click copies it \(npub\)/);
  assert.equal(PROFIL["profil.identTitel"]!.de, "Öffentliche Kennung – ein Klick kopiert sie");
  assert.match(EINSTIEG["ein.skWarnung"]!.de, /Nie weitergeben/);
  assert.match(EINSTIEG["ein.skWarnung"]!.en, /Never share it/);
  assert.equal(EINSTIEG["ein.nsecKopiert"], undefined, "der Text der alten Kopie ist weg");
});
