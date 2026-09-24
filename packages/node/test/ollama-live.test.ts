/**
 * Live-Test: DvmProvider gegen das echte Ollama auf dieser Maschine.
 *
 * Kein Mock: Ein echter Kunden-Job (kind 5050) geht aufs Relay, der Provider
 * holt ihn, rechnet mit qwen2.5-coder:3b lokal, publiziert Result + PoW-
 * Leistungs-Event. Wird uebersprungen, wenn Ollama nicht laeuft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  buildJobRequest,
  parseJobResult,
  OutboxPool,
  MemoryRelay,
  KIND_DVM_TEXT_RESULT,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { OllamaBackend } from "../src/inference.js";

test("LIVE: Provider rechnet echten Job auf lokalem Ollama", async (t) => {
  const backend = new OllamaBackend(
    process.env.OLLAMA_URL ?? "http://127.0.0.1:11435",
    "qwen2.5-coder:3b",
  );
  if (!(await backend.available())) {
    t.skip("Ollama laeuft nicht");
    return;
  }

  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://live")], { minAcks: 1 });
  const dvm = new DvmProvider(
    {
      keypair: providerKp,
      lud16: "live@test.cash",
      pricePerKTokenMsat: 1000,
      minBidMsat: 1,
      powDifficulty: 4,
      seasonId: "live-test",
    },
    pool,
    backend,
  );

  await pool.publish(
    signEvent(
      buildJobRequest({
        customerPubkey: customer.pk,
        input: "Antworte mit genau einem Wort: Was ist 2+2?",
        bidMsat: 50_000,
      }),
      customer.sk,
    ),
  );

  const processed = await dvm.pollOnce();
  assert.equal(processed.length, 1);
  assert.ok(processed[0].amountMsat > 0);
  assert.ok(processed[0].durationMs > 0);

  const results = await pool.query({ kinds: [KIND_DVM_TEXT_RESULT] });
  assert.equal(results.length, 1);
  const parsed = parseJobResult(results[0]);
  assert.ok(parsed.output.length > 0, "echte Modell-Antwort vorhanden");
  console.log("  LIVE-Output:", parsed.output.slice(0, 80));
  console.log("  Abgerechnet:", parsed.amountMsat, "msat in", processed[0].durationMs, "ms");
});
