/**
 * Schritt 6.4: Verkehrsmuster – Zufallsverzögerung, Abstand mit Zufall,
 * gebündelter Abruftakt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AbrufTakt, mitZufall, sichererZufall, zufallsVerzoegerung } from "../src/verkehr.js";

test("6.4: Zufallsverzögerung in [0, max], ganzzahlig; aus heißt 0", () => {
  assert.equal(zufallsVerzoegerung(30_000, () => 0), 0);
  assert.equal(zufallsVerzoegerung(30_000, () => 0.999999999), 30_000);
  assert.equal(zufallsVerzoegerung(30_000, () => 0.5), 15_000);
  for (const m of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(zufallsVerzoegerung(m, () => 0.7), 0);
  for (let i = 0; i < 200; i++) {
    const v = zufallsVerzoegerung(30_000);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 30_000);
  }
  const werte = new Set(Array.from({ length: 50 }, () => zufallsVerzoegerung(30_000)));
  assert.ok(werte.size > 40, "kryptografischer Zufall, kein fester Wert");
  const z = sichererZufall();
  assert.ok(z >= 0 && z < 1);
});

test("6.4: Abstand mit Zufall – basis ± anteil", () => {
  assert.equal(mitZufall(30_000, 0.5, () => 0), 15_000);
  assert.equal(mitZufall(30_000, 0.5, () => 1), 45_000);
  assert.equal(mitZufall(30_000, 0, () => 0.9), 30_000);
  assert.equal(mitZufall(30_000, 5, () => 0), 0, "Anteil höchstens 1");
});

test("6.4: Abruftakt – gebündelt, je Schlag ein neuer Zufallsabstand, jeder n-te, Fehler stoppen nichts", () => {
  const geplant: number[] = [];
  let naechster: (() => void) | null = null;
  const werte = [0, 1, 0.5, 0.25];
  let i = 0;
  const takt = new AbrufTakt(30_000, {
    zufall: () => werte[i++ % werte.length]!,
    planen: (fn, ms) => { geplant.push(ms); naechster = fn; return ms; },
    abbrechen: () => { naechster = null; },
  });
  const lauf: string[] = [];
  takt.melde("raum", () => lauf.push("raum"));
  takt.melde("posteingang", () => { lauf.push("posteingang"); throw new Error("Netz weg"); }, 2);
  takt.melde("urteile", async () => { lauf.push("urteile"); throw new Error("später"); }, 4);
  takt.start();
  takt.start(); // doppelt starten plant nicht doppelt
  assert.deepEqual(geplant, [15_000]);
  const schlaege = [1, 2, 3, 4].map(() => { const fn = naechster!; return fn === null ? [] : (fn(), lauf.splice(0)); });
  assert.deepEqual(schlaege, [["raum"], ["raum", "posteingang"], ["raum"], ["raum", "posteingang", "urteile"]]);
  assert.deepEqual(geplant, [15_000, 45_000, 30_000, 22_500, 15_000], "jeder Abstand neu gewürfelt");
  takt.stop();
  assert.equal(naechster, null);
});
