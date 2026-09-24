/**
 * Tests fuer Knappheitsbonus und die ueberarbeiteten Referral-Anreize.
 *
 * Beide Mechanismen zahlen echtes Geld aus einem Topf, der nicht nachgedruckt
 * werden kann. Der Schwerpunkt liegt deshalb auf zwei Fragen: Wird der Topf
 * eingehalten, und laesst sich der Bonus erschleichen?
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import { buildPerformanceEvent } from "../src/performance.js";
import {
  computeRegionStats,
  normalizeRegion,
  scarcityMultiplier,
  peakMultiplier,
  distributeScarcityBonus,
  whereIsCapacityNeeded,
  BonusInput,
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

test("Knappheit: leere Region bekommt den vollen Aufschlag", () => {
  const m = scarcityMultiplier("af", statsWith({ eu: 20 }));
  assert.equal(m, 3, "Obergrenze bei null Providern");
});

test("Knappheit: versorgte Region bekommt keinen Aufschlag", () => {
  assert.equal(scarcityMultiplier("eu", statsWith({ eu: 20 })), 1);
  assert.equal(scarcityMultiplier("eu", statsWith({ eu: 5 })), 1, "am Zielwert ist Schluss");
});

test("Knappheit: der Sprung von 0 auf 1 wiegt schwerer als der von 4 auf 5", () => {
  const s = statsWith({});
  const bei0 = scarcityMultiplier("af", statsWith({ af: 0 }));
  const bei1 = scarcityMultiplier("af", statsWith({ af: 1 }));
  const bei4 = scarcityMultiplier("af", statsWith({ af: 4 }));
  const bei5 = scarcityMultiplier("af", statsWith({ af: 5 }));
  void s;
  assert.ok(bei0 - bei1 > bei4 - bei5, "nicht linear — der erste Knoten zaehlt am meisten");
});

test("Knappheit: 'unknown' bekommt nie einen Bonus", () => {
  // Sonst waere das Weglassen der Regionsangabe die guenstigste Art, ihn zu
  // kassieren.
  assert.equal(scarcityMultiplier("unknown", statsWith({ unknown: 0 })), 1);
});

// ------------------------------------------------------------- Stosszeiten

test("Stosszeit: viele wartende Jobs auf wenige Provider erhoehen", () => {
  const ruhig = peakMultiplier(1, 10);
  const stark = peakMultiplier(50, 5);
  assert.equal(ruhig.level, "ruhig");
  assert.equal(ruhig.multiplier, 1);
  assert.equal(stark.level, "stark");
  assert.ok(stark.multiplier > 1.4);
});

test("Stosszeit: gedeckelt, damit ein Ansturm den Topf nicht sprengt", () => {
  const extrem = peakMultiplier(100_000, 1);
  assert.ok(extrem.multiplier <= 2);
});

test("Stosszeit: kein Provider verfuegbar = maximaler Anreiz", () => {
  const leer = peakMultiplier(5, 0);
  assert.equal(leer.multiplier, 2);
  assert.match(leer.note, /maximal wertvoll/);
});

test("Stosszeit: haengt an der Auslastung, nicht an der Uhrzeit", () => {
  // In einem weltweiten Netz ist "abends" fuer jede Zeitzone etwas anderes.
  // Dieselbe Last muss dasselbe Ergebnis geben, unabhaengig davon, wann.
  const a = peakMultiplier(10, 5);
  const b = peakMultiplier(20, 10);
  assert.equal(a.multiplier, b.multiplier, "gleiches Verhaeltnis, gleiches Ergebnis");
});

// ------------------------------------------------------------- Verteilung

const p = (pk: string, region: Region, earned = 100_000, jobs = 10, trust = 0.8): BonusInput => ({
  providerPubkey: pk, region, earnedMsat: earned, jobsCompleted: jobs, trust,
});

test("Verteilung: der Topf wird nie ueberschritten", () => {
  // Ohne eigenen Token gibt es nichts nachzudrucken.
  const r = distributeScarcityBonus(
    Array.from({ length: 50 }, (_, i) => p(`prov${i}`, "af", 1_000_000)),
    { poolMsat: 50_000 },
  );
  assert.ok(r.distributedMsat <= 50_000, `verteilt ${r.distributedMsat} von 50.000`);
  assert.ok(r.remainingMsat >= 0);
});

test("Verteilung: bei Ueberzeichnung wird anteilig gekuerzt, nicht abgeschnitten", () => {
  const r = distributeScarcityBonus(
    [p("a", "af", 1_000_000), p("b", "af", 1_000_000), p("c", "af", 1_000_000)],
    { poolMsat: 30_000 },
  );
  // Abschneiden wuerde die zuletzt Einsortierten leer ausgehen lassen.
  assert.equal(r.payouts.length, 3, "alle bekommen etwas");
  const betraege = r.payouts.map((x) => x.bonusMsat);
  assert.ok(Math.max(...betraege) - Math.min(...betraege) <= 1, "gleichmaessig gekuerzt");
});

test("Verteilung: knappe Region bekommt mehr als die versorgte", () => {
  const r = distributeScarcityBonus(
    [
      p("afrika", "af"),
      ...Array.from({ length: 10 }, (_, i) => p(`eu${i}`, "eu")),
    ],
    { poolMsat: 10_000_000 },
  );
  const af = r.payouts.find((x) => x.providerPubkey === "afrika")!;
  const eu = r.payouts.find((x) => x.providerPubkey === "eu0")!;
  assert.ok(af.bonusMsat > eu.bonusMsat, "genau das ist der Zweck");
  assert.match(af.reason, /unterversorgte Region/);
});

test("Verteilung: Anwesenheit allein reicht nicht", () => {
  // Sonst waere das Anmelden in einer leeren Region die guenstigste
  // Einnahmequelle im ganzen Netz.
  const r = distributeScarcityBonus(
    [p("faul", "af", 0, 0, 0.9), p("fleissig", "af", 100_000, 10, 0.9)],
    { poolMsat: 1_000_000 },
  );
  assert.equal(r.payouts.length, 1);
  assert.equal(r.payouts[0].providerPubkey, "fleissig");
});

test("Verteilung: ohne Vertrauen kein Bonus", () => {
  const r = distributeScarcityBonus([p("sybil", "af", 100_000, 10, 0)], { poolMsat: 1_000_000 });
  assert.equal(r.payouts.length, 0, "eine frische Identitaet allein qualifiziert nicht");
});

test("Verteilung: leerer Topf zahlt nichts und stuerzt nicht ab", () => {
  const r = distributeScarcityBonus([p("a", "af")], { poolMsat: 0 });
  assert.equal(r.distributedMsat, 0);
  assert.equal(r.payouts.length, 0);
});

test("Verteilung: keine Kandidaten ergibt einen unangetasteten Topf", () => {
  const r = distributeScarcityBonus([], { poolMsat: 100_000 });
  assert.equal(r.remainingMsat, 100_000);
});

test("Empfehlung: nennt die knappste Region zuerst", () => {
  const liste = whereIsCapacityNeeded(statsWith({ eu: 20, na: 10, af: 0, as: 1 }));
  assert.equal(liste[0].providers, 0, "leere Region ganz oben");
  assert.match(liste[0].hint, /erste hier versorgt/);
  assert.equal(liste[liste.length - 1].multiplier, 1, "versorgte Region unten");
});
