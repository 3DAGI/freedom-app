/**
 * Live-Chat-Test: Konversations-History ueber mehrere Session-Jobs.
 *
 * Beweist: Bei Session-Jobs bekommt das Backend die bisherige History
 * (Kontext), und die History waechst korrekt (user+assistant, gekappt).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  buildEvent,
  OutboxPool,
  MemoryRelay,
  buildSessionOpen,
  KIND_DVM_TEXT_GENERATION,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class HistoryBackend implements InferenceBackend {
  public seenHistories: Array<number> = [];
  name(): string { return "hist"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.seenHistories.push(req.history?.length ?? -1);
    return { output: `a:${req.prompt}`, model: "hist", promptTokens: 1, completionTokens: 100, durationMs: 1 };
  }
}

test("Live-Chat: Session-Jobs tragen wachsende Konversations-History", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://chat")], { minAcks: 1 });
  const backend = new HistoryBackend();
  const provider = new DvmProvider(
    { keypair: providerKp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 1, powDifficulty: 2, seasonId: "chat" },
    pool,
    backend,
  );

  // Session eroeffnen
  await pool.publish(
    signEvent(
      buildSessionOpen({
        customerPubkey: customer.pk,
        providerPubkey: providerKp.pk,
        sessionId: "live-chat-1",
        maxTotalMsat: 1_000_000,
        maxRatePerKTokenMsat: 2000,
        settleEveryMsat: 50_000,
        ttlSecs: 3600,
      }),
      customer.sk,
    ),
  );

  // 3 aufeinanderfolgende Chat-Nachrichten
  for (const msg of ["Hallo", "Wie gehts?", "Was war meine erste Frage?"]) {
    await pool.publish(
      signEvent(
        buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", msg, "text"], ["session", "live-chat-1"]], ""),
        customer.sk,
      ),
    );
    await provider.pollOnce();
  }

  // History-Laengen: Job1=0, Job2=2 (user+assistant), Job3=4
  assert.deepEqual(backend.seenHistories, [0, 2, 4], "History waechst pro Turn um 2");
});

test("Live-Chat: Bid-Jobs (kein Session) bekommen KEINE History", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://nohist")], { minAcks: 1 });
  const backend = new HistoryBackend();
  const provider = new DvmProvider(
    { keypair: providerKp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 1, powDifficulty: 2, seasonId: "s" },
    pool,
    backend,
  );

  await pool.publish(
    signEvent(
      buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "einzeln", "text"], ["bid", "5000"]], ""),
      customer.sk,
    ),
  );
  await provider.pollOnce();
  assert.deepEqual(backend.seenHistories, [-1], "kein history-Feld bei Bid-Job");
});
