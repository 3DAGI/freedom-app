/**
 * Tests fuer Wiederherstellung und Nachfolge.
 *
 * Hier geht es um den Zugriff auf eine fremde Identitaet. Der Schwerpunkt
 * liegt deshalb auf dem, was NICHT gehen darf: Uebernahme unter der Schwelle,
 * Uebernahme ohne Wartezeit, und Uebernahme trotz Lebenszeichen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import {
  splitSecret, combineShares, buildSuccessionPlan, parseSuccessionPlan,
  buildHeartbeat, buildRecoveryClaim, evaluateSuccession,
  verifyRecovered, secretHashOf, successionWarning,
} from "../src/succession.js";

const TAG = 86400;
const NOW = 1_800_000_000;
const BESITZER = generateKeypair();
const G = Array.from({ length: 5 }, () => generateKeypair());
const GEHEIMNIS = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);

const plan = (over: Partial<{ threshold: number; inactivityDays: number; graceDays: number }> = {}) =>
  parseSuccessionPlan(signEvent(buildSuccessionPlan({
    ownerPubkey: BESITZER.pk,
    guardians: G.map((g) => g.pk),
    threshold: over.threshold ?? 3,
    inactivityDays: over.inactivityDays ?? 180,
    graceDays: over.graceDays ?? 30,
    secretHash: secretHashOf(GEHEIMNIS),
  }, NOW - 400 * TAG), BESITZER.sk));

const claim = (g: typeof BESITZER, at: number) =>
  signEvent(buildRecoveryClaim(g.pk, BESITZER.pk, "keine Reaktion seit Monaten", at), g.sk);
const puls = (at: number) => signEvent(buildHeartbeat(BESITZER.pk, at), BESITZER.sk);

// ------------------------------------------------------------- Shamir

test("Geheimnis laesst sich aus der Schwelle zurueckgewinnen", () => {
  const teile = splitSecret(GEHEIMNIS, 5, 3);
  assert.deepEqual(combineShares(teile.slice(0, 3)), GEHEIMNIS);
  assert.deepEqual(combineShares([teile[4], teile[0], teile[2]]), GEHEIMNIS, "Reihenfolge egal");
});

test("Unter der Schwelle kommt NICHTS heraus", () => {
  // Nicht "schwer zu berechnen" — mathematisch nichts. Das ist der Kern.
  const teile = splitSecret(GEHEIMNIS, 5, 3);
  assert.notDeepEqual(combineShares(teile.slice(0, 2)), GEHEIMNIS);
});

test("Mehr Teile als noetig schaden nicht", () => {
  const teile = splitSecret(GEHEIMNIS, 5, 3);
  assert.deepEqual(combineShares(teile), GEHEIMNIS);
});

test("Schwelle 1 wird abgelehnt", () => {
  // Bei 1 koennte ein einzelner Vertrauter allein uebernehmen.
  assert.throws(() => splitSecret(GEHEIMNIS, 5, 1), /mindestens 2/);
});

test("Mehr Schwelle als Teile ist unsinnig und wird abgelehnt", () => {
  assert.throws(() => splitSecret(GEHEIMNIS, 2, 3), /reichen fuer|reichen für/);
});

test("Doppelte Teile werden erkannt", () => {
  const teile = splitSecret(GEHEIMNIS, 5, 3);
  assert.throws(() => combineShares([teile[0], teile[0], teile[1]]), /Doppelte Teile/);
});

test("Geheimnisse beliebiger Laenge funktionieren", () => {
  for (const len of [1, 16, 32, 64, 128]) {
    const s = crypto.getRandomValues(new Uint8Array(len));
    assert.deepEqual(combineShares(splitSecret(s, 4, 2).slice(0, 2)), s, `Laenge ${len}`);
  }
});

test("Pruefsumme bestaetigt, dass die Teile zusammenpassen", () => {
  const p = plan();
  const teile = splitSecret(GEHEIMNIS, 5, 3);
  assert.equal(verifyRecovered(combineShares(teile.slice(0, 3)), p), true);
  assert.equal(verifyRecovered(new Uint8Array(32), p), false);
});

// ------------------------------------------------------------- Plan

test("Plan mit Schwelle unter 2 wird abgelehnt", () => {
  const ev = signEvent(buildSuccessionPlan({
    ownerPubkey: BESITZER.pk, guardians: [G[0].pk], threshold: 1,
    inactivityDays: 180, graceDays: 30, secretHash: "x",
  }), BESITZER.sk);
  assert.throws(() => parseSuccessionPlan(ev), /unter 2/);
});

test("Schwelle hoeher als die Zahl der Vertrauten wird abgelehnt", () => {
  const ev = signEvent(buildSuccessionPlan({
    ownerPubkey: BESITZER.pk, guardians: [G[0].pk, G[1].pk], threshold: 5,
    inactivityDays: 180, graceDays: 30, secretHash: "x",
  }), BESITZER.sk);
  assert.throws(() => parseSuccessionPlan(ev), /höher als/);
});

// ------------------------------------------------------------- Ablauf

test("Lebenszeichen: alles normal", () => {
  const st = evaluateSuccession(plan(), [puls(NOW - 5 * TAG)], NOW);
  assert.equal(st.status, "aktiv");
  assert.equal(st.daysSinceHeartbeat, 5);
});

test("Meldungen VOR Ablauf der Frist loesen nichts aus", () => {
  const st = evaluateSuccession(plan(), [
    puls(NOW - 10 * TAG),
    claim(G[0], NOW - 5 * TAG), claim(G[1], NOW - 5 * TAG), claim(G[2], NOW - 5 * TAG),
  ], NOW);
  assert.equal(st.status, "still");
  assert.match(st.message, /Auslöser greift nach/);
});

test("Unter der Schwelle passiert nichts", () => {
  const st = evaluateSuccession(plan({ threshold: 3 }), [
    puls(NOW - 300 * TAG), claim(G[0], NOW - 10 * TAG), claim(G[1], NOW - 10 * TAG),
  ], NOW);
  assert.equal(st.status, "ausgeloest");
  assert.match(st.message, /2 von 3/);
});

test("Fremde Meldungen zaehlen nicht", () => {
  const fremd = generateKeypair();
  const st = evaluateSuccession(plan({ threshold: 2 }), [
    puls(NOW - 300 * TAG),
    signEvent(buildRecoveryClaim(fremd.pk, BESITZER.pk, "ich will rein", NOW - 10 * TAG), fremd.sk),
    claim(G[0], NOW - 10 * TAG),
  ], NOW);
  assert.equal(st.claims.length, 1);
  assert.equal(st.status, "ausgeloest");
});

test("Derselbe Vertraute kann die Schwelle nicht allein erreichen", () => {
  const st = evaluateSuccession(plan({ threshold: 3 }), [
    puls(NOW - 300 * TAG),
    claim(G[0], NOW - 10 * TAG), claim(G[0], NOW - 9 * TAG), claim(G[0], NOW - 8 * TAG),
  ], NOW);
  assert.equal(st.claims.length, 1);
});

test("Wartefrist schuetzt: erreicht, aber noch nicht freigegeben", () => {
  const st = evaluateSuccession(plan({ threshold: 3, graceDays: 30 }), [
    puls(NOW - 300 * TAG),
    claim(G[0], NOW - 10 * TAG), claim(G[1], NOW - 10 * TAG), claim(G[2], NOW - 10 * TAG),
  ], NOW);
  assert.equal(st.status, "wartefrist");
  assert.equal(st.daysUntilRelease, 20);
  // Der eigentliche Schutz: Widerspruch ist moeglich.
  assert.match(st.message, /Lebenszeichen des Besitzers bricht den Vorgang ab/);
});

test("EIN Lebenszeichen setzt alles zurueck", () => {
  // Das ist der wichtigste Test: Eine Absprache unter Vertrauten darf nicht
  // wirksam werden, solange der Besitzer sich melden kann.
  const st = evaluateSuccession(plan({ threshold: 3 }), [
    claim(G[0], NOW - 40 * TAG), claim(G[1], NOW - 40 * TAG), claim(G[2], NOW - 40 * TAG),
    puls(NOW - 2 * TAG),
  ], NOW);
  assert.equal(st.status, "aktiv");
  assert.equal(st.claims.length, 0, "alte Meldungen leben nicht wieder auf");
});

test("Nach Frist, Schwelle und Wartezeit wird freigegeben", () => {
  const st = evaluateSuccession(plan({ threshold: 3, graceDays: 30 }), [
    puls(NOW - 300 * TAG),
    claim(G[0], NOW - 60 * TAG), claim(G[1], NOW - 60 * TAG), claim(G[2], NOW - 60 * TAG),
  ], NOW);
  assert.equal(st.status, "freigegeben");
});

test("Warnung nennt die Grenze, nicht nur den Nutzen", () => {
  const w = successionWarning({ guardians: 5, threshold: 3, graceDays: 30 });
  assert.match(w, /NICHT schützt/);
  assert.match(w, /koennen sie übernehmen|können sie übernehmen/);
  // Der praktischste Rat ueberhaupt.
  assert.match(w, /Eine Familie zählt als einer/);
  // Seit 8.11: auch, dass die Vertrauten oeffentlich im Plan stehen
  assert.match(w, /Der Plan ist öffentlich: Wer deine Vertrauten sind, sieht jeder/);
});
