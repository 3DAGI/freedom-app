/**
 * Session-Job-Test: DVM-Jobs mit Streaming-Sats-Session (Stufe B).
 *
 * Beweist: Kunde eroeffnet Session -> sendet Jobs OHNE Bid (nur session-Tag)
 * -> Provider validiert Budget + Belege -> arbeitet -> Buchhaltung pruefbar.
 * Plus: Provider lehnt Jobs bei erschoepftem/ungueltigem Budget ab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  buildEvent,
  OutboxPool,
  MemoryRelay,
  buildJobRequest,
  buildSessionOpen,
  buildSessionPayment,
  parseJobResult,
  KIND_DVM_TEXT_RESULT,
  KIND_DVM_TEXT_GENERATION,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class FixedBackend implements InferenceBackend {
  name(): string { return "fixed"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    return { output: `ok:${req.prompt}`, model: "fixed", promptTokens: 1, completionTokens: 2000, durationMs: 1 };
  }
}

function makeProvider(pool: OutboxPool, kp: ReturnType<typeof generateKeypair>) {
  return new DvmProvider(
    { keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "sess-test" },
    pool,
    new FixedBackend(),
  );
}

test("Session-Jobs: Kunde chattet ohne Einzel-Bids, Provider rechnet ueber Session ab", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://s1")], { minAcks: 1 });
  const provider = makeProvider(pool, providerKp);
  const now = Math.floor(Date.now() / 1000);

  // 1. Kunde eroeffnet Session: 100k msat Budget, Rate-Deckel 1000/1k tokens
  await pool.publish(
    signEvent(
      buildSessionOpen({
        customerPubkey: customer.pk,
        providerPubkey: providerKp.pk,
        sessionId: "chat-sess-1",
        maxTotalMsat: 100_000,
        maxRatePerKTokenMsat: 1000,
        settleEveryMsat: 10_000,
        ttlSecs: 3600,
      }, now),
      customer.sk,
    ),
  );

  // 2. Drei Chat-Jobs OHNE bid, nur session-Tag (Live-Chat-Flow)
  for (const prompt of ["Frage 1", "Frage 2", "Frage 3"]) {
    const job = signEvent(
      buildEvent(
        customer.pk,
        KIND_DVM_TEXT_GENERATION,
        [["i", prompt, "text"], ["session", "chat-sess-1"]],
        "",
      ),
      customer.sk,
    );
    await pool.publish(job);
    const processed = await provider.pollOnce();
    assert.equal(processed.length, 1, `Job "${prompt}" verarbeitet`);
    // 2000 tokens * 1000 msat/1k = 2000 msat (unter Rate-Deckel)
    assert.equal(processed[0].amountMsat, 2000);
    // Seit 3.3 keine Vorschau fuers Log – die Antwort steht im Ergebnis-Event.
    assert.equal(processed[0].outputPreview, "");
  }

  // 3. Alle Results liegen auf dem Relay (Kunde streamt Belege darauf)
  const results = await pool.query({ kinds: [KIND_DVM_TEXT_RESULT] });
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => parseJobResult(r).output).sort(), ["ok:Frage 1", "ok:Frage 2", "ok:Frage 3"]);
});

test("Session-Jobs: Provider lehnt bei erschoepftem Budget ab", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://s2")], { minAcks: 1 });
  const provider = makeProvider(pool, providerKp);
  const now = Math.floor(Date.now() / 1000);

  await pool.publish(
    signEvent(
      buildSessionOpen({
        customerPubkey: customer.pk,
        providerPubkey: providerKp.pk,
        sessionId: "chat-sess-2",
        maxTotalMsat: 5000,
        maxRatePerKTokenMsat: 1000,
        settleEveryMsat: 10_000,
        ttlSecs: 3600,
      }, now),
      customer.sk,
    ),
  );

  // Kunde hat bereits Belege ueber das volle Budget gestreamt
  await pool.publish(
    signEvent(
      buildSessionPayment({
        customerPubkey: customer.pk,
        sessionId: "chat-sess-2",
        seq: 1,
        cumulativeMsat: 5000,
        unitsSinceLast: 5000,
      }),
      customer.sk,
    ),
  );

  await pool.publish(
    signEvent(
      buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "noch eine frage", "text"], ["session", "chat-sess-2"]], ""),
      customer.sk,
    ),
  );
  const processed = await provider.pollOnce();
  assert.equal(processed.length, 0, "Budget erschoepft -> Job abgelehnt");
});

test("Session-Jobs: Provider lehnt Session ab, die an anderen Provider adressiert ist", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const otherProvider = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://s3")], { minAcks: 1 });
  const provider = makeProvider(pool, providerKp);

  await pool.publish(
    signEvent(
      buildSessionOpen({
        customerPubkey: customer.pk,
        providerPubkey: otherProvider.pk, // NICHT unser Provider
        sessionId: "chat-sess-3",
        maxTotalMsat: 100_000,
        maxRatePerKTokenMsat: 1000,
        settleEveryMsat: 10_000,
        ttlSecs: 3600,
      }),
      customer.sk,
    ),
  );
  await pool.publish(
    signEvent(
      buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "hallo", "text"], ["session", "chat-sess-3"]], ""),
      customer.sk,
    ),
  );
  const processed = await provider.pollOnce();
  assert.equal(processed.length, 0, "fremde Session wird ignoriert");
});

test("Bid-Jobs funktionieren weiterhin (Rueckwaertskompatibilitaet)", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://s4")], { minAcks: 1 });
  const provider = makeProvider(pool, providerKp);

  await pool.publish(
    signEvent(
      buildJobRequest({ customerPubkey: customer.pk, input: "classic bid", bidMsat: 10_000 }),
      customer.sk,
    ),
  );
  const processed = await provider.pollOnce();
  assert.equal(processed.length, 1);
  assert.equal(processed[0].amountMsat, 2000); // tokens*rate < bid
});
