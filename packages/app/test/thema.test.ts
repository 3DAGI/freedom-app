/**
 * Schritt C-57b (Oberflächen-Review 15.10.2026): helles Design, Wahl Wie das Gerät · Hell · Dunkel – Standard das Gerät.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leseThema, themaAttribut, THEMA_SCHLUESSEL, THEMEN } from "../src/thema.js";
import { SICHERUNG_EINTRAEGE } from "@freedomstack/protocol";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");

test("gespeicherte Wahl: nur hell und dunkel, alles andere ist das Gerät", () => {
  assert.equal(leseThema("hell"), "hell");
  assert.equal(leseThema("dunkel"), "dunkel");
  for (const x of [null, undefined, "", "system", "light", "dark", "HELL", " hell"]) assert.equal(leseThema(x), "system", String(x));
  assert.deepEqual(THEMEN, ["system", "hell", "dunkel"]);
});

test("data-theme nur bei fester Wahl – sonst entscheidet das CSS nach dem Gerät", () => {
  assert.equal(themaAttribut("system"), null);
  assert.equal(themaAttribut("hell"), "hell");
  assert.equal(themaAttribut("dunkel"), "dunkel");
});

test("nur auf diesem Gerät: nicht in der Sicherung", () => {
  assert.equal(THEMA_SCHLUESSEL, "freedom.thema");
  assert.ok(!SICHERUNG_EINTRAEGE.includes(THEMA_SCHLUESSEL));
});

test("verdrahtet: vor allem anderen in boot(), zwei Auswahlen (Settings, Mehr) mit allen drei Werten", () => {
  const app = quelle("../src/shell/app.ts");
  assert.match(app, /export function boot\(\): void \{\n(?:\s*\/\/[^\n]*\n)*\s*themaBeimStart\(\);/);
  assert.match(app, /setupLangMenu\(\);\n\s*wireThemaWahl\(\);/);
  const html = quelle("../src/shell/index.html");
  const wahlen = [...html.matchAll(/<select data-thema-wahl>([\s\S]*?)<\/select>/g)];
  assert.equal(wahlen.length, 2);
  for (const [, optionen] of wahlen) assert.deepEqual([...optionen.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]), [...THEMEN]);
  assert.match(html, /<label class="thema-wahl"><span data-i18n="set.design">/);
  assert.match(html, /<label class="mehr-zeile mehr-thema">/);
  const ui = quelle("../src/shell/thema-ui.ts");
  assert.match(ui, /if \(thema === "system"\) localStorage\.removeItem\(THEMA_SCHLUESSEL\);/);
});
