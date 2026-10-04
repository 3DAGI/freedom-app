/**
 * Kopfgelder (Kind 38061, E10 B): zugesagt in sats, SOL oder beiden, mit Verweis
 * aufs Issue; den Stand setzt nur der Geldgeber. Kein Topf, keine Runde.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_KOPFGELD, aktuelleKopfgelder, baueKopfgeld, generateKeypair, kopfgelderZuIssue, leseKopfgeld, offeneKopfgelder, signEvent,
  type Kopfgeld,
} from "../src/index.js";

const ZEIT = 1_800_000_000;
const GELDGEBER = generateKeypair();
const ENTWICKLERIN = generateKeypair();
const FREMD = generateKeypair();
const ISSUE = "a".repeat(64);
const REPO = `30617:${"b".repeat(64)}:freedom-app`;

const basis = (k: Partial<Omit<Kopfgeld, "zeit">> = {}): Omit<Kopfgeld, "zeit"> => ({
  kennung: "mesh-ble", titel: "Mesh über Bluetooth", beschreibung: "Rahmen über BLE senden und empfangen.",
  lamports: 250_000_000, geldgeber: GELDGEBER.pk, stand: "offen", issue: ISSUE, repo: REPO, ...k,
});
const signiert = (k: Omit<Kopfgeld, "zeit">, zeit = ZEIT, wer = GELDGEBER) => signEvent(baueKopfgeld(k, zeit), wer.sk);

test("Kopfgeld: SOL, sats oder beides, mit Issue und Repo – hin und zurück", () => {
  const ev = signiert(basis());
  assert.equal(ev.kind, KIND_KOPFGELD);
  assert.deepEqual(leseKopfgeld(ev), { ...basis(), zeit: ZEIT });
  assert.deepEqual(ev.tags.find((t) => t[0] === "e"), ["e", ISSUE]);
  // Beide Währungen, ohne Issue: die Felder fehlen dann, statt leer zu sein
  const { issue: _i, repo: _r, ...ohneVerweis } = basis({ msat: 50_000_000 });
  assert.deepEqual(leseKopfgeld(signiert(ohneVerweis)), { ...ohneVerweis, zeit: ZEIT });
  const nurSats = { ...ohneVerweis, lamports: undefined };
  assert.equal(leseKopfgeld(signiert(nurSats))?.lamports, undefined);
  assert.equal(leseKopfgeld(signiert(nurSats))?.msat, 50_000_000);
});

test("Kopfgeld: ohne Betrag, mit Unsinn oder an sich selbst wird nicht gebaut", () => {
  assert.throws(() => baueKopfgeld(basis({ lamports: undefined })), /betrag/);
  assert.throws(() => baueKopfgeld(basis({ lamports: 0 })), /betrag/);
  assert.throws(() => baueKopfgeld(basis({ msat: 1.5 })), /betrag/);
  assert.throws(() => baueKopfgeld(basis({ titel: " " })), /text/);
  assert.throws(() => baueKopfgeld(basis({ kennung: "mit leerzeichen" })), /kennung/);
  assert.throws(() => baueKopfgeld(basis({ stand: "erledigt" })), /an/, "erledigt braucht, an wen");
  assert.throws(() => baueKopfgeld(basis({ an: ENTWICKLERIN.pk })), /an/, "offen hat noch niemanden");
  assert.throws(() => baueKopfgeld(basis({ stand: "vergeben", an: GELDGEBER.pk })), /an/, "nicht an sich selbst");
  assert.throws(() => baueKopfgeld(basis({ issue: "zz" })), /issue/);
  assert.throws(() => baueKopfgeld(basis({ repo: "30617:kurz:x" })), /repo/);
});

test("Kopfgeld lesen: Fälschung, kaputte Beträge, falsches d und unbekannter Stand fallen weg", () => {
  const ev = signiert(basis());
  assert.equal(leseKopfgeld({ ...ev, tags: ev.tags.map((t) => (t[0] === "amount_lamports" ? ["amount_lamports", "999999999"] : t)) }), null, "nach dem Signieren verändert");
  const neu = (aenderung: (tags: string[][]) => string[][]) =>
    leseKopfgeld(signEvent({ ...baueKopfgeld(basis(), ZEIT), tags: aenderung(baueKopfgeld(basis(), ZEIT).tags) }, GELDGEBER.sk));
  assert.equal(neu((t) => t.map((x) => (x[0] === "amount_lamports" ? ["amount_lamports", "1e9"] : x))), null);
  assert.equal(neu((t) => t.map((x) => (x[0] === "amount_lamports" ? ["amount_lamports", "-5"] : x))), null);
  assert.equal(neu((t) => t.filter((x) => x[0] !== "amount_lamports")), null, "ohne Betrag");
  assert.equal(neu((t) => t.map((x) => (x[0] === "d" ? ["d", "bounty:anderes"] : x))), null);
  assert.equal(neu((t) => t.map((x) => (x[0] === "status" ? ["status", "bezahlt"] : x))), null);
  assert.equal(neu((t) => [...t, ["p", ENTWICKLERIN.pk]]), null, "offen und doch vergeben");
  assert.equal(leseKopfgeld({ ...ev, kind: 38060 }), null);
});

test("Stand: nur der Geldgeber ändert ihn – der neueste zählt; ein Fremder legt höchstens ein eigenes an", () => {
  const offen = signiert(basis(), ZEIT);
  const vergeben = signiert(basis({ stand: "vergeben", an: ENTWICKLERIN.pk }), ZEIT + 10);
  const erledigt = signiert(basis({ stand: "erledigt", an: ENTWICKLERIN.pk }), ZEIT + 20);
  // Ein Fremder meldet dieselbe Kennung als erledigt – an sich selbst
  const falsch = signEvent(baueKopfgeld(basis({ geldgeber: FREMD.pk, stand: "erledigt", an: ENTWICKLERIN.pk }), ZEIT + 30), FREMD.sk);
  const alle = aktuelleKopfgelder([erledigt, offen, falsch, vergeben]);
  assert.equal(alle.length, 2);
  const echt = alle.find((k) => k.geldgeber === GELDGEBER.pk)!;
  assert.equal(echt.stand, "erledigt");
  assert.equal(echt.an, ENTWICKLERIN.pk);
  assert.deepEqual(offeneKopfgelder([offen, falsch]).map((k) => k.geldgeber), [GELDGEBER.pk], "das echte bleibt offen");
  assert.deepEqual(offeneKopfgelder([offen, vergeben]), [], "vergeben ist nicht mehr offen");
  const zurueck = signiert(basis({ stand: "zurueckgezogen" }), ZEIT + 40);
  assert.deepEqual(offeneKopfgelder([offen, zurueck]), []);
});

test("Zum Issue: alle Kopfgelder mit Verweis auf genau dieses Issue", () => {
  const a = signiert(basis({ kennung: "a" }), ZEIT);
  const b = signEvent(baueKopfgeld(basis({ kennung: "b", geldgeber: FREMD.pk, msat: 10_000_000, lamports: undefined }), ZEIT + 5), FREMD.sk);
  const anderes = signiert(basis({ kennung: "c", issue: "c".repeat(64) }), ZEIT + 9);
  assert.deepEqual(kopfgelderZuIssue([a, b, anderes], ISSUE).map((k) => k.kennung), ["b", "a"], "neueste zuerst");
  assert.deepEqual(kopfgelderZuIssue([a, b, anderes], "d".repeat(64)), []);
});
