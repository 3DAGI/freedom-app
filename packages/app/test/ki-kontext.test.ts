/**
 * Schritt 3.3: Der Knoten merkt sich keinen Verlauf mehr – die App gibt den
 * Kontext selbst mit, versiegelt in der Anfrage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KONTEXT_JE_NACHRICHT, KONTEXT_NACHRICHTEN, KONTEXT_ZEICHEN, LS_VERLAUF, VERLAUF_UMFANG, type KontextNachricht, kontextPraefix, leseUmfang,
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
  // Seit D1c mit dem gewählten Umfang (Standard „kurz“)
  assert.match(f, /const msgs = aktuellerVerlauf\?\.messages \?\? \[\];\s*pendingContextSummary = kontextPraefix\(msgs, leseUmfang\(localStorage\.getItem\(LS_VERLAUF\)\)\);/);
  // Nicht mehr nur beim Modellwechsel
  assert.doesNotMatch(f, /pendingContextSummary = "";/);
  // Vor dem Speichern der neuen Nachricht gerufen – sonst stuende sie doppelt im Prompt
  const senden = agent.slice(agent.indexOf("maybeInsertModelSwitchSummary(selTier);"));
  assert.ok(senden.indexOf("maybeInsertModelSwitchSummary(selTier);") < senden.indexOf('addAiMessage("user", prompt, "");'));
  const job = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("function aktiveClientGebuehr("));
  // Seit D1a läuft der ganze Text (Verlauf und Frage) vorher durch die Platzhalter
  assert.match(job, /const roh = pendingContextSummary \? pendingContextSummary \+ prompt : prompt;\n  const maske = eigen \? \{ text: roh, ersetzt: 0 \} : maskiere\(roh\);\n  const fullPrompt = maske\.text;/);
  assert.match(job, /\["i", fullPrompt, "text"\]/);
  assert.match(job, /input: fullPrompt,/);
});

test("D1c: weniger Verlauf – Standard kurz, einstellbar aus und lang; Unbekanntes heißt kurz", () => {
  assert.deepEqual([KONTEXT_NACHRICHTEN, KONTEXT_ZEICHEN, KONTEXT_JE_NACHRICHT], [6, 3000, 1000], "Standard seit D1c");
  assert.deepEqual(VERLAUF_UMFANG.lang, { nachrichten: 12, zeichen: 6000, jeNachricht: 1500 }, "der Umfang bis D1c");
  const viele: KontextNachricht[] = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "ai" : "user", text: `Nachricht ${i}` }));
  const zeilen = (p: string) => p.split("\n").filter((z) => /^(Du|KI): /.test(z)).length;
  assert.equal(zeilen(kontextPraefix(viele)), 6);
  assert.equal(zeilen(kontextPraefix(viele, "lang")), 12);
  assert.equal(kontextPraefix(viele, "aus"), "", "aus: nur die Frage");
  for (const [roh, erwartet] of [[null, "kurz"], ["", "kurz"], ["aus", "aus"], ["lang", "lang"], ["kurz", "kurz"], ["alles", "kurz"], ["LANG", "kurz"]] as const) {
    assert.equal(leseUmfang(roh), erwartet, String(roh));
  }
  assert.match(LS_VERLAUF, /^freedom\./);
  // Einstellung in Settings › Datenschutz, gespeichert nur als gelesener Wert
  const lies = (d: string) => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
  assert.match(lies("shell/index.html"), /<select id="ki-verlauf" class="mono-sm">\s*<option value="aus"[^>]*>[\s\S]*?<option value="kurz"[^>]*>[\s\S]*?<option value="lang"/);
  assert.match(lies("shell/tabs/mesh.ts"), /const umfang = leseUmfang\(verlauf\.value\);\n      localStorage\.setItem\(LS_VERLAUF, umfang\);/);
});
