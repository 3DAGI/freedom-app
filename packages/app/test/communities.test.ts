/**
 * Communities nach Entscheidung E3 b (Schritt C-10, Sammlung C-10): keine
 * neuen mehr – Gruppen sind offene oder private Räume. Bestehende stehen als
 * „Community (offen)“ in der Raum-Leiste, nicht unter den Direktnachrichten.
 * Kein Format ändert sich (Kind 42 mit `h`-Tag wie bisher).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("C-10: keine neuen Communities – kein Knopf, keine Funktion, kein Text dafür", () => {
  assert.doesNotMatch(quelle("../src/shell/index.html"), /chat-new-community|komm\.neueCommunity/);
  const komm = quelle("../src/shell/tabs/kommunikation.ts");
  assert.doesNotMatch(komm, /function newCommunity\(|type: "community", name/, "nichts legt eine Community an");
  assert.doesNotMatch(quelle("../src/shell/app.ts"), /newCommunity/);
  const texte = quelle("../src/texte/kommunikation.ts");
  assert.doesNotMatch(texte, /"komm\.neueCommunity"|"komm\.communityName"/);
});

test("C-10: bestehende Communities in der Raum-Leiste, nicht unter den Direktnachrichten", () => {
  const komm = quelle("../src/shell/tabs/kommunikation.ts");
  assert.match(komm, /const dms = conversations\.filter\(\(c\) => c\.type === "dm"\);/);
  assert.match(komm, /list\.replaceChildren\(\.\.\.dms\s*\.sort/);
  assert.match(komm, /export function oeffneCommunity\(id: string\): void \{\s*setzeKommModus\("dm"\);\s*openConversation\(id\);/);
  const raeume = quelle("../src/shell/tabs/raeume.ts");
  const leiste = raeume.slice(raeume.indexOf("export async function zeigeRaumLeiste("), raeume.indexOf("async function oeffneRaum("));
  assert.match(leiste, /conversations\.filter\(\(c\) => c\.type === "community"\)/);
  assert.match(leiste, /b\.title = t\("komm\.communityOffen", \{ name: c\.name \}\);/);
  assert.match(leiste, /oeffneCommunity\(c\.id\);/);
  assert.match(leiste, /rail\.replaceChildren\(\.\.\.communities, \.\.\.ids\.map/, "auch ohne Räume");
  assert.doesNotMatch(leiste, /innerHTML/, "der Name ist lokal, aber nur als Text");
  // Der Hinweis nennt die Community offen und verweist auf Räume
  setLang("de");
  assert.equal(t("komm.communityOffen", { name: "Garten" }), "Community (offen): Garten");
  assert.match(t("komm.community"), /^Community \(offen\) – .*Räume\.$/);
  setLang("en");
  assert.match(t("komm.community"), /rooms\.$/);
  // Im Browser (Smoke „fremdtext“): eine gemerkte Community steht in der Leiste und öffnet ihren Verlauf
  assert.match(quelle("../../../scripts/smoke_test.py"), /erg\["community"\]/);
});
