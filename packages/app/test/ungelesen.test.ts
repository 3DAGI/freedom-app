/**
 * Schritt C-30 (Nutzertest C-11): Ungelesenes in Direktnachrichten – fett in der
 * Liste, eine Marke „neu“, ein Zähler an „Chat“ in der Navigation. Zählt nur, was
 * das Gegenüber schrieb; gelesen ist, was vor Augen war.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ergaenzeGelesen, istUngelesen, zaehlerText, zahlUngelesen } from "../src/ungelesen.js";

test("ungelesen nur, wenn vom Gegenüber Neueres kam, als man zuletzt sah", () => {
  assert.equal(istUngelesen({}), false);
  assert.equal(istUngelesen({ eingang: 100 }), true);
  assert.equal(istUngelesen({ eingang: 100, gelesen: 100 }), false);
  assert.equal(istUngelesen({ eingang: 100, gelesen: 99 }), true);
  assert.equal(istUngelesen({ gelesen: 100 }), false);
});

test("Zähler: Unterhaltungen mit Neuem, ab 100 „99+“", () => {
  assert.equal(zahlUngelesen([{ eingang: 5 }, { eingang: 5, gelesen: 5 }, {}, { eingang: 9, gelesen: 1 }]), 2);
  assert.equal(zaehlerText(1), "1");
  assert.equal(zaehlerText(99), "99");
  assert.equal(zaehlerText(100), "99+");
});

test("alte Unterhaltungen (vor C-30) gelten bis zu ihrer letzten Nachricht als gelesen", () => {
  assert.deepEqual(ergaenzeGelesen({ lastTs: 50, eingang: 50 }), { lastTs: 50, eingang: 50, gelesen: 50 });
  // Neue aus dem Posteingang tragen gelesen: 0 – sie bleiben ungelesen
  assert.equal(istUngelesen(ergaenzeGelesen({ lastTs: 50, eingang: 50, gelesen: 0 })), true);
  // Nie angeschriebene ohne Zeit bleiben, wie sie sind
  assert.deepEqual(ergaenzeGelesen({ lastTs: 0 }), { lastTs: 0 });
});

test("verdrahtet: Posteingang zählt nur das Gegenüber, Öffnen und Sichtbares gelten als gelesen", () => {
  const ein = readFileSync(new URL("../src/shell/tabs/posteingang.ts", import.meta.url), "utf8");
  // Seit A-15a ordnet ordneEin() jeden Umschlag zu – aus dem Abgleich und aus dem Abo
  assert.match(ein, /const vomGegenueber = e\.ev\.pubkey !== \(sprichtFuer\(\) \?\? me\);/);
  assert.match(ein, /if \(eingang\) vorhanden\.eingang = e\.ev\.created_at;\n\s+return \{ neu: eingang, spaeter, \.\.\.frischVon \};/);
  assert.match(ein, /gelesen: 0, \.\.\.\(vomGegenueber \? \{ eingang: e\.ev\.created_at \} : \{\}\)/);
  assert.equal(ein.match(/markiereGelesen\(\);\n\s+saveConversations\(\);/g)?.length, 2, "nach dem Abgleich und nach Post aus dem Abo");
  const komm = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  // Öffnen zeigt (mobil) den Verlauf, erst dann zählt der Lesestand
  assert.match(komm, /activeConversation = cid;\n[^\n]*\n\s+document\.querySelector\("\.comm-layout"\)\?\.classList\.add\("thread-open"\);\n\s+if \(markiereGelesen\(cid\)\) saveConversations\(\);/);
  assert.match(komm, /\.map\(ergaenzeGelesen\)/);
  // vor Augen heißt: offen, Seite Kommunikation mit den Direktnachrichten, Fenster sichtbar, mobil der Verlauf
  assert.match(komm, /activeConversation === cid && !document\.hidden && !!document\.getElementById\("page-comm"\)\?\.classList\.contains\("active"\)/);
  assert.match(komm, /&& layout\?\.dataset\.commMode !== "space"/);
  assert.match(komm, /\(!window\.matchMedia\("\(max-width: 1023px\)"\)\.matches \|\| !!layout\?\.classList\.contains\("thread-open"\)\)/);
  // Zurück zur offenen Unterhaltung – über die Seite (loadChatList) oder ein wieder sichtbares Fenster
  assert.match(komm, /loadConversations\(\);\n[^\n]*\n\s+if \(markiereGelesen\(\)\) saveConversations\(\);/);
  assert.match(komm, /document\.addEventListener\("visibilitychange", \(\) => \{\n\s+if \(!document\.hidden && markiereGelesen\(\)\) \{ saveConversations\(\); loadChatList\(\); \}/);
});
