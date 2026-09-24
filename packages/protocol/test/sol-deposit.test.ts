/**
 * Solana-Deposit-Session Tests: Open/Settle-Events, Konsistenz-Pruefung,
 * alle Betrugsfaelle (ueberzogener Verbrauch, fremder Provider, Rate-Deckel).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  OutboxPool,
  MemoryRelay,
  buildSolDepositOpen,
  parseSolDepositOpen,
  buildSolDepositSettle,
  parseSolDepositSettle,
  checkSolDeposit,
  KIND_SOL_DEPOSIT_OPEN,
  KIND_SOL_DEPOSIT_SETTLE,
} from "../src/index.js";

function makeDeposit(customer: ReturnType<typeof generateKeypair>, provider: ReturnType<typeof generateKeypair>) {
  return {
    customerPubkey: customer.pk,
    providerPubkey: provider.pk,
    sessionId: "sol-dep-1",
    totalLamports: 100_000_000, // 0.1 SOL
    spendSwapId: "swap-spend-x",
    refundSwapId: "swap-refund-x",
    spendLamports: 40_000_000,   // max 0.04 SOL verbrauch
    refundLamports: 60_000_000,  // 0.06 SOL sofort refundbar
    timelockUnix: Math.floor(Date.now() / 1000) + 7200,
    maxLamportsPerKToken: 1000,   // 1000 lamports pro 1k tokens
  };
}

test("Deposit-Open: bauen, signieren, parsen (Roundtrip)", () => {
  const c = generateKeypair();
  const p = generateKeypair();
  const params = makeDeposit(c, p);
  const ev = signEvent(buildSolDepositOpen(params), c.sk);
  const parsed = parseSolDepositOpen(ev);
  assert.equal(parsed.sessionId, "sol-dep-1");
  assert.equal(parsed.totalLamports, 100_000_000);
  assert.equal(parsed.spendLamports, 40_000_000);
  assert.equal(parsed.refundLamports, 60_000_000);
  assert.equal(parsed.spendSwapId, "swap-spend-x");
});

test("Deposit-Check: konsistente Session ist ok", () => {
  const c = generateKeypair();
  const p = generateKeypair();
  const open = parseSolDepositOpen(buildSolDepositOpen(makeDeposit(c, p)));
  const settle = parseSolDepositSettle(
    buildSolDepositSettle({
      providerPubkey: p.pk,
      sessionId: open.sessionId,
      customerPubkey: c.pk,
      usedLamports: 30_000, // <= spendLamports
      totalTokens: 30_000,      // 30k tokens / 1000 * 1000 = 30_000 lamports
    }),
  );
  const check = checkSolDeposit(open, settle);
  assert.ok(check.ok, check.problems.join(", "));
});

test("Deposit-Check: spend+refund != total wird erkannt", () => {
  const c = generateKeypair();
  const p = generateKeypair();
  const params = makeDeposit(c, p);
  params.totalLamports = 999_999_999; // inkonsistent
  const open = parseSolDepositOpen(buildSolDepositOpen(params));
  const check = checkSolDeposit(open, null);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((x) => x.includes("Inkonsistent")));
});

test("Deposit-Check: Verbrauch ueber Verbrauchs-HTLC wird erkannt", () => {
  const c = generateKeypair();
  const p = generateKeypair();
  const open = parseSolDepositOpen(buildSolDepositOpen(makeDeposit(c, p)));
  const settle = parseSolDepositSettle(
    buildSolDepositSettle({
      providerPubkey: p.pk,
      sessionId: open.sessionId,
      customerPubkey: c.pk,
      usedLamports: 50_000_000, // > spendLamports (40M)
      totalTokens: 50_000,
    }),
  );
  const check = checkSolDeposit(open, settle);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((x) => x.includes("Verbrauchs-HTLC")));
});

test("Deposit-Check: Settle von fremdem Provider wird erkannt", () => {
  const c = generateKeypair();
  const p = generateKeypair();
  const stranger = generateKeypair();
  const open = parseSolDepositOpen(buildSolDepositOpen(makeDeposit(c, p)));
  const settle = parseSolDepositSettle(
    buildSolDepositSettle({
      providerPubkey: stranger.pk, // falsch
      sessionId: open.sessionId,
      customerPubkey: c.pk,
      usedLamports: 10_000_000,
      totalTokens: 10_000,
    }),
  );
  const check = checkSolDeposit(open, settle);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((x) => x.includes("fremdem Provider")));
});

test("Deposit-Check: Rate-Deckel-Ueberschreitung wird erkannt", () => {
  const c = generateKeypair();
  const p = generateKeypair();
  const open = parseSolDepositOpen(buildSolDepositOpen(makeDeposit(c, p)));
  const settle = parseSolDepositSettle(
    buildSolDepositSettle({
      providerPubkey: p.pk,
      sessionId: open.sessionId,
      customerPubkey: c.pk,
      usedLamports: 39_000_000, // <= spendLamports (40M), aber...
      totalTokens: 10_000,       // 10k tokens * 1000 = 10M erwartet, nicht 39M
    }),
  );
  const check = checkSolDeposit(open, settle);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((x) => x.includes("Rate-Deckel")));
});

test("Deposit-Flow ueber Relay: Open + Settle publizieren und pruefen", async () => {
  const c = generateKeypair();
  const p = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://dep")], { minAcks: 1 });

  await pool.publish(signEvent(buildSolDepositOpen(makeDeposit(c, p)), c.sk));
  await pool.publish(
    signEvent(
      buildSolDepositSettle({
        providerPubkey: p.pk,
        sessionId: "sol-dep-1",
        customerPubkey: c.pk,
        usedLamports: 25_000,
        totalTokens: 25_000,
      }),
      p.sk,
    ),
  );

  const opens = await pool.query({ kinds: [KIND_SOL_DEPOSIT_OPEN] });
  const settles = await pool.query({ kinds: [KIND_SOL_DEPOSIT_SETTLE] });
  assert.equal(opens.length, 1);
  assert.equal(settles.length, 1);

  const check = checkSolDeposit(parseSolDepositOpen(opens[0]), parseSolDepositSettle(settles[0]));
  assert.ok(check.ok, check.problems.join(", "));
});
