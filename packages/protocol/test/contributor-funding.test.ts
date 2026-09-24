/**
 * Tests fuer die Beitragsverguetung.
 *
 * Der Schwerpunkt liegt auf dem, was Anreizsysteme kaputtmacht: sich selbst
 * etwas zuteilen, doppelt kassieren, mehr verteilen als da ist — und die
 * Frage, ob der Vorschlag die richtige Groesse gewichtet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildFundingRound, parseFundingRound, buildAllocation, verifyRound,
  suggestAllocations, buildBounty, parseBounty, openBounties,
  KIND_FUNDING_ALLOCATION,
} from "../src/contributor-funding.js";
import { Contributor } from "../src/git-contributors.js";

const NOW = 1_800_000_000;
const ADMIN = generateKeypair();
const DEV_A = generateKeypair(), DEV_B = generateKeypair(), FREMD = generateKeypair();

const runde = (pool = 1_000_000) =>
  signEvent(buildFundingRound({
    roundId: "2026-q3", fromUnix: NOW - 90 * 86400, untilUnix: NOW,
    poolMsat: pool, source: "10 % der App-Gebuehr", adminPubkey: ADMIN.pk,
  }, NOW), ADMIN.sk);

const zuteilung = (an: string, msat: number, grund = "Mesh-Transport gebaut", von = ADMIN) =>
  signEvent(buildAllocation({ roundId: "2026-q3", recipientPubkey: an, amountMsat: msat, reason: grund }, von.pk, NOW), von.sk);

const mitwirkender = (pk: string, activeDays: number, contributions = activeDays): Contributor => ({
  pubkey: pk, contributions, activeDays,
  byKind: { push: contributions, patch: 0, review: 0, issue: 0 },
  firstSeen: NOW - 86400 * activeDays, lastSeen: NOW,
});

// ------------------------------------------------------------- Runde

test("Runde: Roundtrip mit Herkunft des Geldes", () => {
  const r = parseFundingRound(runde());
  assert.equal(r.roundId, "2026-q3");
  assert.equal(r.poolMsat, 1_000_000);
  // Woher das Geld kommt, gehoert dazu — Transparenz ist hier keine Kuer.
  assert.match(r.source, /App-Gebuehr|App-Gebühr/);
});

test("Unvollstaendige Runde wird abgelehnt", () => {
  const ev = signEvent(buildEvent(ADMIN.pk, 38059, [["round", "x"]], ""), ADMIN.sk);
  assert.throws(() => parseFundingRound(ev), /unvollständig/);
});

test("Saubere Runde wird bestaetigt", () => {
  const r = verifyRound(runde(), [zuteilung(DEV_A.pk, 600_000), zuteilung(DEV_B.pk, 400_000)]);
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.distributedMsat, 1_000_000);
  assert.equal(r.remainingMsat, 0);
});

// ------------------------------------------------------------- Angriffe

test("Selbstzuteilung durch Fremde wird verworfen", () => {
  // Sonst koennte sich jeder aus dem Topf bedienen.
  const r = verifyRound(runde(), [zuteilung(FREMD.pk, 900_000, "ich fand mich gut", FREMD)]);
  assert.equal(r.ok, false);
  assert.equal(r.allocations.length, 0);
  assert.match(r.problems[0], /nicht vom Runden-Admin/);
});

test("Doppelte Zuteilung an dieselbe Person faellt auf", () => {
  const r = verifyRound(runde(), [zuteilung(DEV_A.pk, 500_000), zuteilung(DEV_A.pk, 500_000)]);
  assert.equal(r.ok, false);
  assert.equal(r.allocations.length, 1);
  assert.match(r.problems[0], /Doppelte Zuteilung/);
});

test("Mehr verteilt als im Topf faellt auf", () => {
  const r = verifyRound(runde(1_000_000), [zuteilung(DEV_A.pk, 800_000), zuteilung(DEV_B.pk, 800_000)]);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /verteilt/.test(p)));
});

test("Zuteilung ohne Begruendung wird benannt", () => {
  // Sie zaehlt trotzdem — aber wer sie fuer unfair haelt, soll das belegen
  // koennen. Das ist die eigentliche Kontrolle.
  const r = verifyRound(runde(), [zuteilung(DEV_A.pk, 100_000, "")]);
  assert.ok(r.problems.some((p) => /ohne Begründung/.test(p)));
  assert.equal(r.allocations.length, 1);
});

test("Negative oder null Betraege werden verworfen", () => {
  const r = verifyRound(runde(), [zuteilung(DEV_A.pk, 0)]);
  assert.equal(r.allocations.length, 0);
});

test("Zuteilungen fremder Runden werden ignoriert", () => {
  const andere = signEvent(buildEvent(ADMIN.pk, KIND_FUNDING_ALLOCATION, [
    ["round", "andere-runde"], ["p", DEV_A.pk], ["amount_msat", "999999"],
  ], "x"), ADMIN.sk);
  assert.equal(verifyRound(runde(), [andere]).allocations.length, 0);
});

// ------------------------------------------------------------- Vorschlag

test("Vorschlag gewichtet aktive TAGE, nicht die Anzahl der Beitraege", () => {
  // Die Zahl der Beitraege ist die Groesse, die sich am leichtesten aufblaehen
  // laesst — wer nach Commits bezahlt, bekommt Commits.
  const s = suggestAllocations({
    contributors: [
      mitwirkender(DEV_A.pk, 30, 40),   // dauerhaft dabei
      mitwirkender(DEV_B.pk, 2, 200),   // ein Nachmittag, viele Beitraege
    ],
    poolMsat: 1_000_000,
  });
  assert.equal(s.suggestions[0].pubkey, DEV_A.pk);
  assert.ok(s.suggestions[0].suggestedMsat > s.suggestions[1].suggestedMsat * 5);
});

test("Vorschlag nennt sich ausdruecklich als Vorschlag", () => {
  // Ein Automatismus wuerde genau die Optimierung zurueckbringen, die
  // rueckwirkende Runden vermeiden sollen.
  const s = suggestAllocations({ contributors: [mitwirkender(DEV_A.pk, 10)], poolMsat: 1_000_000 });
  assert.match(s.note, /ersetzt keine Bewertung/);
  assert.match(s.note, /keine Kennzahl/);
});

test("Vorschlag ueberschreitet den Topf nie", () => {
  const s = suggestAllocations({
    contributors: [mitwirkender(DEV_A.pk, 7), mitwirkender(DEV_B.pk, 3)],
    poolMsat: 100_000,
  });
  assert.ok(s.suggestions.reduce((x, y) => x + y.suggestedMsat, 0) <= 100_000);
});

test("Kleinstbetraege werden nicht vorgeschlagen", () => {
  const s = suggestAllocations({
    contributors: [mitwirkender(DEV_A.pk, 100), mitwirkender(DEV_B.pk, 1)],
    poolMsat: 100_000, minPayoutMsat: 10_000,
  });
  assert.equal(s.suggestions.length, 1);
  assert.ok(s.unallocatedMsat > 0, "der Rest bleibt fuer eine Entscheidung offen");
});

test("Ohne Mitwirkende kein Vorschlag, aber auch kein Absturz", () => {
  const s = suggestAllocations({ contributors: [], poolMsat: 100_000 });
  assert.equal(s.suggestions.length, 0);
  assert.equal(s.unallocatedMsat, 100_000);
});

// ------------------------------------------------------------- Kopfgeld

test("Kopfgeld: vorher beschrieben, Betrag zugesagt", () => {
  // Der Fall, in dem eine feste Zusage RICHTIG ist: Die Aufgabe steht vorher
  // fest, also gibt es nichts zu optimieren.
  const ev = signEvent(buildBounty({
    bountyId: "b1", title: "Namensschicht", description: "NIP-05-artige Namen",
    amountMsat: 500_000, funderPubkey: ADMIN.pk, status: "offen",
  }, NOW), ADMIN.sk);
  const b = parseBounty(ev);
  assert.equal(b.status, "offen");
  assert.equal(b.amountMsat, 500_000);
  assert.match(b.description, /NIP-05/);
});

test("Kopfgeld: neuester Stand gewinnt, damit es erledigt werden kann", () => {
  const offen = signEvent(buildBounty({
    bountyId: "b1", title: "X", description: "", amountMsat: 100, funderPubkey: ADMIN.pk, status: "offen",
  }, NOW - 1000), ADMIN.sk);
  const erledigt = signEvent(buildBounty({
    bountyId: "b1", title: "X", description: "", amountMsat: 100, funderPubkey: ADMIN.pk,
    status: "erledigt", claimedBy: DEV_A.pk,
  }, NOW), ADMIN.sk);
  assert.equal(openBounties([offen, erledigt]).length, 0);
});

test("Offene Kopfgelder: groesste zuerst", () => {
  const mk = (id: string, msat: number) => signEvent(buildBounty({
    bountyId: id, title: id, description: "", amountMsat: msat, funderPubkey: ADMIN.pk, status: "offen",
  }, NOW), ADMIN.sk);
  const liste = openBounties([mk("klein", 1000), mk("gross", 900_000)]);
  assert.equal(liste[0].bountyId, "gross");
});
