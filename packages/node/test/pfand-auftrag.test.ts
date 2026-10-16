/**
 * RM2b2: KI-Aufträge mit Cashu-Pfand. Die Token reisen im versiegelten Kern der Anfrage; der Knoten
 * nimmt sie nur über seine `PfandKasse` an (Deckung: Anteil des Providers an Gebot und Werkzeugen,
 * je Sitzungsschlüssel), rechnet höchstens das Gebot ab und bucht den Anteil des Providers, bevor
 * die Antwort hinausgeht. Offen, ohne Kasse, neben einer Gutschrift, ungedeckt oder kaputt: keine Arbeit.
 * Die Kasse selbst (gegen eine Mint) prüft `pfand-kasse.test.ts`; über den Provider geht nur eine Mint mit
 * https oder .onion (`lesePfandTags()`), die Test-Mint läuft auf http://127.0.0.1 – hier schreibt eine Attrappe mit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  LocalSigner, MemoryRelay, OutboxPool, aufteilungTag, buildJobRequest, buildPrivateJobRequest, generateKeypair,
  gutschriftTags, openPrivateJobResponse, parseJobResult, pfandTags, providerAnteilMsat, regelKeineZahlungsdaten,
  signEvent, type Pfand,
} from "@freedomstack/protocol";
import { DvmProvider, type ProviderConfig } from "../src/dvm-provider.js";
import type { PfandAnnahme } from "../src/pfand-kasse.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

const hex = (n: number) => randomBytes(n).toString("hex");

class ZaehlBackend implements InferenceBackend {
  aufrufe = 0;
  name(): string { return "zaehl"; }
  async available(): Promise<boolean> { return true; }
  async complete(_req: InferenceRequest): Promise<InferenceResult> {
    this.aufrufe++;
    return { output: "Antwort", model: "m", promptTokens: 1, completionTokens: 500, durationMs: 1 };
  }
}

/** Eine Kasse, die nur mitschreibt – die Prüfung selbst testet `pfand-kasse.test.ts`. */
class Mitschrift {
  angenommen: Array<{ sitzung: string; bedarf: number; token: number }> = [];
  gebucht: Array<[string, number]> = [];
  constructor(private readonly antwort: PfandAnnahme = { ok: true, guthabenMsat: 1_000_000 }) {}
  async nimmAn(p: Pfand, sitzung: string, bedarf: number): Promise<PfandAnnahme> {
    this.angenommen.push({ sitzung, bedarf, token: p.token.length });
    return this.antwort;
  }
  verbuche(sitzung: string, msat: number): number {
    this.gebucht.push([sitzung, msat]);
    return msat;
  }
}

/** Ein Token in der Form aus NUT-00/NUT-12 – für die Mitschrift genügt die Form. */
const formToken = () => ({ id: "00" + hex(7), amount: 8, secret: hex(32), C: "02" + hex(32), dleq: { e: hex(32), s: hex(32), r: hex(32) } });

