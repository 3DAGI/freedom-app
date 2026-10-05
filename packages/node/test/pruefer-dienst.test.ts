/**
 * Freedom-Prüfung P3b (E7, docs/FREEDOM-PRUEFUNG.md 3.2): die Prüfer-Rolle im
 * Netz – Angebote lesen, Prüffragen versiegelt senden, Antworten abholen,
 * Berichte (38081) veröffentlichen. Mit einem echten Provider (`DvmProvider`)
 * über ein Relay im Speicher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_MESSBERICHT, LocalSigner, MemoryRelay, OutboxPool, buildCapabilities, buildJobResult, buildPrivateJobResponse, generateKeypair,
  leseMessbericht, openPrivateJobRequest, signEvent, type Keypair, type NostrEvent,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { PRUEFER_NETZ, PrueferDienst, prueferAusUmgebung, type PrueferNetz } from "../src/pruefer-dienst.js";
import { PRUEFER_TAKT } from "../src/pruefer-rolle.js";

// Einmal aus der Uhr: Der Provider liest Anfragen der letzten Stunde (echte Zeit)
const START_MS = Math.floor(Date.now() / 1000) * 1000;
const START = START_MS / 1000;

/** Rechnet die Prüffrage „Compute a + b“ richtig – wie ein ehrliches Modell. */
class Rechner implements InferenceBackend {
  fragen = 0;
  name(): string { return "rechner"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.fragen++;
    const m = /Compute (\d+) \+ (\d+)/.exec(JSON.stringify(req));
    return { output: m ? String(Number(m[1]) + Number(m[2])) : "?", model: "m", promptTokens: 10, completionTokens: 30, durationMs: 1 };
  }
}

const angebot = (kp: Keypair, p: { frei?: boolean; pow?: number; zeit?: number; models?: string[] } = {}) => signEvent(buildCapabilities({
  pubkey: kp.pk, tier: "classic", models: p.models ?? ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: p.frei ?? true, powBits: p.pow ?? 8,
}, p.zeit ?? START - 60), kp.sk);

