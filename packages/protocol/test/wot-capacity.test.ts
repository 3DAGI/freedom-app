/**
 * Tests fuer Web-of-Trust und Netzkapazitaet.
 *
 * Beides steuert, wer wie viel bekommt: Vertrauen entscheidet ueber
 * Bonuszahlungen, Kapazitaet ueber die Gratis-Schwelle. Der Schwerpunkt liegt
 * auf Sybil-Angriffen — beide Mechanismen sind dafuer der naheliegende Hebel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import { extractEdges, computeTrust, trustOf } from "../src/wot.js";
import {
  extractStorageCaps, computeNetworkCapacity,
  FREE_HARD_MAX_BYTES, FREE_MIN_BYTES, FREE_CAPACITY_FACTOR,
} from "../src/network-capacity.js";

const NOW = 1_800_000_000;
const ANKER = generateKeypair();
const A = generateKeypair(), B = generateKeypair(), C = generateKeypair();

/**
 * Attestierung (kind 38002): "mit diesem Gegenueber lief ein Swap".
 *
 * Vertrauen kommt hier NICHT aus Kontaktlisten, sondern aus abgeschlossenen
 * Geschaeften — das ist der wesentliche Unterschied zu einem Folgen-Graphen:
 * Ein Kontakt kostet nichts, ein abgewickelter Swap schon.
 */
const attestiert = (von: typeof A, an: string, erfolg = true) =>
  signEvent(buildEvent(von.pk, 38002,
    [["p", an], ["result", erfolg ? "ok" : "fail"]], ""), von.sk);

// ------------------------------------------------------------- Vertrauen

test("Kontakte werden zu Kanten", () => {
  const kanten = extractEdges([attestiert(ANKER, A.pk), attestiert(ANKER, B.pk)]);
  assert.equal(kanten.length, 2);
  assert.ok(kanten.some((k) => k.to === A.pk));
});

test("Direkte Kontakte des Ankers bekommen hohes Vertrauen", () => {
  const t = computeTrust(extractEdges([attestiert(ANKER, A.pk)]), { roots: [ANKER.pk] });
  assert.ok(trustOf(t, A.pk) > 0, "ein direkter Kontakt muss zaehlen");
});

test("Vertrauen nimmt mit der Entfernung ab", () => {
  // Sonst waere ein Kontakt dritten Grades so viel wert wie ein eigener.
  const t = computeTrust(
    extractEdges([attestiert(ANKER, A.pk), attestiert(A, B.pk), attestiert(B, C.pk)]),
    { roots: [ANKER.pk] },
  );
  assert.ok(trustOf(t, A.pk) > trustOf(t, B.pk));
  assert.ok(trustOf(t, B.pk) > trustOf(t, C.pk));
});

test("Die Kette endet bei der Maximaltiefe", () => {
  const kette = [attestiert(ANKER, A.pk), attestiert(A, B.pk), attestiert(B, C.pk)];
  const flach = computeTrust(extractEdges(kette), { roots: [ANKER.pk], maxDepth: 1 });
  assert.equal(trustOf(flach, C.pk), 0, "jenseits der Tiefe gilt kein Vertrauen");
});

test("DER Sybil-Fall: tausend Fremde vertrauen sich gegenseitig", () => {
  // Ohne Anker waere eine Clique aus Wegwerf-Schluesseln beliebig
  // vertrauenswuerdig — und genau das ist der billigste Angriff.
  const sybils = Array.from({ length: 50 }, () => generateKeypair());
  const events = sybils.flatMap((s) => sybils.map((x) => attestiert(s, x.pk)));
  const t = computeTrust(extractEdges(events), { roots: [ANKER.pk] });
  for (const s of sybils) {
    assert.equal(trustOf(t, s.pk), 0, "ohne Verbindung zum Anker kein Vertrauen");
  }
});

test("Ein einziger Brueckenkontakt hebt die Clique nicht", () => {
  // Der Anker folgt EINEM Sybil. Der bekommt Vertrauen, die anderen nur
  // stark abgeschwaecht.
  const sybils = Array.from({ length: 20 }, () => generateKeypair());
  const events = [attestiert(ANKER, sybils[0].pk),
    ...sybils.flatMap((s) => sybils.map((x) => attestiert(s, x.pk)))];
  const t = computeTrust(extractEdges(events), { roots: [ANKER.pk] });
  assert.ok(trustOf(t, sybils[0].pk) > trustOf(t, sybils[5].pk));
});

test("Unbekannte haben null Vertrauen, nicht undefined", () => {
  const t = computeTrust([], { roots: [ANKER.pk] });
  assert.equal(trustOf(t, C.pk), 0);
});

test("Kaputte Attestierungen bringen die Rechnung nicht zum Absturz", () => {
  const kaputt = signEvent(buildEvent(A.pk, 38002, [["p"], [], ["x", "y"]], ""), A.sk);
  assert.doesNotThrow(() => computeTrust(extractEdges([kaputt]), { roots: [ANKER.pk] }));
});

