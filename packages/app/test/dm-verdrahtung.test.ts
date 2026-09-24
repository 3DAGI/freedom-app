/**
 * Verdrahtungs-Test fuer Schritt 2.1: Der Sendepfad der App nutzt NIP-17 und
 * nie mehr Kind 4, und die Konstante fuer den Datenschutzbericht passt dazu.
 *
 * Genau diese Luecke war frueher unbemerkt: gift-wrap.ts hatte 16 Tests,
 * verwendet wurde es nirgends – und der Bericht behauptete das Gegenteil.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");

function funktion(name: string): string {
  const start = app.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `Funktion ${name} nicht gefunden`);
  const naechste = app.indexOf("\nasync function ", start + 10);
  const naechste2 = app.indexOf("\nfunction ", start + 10);
  const ende = Math.min(...[naechste, naechste2].filter((x) => x > 0));
  return app.slice(start, ende);
}

test("sendChatMessage verschickt DMs nur per NIP-17", () => {
  const f = funktion("sendChatMessage");
  assert.match(f, /buildPrivateDm\(/);
  assert.doesNotMatch(f, /buildEvent\([^)]*,\s*4\s*,/, "kein Kind-4-Event im Sendepfad");
  assert.doesNotMatch(f, /encryptDM\(/, "kein direktes NIP-44-DM mehr");
});

test("nirgends in der App wird ein Kind-4-Event gebaut", () => {
  assert.doesNotMatch(app, /buildEvent\([^)]*,\s*4\s*,/);
});

test("die Konstante des Datenschutzberichts passt zum Sendepfad", () => {
  assert.match(app, /const DMS_GIFT_WRAPPED = true;/);
});

test("neue DMs wandeln npub um und pruefen die Eingabe", () => {
  const f = funktion("newDm");
  assert.match(f, /decodeNpub\(/);
  assert.match(f, /\[0-9a-f\]\{64\}/);
});
