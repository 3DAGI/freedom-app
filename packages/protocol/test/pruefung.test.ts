/**
 * Freedom-Prüfung P1a (E7, docs/FREEDOM-PRUEFUNG.md): Stufen wie bei OpenRouter,
 * Prüffragen mit maschineller Antwortprüfung, eigene Messung und Auswahl
 * (Neue in der Mitte, Ausreißer nach hinten, 1/Preis²).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRUEF_ARTEN, fasseMessungZusammen, merkeMesspunkt, neuePruefFrage, ordneNachPruefung, pruefeAntwort, stufeAus, type PruefKandidat,
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

test("Prüffragen: jedes Mal andere Werte, die richtige Antwort besteht, falsche nicht", () => {
  for (const art of PRUEF_ARTEN) {
    const a = neuePruefFrage(art, folge(0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05, 0.95));
    const b = neuePruefFrage(art, folge(0.65, 0.25, 0.85, 0.15, 0.45, 0.95, 0.35, 0.75, 0.55, 0.12, 0.88));
    assert.notEqual(a.frage, b.frage, art);
    assert.ok(pruefeAntwort(a, a.erwartet), `${art}: erwartete Antwort`);
    assert.ok(!pruefeAntwort(a, b.erwartet), `${art}: fremde Antwort`);
    assert.ok(!pruefeAntwort(a, ""), `${art}: leer`);
  }
});

test("Antworten mit Hülle zählen, falsche Inhalte nicht", () => {
  const r = neuePruefFrage("rechnen", folge(0.5, 0.5));
  assert.ok(pruefeAntwort(r, `The result is ${r.erwartet}.`));
  assert.ok(pruefeAntwort(r, `450 + 450 = ${r.erwartet}`), "die letzte Zahl zählt");
  assert.ok(pruefeAntwort({ ...r, erwartet: "1176" }, "1,176"), "Tausender-Trennzeichen");
  assert.ok(!pruefeAntwort(r, `${Number(r.erwartet) + 1}`));
  const j = neuePruefFrage("json", folge(0.3, 0.6, 0.9));
  assert.ok(pruefeAntwort(j, "```json\n" + j.erwartet + "\n```"), "im Codeblock");
  const obj = JSON.parse(j.erwartet) as Record<string, unknown>;
  assert.ok(!pruefeAntwort(j, JSON.stringify({ ...obj, mehr: 1 })), "kein zusätzlicher Schlüssel");
  assert.ok(!pruefeAntwort(j, JSON.stringify({ ...obj, text: "anders" })));
  assert.ok(!pruefeAntwort(j, "{kaputt"));
  const s = neuePruefFrage("sortieren", folge(0.9, 0.1, 0.5, 0.3, 0.7));
  assert.ok(pruefeAntwort(s, s.erwartet.split(",").join(", ")));
  assert.ok(!pruefeAntwort(s, s.erwartet.split(",").reverse().join(",")));
  const z = neuePruefFrage("zaehlen", folge(0.2, 0.7, 0.1, 0.9, 0.3));
  assert.match(z.frage, /letter "[a-z]"/);
  assert.ok(Number(z.erwartet) >= 1, "der Buchstabe steht mindestens einmal darin");
  assert.ok(pruefeAntwort(z, `There are ${z.erwartet} occurrences.`));
  assert.ok(!pruefeAntwort(z, `${Number(z.erwartet) + 1}`));
  const u = neuePruefFrage("umkehren", folge(0.4, 0.2, 0.8));
  assert.ok(pruefeAntwort(u, `  ${u.erwartet.toUpperCase()} `));
  assert.ok(!pruefeAntwort(u, [...u.erwartet].reverse().join("")), "nicht das Original");
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
