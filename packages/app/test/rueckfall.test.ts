/**
 * L2-2 (Lauf 2 des lokalen Agenten, Sammlung Anhang F): Der Rückfall kam erst nach 5 min –
 * gewartet wurde beim ersten Ziel `HEDGE_AFTER_MS` + 280 s. Seit L2-2 fragt die App nach
 * 20 s ohne Lebenszeichen (kein Ergebnis, keine Rückmeldung) zusätzlich den nächsten; wer
 * lebt („processing“ vom Knoten), bekommt die ganze Frist. Mit Gutschrift im Zahlkanal nie
 * vor der Frist – ein zweites Ziel bekäme eine zweite.
 *
 * Beweist am Quelltext (der Ablauf braucht Relays und Provider; das Lebenszeichen des Knotens
 * prüft `node/test/lebenszeichen.test.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");
const agent = lies("shell/tabs/agent.ts");
const warte = agent.slice(agent.indexOf("export async function waitForAnswer("), agent.indexOf("export async function handleAnswer("));
const wege = lies("shell/tabs/agent-wege.ts");
const lauf = wege.slice(wege.indexOf("export async function askWithFailover("), wege.indexOf("export async function privateAntworten("));

test("L2-2: Ergebnisse vor Rückmeldungen – ein Zwischenstand hält ein fertiges Ergebnis nicht mehr bis zur Frist auf", () => {
  assert.ok(warte.indexOf("const results = privat.ergebnisse;") < warte.indexOf("const feedback = privat.rueckmeldungen"));
  assert.ok(warte.indexOf("return { ev: filtered[0], parsed: parseJobResult(filtered[0]) };") < warte.indexOf("if (fb) {"));
  assert.doesNotMatch(warte, /Keine Antwort vom erwarteten Provider — weiter warten/, "ohne Ergebnis weiter zu den Rückmeldungen");
});

test("L2-2: eine Ablehnung zählt vor „processing“ und Zwischenständen; „processing“ heißt warten", () => {
  assert.match(warte, /const fb = feedback\.find\(\(e\) => e\.tags\.some\(\(t\) => t\[0\] === "status" && t\[1\] === "error"\)\) \?\? feedback\[0\];/);
  assert.doesNotMatch(warte, /feedback\[0\]\.(tags|content)/, "nie mehr blind die erste Rückmeldung");
  assert.match(warte, /if \(statusTag === "processing" \|\| \(statusTag !== "error" && \/thinking\|processing\|working\/i/);
});

test("L2-2: Stille – ohne Lebenszeichen nach `stummNachMs` zurück; wer lebt, wartet bis zur Frist", () => {
  const still = warte.indexOf("if (opts.stummNachMs !== undefined && Date.now() - start >= opts.stummNachMs) return null;");
  assert.ok(still > warte.indexOf("if (fb) {"), "erst nach Ergebnis und Rückmeldung: jede Rückmeldung dieses Auftrags ist ein Lebenszeichen");
  assert.ok(still > warte.lastIndexOf("return { ev: fb, parsed: null, providerError: fbMsg"));
  assert.equal(warte.match(/opts\.stummNachMs/g)?.length, 2, "gelesen nur in dieser Bedingung");
});

test("L2-2: Rückfall nach 20 s nur mit einem nächsten Ziel und nie mit Gutschrift im Zahlkanal", () => {
  assert.match(lauf, /const HEDGE_AFTER_MS = Number\(localStorage\.getItem\("freedom\.hedgeMs"\) \?\? 20_000\);/);
  assert.match(lauf, /const stumm = !letztes && !perKanal\(requestId\);/);
  assert.match(lauf, /\.\.\.\(stumm \? \{ stummNachMs: HEDGE_AFTER_MS \} : \{\}\),/);
  assert.ok(lauf.indexOf("buildJobEvent(prompt, bid, tier, target, sc)") < lauf.indexOf("perKanal(requestId)"), "erst nach dem Bau – dann ist bekannt, ob eine Gutschrift dabei ist");
  // Das letzte Ziel wartet mindestens so lange wie der erste ohne Rückfall gewartet hätte – der war vielleicht nur still
  assert.match(lauf, /const timeoutMs = letztes \? Math\.max\(frist, ersteFrist - Date\.now\(\)\) : frist;/);
  assert.match(lauf, /if \(i === 0\) ersteFrist = Date\.now\(\) \+ frist;/);
  assert.match(lauf, /extraJobIds: activeJobIds,/, "der Stille bleibt aktiv – seine Antwort zählt noch");
});
