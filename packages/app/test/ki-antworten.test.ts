/**
 * Schritt 3.2b: Die App liest private Antworten – Ergebnis und Rueckmeldung
 * im Umschlag an den Sitzungsschluessel – wie offene Events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, buildJobFeedback, buildJobResult, buildPrivateJobResponse, generateKeypair, giftWrapMitSigner,
  parseJobResult, type NostrEvent,
} from "@freedomstack/protocol";
import { KiSitzungen } from "../src/ki-sitzung.js";
import { type AntwortCache, oeffneAntworten } from "../src/ki-antworten.js";

const provider = new LocalSigner(generateKeypair().sk);
const [R1, R2] = ["1".repeat(64), "2".repeat(64)];

async function antwort(sitzungPk: string, requestId: string, kind: "ergebnis" | "rueckmeldung", t = 1_790_000_000): Promise<NostrEvent> {
  const response = kind === "ergebnis"
    ? buildJobResult({ providerPubkey: provider.publicKey(), requestId, requestKind: 5050, customerPubkey: sitzungPk, output: `Antwort auf ${requestId.slice(0, 4)}`, amountMsat: 7000 }, t)
    : buildJobFeedback(provider.publicKey(), requestId, sitzungPk, "processing", "denkt nach", t);
  return (await buildPrivateJobResponse({ response, providerSigner: provider, sessionPk: sitzungPk })).wrap;
}

test("private Antworten: Ergebnis und Rueckmeldung zur gesuchten Anfrage, wie offene Events", async () => {
  const sitzungen = new KiSitzungen();
  const sitzung = sitzungen.fuer(provider.publicKey());
  const umschlaege = [
    await antwort(sitzung.publicKey(), R1, "ergebnis"),
    await antwort(sitzung.publicKey(), R1, "rueckmeldung"),
    await antwort(sitzung.publicKey(), R2, "ergebnis"),
  ];
  const r = await oeffneAntworten(umschlaege, sitzungen, new Set([R1]));
  assert.equal(r.ergebnisse.length, 1);
  assert.equal(r.rueckmeldungen.length, 1);
  const p = parseJobResult(r.ergebnisse[0]);
  assert.equal(p.requestId, R1);
  assert.equal(p.providerPubkey, provider.publicKey());
  assert.equal(p.amountMsat, 7000);
  assert.equal(r.ergebnisse[0].pubkey, provider.publicKey(), "Autor = Provider aus dem Siegel");
  // Hedging: mehrere Anfragen zugleich
  const beide = await oeffneAntworten(umschlaege, sitzungen, new Set([R1, R2]));
  assert.equal(beide.ergebnisse.length, 2);
});

test("private Antworten: fremde Sitzung, Muell und falscher Absender bleiben draussen", async () => {
  const sitzungen = new KiSitzungen();
  const sitzung = sitzungen.fuer(provider.publicKey());
  const fremd = new LocalSigner(generateKeypair().sk);
  const nichtFuerUns = await antwort(fremd.publicKey(), R1, "ergebnis");
  const kaputt = { ...(await antwort(sitzung.publicKey(), R1, "ergebnis")), content: "kaputt" };
  // Eine Anfrage statt einer Antwort im Umschlag an uns
  const anfrage = await giftWrapMitSigner(
    { pubkey: provider.publicKey(), kind: 5050, created_at: 1, tags: [["e", R1]], content: "" }, provider, sitzung.publicKey(),
  );
  const cache: AntwortCache = new Map();
  const r = await oeffneAntworten([nichtFuerUns, kaputt, anfrage], sitzungen, new Set([R1]), cache);
  assert.equal(r.ergebnisse.length + r.rueckmeldungen.length, 0);
  assert.equal(cache.size, 3);
  assert.ok([...cache.values()].every((v) => v === null));
});

test("private Antworten: geoeffnete Umschlaege werden gemerkt, neueste zuerst", async () => {
  const sitzungen = new KiSitzungen();
  const sitzung = sitzungen.fuer(provider.publicKey());
  const alt = await antwort(sitzung.publicKey(), R1, "rueckmeldung", 1_790_000_000);
  const neu = await antwort(sitzung.publicKey(), R1, "rueckmeldung", 1_790_000_060);
  const cache: AntwortCache = new Map();
  const r = await oeffneAntworten([alt, neu], sitzungen, new Set([R1]), cache);
  assert.deepEqual(r.rueckmeldungen.map((e) => e.created_at), [1_790_000_060, 1_790_000_000]);
  // Ein als ungueltig gemerkter Umschlag wird nicht erneut geoeffnet.
  cache.set(neu.id, null);
  const r2 = await oeffneAntworten([alt, neu], sitzungen, new Set([R1]), cache);
  assert.equal(r2.rueckmeldungen.length, 1);
});

test("Verdrahtung: waitForAnswer() und askRace() nehmen private Antworten dazu", () => {
  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const warten = agent.slice(agent.indexOf("async function waitForAnswer("), agent.indexOf("async function handleAnswer("));
  assert.match(warten, /const privat = await privateAntworten\(new Set\(ids\), seit, cache\);/);
  assert.match(warten, /\.\.\.privat\.rueckmeldungen\.filter/);
  assert.match(warten, /const results = \[\.\.\.privat\.ergebnisse, \.\.\.await pool\.query\(\{ kinds: \[KIND_DVM_RESULT\]/);
  const race = agent.slice(agent.indexOf("async function askRace("), agent.indexOf("async function askSwarm("));
  assert.match(race, /\(await privateAntworten\(ids, seit, cache\)\)\.ergebnisse/);
  assert.match(agent, /query\(\{ kinds: \[KIND_GIFT_WRAP\], "#p": pks, since: seit \}\)/);
});
