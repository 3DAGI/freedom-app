/**
 * End-to-End-Test des DVM-Providers gegen MemoryRelay + Fake-Backend.
 *
 * Prueft den kompletten Loop: Kunde publiziert Job (5050) -> Provider arbeitet
 * -> Result (6050) auf dem Relay -> Leistungs-Event (38010) mit PoW ->
 * Anteil des Providers nach dem Gebührenmodell A+ (5.1).
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

test("DVM-Provider: kompletter Job-Loop mit Provider-Anteil und Leistungs-Event", async () => {
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

  // Gebührenmodell A+ (5.1): ohne Deklaration zahlt die App keine Anteile selbst –
  // der Provider bekommt den ganzen Betrag, der Knoten zahlt nichts aus
  assert.equal(job.providerMsat, 1000);
  assert.deepEqual(job.aufteilung, []);

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

test("5.1.2: Aufteilung – der Provider stellt nur seinen Anteil in Rechnung; ungültige Deklaration abgelehnt, bevor gerechnet wird", async () => {
  const { KIND_DVM_FEEDBACK, providerAnteilMsat } = await import("@freedomstack/protocol");
  const customer = generateKeypair();
  const provider = generateKeypair();
  const pool = new OutboxPool([new MemoryRelay("mem://aufteilung")], { minAcks: 1 });
  let aufrufe = 0;
  class ZaehlBackend extends FakeBackend {
    override async complete(req: InferenceRequest): Promise<InferenceResult> { aufrufe++; return super.complete(req); }
  }
  const dvm = (werber?: string) => new DvmProvider(
    { keypair: provider, lud16: "provider@wallet.cash", ...(werber ? { werber } : {}), pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 4, seasonId: "s" },
    pool, new ZaehlBackend(),
  );
  const auftrag = async (aufteilung: string[]) => {
    const ev = signEvent(buildJobRequest({ customerPubkey: customer.pk, input: "Frage", bidMsat: 10_000, extraTags: [aufteilung] }), customer.sk);
    await pool.publish(ev);
    return ev;
  };

  const ohneWerber = dvm();
  const nur = async (p: DvmProvider, ev: { id: string }) => (await p.pollOnce()).filter((j) => j.requestId === ev.id);
  const erster = await auftrag(["aufteilung", "entwicklung", "relays", "werber-kunde", "hosting"]);
  const [job] = await nur(ohneWerber, erster);
  assert.deepEqual(job!.aufteilung, ["entwicklung", "relays", "werber-kunde", "hosting"]);
  assert.equal(job!.providerMsat, 1000 - 25 - 15 - 5 - 10, "94,5 % – dieselbe Rechnung wie in der App");
  assert.equal(job!.providerMsat, providerAnteilMsat(1000, job!.aufteilung));
  assert.equal(job!.amountMsat, 1000, "das Ergebnis nennt weiter den ganzen Preis");

  const vorher = aufrufe;
  const abgelehnt = await auftrag(["aufteilung", "werber-provider"]);
  assert.deepEqual(await nur(ohneWerber, abgelehnt), [], "Werber des Providers ohne Angabe im Angebot");
  assert.equal(aufrufe, vorher, "nicht gerechnet");
  const fb = (await pool.query({ kinds: [KIND_DVM_FEEDBACK] })).filter((e) => e.tags.some((t) => t[0] === "e" && t[1] === abgelehnt.id));
  assert.match(fb[0]!.content, /Aufteilung abgelehnt/);
  const unbekannt = await auftrag(["aufteilung", "treasury"]);
  assert.deepEqual(await nur(ohneWerber, unbekannt), [], "unbekannter Anteil");

  const zweiter = await auftrag(["aufteilung", "werber-provider"]);
  const [mitWerber] = await nur(dvm("werber@wallet.example"), zweiter);
  assert.equal(mitWerber!.providerMsat, 995, "mit Werber im Angebot: 0,5 % zahlt die App ihm direkt");
});

