/**
 * Tests fuer das Aufgabensystem.
 *
 * Solche Systeme scheitern nicht an der Rechnung, sondern am Missbrauch. Die
 * Tests pruefen deshalb vor allem Selbstgeschaefte und die Obergrenze des
 * Topfes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import { buildPerformanceEvent } from "../src/performance.js";
import {
  QUESTS, questById, evaluateQuests, decidePayout, maxCostPerParticipant,
  BADGE_ONLY_TASKS, QuestId, questBudgetFor, sustainability,
  BOOTSTRAP_FLOOR_MSAT, HARD_CAP_PER_EPOCH_MSAT,
} from "../src/quests.js";

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

const feeBeweis = (kunde: string, worker: string, totalMsat: number): NostrEvent => {
  const kp = generateKeypair();
  return signEvent(buildEvent(kp.pk, 38051, [
    ["customer", kunde], ["worker", worker], ["total_msat", String(totalMsat)],
  ], ""), kp.sk);
};

const leer = { pubkey: ICH.pk, performances: [], feeProofs: [], nowSecs: NOW };
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

test("Sicherung ist die erste Aufgabe und bringt kein Geld", () => {
  // Ohne Sicherung ist alles andere sinnlos — aber dafuer zu zahlen waere
  // eine Einladung, sie sofort wieder zu vergessen.
  assert.equal(QUESTS[0].id, "zugang_gesichert");
  assert.equal(QUESTS[0].rewardMsat, 0);
});

test("Laenger durchhalten ist ueberproportional mehr wert", () => {
  // Was dem NETZ nuetzt, nicht was Aufwand macht.
  const w = questById("provider_7_tage")!.rewardMsat;
  const m = questById("provider_30_tage")!.rewardMsat;
  assert.ok(m > w * 4, `30 Tage bringen nur ${m / w}x`);
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

// --------------------------------------- DER Missbrauchsfall

test("Selbstgeschaefte zaehlen NICHT", () => {
  // Man zahlt an den eigenen Provider und kassiert die Praemie — der
  // klassische Weg, so ein System zu melken.
  const s = stand("umsatz_1000", {
    feeProofs: [feeBeweis(ICH.pk, ICH.pk, 5_000_000)],
  });
  assert.equal(s.done, false);
  assert.match(s.detail, /0 von 1.000/);
});

test("Umsatz bei fremden Providern zaehlt", () => {
  const s = stand("umsatz_1000", {
    feeProofs: [feeBeweis(ICH.pk, FREMD.pk, 1_200_000)],
  });
  assert.equal(s.done, true);
});

test("Fremde Zahlungen zaehlen mir nicht", () => {
  const s = stand("umsatz_1000", {
    feeProofs: [feeBeweis(FREMD.pk, ICH.pk, 5_000_000)],
  });
  assert.equal(s.done, false);
});

test("Erster Job setzt einen belegten fremden Kauf voraus", () => {
  assert.equal(stand("erster_job").done, false);
  assert.equal(stand("erster_job", { feeProofs: [feeBeweis(ICH.pk, FREMD.pk, 6000)] }).done, true);
  assert.equal(stand("erster_job", { feeProofs: [feeBeweis(ICH.pk, ICH.pk, 6000)] }).done, false);
});

test("Geworbene zaehlen nur, wenn sie arbeiten", () => {
  assert.equal(stand("geworben_aktiv", { activeReferrals: 2 }).done, false);
  assert.equal(stand("geworben_aktiv", { activeReferrals: 3 }).done, true);
});

// ------------------------------------------------------------- Auszahlung

const topf = (pool: number, spent = 0) => ({ poolMsat: pool, spentMsat: spent });

test("Offene Aufgabe wird nicht ausgezahlt", () => {
  const d = decidePayout(stand("provider_7_tage"), topf(1_000_000), []);
  assert.equal(d.pay, false);
});

test("Abzeichen bringen kein Geld", () => {
  const d = decidePayout(stand("zugang_gesichert", { backedUp: true }), topf(100_000_000), []);
  assert.equal(d.pay, false);
  assert.match(d.reason, /Abzeichen/);
});

test("Einmalige Aufgaben zahlen nicht zweimal", () => {
  const p = stand("provider_7_tage", { performances: [0,1,2,3,4,5,6].map((d) => arbeit(ICH.pk, d)) });
  assert.equal(decidePayout(p, topf(100_000_000), []).pay, true);
  assert.equal(decidePayout(p, topf(100_000_000), ["provider_7_tage"]).pay, false);
});

test("Leerer Topf zahlt nicht — und sagt warum", () => {
  const p = stand("provider_7_tage", { performances: [0,1,2,3,4,5,6].map((d) => arbeit(ICH.pk, d)) });
  const d = decidePayout(p, topf(100_000_000, 100_000_000), []);
  assert.equal(d.pay, false);
  assert.match(d.reason, /Nächste Epoche/);
});

test("Fast leerer Topf zahlt anteilig statt gar nicht", () => {
  // Wer die Arbeit geleistet hat, soll nicht leer ausgehen, weil er zufaellig
  // der Letzte war.
  const p = stand("provider_7_tage", { performances: [0,1,2,3,4,5,6].map((d) => arbeit(ICH.pk, d)) });
  const d = decidePayout(p, topf(3_000_000, 2_995_000), []);
  assert.equal(d.pay, true);
  assert.equal(d.amountMsat, 5000);
  assert.match(d.reason, /anteilig/);
});

test("Der Topf wird nie ueberschritten", () => {
  const p = stand("provider_30_tage", {
    performances: Array.from({ length: 30 }, (_, i) => arbeit(ICH.pk, i)),
  });
  let ausgegeben = 0;
  for (let i = 0; i < 20; i++) {
    const d = decidePayout(p, topf(20_000_000, ausgegeben), []);
    if (!d.pay) break;
    ausgegeben += d.amountMsat;
  }
  assert.ok(ausgegeben <= 20_000_000, `${ausgegeben} ueber dem Topf`);
});

// ------------------------------------------------------------- Obergrenze

test("Die Obergrenze je Teilnehmer ist bekannt und traegt", () => {
  // Ein System, dessen Obergrenze man nicht kennt, kann man nicht
  // verantworten — und eine, die bei ein paar hundert sats liegt, ist kein
  // Anreiz, sondern eine Beleidigung.
  const m = maxCostPerParticipant();
  assert.ok(m.sats >= 20_000, `${m.sats} sats je Teilnehmer — zu wenig zum Mitmachen`);
  assert.match(m.note, /einen Monat lang Jobs liefern/);
});

test("Ein Monat Provider ist das Schwergewicht", () => {
  // Wer dreissig Tage durchhaelt, traegt das Netz — das muss man sehen.
  const m = questById("provider_30_tage")!.rewardMsat;
  const gesamt = maxCostPerParticipant().msat;
  assert.ok(m / gesamt > 0.4, "die laengste Aufgabe muss den groessten Anteil haben");
});

// --------------------------------------------------- Speisung des Topfes

test("Topf waechst mit dem Umsatz", () => {
  const klein = questBudgetFor(5_000_000_000, { bootstrap: false });
  const gross = questBudgetFor(50_000_000_000, { bootstrap: false });
  assert.ok(gross.poolMsat > klein.poolMsat);
  assert.equal(gross.source, "umsatz");
});

test("Anschub greift, solange der Umsatz nicht traegt", () => {
  // Ein Prozentsatz von fast nichts ist fast nichts — und zwar genau dann,
  // wenn Anreize am wichtigsten sind.
  const b = questBudgetFor(0);
  assert.equal(b.source, "anschub");
  assert.equal(b.poolMsat, BOOTSTRAP_FLOOR_MSAT);
  // Es gehoert offen gesagt, dass das eine Investition ist.
  assert.match(b.note, /Entwickler-Anteil/);
  assert.match(b.note, /Befristet/);
});

test("Der Deckel greift bei einem Umsatzsprung", () => {
  // Die einzige Sicherung gegen Farmen: Ohne sie oeffnet ein Umsatzsprung —
  // oder ein Angreifer, der Umsatz mit sich selbst erzeugt — den Hahn genau
  // dann, wenn er zuschlaegt.
  const b = questBudgetFor(1_000_000_000_000);
  assert.equal(b.source, "gedeckelt");
  assert.equal(b.poolMsat, HARD_CAP_PER_EPOCH_MSAT);
  assert.match(b.note, /bleibt im Reward-Pool/);
});

test("Der Topf sagt, wie viele Teilnehmer er traegt", () => {
  // Ein Topf, der beim einundfuenfzigsten leer ist, enttaeuscht — und
  // Enttaeuschung verbreitet sich schneller als Belohnung.
  const b = questBudgetFor(0);
  assert.ok(b.fundsParticipants > 0);
  assert.equal(b.fundsParticipants, Math.floor(b.poolMsat / maxCostPerParticipant().msat));
});

test("Tragfaehigkeit nennt den noetigen Umsatz, nicht nur das Ergebnis", () => {
  // Die unbequeme Zahl gehoert auf den Tisch, BEVOR der Prozentsatz
  // festgelegt wird.
  const s = sustainability(10_000_000);
  assert.ok(s.neededForTen > 0);
  assert.match(s.note, /zahlt die Anschubfinanzierung — also ihr/);
});

test("Hoeherer Prozentsatz traegt mehr Teilnehmer", () => {
  assert.ok(sustainability(100_000_000, 80).participants > sustainability(100_000_000, 40).participants);
});

test("Nicht nachweisbare Aufgaben tragen ausdruecklich kein Geld", () => {
  // Die Trennlinie muss im Code sichtbar sein, damit niemand spaeter
  // versehentlich eine Auszahlung daran haengt.
  for (const b of BADGE_ONLY_TASKS) {
    assert.ok(!("rewardMsat" in b), `${b.id} hat einen Betrag`);
    assert.ok(b.note.length > 5);
  }
});
