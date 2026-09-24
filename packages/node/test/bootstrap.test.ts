/**
 * Bootstrap-Tests: 24h-Pflicht-Gratis neuer Provider (Kaltstart-Reputation).
 *
 * Beweist das Modell:
 *  - Neue Provider (providerSince = jetzt) nehmen NUR Gratis-Jobs
 *  - Bezahlte Jobs (Bid/Session) werden in Bootstrap abgelehnt
 *  - Nach 24h: automatisch paid (Bid-Jobs funktionieren)
 *  - Bootstrap-Arbeit erzeugt 38010-Events mit bootstrap-Markierung (Reputation)
 *  - Gratis-Arbeit zaehlt ins Leaderboard (volume_msat=0, aber units>0)
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
  parsePerformance,
  KIND_DVM_TEXT_GENERATION,
  KIND_PERFORMANCE,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class B implements InferenceBackend {
  name(): string { return "b"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    return { output: "ok", model: "b", promptTokens: 1, completionTokens: 500, durationMs: 1 };
  }
}

const NOW = Math.floor(Date.now() / 1000);

function mkNewProvider(pool: OutboxPool, kp: ReturnType<typeof generateKeypair>, sinceSecsAgo: number) {
  return new DvmProvider(
    {
      keypair: kp,
      lud16: "p@x.cash",
      pricePerKTokenMsat: 1000,
      minBidMsat: 100,
      powDifficulty: 2,
      seasonId: "s",
      providerSince: NOW - sinceSecsAgo,
      bootstrapFreeSecs: 24 * 3600,
    },
    pool,
    new B(),
  );
}

test("Bootstrap: neuer Provider (<24h) nimmt NUR Gratis-Jobs, lehnt Bid ab", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://bs1")], { minAcks: 1 });
  const provider = mkNewProvider(pool, providerKp, 3600); // seit 1h -> in Bootstrap

  assert.ok(provider.isInBootstrap(NOW), "ist in Bootstrap");

  // Gratis-Job: akzeptiert
  await pool.publish(
    signEvent(buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "gratis", "text"]], ""), customer.sk),
  );
  let r = await provider.pollOnce();
  assert.equal(r.length, 1, "Gratis-Job akzeptiert");
  assert.equal(r[0].amountMsat, 0);

  // Bid-Job (bezahlt): abgelehnt in Bootstrap
  await pool.publish(
    signEvent(buildJobRequest({ customerPubkey: customer.pk, input: "bezahlt", bidMsat: 10_000 }), customer.sk),
  );
  r = await provider.pollOnce();
  assert.equal(r.length, 0, "Bid-Job in Bootstrap abgelehnt (muss erst Reputation aufbauen)");
});

test("Bootstrap: nach 24h automatisch paid (Bid-Jobs funktionieren)", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://bs2")], { minAcks: 1 });
  const provider = mkNewProvider(pool, providerKp, 25 * 3600); // seit 25h -> paid

  assert.ok(!provider.isInBootstrap(NOW), "nicht mehr in Bootstrap");

  await pool.publish(
    signEvent(buildJobRequest({ customerPubkey: customer.pk, input: "bezahlt", bidMsat: 10_000 }), customer.sk),
  );
  const r = await provider.pollOnce();
  assert.equal(r.length, 1, "Bid-Job nach Bootstrap akzeptiert");
  assert.ok(r[0].amountMsat > 0, "wird bezahlt");
});

test("Bootstrap: Gratis-Arbeit erzeugt Reputations-Event mit bootstrap-Markierung", async () => {
  const customer = generateKeypair();
  const providerKp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://bs3")], { minAcks: 1 });
  const provider = mkNewProvider(pool, providerKp, 1800); // in Bootstrap

  await pool.publish(
    signEvent(buildEvent(customer.pk, KIND_DVM_TEXT_GENERATION, [["i", "arbeite gratis", "text"]], ""), customer.sk),
  );
  await provider.pollOnce();

  const perfs = await pool.query({ kinds: [KIND_PERFORMANCE] });
  assert.equal(perfs.length, 1);
  const p = parsePerformance(perfs[0]);
  assert.equal(p.workerPubkey, providerKp.pk);
  assert.equal(p.units, 500, "Tokens zaehlen als Arbeit");
  assert.equal(p.volumeMsat, 0, "gratis (kein Umsatz)");
  const hasBootstrapTag = perfs[0].tags.some((t) => t[0] === "bootstrap" && t[1] === "1");
  assert.ok(hasBootstrapTag, "bootstrap-Markierung vorhanden (oeffentlich sichtbar)");
});

test("Bootstrap: isCurrentlyFree deckt Bootstrap + freiwilliges Free-Tier ab", () => {
  const kp = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://bs4")], { minAcks: 1 });

  // Neuer Provider (Bootstrap): free
  const newP = mkNewProvider(pool, kp, 1000);
  assert.ok(newP.isCurrentlyFree(NOW));

  // Etablierter, kein Free-Tier: paid
  const established = new DvmProvider(
    { keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", providerSince: NOW - 7 * 86400, bootstrapFreeSecs: 86400 },
    pool, new B(),
  );
  assert.ok(!established.isCurrentlyFree(NOW), "etabliert + kein Free-Tier = paid");

  // Etablierter MIT freiwilligem Free-Tier: free (Reputation sammeln)
  const voluntary = new DvmProvider(
    { keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", providerSince: NOW - 7 * 86400, bootstrapFreeSecs: 86400, freeTokensPerPubkeyPerDay: 5000 },
    pool, new B(),
  );
  assert.ok(voluntary.isCurrentlyFree(NOW), "freiwilliges Free-Tier aktiv");
});
