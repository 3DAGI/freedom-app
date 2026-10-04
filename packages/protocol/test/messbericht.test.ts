/**
 * Freedom-Prüfung P1b (E7, docs/FREEDOM-PRUEFUNG.md): Messbericht eines Prüfers
 * (Kind 38081) – bauen, signieren, lesen; alles Kaputte abgelehnt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BERICHT_GUELTIG_SEK, KIND_MESSBERICHT, baueMessbericht, generateKeypair, leseMessbericht, signEvent, trefferQuote } from "../src/index.js";

const JETZT = 1_790_000_000;

test("Messbericht 38081: bauen, signieren, lesen; Fälschung, Ablauf, kaputte Zahlen und falsches d abgelehnt", () => {
  const pruefer = generateKeypair();
  const provider = generateKeypair().pk;
  const m = {
    provider, modell: "llama3.1:8b", von: JETZT - 3600, bis: JETZT, anfragen: 120, erfolge: 118, medianMs: 2400, tokensJeSek: 42,
    treffer: { rechnen: { richtig: 20, geprueft: 20 }, json: { richtig: 17, geprueft: 20 }, zaehlen: { richtig: 20, geprueft: 20 } },
    stufe: "normal" as const,
  };
  const ev = signEvent(baueMessbericht(m, pruefer.pk, JETZT), pruefer.sk);
  assert.equal(ev.kind, KIND_MESSBERICHT);
  assert.deepEqual(leseMessbericht(ev, JETZT), { ...m, pruefer: pruefer.pk, zeit: JETZT });
  assert.equal(trefferQuote(m), 57 / 60);
  assert.equal(trefferQuote({ treffer: {} }), undefined);
  assert.deepEqual(ev.tags.filter((t) => t[0] === "treffer").map((t) => t[1]), ["rechnen", "zaehlen", "json"], "feste Reihenfolge");
  const ohneDurchsatz = signEvent(baueMessbericht({ ...m, tokensJeSek: undefined }, pruefer.pk, JETZT), pruefer.sk);
  assert.equal(leseMessbericht(ohneDurchsatz, JETZT)?.tokensJeSek, undefined, "Durchsatz ist freiwillig");
  assert.equal(leseMessbericht(ev, JETZT + BERICHT_GUELTIG_SEK), null, "abgelaufen");
  assert.equal(leseMessbericht({ ...ev, tags: ev.tags.map((t) => (t[0] === "anfragen" ? ["anfragen", "120", "119"] : t)) }, JETZT), null, "nach dem Signieren verändert");
  const neu = (aenderung: (tags: string[][]) => string[][]) =>
    leseMessbericht(signEvent({ ...baueMessbericht(m, pruefer.pk, JETZT), tags: aenderung(baueMessbericht(m, pruefer.pk, JETZT).tags) }, pruefer.sk), JETZT);
  assert.equal(neu((t) => t.map((x) => (x[0] === "anfragen" ? ["anfragen", "10", "11"] : x))), null, "mehr Erfolge als Anfragen");
  assert.equal(neu((t) => t.map((x) => (x[0] === "d" ? ["d", `${provider}:anderes`] : x))), null, "d passt nicht");
  assert.equal(neu((t) => t.map((x) => (x[0] === "stufe" ? ["stufe", "super"] : x))), null, "unbekannte Stufe");
  assert.equal(neu((t) => t.map((x) => (x[0] === "median_ms" ? ["median_ms", "1e3"] : x))), null, "keine ganze Zahl");
  assert.equal(neu((t) => t.map((x) => (x[0] === "tokens_s" ? ["tokens_s", "-1"] : x))), null, "Durchsatz negativ");
  assert.equal(neu((t) => t.map((x) => (x[1] === "json" ? ["treffer", "json", "21", "20"] : x))), null, "mehr richtig als geprüft");
  assert.equal(neu((t) => [...t, ["treffer", "rechnen", "1", "1"]]), null, "eine Art doppelt");
  assert.deepEqual(neu((t) => [...t, ["treffer", "wissen", "5", "5"]])?.treffer, m.treffer, "unbekannte Art eines neueren Prüfers zählt nicht");
  assert.throws(() => baueMessbericht({ ...m, erfolge: 121 }, pruefer.pk, JETZT));
  assert.throws(() => baueMessbericht({ ...m, treffer: { rechnen: { richtig: 3, geprueft: 2 } } }, pruefer.pk, JETZT));
  assert.throws(() => baueMessbericht({ ...m, treffer: { wissen: { richtig: 1, geprueft: 1 } } as never }, pruefer.pk, JETZT));
  assert.throws(() => baueMessbericht({ ...m, modell: "mit leerzeichen" }, pruefer.pk, JETZT));
});
