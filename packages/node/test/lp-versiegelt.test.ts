/**
 * Schritt 4.9: Der LP liest Swap-Anfragen im Umschlag und antwortet versiegelt
 * an den Wegwerf-Schluessel des Kunden – in beiden Richtungen. Relays sehen
 * dann weder SOL-Adresse noch Rechnung noch Swap-ID.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutboxPool, MemoryRelay, MockSolana, LocalSigner, generateKeypair, generatePreimage, hashlock, toHex, getTag,
  rueckSwapId, parseLpOffer, KIND_LP_OFFER, KIND_GIFT_WRAP, giftWrapMitSigner, versiegleSwapAnfrage, oeffneSwapAntwort,
  type LpOffer, type NostrEvent,
} from "@freedomstack/protocol";
import { LpDaemon, FixedRate, KIND_SWAP_RESPONSE, type RueckSitzung, type SwapSession } from "../src/lp-daemon.js";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";

const JETZT = 1_790_000_000;
const LP = generateKeypair();
const KUNDE_SOL = "Kunde1111111111111111111111111111111111111";
const LP_SOL = "LpSoL11111111111111111111111111111111111111";
const hin: Omit<LpOffer, "expiry"> = {
  offerId: "offer-1", pair: "LN-BTC/SOL", direction: "sell-sol", minSats: 1000, maxSats: 100_000, feePpm: 10_000, tSolSecs: 3600, lnCltvDeltaBlocks: 144,
};
const rueck: Omit<LpOffer, "expiry"> = { ...hin, offerId: "rueck-1", direction: "buy-sol", lnCltvDeltaBlocks: 30 };

function aufbau(offer: Omit<LpOffer, "expiry">) {
  const pool = new OutboxPool([new MemoryRelay("mem://lp")], { minAcks: 1 });
  const sol = new MockSolana(50_000_000, () => JETZT);
  const locks: Array<{ recipient: string }> = [];
  const vorab = new Map<string, boolean>();
  const preimages = new Map<string, Uint8Array>();
  const ln = {
    async createHoldInvoice(h: Uint8Array, amountSats: number) { return { bolt11: "lnbc1holdinvoice", paymentHash: h, amountSats }; },
    async payHoldInvoice() { /* nicht im Test */ },
    async createInvoice(amountSats: number) {
      const paymentHash = hashlock(generatePreimage());
      vorab.set(toHex(paymentHash), false);
      return { bolt11: `lnbcvorab${amountSats}`, paymentHash, amountSats };
    },
    async getInvoiceState(h: Uint8Array) { return vorab.get(toHex(h)) ? "SETTLED" as const : "OPEN" as const; },
    async settleHoldInvoice() { /* nicht im Test */ },
    async cancelHoldInvoice() { /* nicht im Test */ },
    async payInvoice(bolt11: string) { return { preimage: preimages.get(bolt11)! }; },
  };
  const solAdapter = offer.direction === "buy-sol" ? sol : {
    async lock(p: { recipient: string }) { locks.push(p); },
    async claim() { /* nicht im Test */ }, async refund() { /* nicht im Test */ },
    async get() { return null; }, async getRevealedPreimage() { return null; },
  };
  const gespeichert: RueckSitzung[][] = [];
  const lp = new LpDaemon(
    { keypair: LP, offer, offerTtlSecs: 3600, maxLamportsPerSwap: 1_000_000_000, solAdresse: LP_SOL, speicher: { lade: () => [], speichere: (s) => { gespeichert.push(structuredClone(s)); } } },
    pool, ln as never, solAdapter as never, new FixedRate(100), () => JETZT,
  );
  return { pool, sol, lp, locks, vorab, preimages, gespeichert };
}

/** Alles, was der LP veroeffentlicht hat, als ein Text – so sieht es ein Relay. */
async function oeffentlich(pool: OutboxPool): Promise<string> {
  return JSON.stringify(await pool.query({ kinds: [KIND_GIFT_WRAP, KIND_SWAP_RESPONSE, KIND_LP_OFFER] }));
}

async function antworten(pool: OutboxPool, kunde: LocalSigner, anfrageId: string) {
  const wraps = await pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [kunde.publicKey()] });
  const offen = await Promise.all(wraps.map((w: NostrEvent) => oeffneSwapAntwort(w, kunde, { lpPk: LP.pk, anfrageId })));
  return offen.filter((a) => a !== null);
}

test("Angebot sagt, dass dieser LP Anfragen im Umschlag liest", async () => {
  const { pool, lp } = aufbau(hin);
  await lp.publishOffer(JETZT);
  const [ev] = await pool.query({ kinds: [KIND_LP_OFFER], authors: [LP.pk] });
  assert.equal(parseLpOffer(ev).versiegelt, true);
});

test("Hinrichtung versiegelt: LP sperrt, Antwort nur im Umschlag – Relays sehen keine Adresse, Rechnung oder Swap-ID", async () => {
  const { pool, lp, locks } = aufbau(hin);
  const kunde = new LocalSigner(generateKeypair().sk);
  const H = toHex(hashlock(generatePreimage()));
  const { wrap, anfrageId } = await versiegleSwapAnfrage({
    tags: [["offer", "offer-1"], ["amount_sats", "10000"], ["hashlock", H], ["solana_address", KUNDE_SOL]], kunde, lpPk: LP.pk, nowSecs: JETZT,
  });
  await pool.publish(wrap);
  const [s] = await lp.pollOnce(JETZT) as SwapSession[];
  assert.equal(s.phase, "INVOICE_CREATED");
  assert.equal(s.versiegelt, true);
  assert.equal(s.customerPubkey, kunde.publicKey(), "der Wegwerf-Schluessel, keine Identitaet");
  assert.deepEqual(locks.map((l) => l.recipient), [KUNDE_SOL]);
  assert.deepEqual(await pool.query({ kinds: [KIND_SWAP_RESPONSE] }), [], "keine offene Antwort");
  const [a] = await antworten(pool, kunde, anfrageId);
  assert.equal(a.content, "lnbc1holdinvoice");
  assert.equal(getTag(a, "swap_id"), `swap-${anfrageId.slice(0, 16)}`);
  assert.equal(getTag(a, "amount_lamports"), "1000000");
  const relay = await oeffentlich(pool);
  // Den Wegwerf-Schluessel sehen Relays als Empfaenger der Antwort – mehr nicht.
  for (const geheim of [KUNDE_SOL, "lnbc1holdinvoice", `swap-${anfrageId.slice(0, 16)}`]) {
    assert.ok(!relay.includes(geheim), `offen sichtbar: ${geheim}`);
  }
  assert.equal((await lp.pollOnce(JETZT)).length, 0, "nur einmal bearbeitet");
  assert.equal(locks.length, 1);
});

