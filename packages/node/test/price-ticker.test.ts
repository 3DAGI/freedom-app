/**
 * Dezentraler Kurs-Ticker Tests: Median, Frische, Provider-Vorrang.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair, signEvent, OutboxPool, MemoryRelay,
  buildPriceTicker, parsePriceTicker, medianPrice, KIND_PRICE_TICKER,
} from "@freedomstack/protocol";

test("PriceTicker: build + parse roundtrip", () => {
  const kp = generateKeypair();
  const now = Math.floor(Date.now() / 1000);
  const ev = signEvent(buildPriceTicker({ pair: "SOL/BTC", satsPerUnit: 150_000, publishedAt: now }, kp.pk), kp.sk);
  const t = parsePriceTicker(ev);
  assert.equal(t.pair, "SOL/BTC");
  assert.equal(t.satsPerUnit, 150_000);
  assert.equal(ev.kind, KIND_PRICE_TICKER);
});

test("medianPrice: Median aus mehreren Kursen, ignoriert alt + fremdes Paar", () => {
  const now = Math.floor(Date.now() / 1000);
  const mk = (sats: number, age = 0, pair = "SOL/BTC") => {
    const kp = generateKeypair();
    return signEvent(buildPriceTicker({ pair, satsPerUnit: sats, publishedAt: now - age }, kp.pk), kp.sk);
  };
  const events = [
    mk(140_000), mk(150_000), mk(160_000),      // frisch -> Median 150k
    mk(999_999, 7200),                          // zu alt (2h) -> ignoriert
    mk(1, 0, "ETH/BTC"),                        // falsches Paar -> ignoriert
  ];
  const median = medianPrice(events, "SOL/BTC", 3600, now);
  assert.equal(median, 150_000);
});

test("medianPrice: gerade Anzahl -> Mittelwert der zwei mittleren", () => {
  const now = Math.floor(Date.now() / 1000);
  const mk = (sats: number) => {
    const kp = generateKeypair();
    return signEvent(buildPriceTicker({ pair: "SOL/BTC", satsPerUnit: sats, publishedAt: now }, kp.pk), kp.sk);
  };
  const median = medianPrice([mk(100), mk(200), mk(300), mk(400)], "SOL/BTC", 3600, now);
  assert.equal(median, 250); // (200+300)/2
});

test("medianPrice: kein gueltiger Kurs -> undefined", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(medianPrice([], "SOL/BTC", 3600, now), undefined);
});

test("Provider: Ticker-Median wird genutzt, wenn kein manueller Kurs", async () => {
  const { DvmProvider } = await import("../src/dvm-provider.js");
  const provider = generateKeypair();
  const relay = new MemoryRelay("mem://tick");
  const pool = new OutboxPool([relay], { minAcks: 1 });
  // Ticker publizieren (3 Kurse -> Median 150k)
  const now = Math.floor(Date.now() / 1000);
  for (const sats of [140_000, 150_000, 160_000]) {
    const kp = generateKeypair();
    await pool.publish(signEvent(buildPriceTicker({ pair: "SOL/BTC", satsPerUnit: sats, publishedAt: now }, kp.pk), kp.sk));
  }
  const dvm: any = new DvmProvider(
    { keypair: provider, lud16: "p@w.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 0, seasonId: "t" },
    pool,
  );
  await dvm.refreshTickerPrice();
  // lamportsPerMsat = 1e9/(150000*1000*1000) ~ 0.0000667
  const rate = dvm.lamportsPerMsat();
  const expected = 1e9 / (150_000 * 1000 * 1000);
  assert.ok(Math.abs(rate - expected) < 1e-9, `rate ${rate} ~ ${expected}`);
});

test("Provider: manueller solPriceSats schlaegt Ticker", async () => {
  const { DvmProvider } = await import("../src/dvm-provider.js");
  const provider = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://tick2")], { minAcks: 1 });
  const dvm: any = new DvmProvider(
    { keypair: provider, lud16: "p@w.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 0, seasonId: "t", solPriceSats: 200_000 },
    pool,
  );
  await dvm.refreshTickerPrice(); // sollte Ticker NICHT laden (manuell hat Vorrang)
  const rate = dvm.lamportsPerMsat();
  const expected = 1e9 / (200_000 * 1000 * 1000);
  assert.ok(Math.abs(rate - expected) < 1e-9, "manueller Kurs hat Vorrang");
});
