/**
 * Tests fuer die Mitwirkenden-Ansicht.
 *
 * Der Zweck ist, die Frage zu beantworten, die man bei einem fremden Projekt
 * zuerst stellt: Lebt das noch, und haengt es an einer Person? Beide Antworten
 * duerfen nicht schoenfaerben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildContribution, parseContribution, buildRepoOverview,
  busFactor, contributorProfile, KIND_GIT_CONTRIBUTION,
} from "../src/git-contributors.js";

const NOW = 1_800_000_000;
const TAG = 86400;
const REPO = "freedomstack";
const A = generateKeypair(), B = generateKeypair(), C = generateKeypair();

function beitrag(kp: typeof A, at: number, kind: "push" | "patch" | "review" | "issue" = "push", repo = REPO) {
  return signEvent(
    buildContribution({ repoId: repo, authorPubkey: kp.pk, kind, summary: "Arbeit", ref: `r${at}` }, at),
    kp.sk,
  );
}

test("Beitrag: Roundtrip", () => {
  const ev = signEvent(buildContribution({
    repoId: REPO, authorPubkey: A.pk, kind: "patch", summary: "Fix", ref: "abc",
    linesAdded: 12, linesRemoved: 3,
  }, NOW), A.sk);
  const c = parseContribution(ev);
  assert.equal(ev.kind, KIND_GIT_CONTRIBUTION);
  assert.equal(c.kind, "patch");
  assert.equal(c.linesAdded, 12);
  assert.equal(c.linesRemoved, 3);
});

test("Beitrag ohne Repo wird abgelehnt", () => {
  const ev = signEvent(buildEvent(A.pk, KIND_GIT_CONTRIBUTION, [["type", "push"]], ""), A.sk);
  assert.throws(() => parseContribution(ev), /ohne Repo/);
});

test("Aktive TAGE zaehlen, nicht die blosse Anzahl", () => {
  // Wer an dreissig Tagen etwas beitraegt, ist ein anderer Mitwirkender als
  // jemand mit dreissig Beitraegen an einem Nachmittag.
  const dauerhaft = [0, 1, 2, 3, 4].map((d) => beitrag(A, NOW - d * TAG));
  const stossweise = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => beitrag(B, NOW - h * 600));

  const o = buildRepoOverview(REPO, [...dauerhaft, ...stossweise], NOW);
  assert.equal(o.contributors[0].pubkey, A.pk, "Dauerhaftigkeit vor Menge");
  assert.equal(o.contributors[0].activeDays, 5);
  assert.equal(o.contributors[1].activeDays, 1);
  assert.ok(o.contributors[1].contributions > o.contributors[0].contributions);
});

test("Beitragsarten werden getrennt gezaehlt", () => {
  const o = buildRepoOverview(REPO, [
    beitrag(A, NOW, "push"), beitrag(A, NOW - TAG, "review"), beitrag(A, NOW - 2 * TAG, "issue"),
  ], NOW);
  assert.equal(o.contributors[0].byKind.push, 1);
  assert.equal(o.contributors[0].byKind.review, 1);
  assert.equal(o.contributors[0].byKind.issue, 1);
});

test("Fremde Repos werden nicht mitgezaehlt", () => {
  const o = buildRepoOverview(REPO, [beitrag(A, NOW), beitrag(B, NOW, "push", "anderes-repo")], NOW);
  assert.equal(o.contributors.length, 1);
});

// ------------------------------------------------------------- Zustand

test("Zustand: aktiv, ruhig, verwaist — ohne Beschoenigung", () => {
  assert.equal(buildRepoOverview(REPO, [beitrag(A, NOW - 5 * TAG)], NOW).health, "aktiv");
  assert.equal(buildRepoOverview(REPO, [beitrag(A, NOW - 90 * TAG)], NOW).health, "ruhig");

  const tot = buildRepoOverview(REPO, [beitrag(A, NOW - 400 * TAG)], NOW);
  assert.equal(tot.health, "verwaist");
  // Wer hier mitarbeiten will, soll es vorher wissen.
  assert.match(tot.healthNote, /keiner Antwort rechnen/);
});

test("Ohne Beitraege wird nicht behauptet, es gaebe das Repo nicht", () => {
  const o = buildRepoOverview(REPO, [], NOW);
  assert.equal(o.health, "unbekannt");
  assert.match(o.healthNote, /kann trotzdem existieren/);
});

test("Verlauf deckt die letzten Wochen ab, nicht alles", () => {
  const o = buildRepoOverview(REPO, [
    beitrag(A, NOW - 5 * TAG), beitrag(A, NOW - 5 * TAG), beitrag(A, NOW - 200 * TAG),
  ], NOW);
  assert.equal(o.timeline.length, 1, "Alter faellt aus dem Verlauf");
  assert.equal(o.timeline[0].count, 2);
});

// ------------------------------------------------------------- Bus-Faktor

test("Bus-Faktor benennt die Ein-Personen-Abhaengigkeit", () => {
  // Auf einer Plattform sieht man das nicht auf den ersten Blick; hier kann
  // man es ausrechnen — und es entscheidet, ob man sich darauf verlaesst.
  const allein = buildRepoOverview(REPO, [0, 1, 2].map((d) => beitrag(A, NOW - d * TAG)), NOW);
  const bf = busFactor(allein.contributors);
  assert.equal(bf.count, 1);
  assert.match(bf.note, /Faellt sie aus|Fällt sie aus/);
});

test("Bus-Faktor erkennt verteilte Arbeit", () => {
  const events = [];
  for (const kp of [A, B, C]) for (let d = 0; d < 5; d++) events.push(beitrag(kp, NOW - d * TAG));
  const bf = busFactor(buildRepoOverview(REPO, events, NOW).contributors);
  assert.ok(bf.count >= 2, `Bus-Faktor ${bf.count}`);
  assert.match(bf.note, /tragen zusammen die Hälfte/);
});

test("Bus-Faktor: dominante Person trotz weiterer Mitwirkender", () => {
  const events = [];
  for (let d = 0; d < 20; d++) events.push(beitrag(A, NOW - d * TAG));
  events.push(beitrag(B, NOW));
  const bf = busFactor(buildRepoOverview(REPO, events, NOW).contributors);
  assert.equal(bf.count, 1);
  assert.match(bf.note, /mehr als die Hälfte/);
});

test("Bus-Faktor bei leerem Repo stuerzt nicht ab", () => {
  assert.equal(busFactor([]).count, 0);
});

// ------------------------------------------------------------- Profil

test("Profil fasst alle Repos einer Person zusammen", () => {
  const events = [beitrag(A, NOW), beitrag(A, NOW - TAG, "push", "zweites-repo"), beitrag(B, NOW)];
  const p = contributorProfile(A.pk, events);
  assert.equal(p.total, 2);
  assert.deepEqual(p.repos.sort(), ["freedomstack", "zweites-repo"]);
  assert.equal(p.lastSeen, NOW);
});

test("Profil einer unbekannten Person ist leer, nicht fehlerhaft", () => {
  const p = contributorProfile(C.pk, [beitrag(A, NOW)]);
  assert.equal(p.total, 0);
  assert.equal(p.firstSeen, undefined);
});