test("Vorab-Gebuehr versiegelt: Rechnung und Stand gehen nur an den Wegwerf-Schluessel", async () => {
  const { pool, lp, locks, vorab } = aufbau({ ...hin, vorabSats: 10 });
  const kunde = new LocalSigner(generateKeypair().sk);
  const { wrap, anfrageId } = await versiegleSwapAnfrage({
    tags: [["offer", "offer-1"], ["amount_sats", "10000"], ["hashlock", toHex(hashlock(generatePreimage()))], ["solana_address", KUNDE_SOL]], kunde, lpPk: LP.pk, nowSecs: JETZT,
  });
  await pool.publish(wrap);
  assert.equal(((await lp.pollOnce(JETZT)) as SwapSession[])[0].phase, "VORAB");
  const [v] = await antworten(pool, kunde, anfrageId);
  assert.deepEqual([getTag(v, "status"), getTag(v, "vorab_sats"), v.content], ["VORAB", "10", "lnbcvorab10"]);
  for (const k of vorab.keys()) vorab.set(k, true);
  await lp.pollOnce(JETZT);
  assert.equal(locks.length, 1);
  assert.equal((await antworten(pool, kunde, anfrageId)).filter((a) => getTag(a, "swap_id")).length, 1);
  assert.deepEqual(await pool.query({ kinds: [KIND_SWAP_RESPONSE] }), []);
});

test("Umschlaege, die keine Swap-Anfrage sind, und Anfragen an ein anderes Angebot bleiben ohne Folgen", async () => {
  const { pool, lp, locks } = aufbau(hin);
  const kunde = new LocalSigner(generateKeypair().sk);
  await pool.publish(await giftWrapMitSigner({ pubkey: kunde.publicKey(), kind: 14, created_at: JETZT, tags: [], content: "hallo" }, kunde, LP.pk, { fixedJitter: 0, nowSecs: JETZT }));
  await pool.publish((await versiegleSwapAnfrage({
    tags: [["offer", "anderes"], ["amount_sats", "10000"], ["hashlock", "ab".repeat(32)], ["solana_address", KUNDE_SOL]], kunde, lpPk: LP.pk, nowSecs: JETZT,
  })).wrap);
  assert.deepEqual(await lp.pollOnce(JETZT), []);
  assert.equal(locks.length, 0);
});

test("Gegenrichtung versiegelt: LP zahlt die Rechnung aus dem Umschlag und antwortet versiegelt – auch mit einer Ablehnung", async () => {
  const a = aufbau(rueck);
  const kunde = new LocalSigner(generateKeypair().sk);
  const pre = generatePreimage();
  const bolt11 = rechnung(knotenSchluessel(), "lnbc100u", pre);
  a.preimages.set(bolt11, pre);
  await a.sol.lock({ swapId: rueckSwapId(bolt11), hashlock: hashlock(pre), amountLamports: 1_010_000, timelockUnix: JETZT + 12 * 3600, recipient: LP_SOL, initiator: KUNDE_SOL });
  const { wrap, anfrageId } = await versiegleSwapAnfrage({ tags: [["offer", "rueck-1"], ["bolt11", bolt11]], kunde, lpPk: LP.pk, nowSecs: JETZT });
  await a.pool.publish(wrap);
  const [s] = await a.lp.pollOnce(JETZT) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(s.phase, "EINGELOEST", s.grund ?? "");
  assert.equal(a.gespeichert.at(-1)?.[0].versiegelt, true, "gespeichert – nach einem Neustart antwortet der LP weiter versiegelt");
  assert.deepEqual((await antworten(a.pool, kunde, anfrageId)).map((x) => getTag(x, "status")), ["EINGELOEST"]);
  assert.deepEqual(await a.pool.query({ kinds: [KIND_SWAP_RESPONSE] }), []);
  assert.ok(!(await oeffentlich(a.pool)).includes(bolt11.slice(0, 40)), "Rechnung nie offen");

  // Ohne Sperre: nach der Wartezeit abgelehnt – ebenfalls nur im Umschlag
  const zweiter = new LocalSigner(generateKeypair().sk);
  const b2 = rechnung(knotenSchluessel(), "lnbc100u", generatePreimage());
  const z = await versiegleSwapAnfrage({ tags: [["offer", "rueck-1"], ["bolt11", b2]], kunde: zweiter, lpPk: LP.pk, nowSecs: JETZT - 601 });
  await a.pool.publish(z.wrap);
  await a.lp.pollOnce(JETZT);
  assert.deepEqual((await antworten(a.pool, zweiter, z.anfrageId)).map((x) => getTag(x, "status")), ["ABGELEHNT"]);
  assert.deepEqual(await a.pool.query({ kinds: [KIND_SWAP_RESPONSE] }), []);
});