function aufbau() {
  const relay = new MemoryRelay(`mem://pruefer-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const providerKp = generateKeypair();
  const backend = new Rechner();
  const provider = new DvmProvider({
    keypair: providerKp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, freeTierUntil: START + 3600,
  }, pool, backend);
  const uhr = { ms: START_MS };
  const prueferKp = generateKeypair();
  const dienst = new PrueferDienst({ netz: pool, schluessel: prueferKp, jetztMs: () => uhr.ms, zufall: () => 0 });
  return { relay, pool, providerKp, provider, backend, uhr, prueferKp, dienst };
}

test("Prüfer im Netz: Angebot gelesen, Prüffrage versiegelt gesendet, Antwort abgeholt und ausgewertet, Bericht signiert veröffentlicht", async () => {
  const { relay, pool, providerKp, provider, backend, uhr, prueferKp, dienst } = aufbau();
  await pool.publish(angebot(providerKp));
  assert.deepEqual(await dienst.runde(), { gesendet: 1, ausgewertet: 0, berichte: 0 });
  assert.equal(dienst.plan.anzahl, 1);
  assert.equal(dienst.unterwegs, 1);
  // Offen steht nichts von der Frage – nur der Umschlag an den Provider
  const offen = JSON.stringify(await relay.query({}));
  assert.ok(!offen.includes("Compute 100 + 100"), "Prüffrage nie offen");
  assert.equal((await provider.pollOnce()).length, 1);
  assert.equal(backend.fragen, 1, "der Provider beantwortet sie wie jede Anfrage");
  uhr.ms += 3_000;
  assert.deepEqual(await dienst.runde(), { gesendet: 0, ausgewertet: 1, berichte: 0 });
  assert.equal(dienst.unterwegs, 0);
  // Nach dem Abstand der Berichte: einer je Provider und Modell, vom Prüfer signiert
  uhr.ms += PRUEFER_NETZ.berichtSek * 1000;
  const r = await dienst.runde();
  assert.equal(r?.berichte, 1);
  const berichte = await relay.query({ kinds: [KIND_MESSBERICHT] });
  assert.equal(berichte.length, 1);
  const jetzt = Math.floor(uhr.ms / 1000);
  const b = leseMessbericht(berichte[0]!, jetzt);
  assert.ok(b);
  assert.equal(b.pruefer, prueferKp.pk);
  assert.equal(b.provider, providerKp.pk);
  assert.equal(b.modell, "m");
  assert.deepEqual([b.anfragen, b.erfolge, b.medianMs, b.stufe], [1, 1, 3_000, "neu"]);
  assert.deepEqual(b.treffer, { rechnen: { richtig: 1, geprueft: 1 } });
  assert.ok(!JSON.stringify(berichte[0]).includes("Compute"), "keine Prüffrage im Bericht");
});

/** Netz, das mitschreibt und auf Wunsch schweigt (kein Relay antwortet). */
function stummesNetz(pool: OutboxPool, gesendet: NostrEvent[], still: { an: boolean }): PrueferNetz {
  return {
    queryMitBericht: async (f) => (still.an ? { events: [], antworten: [] } : pool.queryMitBericht(f)),
    publish: async (ev) => { gesendet.push(ev); return pool.publish(ev); },
  };
}

test("Frist: keine Antwort zählt als Ausfall – aber nicht, solange kein Relay antwortet; Antworten Fremder zählen nicht", async () => {
  const { pool, providerKp, uhr } = aufbau();
  await pool.publish(angebot(providerKp));
  const gesendet: NostrEvent[] = [];
  const still = { an: false };
  const dienst = new PrueferDienst({ netz: stummesNetz(pool, gesendet, still), schluessel: generateKeypair(), jetztMs: () => uhr.ms, zufall: () => 0 });
  await dienst.runde();
  assert.equal(gesendet.length, 1);
  // Ein Fremder antwortet an den Sitzungsschlüssel – „richtig“, aber nicht der gefragte Provider
  const auftrag = await openPrivateJobRequest(gesendet[0]!, new LocalSigner(providerKp.sk));
  assert.equal(auftrag.ok, true);
  if (!auftrag.ok) return;
  const fremd = generateKeypair();
  const response = buildJobResult({ providerPubkey: fremd.pk, requestId: auftrag.request.id!, requestKind: 5050, customerPubkey: auftrag.kundePk, output: "200", amountMsat: 0 }, START);
  await pool.publish((await buildPrivateJobResponse({ response, providerSigner: new LocalSigner(fremd.sk), sessionPk: auftrag.kundePk, nowSecs: START })).wrap);
  uhr.ms += 3_000;
  assert.equal((await dienst.runde())?.ausgewertet, 0, "fremde Antwort zählt nicht");
  // Frist vorbei, aber das eigene Netz schweigt – kein Ausfall des Providers
  still.an = true;
  uhr.ms += PRUEFER_NETZ.fristSek * 1000;
  assert.equal((await dienst.runde())?.ausgewertet, 0);
  assert.equal(dienst.unterwegs, 1);
  still.an = false;
  assert.equal((await dienst.runde())?.ausgewertet, 1);
  const b = dienst.buch.bericht({ provider: providerKp.pk, modell: "m" }, Math.floor(uhr.ms / 1000));
  assert.deepEqual([b?.anfragen, b?.erfolge], [1, 0], "keine Antwort bis zur Frist = Ausfall");
});

test("Angebote: je Provider das neueste, nur frische, nur gratis, Rechenarbeit höchstens powMax, nie der eigene Knoten; ohne Antwort bleibt der Plan", async () => {
  const { pool, uhr } = aufbau();
  const ich = generateKeypair();
  const [a, b, c, d] = [generateKeypair(), generateKeypair(), generateKeypair(), generateKeypair()];
  for (const ev of [
    angebot(a, { zeit: START - 600 }), angebot(a, { frei: false, zeit: START - 60 }), // neuestes: nicht mehr gratis
    angebot(b, { zeit: START - PRUEFER_NETZ.angebotAlterSek - 10 }), // zu alt
    angebot(c, { pow: PRUEFER_NETZ.powMax + 1 }), // zu viel Rechenarbeit
    angebot(d, { models: ["m", "n"] }),
    angebot(ich),
  ]) await pool.publish(ev);
  const still = { an: false };
  const dienst = new PrueferDienst({ netz: stummesNetz(pool, [], still), schluessel: ich, jetztMs: () => uhr.ms, zufall: () => 0 });
  const r = await dienst.runde();
  assert.equal(dienst.plan.anzahl, 2, "nur d mit zwei Modellen");
  assert.equal(r?.gesendet, 2);
  still.an = true;
  uhr.ms += PRUEFER_NETZ.angeboteSek * 1000;
  await dienst.runde();
  assert.equal(dienst.plan.anzahl, 2, "kein Relay antwortet – der Plan bleibt");
});

test("Grenzen je Runde: höchstens jeRunde neue Fragen, höchstens offenMax unterwegs", async () => {
  const { pool, uhr } = aufbau();
  const viele = generateKeypair();
  await pool.publish(angebot(viele, { models: Array.from({ length: 60 }, (_, i) => `m${i}`) }));
  const dienst = new PrueferDienst({ netz: pool, schluessel: generateKeypair(), jetztMs: () => uhr.ms, zufall: () => 0 });
  assert.equal((await dienst.runde())?.gesendet, PRUEFER_NETZ.jeRunde);
  for (let i = 0; i < 20; i++) { uhr.ms += PRUEFER_NETZ.rundeMs; await dienst.runde(); }
  assert.equal(dienst.unterwegs, PRUEFER_NETZ.offenMax);
  assert.ok(PRUEFER_NETZ.fristSek * 1000 > 20 * PRUEFER_NETZ.rundeMs, "noch keine Frist verpasst");
  assert.ok(PRUEFER_TAKT.zieleMax >= 60);
});

test("Einstellung und Verdrahtung: nur mit PRUEFER=1, Budget noch ungenutzt, Rolle im Status, nichts ins Log außer Zahlen", () => {
  assert.equal(prueferAusUmgebung({}).an, false);
  assert.equal(prueferAusUmgebung({ PRUEFER: "ja" }).an, false);
  assert.match(prueferAusUmgebung({ PRUEFER: "1" }).text, /nur Angebote, die gerade gratis sind/);
  assert.match(prueferAusUmgebung({ PRUEFER: "1", PRUEFER_BUDGET_MSAT: "50000" }).text, /noch nicht genutzt/);
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const block = main.slice(main.indexOf("const pruefer = prueferAusUmgebung(process.env);"), main.indexOf('statusRollen.add("pruefer");') + 30);
  assert.match(block, /if \(pruefer\.an\) \{\n    const dienst = new PrueferDienst\(\{ netz: pool, schluessel: keypair \}\);/);
  assert.match(block, /PRUEFER_NETZ\.rundeMs\);\n    statusRollen\.add\("pruefer"\);/);
  assert.doesNotMatch(readFileSync(new URL("../src/pruefer-dienst.ts", import.meta.url), "utf8"), /console\./, "der Dienst loggt nichts selbst");
});
