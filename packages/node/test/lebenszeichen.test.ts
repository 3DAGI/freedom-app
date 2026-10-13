/**
 * L2-2 (Lauf 2 des lokalen Agenten, Sammlung Anhang F): Die App fragt einen stillen Provider
 * nach 20 s zusätzlich den nächsten. Damit ein lebender nicht als still gilt, meldet der Knoten
 * „processing“ (NIP-90, Kind 7000), sobald er einen Auftrag angenommen hat – versiegelt an den
 * Sitzungsschlüssel wie Zwischenstände; nie bei einer Ablehnung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_FEEDBACK, KIND_DVM_TEXT_GENERATION, LocalSigner, MemoryRelay, OutboxPool,
  buildJobRequest, buildPrivateJobRequest, generateKeypair, openPrivateJobResponse,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class KurzesBackend implements InferenceBackend {
  name(): string { return "kurz"; }
  async available(): Promise<boolean> { return true; }
  async complete(_req: InferenceRequest): Promise<InferenceResult> {
    return { output: "Antwort", model: "kurz", promptTokens: 1, completionTokens: 5, durationMs: 1 };
  }
}

async function lauf(gratis: boolean, umschlaege: number) {
  const relay = new MemoryRelay(`mem://leben-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, ...(gratis ? { freeTierUntil: Math.floor(Date.now() / 1000) + 3600 } : {}),
  }, pool, new KurzesBackend());
  const sitzung = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: "Hallo?", bidMsat: 0, providerPubkey: kp.pk });
  const auftrag = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 });
  await pool.publish(auftrag.wrap);
  await provider.pollOnce().catch(() => []);
  // Rückmeldungen laufen „best effort“ nebenher – bis zur erwarteten Zahl warten, mit Frist
  const an = { kinds: [1059], "#p": [sitzung.publicKey()] };
  for (let i = 0; i < 200 && (await relay.query(an)).length < umschlaege; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));
  const wraps = await relay.query(an);
  const antworten = (await Promise.all(wraps.map((w) => openPrivateJobResponse(w, sitzung)))).flatMap((r) => (r.ok ? [r.response] : []));
  return { wraps, antworten, requestId: auftrag.requestId };
}

const status = (ev: { tags: string[][] }) => ev.tags.find((t) => t[0] === "status")?.[1];

test("L2-2: angenommen → „processing“ versiegelt an den Sitzungsschlüssel, dazu das Ergebnis", async () => {
  const { wraps, antworten, requestId } = await lauf(true, 2);
  assert.equal(wraps.length, 2, "nur Umschläge, nichts offen");
  const fb = antworten.filter((a) => a.kind === KIND_DVM_FEEDBACK);
  assert.deepEqual(fb.map(status), ["processing"]);
  assert.deepEqual(fb[0].tags.filter((t) => t[0] === "e"), [["e", requestId]], "zum Auftrag");
  assert.ok(antworten.some((a) => a.kind === KIND_DVM_TEXT_GENERATION + 1000), "das Ergebnis kommt trotzdem");
});

test("L2-2: abgelehnt → nur der Fehler, kein „processing“", async () => {
  const { antworten } = await lauf(false, 1);
  assert.deepEqual(antworten.filter((a) => a.kind === KIND_DVM_FEEDBACK).map(status), ["error"]);
  assert.equal(antworten.some((a) => a.kind === KIND_DVM_TEXT_GENERATION + 1000), false);
});

test("L2-2: gemeldet nach allen Prüfungen, vor Werkzeugen und Rechnen – über Funk nie", () => {
  const q = readFileSync(new URL("../src/dvm-provider.ts", import.meta.url), "utf8");
  const auftrag = q.slice(q.indexOf("private async handleJob("));
  const melde = auftrag.indexOf("if (!kurz) this.meldeBearbeitung(request, privat);");
  assert.ok(melde > 0);
  assert.ok(auftrag.indexOf('throw new Error("Schwarm nur gegen Bezahlung")') < melde, "nach der letzten Ablehnung");
  assert.ok(melde < auftrag.indexOf("await this.toolRegistry.run(tc)"), "vor den Werkzeugen (die dauern)");
  assert.ok(melde < auftrag.indexOf("await this.backend.complete("));
  assert.match(q, /\["status", "processing"\]\], "processing"\)/);
});
