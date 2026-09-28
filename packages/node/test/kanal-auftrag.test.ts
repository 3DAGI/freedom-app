/**
 * Schritt 4.3c2: KI-Aufträge über den Zahlkanal. Die Gutschrift reist im
 * versiegelten Kern der Anfrage; der Knoten nimmt sie nur über seine
 * `KanalKasse` an (Deckung Gebot + Werkzeuge in Lamports), rechnet nach Tokens
 * höchstens das Gebot ab und bucht den Preis, bevor die Antwort hinausgeht.
 * Offen, ohne Kasse, mit A+-Deklaration oder ungedeckt: keine Arbeit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  KANAL_KONTO_BYTES, KANAL_PROGRAMM_ID, LocalSigner, MemoryRelay, OutboxPool, aufteilungTag, buildJobRequest,
  buildPrivateJobRequest, generateKeypair, gutschriftTags, kanalAdresse, neuerSitzungsSchluessel, openPrivateJobResponse,
  parseJobResult, regelKeineZahlungsdaten, signEvent, signiereGutschrift,
} from "@freedomstack/protocol";
import { DvmProvider, type ProviderConfig } from "../src/dvm-provider.js";
import { KanalKasse } from "../src/kanal-kasse.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

const solProvider = Keypair.generate().publicKey.toBase58();
const kunde = Keypair.generate().publicKey.toBase58();
const werber = { adresse: Keypair.generate().publicKey.toBase58(), ppm: 25_000 };
// 100.000 sats je SOL: 1 msat = 10 Lamports
const SATS_PRO_SOL = 100_000;

class ZaehlBackend implements InferenceBackend {
  aufrufe = 0;
  name(): string { return "zaehl"; }
  async available(): Promise<boolean> { return true; }
  async complete(_req: InferenceRequest): Promise<InferenceResult> {
    this.aufrufe++;
    return { output: "Antwort", model: "m", promptTokens: 1, completionTokens: 500, durationMs: 1 };
  }
}

function kanalKonto(sitzung: string, ablauf: bigint, eingezahlt: bigint): Uint8Array {
  const b = Buffer.alloc(KANAL_KONTO_BYTES);
  createHash("sha256").update("account:Channel").digest().subarray(0, 8).copy(b, 0);
  let o = 8;
  for (const k of [kunde, solProvider, sitzung]) { new PublicKey(k).toBuffer().copy(b, o); o += 32; }
  o = b.writeBigUInt64LE(1n, o); o = b.writeBigUInt64LE(eingezahlt, o); o = b.writeBigUInt64LE(0n, o);
  o = b.writeBigInt64LE(ablauf, o); o = b.writeUInt32LE(1, o);
  new PublicKey(werber.adresse).toBuffer().copy(b, o); o += 32; o = b.writeUInt32LE(werber.ppm, o);
  b[o] = 255;
  return b;
}

function aufbau(p: { mitKasse?: boolean; eingezahlt?: bigint } = {}) {
  const relay = new MemoryRelay(`mem://kanal-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const backend = new ZaehlBackend();
  const sitzung = neuerSitzungsSchluessel();
  const kanal = kanalAdresse(kunde, solProvider, 1n).adresse;
  const ablauf = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  const daten = kanalKonto(sitzung.oeffentlich, ablauf, p.eingezahlt ?? 1_000_000n);
  const kasse = new KanalKasse({
    provider: solProvider,
    lese: async (a) => (a === kanal ? { owner: KANAL_PROGRAMM_ID, daten } : null),
    sende: async () => "sig",
  });
  const cfg: ProviderConfig = {
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, solPriceSats: SATS_PRO_SOL, solanaAddress: solProvider,
    ...(p.mitKasse === false ? {} : { kanalKasse: kasse }),
  };
  const provider = new DvmProvider(cfg, pool, backend);
  return { relay, pool, kp, backend, provider, kasse, kanal, ablauf, sitzung };
}

async function anfrage(a: ReturnType<typeof aufbau>, betrag: bigint, extra: { versiegelt?: boolean; tags?: string[][]; bidMsat?: number } = {}) {
  const kp = generateKeypair();
  const kunde = new LocalSigner(kp.sk);
  const request = buildJobRequest({ customerPubkey: kunde.publicKey(), input: "Frage", bidMsat: extra.bidMsat ?? 1_000, providerPubkey: a.kp.pk });
  request.tags.push(...gutschriftTags(signiereGutschrift(a.sitzung.geheim, a.kanal, betrag, a.ablauf)), ...(extra.tags ?? []));
  if (extra.versiegelt === false) return { wrap: signEvent(request, kp.sk), kunde };
  return { wrap: (await buildPrivateJobRequest({ request, sessionSigner: kunde, providerPk: a.kp.pk, powBits: 8 })).wrap, kunde };
}

test("Kanal-Auftrag: Gutschrift gedeckt – gerechnet, höchstens das Gebot, Preis in Lamports gebucht, Antwort versiegelt", async () => {
  const a = aufbau();
  const { wrap, kunde } = await anfrage(a, 10_000n); // Gebot 1.000 msat = 10.000 Lamports
  await a.pool.publish(wrap);
  const jobs = await a.provider.pollOnce();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].amountMsat, 500, "500 Tokens × 1 msat – unter dem Gebot");
  assert.equal(jobs[0].providerMsat, 488, "2,5 % an den Werber des Kanals, abgerundet – Rest beim Provider");
  assert.equal(a.kasse.eintrag(a.kanal)!.abgerechnet, "5000", "500 msat = 5.000 Lamports gebucht");
  const umschlaege = await a.relay.query({ kinds: [1059], "#p": [kunde.publicKey()] });
  const antworten = (await Promise.all(umschlaege.map((w) => openPrivateJobResponse(w, kunde)))).flatMap((r) => (r.ok ? [r.response] : []));
  const ergebnis = parseJobResult(antworten.find((e) => e.kind === 6050)!);
  assert.equal(ergebnis.amountLamports, 5_000);
  assert.deepEqual(regelKeineZahlungsdaten(await a.relay.query({})), [], "nichts offen – auch keine Gutschrift");
  // Zweite Anfrage mit derselben Gutschrift: 5.000 frei, Gebot braucht 10.000 – abgelehnt
  const zweite = await anfrage(a, 10_000n);
  await a.pool.publish(zweite.wrap);
  assert.equal((await a.provider.pollOnce()).length, 0);
  // Mit höherer Gutschrift (abgerechnet + Gebot) wieder gedeckt
  await a.pool.publish((await anfrage(a, 15_000n)).wrap);
  assert.equal((await a.provider.pollOnce()).length, 1);
  assert.equal(a.kasse.eintrag(a.kanal)!.abgerechnet, "10000");
  assert.equal(a.backend.aufrufe, 2);
});

test("Kanal-Auftrag: ungedeckt, offen, ohne Kasse, mit A+-Deklaration oder kaputter Gutschrift – keine Arbeit", async () => {
  const faelle: Array<[string, ReturnType<typeof aufbau>, Parameters<typeof anfrage>[1], Parameters<typeof anfrage>[2]]> = [];
  faelle.push(["ungedeckt", aufbau(), 9_999n, {}]);
  faelle.push(["offen", aufbau(), 10_000n, { versiegelt: false }]);
  faelle.push(["ohne Kasse", aufbau({ mitKasse: false }), 10_000n, {}]);
  faelle.push(["A+-Deklaration", aufbau(), 10_000n, { tags: [aufteilungTag(["entwicklung"])] }]);
  faelle.push(["Gebot zu niedrig", aufbau(), 10_000n, { bidMsat: 50 }]);
  faelle.push(["über der Einlage", aufbau({ eingezahlt: 5_000n }), 10_000n, {}]);
  for (const [name, a, betrag, extra] of faelle) {
    await a.pool.publish((await anfrage(a, betrag, extra)).wrap);
    assert.equal((await a.provider.pollOnce()).length, 0, name);
    assert.equal(a.backend.aufrufe, 0, `${name}: nichts gerechnet`);
    assert.equal(a.kasse.eintrag(a.kanal)?.abgerechnet ?? "0", "0", `${name}: nichts gebucht`);
  }
  // Kaputte Gutschrift (Signatur verändert)
  const a = aufbau();
  const kundeS = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({ customerPubkey: kundeS.publicKey(), input: "Frage", bidMsat: 1_000, providerPubkey: a.kp.pk });
  const tags = gutschriftTags(signiereGutschrift(a.sitzung.geheim, a.kanal, 10_000n, a.ablauf));
  tags[1][3] = "00".repeat(64);
  request.tags.push(...tags);
  await a.pool.publish((await buildPrivateJobRequest({ request, sessionSigner: kundeS, providerPk: a.kp.pk, powBits: 8 })).wrap);
  assert.equal((await a.provider.pollOnce()).length, 0);
  assert.equal(a.backend.aufrufe, 0);
});
