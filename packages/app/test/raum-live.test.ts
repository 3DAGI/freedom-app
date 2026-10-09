/**
 * Schritt B-25 (Nutzertest 08.10., Befund R-9): Ein offener Raum zeigt Neues
 * anderer von selbst. Solange er gewählt ist, hält die App ein Abo auf seine
 * Nachrichten (42) und Maßnahmen (34551/34552) – ab dem Öffnen, nur für diesen
 * Raum, beendet beim Wechsel. Den Kanal zeichnet sie nur neu, wenn man ihn
 * sieht; sonst spränge der Lesestand auf jetzt. Das Verhalten im Browser prüft
 * der Smoke-Test („raum“, `live`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raeume = readFileSync(new URL("../src/shell/tabs/raeume.ts", import.meta.url), "utf8");
const block = (von: string, bis: string): string => {
  const a = raeume.indexOf(von);
  const b = raeume.indexOf(bis, a + von.length);
  assert.ok(a >= 0 && b > a, `${von} … ${bis}`);
  return raeume.slice(a, b);
};

test("B-25: das Abo gilt nur den Nachrichten und Maßnahmen dieses Raums, ab jetzt", () => {
  const lausche = block("async function lauscheImRaum(", "\n}\n");
  assert.match(lausche, /pool\.subscribe\(\{ kinds: \[KIND_CHANNEL_MESSAGE\], "#space": \[kennung\], since: seit \}/);
  assert.match(lausche, /pool\.subscribe\(\{ kinds: \[KIND_MODERATION_HIDE, KIND_MODERATION_BAN\], "#h": \[kennung\], since: seit \}/);
  assert.match(lausche, /const seit = Math\.floor\(Date\.now\(\) \/ 1000\);/);
  // Ein Event nur in den Raum, für den das Abo gilt, nie in einen privaten, nie doppelt
  assert.match(lausche, /if \(beendet \|\| spacesUi\.spaceId !== raum \|\| spacesUi\.privat\) return;/);
  assert.match(lausche, /\.some\(\(e\) => e\.id === ev\.id\)\) return;/);
  // Ein zweiter Aufruf für denselben Raum öffnet kein zweites Abo; ein spät angekommenes wird gleich beendet
  assert.match(lausche, /if \(liveAbo\?\.raum === raum\) return;\s*beendeLiveAbo\(\);/);
  assert.match(lausche, /for \(const s of ergebnisse\) if \(s\) \(beendet \? s\(\) : stopps\.push\(s\)\);/);
  // Kein Abfragetakt fürs Netz (6.4)
  assert.doesNotMatch(lausche, /setInterval|setTimeout/);
});

test("B-25: angelegt nur für offene Räume nach dem Laden, beendet beim Wechsel", () => {
  const oeffne = block("async function oeffneRaum(", "\n}\n");
  const wechsel = oeffne.indexOf("if (spacesUi.spaceId !== spaceId) {");
  assert.ok(wechsel >= 0 && oeffne.indexOf("beendeLiveAbo();", wechsel) > wechsel);
  assert.ok(oeffne.indexOf("beendeLiveAbo();") < oeffne.indexOf("await merkeUngelesen()"), "vor dem ersten await – kein Event des alten Raums danach");
  const privat = oeffne.indexOf("if (istPrivat(spaceId)) {");
  const lausche = oeffne.indexOf("void lauscheImRaum(adresse, kennung);");
  assert.ok(privat > 0 && lausche > oeffne.indexOf("return;\n  }\n  spacesUi.privat = null;"), "erst im Zweig des offenen Raums");
  assert.ok(lausche > oeffne.indexOf("spacesUi.messages = nachrichten;"), "nach dem Laden – was schon da war, kommt nicht doppelt");
  assert.equal(raeume.split("lauscheImRaum(").length - 1, 2, "eine Definition, ein Aufruf");
});

test("B-25: neu gezeichnet wird der Kanal nur, wenn man ihn sieht", () => {
  const zeichne = block("function zeichneLiveNeu(", "\n}\n");
  assert.match(zeichne, /if \(kanal && !document\.hidden && document\.getElementById\("channel-thread"\)\?\.offsetParent\) void oeffneKanal\(kanal\);\s*else void zeigeKanalliste\(\);/);
});
