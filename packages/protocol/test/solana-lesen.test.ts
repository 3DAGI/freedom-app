/**
 * Schritt 4.6c: Eine Sperre von der Kette lesen – auch im Browser. Dort kennt
 * das Buffer-Polyfill `readBigInt64LE` nicht; bis 4.6c scheiterte deshalb jede
 * Pruefung einer Sperre in der App.
 *
 * Seit A-21c liest der Adapter ueber kit auf dem RpcPool – die Tests gehen den
 * ganzen Weg: JSON-RPC-Antworten, Pool, kit, Adapter. Dazu das Preimage aus der
 * Einloesung (bis A-21c fand der Adapter es nie).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getBase58Decoder } from "@solana/kit";
import { Keypair } from "@solana/web3.js";
import { AnchorSolanaHtlc, HTLC_PROGRAMM_ID } from "../src/solana-adapter.js";
import { poolRpc } from "../src/kit-rpc.js";
import { RpcPool } from "../src/rpc-pool.js";

type Aufruf = { method: string; params: unknown[] };

/** Eine Kette als JSON-RPC-Attrappe hinter einem echten Pool. */
function kette(antwort: (a: Aufruf) => unknown, log: Aufruf[] = []) {
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const { id, method, params } = JSON.parse(String(init!.body)) as Aufruf & { id: number };
    log.push({ method, params });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: antwort({ method, params }) }));
  }) as typeof fetch;
  return poolRpc(new RpcPool([{ url: "https://rpc.test" }], { fetchImpl }));
}

const kontoInfo = (daten: Buffer, owner = HTLC_PROGRAMM_ID) => ({
  context: { slot: 1 },
  value: { data: [daten.toString("base64"), "base64"], executable: false, lamports: 1_000_000, owner, rentEpoch: 0, space: daten.length },
});

function sperre(kunde: Keypair, lp: Keypair): Buffer {
  const d = Buffer.alloc(8 + 32 * 4 + 8 + 8 + 3);
  let o = 8;
  createHash("sha256").update("s1").digest().copy(d, o); o += 32;
  kunde.publicKey.toBuffer().copy(d, o); o += 32;
  lp.publicKey.toBuffer().copy(d, o); o += 32;
  Buffer.alloc(32, 9).copy(d, o); o += 32;
  d.writeBigInt64LE(1_790_000_000n, o); o += 8;
  d.writeBigUInt64LE(1_010_000n, o); o += 8;
  d[o] = 1; // eingeloest
  return d;
}

test("Sperre lesen ohne BigInt-Methoden des Buffers (wie im Browser), über kit auf dem Pool", async () => {
  const [kunde, lp] = [Keypair.generate(), Keypair.generate()];
  const log: Aufruf[] = [];
  const rpc = kette(() => kontoInfo(sperre(kunde, lp)), log);
  const proto = Buffer.prototype as unknown as Record<string, unknown>;
  const weg = ["readBigInt64LE", "readBigUInt64LE"].map((n) => [n, proto[n]] as const);
  for (const [n] of weg) delete proto[n];
  try {
    const l = await AnchorSolanaHtlc.reader(rpc).get("s1");
    assert.equal(l?.timelockUnix, 1_790_000_000);
    assert.equal(l?.amountLamports, 1_010_000);
    assert.equal(l?.initiator, kunde.publicKey.toBase58());
    assert.equal(l?.recipient, lp.publicKey.toBase58());
    assert.equal(l?.claimed, true);
    assert.equal(l?.refunded, false);
  } finally {
    for (const [n, f] of weg) proto[n] = f;
  }
  const { pda } = AnchorSolanaHtlc.deriveSwapPda("s1");
  assert.deepEqual(log, [{ method: "getAccountInfo", params: [pda.toBase58(), { encoding: "base64", commitment: "confirmed" }] }]);
});

test("Sperre: kein Konto, ein Konto eines anderen Programms oder zu kurze Daten – keine Sperre", async () => {
  const [kunde, lp] = [Keypair.generate(), Keypair.generate()];
  const fremd = Keypair.generate().publicKey.toBase58();
  assert.equal(await AnchorSolanaHtlc.reader(kette(() => ({ context: { slot: 1 }, value: null }))).get("s1"), undefined);
  assert.equal(await AnchorSolanaHtlc.reader(kette(() => kontoInfo(sperre(kunde, lp), fremd))).get("s1"), undefined);
  assert.equal(await AnchorSolanaHtlc.reader(kette(() => kontoInfo(Buffer.alloc(40)))).get("s1"), undefined);
});

const sighash = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const b58 = (b: Uint8Array) => getBase58Decoder().decode(b);

/** Eine Transaktion im Format von `getTransaction` mit `encoding: "json"`. */
function tx(keys: string[], ixs: { programm: number; daten: Uint8Array }[]) {
  return {
    slot: 7, blockTime: 1_790_000_000, version: 0,
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [], innerInstructions: [], logMessages: [], status: { Ok: null } },
    transaction: {
      signatures: ["1".repeat(64)],
      message: {
        accountKeys: keys, header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
        recentBlockhash: "11111111111111111111111111111111",
        instructions: ixs.map((ix) => ({ programIdIndex: ix.programm, accounts: [0, 1], data: b58(ix.daten), stackHeight: null })),
      },
    },
  };
}

test("Preimage aus der Einlösung: Sighash + 32 Byte ohne Längenpräfix, nur vom HTLC-Programm", async () => {
  const preimage = createHash("sha256").update("geheim").digest();
  const andere = Keypair.generate().publicKey.toBase58();
  const keys = [Keypair.generate().publicKey.toBase58(), andere, HTLC_PROGRAMM_ID];
  const claim = Buffer.concat([sighash("claim"), preimage]);
  const transaktionen: Record<string, unknown> = {
    // Neueste zuerst: ein fremdes Programm mit denselben Bytes, dann eine alte Form mit Länge, dann die echte
    sigFremd: tx(keys, [{ programm: 1, daten: claim }]),
    sigAlt: tx(keys, [{ programm: 2, daten: Buffer.concat([sighash("claim"), Buffer.from([32, 0, 0, 0]), preimage]) }]),
    sigEcht: tx(keys, [{ programm: 2, daten: sighash("refund") }, { programm: 2, daten: claim }]),
  };
  const log: Aufruf[] = [];
  const rpc = kette(({ method, params }) => {
    if (method === "getSignaturesForAddress") return Object.keys(transaktionen).map((signature) => ({ signature, slot: 7, err: null, memo: null, blockTime: null, confirmationStatus: "confirmed" }));
    if (method === "getTransaction") return transaktionen[params[0] as string] ?? null;
    throw new Error(method);
  }, log);
  const gefunden = await AnchorSolanaHtlc.reader(rpc).getRevealedPreimage("s1");
  assert.deepEqual(gefunden && [...gefunden], [...preimage]);
  const { pda } = AnchorSolanaHtlc.deriveSwapPda("s1");
  assert.deepEqual(log[0], { method: "getSignaturesForAddress", params: [pda.toBase58(), { limit: 10, commitment: "confirmed" }] });
  assert.deepEqual(log.slice(1).map((a) => a.params), ["sigFremd", "sigAlt", "sigEcht"].map((s) => [s, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]));

  // Ohne Einlösung (nur Sperre, unbekannte Transaktion): nichts
  delete transaktionen.sigEcht;
  transaktionen.sigWeg = null;
  assert.equal(await AnchorSolanaHtlc.reader(rpc).getRevealedPreimage("s1"), undefined);
});
