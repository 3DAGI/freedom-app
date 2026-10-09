/**
 * Schritt C-31 (Nutzertest A-4): Der Agent-Verlauf folgt dem Ende, solange man nicht
 * hochscrollt. Bis C-31 maß `stickToBottom()` erst nach dem Anhängen – eine Blase
 * über 80 px galt als „hochgescrollt“, und die Antwort lief unten aus dem Bild.
 * Den Ablauf im Browser prüft der Smoke-Test „agent_folgen“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const anzeige = readFileSync(new URL("../src/shell/tabs/agent-anzeige.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
const verlauf = readFileSync(new URL("../src/shell/tabs/agent-verlauf.ts", import.meta.url), "utf8");

test("ob die Ansicht folgt, entscheidet das Scrollen des Nutzers – nicht eine Messung nach dem Anhängen", () => {
  assert.match(anzeige, /thread\.addEventListener\("scroll", \(\) => \{ folgen = amEnde\(thread\); \}/);
  assert.match(anzeige, /if \(folgen\) thread\.scrollTop = thread\.scrollHeight;/);
});

test("kein weiches Scrollen mehr im Verlauf – eine laufende Animation verfälschte die nächste Messung", () => {
  for (const [name, quelle] of [["agent-anzeige.ts", anzeige], ["agent.ts", agent]] as const) {
    assert.doesNotMatch(quelle, /scrollIntoView\(\{ behavior: "smooth", block: "end" \}\)/, name);
    assert.doesNotMatch(quelle, /stickToBottom\(\(\) =>/, name);
  }
});

test("die eigene Frage und ein geöffneter Verlauf holen die Ansicht ans Ende", () => {
  assert.match(anzeige, /if \(role === "user"\) folgeWieder\(\); else stickToBottom\(\);/);
  assert.match(verlauf, /verlaufWiederherstellen = false;\n  \}\n  folgeWieder\(\);/);
});
