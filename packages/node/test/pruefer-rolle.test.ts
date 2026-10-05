/**
 * Freedom-Prüfung P3a (E7, docs/FREEDOM-PRUEFUNG.md 3.2): Kern der Prüfer-Rolle
 * – Zeitplan (Grundtest, danach etwa alle fünf Minuten), Prüffrage als
 * versiegelte Anfrage von einem Wegwerf-Schlüssel, Auswertung, Buch, Bericht.
 * Ohne Budget nur Angebote, die gerade gratis sind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_FEEDBACK, LocalSigner, buildJobFeedback, buildJobResult, baueMessbericht, buildPrivateJobResponse, generateKeypair,
  getTag, leseMessbericht, neuePruefFrage, openPrivateJobRequest, openPrivateJobResponse, signEvent, type PruefFrage,
} from "@freedomstack/protocol";
import { PRUEFER_TAKT, PrueferBuch, PrueferPlan, bauePruefAuftrag, werteAntwortAus } from "../src/pruefer-rolle.js";

const JETZT = 1_790_000_000;
const gratis = generateKeypair();
const bezahlt = generateKeypair();
const angebote = [
  { pubkey: gratis.pk, models: ["llama3.1:8b", "qwen2.5:7b", "mit leerzeichen"], currentlyFree: true },
  { pubkey: bezahlt.pk, models: ["llama3.1:8b"], currentlyFree: false },
];
const halb = () => 0.5;

test("Plan: nur Angebote, die gerade gratis sind – ohne Budget nichts Bezahltes, nie der eigene Knoten", () => {
  const plan = new PrueferPlan();
  plan.aktualisiere(angebote, JETZT);
  assert.equal(plan.anzahl, 2, "zwei Modelle des Gratis-Providers, das kaputte fällt weg");
  assert.deepEqual(plan.faellige(JETZT, 10).map((z) => z.modell).sort(), ["llama3.1:8b", "qwen2.5:7b"]);
  assert.equal(plan.faellige(JETZT, 1).length, 1, "höchstens so viele je Runde");
  const eigen = new PrueferPlan();
  eigen.aktualisiere(angebote, JETZT, gratis.pk);
  assert.equal(eigen.anzahl, 0, "sich selbst prüft der Knoten nicht");
  // Wird der Provider bezahlt (Probezeit vorbei, kein Gratis mehr), fällt er weg
  plan.aktualisiere([{ ...angebote[0], currentlyFree: false }], JETZT + 10);
  assert.equal(plan.anzahl, 0);
});

test("Plan: Grundtest – 20 Prüffragen gleichmäßig in der ersten Stunde, danach etwa alle fünf Minuten mit Zufall", () => {
  const plan = new PrueferPlan();
  plan.aktualisiere([{ pubkey: gratis.pk, models: ["m"], currentlyFree: true }], JETZT);
  let t = JETZT;
  let gestellt = 0;
  while (t < JETZT + PRUEFER_TAKT.grundtestSek) {
    for (const z of plan.faellige(t, 10)) { plan.gefragt(z, t, halb); gestellt++; }
    t += 30;
  }
  assert.equal(gestellt, PRUEFER_TAKT.grundtest, "Grundtest in der ersten Stunde");
  // Danach: nächste Frage nach 300 s ± 60 s
  const z = { provider: gratis.pk, modell: "m" };
  plan.gefragt(z, t, () => 0);
  assert.deepEqual(plan.faellige(t + PRUEFER_TAKT.laufendSek - PRUEFER_TAKT.zufallSek - 1, 10), []);
  assert.equal(plan.faellige(t + PRUEFER_TAKT.laufendSek - PRUEFER_TAKT.zufallSek, 10).length, 1);
  plan.gefragt(z, t, () => 1);
  assert.equal(plan.faellige(t + PRUEFER_TAKT.laufendSek + PRUEFER_TAKT.zufallSek - 1, 10).length, 0);
});

test("Auftrag: versiegelt, je Frage ein neuer Wegwerf-Schlüssel, Gebot 0, das Modell – der Provider öffnet ihn wie jede Anfrage", async () => {
  const frage = neuePruefFrage("rechnen", halb);
  const ziel = { provider: gratis.pk, modell: "llama3.1:8b" };
  const a = await bauePruefAuftrag({ ziel, frage, jetzt: JETZT });
  const b = await bauePruefAuftrag({ ziel, frage, jetzt: JETZT });
  assert.equal(a.wrap.kind, 1059);
  assert.equal(getTag(a.wrap, "p"), gratis.pk);
  assert.notEqual(a.sitzung.publicKey(), b.sitzung.publicKey(), "kein fester Prüfer-Schlüssel");
  const offen = await openPrivateJobRequest(a.wrap, new LocalSigner(gratis.sk));
  assert.equal(offen.ok, true);
  if (!offen.ok) return;
  assert.equal(offen.kundePk, a.sitzung.publicKey());
  assert.equal(offen.request.content, "");
  assert.deepEqual(offen.request.tags.find((t) => t[0] === "i"), ["i", frage.frage, "text"]);
  assert.deepEqual(offen.request.tags.find((t) => t[0] === "bid"), ["bid", "0"]);
  assert.deepEqual(offen.request.tags.find((t) => t[0] === "param"), ["param", "model", "llama3.1:8b"]);
  assert.equal(offen.request.id, a.requestId);
});

/** Antwort wie ein Provider: versiegelt an den Sitzungsschlüssel, dann als Kunde geöffnet. */
async function antwort(frage: PruefFrage, inhalt: { output?: string; fehler?: boolean; status?: "processing" }, usage?: { completionTokens: number }) {
  const { wrap, requestId, sitzung } = await bauePruefAuftrag({ ziel: { provider: gratis.pk, modell: "m" }, frage, jetzt: JETZT });
  const response = inhalt.output !== undefined
    ? buildJobResult({ providerPubkey: gratis.pk, requestId, requestKind: 5050, customerPubkey: sitzung.publicKey(), output: inhalt.output, amountMsat: 0, ...(usage ? { usage } : {}) }, JETZT)
    : buildJobFeedback(gratis.pk, requestId, sitzung.publicKey(), inhalt.status ?? "error", "", JETZT);
  void wrap;
  const zurueck = await buildPrivateJobResponse({ response, providerSigner: new LocalSigner(gratis.sk), sessionPk: sitzung.publicKey(), nowSecs: JETZT });
  const g = await openPrivateJobResponse(zurueck.wrap, sitzung);
  assert.equal(g.ok, true);
  return g.ok ? g.response : undefined;
}

