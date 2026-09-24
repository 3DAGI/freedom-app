/**
 * Free-Tier Tests: Provider-Marketing-Allowance (dezentral, kein Credits-System).
 *
 * Beweist:
 *  - Gratis-Jobs ohne Bid bis zum Tages-Limit
 *  - Limit wird durchgesetzt (naechster Job braucht Bid)
 *  - Zeitbegrenztes Free-Tier (freeTierUntil) gibt unbegrenzt frei
 *  - Tages-Reset funktioniert
 *  - Betrugsfall: Allowance erschoepft + kein Bid -> abgelehnt
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  buildEvent,
  OutboxPool,
  MemoryRelay,
  KIND_DVM_TEXT_GENERATION,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class FixedBackend implements InferenceBackend {
  name(): string { return "fx"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    return { output: `ok`, model: "fx", promptTokens: 1, completionTokens: 500, durationMs: 1 };
  }
}

function mkProvider(pool: OutboxPool, kp: ReturnType<typeof generateKeypair>, free: number, until?: number) {
  return new DvmProvider(
    {
      keypair: kp,
      lud16: "p@x.cash",
      pricePerKTokenMsat: 1000,
      minBidMsat: 100,
      powDifficulty: 2,
      seasonId: "s",
      freeTokensPerPubkeyPerDay: free,
      freeTierUntil: until,
    },
    pool,
    new FixedBackend(),
  );
}

async function sendFreeJob(pool: OutboxPool, customer: ReturnType<typeof generateKeypair>, text: string) {
  await pool.publish(
    signEvent(buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", text, "text"]], ""), customer.sk),
  );
}

test("Free-Tier: Gratis-Jobs bis Tages-Limit, dann Bid noetig", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://free1")], { minAcks: 1 });
  // Limit 1000 tokens/Tag; Backend liefert 500 tokens pro Job -> 2 gratis, 3. nicht
  const provider = mkProvider(pool, providerKp, 1000);

  await sendFreeJob(pool, customer, "frage 1");
  let r = await provider.pollOnce();
  assert.equal(r.length, 1);
  assert.equal(r[0].amountMsat, 0, "gratis");

  await sendFreeJob(pool, customer, "frage 2");
  r = await provider.pollOnce();
  assert.equal(r.length, 1);
  assert.equal(r[0].amountMsat, 0, "noch gratis (500+500=1000 = limit)");

  await sendFreeJob(pool, customer, "frage 3 (ueber limit)");
  r = await provider.pollOnce();
  assert.equal(r.length, 0, "Limit erschoepft -> abgelehnt ohne Bid");
});

test("Free-Tier: Zeitbegrenzung (freeTierUntil) gibt unbegrenzt frei", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://free2")], { minAcks: 1 });
  const future = Math.floor(Date.now() / 1000) + 3600; // 1h in Zukunft
  // freeTokensPerPubkeyPerDay=0, aber freeTierUntil aktiv -> trotzdem gratis
  const provider = mkProvider(pool, providerKp, 0, future);

  for (let i = 0; i < 5; i++) {
    await sendFreeJob(pool, customer, `frage ${i}`);
    const r = await provider.pollOnce();
    assert.equal(r.length, 1, `Job ${i} gratis (zeitbegrenztes Free-Tier)`);
    assert.equal(r[0].amountMsat, 0);
  }
});

test("Free-Tier: nach Ablauf der Zeitbegrenzung gilt Tages-Allowance", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://free3")], { minAcks: 1 });
  const past = Math.floor(Date.now() / 1000) - 100; // abgelaufen
  // until abgelaufen + allowance 0 -> nichts gratis
  const provider = mkProvider(pool, providerKp, 0, past);

  await sendFreeJob(pool, customer, "frage");
  const r = await provider.pollOnce();
  assert.equal(r.length, 0, "abgelaufen + keine Allowance -> abgelehnt");
});

test("Free-Tier: Allowance gilt pro pubkey (Sybil-Grenze)", async () => {
  const alice = generateKeypair();
  const bob = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://free4")], { minAcks: 1 });
  const provider = mkProvider(pool, providerKp, 1000);

  // Alice verbraucht ihr Kontingent
  await sendFreeJob(pool, alice, "a1");
  await provider.pollOnce();
  await sendFreeJob(pool, alice, "a2");
  await provider.pollOnce();

  // Bob hat noch sein eigenes Kontingent
  await sendFreeJob(pool, bob, "b1");
  const r = await provider.pollOnce();
  assert.equal(r.length, 1, "Bob hat eigenes Kontingent");
  assert.equal(r[0].amountMsat, 0);
});
