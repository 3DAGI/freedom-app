/**
 * Schritt C-55a (Oberflächen-Review 15.10.2026): Begrüßung vor der Merkphrase. Drei Sätze, „Loslegen“ und „Ich habe
 * schon eine Identität“; übernommen wird ohne die Rückfrage aus C-41 nur aus der Begrüßung (die neue Identität ist
 * unbenutzt), sonst wie bisher mit Rückfrage. Die Merkphrase kommt erst nach „Loslegen“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const ui = quelle("../src/shell/einrichtung-ui.ts");
const app = quelle("../src/shell/app.ts");

test("erst die Begrüßung, dann die Merkphrase – übernommen heißt: keine Merkphrase der neuen Identität", () => {
  const start = ui.slice(ui.indexOf("export async function zeigeEinrichtung("));
  assert.match(start, /const weg = p\.sichern \? await zeigeWillkommen\(p\.importieren\) : "los";/);
  assert.match(start, /merkphraseOffen: !!p\.sichern && weg === "los"/);
  assert.match(start, /if \(p\.sichern && weg === "los"\) await p\.sichern\(\);/);
  assert.ok(start.indexOf("zeigeWillkommen(") < start.indexOf("await p.sichern()"));
});

test("„Ich habe schon eine Identität“: ohne Rückfrage nur von hier; abgebrochen bleibt die Begrüßung", () => {
  assert.match(app, /importieren: \(\) => importIdentity\(true\)/);
  assert.match(app, /if \(state\.keypair && !frisch && !\(await bestaetige\(\{ titel: t\("ein\.ersetzenTitel"\)/);
  // Der Knopf in der Leiste übergibt kein Klick-Ereignis als „frisch“
  assert.match(app, /nbImport\.onclick = \(\) => void importIdentity\(\);/);
  const willkommen = ui.slice(ui.indexOf("function zeigeWillkommen("), ui.indexOf("// Über `style` (CSSOM)"));
  assert.match(willkommen, /void importieren\?\.\(\)\.then\(\(ok\) => \{ if \(ok\) \{ box\.remove\(\); fertig\("importiert"\); \} \}\);/);
  assert.match(willkommen, /alsModal\(box, karte\);/);
});

test("drei Sätze, ehrlich – verschlüsselt nur, was es ist", () => {
  setLang("de");
  assert.equal(t("ein.willkommenTitel"), "Willkommen bei FreedomStack");
  assert.match(t("ein.willkommen3"), /^Direktnachrichten und private Räume sind Ende-zu-Ende-verschlüsselt\./);
  assert.match(t("ein.willkommen3"), /verwahrt nie dein Geld/);
  assert.match(t("ein.willkommen2"), /Zwölf Wörter stellen ihn wieder her/);
  setLang("en");
  assert.equal(t("ein.loslegen"), "Get started");
  setLang("de");
});
