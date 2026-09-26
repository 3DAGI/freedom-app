/**
 * Schritt 4.6c: Eine Sperre von der Kette lesen – auch im Browser. Dort kennt
 * das Buffer-Polyfill `readBigInt64LE` nicht; bis 4.6c scheiterte deshalb jede
 * Pruefung einer Sperre in der App.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair, type Connection } from "@solana/web3.js";
import { AnchorSolanaHtlc } from "../src/solana-adapter.js";

test("Sperre lesen ohne BigInt-Methoden des Buffers (wie im Browser)", async () => {
  const [kunde, lp] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const d = Buffer.alloc(8 + 32 * 4 + 8 + 8 + 3);
  let o = 8;
  createHash("sha256").update("s1").digest().copy(d, o); o += 32;
  kunde.toBuffer().copy(d, o); o += 32;
  lp.toBuffer().copy(d, o); o += 32;
  Buffer.alloc(32, 9).copy(d, o); o += 32;
  d.writeBigInt64LE(1_790_000_000n, o); o += 8;
  d.writeBigUInt64LE(1_010_000n, o); o += 8;
  d[o] = 1; // eingeloest
  const conn = { getAccountInfo: async () => ({ data: d }) } as unknown as Connection;
  const proto = Buffer.prototype as unknown as Record<string, unknown>;
  const weg = ["readBigInt64LE", "readBigUInt64LE"].map((n) => [n, proto[n]] as const);
  for (const [n] of weg) delete proto[n];
  try {
    const l = await AnchorSolanaHtlc.reader(conn).get("s1");
    assert.equal(l?.timelockUnix, 1_790_000_000);
    assert.equal(l?.amountLamports, 1_010_000);
    assert.equal(l?.initiator, kunde.toBase58());
    assert.equal(l?.recipient, lp.toBase58());
    assert.equal(l?.claimed, true);
    assert.equal(l?.refunded, false);
  } finally {
    for (const [n, f] of weg) proto[n] = f;
  }
});