test("Gescheiterte Swaps zaehlen nicht als Vertrauen", () => {
  // Ein missglueckter Swap ist ein Kontakt, aber kein guter — ihn mitzuzaehlen
  // wuerde Reputation aus Fehlschlaegen erzeugen.
  const t = computeTrust(extractEdges([attestiert(ANKER, A.pk, false)]), { roots: [ANKER.pk] });
  assert.equal(trustOf(t, A.pk), 0);
});

// ------------------------------------------------------------ Kapazitaet

/** Faehigkeiten-Event mit Speicherangabe: ["storage", bytes, preis, bootstrap]. */
const speicher = (kp: typeof A, bytes: number, at = NOW) =>
  signEvent(buildEvent(kp.pk, 38025, [["storage", String(bytes), "1", "0"]], "", at), kp.sk);

test("Speicherangaben werden gelesen", () => {
  const caps = extractStorageCaps([speicher(A, 1_000_000_000)]);
  assert.equal(caps.length, 1);
  assert.equal(caps[0].capacityBytes, 1_000_000_000);
});

test("Gratis-Schwelle waechst mit dem Netz, aber gedeckelt", () => {
  // Ohne Deckel wuerde ein einzelner Grossanbieter das Gratiskontingent fuer
  // alle so weit anheben, dass niemand mehr zahlt.
  const klein = computeNetworkCapacity([speicher(A, 10_000_000_000)], NOW);
  const riesig = computeNetworkCapacity(
    [speicher(A, 10_000_000_000_000_000)], NOW);
  assert.ok(riesig.freeUploadLimitBytes <= FREE_HARD_MAX_BYTES);
  assert.ok(klein.freeUploadLimitBytes >= FREE_MIN_BYTES);
});

test("Ohne Anbieter gibt es kein Gratiskontingent — und das ist richtig", () => {
  // Anders als beim Gratis-Tier fuer Inferenz waere hier ein Mindestbetrag
  // ein gebrochenes Versprechen: Speicher, den niemand anbietet, kann man
  // nicht verschenken. Der Nutzer bekaeme eine Zusage und dann einen Fehler.
  const leer = computeNetworkCapacity([], NOW);
  assert.equal(leer.freeUploadLimitBytes, 0);
  assert.equal(leer.activeSeeders, 0);
});

test("Veraltete Angaben zaehlen nicht mit", () => {
  // Ein Anbieter, der vor drei Monaten etwas angekuendigt hat, ist kein
  // Beleg fuer heute vorhandenen Speicher.
  const alt = computeNetworkCapacity([speicher(A, 10_000_000_000, NOW - 90 * 86400)], NOW);
  assert.equal(alt.activeSeeders, 0);
  assert.equal(alt.freeUploadLimitBytes, 0);
});

test("Sobald ein Anbieter da ist, greift das Mindestkontingent", () => {
  // Ein winziger Anbieter wuerde sonst ein Kontingent von wenigen Kilobyte
  // ergeben — unbrauchbar zum Ausprobieren.
  const winzig = computeNetworkCapacity([speicher(A, 1_000_000)], NOW);
  assert.equal(winzig.freeUploadLimitBytes, FREE_MIN_BYTES);
});

test("Mehr Anbieter heben die Gesamtkapazitaet", () => {
  const einer = computeNetworkCapacity([speicher(A, 10_000_000_000)], NOW);
  const drei = computeNetworkCapacity(
    [speicher(A, 10_000_000_000), speicher(B, 10_000_000_000), speicher(C, 10_000_000_000)], NOW);
  assert.equal(drei.activeSeeders, 3);
  assert.ok(drei.totalBytes > einer.totalBytes);
});

test("HINWEIS: dieselbe Pubkey wird derzeit MEHRFACH gezaehlt", () => {
  // Das ist eine echte Schwaeche: Ein Einzelner kann durch wiederholtes
  // Ankuendigen die Gratis-Schwelle fuer alle anheben. Der Deckel begrenzt
  // den Schaden, beseitigt ihn aber nicht. Der Test haelt den Zustand fest,
  // damit die Annahme nicht unbemerkt weiterlebt.
  const zehnmal = computeNetworkCapacity(
    Array.from({ length: 10 }, (_, i) => speicher(A, 1_000_000_000, NOW - i)), NOW);
  assert.equal(zehnmal.activeSeeders, 10, "zehn Meldungen derselben Pubkey");
  assert.ok(zehnmal.freeUploadLimitBytes <= FREE_HARD_MAX_BYTES, "der Deckel haelt trotzdem");
});

test("Der Faktor ist konservativ gewaehlt", () => {
  // Ein halbes Prozent der Netzkapazitaet je Nutzer: Bei tausend Nutzern
  // waeren das das Fuenffache dessen, was da ist — deshalb der Deckel.
  assert.ok(FREE_CAPACITY_FACTOR > 0 && FREE_CAPACITY_FACTOR <= 0.01);
});
