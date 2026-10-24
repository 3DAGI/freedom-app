/**
 * B-36c3: Bitchat in der Oberfläche – nur in der Android-Hülle, an und aus nur auf Klick, Zustimmung nur als Person, jeder
 * Stand der Hülle mit Text; Direktnachrichten über Bitchat sagen „gegeben“, nicht „angekommen“. Was im Browser geschieht,
 * prüft der Smoke-Test („bitchat“) mit einer Attrappe der Hülle.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BITCHAT_STAENDE } from "../src/shell/bitchat-huelle.js";
import { getLang, setLang, t } from "../src/i18n.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("B-36c3: Knöpfe und Hinweis nur in der Android-Hülle – versteckt in index.html, sichtbar erst mit bitchatAufruf()", () => {
  const html = lies("shell/index.html");
  for (const id of ["mesh-bitchat", "mesh-bitchat-kontakte", "mesh-bitchat-hinweis"]) {
    assert.match(html, new RegExp(`id="${id}" class="[^"]*\\bhidden\\b`), id);
  }
  const mesh = lies("shell/tabs/mesh.ts");
  const teil = mesh.slice(mesh.indexOf('const bitchat = $("#mesh-bitchat");'));
  assert.match(teil, /^const bitchat = \$\("#mesh-bitchat"\);\n  const bitchatKontakte = \$\("#mesh-bitchat-kontakte"\);\n  if \(bitchat && bitchatKontakte && bitchatAufruf\(\)\) \{/);
  assert.match(teil, /bitchat\.onclick = async \(\) => \{\n      const \{ bitchatKnopf \} = await import\("\.\.\/bitchat-ui\.js"\);\n      await bitchatKnopf\(bitchat, \$\("#mesh-status"\)\);/, "gestartet wird nur im Klick");
  assert.doesNotMatch(mesh, /starteBitchat/, "beim Laden des Reiters startet nichts");
});

test("B-36c3: an nur mit offenem Tresor (Identität in geheim), eine kaputte Identität schaltet Bluetooth wieder aus", () => {
  const ui = lies("shell/bitchat-ui.ts");
  const knopf = ui.slice(ui.indexOf("export async function bitchatKnopf"), ui.indexOf("export async function bitchatKontakteDialog"));
  const sperre = knopf.indexOf("if (tresorEingerichtet() && !tresorOffen()) return toast(");
  assert.ok(sperre > 0 && sperre < knopf.indexOf("await starteBitchat()"), "erst der Tresor, dann der Start");
  assert.match(knopf, /\} catch \{\n[^\n]*\n    await stoppeBitchat\(\);\n    zeige\(t\("set\.bitchatIdentitaet"\)\);/);
  assert.match(knopf, /if \(bitchatLaeuft\(\)\) \{\n    await stoppeBitchat\(\);/, "ein zweiter Klick hält an");
});

test("B-36c3: jeder Stand der Hülle hat einen Satz in beiden Sprachen", () => {
  const ui = lies("shell/bitchat-ui.ts");
  const block = ui.slice(ui.indexOf("const STAND_TEXT"), ui.indexOf("};", ui.indexOf("const STAND_TEXT")));
  const vorher = getLang();
  try {
    for (const s of BITCHAT_STAENDE) {
      const m = new RegExp(`\\n  "?${s}"?: "(set\\.bitchat[A-Za-z]+)",`).exec(block);
      assert.ok(m, `kein Text für „${s}“`);
      for (const sprache of ["de", "en"] as const) {
        setLang(sprache);
        assert.notEqual(t(m[1]!), m[1], `${s} (${sprache})`);
      }
    }
  } finally {
    setLang(vorher);
  }
});

test("B-36c3: Zustimmung nur als Person, gezeigt wird die Nähe nur über Namen; DM über Bitchat heißt „gegeben“", () => {
  const ui = lies("shell/bitchat-ui.ts");
  assert.match(ui, /\.\.\.\(alsGeraet\(\) \? \[\] : \[\n\s+\{ art: "mehrfach" as const, name: "teilen"/);
  assert.match(ui, /if \(!w\) return;\n  if \(!alsGeraet\(\)\) await setzeBitchatTeilen\(Array\.isArray\(w\.teilen\) && w\.teilen\.includes\("ja"\)\);/, "seit B-36e2 nach dem Abbruch-Fall");
  assert.match(ui, /bitchatInDerNaehe\(\)\.map\(kontaktName\)/, "Schlüssel nie roh");
  assert.doesNotMatch(ui, /localStorage|innerHTML/);
  const weg = lies("shell/bitchat-weg.ts");
  assert.match(weg, /const hinaus = lauf\?\.sende\([^\n]+\n  if \(hinaus\) toast\(t\("set\.bitchatDm"\)\);\n  return hinaus;/);
  const vorher = getLang();
  try {
    setLang("de");
    assert.match(t("set.bitchatDm"), /gegeben$/);
    assert.doesNotMatch(t("set.bitchatDm"), /angekommen|zugestellt/);
  } finally {
    setLang(vorher);
  }
});

test("B-36c4: hält die Hülle von selbst an, hält die App sie ganz an, und der Knopf folgt", () => {
  const weg = lies("shell/bitchat-weg.ts");
  const takt = weg.slice(weg.indexOf("function takt("), weg.indexOf("function halt("));
  assert.match(takt, /if \(weiter\) return takt\(l\);\n(?:\s*\/\/[^\n]*\n)*\s*halt\(true\);\n\s*void bitchatStoppen\(\);/, "sonst bliebe der Dienst sichtbar");
  assert.match(weg, /const war = lauf;\n  lauf = null;\n  if \(war\) beimHalt\?\.\(vonSelbst\);/, "nur ein laufender Lauf meldet sich");
  const halte = weg.slice(weg.indexOf("export async function stoppeBitchat"));
  assert.match(halte, /^export async function stoppeBitchat\(\): Promise<void> \{\n  halt\(\);/, "angehalten auf Klick ist nicht „von selbst“");
  const ui = lies("shell/bitchat-ui.ts");
  const knopf = ui.slice(ui.indexOf("export async function bitchatKnopf"), ui.indexOf("export async function bitchatKontakteDialog"));
  const melde = knopf.indexOf("wennBitchatHaelt((vonSelbst) => {");
  assert.ok(melde > 0 && melde < knopf.indexOf("await starteBitchat()"), "vor dem Start angemeldet");
  assert.match(knopf, /if \(vonSelbst\) zeige\(t\("set\.bitchatVonSelbstAus"\)\);/);
});

test("B-36e2: Code beim Treffen – eigener nur als Person, fremder nur geprüft, ein Neuer erst nach Rückfrage", () => {
  const ui = lies("shell/bitchat-ui.ts");
  const dlg = ui.slice(ui.indexOf("export async function bitchatKontakteDialog"), ui.indexOf("async function uebernimmKarte"));
  assert.match(dlg, /const karte = await eigeneBitchatKarte\(\)\.catch\(\(\) => null\);/);
  assert.match(dlg, /\.\.\.\(karte \? \[\{ art: "qr" as const, name: "karte", label: t\("set\.bitchatKarte"\), wert: karte \}\] : \[\]\),/, "nur auf Klick, ohne Code kein Feld");
  assert.match(dlg, /\{ art: "text" as const, name: "gescannt", label: t\("set\.bitchatKarteScannen"\), mono: true, scannen: true \}/);
  assert.match(dlg, /return !r \? t\("set\.bitchatKarteFalsch"\) : r\.von === ich \? t\("set\.bitchatKarteEigene"\) : null;/, "der Dialog bleibt offen");
  assert.match(dlg, /const r = leseBitchatKarte\(String\(w\.gescannt \?\? ""\)\);\n  if \(r && r\.von !== ich\) await uebernimmKarte\(r\);/);
  const uebernimm = ui.slice(ui.indexOf("async function uebernimmKarte"));
  const frage = uebernimm.indexOf("await bestaetige({");
  assert.ok(frage > 0 && frage < uebernimm.indexOf("legeKontaktAn(r.von)") && uebernimm.indexOf("legeKontaktAn(r.von)") < uebernimm.indexOf("await nimmBitchatKarte(r)"),
    "erst fragen, dann anlegen, dann merken");
  assert.match(uebernimm, /if \(!kontakteJetzt\(\)\.includes\(r\.von\)\) \{\n    if \(!\(await bestaetige\([^\n]+\)\)\) return;/, "abgelehnt: nichts gemerkt");
  const glue = lies("shell/bitchat-kontakte.ts");
  assert.match(glue, /export async function eigeneBitchatKarte\(\): Promise<string \| null> \{\n  if \(alsGeraet\(\) \|\| !state\.signer\) return null;/, "die Signatur gehört der Person");
  assert.match(glue, /return baueBitchatKarte\(\{ von: state\.signer, noise: k\.noise, signier: k\.signier \}\);/);
  assert.doesNotMatch(`${ui}\n${glue}`, /publish\(|veroeffentlicheAn\(eigene|localStorage/, "die Karte geht nie an ein Relay");
  const komm = lies("shell/tabs/kommunikation.ts");
  assert.match(komm, /export function oeffneDirektnachricht\(id: string\): void \{\n  legeKontaktAn\(id\);/, "dieselbe Stelle legt an");
});
