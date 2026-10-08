/**
 * A-14a (G1, MENSCH 08.10.2026): Gratis-Budget je Knoten.
 *
 * Beweist:
 *  - private Gratis-Anfrage mit genug Rechenarbeit: gratis, höchstens die
 *    Tokens je Antwort, ohne Werkzeuge des Modells; das Budget zählt Frage und Antwort
 *  - Budget verbraucht: Absage mit Kennung `gratis-leer`, versiegelt; „gerade gratis“ aus;
 *    am nächsten Tag (UTC) wieder voll
 *  - zu wenig Rechenarbeit für Gratis: abgelehnt, nichts gerechnet, nichts verbucht
 *  - Werkzeuge und Schwarm gibt es gratis nicht
 *  - bezahlte Anfragen ändert die Regel nicht
 *  - Bootstrap-Phase: ein Gebot wird gratis bedient (statt abgelehnt) – nach der Budget-Regel
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRATIS_LEER, KIND_DVM_TEXT_GENERATION, LocalSigner, MemoryRelay, OutboxPool, buildJobRequest,
  buildPrivateJobRequest, eventDifficulty, generateKeypair, getTag, openPrivateJobResponse, type GratisAngebot,
} from "@freedomstack/protocol";
import { DvmProvider, type ProviderConfig } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

/** Merkt jede Anfrage ans Modell; je Antwort 100 Tokens Frage, 500 Antwort. */
class MerkBackend implements InferenceBackend {
  anfragen: InferenceRequest[] = [];
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.anfragen.push(req);
    return { output: "Antwort", model: "merk", promptTokens: 100, completionTokens: 500, durationMs: 1 };
  }
}

const GRATIS: GratisAngebot = { tokensProTag: 1200, tokensJeAntwort: 300, powBits: 10 };

