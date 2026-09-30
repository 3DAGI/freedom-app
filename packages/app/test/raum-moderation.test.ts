/**
 * Moderation in offenen Räumen (B-19): Ausblenden und Sperren gingen hinaus,
 * die Kanal-Ansicht wendete sie aber nicht an. Jetzt lädt die App sie mit dem
 * Raum, zählt nur Moderatoren des Raums (`raumModeration()`) und lässt eine
 * sichtbare Lücke: eine Zeile mit der Zahl, „anzeigen“ nur für die Sitzung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raeume = readFileSync(new URL("../src/shell/tabs/raeume.ts", import.meta.url), "utf8");

test("B-19: offene Räume laden Ausblenden und Sperren und wenden sie über raumModeration() an", () => {
  const oeffne = raeume.slice(raeume.indexOf("async function oeffneRaum("), raeume.indexOf("function zeigeRaumArt("));
  assert.match(oeffne, /pool\.query\(\{ kinds: \[KIND_MODERATION_HIDE, KIND_MODERATION_BAN\], "#h": \[kennung\], limit: 500 \}\),/);
  assert.match(oeffne, /spacesUi\.massnahmen = massnahmen;/);
  assert.match(oeffne, /if \(offen && spacesUi\.channelId === offen\) await oeffneKanal\(offen\);/, "der offene Kanal zeichnet neu");
  const sichtbar = raeume.slice(raeume.indexOf("function sichtbareNachrichten("), raeume.indexOf("/** Nach Abstimmen"));
  assert.match(sichtbar, /const mod = raumModeration\(st, spacesUi\.massnahmen as never\[\], spacesUi\.messages as never\[\]\);/);
  assert.match(sichtbar, /applyModeration\(spacesUi\.messages as never\[\], mod, \{ enabled: true \}\)/);
  assert.match(sichtbar, /zeile\.classList\.toggle\("hidden", weg === 0\);/, "die Lücke bleibt sichtbar");
  assert.doesNotMatch(sichtbar, /localStorage|innerHTML/, "„anzeigen“ nur für die Sitzung, nur Text");
  const kanal = raeume.slice(raeume.indexOf("async function oeffneKanal("), raeume.indexOf("/** Meldegründe"));
  assert.match(kanal, /const nachrichten = spacesUi\.privat \? spacesUi\.messages : sichtbareNachrichten\(st\);/, "privat löschen Moderatoren – dort bleibt es");
  assert.match(kanal, /buildThreads\(nachrichten as never\[\], kanal as never, st\)/);
  // Beim Raumwechsel nie die Maßnahmen des vorigen Raums
  assert.match(raeume, /spacesUi\.messages = \[\];\s*spacesUi\.massnahmen = \[\];/);
  assert.match(readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8"), /<div id="kanal-moderation" class="kanal-moderation mono-sm muted hidden" role="status"><\/div>/);
});
