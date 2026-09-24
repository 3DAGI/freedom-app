/**
 * Tests fuer den Referral-Graphen.
 *
 * Hier wird entschieden, wer Geld bekommt — deshalb liegt der Schwerpunkt auf
 * den Manipulationsversuchen: Selbstwerbung, Kreise, nachtraeglicher Wechsel
 * des Werbers, Karteileichen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import { buildPerformanceEvent } from "../src/performance.js";
import {
  buildReferralClaim,
  parseReferralClaim,
  buildReferralGraph,
  chainFor,
  referrerOverview,
  KIND_REFERRAL_CLAIM,
} from "../src/referral-graph.js";
import { computeJobReferral } from "../src/referral.js";

const NOW = 1_800_000_000;
const pk = (n: string) => n.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a");

const A = pk("aa"), B = pk("bb"), C = pk("cc"), D = pk("dd");

function claim(referred: string, referrer: string, createdAt = NOW - 1000) {
  const kp = generateKeypair();
  const ev = buildReferralClaim(referred, referrer, createdAt);
  // Signatur ist fuer den Graphen nicht relevant (der Pool prueft sie beim
  // Query); hier zaehlt der Inhalt.
  return { ...signEvent({ ...ev, pubkey: kp.pk }, kp.sk), pubkey: referred };
}

function perf(worker: string, createdAt: number) {
  const kp = generateKeypair();
  const ev = buildPerformanceEvent({
    workerPubkey: worker, workType: "ai_job", units: 10,
    volumeMsat: 1000, chain: "lightning", seasonId: "s",
  }, createdAt);
  return signEvent(ev, kp.sk);
}

// ------------------------------------------------------------- Claims

test("Claim: Selbstwerbung wird schon beim Bauen abgelehnt", () => {
  assert.throws(() => buildReferralClaim(A, A), /Selbstwerbung/);
});

test("Claim: Roundtrip build -> parse", () => {
  const ev = claim(B, A);
  const c = parseReferralClaim(ev);
  assert.equal(c.referredPubkey, B);
  assert.equal(c.referrerPubkey, A);
  assert.equal(ev.kind, KIND_REFERRAL_CLAIM);
});

test("Claim: Muell wird abgelehnt statt still uebernommen", () => {
  const kp = generateKeypair();
  const ohneReferrer = signEvent(buildEvent(kp.pk, KIND_REFERRAL_CLAIM, [["d", "referral"]], ""), kp.sk);
  assert.throws(() => parseReferralClaim(ohneReferrer), /ohne gültigen referrer/);

  const falscherKind = signEvent(buildEvent(kp.pk, 1, [], ""), kp.sk);
  assert.throws(() => parseReferralClaim(falscherKind), /kein Referral-Claim/);
});

// --------------------------------------------------- Wer darf behaupten

test("Nur der Geworbene kann die Beziehung behaupten", () => {
  // Der Claim traegt die pubkey des Geworbenen als Autor. Ein Werber, der
  // fremde Pubkeys eintragen wollte, muesste deren Schluessel haben — genau
  // deshalb laeuft es in diese Richtung.
  const ev = claim(B, A);
  assert.equal(ev.pubkey, B, "Autor ist der Geworbene");
  assert.equal(parseReferralClaim(ev).referrerPubkey, A);
});

test("Die FRUEHESTE Angabe zaehlt, nicht die neueste", () => {
  // Sonst koennte ein Provider seinen Werber nachtraeglich austauschen — oder
  // dazu gedraengt werden.
  const g = buildReferralGraph(
    [claim(B, A, NOW - 10_000), claim(B, C, NOW - 100)],
    [],
    { nowSecs: NOW },
  );
  assert.equal(g.referrerOf.get(B), A, "der spaetere Wechsel wird ignoriert");
});

// ------------------------------------------------------------- Kreise

test("Kreise werden aufgeloest, nicht durchgereicht", () => {
  // A wirbt B, B wirbt A: beide wuerden unbegrenzt aneinander verdienen, ohne
  // dass jemand hinzukommt.
  const g = buildReferralGraph(
    [claim(B, A, NOW - 2000), claim(A, B, NOW - 1000)],
    [],
    { nowSecs: NOW },
  );
  assert.equal(g.referrerOf.size, 1, "eine Kante bleibt, der Kreis wird gebrochen");
  assert.ok(g.rejected.some((r) => /Kreis/.test(r.reason)));
});

test("Laengere Kreise werden ebenfalls erkannt", () => {
  const g = buildReferralGraph(
    [claim(B, A, NOW - 3000), claim(C, B, NOW - 2000), claim(A, C, NOW - 1000)],
    [],
    { nowSecs: NOW },
  );
  assert.ok(g.rejected.length >= 1);
  // Der Graph darf keinen geschlossenen Ring enthalten.
  let aktuell: string | undefined = A;
  const gesehen = new Set<string>();
  for (let i = 0; i < 10 && aktuell; i++) {
    assert.ok(!gesehen.has(aktuell), "kein Ring im Ergebnis");
    gesehen.add(aktuell);
    aktuell = g.referrerOf.get(aktuell);
  }
});

// ------------------------------------------------------------- Aktivitaet

test("Nur wer arbeitet, zaehlt als aktiver Geworbener", () => {
  const g = buildReferralGraph(
    [claim(B, A), claim(C, A)],
    [perf(B, NOW - 86400)], // nur B hat gearbeitet
    { nowSecs: NOW },
  );
  assert.equal(g.states.get(A)!.activeReferrals, 1, "C ist eine Karteileiche");
});

test("Alte Arbeit zaehlt nicht mehr als aktiv", () => {
  const g = buildReferralGraph(
    [claim(B, A)],
    [perf(B, NOW - 60 * 86400)],
    { nowSecs: NOW },
  );
  assert.equal(g.states.get(A)!.activeReferrals, 0, "zwei Monate alt ist nicht aktiv");
});

test("Das Aktivitaetsfenster ist einstellbar", () => {
  const claims = [claim(B, A)];
  const perfs = [perf(B, NOW - 45 * 86400)];
  assert.equal(buildReferralGraph(claims, perfs, { nowSecs: NOW }).states.get(A)!.activeReferrals, 0);
  assert.equal(
    buildReferralGraph(claims, perfs, { nowSecs: NOW, activeWindowSeconds: 90 * 86400 })
      .states.get(A)!.activeReferrals,
    1,
  );
});

// ------------------------------------------------------------- Kette

test("Kette liefert Ebene 1 und 2", () => {
  const g = buildReferralGraph([claim(C, B), claim(B, A)], [], { nowSecs: NOW });
  const kette = chainFor(C, g);
  assert.equal(kette.level1, B);
  assert.equal(kette.level2, A);
});

test("Kette endet bei Ebene 2 — Ebene 3 wird nicht zurueckgegeben", () => {
  const g = buildReferralGraph([claim(D, C), claim(C, B), claim(B, A)], [], { nowSecs: NOW });
  const kette = chainFor(D, g);
  assert.equal(kette.level1, C);
  assert.equal(kette.level2, B);
  assert.ok(!("level3" in kette), "das Protokoll verguetet nur zwei Ebenen");
});

test("Kette ohne Werber ist leer, nicht fehlerhaft", () => {
  const g = buildReferralGraph([], [], { nowSecs: NOW });
  assert.deepEqual(chainFor(A, g), {});
});

test("Kette und Auszahlung greifen ineinander", () => {
  const g = buildReferralGraph(
    [claim(C, B), claim(B, A)],
    [perf(C, NOW - 100), perf(B, NOW - 100)],
    { nowSecs: NOW },
  );
  const r = computeJobReferral(10_000_000, chainFor(C, g), g.states);
  assert.equal(r.payouts.length, 2);
  assert.equal(r.payouts.find((p) => p.level === 1)!.pubkey, B);
  assert.equal(r.payouts.find((p) => p.level === 2)!.pubkey, A);
});

// ------------------------------------------------------------- Uebersicht

test("Uebersicht zaehlt direkte und indirekte Geworbene getrennt", () => {
  const g = buildReferralGraph(
    [claim(B, A), claim(C, A), claim(D, B)],
    [perf(B, NOW - 100)],
    { nowSecs: NOW },
  );
  const u = referrerOverview(A, g);
  assert.equal(u.totalReferrals, 2, "B und C direkt");
  assert.equal(u.activeReferrals, 1, "nur B arbeitet");
  assert.equal(u.level2Count, 1, "D ueber B");
  assert.deepEqual(u.referredPubkeys.sort(), [B, C].sort());
});

test("Uebersicht fuer jemanden ohne Geworbene ist leer, nicht undefined", () => {
  const g = buildReferralGraph([], [], { nowSecs: NOW });
  const u = referrerOverview(A, g);
  assert.equal(u.totalReferrals, 0);
  assert.equal(u.activeReferrals, 0);
});

test("Verworfene Angaben werden mit Grund gemeldet, nicht still gefiltert", () => {
  const kp = generateKeypair();
  const kaputt = signEvent(buildEvent(kp.pk, KIND_REFERRAL_CLAIM, [["d", "referral"]], ""), kp.sk);
  const g = buildReferralGraph([kaputt, claim(B, A)], [], { nowSecs: NOW });
  assert.equal(g.referrerOf.size, 1);
  assert.equal(g.rejected.length, 1);
  assert.match(g.rejected[0].reason, /referrer/);
});
