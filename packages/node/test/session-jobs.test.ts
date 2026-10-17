/**
 * Session-Job-Test: bis RM2c3 rechnete der Knoten Aufträge ohne Gebot über eine Sitzung auf
 * Kredit ab (38021, Budget ohne Deckung). Seit RM2c4 (RM2 B) bedient er sie nicht mehr – auch
 * nicht mit gültiger Eröffnung –, wie zuvor schon bei erschöpftem Budget oder fremder Sitzung.
 * Aufträge mit Gebot gehen wie bisher.
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

test("RM2c4: eine Sitzung auf Kredit bedient der Knoten nicht mehr – auch mit gültiger Eröffnung; mit Gebot geht es", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://s1")], { minAcks: 1 });
  const provider = makeProvider(pool, providerKp);
  const now = Math.floor(Date.now() / 1000);

  // Eine Eröffnung wie bis RM2c3: 100k msat Budget, an diesen Knoten, nicht abgelaufen
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
  // Ein Auftrag ohne Gebot, nur mit session-Tag (ältere Apps): früher auf Kredit gerechnet
  const job = signEvent(
    buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "Frage 1", "text"], ["session", "chat-sess-1"]], ""),
    customer.sk,
  );
  await pool.publish(job);
  assert.equal((await provider.pollOnce()).length, 0, "nichts gerechnet");
  assert.equal((await pool.query({ kinds: [KIND_DVM_TEXT_RESULT] })).length, 0);
  const absage = (await pool.query({ kinds: [7000], "#e": [job.id] }))[0];
  assert.ok(absage, "Absage per Rückmeldung");
  assert.match(absage.content, /Sitzungen auf Kredit gibt es nicht mehr, bitte mit Gebot fragen/);

  // Dieselbe Frage mit Gebot – wie die App seit RM2c3 jede Anfrage stellt
  await pool.publish(signEvent(buildJobRequest({ customerPubkey: customer.pk, input: "Frage 1", bidMsat: 10_000 }), customer.sk));
  const processed = await provider.pollOnce();
  assert.equal(processed.length, 1);
  assert.equal(processed[0].amountMsat, 2000, "nach Tokens, höchstens das Gebot");
  assert.deepEqual((await pool.query({ kinds: [KIND_DVM_TEXT_RESULT] })).map((r) => parseJobResult(r).output), ["ok:Frage 1"]);
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
