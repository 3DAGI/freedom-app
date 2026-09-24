/**
 * End-to-End-Test des DVM-Providers gegen MemoryRelay + Fake-Backend.
 *
 * Prueft den kompletten Loop: Kunde publiziert Job (5050) -> Provider arbeitet
 * -> Result (6050) auf dem Relay -> Leistungs-Event (38010) mit PoW ->
 * 1%-Fee-Split korrekt berechnet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  buildJobRequest,
  parseJobResult,
  parsePerformance,
  eventDifficulty,
  OutboxPool,
  MemoryRelay,
  KIND_DVM_TEXT_RESULT,
  KIND_PERFORMANCE,
  PROTOCOL_FEE_PPM,
  PROTOCOL_POOL_SHARE_PERCENT,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

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

test("DVM-Provider: kompletter Job-Loop mit Fee-Split und Leistungs-Event", async () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const relay = new MemoryRelay("mem://a");
  const pool = new OutboxPool([relay], { minAcks: 1 });

  const dvm = new DvmProvider(
    {
      keypair: provider,
      lud16: "provider@wallet.cash",
      pricePerKTokenMsat: 1000,
      minBidMsat: 100,
      powDifficulty: 8,
      seasonId: "test-season",
    },
    pool,
    new FakeBackend(),
  );

  // Kunde publiziert Job: bid 10_000 msat, Backend liefert 1000 Tokens
  const request = signEvent(
    buildJobRequest({
      customerPubkey: customer.pk,
      input: "Was ist Zensurresistenz?",
      bidMsat: 10_000,
    }),
    customer.sk,
  );
  await pool.publish(request);

  const processed = await dvm.pollOnce();
  assert.equal(processed.length, 1, "genau ein Job verarbeitet");

  const job = processed[0];
  // 1000 Tokens * 1000 msat/1k = 1000 msat (< bid, also gedeckelt auf Preis)
  assert.equal(job.amountMsat, 1000);

  // Fee-Split gegen die Konstanten gerechnet, nicht gegen Magic Numbers:
  // sonst laufen Test und protocol-fee.ts wieder auseinander (Faktor-10-Bug).
  const expectedFee = Math.floor((1000 * PROTOCOL_FEE_PPM) / 1_000_000);
  const expectedPool = Math.floor((expectedFee * PROTOCOL_POOL_SHARE_PERCENT) / 100);
  assert.equal(job.feeSplit.recipientMsat, 1000 - expectedFee);
  assert.equal(job.feeSplit.poolMsat + job.feeSplit.protocolMsat, expectedFee);
  assert.equal(job.feeSplit.poolMsat, expectedPool);
  assert.ok(expectedFee > 0, "Fee darf bei 1000 msat nicht auf 0 runden");

  // Result-Event liegt auf dem Relay und ist valide
  const results = await pool.query({ kinds: [KIND_DVM_TEXT_RESULT] });
  assert.equal(results.length, 1);
  const parsed = parseJobResult(results[0]);
  assert.equal(parsed.requestId, request.id);
  assert.equal(parsed.customerPubkey, customer.pk);
  assert.equal(parsed.output, "Antwort auf: Was ist Zensurresistenz?");
  assert.equal(parsed.amountMsat, 1000);

  // Leistungs-Event mit PoW liegt vor
  const perfs = await pool.query({ kinds: [KIND_PERFORMANCE] });
  assert.equal(perfs.length, 1);
  const perf = parsePerformance(perfs[0]);
  assert.equal(perf.workerPubkey, provider.pk);
  assert.equal(perf.workType, "ai_job");
  assert.equal(perf.units, 1000);
  assert.ok(eventDifficulty(perfs[0]) >= 8, "PoW-Difficulty erreicht");

  // Idempotenz: zweiter Poll verarbeitet nichts doppelt
  const again = await dvm.pollOnce();
  assert.equal(again.length, 0);
});

test("DVM-Provider: ignoriert Jobs unter Mindestgebot", async () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://b")], { minAcks: 1 });
  const dvm = new DvmProvider(
    {
      keypair: provider,
      lud16: "p@x.cash",
      pricePerKTokenMsat: 1000,
      minBidMsat: 500,
      powDifficulty: 4,
      seasonId: "s",
    },
    pool,
    new FakeBackend(),
  );

  await pool.publish(
    signEvent(
      buildJobRequest({ customerPubkey: customer.pk, input: "billig", bidMsat: 50 }),
      customer.sk,
    ),
  );
  const processed = await dvm.pollOnce();
  assert.equal(processed.length, 0, "Job unter Mindestgebot ignoriert");
});

test("Fee-Konstanten: ppm passt zur Prozentangabe, Anteile ergeben 100%", async () => {
  const {
    PROTOCOL_FEE_PERCENT,
    FEE_POOL_SHARE_PERCENT,
    FEE_REFERRAL_SHARE_PERCENT,
    FEE_POOL_PPM,
    FEE_REFERRAL_PPM,
    splitFeeV1,
  } = await import("@freedomstack/protocol");

  // Der urspruengliche Bug war die Umrechnung Prozent <-> ppm.
  assert.equal(PROTOCOL_FEE_PPM, PROTOCOL_FEE_PERCENT * 10_000);

  // Die Protokollfee finanziert nur noch das Netz: Pool und Referral. Der
  // Dev-Anteil ist in die Client-Schicht gewandert (client-fee.ts) und taucht
  // hier bewusst nicht mehr auf.
  assert.equal(FEE_POOL_SHARE_PERCENT + FEE_REFERRAL_SHARE_PERCENT, 100);
  assert.equal(FEE_POOL_PPM + FEE_REFERRAL_PPM, PROTOCOL_FEE_PPM);
  assert.equal(PROTOCOL_POOL_SHARE_PERCENT, FEE_POOL_SHARE_PERCENT);

  // Absolut hat sich fuer Provider und Werber nichts geaendert.
  assert.equal(FEE_POOL_PPM, 20_000, "weiterhin 2,0 % der Zahlung");
  assert.equal(FEE_REFERRAL_PPM, 5_000, "weiterhin 0,5 % der Zahlung");

  // Kein Satoshi verschwindet und keiner entsteht.
  const amount = 1_000_000;
  const s = splitFeeV1(amount);
  assert.equal(s.workerMsat + s.poolMsat + s.referralMsat, amount);
  assert.ok(s.workerMsat > 0 && s.poolMsat > 0 && s.referralMsat > 0);
});

test("Client-Gebuehr: gedeckelt, damit die offene Schicht nicht gegen den Nutzer wirkt", async () => {
  const { checkClientFee, clientFeePpm, MAX_CLIENT_FEE_PERCENT, splitWithClientFee, splitFeeV1 } =
    await import("@freedomstack/protocol");

  // Ein Client koennte 90 % fuer sich deklarieren — der Provider lehnt ab.
  const gierig = checkClientFee({ recipient: "a@b.c", ppm: clientFeePpm(90), clientName: "Gierig" });
  assert.equal(gierig.accepted, false);
  assert.match(gierig.reason, /Obergrenze/);

  const normal = checkClientFee({ recipient: "a@b.c", ppm: clientFeePpm(2.5), clientName: "Freedom" });
  assert.equal(normal.accepted, true);
  assert.equal(normal.ppm, 25_000);

  // Ohne Deklaration ist der Job voll gueltig — nichts wird erzwungen.
  assert.equal(checkClientFee(null).accepted, true);
  assert.equal(checkClientFee(null).ppm, 0);
  assert.ok(MAX_CLIENT_FEE_PERCENT <= 10);

  // Die Client-Gebuehr geht vom Provider-Anteil ab, nicht von Pool/Referral.
  const amount = 1_000_000;
  const p = splitFeeV1(amount);
  const voll = splitWithClientFee(amount, p, clientFeePpm(2.5));
  assert.equal(voll.poolMsat, p.poolMsat, "Pool unberuehrt");
  assert.equal(voll.referralMsat, p.referralMsat, "Referral unberuehrt");
  assert.equal(voll.workerMsat, p.workerMsat - voll.clientMsat);
  assert.equal(voll.workerMsat + voll.poolMsat + voll.referralMsat + voll.clientMsat, amount);
  // Fuer den Nutzer bleibt es bei 5 % gesamt wie vorher.
  assert.equal(Number(voll.totalFeePercent.toFixed(1)), 5.0);
});
