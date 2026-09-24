/**
 * Tests fuer die On-Chain-Pruefung von Deposits.
 *
 * Der Angriff, den das verhindern soll, ist trivial: ein Deposit-Event ueber
 * 10 SOL veroeffentlichen, ohne je etwas zu hinterlegen. Der Provider prueft
 * bisher nur die Schluessigkeit des Events — und das Event signiert der Kunde
 * selbst. Deshalb liegt der Schwerpunkt hier auf den Faellen, in denen die
 * Kette etwas anderes sagt als das Event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDepositOnChain, DepositVerificationCache } from "../src/deposit-verify.js";
import { AnchorSolanaHtlc } from "../src/solana-adapter.js";
import type { ParsedSolDepositOpen } from "../src/sol-deposit.js";
import type { Connection } from "@solana/web3.js";

const PROVIDER_SOL = "So11111111111111111111111111111111111111112";
const NOW = 1_800_000_000;

const deposit = (over: Partial<ParsedSolDepositOpen> = {}): ParsedSolDepositOpen => ({
  sessionId: "sess-1",
  customerPubkey: "c".repeat(64),
  providerPubkey: "p".repeat(64),
  totalLamports: 1_000_000,
  spendSwapId: "spend-1",
  refundSwapId: "refund-1",
  spendLamports: 800_000,
  refundLamports: 200_000,
  timelockUnix: NOW + 7200,
  maxLamportsPerKToken: 5000,
  ...over,
});

/** Ersetzt AnchorSolanaHtlc.reader durch eine Kette, die wir steuern. */
function withChain<T>(lock: unknown, fn: () => Promise<T>): Promise<T> {
  const orig = AnchorSolanaHtlc.reader;
  (AnchorSolanaHtlc as unknown as { reader: unknown }).reader = () => ({
    get: async () => (lock instanceof Error ? Promise.reject(lock) : lock),
  });
  return fn().finally(() => {
    (AnchorSolanaHtlc as unknown as { reader: unknown }).reader = orig;
  });
}

const chainLock = (over: Record<string, unknown> = {}) => ({
  swapId: "spend-1",
  hashlock: new Uint8Array(32),
  amountLamports: 800_000,
  timelockUnix: NOW + 7200,
  recipient: PROVIDER_SOL,
  initiator: "Initiator1111111111111111111111111111111111",
  claimed: false,
  refunded: false,
  ...over,
});

const conn = {} as Connection;
const opts = { nowUnix: NOW, expectedRecipient: PROVIDER_SOL };

test("Deposit: gedecktes HTLC wird akzeptiert", async () => {
  const r = await withChain(chainLock(), () => verifyDepositOnChain(deposit(), conn, opts));
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.lockedLamports, 800_000);
  assert.equal(r.usableLamports, 800_000);
  assert.match(r.summary, /gedeckt/);
});

test("Deposit: behauptet, aber nie hinterlegt -> abgelehnt", async () => {
  // Der eigentliche Angriff: Event veroeffentlichen, nichts sperren.
  const r = await withChain(undefined, () => verifyDepositOnChain(deposit(), conn, opts));
  assert.equal(r.ok, false);
  assert.equal(r.usableLamports, 0);
  assert.match(r.summary, /nie hinterlegt/);
});

test("Deposit: zu wenig gesperrt -> abgelehnt", async () => {
  const r = await withChain(chainLock({ amountLamports: 1000 }), () =>
    verifyDepositOnChain(deposit(), conn, opts),
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /Gesperrt sind 1000/.test(p)));
});

test("Deposit: Geld an einen Dritten gesperrt -> abgelehnt", async () => {
  const r = await withChain(chainLock({ recipient: "Fremd11111111111111111111111111111111111111" }), () =>
    verifyDepositOnChain(deposit(), conn, opts),
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /nicht der Provider/.test(p)));
});

test("Deposit: ohne eigene Adresse wird nicht geraten", async () => {
  // Ohne bekannte eigene Adresse ist die wichtigste Frage offen. Durchwinken
  // waere hier schlimmer als eine Fehlkonfiguration zu melden.
  const r = await withChain(chainLock(), () =>
    verifyDepositOnChain(deposit(), conn, { nowUnix: NOW }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /SOL_ADDRESS/.test(p)));
});

