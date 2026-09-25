/**
 * Schritt 3.1b: Der Knoten nimmt private Anfragen im Umschlag an.
 *
 * Beweist:
 *  - Umschlag an diesen Provider wird geoeffnet und wie bisher abgearbeitet;
 *    Ergebnis verweist auf die Anfrage und geht versiegelt an den
 *    Sitzungsschluessel (seit 3.2c) – offen erscheint nichts davon
 *  - fremder Empfaenger, zu wenig Rechenarbeit: verworfen, bevor gerechnet wird
 *  - Gratis ohne Kontingent je Schluessel – die Rechenarbeit ersetzt es
 *  - ohne Gratis-Angebot: Absage per Kind 7000 an den Sitzungsschluessel
 *  - Wiederholung (derselbe Umschlag, dieselbe Anfrage neu verpackt) zaehlt einmal
 *  - offene Anfragen laufen in der Uebergangszeit weiter
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, MemoryRelay, OutboxPool, buildEvent, buildJobRequest,
  buildPrivateJobRequest, eventDifficulty, generateKeypair, getTag, openPrivateJobResponse, parseJobResult,
  regelKeineZahlungsdaten, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { DvmProvider, type ProviderConfig } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class MerkBackend implements InferenceBackend {
  prompts: string[] = [];
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.prompts.push(JSON.stringify(req));
    return { output: "Antwort", model: "merk", promptTokens: 1, completionTokens: 500, durationMs: 1 };
  }
}

function aufbau(extra: Partial<ProviderConfig> = {}) {
  const relay = new MemoryRelay(`mem://privat-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const backend = new MerkBackend();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, freeTierUntil: Math.floor(Date.now() / 1000) + 3600, ...extra,
  }, pool, backend);
  return { relay, pool, kp, backend, provider };
}

async function privateAnfrage(providerPk: string, text: string, powBits = 8, sitzung = new LocalSigner(generateKeypair().sk)) {
  const request = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: text, bidMsat: 0, providerPubkey: providerPk });
  const { wrap, requestId } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk, powBits });
  return { wrap, requestId, sitzung, request };
}

const gesendet = async (relay: MemoryRelay, kind: number): Promise<NostrEvent[]> => relay.query({ kinds: [kind] });

/** Antworten des Providers, wie der Kunde sie sieht: Umschlaege an seinen Sitzungsschluessel, geoeffnet. */
async function antwortenAn(relay: MemoryRelay, sitzung: LocalSigner) {
  const umschlaege = await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] });
  const geoeffnet = await Promise.all(umschlaege.map((w) => openPrivateJobResponse(w, sitzung)));
  return geoeffnet.flatMap((r) => (r.ok ? [r] : []));
}

test("privat: Umschlag wird geoeffnet und abgearbeitet, Antwort versiegelt an den Sitzungsschluessel", async () => {
  const { relay, pool, kp, backend, provider } = aufbau();
  const { wrap, requestId, sitzung } = await privateAnfrage(kp.pk, "Geheime Frage 42");
  await pool.publish(wrap);
  const jobs = await provider.pollOnce();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].amountMsat, 0, "Provider bietet gratis an");
  assert.ok(backend.prompts.some((p) => p.includes("Geheime Frage 42")));
  // Seit 3.2c: nichts offen – weder Ergebnis noch Zahlungsdaten auf dem Relay
  assert.equal((await gesendet(relay, KIND_DVM_TEXT_GENERATION + 1000)).length, 0);
  assert.deepEqual(regelKeineZahlungsdaten(await relay.query({})), []);
  const antworten = await antwortenAn(relay, sitzung);
  const ergebnisse = antworten.filter((a) => a.response.kind === KIND_DVM_TEXT_GENERATION + 1000);
  assert.equal(ergebnisse.length, 1);
  assert.equal(ergebnisse[0].providerPk, kp.pk);
  assert.equal(getTag(ergebnisse[0].response, "e"), requestId);
  assert.equal(getTag(ergebnisse[0].response, "p"), sitzung.publicKey());
  assert.equal(parseJobResult(ergebnisse[0].response).output, "Antwort");
  assert.equal(ergebnisse[0].response.id, jobs[0].resultEventId, "Beleg-ID = ID des Ergebnisses im Umschlag");
});

test("privat: fremder Empfaenger und zu wenig Rechenarbeit – verworfen, nichts gerechnet", async () => {
  const { kp, backend, provider } = aufbau({ privatePowBits: 8 });
  const fremd = await privateAnfrage(generateKeypair().pk, "nicht fuer dich");
  assert.equal(await provider.handlePrivate(fremd.wrap), null);

  const schwach = await privateAnfrage(kp.pk, "ohne Arbeit", 0);
  const noetig = eventDifficulty(schwach.wrap) + 1;
  const streng = aufbau({ privatePowBits: noetig, keypair: kp });
  assert.equal(await streng.provider.handlePrivate(schwach.wrap), null);
  assert.equal(backend.prompts.length + streng.backend.prompts.length, 0);
});

