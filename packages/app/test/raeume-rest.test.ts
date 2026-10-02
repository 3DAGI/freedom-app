/**
 * Räume – Rest aus dem Entwurf C.2 (Schritt C-13, Sammlung C-13): Leiste mit
 * Weltkugel für offene Räume, Punkt bei Ungelesenem und einem Tab-Halt mit
 * Pfeiltasten; im Verlauf die Linie „Neu“ am Lesestand; im Mitglieder-Menü
 * „Direktnachricht schreiben“. Der Smoke-Test („raum“) prüft alles im Browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");

test("C-13: Leiste – privat Schloss, offen Weltkugel; Name für Vorleser samt Art; aktuell nur, was vor Augen steht", () => {
  const leiste = raeume.slice(raeume.indexOf("export async function zeigeRaumLeiste("), raeume.indexOf("async function oeffneRaum("));
  assert.match(leiste, /b\.textContent = istPrivat\(id\) \? `🔒\$\{name\.slice\(0, 1\)\.toUpperCase\(\)\}` : `🌐\$\{name\.slice\(0, 1\)\.toUpperCase\(\)\}`;/);
  assert.match(leiste, /t\(istPrivat\(id\) \? "komm\.raumPrivatAria" : "komm\.raumOffenAria", \{ name \}\)/);
  assert.match(leiste, /b\.setAttribute\("aria-current", String\(vorAugen\(id\)\)\);/);
  // Eine Community ist aktuell, solange ihr Verlauf offen ist – auch nach dem Neuzeichnen der Leiste
  assert.match(leiste, /b\.setAttribute\("aria-current", String\(document\.querySelector<HTMLElement>\("\.comm-layout"\)\?\.dataset\.commMode === "dm" && activeConversation === c\.id\)\);/);
  setLang("de");
  assert.equal(t("komm.ungelesenAria", { raum: t("komm.raumOffenAria", { name: "garten" }) }), "Offener Raum garten, ungelesen");
  setLang("en");
});

test("C-13: Punkt bei Ungelesenem – nur Räume dieser Sitzung, nicht der, der vor Augen steht", () => {
  // Gemerkt beim Laden (Kanalliste) und beim Verlassen; nie eine Abfrage für Räume, die nicht offen waren
  assert.match(raeume, /if \(spacesUi\.spaceId\) ungelesen\.set\(spacesUi\.spaceId, \[\.\.\.badges\.values\(\)\]\.some\(\(b\) => b\.unread > 0\)\);/);
  const oeffne = raeume.slice(raeume.indexOf("async function oeffneRaum("));
  assert.ok(oeffne.indexOf("await merkeUngelesen()") < oeffne.indexOf("spacesUi.messages = [];"), "erst merken, dann leeren");
  assert.match(raeume, /const punkt = ungelesen\.get\(id\) === true && !vorAugen\(id\);/);
  // Zurück bei den Direktnachrichten zeichnet die Leiste neu – der Raum steht nicht mehr vor Augen
  assert.match(quelle("../src/shell/tabs/kommunikation.ts"), /loadChatList\(\);\s*\/\/[^\n]*\n\s*void zeigeRaumLeiste\(\);/);
});

test("C-13: Leiste mit einem Tab-Halt – Pfeiltasten, Pos1, Ende; kein tabindex > 0", () => {
  assert.match(raeume, /for \(const b of knoepfe\) b\.tabIndex = b === aktiv \? 0 : -1;/);
  assert.match(raeume, /e\.key === "ArrowDown" \|\| e\.key === "ArrowRight"/);
  assert.match(raeume, /e\.key === "Home" \? 0 : e\.key === "End" \? knoepfe\.length - 1 : -1/);
  assert.match(raeume, /document\.querySelector<HTMLElement>\("\.comm-rail"\)\?\.addEventListener\("keydown", railPfeile\);/);
});

test("C-13: Linie „Neu“ am Lesestand beim Betreten – nicht für eigene, nicht beim ersten Lesen, nicht im Thread", () => {
  assert.match(raeume, /if \(neuSeit\?\.kanal !== channelId\) neuSeit = \{ kanal: channelId, seit: spacesUi\.lastRead\.get\(channelId\) \?\? 0 \};/);
  // Ein anderer Raum vergisst ihn – Kanäle zweier Räume können gleich heißen
  assert.match(raeume, /spacesUi\.thread = null;\n\s+neuSeit = null;/);
  const gruppen = raeume.slice(raeume.indexOf("function verlaufGruppen("));
  assert.match(gruppen, /let neuGezeigt = !k\.neuSeit \|\| k\.imThread;/);
  assert.match(gruppen, /g\.nachrichten\.some\(\(m\) => m\.authorPubkey !== ich && m\.createdAt > k\.neuSeit!\)/);
  assert.match(gruppen, /el\("div", t\("raum\.neu"\), "msg-neu"\)/);
  assert.match(quelle("../src/shell/app.css"), /\.msg-neu \{[^}]*color: var\(--red-text\);/, "Rot als Schrift mit Kontrast (C-4)");
});

test("C-13: „Direktnachricht schreiben“ für jedes andere Mitglied – derselbe Weg wie eine neue Unterhaltung", () => {
  assert.match(raeume, /const schreiben: MenuePunkt = \{ text: t\("raum\.direktnachricht"\), tun: \(\) => oeffneDirektnachricht\(pk\) \};\s*return \[schreiben, \.\.\.rechteAktionen\(pk, gruender, can\)\];/);
  const komm = quelle("../src/shell/tabs/kommunikation.ts");
  assert.match(komm, /export function oeffneDirektnachricht\(id: string\): void \{/);
  assert.match(komm.slice(komm.indexOf("export async function newDm(")), /if \(!id\) return;\s*oeffneDirektnachricht\(id\);/, "newDm nutzt denselben Weg");
  const smoke = quelle("../../../scripts/smoke_test.py");
  assert.match(smoke, /erg\[groesse\]\["direktnachricht"\] = dm/);
  assert.match(smoke, /erg\[groesse\]\["leiste"\] = \{"vor_augen": vor_augen, "weg": weg, "pfeil": pfeil\}/);
});
