/**
 * Verdrahtungs-Test fuer Schritt 2.1: Der Sendepfad der App nutzt NIP-17 und
 * nie mehr Kind 4, und die Konstante fuer den Datenschutzbericht passt dazu.
 *
 * Genau diese Luecke war frueher unbemerkt: gift-wrap.ts hatte 16 Tests,
 * verwendet wurde es nirgends – und der Bericht behauptete das Gegenteil.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Seit Schritt 1.0 ist app.ts auf mehrere Module verteilt (state.ts, ui.ts,
// tabs/…). Geprueft wird deshalb die ganze Shell, nicht mehr nur app.ts.
function shellDateien(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "shims" ? [] : shellDateien(new URL(`${e.name}/`, dir));
    return e.name.endsWith(".ts") ? [readFileSync(new URL(e.name, dir), "utf8")] : [];
  });
}
const app = shellDateien(new URL("../src/shell/", import.meta.url)).join("\n");

function funktion(name: string): string {
  const start = app.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `Funktion ${name} nicht gefunden`);
  // Ende: die naechste Funktion auf oberster Ebene, exportiert oder nicht
  const rest = app.slice(start + 10).search(/\n(export )?(async )?function /);
  return app.slice(start, rest < 0 ? undefined : start + 10 + rest);
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
