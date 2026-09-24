/**
 * ECHTER Live-Test: DVM-Provider mit echtem Ollama-Modell + echtem file_io-Tool.
 * Skippt sauber, wenn Ollama (11434) offline ist. Beweist, dass Tool-Ausfuehrung
 * mit echter Modell-Inferenz harmoniert (Prompt-Augmentierung + Abrechnung).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateKeypair, signEvent, buildJobRequest, parseJobResult,
  OutboxPool, MemoryRelay, KIND_DVM_FILE_IO, defaultToolPrice,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { OllamaBackend } from "../src/inference.js";
import { defaultToolRegistry } from "../src/tools.js";

const KIND_RESULT = 6050;
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

async function ollamaUp(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}

test("LIVE: echter Ollama-Job mit echtem file_io-Tool (skip ohne Ollama)", async (t) => {
  if (!(await ollamaUp())) { t.skip("Ollama offline"); return; }
  const dir = await mkdtemp(join(tmpdir(), "freedom-live-"));
  try {
    await writeFile(join(dir, "info.txt"), "Der Zauberwert ist 42.", "utf8");
    const provider = generateKeypair();
    const customer = generateKeypair();
    const relay = new MemoryRelay("mem://live");
    const pool = new OutboxPool([relay], { minAcks: 1 });

    // ECHTES OllamaBackend (kleines Modell, parallel zu vllm moeglich)
    const backend = new OllamaBackend(OLLAMA, "qwen2.5-coder:3b");
    const dvm = new DvmProvider(
      {
        keypair: provider, lud16: "prov@wallet.cash",
        pricePerKTokenMsat: 1000, minBidMsat: 100,
        powDifficulty: 0, seasonId: "live",
      },
      pool, backend, defaultToolRegistry(dir),
    );

    const reqEv = signEvent(
      buildJobRequest({
        customerPubkey: customer.pk,
        input: "Fasse den Inhalt der Datei in einem Satz zusammen.",
        bidMsat: 500_000,
      }),
      customer.sk,
    );
    reqEv.tags.push(["tool", String(KIND_DVM_FILE_IO), "read info.txt"]);
    const req = signEvent(
      { pubkey: reqEv.pubkey, kind: reqEv.kind, tags: reqEv.tags, content: reqEv.content, created_at: reqEv.created_at },
      customer.sk,
    );
    await pool.publish(req);

    const processed = await dvm.pollOnce();
    assert.equal(processed.length, 1, "Job verarbeitet");

    const results = await pool.query({ kinds: [KIND_RESULT], authors: [provider.pk] });
    assert.equal(results.length, 1);
    const r = parseJobResult(results[0]);

    // Echte Modell-Antwort (nicht leer)
    assert.ok(r.output.length > 5, `echte Antwort: "${r.output.slice(0, 80)}"`);
    // Tool wurde ausgefuehrt -> usage.toolCalls
    assert.ok(r.usage?.toolCalls && r.usage.toolCalls.length > 0, "toolCalls im Result");
    assert.equal(r.usage.toolCalls[0].kind, KIND_DVM_FILE_IO);
    // Tool-Kosten on top abgerechnet
    const toolCostMsat = defaultToolPrice(KIND_DVM_FILE_IO)!.satsPerCall * 1000;
    assert.ok(r.amountMsat >= toolCostMsat, `amount deckt Tool-Kosten`);
    console.log(`    [live] modell=${r.usage?.model} tokens=${r.usage?.completionTokens} amount=${r.amountMsat}msat out="${r.output.slice(0, 60)}..."`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
