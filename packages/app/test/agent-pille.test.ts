/**
 * Schritt C-49a (Oberflächen-Review 15.10.2026): Die Eingabe des Agenten als Pille – oben der Text,
 * darunter „+“ (Anhänge und Werkzeuge mit Preis), gewählte Werkzeuge als Chips, Modell und Senden.
 * Im Browser prüft es der Smoke-Teil „agent_klein“ (Menü, Chip, „×“, Escape).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const html = quelle("../src/shell/index.html");
const pille = html.slice(html.indexOf('<div class="eingabe-pille">'), html.indexOf('<div class="composer-meta">'));

test("eine Pille: Text oben, darunter „+“, Auswahl, Modell, Senden – die Werkzeuge mit Preis im Menü", () => {
  assert.ok(pille.length > 0);
  const reihenfolge = ['id="ai-prompt"', 'id="attach-btn"', 'id="attach-menu"', 'class="tool-row"', 'id="werkzeug-auswahl"', 'id="ai-model-btn"', 'id="ai-send"'];
  const stellen = reihenfolge.map((s) => pille.indexOf(s));
  assert.ok(stellen.every((x) => x >= 0), JSON.stringify(stellen));
  assert.deepEqual([...stellen].sort((a, b) => a - b), stellen, "in dieser Reihenfolge");
  // Die Werkzeuge stehen im Menü, nicht mehr als eigene Reihe über der Eingabe
  const menue = pille.slice(pille.indexOf('id="attach-menu"'), pille.indexOf('id="werkzeug-auswahl"'));
  assert.equal((menue.match(/class="tool-chip"/g) ?? []).length, 4);
  assert.match(pille, /id="attach-btn"[^>]*aria-haspopup="true" aria-expanded="false" aria-controls="attach-menu"/);
  assert.doesNotMatch(html, /class="attach-row"|class="composer-row"/);
});

test("gewählte Werkzeuge als Chips – „×“ klickt den Knopf im Menü, eine Liste bleibt die Wahrheit", () => {
  const eingabe = quelle("../src/shell/tabs/agent-eingabe.ts");
  const fn = eingabe.slice(eingabe.indexOf("function zeigeWerkzeugAuswahl("), eingabe.indexOf("\n}\n", eingabe.indexOf("function zeigeWerkzeugAuswahl(")));
  assert.match(fn, /document\.querySelectorAll<HTMLElement>\("\.tool-chip\.active"\)/);
  assert.match(fn, /b\.addEventListener\("click", \(\) => chip\.click\(\)\);/);
  assert.match(fn, /b\.setAttribute\("aria-label", t\("agent\.werkzeugWeg", \{ name \}\)\);/);
  assert.doesNotMatch(fn, /selectedTools|innerHTML/);
  assert.match(eingabe, /zeigeVideoOpts|opts\.classList\.toggle\("hidden", !videoActive\);\n\s+zeigeWerkzeugAuswahl\(\);/);
  // Menü: aria-expanded, Escape schließt, ein Klick im Menü schließt es nicht
  assert.match(eingabe, /btn\.setAttribute\("aria-expanded", String\(auf\)\);/);
  assert.match(eingabe, /if \(e\.key === "Escape" && !menu\.classList\.contains\("hidden"\)\) \{ setze\(false\); btn\.focus\(\); \}/);
  assert.match(eingabe, /menu\.addEventListener\("click", \(e\) => e\.stopPropagation\(\)\);/);
});

test("C-49b: Stufe, Gebot, „privat“ und „über Funk“ im Popover – unter der Eingabe nur der Stand; „Privat“ bleibt sichtbar", () => {
  const optionen = html.slice(html.indexOf('<div class="optionen-wrap">'), html.indexOf('<div class="model-picker-wrap">'));
  for (const id of ["ai-tier", "bid-wrap", "ai-bid", "ai-schiene", "ai-privat-wahl", "ai-funk-wahl"]) assert.match(optionen, new RegExp(`id="${id}"`), id);
  assert.match(optionen, /id="ai-optionen-btn"[^>]*aria-haspopup="true" aria-expanded="false" aria-controls="ai-optionen"/);
  const meta = html.slice(html.indexOf('<div class="composer-meta">'), html.indexOf("</div>", html.indexOf('<div class="composer-meta">')));
  // Der Gratis-Stand steht seit C-49c als Chip in der Eingabe
  assert.deepEqual([...meta.matchAll(/id="([^"]+)"/g)].map((m) => m[1]), ["ai-fee-preview", "ai-budget"]);
  const css = quelle("../src/shell/app.css");
  assert.match(css, /\.eingabe-pille:has\(#ai-privat:checked\) \.privat-marke, \.eingabe-pille:has\(#ai-funk:checked\) \.funk-marke \{ display: inline-flex; \}/);
  assert.match(css, /@media \(max-width: 760px\) \{\n\s+\.ai-optionen \{ position: fixed; left: 0; right: 0; bottom: 0;/, "am Handy ein Blatt von unten");
  const eingabe = quelle("../src/shell/tabs/agent-eingabe.ts");
  assert.match(eingabe, /export function setupOptionen\(\): void \{/);
  assert.match(quelle("../src/shell/app.ts"), /setupAttach\(\);\n\s+setupOptionen\(\);/);
});

test("C-49c: rechte Spalte am Desktop nur auf Klick – gemerkt nur als Bequemlichkeit, ohne Speicher zu", () => {
  const nav = quelle("../src/shell/navigation.ts");
  const fn = nav.slice(nav.indexOf("function wireAgentPanel("), nav.indexOf("\n}\n", nav.indexOf("function wireAgentPanel(")));
  assert.match(fn, /layout\.classList\.toggle\("panel-offen", auf\);\n\s+knopf\.setAttribute\("aria-expanded", String\(auf\)\);/);
  assert.match(fn, /try \{ gemerkt = localStorage\.getItem\(LS_AGENT_PANEL\) === "1"; \} catch/);
  assert.match(nav, /wireAgentPanel\(\);/);
  const css = quelle("../src/shell/app.css");
  assert.match(css, /@media \(min-width: 1200px\) \{\n\s+\.agent-layout:not\(\.panel-offen\) \.agent-panel \{ display: none; \}/);
  assert.match(html, /<button id="agent-panel-umschalten"[^>]*aria-expanded="false" aria-controls="agent-panel">/);
  assert.match(html, /<aside class="agent-panel" id="agent-panel"/);
});
