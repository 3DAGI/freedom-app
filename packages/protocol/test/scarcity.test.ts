/**
 * Tests fuer die Regionen: wo dem Netz Kapazitaet fehlt. Den Knappheitsbonus
 * (Topf, Multiplikator, Stosszeit) gibt es seit 5.1.4 nicht mehr – ohne Pool
 * nach Gebuehrenmodell A+ zahlte ihn niemand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import { buildPerformanceEvent } from "../src/performance.js";
import {
  computeRegionStats,
  normalizeRegion,
  whereIsCapacityNeeded,
  Region,
  RegionStats,
} from "../src/scarcity.js";


// ------------------------------------------------------------- Regionen

test("Region: gaengige Schreibweisen werden zusammengefuehrt", () => {
  assert.equal(normalizeRegion("EU"), "eu");
  assert.equal(normalizeRegion("europe"), "eu");
  assert.equal(normalizeRegion("eu-central-1"), "eu");
  assert.equal(normalizeRegion("apac"), "as");
  assert.equal(normalizeRegion(""), "unknown");
  assert.equal(normalizeRegion("mars"), "unknown");
});

function perfEvent(worker: { pk: string; sk: Uint8Array }, region: string, createdAt: number) {
  const ev = buildPerformanceEvent({
    workerPubkey: worker.pk,
    workType: "ai_job",
    units: 100,
    volumeMsat: 10_000,
    chain: "lightning",
    seasonId: "s1",
  }, createdAt);
  ev.tags.push(["region", region]);
  return signEvent(ev, worker.sk);
}

test("Regionsstatistik: zaehlt Provider je Region im Zeitfenster", () => {
  const now = 1_800_000_000;
  const a = generateKeypair(), b = generateKeypair(), c = generateKeypair();
  const stats = computeRegionStats([
    perfEvent(a, "eu", now - 100),
    perfEvent(a, "eu", now - 200), // derselbe Provider zweimal
    perfEvent(b, "eu", now - 300),
    perfEvent(c, "af", now - 400),
  ], {}, now);

  assert.equal(stats.get("eu")!.providers, 2, "derselbe Provider zaehlt einmal");
  assert.equal(stats.get("eu")!.jobs, 3);
  assert.equal(stats.get("af")!.providers, 1);
});

test("Regionsstatistik: leere Regionen erscheinen trotzdem", () => {
  // Eine Region ohne Eintrag ist die knappste ueberhaupt — sie unsichtbar zu
  // lassen waere genau falsch herum.
  const stats = computeRegionStats([], {}, 1_800_000_000);
  assert.equal(stats.get("sa")!.providers, 0);
  assert.equal(stats.get("oc")!.providers, 0);
});

test("Regionsstatistik: alte Nachweise fallen aus dem Fenster", () => {
  const now = 1_800_000_000;
  const a = generateKeypair();
  const stats = computeRegionStats([perfEvent(a, "eu", now - 30 * 86400)], {}, now);
  assert.equal(stats.get("eu")!.providers, 0, "ein Monat alt zaehlt nicht als aktiv");
});

// ------------------------------------------------------------- Multiplikator

function statsWith(counts: Partial<Record<Region, number>>): Map<Region, RegionStats> {
  const m = new Map<Region, RegionStats>();
  for (const r of ["eu", "na", "sa", "af", "as", "oc", "unknown"] as Region[]) {
    m.set(r, { region: r, providers: counts[r] ?? 0, jobs: 0, share: 0 });
  }
  return m;
}

test("Empfehlung: nennt die knappste Region zuerst", () => {
  const liste = whereIsCapacityNeeded(statsWith({ eu: 20, na: 10, af: 0, as: 1 }));
  assert.equal(liste[0].providers, 0, "leere Region ganz oben");
  assert.match(liste[0].hint, /erste hier versorgt/);
  assert.equal(liste[liste.length - 1].fehlen, 0, "versorgte Region unten");
  assert.equal(liste.find((r) => r.region === "as")!.fehlen, 4);
  assert.match(liste.find((r) => r.region === "as")!.hint, /4 fehlen bis 5/);
});
