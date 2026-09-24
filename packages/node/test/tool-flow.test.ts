/**
 * Tool-Call-Flow E2E: Job mit Tool-Anforderung -> Provider fuehrt Tool lokal aus,
 * baut Ergebnis in den Prompt, rechnet Tool-Kosten ab, usage.toolCalls im Result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateKeypair,
  signEvent,
  buildJobRequest,
  parseJobResult,
  OutboxPool,
  MemoryRelay,
  KIND_DVM_FILE_IO,
  defaultToolPrice,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { defaultToolRegistry } from "../src/tools.js";

const KIND_RESULT = 6000 + 50; // 6050 (text-generation result)

class FakeBackend implements InferenceBackend {
  name(): string { return "fake"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    return {
      output: `Antwort auf: ${req.prompt}`,
      model: "fake-1b",
      promptTokens: 10,
      completionTokens: 1000,
      durationMs: 5,
    };
  }
}

test("Tool-Flow: file_io ausgefuehrt + abgerechnet + in usage.toolCalls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freedom-toolflow-"));
  try {
    await writeFile(join(dir, "data.txt"), "tool-inhalt-xyz", "utf8");
    const provider = generateKeypair();
    const customer = generateKeypair();
    const relay = new MemoryRelay("mem://tf");
    const pool = new OutboxPool([relay], { minAcks: 1 });

    const dvm = new DvmProvider(
      {
        keypair: provider, lud16: "prov@wallet.cash",
        pricePerKTokenMsat: 1000, minBidMsat: 100,
        powDifficulty: 0, seasonId: "test",
      },
      pool, new FakeBackend(), defaultToolRegistry(dir),
    );

    // Job MIT file_io-Tool-Anforderung
    const bidMsat = 100_000;
    const reqEv = signEvent(
      buildJobRequest({ customerPubkey: customer.pk, input: "lies die datei", bidMsat }),
      customer.sk,
    );
    reqEv.tags.push(["tool", String(KIND_DVM_FILE_IO), "read data.txt"]);
    const req = signEvent(
      { pubkey: reqEv.pubkey, kind: reqEv.kind, tags: reqEv.tags, content: reqEv.content, created_at: reqEv.created_at },
      customer.sk,
    );
    await pool.publish(req);

    const processed = await dvm.pollOnce();
    assert.equal(processed.length, 1, "Job verarbeitet");

    const results = await pool.query({ kinds: [KIND_RESULT], authors: [provider.pk] });
    assert.equal(results.length, 1, "Result publiziert");
    const r = parseJobResult(results[0]);

    // Tool ausgefuehrt -> usage.toolCalls vorhanden
    assert.ok(r.usage?.toolCalls && r.usage.toolCalls.length > 0, "toolCalls im Result");
    const tc = r.usage.toolCalls[0];
    assert.equal(tc.kind, KIND_DVM_FILE_IO);
    // Tool-Kosten on top: text (1000 tok @1000msat/1k=1000msat) + file_io (1 sat=1000msat)
    const toolCostMsat = defaultToolPrice(KIND_DVM_FILE_IO)!.satsPerCall * 1000;
    assert.equal(tc.costMsat, toolCostMsat);
    const expectedMin = 1000 + toolCostMsat;
    assert.ok(r.amountMsat >= expectedMin, `amount ${r.amountMsat} >= text+tool ${expectedMin}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Tool-Flow: Anhang-Tag wird als Kontext verarbeitet (kein Crash)", async () => {
  const provider = generateKeypair();
  const customer = generateKeypair();
  const relay = new MemoryRelay("mem://attach");
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const dvm = new DvmProvider(
    {
      keypair: provider, lud16: "p@w.cash",
      pricePerKTokenMsat: 1000, minBidMsat: 100,
      powDifficulty: 0, seasonId: "test",
    },
    pool, new FakeBackend(), defaultToolRegistry(),
  );
  const reqEv = signEvent(
    buildJobRequest({ customerPubkey: customer.pk, input: "was ist auf dem bild", bidMsat: 50_000 }),
    customer.sk,
  );
  reqEv.tags.push(["attach", "image", "foto.png", "data:image/png;base64,AAAA"]);
  const req = signEvent(
    { pubkey: reqEv.pubkey, kind: reqEv.kind, tags: reqEv.tags, content: reqEv.content, created_at: reqEv.created_at },
    customer.sk,
  );
  await pool.publish(req);
  const processed = await dvm.pollOnce();
  assert.equal(processed.length, 1, "Anhang-Job verarbeitet");
});
