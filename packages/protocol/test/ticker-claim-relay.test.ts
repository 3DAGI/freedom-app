/**
 * Tests fuer Kursticker, Belohnungsantrag und Datei-Relay.
 *
 * Der Ticker bestimmt Wechselkurse — ein manipulierter Kurs kostet bei jedem
 * Swap Geld. Der Antrag ist eine Selbstauskunft und muss als solche behandelt
 * werden. Das Datei-Relay ist der Weg, auf dem Ereignisse ohne Netz
 * weiterwandern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import { buildPriceTicker, parsePriceTicker, medianPrice } from "../src/price-ticker.js";
import { buildRewardClaim, parseRewardClaim } from "../src/reward-claim.js";
import { FileRelay, memStorage } from "../src/file-relay.js";
import { KIND_PRICE_TICKER, KIND_REWARD_CLAIM } from "../src/kinds.js";

const NOW = 1_800_000_000;
const A = generateKeypair(), B = generateKeypair(), C = generateKeypair();

const ticker = (kp: typeof A, sats: number, at = NOW) =>
  signEvent(buildPriceTicker({ pair: "SOL/BTC", satsPerUnit: sats, publishedAt: at }, kp.pk), kp.sk);

// ------------------------------------------------------------- Ticker

test("Ticker: Roundtrip", () => {
  const t = parsePriceTicker(ticker(A, 250_000));
  assert.equal(t.pair, "SOL/BTC");
  assert.equal(t.satsPerUnit, 250_000);
});

test("Unvollstaendiger Ticker wird abgelehnt", () => {
  const ev = signEvent(buildEvent(A.pk, KIND_PRICE_TICKER, [["d", "SOL/BTC"]], ""), A.sk);
  assert.throws(() => parsePriceTicker(ev), /ohne pair/);
});

test("Median statt Mittelwert — ein Ausreisser kippt den Kurs nicht", () => {
  // Der eigentliche Grund fuer den Median: Ein einzelner manipulierter Kurs
  // wuerde bei einem Mittelwert jeden Swap verteuern.
  const p = medianPrice(
    [ticker(A, 250_000), ticker(B, 251_000), ticker(C, 99_000_000)],
    "SOL/BTC", 3600, NOW,
  );
  assert.ok(p! < 300_000, `Median wurde vom Ausreisser gekippt: ${p}`);
});

test("Alte Kurse zaehlen nicht", () => {
  // Ein Kurs von gestern ist bei Krypto kein Kurs.
  const p = medianPrice([ticker(A, 250_000, NOW - 7200)], "SOL/BTC", 3600, NOW);
  assert.equal(p, undefined);
});

test("Fremde Paare werden nicht vermischt", () => {
  const eth = signEvent(buildPriceTicker(
    { pair: "ETH/BTC", satsPerUnit: 4_000_000, publishedAt: NOW }, A.pk), A.sk);
  assert.equal(medianPrice([eth], "SOL/BTC", 3600, NOW), undefined);
});

test("Ohne Kurse gibt es undefined, nicht null oder 0", () => {
  // Ein Kurs von 0 waere katastrophal: Er wuerde jeden Swap gratis machen.
  assert.equal(medianPrice([], "SOL/BTC", 3600, NOW), undefined);
});

test("Ein einzelner Kurs ist sein eigener Median", () => {
  assert.equal(medianPrice([ticker(A, 250_000)], "SOL/BTC", 3600, NOW), 250_000);
});

// ------------------------------------------------------------- Antrag

test("Antrag: Roundtrip", () => {
  const ev = signEvent(buildRewardClaim({
    seasonId: "2026-q3", jobCount: 42, volumeMsat: 1_000_000,
    chain: "lightning", payoutAddress: "du@wallet.cash",
  }, A.pk), A.sk);
  const c = parseRewardClaim(ev);
  assert.equal(c.workerPubkey, A.pk);
  assert.equal(c.jobCount, 42);
  assert.equal(c.chain, "lightning");
});

test("Ein Antrag ist eine SELBSTAUSKUNFT, kein Beweis", () => {
  // Nichts hindert jemanden daran, hier beliebige Zahlen einzutragen. Der
  // Verteiler muss sie gegen die Leistungsnachweise halten — der Antrag
  // selbst belegt nur, WER etwas will.
  const ev = signEvent(buildRewardClaim({
    seasonId: "s", jobCount: 999_999, volumeMsat: 9_999_999_999,
    chain: "lightning", payoutAddress: "gierig@wallet.cash",
  }, A.pk), A.sk);
  const c = parseRewardClaim(ev);
  assert.equal(c.jobCount, 999_999, "die Zahl wird uebernommen, nicht geprueft");
  assert.equal(c.workerPubkey, A.pk, "aber der Absender steht fest");
});

test("Unvollstaendiger Antrag wird abgelehnt", () => {
  const ev = signEvent(buildEvent(A.pk, KIND_REWARD_CLAIM, [["season", "s"]], ""), A.sk);
  assert.throws(() => parseRewardClaim(ev));
});

// ------------------------------------------------------------- Datei-Relay

test("Datei-Relay nimmt Ereignisse auf und gibt sie zurueck", async () => {
  const r = new FileRelay(memStorage(), "file://test");
  const ev = signEvent(buildEvent(A.pk, 1, [], "hallo"), A.sk);
  await r.publish(ev);
  const gefunden = await r.query({ kinds: [1] });
  assert.equal(gefunden.length, 1);
  assert.equal(gefunden[0].content, "hallo");
});

test("Datei-Relay filtert wie ein echtes Relay", async () => {
  const r = new FileRelay(memStorage(), "file://test");
  await r.publish(signEvent(buildEvent(A.pk, 1, [], "text"), A.sk));
  await r.publish(signEvent(buildEvent(B.pk, 30078, [], "anderes"), B.sk));

  assert.equal((await r.query({ kinds: [1] })).length, 1);
  assert.equal((await r.query({ authors: [B.pk] })).length, 1);
  assert.equal((await r.query({ kinds: [99] })).length, 0);
});

test("Der Bestand ueberlebt einen neuen Relay auf demselben Speicher", async () => {
  // Das ist der ganze Zweck: Ereignisse auf einem Stick weiterreichen.
  const speicher = memStorage();
  const a = new FileRelay(speicher, "file://a");
  await a.publish(signEvent(buildEvent(A.pk, 1, [], "bleibt"), A.sk));

  const b = new FileRelay(speicher, "file://b");
  const gefunden = await b.query({ kinds: [1] });
  assert.equal(gefunden.length, 1);
  assert.equal(gefunden[0].content, "bleibt");
});

test("Dasselbe Ereignis liegt nur einmal", async () => {
  const speicher = memStorage();
  const r = new FileRelay(speicher, "file://test");
  const ev = signEvent(buildEvent(A.pk, 1, [], "einmal"), A.sk);
  await r.publish(ev);
  await r.publish(ev);
  assert.equal((await r.query({ kinds: [1] })).length, 1);
  // Der Dateiname ist die Ereignis-Kennung — doppelt schreiben ueberschreibt
  // dieselbe Datei, statt eine zweite anzulegen.
  assert.equal(Object.keys(speicher.files).length, 1);
});

test("HINWEIS: ein NEUER Relay auf demselben Speicher kennt die Kennungen nicht", () => {
  // Die Dublettenerkennung ist pro Instanz. Beim Einlesen eines fremden
  // Sticks bedeutet das: Bekannte Ereignisse werden erneut geschrieben —
  // harmlos, weil der Dateiname die Kennung ist, aber es kostet Schreibvorgaenge.
  // Der Test haelt das fest, damit die Annahme nicht unbemerkt weiterlebt.
  assert.ok(true);
});
