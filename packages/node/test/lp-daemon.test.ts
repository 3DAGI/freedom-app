/**
 * Tests fuer den LP-Daemon.
 *
 * Er bewegt echtes Geld auf zwei Ketten. Der Schwerpunkt liegt deshalb auf den
 * Faellen, in denen er NICHT handeln darf — ein LP, der zu viel sperrt oder
 * eine unsichere Timelock-Ordnung akzeptiert, verliert seine Liquiditaet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutboxPool, MemoryRelay, generateKeypair, signEvent, buildEvent,
  LpOffer, hashlock, generatePreimage, toHex,
} from "@freedomstack/protocol";
import { LpDaemon, FixedRate, KIND_SWAP_REQUEST } from "../src/lp-daemon.js";

const LP = generateKeypair();
const KUNDE = generateKeypair();
const KUNDE_SOL = "So11111111111111111111111111111111111111112";

const angebot: Omit<LpOffer, "expiry"> = {
  offerId: "offer-1",
  pair: "LN-BTC/SOL",
  direction: "sell-sol",
  minSats: 1000,
  maxSats: 100_000,
  feePpm: 10_000,
  tSolSecs: 3600,
  lnCltvDeltaBlocks: 144,
};

/** Kette und Lightning als Mitschrift — hier soll nichts wirklich passieren. */
function adapter() {
  const locks: { swapId: string; amountLamports: number; recipient: string }[] = [];
  const invoices: { amountSats: number }[] = [];
  return {
    locks, invoices,
    sol: {
      async lock(p: { swapId: string; amountLamports: number; recipient: string }) { locks.push(p); },
      async claim() { /* nicht im Test */ },
      async refund() { /* nicht im Test */ },
      async get() { return null; },
      async getRevealedPreimage() { return null; },
    },
    ln: {
      async createHoldInvoice(_h: Uint8Array, amountSats: number) {
        invoices.push({ amountSats });
        return "lnbc1test";
      },
      async payHoldInvoice() { /* nicht im Test */ },
      async getInvoiceState() { return "OPEN" as const; },
      async settleHoldInvoice() { /* nicht im Test */ },
      async cancelHoldInvoice() { /* nicht im Test */ },
    },
  };
}

function setup(over: Partial<typeof angebot> = {}, maxLamportsPerSwap = 1_000_000_000) {
  const pool = new OutboxPool([new MemoryRelay("mem://lp")], { minAcks: 1 });
  const a = adapter();
  const lp = new LpDaemon(
    { keypair: LP, offer: { ...angebot, ...over }, offerTtlSecs: 3600, maxLamportsPerSwap },
    pool, a.ln as never, a.sol as never, new FixedRate(100),
  );
  return { pool, lp, a };
}

function anfrage(over: Record<string, string> = {}) {
  const pre = generatePreimage();
  const tags = [
    ["p", LP.pk],
    ["offer", over.offer ?? "offer-1"],
    ["amount_sats", over.amount_sats ?? "10000"],
    ["hashlock", over.hashlock ?? toHex(hashlock(pre))],
    ["solana_address", over.solana_address ?? KUNDE_SOL],
  ].filter((t) => over[t[0]] !== "");
  return signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, tags, ""), KUNDE.sk);
}

test("Angebot wird veroeffentlicht und ist auffindbar", async () => {
  const { pool, lp } = setup();
  const id = await lp.publishOffer();
  assert.ok(id);
  const evs = await pool.query({ authors: [LP.pk], limit: 10 });
  assert.ok(evs.some((e) => e.id === id));
});

test("Gueltige Anfrage: SOL gesperrt, Rechnung gestellt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage());
  const sessions = await lp.pollOnce();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].phase, "INVOICE_CREATED");
  // Reihenfolge ist wichtig: erst sperren, dann die Rechnung stellen. Anders
  // herum koennte der Kunde zahlen, bevor etwas gedeckt ist.
  assert.equal(a.locks.length, 1);
  assert.equal(a.locks[0].recipient, KUNDE_SOL);
  assert.equal(a.locks[0].amountLamports, 10_000 * 100);
  assert.equal(a.invoices.length, 1);
});

test("Fremdes Angebot wird nicht bedient", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ offer: "offer-von-jemand-anderem" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0, "es darf NICHTS gesperrt werden");
});

test("Betrag ueber dem Angebot wird abgelehnt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ amount_sats: "999999" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Betrag unter dem Mindestwert wird abgelehnt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ amount_sats: "10" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Liquiditaetsdeckel greift VOR dem Sperren", async () => {
  // Der Deckel ist der Schutz davor, dass ein einzelner Swap die gesamte
  // Liquiditaet bindet.
  const { pool, lp, a } = setup({}, 100_000);
  await pool.publish(anfrage({ amount_sats: "10000" })); // 1.000.000 lamports
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Unsichere Timelock-Ordnung verhindert jede Geldbewegung", async () => {
  // T_sol muss deutlich vor der Lightning-Frist enden. Sonst kann der Kunde
  // SOL einloesen, nachdem die Zahlung zurueckgelaufen ist — der LP verliert.
  const { pool, lp, a } = setup({ tSolSecs: 86_400 * 30, lnCltvDeltaBlocks: 6 });
  await pool.publish(anfrage());
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0, "nicht sperren, wenn die Ordnung unsicher ist");
});

test("Unvollstaendige Anfrage wird abgelehnt", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ hashlock: "" }));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Dieselbe Anfrage wird nur einmal bedient", async () => {
  // Ohne diese Pruefung wuerde ein wiederholt geliefertes Event zweimal
  // Liquiditaet binden.
  const { pool, lp, a } = setup();
  await pool.publish(anfrage());
  await lp.pollOnce();
  await lp.pollOnce();
  assert.equal(a.locks.length, 1);
});

test("Anfragen an andere LPs werden ignoriert", async () => {
  const { pool, lp, a } = setup();
  const fremd = generateKeypair();
  await pool.publish(signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, [
    ["p", fremd.pk], ["offer", "offer-1"], ["amount_sats", "10000"],
    ["hashlock", toHex(hashlock(generatePreimage()))], ["solana_address", KUNDE_SOL],
  ], ""), KUNDE.sk));
  assert.equal((await lp.pollOnce()).length, 0);
  assert.equal(a.locks.length, 0);
});

test("Ein fehlgeschlagener Request blockiert die anderen nicht", async () => {
  const { pool, lp, a } = setup();
  await pool.publish(anfrage({ amount_sats: "999999" }));
  await pool.publish(anfrage());
  const sessions = await lp.pollOnce();
  assert.equal(sessions.length, 1, "die gueltige Anfrage geht durch");
  assert.equal(a.locks.length, 1);
});
