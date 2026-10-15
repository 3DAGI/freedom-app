/**
 * Tests fuer Web-of-Trust (die Netzkapazitaet fiel mit E9-2 weg).
 *
 * Vertrauen entscheidet, wer wie viel bekommt. Der Schwerpunkt liegt auf
 * Sybil-Angriffen – dafuer ist das der naheliegende Hebel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import { extractEdges, computeTrust, trustOf } from "../src/wot.js";

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
// Die netzweite Gratis-Schwelle (`network-capacity.ts`) fiel mit E9-2 weg (V2 A, freigegeben
// 08.10.2026): Jeder Speicherknoten nennt seine Grenze selbst im Angebot – `speicher-gratis.test.ts`.
