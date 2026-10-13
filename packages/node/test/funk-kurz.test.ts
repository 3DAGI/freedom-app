/**
 * Schritt 7.4a: Über ein Funk-Gateway verlangt der Auftrag eine kurze Antwort
 * (`max_zeichen`). Der Provider bittet das Modell darum, kürzt das Ergebnis
 * hart und schickt keine Zwischenstände – jede Rückmeldung kostet Sendezeit.
 * Ohne den Parameter bleibt alles wie bisher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNK_MAX_ZEICHEN, KIND_DVM_FEEDBACK, KIND_DVM_TEXT_GENERATION, LocalSigner, MemoryRelay, OutboxPool,
  buildJobRequest, buildPrivateJobRequest, generateKeypair, kurzParam, openPrivateJobResponse, parseJobResult,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

/** Redet lang und meldet unterwegs einen Werkzeugschritt – wie ein Modell mit Werkzeugen. */
class LangesBackend implements InferenceBackend {
  prompts: string[] = [];
  name(): string { return "lang"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.prompts.push(req.prompt);
    req.onProgress?.("tool:web_search");
    return { output: "Wasser sprudelnd abkochen, dann abkühlen lassen. ".repeat(60), model: "lang", promptTokens: 1, completionTokens: 900, durationMs: 1 };
  }
}

async function lauf(params: string[][], umschlaege: number) {
  const relay = new MemoryRelay(`mem://funk-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const backend = new LangesBackend();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, freeTierUntil: Math.floor(Date.now() / 1000) + 3600,
  }, pool, backend);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: "Wie reinige ich Wasser?", bidMsat: 0, providerPubkey: kp.pk, params });
  await pool.publish((await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 })).wrap);
  assert.equal((await provider.pollOnce()).length, 1);
  // Rückmeldungen laufen „best effort“ nebenher: auf die erwarteten Umschläge
  // warten (feste 20 ms reichten bei voller Last nicht, gesehen in 11.1b),
  // danach noch ein wenig, damit auch ein unerwarteter auffiele
  const an = { kinds: [1059], "#p": [sitzung.publicKey()] };
  for (let i = 0; i < 200 && (await relay.query(an)).length < umschlaege; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));
  const antworten = (await Promise.all((await relay.query(an)).map((w) => openPrivateJobResponse(w, sitzung))))
    .flatMap((r) => (r.ok ? [r.response] : []));
  return { backend, antworten };
}

test("7.4a: max_zeichen – gekürzt auf höchstens 500 Zeichen, keine Zwischenstände, das Modell wird um Kürze gebeten", async () => {
  const { backend, antworten } = await lauf([kurzParam()], 1);
  assert.equal(antworten.filter((a) => a.kind === KIND_DVM_FEEDBACK).length, 0, "keine Zwischenstände");
  const ergebnis = antworten.find((a) => a.kind === KIND_DVM_TEXT_GENERATION + 1000)!;
  const text = parseJobResult(ergebnis).output;
  assert.ok([...text].length <= FUNK_MAX_ZEICHEN, `${[...text].length} Zeichen`);
  assert.ok(text.endsWith("…"), "erkennbar gekürzt");
  assert.match(backend.prompts[0]!, /Antworte in höchstens 500 Zeichen/);
});

test("7.4a: ohne max_zeichen bleibt alles wie bisher – ganze Antwort, Zwischenstand, keine Bitte um Kürze", async () => {
  const { backend, antworten } = await lauf([], 3);
  const status = (s: string) => antworten.filter((a) => a.kind === KIND_DVM_FEEDBACK && a.tags.some((t) => t[0] === "status" && t[1] === s));
  assert.equal(status("progress").length, 1, "Zwischenstand wie bisher");
  assert.equal(status("processing").length, 1, "angenommen (L2-2) – über Funk nicht, siehe oben");
  assert.equal(antworten.filter((a) => a.kind === KIND_DVM_FEEDBACK).length, 2);
  const text = parseJobResult(antworten.find((a) => a.kind === KIND_DVM_TEXT_GENERATION + 1000)!).output;
  assert.ok([...text].length > FUNK_MAX_ZEICHEN);
  assert.doesNotMatch(backend.prompts[0]!, /höchstens \d+ Zeichen/);
});
