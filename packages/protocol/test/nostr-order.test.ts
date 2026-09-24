import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLpOffer, parseLpOffer, offerMatches, KIND_LP_OFFER, LpOffer } from "../src/nostr-order.js";
import { generateKeypair } from "../src/event.js";

const KP = generateKeypair();

const sample: LpOffer = {
  offerId: "ln-sol-1",
  pair: "LN-BTC/SOL",
  direction: "sell-sol",
  minSats: 10_000,
  maxSats: 5_000_000,
  feePpm: 3000,
  tSolSecs: 600,
  lnCltvDeltaBlocks: 12,
  expiry: 2_000_000_000,
  note: "test",
};

test("LP-Angebot Build/Parse-Roundtrip", () => {
  const ev = buildLpOffer(sample, KP.pk, 1_700_000_000);
  assert.equal(ev.kind, KIND_LP_OFFER);
  const back = parseLpOffer(ev);
  assert.deepEqual(back, sample);
});

test("Parsen lehnt falschen Kind ab", () => {
  const ev = buildLpOffer(sample, KP.pk);
  ev.kind = 1;
  assert.throws(() => parseLpOffer(ev));
});

test("offerMatches: passender Betrag/Paar/Richtung", () => {
  assert.ok(offerMatches(sample, { pair: "LN-BTC/SOL", direction: "sell-sol", amountSats: 100_000, now: 1_700_000_000 }));
});

test("offerMatches: Betrag ausserhalb -> kein Match", () => {
  assert.ok(!offerMatches(sample, { pair: "LN-BTC/SOL", direction: "sell-sol", amountSats: 9_000, now: 1_700_000_000 }));
});

test("offerMatches: abgelaufen -> kein Match", () => {
  assert.ok(!offerMatches(sample, { pair: "LN-BTC/SOL", direction: "sell-sol", amountSats: 100_000, now: 2_100_000_000 }));
});
