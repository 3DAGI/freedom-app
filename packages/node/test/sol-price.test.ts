/**
 * SOL-Preis Tests: alle Preise (text + tools) echt in SOL via solPriceSats.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair, signEvent, buildJobRequest, parseJobResult,
  OutboxPool, MemoryRelay, KIND_DVM_FILE_IO,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { defaultToolRegistry } from "../src/tools.js";
import { buildSolDepositOpen } from "@freedomstack/protocol";
import { AnchorSolanaHtlc } from "@freedomstack/protocol";
import type { Connection } from "@solana/web3.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";

/** Simulierte Kette — der Provider prueft Deposits jetzt on-chain. */
function stubChain(recipient: string, amountLamports: number, timelockUnix: number): () => void {
  const orig = AnchorSolanaHtlc.reader;
  (AnchorSolanaHtlc as unknown as { reader: unknown }).reader = () => ({
    get: async (swapId: string) => ({
      swapId, hashlock: new Uint8Array(32), amountLamports, timelockUnix,
      recipient, initiator: "Init111111111111111111111111111111111111111",
      claimed: false, refunded: false,
    }),
  });
  return () => { (AnchorSolanaHtlc as unknown as { reader: unknown }).reader = orig; };
}
const fakeConn = {} as Connection;
import { tmpdir } from "node:os";
import { join } from "node:path";

const KIND_RESULT = 6050;

class FakeBackend implements InferenceBackend {
  name(): string { return "fake"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    return { output: "ok", model: "fake", promptTokens: 10, completionTokens: 1000, durationMs: 5 };
  }
}

test("SOL-Preis: solPriceSats rechnet alle Preise (text+tool) in lamports um", async () => {
  let restoreChain: (() => void) | undefined;
  const dir = await mkdtemp(join(tmpdir(), "freedom-sol-"));
  try {
    await writeFile(join(dir, "d.txt"), "x", "utf8");
    const provider = generateKeypair();
    const customer = generateKeypair();
    const relay = new MemoryRelay("mem://sol");
    const pool = new OutboxPool([relay], { minAcks: 1 });

    const SOL_PRICE = 150_000; // 1 SOL = 150k sats
    // Timelock im Event ist +3600 s; die Mindest-Restlaufzeit ist genau 3600 s,
    // deshalb hier etwas mehr auf der Kette — sonst waere der Job zu Recht
    // abgelehnt, weil er waehrend der Arbeit ablaufen koennte.
    restoreChain = stubChain(
      "SoLprov1111111111111111111111111111111111",
      400_000,
      Math.floor(Date.now() / 1000) + 7200,
    );
    const dvm = new DvmProvider(
      {
        keypair: provider, lud16: "p@w.cash",
        pricePerKTokenMsat: 1000, minBidMsat: 100,
        powDifficulty: 0, seasonId: "t",
        solanaAddress: "SoLprov1111111111111111111111111111111111",
        solPriceSats: SOL_PRICE,
        solConnection: fakeConn,
      },
      pool, new FakeBackend(), defaultToolRegistry(dir),
    );

    // Deposit-Session eroeffnen (customer -> provider)
    const sessionId = "soldep1";
    const depOpen = signEvent(
      buildSolDepositOpen({
        sessionId, customerPubkey: customer.pk, providerPubkey: provider.pk,
        totalLamports: 1_000_000, spendLamports: 400_000, refundLamports: 600_000,
        spendSwapId: "sw1", refundSwapId: "sw2",
        maxLamportsPerKToken: 1000, timelockUnix: Math.floor(Date.now() / 1000) + 3600,
      }),
      customer.sk,
    );
    await pool.publish(depOpen);

    // Job mit tool auf die Deposit-Session
    const reqEv = signEvent(
      buildJobRequest({ customerPubkey: customer.pk, input: "lies", bidMsat: 0 }),
      customer.sk,
    );
    reqEv.tags.push(["session", sessionId]);
    reqEv.tags.push(["sol_deposit", "1"]);
    reqEv.tags.push(["tool", String(KIND_DVM_FILE_IO), "read d.txt"]);
    const req = signEvent(
      { pubkey: reqEv.pubkey, kind: reqEv.kind, tags: reqEv.tags, content: reqEv.content, created_at: reqEv.created_at },
      customer.sk,
    );
    await pool.publish(req);

    const processed = await dvm.pollOnce();
    assert.equal(processed.length, 1);
    const results = await pool.query({ kinds: [KIND_RESULT], authors: [provider.pk] });
    const r = parseJobResult(results[0]);

    // SOL-Betrag vorhanden und > 0 (text + tool in lamports)
    assert.ok(r.amountLamports !== undefined && r.amountLamports > 0, "SOL-Betrag im Result");
    // 1 SOL = 150.000 sats -> 6,67 Lamports/msat. Text: 1000 Tokens zum Anbieterpreis
    // 1000 msat, gedeckelt auf den Kunden-Deckel 1000 Lamports/1k = 150 msat; dazu
    // Werkzeug file_io 1 sat = 1000 msat -> 1150 msat = 7.666,7 -> 7.667 Lamports.
    // (Bis 4.4 erwartete dieser Test 14 Lamports: Die Formel hatte eine Tausend zu
    // viel, der Deckel griff deshalb nie.)
    const expectLamportsPerMsat = 1e9 / (SOL_PRICE * 1000); // Lamports/msat
    const expected = 7_667;
    assert.equal(r.amountMsat, 1150);
    console.log(`    [sol] amountMsat=${r.amountMsat} lamports=${r.amountLamports} expected=${expected} rate=${expectLamportsPerMsat}`);
    assert.equal(r.amountLamports, expected, `lamports ${r.amountLamports} == ${expected}`);
    assert.equal(r.solanaAddress, "SoLprov1111111111111111111111111111111111");
    console.log(`    [sol] amountMsat=${r.amountMsat} lamports=${r.amountLamports} @1SOL=${SOL_PRICE}sats`);
  } finally {
    restoreChain?.();
    await rm(dir, { recursive: true, force: true });
  }
});