function aufbau(kasse?: ProviderConfig["pfandKasse"]) {
  const relay = new MemoryRelay(`mem://pfand-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const backend = new ZaehlBackend();
  const cfg: ProviderConfig = {
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, ...(kasse ? { pfandKasse: kasse } : {}),
  };
  return { relay, pool, kp, backend, provider: new DvmProvider(cfg, pool, backend) };
}

async function anfrage(a: ReturnType<typeof aufbau>, pfand: Pfand, extra: { versiegelt?: boolean; tags?: string[][]; bidMsat?: number } = {}) {
  const kp = generateKeypair();
  const kunde = new LocalSigner(kp.sk);
  const request = buildJobRequest({ customerPubkey: kunde.publicKey(), input: "Frage", bidMsat: extra.bidMsat ?? 1_000, providerPubkey: a.kp.pk });
  request.tags.push(...pfandTags(pfand), ...(extra.tags ?? []));
  const wrap = extra.versiegelt === false
    ? signEvent(request, kp.sk)
    : (await buildPrivateJobRequest({ request, sessionSigner: kunde, providerPk: a.kp.pk, powBits: 8 })).wrap;
  return { wrap, kunde };
}

const PFAND: Pfand = { mint: "https://mint.example.org", token: [formToken()] };

test("Pfand-Auftrag: gedeckt – gerechnet, höchstens das Gebot, Anteil des Providers gebucht, je Sitzungsschlüssel", async () => {
  const kasse = new Mitschrift();
  const a = aufbau(kasse);
  const { wrap, kunde } = await anfrage(a, PFAND, { tags: [aufteilungTag(["entwicklung", "relays"])] });
  await a.pool.publish(wrap);
  const jobs = await a.provider.pollOnce();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.amountMsat, 500, "500 Tokens × 1 msat – unter dem Gebot");
  const anteil = providerAnteilMsat(500, ["entwicklung", "relays"]);
  assert.equal(jobs[0]!.providerMsat, anteil);
  assert.deepEqual(kasse.angenommen, [{ sitzung: kunde.publicKey(), bedarf: providerAnteilMsat(1_000, ["entwicklung", "relays"]), token: 1 }],
    "Deckung: Anteil des Providers am Gebot, je Sitzungsschlüssel der Anfrage");
  assert.deepEqual(kasse.gebucht, [[kunde.publicKey(), anteil]], "gebucht nur der Anteil des Providers");
  const umschlaege = await a.relay.query({ kinds: [1059], "#p": [kunde.publicKey()] });
  const antworten = (await Promise.all(umschlaege.map((w) => openPrivateJobResponse(w, kunde)))).flatMap((r) => (r.ok ? [r.response] : []));
  assert.equal(parseJobResult(antworten.find((e) => e.kind === 6050)!).amountMsat, 500);
  assert.deepEqual(regelKeineZahlungsdaten(await a.relay.query({})), [], "nichts offen – auch kein Pfand");
  // Ohne neue Token: die Kasse rechnet gegen das schon Übergebene
  await a.pool.publish((await anfrage(a, { mint: PFAND.mint, token: [] })).wrap);
  assert.equal((await a.provider.pollOnce()).length, 1);
  assert.equal(kasse.angenommen[1]!.token, 0);
  assert.equal(a.backend.aufrufe, 2);
});

test("Pfand-Auftrag: ungedeckt, offen, ohne Kasse, neben einer Gutschrift, Gebot zu niedrig oder kaputt – keine Arbeit", async () => {
  const gutschrift = gutschriftTags({ kanal: "11111111111111111111111111111111", betrag: 10_000n, ablauf: 2_000_000_000n, signatur: "00".repeat(64) });
  const faelle: Array<[string, Mitschrift | undefined, Parameters<typeof anfrage>[1], Parameters<typeof anfrage>[2]]> = [
    ["ungedeckt", new Mitschrift({ ok: false, fall: "pfand-deckung" }), PFAND, {}],
    ["offen", new Mitschrift(), PFAND, { versiegelt: false }],
    ["ohne Kasse", undefined, PFAND, {}],
    ["neben einer Gutschrift", new Mitschrift(), PFAND, { tags: gutschrift }],
    ["Gebot zu niedrig", new Mitschrift(), PFAND, { bidMsat: 50 }],
  ];
  for (const [name, kasse, pfand, extra] of faelle) {
    const a = aufbau(kasse);
    await a.pool.publish((await anfrage(a, pfand, extra)).wrap);
    assert.equal((await a.provider.pollOnce()).length, 0, name);
    assert.equal(a.backend.aufrufe, 0, `${name}: nichts gerechnet`);
    assert.deepEqual(kasse?.gebucht ?? [], [], `${name}: nichts gebucht`);
  }
  // Kaputte Form: lesePfandTags wirft – die Kasse sieht nichts
  const kasse = new Mitschrift();
  const a = aufbau(kasse);
  const kunde = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({ customerPubkey: kunde.publicKey(), input: "Frage", bidMsat: 1_000, providerPubkey: a.kp.pk });
  request.tags.push(["pfand", PFAND.mint, "kein json"]);
  await a.pool.publish((await buildPrivateJobRequest({ request, sessionSigner: kunde, providerPk: a.kp.pk, powBits: 8 })).wrap);
  assert.equal((await a.provider.pollOnce()).length, 0);
  assert.deepEqual(kasse.angenommen, []);
});
