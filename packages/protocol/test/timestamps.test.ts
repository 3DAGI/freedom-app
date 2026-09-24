/**
 * Tests fuer die Zeitstempel-Absicherung.
 *
 * Der Schwerpunkt liegt auf dem billigsten Angriff im System: dreissig
 * Leistungsnachweise auf dreissig Kalendertage setzen, sie aber in einer
 * Minute erzeugen, und die Monatspraemie kassieren.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  checkPlausibility, buildTimeWitness, parseTimeWitness, witnessRoot,
  checkAgainstWitnesses, countActiveDays, compareTrusted,
  MAX_FUTURE_SECS, KIND_TIME_WITNESS,
} from "../src/timestamps.js";

const NOW = 1_800_000_000;
const TAG = 86400;
const KP = generateKeypair();
const RELAY = generateKeypair();

const ev = (at: number, inhalt = "x"): NostrEvent =>
  signEvent(buildEvent(KP.pk, 1, [], inhalt, at), KP.sk);

// ------------------------------------------------------- Plausibilitaet

test("Normale Zeitstempel gehen durch", () => {
  const r = checkPlausibility(ev(NOW - 100), { nowSecs: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "plausibel");
});

test("Ungenaue Uhren werden toleriert", () => {
  // Ein Nutzer mit einer um Minuten abweichenden Systemzeit darf nicht
  // ausgesperrt werden — der Zweck ist, grobe Faelschungen zu fangen.
  assert.equal(checkPlausibility(ev(NOW + 60), { nowSecs: NOW }).ok, true);
  assert.equal(checkPlausibility(ev(NOW + MAX_FUTURE_SECS - 1), { nowSecs: NOW }).ok, true);
});

test("Weit in der Zukunft wird abgelehnt", () => {
  const r = checkPlausibility(ev(NOW + 30 * TAG), { nowSecs: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "zukunft");
});

test("Aelter als der eigene Schluessel geht nicht mit rechten Dingen zu", () => {
  const r = checkPlausibility(ev(NOW - 400 * TAG), {
    nowSecs: NOW, keyFirstSeen: NOW - 30 * TAG,
  });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "vordatiert");
  assert.match(r.message, /vor dem ersten bekannten Ereignis/);
});

test("Eine Toleranz um den Schluesselbeginn bleibt", () => {
  // Der erste bekannte Zeitpunkt ist eine Beobachtung, kein Geburtsdatum.
  const r = checkPlausibility(ev(NOW - 31 * TAG), {
    nowSecs: NOW, keyFirstSeen: NOW - 30 * TAG,
  });
  assert.equal(r.ok, true);
});

// ------------------------------------------------------------- Zeugen

test("Zeuge: Roundtrip", () => {
  const ids = ["a".repeat(64), "b".repeat(64)];
  const w = parseTimeWitness(signEvent(
    buildTimeWitness(RELAY.pk, ids, NOW - TAG, NOW, NOW), RELAY.sk));
  assert.equal(w.count, 2);
  assert.equal(w.root, witnessRoot(ids));
  assert.equal(w.relayPubkey, RELAY.pk);
});

test("Die Wurzel haengt nicht an der Reihenfolge", () => {
  assert.equal(witnessRoot(["a", "b", "c"]), witnessRoot(["c", "a", "b"]));
});

test("Eine andere Menge ergibt eine andere Wurzel", () => {
  assert.notEqual(witnessRoot(["a", "b"]), witnessRoot(["a", "b", "c"]));
});

test("Unvollstaendiger Zeuge wird abgelehnt", () => {
  const e = signEvent(buildEvent(RELAY.pk, KIND_TIME_WITNESS, [["count", "5"]], ""), RELAY.sk);
  assert.throws(() => parseTimeWitness(e), /unvollständig/);
});

test("DER ANGRIFF: rueckdatiertes Ereignis faellt am Zeugen auf", () => {
  // Der Kern des Ganzen. Wer ein Ereignis nachtraeglich mit altem Datum
  // erzeugt, kann keinen Zeugen vorweisen, der es damals gesehen hat.
  const echt = ev(NOW - 10 * TAG, "echt");
  const gefaelscht = ev(NOW - 10 * TAG, "nachtraeglich erzeugt");

  const w = parseTimeWitness(signEvent(
    buildTimeWitness(RELAY.pk, [echt.id], NOW - 11 * TAG, NOW - 9 * TAG, NOW - 9 * TAG), RELAY.sk));
  const zeugen = [{ witness: w, eventIds: [echt.id] }];

  assert.equal(checkAgainstWitnesses(echt, zeugen).ok, true);

  const r = checkAgainstWitnesses(gefaelscht, zeugen);
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "vordatiert");
  assert.match(r.message, /nachträglich erzeugt/);
});

test("Ohne Zeugen fuer den Zeitraum bleibt es eine Behauptung", () => {
  // Wichtig: Das ist kein Ablehnungsgrund. Die meisten Zeitraeume werden nie
  // bezeugt sein, und alles zu verwerfen waere unbrauchbar.
  const r = checkAgainstWitnesses(ev(NOW - 100 * TAG), []);
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "unbezeugt");
  assert.match(r.message, /bleibt eine Behauptung/);
});

test("Nur vertrauenswuerdige Zeugen zaehlen", () => {
  // Sonst stellt ein Angreifer seinen eigenen Zeugen aus.
  const e = ev(NOW - 10 * TAG);
  const fremd = generateKeypair();
  const w = parseTimeWitness(signEvent(
    buildTimeWitness(fremd.pk, [], NOW - 11 * TAG, NOW - 9 * TAG), fremd.sk));

  const r = checkAgainstWitnesses(e, [{ witness: w, eventIds: [] }], {
    trustedWitnesses: new Set([RELAY.pk]),
  });
  assert.equal(r.verdict, "unbezeugt", "ein fremder Zeuge darf nicht belasten");
});

// -------------------------------------------- Der Aufgaben-Angriff

const nachweis = (tagVersatz: number, eingang: number) => ({
  id: `id-${tagVersatz}`,
  created_at: NOW - tagVersatz * TAG,
  receivedAt: eingang,
});

test("Ehrliche Arbeit ueber 30 Tage wird anerkannt", () => {
  const echt = Array.from({ length: 30 }, (_, i) => nachweis(i, NOW - i * TAG + 60));
  const r = countActiveDays(echt, { nowSecs: NOW });
  assert.equal(r.days, 30);
  assert.equal(r.suspicious, false);
});

test("DER ANGRIFF: 30 Kalendertage in einer Minute erzeugt", () => {
  // Der billigste Angriff im ganzen System: bis zu 29.500 sats je
  // Wegwerf-Identitaet. Ohne die Eingangszeit waere er nicht erkennbar.
  const gefaelscht = Array.from({ length: 30 }, (_, i) => nachweis(i, NOW));
  const r = countActiveDays(gefaelscht, { nowSecs: NOW });
  assert.equal(r.days, 0);
  assert.equal(r.suspicious, true);
  assert.match(r.message, /Nicht anerkannt/);
});

test("Ein einzelner nachtraeglich datierter Tag wird verworfen", () => {
  const meist = Array.from({ length: 10 }, (_, i) => nachweis(i, NOW - i * TAG + 60));
  // Einer behauptet, vor 60 Tagen entstanden zu sein, kam aber heute an.
  const r = countActiveDays([...meist, nachweis(60, NOW)], { nowSecs: NOW });
  assert.equal(r.days, 10);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /spaeter eingegangen|später eingegangen/);
});

test("Ohne Eingangszeiten wird nicht faelschlich verworfen", () => {
  // Alte Daten aus der Zeit vor dieser Pruefung haben keine Eingangszeit —
  // sie deshalb zu verwerfen waere eine rueckwirkende Enteignung.
  const ohne = Array.from({ length: 10 }, (_, i) => ({
    id: `x${i}`, created_at: NOW - i * TAG,
  }));
  assert.equal(countActiveDays(ohne, { nowSecs: NOW }).days, 10);
});

test("Zukunftsdatierte Nachweise zaehlen nicht", () => {
  const r = countActiveDays([
    nachweis(0, NOW),
    { id: "zukunft", created_at: NOW + 30 * TAG, receivedAt: NOW },
  ], { nowSecs: NOW });
  assert.equal(r.days, 1);
});

test("Wenige Ereignisse loesen keinen Fehlalarm aus", () => {
  // Drei Nachweise an einem Nachmittag sind normal, nicht verdaechtig.
  const r = countActiveDays([nachweis(0, NOW), nachweis(0, NOW + 10)], { nowSecs: NOW });
  assert.equal(r.suspicious, false);
});

// ------------------------------------------------------------ Vergleich

test("Bezeugtes schlaegt Unbezeugtes, auch wenn es spaeter datiert", () => {
  // Sonst waere eine unbelegte Behauptung staerker als ein Beleg — und genau
  // darauf zielt der Rueckdatierungsangriff.
  const frueh = { event: ev(NOW - 100 * TAG), check: { ok: true, verdict: "unbezeugt" as const, message: "" } };
  const spaet = { event: ev(NOW - 10 * TAG), check: { ok: true, verdict: "bezeugt" as const, message: "" } };
  assert.ok(compareTrusted(spaet, frueh) < 0);
});

test("Bei gleicher Beleglage entscheidet die Zeit", () => {
  const a = { event: ev(NOW - 100), check: { ok: true, verdict: "bezeugt" as const, message: "" } };
  const b = { event: ev(NOW - 50), check: { ok: true, verdict: "bezeugt" as const, message: "" } };
  assert.ok(compareTrusted(a, b) < 0);
});
