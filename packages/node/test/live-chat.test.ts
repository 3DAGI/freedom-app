/**
 * Live-Chat-Test: mehrere Session-Jobs hintereinander.
 *
 * Bis Schritt 3.3 merkte sich der Knoten je Sitzung den Verlauf (Prompts und
 * Antworten im Klartext, bis 40 Nachrichten). Seit 3.3 verwirft er den
 * Klartext nach der Antwort; den Kontext bringt die App versiegelt in der
 * Anfrage mit. Beweist: Das Backend bekommt nie einen Verlauf vom Knoten,
 * und der Prompt – samt Kontext der App – geht unveraendert durch.
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
  public seenPrompts: string[] = [];
  name(): string { return "hist"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.seenHistories.push(req.history?.length ?? -1);
    this.seenPrompts.push(req.prompt);
    return { output: `a:${req.prompt}`, model: "hist", promptTokens: 1, completionTokens: 100, durationMs: 1 };
  }
}

test("Live-Chat seit 3.3: Session-Jobs bekommen keinen Verlauf vom Knoten", async () => {
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

  // 3 aufeinanderfolgende Chat-Nachrichten; die dritte mit Kontext der App
  const mitKontext = "[Bisheriger Verlauf]:\nDu: Hallo\nKI: a:Hallo\n\n[Neue Nachricht]:\nWas war meine erste Frage?";
  for (const msg of ["Hallo", "Wie gehts?", mitKontext]) {
    await pool.publish(
      signEvent(
        buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", msg, "text"], ["session", "live-chat-1"]], ""),
        customer.sk,
      ),
    );
    await provider.pollOnce();
  }

  // Frueher [0, 2, 4] – der Knoten sammelte Prompts und Antworten.
  assert.deepEqual(backend.seenHistories, [-1, -1, -1], "kein Verlauf vom Knoten");
  assert.deepEqual(backend.seenPrompts, ["Hallo", "Wie gehts?", mitKontext], "Prompt samt Kontext unveraendert");
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