function aufbau(extra: Partial<ProviderConfig> = {}) {
  const relay = new MemoryRelay(`mem://gratis-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const backend = new MerkBackend();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, gratis: GRATIS, ...extra,
  }, pool, backend);
  return { relay, pool, kp, backend, provider };
}

async function anfrage(providerPk: string, o: { powBits?: number; bidMsat?: number; tags?: string[][] } = {}) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: "Frage", bidMsat: o.bidMsat ?? 0, providerPubkey: providerPk, extraTags: o.tags,
  });
  const { wrap, requestId } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk, powBits: o.powBits ?? GRATIS.powBits });
  return { wrap, requestId, sitzung };
}

/** Antworten des Knotens, wie der Kunde sie sieht (versiegelt an den Sitzungsschlüssel). */
async function antwortenAn(relay: MemoryRelay, sitzung: LocalSigner) {
  const umschlaege = await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] });
  const offen = await Promise.all(umschlaege.map((w) => openPrivateJobResponse(w, sitzung)));
  return offen.flatMap((r) => (r.ok ? [r.response] : []));
}

const absage = async (relay: MemoryRelay, sitzung: LocalSigner) =>
  (await antwortenAn(relay, sitzung)).find((e) => e.kind === 7000);

test("Gratis-Budget: gratis mit Grenze je Antwort und ohne Werkzeuge – leer heißt gratis-leer", async () => {
  const { relay, kp, backend, provider } = aufbau();
  const jetzt = Math.floor(Date.now() / 1000);
  assert.equal(provider.gratisRest(jetzt), 1200);
  assert.ok(provider.isCurrentlyFree(jetzt), "Budget übrig: gerade gratis");

  for (let i = 0; i < 2; i++) {
    const a = await anfrage(kp.pk);
    const job = await provider.handlePrivate(a.wrap);
    assert.equal(job?.amountMsat, 0, `Antwort ${i + 1} gratis`);
  }
  assert.equal(backend.anfragen.length, 2);
  for (const r of backend.anfragen) {
    assert.equal(r.maxTokens, 300, "höchstens die Tokens je Antwort aus dem Angebot");
    assert.equal(r.ohneWerkzeuge, true, "das Modell bekommt keine Werkzeuge");
  }
  assert.equal(provider.gratisRest(jetzt), 0, "Frage und Antwort zählen: 2 × (100 + 500)");
  assert.ok(!provider.isCurrentlyFree(jetzt), "Budget leer: nicht mehr gerade gratis");

  const dritte = await anfrage(kp.pk);
  await assert.rejects(provider.handlePrivate(dritte.wrap), /Gratis-Budget für heute aufgebraucht/);
  assert.equal(backend.anfragen.length, 2, "nichts mehr gerechnet");
  const fb = await absage(relay, dritte.sitzung);
  assert.ok(fb, "Absage versiegelt an den Sitzungsschlüssel");
  assert.equal(getTag(fb!, "status"), "error");
  assert.equal(getTag(fb!, "fall"), GRATIS_LEER, "Kennung für die App");
  assert.equal(getTag(fb!, "e"), dritte.requestId);

  assert.equal(provider.gratisRest(jetzt + 86_400), 1200, "am nächsten Tag (UTC) wieder voll");
});

test("Gratis-Budget: zu wenig Rechenarbeit – abgelehnt, nichts gerechnet, nichts verbucht", async () => {
  const { relay, kp, backend, provider } = aufbau();
  // Die Rechenarbeit eines Umschlags ist „mindestens“ – zufällig kann er mehr tragen. Nur einer mit sicher zu wenig zählt.
  let a = await anfrage(kp.pk, { powBits: 8 });
  while (eventDifficulty(a.wrap) >= GRATIS.powBits) a = await anfrage(kp.pk, { powBits: 8 });
  await assert.rejects(provider.handlePrivate(a.wrap), /Gratis nur mit 10 Bit Rechenarbeit \(gesendet: (8|9)\)/);
  assert.equal(backend.anfragen.length, 0);
  assert.equal(provider.gratisRest(), 1200);
  const fb = await absage(relay, a.sitzung);
  assert.ok(fb && getTag(fb, "fall") === undefined, "Absage ohne Kennung gratis-leer");
});

test("Gratis-Budget: Werkzeuge und Schwarm nur gegen Bezahlung", async () => {
  const { kp, backend, provider } = aufbau();
  const mitWerkzeug = await anfrage(kp.pk, { tags: [["tool", "5060", "wetter"]] });
  await assert.rejects(provider.handlePrivate(mitWerkzeug.wrap), /Werkzeuge nur gegen Bezahlung/);
  const schwarm = await anfrage(kp.pk, { tags: [["swarm", "1"]] });
  await assert.rejects(provider.handlePrivate(schwarm.wrap), /Schwarm nur gegen Bezahlung/);
  assert.equal(backend.anfragen.length, 0);
  assert.equal(provider.gratisRest(), 1200);
});

test("Gratis-Budget: bezahlte Anfragen ändert die Regel nicht", async () => {
  const { kp, backend, provider } = aufbau({ gratis: { ...GRATIS, tokensProTag: 1 } });
  // Budget verbrauchen: eine Gratis-Antwort (600 Tokens) überzieht das eine Token
  assert.equal((await provider.handlePrivate((await anfrage(kp.pk)).wrap))?.amountMsat, 0);
  assert.equal(provider.gratisRest(), 0);
  const bezahlt = await anfrage(kp.pk, { bidMsat: 10_000, powBits: 8 });
  const job = await provider.handlePrivate(bezahlt.wrap);
  assert.ok(job && job.amountMsat > 0, "Gebot wird wie bisher abgerechnet");
  const r = backend.anfragen.at(-1)!;
  assert.equal(r.maxTokens, undefined, "keine Grenze je Antwort");
  assert.equal(r.ohneWerkzeuge, undefined);
});

test("Bootstrap: Gebot gratis bedient – nach der Budget-Regel", async () => {
  const jetzt = Math.floor(Date.now() / 1000);
  const { relay, kp, backend, provider } = aufbau({ providerSince: jetzt - 3600, bootstrapFreeSecs: 24 * 3600, gratis: { ...GRATIS, tokensProTag: 600 } });
  assert.ok(provider.isInBootstrap(jetzt));
  const gebot = await anfrage(kp.pk, { bidMsat: 10_000, powBits: 8 });
  const job = await provider.handlePrivate(gebot.wrap);
  assert.equal(job?.amountMsat, 0, "kein Verdienst in der Bootstrap-Phase, aber eine Antwort");
  assert.equal(backend.anfragen[0].maxTokens, 300, "als Gratis-Antwort begrenzt");
  assert.equal(provider.gratisRest(jetzt), 0, "zählt ins Budget");

  const zweites = await anfrage(kp.pk, { bidMsat: 10_000, powBits: 8 });
  await assert.rejects(provider.handlePrivate(zweites.wrap), /Gratis-Budget für heute aufgebraucht/);
  assert.equal(getTag((await absage(relay, zweites.sitzung))!, "fall"), GRATIS_LEER);
});

test("Gratis-Budget: Ergebnis-Kind bleibt das der Anfrage", async () => {
  const { relay, kp, provider } = aufbau();
  const a = await anfrage(kp.pk);
  await provider.handlePrivate(a.wrap);
  const ergebnis = (await antwortenAn(relay, a.sitzung)).find((e) => e.kind === KIND_DVM_TEXT_GENERATION + 1000);
  assert.ok(ergebnis, "Gratis-Antwort kommt versiegelt wie jede andere");
});