test("Deposit: bereits eingeloest oder zurueckgeholt -> abgelehnt", async () => {
  for (const state of [{ claimed: true }, { refunded: true }]) {
    const r = await withChain(chainLock(state), () => verifyDepositOnChain(deposit(), conn, opts));
    assert.equal(r.ok, false, JSON.stringify(state));
  }
});

test("Deposit: abgelaufener Timelock -> abgelehnt", async () => {
  const r = await withChain(chainLock({ timelockUnix: NOW - 10 }), () =>
    verifyDepositOnChain(deposit({ timelockUnix: NOW - 10 }), conn, opts),
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /abgelaufen/.test(p)));
});

test("Deposit: zu knapper Timelock -> abgelehnt, mit Begruendung in Minuten", async () => {
  // Laeuft der Timelock waehrend der Arbeit ab, holt der Kunde alles zurueck,
  // nachdem der Provider gerechnet hat.
  const r = await withChain(chainLock({ timelockUnix: NOW + 600 }), () =>
    verifyDepositOnChain(deposit({ timelockUnix: NOW + 600 }), conn, opts),
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /Minuten ab/.test(p)));
});

test("Deposit: Event verspricht laengere Frist als die Kette -> abgelehnt", async () => {
  const r = await withChain(chainLock({ timelockUnix: NOW + 7200 }), () =>
    verifyDepositOnChain(deposit({ timelockUnix: NOW + 86400 }), conn, opts),
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /späteren Timelock/.test(p)));
});

test("Deposit: unerreichbare Kette gilt als ungedeckt, nicht als in Ordnung", async () => {
  // Ein RPC-Ausfall beim Provider darf nicht dazu fuehren, dass unbezahlte
  // Arbeit ausgeliefert wird.
  const r = await withChain(new Error("ECONNREFUSED"), () =>
    verifyDepositOnChain(deposit(), conn, opts),
  );
  assert.equal(r.ok, false);
  assert.match(r.summary, /nicht prüfbar|ungedeckt/);
});

test("Deposit: Toleranz faengt Rundungsreste ab", async () => {
  const r = await withChain(chainLock({ amountLamports: 799_999 }), () =>
    verifyDepositOnChain(deposit(), conn, { ...opts, toleranceLamports: 10 }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.usableLamports, 799_999, "nutzbar ist das, was wirklich da ist");
});

// ------------------------------------------------------------- Cache

test("Cache: spart wiederholte RPC-Abfragen innerhalb der TTL", () => {
  const c = new DepositVerificationCache(60);
  const check = { ok: true, lockedLamports: 1, usableLamports: 1, problems: [], summary: "ok" };
  c.set("s1", check, NOW);
  assert.deepEqual(c.get("s1", NOW + 30), check);
  assert.equal(c.get("s1", NOW + 61), undefined, "nach der TTL neu pruefen");
});

test("Cache: negative Ergebnisse laufen schneller ab", () => {
  const c = new DepositVerificationCache(300);
  const bad = { ok: false, lockedLamports: 0, usableLamports: 0, problems: ["x"], summary: "x" };
  c.set("s2", bad, NOW);
  // Wer gerade nachlegt, soll nicht fuenf Minuten abgewiesen bleiben.
  assert.equal(c.get("s2", NOW + 20), undefined);
});

test("Cache: nach Verbrauch invalidieren", () => {
  const c = new DepositVerificationCache(60);
  c.set("s3", { ok: true, lockedLamports: 1, usableLamports: 1, problems: [], summary: "" }, NOW);
  c.invalidate("s3");
  assert.equal(c.get("s3", NOW), undefined);
});

test("Cache: prune haelt die Map klein", () => {
  const c = new DepositVerificationCache(10);
  for (let i = 0; i < 50; i++) {
    c.set(`s${i}`, { ok: true, lockedLamports: 0, usableLamports: 0, problems: [], summary: "" }, NOW);
  }
  assert.equal(c.size(), 50);
  assert.equal(c.prune(NOW + 100), 50, "abgelaufene Eintraege duerfen nicht liegenbleiben");
  assert.equal(c.size(), 0);
});
