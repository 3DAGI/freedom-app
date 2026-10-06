/**
 * P5b: Prüfbudget – der behaltene Anteil `pruefung` (0,5 %) wird nur gezählt,
 * nie ausgegeben; Unlesbares zählt als 0, nur ganze, positive Beträge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LS_PRUEFBUDGET, PruefBudget } from "../src/pruefbudget.js";

function speicher(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test("Prüfbudget: verbucht ganze positive msat, zählt auf, Name mit Präfix freedom.", async () => {
  const sp = speicher();
  const b = new PruefBudget(sp);
  assert.equal(b.stand(), 0);
  await b.verbuche(5_000);
  await b.verbuche(105);
  assert.equal(b.stand(), 5_105);
  assert.equal(sp.m.get(LS_PRUEFBUDGET), JSON.stringify({ msat: 5_105 }));
  assert.match(LS_PRUEFBUDGET, /^freedom\./);
});

test("Prüfbudget: nichts für 0, negative, gebrochene oder unsichere Beträge; Unlesbares zählt als 0", async () => {
  const sp = speicher();
  const b = new PruefBudget(sp);
  for (const x of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) await b.verbuche(x);
  assert.equal(sp.m.has(LS_PRUEFBUDGET), false, "nichts geschrieben");
  for (const roh of ["{kaputt", "null", "[]", JSON.stringify({ msat: -5 }), JSON.stringify({ msat: 1.5 }), JSON.stringify({ msat: "9" })]) {
    assert.equal(new PruefBudget(speicher({ [LS_PRUEFBUDGET]: roh })).stand(), 0, roh);
  }
  // Ein Überlauf schreibt nichts, statt den Stand zu verderben
  const voll = speicher({ [LS_PRUEFBUDGET]: JSON.stringify({ msat: Number.MAX_SAFE_INTEGER }) });
  await new PruefBudget(voll).verbuche(10);
  assert.equal(new PruefBudget(voll).stand(), Number.MAX_SAFE_INTEGER);
});
