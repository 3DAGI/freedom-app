/**
 * Lesestand je Kanal (Schritt C-14, Sammlung C-14): liegt über `geheim` (mit
 * Tresor im Tresor), gespeichert als Objekt, damit die Zusammenführung der
 * Sicherung (B-5) ihn je Kanal mischt. Der alte Stand – eine Liste von Paaren
 * in localStorage – wird weiter gelesen und mit Tresor einmal übernommen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LS_LESESTAND, leseLesestand, schreibeLesestand } from "../src/lesestand.js";
import { fuehreZusammen } from "../src/zustand-zusammenfuehren.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("C-14: alter Stand (Liste von Paaren) und neuer (Objekt) lesen sich gleich; geschrieben wird das Objekt", () => {
  const alt = leseLesestand(JSON.stringify([["allgemein", 100], ["ankuendigungen", 250]]));
  const neu = leseLesestand(JSON.stringify({ allgemein: 100, ankuendigungen: 250 }));
  assert.deepEqual([...alt], [["allgemein", 100], ["ankuendigungen", 250]]);
  assert.deepEqual([...neu], [...alt]);
  assert.equal(schreibeLesestand(alt), '{"allgemein":100,"ankuendigungen":250}');
  assert.deepEqual([...leseLesestand(schreibeLesestand(alt))], [...alt], "hin und zurück");
});

test("C-14: Unbrauchbares fällt weg, nichts wirft", () => {
  for (const roh of [null, "", "kein json", "42", "null", '"text"', "true"]) assert.equal(leseLesestand(roh).size, 0, String(roh));
  const gemischt = leseLesestand(JSON.stringify([["a", 1], ["b", -5], ["c", 1.5], [7, 3], ["d"], "e", ["", 4], ["f", "9"], ["g", 2, 3], ["h", 9]]));
  assert.deepEqual([...gemischt], [["a", 1], ["h", 9]]);
  assert.deepEqual([...leseLesestand(JSON.stringify({ a: 1, b: "2", c: null, d: Number.MAX_SAFE_INTEGER + 2 }))], [["a", 1]]);
});

test("C-14: als Objekt mischt die Sicherung je Kanal das Späteste – als Liste ging der Stand des Geräts verloren", () => {
  const lies = (werte: Record<string, string>) => (k: string) => werte[k] ?? null;
  const sicherung = { [LS_LESESTAND]: schreibeLesestand(new Map([["k1", 100], ["k2", 500]])) };
  const lokal = { [LS_LESESTAND]: schreibeLesestand(new Map([["k1", 300], ["k3", 50]])) };
  const { werte } = fuehreZusammen(sicherung, lies(lokal));
  assert.deepEqual([...leseLesestand(werte[LS_LESESTAND]!)].sort(), [["k1", 300], ["k2", 500], ["k3", 50]]);
  // Bis C-14 (Liste von Paaren): die Regel greift nicht, der Stand der Sicherung ersetzte den des Geräts
  const altSicherung = { [LS_LESESTAND]: JSON.stringify([["k1", 100]]) };
  const altLokal = { [LS_LESESTAND]: JSON.stringify([["k1", 300], ["k3", 50]]) };
  assert.deepEqual([...leseLesestand(fuehreZusammen(altSicherung, lies(altLokal)).werte[LS_LESESTAND]!)], [["k1", 100]]);
});

test("C-14: verdrahtet – nur über geheim, im Tresor, Klartext von vorher wandert einmal hinein", () => {
  const raeume = quelle("../src/shell/tabs/raeume.ts");
  assert.match(raeume, /spacesUi\.lastRead = leseLesestand\(geheim\.getItem\(LS_LESESTAND\) \?\? alt\);/);
  assert.match(raeume, /if \(alt !== null && tresorEingerichtet\(\)\) \{\s*void geheim\.setItem\(LS_LESESTAND, schreibeLesestand\(spacesUi\.lastRead\)\)\s*\.then\(\(\) => localStorage\.removeItem\(LS_LESESTAND\)\)/,
    "erst im Tresor, dann aus dem Klartext");
  assert.match(raeume, /void geheim\.setItem\(LS_LESESTAND, schreibeLesestand\(spacesUi\.lastRead\)\)\.catch/);
  assert.doesNotMatch(raeume, /localStorage\.setItem\([^)]*(lastRead|LS_LESESTAND)/, "nie in den Klartext schreiben");
  const tresor = quelle("../src/shell/tresor.ts");
  assert.match(tresor.slice(tresor.indexOf("const GEHEIM_FEST"), tresor.indexOf("const GEHEIM_PRAEFIXE")), /"freedom\.lastRead"/);
  assert.equal(LS_LESESTAND, "freedom.lastRead", "derselbe Name wie in der Sicherung (state-backup.ts) und der Notfall-Löschung (duress.ts)");
  // Im Browser (Smoke „raum“): nach dem Öffnen eines Kanals steht der Stand als Objekt
  assert.match(quelle("../../../scripts/smoke_test.py"), /if not isinstance\(stand, dict\) or not stand/);
});
