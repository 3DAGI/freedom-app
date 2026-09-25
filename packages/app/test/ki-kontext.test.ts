/**
 * Schritt 3.3: Der Knoten merkt sich keinen Verlauf mehr – die App gibt den
 * Kontext selbst mit, versiegelt in der Anfrage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KONTEXT_JE_NACHRICHT, KONTEXT_NACHRICHTEN, KONTEXT_ZEICHEN, type KontextNachricht, kontextPraefix,
} from "../src/ki-kontext.js";

test("kontextPraefix: kein Verlauf – kein Praefix", () => {
  assert.equal(kontextPraefix([]), "");
  assert.equal(kontextPraefix([{ role: "user", text: "  " }]), "");
});

test("kontextPraefix: aelteste zuerst, mit Rollen, vor der neuen Nachricht", () => {
  const p = kontextPraefix([
    { role: "user", text: "Wie heisst die Hauptstadt von Peru?" },
    { role: "ai", text: "Lima." },
  ]);
  assert.equal(p, "[Bisheriger Verlauf]:\nDu: Wie heisst die Hauptstadt von Peru?\nKI: Lima.\n\n[Neue Nachricht]:\n");
});

test("kontextPraefix: begrenzt auf die neuesten Nachrichten und eine Zeichenzahl", () => {
  const viele: KontextNachricht[] = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "ai" : "user", text: `Nachricht ${i}` }));
  const p = kontextPraefix(viele);
  assert.equal(p.split("\n").filter((z) => /^(Du|KI): /.test(z)).length, KONTEXT_NACHRICHTEN);
  assert.ok(p.includes("Nachricht 29") && p.includes(`Nachricht ${30 - KONTEXT_NACHRICHTEN}`));
  assert.ok(!p.includes(`Nachricht ${29 - KONTEXT_NACHRICHTEN}\n`));

  // Lange Nachrichten: jede gekuerzt, insgesamt hoechstens KONTEXT_ZEICHEN Verlauf
  const lang: KontextNachricht[] = Array.from({ length: 10 }, (_, i) => ({ role: "ai", text: `${i}`.repeat(5000) }));
  const q = kontextPraefix(lang);
  const zeilen = q.split("\n").filter((z) => z.startsWith("KI: "));
  assert.ok(zeilen.length >= 1 && zeilen.every((z) => z.length <= KONTEXT_JE_NACHRICHT + 8));
  assert.ok(zeilen.join("").length <= KONTEXT_ZEICHEN);
  assert.ok(zeilen[zeilen.length - 1].startsWith("KI: 9"), "die neueste bleibt");
});

test("Verdrahtung: jede Anfrage traegt den Kontext des aktuellen Verlaufs", () => {
  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const f = agent.slice(agent.indexOf("function maybeInsertModelSwitchSummary("), agent.indexOf("const MAX_POW_APP"));
  assert.match(f, /const msgs = aktuellerVerlauf\?\.messages \?\? \[\];\s*pendingContextSummary = kontextPraefix\(msgs\);/);
  // Nicht mehr nur beim Modellwechsel
  assert.doesNotMatch(f, /pendingContextSummary = "";/);
  // Vor dem Speichern der neuen Nachricht gerufen – sonst stuende sie doppelt im Prompt
  const senden = agent.slice(agent.indexOf("maybeInsertModelSwitchSummary(selTier);"));
  assert.ok(senden.indexOf("maybeInsertModelSwitchSummary(selTier);") < senden.indexOf('addAiMessage("user", prompt, "");'));
  const job = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("function aktiveClientGebuehr("));
  assert.match(job, /const fullPrompt = pendingContextSummary \? pendingContextSummary \+ prompt : prompt;/);
  assert.match(job, /\["i", fullPrompt, "text"\]/);
  assert.match(job, /input: fullPrompt,/);
});
