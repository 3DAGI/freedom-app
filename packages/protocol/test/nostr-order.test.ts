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

test("Gegenrichtung (4.6b): Angebot nennt SOL-Konto und genauen Kurs – sonst ungueltig", () => {
  const rueck: LpOffer = { ...sample, direction: "buy-sol", solAddress: "LpSoL11111111111111111111111111111111111111", lamportsPerSat: 4321.5 };
  assert.deepEqual(parseLpOffer(buildLpOffer(rueck, KP.pk)), rueck);
  // Ohne Konto wuesste der Kunde nicht, fuer wen er sperrt; ohne Kurs nicht, wie viel.
  const { solAddress: _a, ...ohneKonto } = rueck;
  const { lamportsPerSat: _k, ...ohneKurs } = rueck;
  assert.throws(() => parseLpOffer(buildLpOffer(ohneKonto, KP.pk)), /buy-sol ohne/);
  assert.throws(() => parseLpOffer(buildLpOffer(ohneKurs, KP.pk)), /buy-sol ohne/);
  const kaputt = (name: string, wert: string) => {
    const ev = buildLpOffer(rueck, KP.pk);
    ev.tags = ev.tags.map((t) => (t[0] === name ? [name, wert] : t));
    return () => parseLpOffer(ev);
  };
  assert.throws(kaputt("sol_address", "<img src=x>"), /sol_address/);
  assert.throws(kaputt("lamports_per_sat", "0"), /lamports_per_sat/);
  assert.throws(kaputt("lamports_per_sat", "abc"), /lamports_per_sat/);
  // Hinrichtung bleibt ohne beides gueltig
  assert.deepEqual(parseLpOffer(buildLpOffer(sample, KP.pk, 1_700_000_000)), sample);
});

test("Vorab-Gebuehr (4.6d): optional, nur als positive ganze Zahl", () => {
  const mit: LpOffer = { ...sample, vorabSats: 10 };
  assert.deepEqual(parseLpOffer(buildLpOffer(mit, KP.pk, 1_700_000_000)), mit);
  assert.equal(buildLpOffer({ ...sample, vorabSats: 0 }, KP.pk).tags.some((t) => t[0] === "vorab_sats"), false, "0 = aus");
  for (const falsch of ["0", "-5", "1.5", "zehn"]) {
    const ev = buildLpOffer(mit, KP.pk);
    ev.tags = ev.tags.map((t) => (t[0] === "vorab_sats" ? ["vorab_sats", falsch] : t));
    assert.throws(() => parseLpOffer(ev), /vorab_sats/, falsch);
  }
});
