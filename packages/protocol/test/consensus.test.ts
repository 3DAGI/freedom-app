/**
 * Tests fuer den Redundanz-Konsens.
 *
 * Der Zweck des Moduls ist Betrugserkennung, deshalb pruefen die Tests vor
 * allem die unangenehmen Faelle: der Ausreisser, das Patt, und der Fall, in
 * dem sich alle einig UND alle falsch sein koennten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateConsensus,
  similarity,
  normalizeAnswer,
  consensusCostPreview,
  recommendedRedundancy,
  ConsensusAnswer,
} from "../src/consensus.js";

const a = (pk: string, output: string, amountMsat = 1000, weight = 1): ConsensusAnswer => ({
  providerPubkey: pk,
  output,
  amountMsat,
  weight,
});

test("Konsens: identische Antworten -> unanimous", () => {
  const r = evaluateConsensus([
    a("p1", "Die Hauptstadt von Frankreich ist Paris."),
    a("p2", "Die Hauptstadt von Frankreich ist Paris."),
    a("p3", "Die Hauptstadt von Frankreich ist Paris."),
  ]);
  assert.equal(r.verdict, "unanimous");
  assert.equal(r.outliers.length, 0);
  assert.equal(r.confidence, 1);
  assert.equal(r.totalCostMsat, 3000);
});

test("Konsens: inhaltsgleich trotz anderer Formulierung -> unanimous", () => {
  const r = evaluateConsensus([
    a("p1", "Die Hauptstadt von Frankreich ist Paris"),
    a("p2", "die hauptstadt von frankreich ist paris!"),
    a("p3", "Die Hauptstadt von Frankreich ist Paris."),
  ]);
  assert.equal(r.verdict, "unanimous", "Satzzeichen/Grossschreibung sind kein Inhalt");
});

test("Konsens: ein Ausreisser wird benannt", () => {
  const r = evaluateConsensus([
    a("ehrlich1", "Der Siedepunkt von Wasser liegt bei 100 Grad Celsius auf Meereshoehe."),
    a("ehrlich2", "Der Siedepunkt von Wasser liegt bei 100 Grad Celsius auf Meereshoehe."),
    a("luegner", "Wasser siedet bei 65 Grad. Kaufen Sie jetzt unser Produkt unter example.com"),
  ]);
  assert.equal(r.verdict, "majority");
  assert.deepEqual(r.outliers, ["luegner"]);
  assert.equal(r.agreeing.length, 2);
  assert.ok(r.confidence > 0.5 && r.confidence < 1);
});

test("Konsens: drei verschiedene Antworten -> split, keine Mehrheit", () => {
  const r = evaluateConsensus([
    a("p1", "Antwort ueber Katzen und ihre Schlafgewohnheiten im Sommer"),
    a("p2", "Voellig anderer Text ueber Bruecken Statik und Stahlbau"),
    a("p3", "Wieder etwas ganz anderes naemlich Kochrezepte mit Auberginen"),
  ]);
  assert.equal(r.verdict, "split");
  assert.ok(r.confidence <= 0.5);
  assert.match(r.explanation, /gehen auseinander/);
});

test("Konsens: eine einzelne Antwort ist keine Bestaetigung", () => {
  const r = evaluateConsensus([a("p1", "irgendeine Antwort")]);
  assert.equal(r.verdict, "insufficient");
  assert.equal(r.confidence, 0);
  assert.equal(r.answer, "irgendeine Antwort", "Antwort wird trotzdem durchgereicht");
});

test("Konsens: keine Antwort -> insufficient, kein Absturz", () => {
  const r = evaluateConsensus([]);
  assert.equal(r.verdict, "insufficient");
  assert.equal(r.answer, null);
});

test("Konsens: Patt bei zwei Providern wird nicht als Mehrheit verkauft", () => {
  const r = evaluateConsensus([
    a("p1", "Der Wert betraegt eindeutig zweiundvierzig Komma null"),
    a("p2", "Ein voellig anderer Sachverhalt ohne jeden Bezug dazu"),
  ]);
  assert.equal(r.verdict, "split", "1:1 ist kein Mehrheitsentscheid");
});

test("Konsens: Reputationsgewichte kippen ein knappes Ergebnis", () => {
  const answers = [
    a("stark", "Antwort A ueber den gesuchten Sachverhalt im Detail", 1000, 10),
    a("schwach1", "Antwort B ganz anders und voellig unpassend hier", 1000, 1),
    a("schwach2", "Antwort B ganz anders und voellig unpassend hier", 1000, 1),
  ];
  const ungewichtet = evaluateConsensus(answers);
  const gewichtet = evaluateConsensus(answers, { useWeights: true });

  assert.deepEqual(ungewichtet.agreeing.sort(), ["schwach1", "schwach2"]);
  assert.deepEqual(gewichtet.agreeing, ["stark"], "Reputation schlaegt reine Anzahl");
});

test("Konsens: laengere Variante des Mehrheits-Clusters wird gezeigt", () => {
  const r = evaluateConsensus([
    a("p1", "Paris ist die Hauptstadt von Frankreich"),
    a("p2", "Paris ist die Hauptstadt von Frankreich und hat rund zwei Millionen Einwohner"),
  ]);
  assert.ok(r.answer!.includes("Einwohner"), "ausfuehrlichere Antwort ist nuetzlicher");
});

test("Ähnlichkeit: Ausfuehrlichere Antwort gilt nicht als Widerspruch", () => {
  const kurz = "Paris ist die Hauptstadt von Frankreich";
  const lang =
    "Paris ist die Hauptstadt von Frankreich und liegt an der Seine mit rund " +
    "zwei Millionen Einwohnern im Stadtgebiet";
  // Reiner Jaccard laege hier unter 0,6 und wuerde den ehrlichen Provider
  // als Ausreisser markieren — genau der Fehler, den Containment abfaengt.
  assert.ok(similarity(kurz, lang) >= 0.6, `similarity war ${similarity(kurz, lang)}`);
});

test("Ähnlichkeit: Grenzwerte verhalten sich sinnvoll", () => {
  assert.equal(similarity("gleicher text", "gleicher text"), 1);
  assert.equal(similarity("", "irgendwas"), 0);
  assert.ok(similarity("der hund laeuft schnell durch den park", "die katze schlaeft") < 0.2);
});

test("Normalisierung: Whitespace und Satzzeichen fallen raus", () => {
  assert.equal(normalizeAnswer("  Hallo,   Welt!  "), "hallo welt");
  assert.equal(normalizeAnswer("HALLO WELT"), normalizeAnswer("hallo welt"));
});

test("Kostenvorschau: N Provider kosten N-fach, ehrlich benannt", () => {
  const einzeln = consensusCostPreview(1000, 1);
  assert.equal(einzeln.totalMsat, 1000);
  assert.match(einzeln.note, /kein Aufpreis/);

  const drei = consensusCostPreview(1000, 3);
  assert.equal(drei.totalMsat, 3000);
  assert.equal(drei.multiplier, 3);
});

test("Empfehlung: ungerade Anzahl, damit ein Patt unmoeglich ist", () => {
  assert.equal(recommendedRedundancy("normal"), 1);
  assert.equal(recommendedRedundancy("important") % 2, 1);
  assert.equal(recommendedRedundancy("critical") % 2, 1);
  assert.ok(recommendedRedundancy("critical") > recommendedRedundancy("important"));
});
