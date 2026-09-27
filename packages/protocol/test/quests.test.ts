/**
 * Tests fuer das Aufgabensystem.
 *
 * Solche Systeme scheitern nicht an der Rechnung, sondern am Missbrauch. Die
 * Tests pruefen deshalb, dass nur eigene, nachweisbare Arbeit zaehlt. Seit
 * 5.1.4c (Gebuehrenmodell A+) gibt es keinen Aufgaben-Topf und keine Praemien
 * mehr – Aufgaben ergeben nur Abzeichen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, NostrEvent } from "../src/event.js";
import { buildPerformanceEvent } from "../src/performance.js";
import * as aufgaben from "../src/quests.js";
import { QUESTS, evaluateQuests, BADGE_ONLY_TASKS, QuestId } from "../src/quests.js";

const NOW = 1_800_000_000;
const TAG = 86400;
const ICH = generateKeypair();
const FREMD = generateKeypair();

const arbeit = (worker: string, tagVersatz: number): NostrEvent => {
  const kp = generateKeypair();
  return signEvent(buildPerformanceEvent({
    workerPubkey: worker, workType: "ai_job", units: 10,
    volumeMsat: 1000, chain: "lightning", seasonId: "s",
  }, NOW - tagVersatz * TAG), kp.sk);
};

const leer = { pubkey: ICH.pk, performances: [], nowSecs: NOW };
const stand = (id: QuestId, over = {}) =>
  evaluateQuests({ ...leer, ...over }).find((p) => p.quest.id === id)!;

// ------------------------------------------------------------- Katalog

test("Katalog: jede Aufgabe nennt ihren Nachweis", () => {
  // Eine Aufgabe ohne benannten Nachweis ist eine, die sich abfarmen laesst.
  for (const q of QUESTS) {
    assert.ok(q.proof.length > 10, `${q.id} ohne Nachweis`);
    assert.ok(q.title && q.description);
  }
});

test("Sicherung ist die erste Aufgabe; keine Aufgabe bringt Geld (A+, 5.1.4c)", () => {
  // Ohne Sicherung ist alles andere sinnlos. Mit A+ gibt es keinen Topf, aus
  // dem Praemien kaemen: Wer ein Abzeichen erschwindelt, gewinnt nichts.
  assert.equal(QUESTS[0].id, "zugang_gesichert");
  for (const q of QUESTS) assert.ok(!("rewardMsat" in q), `${q.id} hat einen Betrag`);
  for (const alt of ["questBudgetFor", "decidePayout", "sustainability", "maxCostPerParticipant",
    "QUEST_SHARE_OF_POOL_PERCENT", "BOOTSTRAP_FLOOR_MSAT", "HARD_CAP_PER_EPOCH_MSAT"]) {
    assert.ok(!(alt in aufgaben), `${alt} ist zurueck`);
  }
  // Die Aufgaben aus Gebuehren-Belegen (38051) sind weg – den Beleg gibt es nicht mehr
  const ids = QUESTS.map((q) => q.id as string);
  assert.ok(!ids.includes("erster_job") && !ids.includes("umsatz_1000"));
  assert.deepEqual(evaluateQuests(leer).map((p) => p.quest.id).sort(), ids.filter((i) => i !== "modell_gespiegelt").sort());
});

// --------------------------------------------------- Fortschritt

test("Provider-Aufgabe zaehlt TAGE, nicht Jobs", () => {
  const einTag = stand("provider_7_tage", {
    performances: Array.from({ length: 50 }, () => arbeit(ICH.pk, 0)),
  });
  assert.equal(einTag.done, false, "50 Jobs an einem Tag sind eine Woche nicht");

  const sieben = stand("provider_7_tage", {
    performances: [0, 1, 2, 3, 4, 5, 6].map((d) => arbeit(ICH.pk, d)),
  });
  assert.equal(sieben.done, true);
});

test("Fremde Arbeit zaehlt nicht fuer mich", () => {
  const s = stand("provider_7_tage", {
    performances: [0, 1, 2, 3, 4, 5, 6].map((d) => arbeit(FREMD.pk, d)),
  });
  assert.equal(s.done, false);
});

test("Fortschritt wird als Anteil UND als Text gemeldet", () => {
  const s = stand("provider_7_tage", {
    performances: [0, 1, 2].map((d) => arbeit(ICH.pk, d)),
  });
  assert.ok(Math.abs(s.progress - 3 / 7) < 0.01);
  assert.match(s.detail, /3 von 7/);
});

test("Geworbene zaehlen nur, wenn sie arbeiten", () => {
  assert.equal(stand("geworben_aktiv", { activeReferrals: 2 }).done, false);
  assert.equal(stand("geworben_aktiv", { activeReferrals: 3 }).done, true);
});

test("Nicht nachweisbare Aufgaben tragen ausdruecklich kein Geld", () => {
  // Die Trennlinie muss im Code sichtbar sein, damit niemand spaeter
  // versehentlich eine Auszahlung daran haengt.
  for (const b of BADGE_ONLY_TASKS) {
    assert.ok(!("rewardMsat" in b), `${b.id} hat einen Betrag`);
    assert.ok(b.note.length > 5);
  }
});
