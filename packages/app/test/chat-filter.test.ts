/**
 * Schritt C-52b (Oberflächen-Review 15.10.2026): Filter in der Chat-Liste, Räume in der Liste, „Neu“ am Handy.
 * Räume kommen aus derselben Quelle wie die Leiste (`raeumeFuerListe()`), Namen nur als Text; ein Raum öffnet sich
 * wie aus der Leiste. Am Handy steht die Leiste nur im Raum – in der Liste ersetzen sie die Zeilen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const komm = quelle("../src/shell/tabs/kommunikation.ts");
const liste = quelle("../src/shell/tabs/chat-liste.ts");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const html = quelle("../src/shell/index.html");
const css = quelle("../src/shell/app.css");

test("vier Filter als Knöpfe mit aria-pressed, „Alle“ zuerst", () => {
  const filter = html.slice(html.indexOf('id="chat-filter"'), html.indexOf("</div>", html.indexOf('id="chat-filter"')));
  assert.deepEqual([...filter.matchAll(/data-filter="([a-z]+)" aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2]]),
    [["alle", "true"], ["direkt", "false"], ["raeume", "false"], ["ungelesen", "false"]]);
  assert.match(filter, /role="group"/);
  assert.match(liste, /x\.setAttribute\("aria-pressed", String\(x === b\)\)/);
  assert.match(komm, /wireChatListe\(loadChatList\);/);
});

test("Räume aus derselben Quelle wie die Leiste, Namen nur als Text", () => {
  assert.match(raeume, /export function raeumeFuerListe\(\): RaumEintrag\[\]/);
  assert.match(raeume, /rail\.replaceChildren\(\.\.\.communities, \.\.\.raeumeFuerListe\(\)\.map\(/);
  assert.match(raeume, /railTabHalt\(\);\n[^\n]*\n\s+zeigeRaeumeInListe\(\);/, "die Leiste zieht die Liste nach");
  const zeile = liste.slice(liste.indexOf("function raumZeile("), liste.indexOf("function communityZeile("));
  assert.match(zeile, /oben\.append\(el\("span", r\.name, "label"\)\);/);
  assert.doesNotMatch(zeile, /innerHTML|insertAdjacentHTML/);
  // Öffnen wie aus der Leiste: erst der Raum, dann der Modus – nie der Verlauf einer Unterhaltung
  assert.match(zeile, /waehleRaum\(r\.id\);\s*setzeKommModus\("space"\);/);
  assert.match(komm, /closest\("\.chat-item\[data-cid\]"\)\) layout\?\.classList\.add\("thread-open"\)/);
  assert.match(komm, /list\.querySelectorAll\("\.chat-item\[data-cid\]"\)\.forEach/);
});

test("Filter: Direkt ohne Räume, Räume ohne Direktnachrichten, Ungelesen nur Ungelesenes – je mit eigenem leeren Zustand", () => {
  assert.match(liste, /chatFilter === "alle" \|\| chatFilter === "direkt" \|\| \(chatFilter === "ungelesen" && istUngelesen\(c\)\)/);
  assert.match(komm, /const dms = conversations\.filter\(\(c\) => c\.type === "dm" && zeigtDm\(c\)\);/);
  assert.match(liste, /const mitRaeumen = chatFilter !== "direkt";/);
  assert.match(liste, /raeumeFuerListe\(\)\.filter\(\(r\) => chatFilter !== "ungelesen" \|\| r\.ungelesen\)/);
  const leer = liste.slice(liste.indexOf("export function zeigeRaeumeInListe("), liste.indexOf("function raumZeile("));
  assert.match(leer, /t\("chatFilter\.keinRaum"\), \{ text: t\("komm\.raumAnlegen"\), beiKlick: \(\) => document\.getElementById\("rail-create"\)\?\.click\(\) \}/);
  assert.match(leer, /t\("chatFilter\.allesGelesen"\)/);
  assert.match(leer, /t\("komm\.keineUnterhaltungen"\)/);
});

test("am Handy: Leiste nur im Raum, „Neu“ schwebend mit den drei bestehenden Wegen", () => {
  const handy = css.slice(css.indexOf("/* Mobil wie Discord: eine Ebene zur Zeit */"));
  assert.match(handy, /@media \(max-width: 760px\) \{[\s\S]*\.comm-layout\[data-comm-mode="dm"\] \.comm-rail \{ display: none; \}/);
  assert.match(handy, /\.comm-dm \.chat-fab \{[^}]*position: absolute;/);
  assert.match(css, /\.chat-fab \{ display: none; \}/, "auf dem Desktop kein Schwebeknopf");
  const neu = liste.slice(liste.indexOf('const neu = document.getElementById("chat-neu");'), liste.indexOf('t("chatNeu.aria")'));
  for (const ziel of ["chat-new-dm", "rail-create", "rail-join"]) assert.ok(neu.includes(`document.getElementById("${ziel}")?.click()`), ziel);
  assert.match(html, /<button id="chat-neu" class="chat-fab primaer" type="button" aria-haspopup="menu"/);
});
