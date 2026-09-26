/**
 * Tests fuer den HTLC-Lock im Browser.
 *
 * Der wichtigste Teil ist die Byte-Kodierung: stimmt sie nicht exakt mit dem
 * Anchor-Programm ueberein, wird die Transaktion abgelehnt — ohne dass ein
 * Typfehler oder eine Exception vorher darauf hinweist. Deshalb wird sie hier
 * gegen dieselbe Ableitung geprueft, die der Node-Adapter benutzt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PublicKey } from "@solana/web3.js";
import {
  anchorSighash,
  swapIdBytes,
  buildLockInstruction,
  buildRefundInstruction,
  swapAddress,
  lockDeposit,
  lockRueckSwap,
  refundDepositOnChain,
  HTLC_PROGRAM_ID,
  WalletSigner,
} from "../src/sol-htlc.js";

const KUNDE = "So11111111111111111111111111111111111111112";
const PROVIDER = "SysvarC1ock11111111111111111111111111111111";

test("Diskriminator stimmt mit Anchors Ableitung ueberein", () => {
  // Anchor: sha256("global:<name>")[0..8]. Weicht das ab, lehnt das Programm
  // jede Instruktion ab — und zwar ohne verwertbare Fehlermeldung.
  for (const name of ["initialize", "claim", "refund"]) {
    const erwartet = createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
    assert.deepEqual(Buffer.from(anchorSighash(name)), erwartet, name);
  }
});

test("swap_id wird identisch zum Node-Adapter abgeleitet", () => {
  // Beide Seiten muessen dieselbe PDA berechnen, sonst sperrt der Client an
  // eine Adresse, die der Provider nie prueft.
  const id = "sol-dep-abc-1700000000-spend";
  assert.deepEqual(
    Buffer.from(swapIdBytes(id)),
    createHash("sha256").update(id).digest(),
  );
});

test("PDA-Ableitung ergibt eine gueltige Programmadresse", async () => {
  const addr = await swapAddress("test-swap-1");
  assert.match(addr, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  // Deterministisch: derselbe Swap, dieselbe Adresse.
  assert.equal(addr, await swapAddress("test-swap-1"));
  assert.notEqual(addr, await swapAddress("test-swap-2"));
});

test("Lock-Instruktion: Argumente in der richtigen Byte-Reihenfolge", async () => {
  const hashlock = sha256(new Uint8Array(32).fill(7));
  const ix = await buildLockInstruction(
    { swapId: "s1", hashlock, amountLamports: 40_000_000, timelockUnix: 1_800_000_000, recipient: PROVIDER },
    KUNDE,
  );

  const data = new Uint8Array(ix.data);
  assert.equal(data.length, 8 + 80, "8 Byte Diskriminator + 80 Byte Argumente");
  assert.deepEqual(data.slice(0, 8), anchorSighash("initialize"));
  assert.deepEqual(data.slice(8, 40), swapIdBytes("s1"));
  assert.deepEqual(data.slice(40, 72), hashlock);

  const view = new DataView(data.buffer, data.byteOffset);
  assert.equal(view.getBigInt64(72, true), 1_800_000_000n, "timelock i64 little-endian");
  assert.equal(view.getBigUint64(80, true), 40_000_000n, "amount u64 little-endian");
});

test("Lock-Instruktion: Kontenreihenfolge und Signaturflags", async () => {
  const ix = await buildLockInstruction(
    { swapId: "s2", hashlock: new Uint8Array(32), amountLamports: 1, timelockUnix: 1_800_000_000, recipient: PROVIDER },
    KUNDE,
  );
  assert.equal(ix.programId.toBase58(), HTLC_PROGRAM_ID);
  assert.equal(ix.keys.length, 4);
  assert.equal(ix.keys[0].pubkey.toBase58(), KUNDE);
  assert.equal(ix.keys[0].isSigner, true, "nur der Initiator signiert");
  assert.equal(ix.keys[1].pubkey.toBase58(), PROVIDER);
  assert.equal(ix.keys[1].isSigner, false, "der Empfaenger signiert NICHT");
  assert.equal(ix.keys[2].isWritable, true, "die PDA wird beschrieben");
  assert.equal(ix.keys[3].pubkey.toBase58(), "11111111111111111111111111111111");
});

test("Lock-Instruktion: unbrauchbare Eingaben werden abgelehnt", async () => {
  const gut = { swapId: "s", hashlock: new Uint8Array(32), amountLamports: 1, timelockUnix: 1_800_000_000, recipient: PROVIDER };
  await assert.rejects(
    () => buildLockInstruction({ ...gut, hashlock: new Uint8Array(16) }, KUNDE),
    /32 Bytes/,
  );
  await assert.rejects(() => buildLockInstruction({ ...gut, amountLamports: 0 }, KUNDE), /positive/);
  await assert.rejects(() => buildLockInstruction({ ...gut, amountLamports: 1.5 }, KUNDE), /ganze Zahl/);
});

test("Refund-Instruktion: nur Diskriminator, zwei Konten", async () => {
  const ix = await buildRefundInstruction("s3", KUNDE);
  assert.deepEqual(new Uint8Array(ix.data), anchorSighash("refund"));
  assert.equal(ix.keys.length, 2);
  assert.equal(ix.keys[0].isSigner, true);
});

// ------------------------------------------------------- Wallet-Ablauf

function fakeWallet(onSign?: (tx: unknown) => void): WalletSigner & { signed: unknown[] } {
  const signed: unknown[] = [];
  return {
    signed,
    publicKey: new PublicKey(KUNDE),
    async signTransaction(tx: unknown) {
      onSign?.(tx);
      signed.push(tx);
      (tx as { serialize: () => Uint8Array }).serialize = () => new Uint8Array([1, 2, 3]);
      return tx;
    },
  };
}

function fakeConnection(err: unknown = null) {
  return {
    calls: [] as string[],
    async getLatestBlockhash() {
      return { blockhash: "Fake11111111111111111111111111111111111111", lastValidBlockHeight: 100 };
    },
    async sendRawTransaction() {
      return "sig1111111111111111111111111111111111111111";
    },
    async confirmTransaction() {
      return { value: { err } };
    },
  } as unknown as import("@solana/web3.js").Connection;
}

test("Deposit-Lock: beide HTLCs in EINER Transaktion", async () => {
  let gesehen: { instructions: unknown[] } | undefined;
  const wallet = fakeWallet((tx) => { gesehen = tx as { instructions: unknown[] }; });

  const r = await lockDeposit({
    connection: fakeConnection(),
    wallet,
    providerSolAddress: PROVIDER,
    spendSwapId: "d1-spend",
    refundSwapId: "d1-refund",
    spendLamports: 40_000_000,
    refundLamports: 60_000_000,
    timelockUnix: Math.floor(Date.now() / 1000) + 7200,
  });

  // Zwei getrennte Dialoge waeren der Fehler: wer den zweiten abbricht, haette
  // Geld beim Provider gesperrt und den Rest ungeschuetzt.
  assert.equal(wallet.signed.length, 1, "genau eine Signatur");
  assert.equal(gesehen!.instructions.length, 2, "spend und refund zusammen");
  assert.match(r.signature, /^sig/);
  assert.match(r.preimageHex, /^[0-9a-f]{64}$/);
  assert.match(r.hashlockHex, /^[0-9a-f]{64}$/);
});

test("Deposit-Lock: Hashlock ist der SHA-256 des Preimage", async () => {
  const preimage = new Uint8Array(32).fill(9);
  const r = await lockDeposit({
    connection: fakeConnection(),
    wallet: fakeWallet(),
    providerSolAddress: PROVIDER,
    spendSwapId: "d2-spend",
    refundSwapId: "d2-refund",
    spendLamports: 1000,
    refundLamports: 1000,
    timelockUnix: Math.floor(Date.now() / 1000) + 7200,
    preimage,
  });
  assert.equal(r.preimageHex, bytesToHex(preimage));
  assert.equal(r.hashlockHex, bytesToHex(sha256(preimage)));
});

test("Deposit-Lock: ohne Restanteil nur eine Instruktion", async () => {
  let gesehen: { instructions: unknown[] } | undefined;
  await lockDeposit({
    connection: fakeConnection(),
    wallet: fakeWallet((tx) => { gesehen = tx as { instructions: unknown[] }; }),
    providerSolAddress: PROVIDER,
    spendSwapId: "d3-spend",
    refundSwapId: "d3-refund",
    spendLamports: 1000,
    refundLamports: 0,
    timelockUnix: Math.floor(Date.now() / 1000) + 7200,
  });
  assert.equal(gesehen!.instructions.length, 1, "kein leeres Rest-HTLC anlegen");
});

test("Deposit-Lock: zu kurzer Timelock wird vorher abgefangen", async () => {
  // Der Provider wuerde so ein Deposit ablehnen — dann haette der Nutzer
  // Transaktionsgebuehren gezahlt und nichts davon.
  await assert.rejects(
    () => lockDeposit({
      connection: fakeConnection(),
      wallet: fakeWallet(),
      providerSolAddress: PROVIDER,
      spendSwapId: "d4-spend",
      refundSwapId: "d4-refund",
      spendLamports: 1000,
      refundLamports: 1000,
      timelockUnix: Math.floor(Date.now() / 1000) + 60,
    }),
    /10 Minuten/,
  );
});

test("Deposit-Lock: abgelehnte Transaktion meldet den Fehler", async () => {
  await assert.rejects(
    () => lockDeposit({
      connection: fakeConnection({ InstructionError: [0, "Custom"] }),
      wallet: fakeWallet(),
      providerSolAddress: PROVIDER,
      spendSwapId: "d5-spend",
      refundSwapId: "d5-refund",
      spendLamports: 1000,
      refundLamports: 1000,
      timelockUnix: Math.floor(Date.now() / 1000) + 7200,
    }),
    /abgelehnt/,
  );
});

test("Deposit-Lock: abgebrochene Wallet-Signatur reicht durch", async () => {
  const wallet: WalletSigner = {
    publicKey: new PublicKey(KUNDE),
    async signTransaction() { throw new Error("User rejected the request"); },
  };
  await assert.rejects(
    () => lockDeposit({
      connection: fakeConnection(),
      wallet,
      providerSolAddress: PROVIDER,
      spendSwapId: "d6-spend",
      refundSwapId: "d6-refund",
      spendLamports: 1000,
      refundLamports: 1000,
      timelockUnix: Math.floor(Date.now() / 1000) + 7200,
    }),
    /User rejected/,
  );
});

test("Refund: beide Swaps in einer Transaktion, Ergebnis wird gemeldet", async () => {
  const r = await refundDepositOnChain({
    connection: fakeConnection(),
    wallet: fakeWallet(),
    swapIds: ["d1-spend", "d1-refund"],
  });
  assert.deepEqual(r.refunded, ["d1-spend", "d1-refund"]);
  assert.equal(r.failed.length, 0);
});

test("Refund: Ablehnung erklaert den wahrscheinlichen Grund", async () => {
  const r = await refundDepositOnChain({
    connection: fakeConnection({ InstructionError: [0, "Custom"] }),
    wallet: fakeWallet(),
    swapIds: ["d1-spend"],
  });
  assert.equal(r.refunded.length, 0);
  assert.match(r.failed[0].reason, /Timelock noch läuft|bereits eingelöst/);
});

test("Refund: leere Liste fuehrt zu keiner Transaktion", async () => {
  const r = await refundDepositOnChain({
    connection: fakeConnection(),
    wallet: fakeWallet(),
    swapIds: [],
  });
  assert.equal(r.signature, undefined);
  assert.equal(r.refunded.length, 0);
});

// ------------------------------------------------ Gegenrichtung (4.6c)

test("Rueck-Swap-Sperre: Hashlock = Hash der Rechnung, Empfaenger = LP, Vorabsimulation an", async () => {
  let gesehen: { instructions: { data: Uint8Array; keys: { pubkey: PublicKey }[] }[] } | undefined;
  let optionen: unknown;
  const conn = fakeConnection() as unknown as { sendRawTransaction: (raw: unknown, o: unknown) => Promise<string> };
  conn.sendRawTransaction = async (_raw, o) => { optionen = o; return "sig1111111111111111111111111111111111111111"; };
  const hash = "ab".repeat(32);
  const frist = Math.floor(Date.now() / 1000) + 50 * 3600;
  const r = await lockRueckSwap({
    connection: conn as never, wallet: fakeWallet((tx) => { gesehen = tx as never; }),
    swapId: "c".repeat(64), paymentHashHex: hash, lamports: 1_010_000, timelockUnix: frist, lpSol: PROVIDER,
  });
  assert.match(r.signature, /^sig/);
  const ix = gesehen!.instructions[0];
  assert.equal(gesehen!.instructions.length, 1);
  assert.equal(bytesToHex(ix.data.slice(8 + 32, 8 + 64)), hash, "Hashlock");
  assert.equal(Buffer.from(ix.data).readBigUInt64LE(8 + 72), 1_010_000n, "Betrag");
  assert.equal(Buffer.from(ix.data).readBigInt64LE(8 + 64), BigInt(frist), "Frist");
  assert.equal(ix.keys[0].pubkey.toBase58(), KUNDE, "Kunde sperrt");
  assert.equal(ix.keys[1].pubkey.toBase58(), PROVIDER, "fuer den LP");
  assert.deepEqual(optionen, { skipPreflight: false, preflightCommitment: "confirmed" });
});

test("Rueck-Swap-Sperre: kaputter Hash, zu kurze Frist oder abgelehnte Transaktion", async () => {
  const basis = { wallet: fakeWallet(), swapId: "x", lamports: 1, lpSol: PROVIDER, timelockUnix: Math.floor(Date.now() / 1000) + 50 * 3600 };
  await assert.rejects(() => lockRueckSwap({ ...basis, connection: fakeConnection(), paymentHashHex: "ab" }), /Hash der Rechnung/);
  await assert.rejects(() => lockRueckSwap({ ...basis, connection: fakeConnection(), paymentHashHex: "ab".repeat(32), timelockUnix: Math.floor(Date.now() / 1000) + 600 }), /Frist/);
  await assert.rejects(() => lockRueckSwap({ ...basis, connection: fakeConnection({ InstructionError: [0, { Custom: 0 }] }), paymentHashHex: "ab".repeat(32) }), /Sperre abgelehnt/);
});
