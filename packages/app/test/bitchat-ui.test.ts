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
  assert.match(ui, /if \(w && !alsGeraet\(\)\) await setzeBitchatTeilen\(Array\.isArray\(w\.teilen\) && w\.teilen\.includes\("ja"\)\);/);
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