test("privat: gratis ohne Kontingent je Schluessel – offene Anfragen behalten es", async () => {
  // 1000 Gratis-Tokens je Schluessel und Tag, 500 je Job: offen ist nach zwei Schluss.
  const { pool, kp, provider } = aufbau({ freeTierUntil: undefined, freeTokensPerPubkeyPerDay: 1000 });
  const sitzung = new LocalSigner(generateKeypair().sk);
  for (let i = 1; i <= 3; i++) await pool.publish((await privateAnfrage(kp.pk, `privat ${i}`, 8, sitzung)).wrap);
  const privat = await provider.pollOnce();
  assert.equal(privat.length, 3, "alle drei privaten Anfragen gratis – die Rechenarbeit zaehlt");

  const kunde = generateKeypair();
  for (let i = 1; i <= 3; i++) {
    await pool.publish(signEvent(buildEvent(kunde.pk, KIND_DVM_TEXT_GENERATION, [["i", `offen ${i}`, "text"]], ""), kunde.sk));
  }
  const offen = await provider.pollOnce();
  assert.equal(offen.length, 2, "offene Anfragen: Kontingent je Schluessel wie bisher");
});

test("privat: ohne Gratis-Angebot – Absage per Kind 7000 an den Sitzungsschluessel", async () => {
  const { relay, pool, kp, backend, provider } = aufbau({ freeTierUntil: undefined });
  const { wrap, requestId, sitzung } = await privateAnfrage(kp.pk, "ohne Gebot");
  await pool.publish(wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  assert.equal(backend.prompts.length, 0);
  assert.equal((await gesendet(relay, 7000)).length, 0, "Absage nicht offen");
  const absagen = (await antwortenAn(relay, sitzung)).map((a) => a.response).filter((e) => e.kind === 7000);
  assert.equal(absagen.length, 1);
  assert.equal(getTag(absagen[0], "e"), requestId);
  assert.equal(getTag(absagen[0], "p"), sitzung.publicKey());
  assert.match(absagen[0].content, /Bid zu niedrig/);
});

test("offene Anfrage (Uebergang): Antwort bleibt offen, wie bisher", async () => {
  const { relay, pool, provider } = aufbau();
  const kunde = generateKeypair();
  await pool.publish(signEvent(buildEvent(kunde.pk, KIND_DVM_TEXT_GENERATION, [["i", "offene Frage", "text"]], ""), kunde.sk));
  assert.equal((await provider.pollOnce()).length, 1);
  const ergebnisse = await gesendet(relay, KIND_DVM_TEXT_GENERATION + 1000);
  assert.equal(ergebnisse.length, 1);
  assert.equal(getTag(ergebnisse[0], "p"), kunde.pk);
});

test("Leistungs-Event (38010): Rechenarbeit gilt auch mit bootstrap- und region-Tag", async () => {
  const { relay, pool, kp, provider } = aufbau({
    providerSince: Math.floor(Date.now() / 1000), region: "eu", powDifficulty: 8,
  });
  await pool.publish((await privateAnfrage(kp.pk, "fuer die Reputation")).wrap);
  assert.equal((await provider.pollOnce()).length, 1);
  const perf = (await relay.query({ kinds: [38010], authors: [kp.pk] }))[0];
  assert.ok(perf, "Leistungs-Event veroeffentlicht");
  assert.equal(getTag(perf, "bootstrap"), "1");
  assert.equal(getTag(perf, "region"), "eu");
  assert.ok(eventDifficulty(perf) >= 8, `Rechenarbeit ${eventDifficulty(perf)} < 8 – Tags nach dem Minen?`);
});

test("privat: Wiederholung zaehlt einmal – derselbe Umschlag und dieselbe Anfrage neu verpackt", async () => {
  const { pool, kp, backend, provider } = aufbau();
  const erst = await privateAnfrage(kp.pk, "nur einmal");
  const neuVerpackt = await buildPrivateJobRequest({ request: erst.request, sessionSigner: erst.sitzung, providerPk: kp.pk, powBits: 8 });
  assert.notEqual(neuVerpackt.wrap.id, erst.wrap.id);
  await pool.publish(erst.wrap);
  await pool.publish(neuVerpackt.wrap);
  assert.equal((await provider.pollOnce()).length, 1);
  assert.equal((await provider.pollOnce()).length, 0);
  assert.equal(backend.prompts.length, 1);
});
