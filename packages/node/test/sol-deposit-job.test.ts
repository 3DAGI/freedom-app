/**
 * Solana-Deposit-Job E2E: Provider verarbeitet Live-Chat-Jobs gegen
 * ein SOL-Deposit (HTLC-Escrow), mit lamports-Abrechnung und SOL-Zahloption.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  buildEvent,
  OutboxPool,
  MemoryRelay,
  buildSolDepositOpen,
  parseJobResult,
  KIND_DVM_TEXT_GENERATION,
  KIND_DVM_TEXT_RESULT,
} from "@freedomstack/protocol";
import { AnchorSolanaHtlc } from "@freedomstack/protocol";
import type { Connection } from "@solana/web3.js";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

/**
 * Simulierte Kette.
 *
 * Frueher liefen diese Tests ohne jede On-Chain-Pruefung durch — genau das war
 * die Luecke: das Deposit-Event signiert der Kunde selbst. Jetzt MUSS das
 * gesperrte HTLC existieren, sonst lehnt der Provider ab. Der Stub liefert
 * ein gedecktes HTLC; die Ablehnungsfaelle stehen in
 * protocol/test/deposit-verify.test.ts.
 */
function stubChain(recipient: string, amountLamports: number, timelockUnix: number): () => void {
  const orig = AnchorSolanaHtlc.reader;
  (AnchorSolanaHtlc as unknown as { reader: unknown }).reader = () => ({
    get: async (swapId: string) => ({
      swapId,
      hashlock: new Uint8Array(32),
      amountLamports,
      timelockUnix,
      recipient,
      initiator: "Initiator1111111111111111111111111111111111",
      claimed: false,
      refunded: false,
    }),
  });
  return () => { (AnchorSolanaHtlc as unknown as { reader: unknown }).reader = orig; };
}

/** Platzhalter-Verbindung: der Stub oben fragt sie nie wirklich ab. */
const fakeConn = {} as Connection;

class EchoBackend implements InferenceBackend {
  name(): string { return "echo"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    return { output: `ok:${req.prompt}`, model: "echo", promptTokens: 1, completionTokens: 2000, durationMs: 1 };
  }
}

test("Solana-Deposit: Provider verarbeitet Job gegen Deposit, bietet SOL-Zahlung an", async () => {
  // Gedecktes HTLC auf der simulierten Kette: 0,04 SOL an den Provider,
  // Timelock zwei Stunden. Ohne das lehnt der Provider jetzt korrekt ab.
  //
  // Eine Frist fuer Kette UND Event. Frueher wurde sie zweimal aus der Uhr
  // berechnet; sprang dazwischen die Sekunde um, nannte das Event eine Sekunde
  // mehr als die Kette, und der Provider lehnte zu Recht ab (Schritt 0.H).
  const timelockUnix = Math.floor(Date.now() / 1000) + 7200;
  const restoreChain = stubChain("ProviderSoLAddr111", 40_000_000, timelockUnix);
  try {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://soljob")], { minAcks: 1 });
  const provider = new DvmProvider(
    {
      keypair: providerKp,
      lud16: "p@x.cash",
      solanaAddress: "ProviderSoLAddr111",
      lamportsPerMsat: 0.2,
      pricePerKTokenMsat: 1000,
      minBidMsat: 100,
      powDifficulty: 2,
      seasonId: "sol",
      solConnection: fakeConn,
    },
    pool,
    new EchoBackend(),
  );

  // Kunde eroeffnet Deposit-Session: 0.1 SOL total, 0.04 spend, 0.06 refund
  await pool.publish(
    signEvent(
      buildSolDepositOpen({
        customerPubkey: customer.pk,
        providerPubkey: providerKp.pk,
        sessionId: "sol-sess-1",
        totalLamports: 100_000_000,
        spendSwapId: "swap-spend-1",
        refundSwapId: "swap-refund-1",
        spendLamports: 40_000_000,
        refundLamports: 60_000_000,
        timelockUnix,
        maxLamportsPerKToken: 1000,
      }),
      customer.sk,
    ),
  );

  // Job OHNE bid, nur session-tag (Deposit-Referenz)
  await pool.publish(
    signEvent(
      buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "erklaere escrow", "text"], ["session", "sol-sess-1"]], ""),
      customer.sk,
    ),
  );

  const processed = await provider.pollOnce();
  assert.equal(processed.length, 1, "Deposit-Job verarbeitet");

  // Konsistente Umrechnung: 2000 tokens @ pricePerKTokenMsat=1000 -> rawPrice=2000msat,
  // gedeckelt auf depositRate (1000 lamports/1k / 0.2 lamports-per-msat = 5000 msat/1k).
  // textMsat = min(2000, 2000/1000*5000=10000) = 2000msat. amountMsat=2000.
  assert.equal(processed[0].amountMsat, 2_000);

  // Result traegt SOL-Zahloption; lamports = amountMsat * lamportsPerMsat(0.2) = 400
  const results = await pool.query({ kinds: [KIND_DVM_TEXT_RESULT] });
  assert.equal(results.length, 1);
  const parsed = parseJobResult(results[0]);
  assert.equal(parsed.solanaAddress, "ProviderSoLAddr111");
  assert.equal(parsed.amountLamports, 400);
  } finally {
    restoreChain();
  }
});

