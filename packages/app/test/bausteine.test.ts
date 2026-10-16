/**
 * Schritt C-56a (Oberflächen-Review 15.10.2026): gemeinsame Bausteine. Chip und Skelett sind neu (Klasse und Helfer),
 * die übrigen stehen in `docs/ausbau/BAUSTEINE.md` mit ihrer Klasse – jede dort genannte Klasse gibt es in app.css.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const css = quelle("../src/shell/app.css");
const ui = quelle("../src/shell/ui.ts");

test("Chip: Klasse mit aria-pressed, Helfer setzt Typ und Zustand, Text nur als Text", () => {
  assert.match(css, /\.chip \{[^}]*border-radius: 999px;/);
  assert.match(css, /\.chip\[aria-pressed="true"\] \{ background: var\(--accent\); color: #000;/);
  const f = ui.slice(ui.indexOf("export function chip("), ui.indexOf("export function skelett("));
  assert.match(f, /const b = el\("button", text, klasse \? `chip \$\{klasse\}` : "chip"\);/);
  assert.match(f, /b\.type = "button";\s*b\.setAttribute\("aria-pressed", String\(gedrueckt\)\);/);
});

test("Skelett: Zeilen mit role=status, ohne Bewegung bei „weniger Bewegung“", () => {
  const f = ui.slice(ui.indexOf("export function skelett("), ui.indexOf("export function toast("));
  assert.match(f, /box\.setAttribute\("role", "status"\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.skelett-zeile \{ animation: none; \} \}/);
});

test("benutzt: Filter und Wort-Chips sind Chips, „Einnahmen“ lädt mit Skelett", () => {
  assert.equal((quelle("../src/shell/index.html").match(/<button type="button" class="chip" data-filter=/g) ?? []).length, 4);
  assert.match(quelle("../src/shell/app.ts"), /const chip = baueChip\(w, false, "wort-chip"\);/);
  assert.match(quelle("../src/shell/tabs/earn.ts"), /box\.replaceChildren\(skelett\(3, t\("earn\.lade"\)\)\);/);
});

test("jede Klasse aus BAUSTEINE.md gibt es in app.css", () => {
  const doku = quelle("../../../docs/ausbau/BAUSTEINE.md");
  // `.klasse`, `input.klasse`, `details.klasse` – Dateinamen wie `app.css` zählen nicht
  const klassen = [...doku.matchAll(/`(?:input|details|button)?\.([a-z][a-z0-9-]*)`/g)].map((m) => m[1]!);
  assert.ok(klassen.length >= 8, `${klassen.length} Klassen`);
  for (const k of new Set(klassen)) assert.match(css, new RegExp(`\\.${k}\\b`), k);
});
