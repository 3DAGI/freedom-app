/**
 * A-14b1 (G1, MENSCH 08.10.2026): Gratis-Anfragen der App passend zum Knoten.
 *
 * Beweist:
 *  - Kontingent je Gerät: 20 Antworten oder 20 000 Tokens am Tag, was zuerst
 *    erreicht ist; streng gelesen; am nächsten Tag (UTC) neu
 *  - Tokens nur aus der bereinigten Abrechnung, je Antwort begrenzt
 *  - Gratis-Fragen nur an Provider, die gerade gratis anbieten, mit der
 *    Rechenarbeit aus dem Gratis-Angebot
 *  - verdrahtet: Prüfung vor dem Senden, Zählen nach der Antwort, `gratis-leer`
 *    am Tag erkannt; der Stand liegt in `geheim` und nie in der Sicherung
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { waehleSicherung } from "@freedomstack/protocol";
import {
  GERAET_GRATIS, GeraeteKontingent, LS_AUTO_BEZAHLEN, LS_GRATIS_KONTINGENT, gratisKandidaten, kontingentErschoepft, kontingentRest,
  leseKontingent, powFuerAnfrage, tierFuerListe, tokensDerAntwort, waehleAuto, zustimmungFuer, zustimmungGilt,
} from "../src/gratis-kontingent.js";
import type { GeheimSpeicher } from "../src/vault.js";

const JETZT = 1_790_000_000; // 2026-09-21, UTC
const TAG = new Date(JETZT * 1000).toISOString().slice(0, 10);
const speicher = (): GeheimSpeicher & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k), keys: () => [...m.keys()] };
};
const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");

test("Gratis-Kontingent: Vorgabe wie in G1 entschieden", () => {
  assert.deepEqual({ ...GERAET_GRATIS }, { antworten: 20, tokens: 20_000 });
  assert.equal(LS_GRATIS_KONTINGENT, "freedom.gratis.kontingent");
});

test("Gratis-Kontingent: streng gelesen – Unsinn oder ein anderer Tag heißt heute nichts verbraucht", () => {
  const leer = { tag: TAG, antworten: 0, tokens: 0 };
  assert.deepEqual(leseKontingent(null, JETZT), leer);
  for (const roh of [
    "{kaputt", "[]", "null", "5",
    JSON.stringify({ tag: "2026-09-20", antworten: 3, tokens: 10 }),
    JSON.stringify({ tag: TAG, antworten: -1, tokens: 10 }),
    JSON.stringify({ tag: TAG, antworten: 1.5, tokens: 10 }),
    JSON.stringify({ tag: TAG, antworten: 1, tokens: "10" }),
  ]) assert.deepEqual(leseKontingent(roh, JETZT), leer, roh);
  assert.deepEqual(leseKontingent(JSON.stringify({ tag: TAG, antworten: 3, tokens: 900 }), JETZT), { tag: TAG, antworten: 3, tokens: 900 });
});

test("Gratis-Kontingent: 20 Antworten – oder vorher 20 000 Tokens", async () => {
  let uhr = JETZT;
  const s = speicher();
  const k = new GeraeteKontingent(s, () => uhr);
  for (let i = 0; i < 19; i++) await k.buche(100);
  assert.ok(!k.erschoepft());
  assert.deepEqual(kontingentRest(k.stand()), { antworten: 1, tokens: 18_100 });
  await k.buche(100);
  assert.ok(k.erschoepft(), "20 Antworten erreicht");
  uhr += 86_400;
  assert.ok(!k.erschoepft(), "am nächsten Tag (UTC) neu");

  const t = new GeraeteKontingent(speicher(), () => JETZT);
  await t.buche(12_000);
  assert.ok(!t.erschoepft());
  await t.buche(8_000);
  assert.ok(t.erschoepft(), "nach zwei Antworten: die Tokens zuerst erreicht");
  assert.ok(kontingentErschoepft({ tag: TAG, antworten: 0, tokens: 25_000 }));
});

test("Gratis-Kontingent: Tokens nur aus der Abrechnung, je Antwort begrenzt", async () => {
  assert.equal(tokensDerAntwort(undefined), 0);
  assert.equal(tokensDerAntwort({ promptTokens: 300, completionTokens: 1200 }), 1500);
  assert.equal(tokensDerAntwort({ promptTokens: -5, completionTokens: 1.5 }), 0);
  assert.equal(tokensDerAntwort({ promptTokens: 2_000_000 }), 1_000_000);
  const k = new GeraeteKontingent(speicher(), () => JETZT);
  assert.equal((await k.buche(Number.NaN)).tokens, 0, "Unsinn zählt als 0 Tokens, aber als Antwort");
  assert.equal(k.stand().antworten, 1);
});

test("Gratis-Fragen: nur an Provider, die gerade gratis anbieten – mit deren Rechenarbeit", () => {
  const c = (pk: string, caps: Record<string, unknown>) => ({ pk, caps: { currentlyFree: true, powBits: 12, ...caps } });
  const kandidaten = [
    c("neu", { gratis: { tokensProTag: 100_000, tokensJeAntwort: 2000, powBits: 16 } }),
    c("alt", {}), // vor A-14a: free=1, kein Tag gratis
    c("bezahlt", { currentlyFree: false }),
    c("zuViel", { gratis: { tokensProTag: 100_000, tokensJeAntwort: 2000, powBits: 20 } }),
  ];
  assert.deepEqual(gratisKandidaten(kandidaten, 16).map((x) => x.pk), ["neu", "alt"]);
  assert.equal(powFuerAnfrage(12, { tokensProTag: 1, tokensJeAntwort: 1, powBits: 16 }), 16);
  assert.equal(powFuerAnfrage(18, { tokensProTag: 1, tokensJeAntwort: 1, powBits: 16 }), 18);
  assert.equal(powFuerAnfrage(12, undefined), 12);
});

test("Gratis-Start verdrahtet: prüfen vor dem Senden, zählen nach der Antwort, gratis-leer am Tag", () => {
  const agent = lies("shell/tabs/agent.ts");
  const wege = lies("shell/tabs/agent-wege.ts");
  // Vor dem Senden: aufgebraucht → nichts hinaus
  const pruefung = agent.indexOf('tier === "free" && geraeteKontingent.erschoepft()');
  assert.ok(pruefung > 0 && pruefung < agent.indexOf("await askWithFailover("), "Prüfung steht vor dem Senden");
  // Rechenarbeit aus dem Gratis-Angebot, nie beim eigenen Knoten
  assert.match(agent, /powFuerAnfrage\(powJeProvider\.get\(targetPubkey\) \?\? 0, !eigen && bid === 0 \? gratisJeProvider\.get\(targetPubkey\) : undefined\)/);
  // Kennung am Tag, nicht am Text
  assert.match(agent, /fall: feedback\[0\]\.tags\.find\(\(x\) => x\[0\] === "fall"\)\?\.\[1\]/);
  assert.match(wege, /answer\.fall === GRATIS_LEER/);
  // Nur Gratis-Anbieter, gezählt erst nach der Antwort
  assert.match(wege, /bid === 0 \? gratisAnbieter\(privat, MAX_POW_APP\) : privat/);
  assert.match(lies("shell/gratis-start.ts"), /return gratisKandidaten\(kandidaten, maxPow\)\.filter\(/, "gratisAnbieter baut auf gratisKandidaten auf");
  assert.ok(wege.indexOf("zaehleGratisAntwort(answer.parsed?.usage)") > wege.indexOf("await handleAnswer(answer.ev"));
});

test("Gratis-Kontingent: nur in geheim, nie in der Sicherung", () => {
  assert.match(lies("shell/tresor.ts"), /"freedom\.gratis\.kontingent"/);
  assert.match(lies("shell/gratis-start.ts"), /new GeraeteKontingent\(geheim\)/);
  assert.ok(!(LS_GRATIS_KONTINGENT in waehleSicherung([LS_GRATIS_KONTINGENT], () => "{}")), "ein neues Gerät fängt neu an – der Stand verrät, wie viel man fragt");
});

test("Automatisch (A-14b2): erst gratis, dann bezahlt – das erste Mal nur nach Rückfrage, ohne Wallet nie", () => {
  const w = (kontingentLeer: boolean, gratisAnbieter: number, zugestimmt: boolean, wallet: boolean) =>
    waehleAuto({ kontingentLeer, gratisAnbieter, zugestimmt, wallet });
  assert.deepEqual(w(false, 2, false, false), { art: "gratis" }, "Kontingent und Gratis-Anbieter: gratis, auch ohne Wallet");
  assert.deepEqual(w(true, 2, false, true), { art: "fragen", grund: "kontingent" });
  assert.deepEqual(w(false, 0, false, true), { art: "fragen", grund: "keinGratis" });
  assert.deepEqual(w(true, 0, true, true), { art: "bezahlt" }, "einmal zugestimmt: bezahlt ohne neue Rückfrage");
  assert.deepEqual(w(true, 2, true, false), { art: "wallet", grund: "kontingent" }, "ohne Wallet nie bezahlen, auch nach Zustimmung");
  assert.deepEqual(w(false, 0, false, false), { art: "wallet", grund: "keinGratis" });
  assert.equal(tierFuerListe("auto"), "free");
  assert.equal(tierFuerListe("classic"), "classic");
  assert.ok(LS_AUTO_BEZAHLEN.startsWith("freedom."), "Präfix für die Notfall-Löschung");
});

test("Automatisch verdrahtet: Vorgabe, Rückfrage vor dem Merken, Funk nur gratis, leere Provider gemerkt", () => {
  const html = lies("shell/index.html");
  const auswahl = html.slice(html.indexOf('<select id="ai-tier"'), html.indexOf("</select>", html.indexOf('<select id="ai-tier"')));
  assert.match(auswahl, /^<select id="ai-tier"[^>]*>\s*<option value="auto" selected data-i18n="tierAuto">/, "Automatisch ist die Vorgabe");
  assert.equal((auswahl.match(/ selected/g) ?? []).length, 1);
  const agent = lies("shell/tabs/agent.ts");
  const auto = agent.indexOf('if (selTier === "auto")');
  assert.ok(auto > 0 && auto < agent.indexOf('if (tier === "free" && geraeteKontingent.erschoepft())') && auto < agent.indexOf("await askWithFailover("),
    "entschieden vor dem Kontingent und vor dem Senden");
  const frage = agent.indexOf("await bestaetige({", auto);
  assert.ok(frage > auto && frage < agent.indexOf("merkeAutoZustimmung();", auto), "erst gefragt, dann gemerkt");
  assert.match(agent, /if \(!ok\) \{\s*resetSendBtn\(btn\);\s*return;\s*\}/, "abgelehnt: nichts hinaus");
  assert.match(agent, /const gebot = wahlFunk === "free" \|\| wahlFunk === "auto" \? 0 : bid;/, "über Funk nie ohne Rückfrage bezahlen");
  const wege = lies("shell/tabs/agent-wege.ts");
  assert.match(wege, /gratisLeer = true;\s*merkeGratisLeer\(target\);/);
  assert.match(wege, /bid === 0 \? gratisAnbieter\(privat, MAX_POW_APP\) : privat/);
});

test("Automatisch (A-14b3): die Zustimmung zum Bezahlen gilt nur heute – jeden Tag wird neu gefragt", () => {
  const heute = zustimmungFuer(JETZT);
  assert.equal(heute, TAG);
  assert.ok(zustimmungGilt(heute, JETZT));
  assert.ok(zustimmungGilt(heute, JETZT + 3600), "später am selben Tag: gilt");
  assert.ok(!zustimmungGilt(heute, JETZT + 86_400), "am nächsten Tag (UTC): neu fragen");
  for (const roh of [null, "", "1", "ja", "2026-09-20"]) assert.ok(!zustimmungGilt(roh, JETZT), String(roh));
  const gs = lies("shell/gratis-start.ts");
  assert.match(gs, /return zustimmungGilt\(localStorage\.getItem\(LS_AUTO_BEZAHLEN\), /, "gelesen nur über zustimmungGilt()");
  assert.match(gs, /localStorage\.setItem\(LS_AUTO_BEZAHLEN, zustimmungFuer\(/, "gemerkt wird der Tag, nicht „ja“");
});