test("Solana-Deposit: Event verspricht eine Sekunde mehr Frist als die Kette -> abgelehnt", async () => {
  // Genau der Fall, an dem der Test oben frueher zufaellig scheiterte – hier
  // mit Absicht: Das Event darf keine laengere Frist versprechen als das HTLC.
  const timelockUnix = Math.floor(Date.now() / 1000) + 7200;
  const restoreChain = stubChain("ProviderSoLAddr111", 40_000_000, timelockUnix);
  try {
    const customer = generateKeypair();
    const providerKp = generateKeypair();
    const pool = new OutboxPool([new MemoryRelay("mem://solspaet")], { minAcks: 1 });
    const provider = new DvmProvider(
      {
        keypair: providerKp,
        lud16: "p@x.cash",
        solanaAddress: "ProviderSoLAddr111",
        lamportsPerMsat: 0.2,
        pricePerKTokenMsat: 1000,
        minBidMsat: 100,
        powDifficulty: 2,
        seasonId: "sol",
        solConnection: fakeConn,
      },
      pool,
      new EchoBackend(),
    );

    await pool.publish(
      signEvent(
        buildSolDepositOpen({
          customerPubkey: customer.pk,
          providerPubkey: providerKp.pk,
          sessionId: "sol-spaet",
          totalLamports: 100_000_000,
          spendSwapId: "swap-spend-2",
          refundSwapId: "swap-refund-2",
          spendLamports: 40_000_000,
          refundLamports: 60_000_000,
          timelockUnix: timelockUnix + 1,
          maxLamportsPerKToken: 1000,
        }),
        customer.sk,
      ),
    );
    await pool.publish(
      signEvent(
        buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "hi", "text"], ["session", "sol-spaet"]], ""),
        customer.sk,
      ),
    );

    const processed = await provider.pollOnce();
    assert.equal(processed.length, 0, "Deposit mit spaeterer Frist als die Kette abgelehnt");
    const results = await pool.query({ kinds: [KIND_DVM_TEXT_RESULT] });
    assert.equal(results.length, 0, "kein Ergebnis ohne gedecktes Deposit");
  } finally {
    restoreChain();
  }
});

test("Solana-Deposit: abgelaufene Session (Timelock) wird abgelehnt", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://soldexp")], { minAcks: 1 });
  const provider = new DvmProvider(
    { keypair: providerKp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s" },
    pool,
    new EchoBackend(),
  );

  await pool.publish(
    signEvent(
      buildSolDepositOpen({
        customerPubkey: customer.pk,
        providerPubkey: providerKp.pk,
        sessionId: "sol-expired",
        totalLamports: 100_000_000,
        spendSwapId: "s1",
        refundSwapId: "r1",
        spendLamports: 40_000_000,
        refundLamports: 60_000_000,
        timelockUnix: Math.floor(Date.now() / 1000) - 100, // ABGELAUFEN
        maxLamportsPerKToken: 1000,
      }),
      customer.sk,
    ),
  );
  await pool.publish(
    signEvent(
      buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "hi", "text"], ["session", "sol-expired"]], ""),
      customer.sk,
    ),
  );
  const processed = await provider.pollOnce();
  assert.equal(processed.length, 0, "abgelaufene Deposit-Session abgelehnt");
});
