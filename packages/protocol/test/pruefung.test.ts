/**
 * Freedom-Prüfung P1a (E7, docs/FREEDOM-PRUEFUNG.md): Stufen wie bei OpenRouter,
 * eigene Messung und Auswahl (Neue in der Mitte, Ausreißer nach hinten, 1/Preis²).
 * Prüffragen und die Stufe aus Prüferberichten fielen mit P5a weg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fasseMessungZusammen, merkeMesspunkt, ordneNachPruefung, stufeAus, type PruefKandidat,
} from "../src/index.js";

const JETZT = 1_790_000_000;
/** Feste Zufallsfolge – Tests rechnen nie zweimal mit der Uhr oder echtem Zufall. */
function folge(...werte: number[]) {
  let i = 0;
  return () => werte[i++ % werte.length];
}

test("Stufen wie OpenRouter: erst ab genug Anfragen; 95 % normal, 80–94 % herabgestuft, darunter ausgefallen", () => {
  assert.equal(stufeAus(19, 19, 20), "neu", "zu wenige – neu, nicht schlecht");
  assert.equal(stufeAus(0, 0, 0), "neu");
  assert.equal(stufeAus(100, 95, 20), "normal");
  assert.equal(stufeAus(100, 94, 20), "herabgestuft");
  assert.equal(stufeAus(100, 80, 20), "herabgestuft");
  assert.equal(stufeAus(100, 79, 20), "ausgefallen");
});

test("Eigene Messung: letzte 100 Punkte, Median der Zeiten, Ausfall in den letzten 60 Sekunden, Stufe erst ab 20", () => {
  let p: ReturnType<typeof merkeMesspunkt> = [];
  for (let i = 0; i < 130; i++) p = merkeMesspunkt(p, { zeit: JETZT - 1000 + i, ok: i % 25 !== 0, ms: 1000 + i });
  assert.equal(p.length, 100);
  const s = fasseMessungZusammen(p, JETZT);
  assert.equal(s.anfragen, 100);
  assert.equal(s.erfolge, 96);
  assert.equal(s.stufe, "normal");
  assert.equal(s.ausfallJetzt, false);
  assert.ok(s.medianMs! > 1030 && s.medianMs! < 1130);
  const ausfall = fasseMessungZusammen(merkeMesspunkt(p, { zeit: JETZT - 10, ok: false }), JETZT);
  assert.equal(ausfall.ausfallJetzt, true);
  assert.equal(fasseMessungZusammen(p.slice(0, 19), JETZT).stufe, "neu");
  assert.deepEqual(fasseMessungZusammen([], JETZT), { anfragen: 0, erfolge: 0, ausfallJetzt: false, stufe: "neu" });
});

test("Auswahl: normale vorn, Neue in der Mitte (bekannte zuerst), Ausreißer, Herabgestufte und Ausgefallene hinten", () => {
  const k = (pk: string, p: Partial<PruefKandidat>): PruefKandidat => ({ pk, preisMsat: 1000, stufe: "normal", ...p });
  const liste = [
    k("tot", { stufe: "ausgefallen" }),
    k("wackelt", { stufe: "herabgestuft" }),
    k("gerade-aus", { ausfallJetzt: true }),
    k("neu", { stufe: "neu" }),
    k("neu-bekannt", { stufe: "neu", bekannt: true, preisMsat: 4000 }),
    k("ausreisser", { qualitaet: 0.5 }),
    k("gut", { qualitaet: 0.95 }),
    k("auch-gut", { qualitaet: 0.9 }),
  ];
  const r = ordneNachPruefung(liste, folge(0.99)).map((x) => x.pk);
  assert.deepEqual(r.slice(2), ["neu-bekannt", "neu", "ausreisser", "wackelt", "gerade-aus", "tot"], "mit Quittungen vor Unbekannten, auch wenn teurer");
  assert.deepEqual(new Set(r.slice(0, 2)), new Set(["gut", "auch-gut"]));
});

test("Lastverteilung: unter gleich Guten 1/Preis² – halb so teuer, viermal so oft vorn; Vertrauen wiegt mit", () => {
  const guenstig = { pk: "g", preisMsat: 1000, stufe: "normal" as const };
  const teuer = { pk: "t", preisMsat: 2000, stufe: "normal" as const };
  let vorn = 0;
  for (let i = 0; i < 1000; i++) {
    const z = (i + 0.5) / 1000;
    if (ordneNachPruefung([teuer, guenstig], folge(z))[0].pk === "g") vorn++;
  }
  assert.ok(Math.abs(vorn - 800) <= 2, `günstig ${vorn} von 1000 vorn (erwartet 800 = 4/5)`);
  let mitVertrauen = 0;
  for (let i = 0; i < 1000; i++) {
    const z = (i + 0.5) / 1000;
    if (ordneNachPruefung([{ ...teuer, vertrauen: 100 }, guenstig], folge(z))[0].pk === "t") mitVertrauen++;
  }
  assert.ok(Math.abs(mitVertrauen - 333) <= 2, `teuer mit vollem Vertrauen ${mitVertrauen} von 1000 vorn (2/6)`);
  assert.equal(ordneNachPruefung([], folge(0.5)).length, 0);
  assert.equal(ordneNachPruefung([{ pk: "gratis", preisMsat: 0, stufe: "normal" }], folge(0.5))[0].pk, "gratis", "gratis zählt wie 1 msat");
});
