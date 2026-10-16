/**
 * Schritt C-56b (Oberflächen-Review 15.10.2026): Stil-Abdruck im Smoke-Test. Je Seite und Größe eine feste Probe aller
 * Bausteine, Seitentitel und Navigation – verglichen mit `scripts/stil-soll.json`. Hier: die Datei passt zu den
 * Bausteinen und der Smoke-Teil ist eingetragen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const soll = JSON.parse(quelle("../../../scripts/stil-soll.json")) as Record<string, Record<string, unknown>>;
const smoke = quelle("../../../scripts/smoke_test.py");

test("zwanzig Ansichten (fünf Seiten, Desktop und Handy, dunkel und seit C-57b hell), je alle Bausteine der Probe", () => {
  const seiten = ["agent", "chats", "wallet", "verdienen", "einstellungen"];
  const ansichten = ["desktop", "mobil"].flatMap((g) => seiten.map((s) => `${g}/${s}`));
  assert.deepEqual(Object.keys(soll).sort(), [...ansichten, ...ansichten.map((a) => `hell/${a}`)].sort());
  for (const [k, v] of Object.entries(soll)) {
    for (const teil of ["knopf", "primaer", "ghost", "chip", "karte", "feld", "schalter", "skelett", "gruppe", "zeile", "text", "navigation"]) {
      assert.ok(Array.isArray(v[teil]), `${k} ${teil}`);
    }
  }
});

test("die gemerkten Werte sind die Regeln der Bausteine: Satzschreibung, Radien aus den Tokens, Grün nur primär", () => {
  for (const [k, v] of Object.entries(soll)) {
    const gruen = k.startsWith("hell/") ? "rgb(59, 118, 0)" : "rgb(123, 200, 10)";
    const [, , , schreibung, radius, hintergrund] = v.knopf as string[];
    assert.equal(schreibung, "none", "Knöpfe in Satzschreibung (C-42b)");
    assert.equal(radius, "10px");
    assert.notEqual(hintergrund, gruen, "die Grundform ist nicht grün");
    assert.equal((v.primaer as string[])[5], gruen);
    // Schrift auf Grün: dunkel Schwarz, hell Weiß (C-57b, --auf-akzent)
    assert.equal((v.primaer as string[])[6], k.startsWith("hell/") ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
    assert.equal((v.chip as string[])[4], "999px");
    assert.equal((v.karte as string[])[4], "14px");
  }
});

test("Smoke: eingetragen, Übergänge aus beim Messen, neu schreiben nur mit STIL_NEU=1", () => {
  assert.match(smoke, /erg\["stil_abdruck"\] = stil_abdruck_pruefen\(browser,/);
  assert.match(smoke, /and erg\.get\("stil_abdruck", \{\}\)\.get\("bestanden"\) is True/);
  assert.match(smoke, /transition: none !important; animation: none !important;/);
  assert.match(smoke, /if os\.environ\.get\("STIL_NEU"\) == "1":/);
  assert.match(smoke, /vorsilbe = "" if schema == "dark" else "hell\/"/);
  assert.match(smoke, /erg\["thema"\] = thema_pruefen\(browser,/);
  assert.match(smoke, /and erg\.get\("thema", \{\}\)\.get\("bestanden"\) is True/);
});