test("Auswertung: richtige und falsche Antwort, Fehler, keine Antwort bis zur Frist; ein Zwischenstand zählt noch nicht", async () => {
  const frage = neuePruefFrage("rechnen", halb);
  const ms = JETZT * 1000;
  assert.deepEqual(werteAntwortAus(frage, await antwort(frage, { output: `= ${frage.erwartet}` }, { completionTokens: 30 }), ms, ms + 1500),
    { zeit: JETZT + 1, art: "rechnen", ok: true, richtig: true, ms: 1500, tokensJeSek: 20 });
  assert.equal(werteAntwortAus(frage, await antwort(frage, { output: "42" }), ms, ms + 900)?.richtig, false, "geantwortet, aber falsch");
  assert.deepEqual(werteAntwortAus(frage, await antwort(frage, { fehler: true }), ms, ms + 900), { zeit: JETZT, art: "rechnen", ok: false });
  assert.equal(werteAntwortAus(frage, await antwort(frage, { status: "processing" }), ms, ms + 900), null);
  assert.deepEqual(werteAntwortAus(frage, undefined, ms, ms + 60_000), { zeit: JETZT + 60, art: "rechnen", ok: false });
  assert.equal(KIND_DVM_FEEDBACK, 7000);
});

test("Buch und Bericht: Zahlen im Fenster, Treffer je Art, Stufe aus den Zahlen – signiert und gelesen wie jeder 38081", () => {
  const buch = new PrueferBuch();
  const ziel = { provider: gratis.pk, modell: "llama3.1:8b" };
  assert.equal(buch.bericht(ziel, JETZT), null, "ohne Prüffrage kein Bericht");
  buch.merke(ziel, { zeit: JETZT - PRUEFER_TAKT.fensterSek - 10, art: "rechnen", ok: false }); // außerhalb des Fensters
  for (let i = 0; i < 60; i++) {
    buch.merke(ziel, i < 57
      ? { zeit: JETZT - 3_000 + i * 10, art: i % 2 ? "rechnen" : "json", ok: true, richtig: i % 10 !== 0, ms: 1000 + i, tokensJeSek: 40 }
      : { zeit: JETZT - 3_000 + i * 10, art: "rechnen", ok: false });
  }
  const b = buch.bericht(ziel, JETZT)!;
  assert.equal(b.anfragen, 60);
  assert.equal(b.erfolge, 57);
  assert.equal(b.stufe, "normal", "57 von 60 = 95 %, ab 50 Prüffragen");
  assert.equal(b.medianMs, 1028);
  assert.equal(b.tokensJeSek, 40);
  assert.deepEqual(b.treffer, { rechnen: { richtig: 28, geprueft: 28 }, json: { richtig: 23, geprueft: 29 } });
  assert.deepEqual(buch.ziele(JETZT), [ziel]);
  const pruefer = generateKeypair();
  const ev = signEvent(baueMessbericht(b, pruefer.pk, JETZT), pruefer.sk);
  assert.deepEqual(leseMessbericht(ev, JETZT), { ...b, pruefer: pruefer.pk, zeit: JETZT });
  // Wenige Prüffragen: neu – ein Bericht entsteht trotzdem, die App wertet ihn erst ab 50
  const wenig = new PrueferBuch();
  wenig.merke(ziel, { zeit: JETZT, art: "zaehlen", ok: true, richtig: true, ms: 800 });
  assert.equal(wenig.bericht(ziel, JETZT)?.stufe, "neu");
});
