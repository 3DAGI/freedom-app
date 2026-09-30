/**
 * Sammlung A-7: Vergleich über mehrere Provider (Redundanz-Konsens). Nur auf
 * Wunsch für eine Frage, Kosten vorher bestätigt, je Provider einzeln
 * versiegelt; angenommen wird je Anfrage genau eine Antwort und nur vom
 * gefragten Provider; das Ergebnis als Satz aus den Feldern, nicht im Verlauf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NostrEvent } from "@freedomstack/protocol";
import { KONSENS_MIN, KONSENS_PROVIDER, KonsensSammlung, konsensText, konsensZiele } from "../src/konsens.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const ICH = "d".repeat(64);

function ergebnis(provider: string, anfrage: string, text: string, msat = 1000): NostrEvent {
  return { id: `${provider.slice(0, 8)}${anfrage}`.padEnd(64, "0"), pubkey: provider, created_at: 1_790_000_000, kind: 6050, tags: [["e", anfrage], ["p", ICH], ["amount", String(msat)]], content: text, sig: "0".repeat(128) };
}
function rueckmeldung(provider: string, anfrage: string, status: string): NostrEvent {
  return { id: "f".repeat(64), pubkey: provider, created_at: 1_790_000_000, kind: 7000, tags: [["e", anfrage], ["p", ICH], ["status", status]], content: "error: kein Kontingent", sig: "0".repeat(128) };
}

test("Drei Provider, ungerade; weniger als zwei gibt keinen Vergleich; jeder nur einmal", () => {
  assert.equal(KONSENS_PROVIDER, 3);
  assert.equal(KONSENS_MIN, 2);
  assert.deepEqual(konsensZiele([A, B, A, C, "e".repeat(64)]), [A, B, C]);
  assert.deepEqual(konsensZiele([A, A]), [A]);
  assert.deepEqual(konsensZiele([]), []);
});

test("Sammlung: je Anfrage eine Antwort, nur vom Gefragten; Ablehnung beendet nur mit Status error", () => {
  const s = new KonsensSammlung();
  s.erwarte("r1", A);
  s.erwarte("r2", B);
  s.erwarte("r3", C);
  assert.equal(s.gefragt, 3);
  assert.equal(s.nimm(ergebnis(B, "r1", "untergeschoben")), null, "Antwort auf fremde Anfrage");
  assert.equal(s.nimm(ergebnis(A, "r9", "unbekannt")), null, "unbekannte Anfrage");
  const r = s.nimm(ergebnis(A, "r1", "Paris ist die Hauptstadt von Frankreich.", 21_000));
  assert.equal(r?.output, "Paris ist die Hauptstadt von Frankreich.");
  assert.equal(r?.amountMsat, 21_000);
  assert.equal(s.nimm(ergebnis(A, "r1", "zweite Antwort")), null, "nur eine je Anfrage");
  assert.deepEqual([...s.offen()], ["r2", "r3"]);
  assert.equal(s.lehntAb(rueckmeldung(B, "r2", "progress")), false, "Zwischenstand ist keine Ablehnung");
  assert.equal(s.lehntAb(rueckmeldung(C, "r2", "error")), false, "nur der Gefragte lehnt ab");
  assert.equal(s.lehntAb(rueckmeldung(B, "r2", "error")), true);
  assert.equal(s.fertig(), false);
  // Ohne amount-Tag: als Text angenommen, Betrag 0
  const ohne = { ...ergebnis(C, "r3", "Paris ist die Hauptstadt von Frankreich."), tags: [["e", "r3"]] };
  assert.equal(s.nimm(ohne)?.amountMsat, 0);
  assert.equal(s.fertig(), true);
  const e = s.auswerten();
  assert.equal(e.verdict, "unanimous");
  assert.deepEqual(e.agreeing, [A, C]);
});

test("Ergebnis als Satz – einig, Mehrheit mit Abweichler, uneinig, zu wenige", () => {
  const drei = (texte: string[]) => {
    const s = new KonsensSammlung();
    [A, B, C].forEach((pk, i) => { s.erwarte(`r${i}`, pk); if (texte[i] !== undefined) s.nimm(ergebnis(pk, `r${i}`, texte[i])); });
    return konsensText(s.auswerten(), s.gefragt);
  };
  const paris = "Die Hauptstadt von Frankreich ist Paris, an der Seine gelegen.";
  assert.match(drei([paris, paris, paris]), /^Comparison: all 3 answers agree in substance\. Agreement means consistent, not correct/);
  const mehrheit = drei([paris, paris, "Berlin liegt an der Spree und hat viele Museen zu bieten."]);
  assert.match(mehrheit, /2 of 3 answers agree, differing: cccccccccccc…\./);
  assert.match(drei(["Eins zwei drei vier fünf.", "Sechs sieben acht neun zehn.", "Elf zwölf dreizehn vierzehn."]), /the 3 answers diverge/);
  assert.match(drei([paris]), /1 of 3 providers answered – too few/);
  assert.match(drei([]), /0 of 3 providers answered/);
});

test("Verdrahtet: nur auf Wunsch je Frage, erst Kosten bestätigen, je Provider versiegelt, Ergebnis nicht im Verlauf", () => {
  const agent = src("../src/shell/tabs/agent.ts");
  // Der Haken gilt nur für eine Frage und ist in Max/Swarm aus
  assert.match(agent, /const an = !!haken\?\.checked;\n  if \(haken\) haken\.checked = false;/);
  assert.match(agent, /konsensGewaehlt\(\) && !maxMode && !swarmMode/);
  assert.match(agent, /if \(konsens === null\) \{\n      resetSendBtn\(btn\);\n      return;/, "abgelehnt oder zu wenige: nichts geht hinaus, auch kein Einzelauftrag");
  assert.match(agent, /else if \(konsens\) \{\n      await askKonsens\(/);
  // Kosten vor dem Senden
  const vor = agent.slice(agent.indexOf("async function konsensVorbereiten("), agent.indexOf("async function askKonsens("));
  assert.match(vor, /consensusCostPreview\(hoechstMsat\(bid, selectedTools\), ziele\.length\)/);
  assert.match(vor, /await bestaetige\(/);
  assert.match(vor, /if \(ziele\.length < KONSENS_MIN\)/);
  // Senden nur über buildJobEvent, ohne Zusatz-Tag; Antworten über handleAnswer (Abrechnung wie sonst)
  const ask = agent.slice(agent.indexOf("async function askKonsens("), agent.indexOf("function zeigeKonsens("));
  assert.match(ask, /buildJobEvent\(prompt, bid, tier, ziel, sc\);/);
  assert.ok(ask.indexOf("sammlung.erwarte(") < ask.indexOf("pool.publish(wrap)"), "erst merken, dann senden");
  assert.match(ask, /await handleAnswer\(ev, r, prompt, angezeigt\);/);
  assert.doesNotMatch(ask, /innerHTML|merkeNachricht|\["konsens"/);
  const zeige = agent.slice(agent.indexOf("function zeigeKonsens("), agent.indexOf("export function setupKonsens("));
  assert.match(zeige, /el\.textContent = text;/);
  assert.doesNotMatch(zeige, /merkeNachricht|innerHTML/, "das Ergebnis nennt Provider – nie in den Kontext der nächsten Frage");
  assert.match(src("../src/shell/app.ts"), /setupKonsens\(\);/);
  assert.match(src("../src/shell/index.html"), /<label id="ai-konsens-wahl"[^>]*><input type="checkbox" id="ai-konsens" \/>/);
});
