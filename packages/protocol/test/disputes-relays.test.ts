/**
 * Tests fuer Streitfall und Relay-Verguetung.
 *
 * Beim Streitfall geht es um Geld, das schon geflossen ist — der Schwerpunkt
 * liegt darauf, dass keine Partei ueber sich selbst urteilt und dass eine
 * Reklamation kein Gratis-Job wird. Bei den Relays darauf, dass sich
 * Reichweite nicht faelschen laesst.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  buildDispute, parseDispute, buildResolution, resolveDispute,
  disputeWindowOpen, disputeInfo, DISPUTE_WINDOW_SECS,
  buildRelayProof, parseRelayProof, distributeToRelays, relayEconomicsInfo,
  RELAY_SHARE_PERCENT, KIND_JOB_DISPUTE, Resolution,
} from "../src/disputes-relays.js";

const NOW = 1_800_000_000;
const KUNDE = generateKeypair();
const PROVIDER = generateKeypair();
const PRUEFER_A = generateKeypair(), PRUEFER_B = generateKeypair(), PRUEFER_C = generateKeypair();

const reklamation = (grund: Parameters<typeof buildDispute>[0]["reason"] = "unbrauchbar") =>
  parseDispute(signEvent(buildDispute({
    jobId: "job-1", customerPubkey: KUNDE.pk, providerPubkey: PROVIDER.pk,
    reason: grund, amountMsat: 100_000, note: "Test",
  }, NOW), KUNDE.sk));

const urteil = (von: typeof PRUEFER_A, res: Resolution, at = NOW + 60) =>
  signEvent(buildResolution({
    jobId: "job-1", reviewerPubkey: von.pk, resolution: res,
    refundMsat: res === "erstattet" ? 100_000 : 0, note: "geprüft",
  }, at), von.sk);

// ------------------------------------------------------------ Streitfall

test("Reklamation: Roundtrip", () => {
  const d = reklamation("falsches_modell");
  assert.equal(d.jobId, "job-1");
  assert.equal(d.reason, "falsches_modell");
  assert.equal(d.amountMsat, 100_000);
});

test("Unvollstaendige Reklamation wird abgelehnt", () => {
  const ev = signEvent(buildEvent(KUNDE.pk, KIND_JOB_DISPUTE, [["e", "job-1"]], ""), KUNDE.sk);
  assert.throws(() => parseDispute(ev), /unvollständig/);
});

test("Gar keine Antwort braucht keine Nachpruefung", () => {
  // Entweder liegt ein Ergebnis vor oder nicht — das ist nachsehbar.
  const v = resolveDispute(reklamation("nichts_geliefert"), false, []);
  assert.equal(v.resolution, "erstattet");
  assert.equal(v.refundMsat, 100_000);
  assert.match(v.message, /ohne Nachprüfung/);
});

test("OHNE Pruefer bleibt die Zahlung beim Provider", () => {
  // Im Zweifel gegen den Reklamierenden — sonst waere jede Reklamation ein
  // kostenloser Auftrag, und das Verfahren waere selbst der Angriff.
  const v = resolveDispute(reklamation(), true, []);
  assert.equal(v.resolution, "unentschieden");
  assert.equal(v.refundMsat, 0);
  assert.match(v.message, /kostenloser Auftrag/);
});

test("Der beschuldigte Provider darf nicht ueber sich selbst urteilen", () => {
  const v = resolveDispute(reklamation(), true, [
    signEvent(buildResolution({
      jobId: "job-1", reviewerPubkey: PROVIDER.pk, resolution: "bestaetigt",
      refundMsat: 0, note: "war gut",
    }, NOW + 60), PROVIDER.sk),
  ]);
  assert.equal(v.resolution, "unentschieden", "sein Urteil darf nicht zaehlen");
});

test("Der Kunde darf es auch nicht", () => {
  const v = resolveDispute(reklamation(), true, [
    signEvent(buildResolution({
      jobId: "job-1", reviewerPubkey: KUNDE.pk, resolution: "erstattet",
      refundMsat: 100_000, note: "war schlecht",
    }, NOW + 60), KUNDE.sk),
  ]);
  assert.equal(v.resolution, "unentschieden");
});

test("Mehrheit fuer den Kunden erstattet voll", () => {
  const v = resolveDispute(reklamation(), true, [
    urteil(PRUEFER_A, "erstattet"), urteil(PRUEFER_B, "erstattet"), urteil(PRUEFER_C, "bestaetigt"),
  ]);
  assert.equal(v.resolution, "erstattet");
  assert.equal(v.refundMsat, 100_000);
});

test("Mehrheit fuer den Provider bestaetigt", () => {
  const v = resolveDispute(reklamation(), true, [
    urteil(PRUEFER_A, "bestaetigt"), urteil(PRUEFER_B, "bestaetigt"), urteil(PRUEFER_C, "erstattet"),
  ]);
  assert.equal(v.resolution, "bestaetigt");
  assert.equal(v.refundMsat, 0);
});

test("Bei Gleichstand wird geteilt, nicht gewuerfelt", () => {
  // Bei kreativen Aufgaben gibt es kein "richtig" — ein Muenzwurf waere
  // schlechter als ein Kompromiss.
  const v = resolveDispute(reklamation(), true, [
    urteil(PRUEFER_A, "erstattet"), urteil(PRUEFER_B, "bestaetigt"),
  ]);
  assert.equal(v.resolution, "geteilt");
  assert.equal(v.refundMsat, 50_000);
});

test("Nur zugelassene Pruefer zaehlen", () => {
  // Sonst stellt ein Kunde zehn Wegwerf-Schluessel auf und erstattet sich
  // selbst.
  const v = resolveDispute(reklamation(), true, [urteil(PRUEFER_A, "erstattet")], {
    eligibleReviewers: new Set([PRUEFER_B.pk]),
  });
  assert.equal(v.resolution, "unentschieden");
});

test("Urteile zu fremden Jobs zaehlen nicht", () => {
  const fremd = signEvent(buildResolution({
    jobId: "anderer-job", reviewerPubkey: PRUEFER_A.pk, resolution: "erstattet",
    refundMsat: 999, note: "",
  }, NOW), PRUEFER_A.sk);
  assert.equal(resolveDispute(reklamation(), true, [fremd]).resolution, "unentschieden");
});

test("Die Frist ist kurz und laeuft ab", () => {
  // Eine lange Frist bindet die Einnahmen des Providers und macht ihn
  // erpressbar.
  assert.equal(disputeWindowOpen(NOW, NOW + 60).open, true);
  assert.equal(disputeWindowOpen(NOW, NOW + DISPUTE_WINDOW_SECS + 1).open, false);
  assert.ok(DISPUTE_WINDOW_SECS <= 7200, "laenger waere erpressbar");
});

test("Die Auskunft nennt, was das Verfahren NICHT kann", () => {
  // "Die Antwort gefaellt mir nicht" ist kein Reklamationsgrund, und das
  // gehoert in die Beschreibung statt in die Enttaeuschung des ersten Nutzers.
  const t = disputeInfo();
  assert.match(t, /NICHT abfängt/);
  assert.match(t, /gefällt mir nicht/);
  assert.match(t, /kein Richtig/);
});

// ------------------------------------------------------------- Relays

const nachweis = (kp: typeof PRUEFER_A, clients: number, delivered = clients * 100, at = NOW) =>
  signEvent(buildRelayProof({
    relayPubkey: kp.pk, fromUnix: at - 604800, untilUnix: at,
    delivered, uniqueClients: clients, url: `wss://relay-${clients}.example`,
  }, at), kp.sk);

test("Relay-Nachweis: Roundtrip", () => {
  const p = parseRelayProof(nachweis(PRUEFER_A, 50));
  assert.equal(p.uniqueClients, 50);
  assert.match(p.url, /^wss:/);
});

test("Relays bekommen einen Anteil am Pool", () => {
  // Bisher bekamen sie nichts — derselbe Fehler, den das Projekt bei
  // Providern vermieden hat, eine Ebene tiefer.
  const r = distributeToRelays(10_000_000, [nachweis(PRUEFER_A, 100)]);
  assert.equal(r.payouts.length, 1);
  assert.ok(r.payouts[0].amountMsat > 0);
  assert.ok(RELAY_SHARE_PERCENT > 0 && RELAY_SHARE_PERCENT <= 25);
});

test("Gewichtet nach CLIENTS, nicht nach Ereignissen", () => {
  // Ereignisse kann ein Relay selbst erzeugen; Clients sind Schluessel, die
  // jemand benutzen muss.
  const r = distributeToRelays(10_000_000, [
    nachweis(PRUEFER_A, 10, 1_000_000),  // wenige Clients, viele Ereignisse
    nachweis(PRUEFER_B, 100, 1000),      // viele Clients, wenige Ereignisse
  ]);
  const a = r.payouts.find((x) => x.relayPubkey === PRUEFER_A.pk)!;
  const b = r.payouts.find((x) => x.relayPubkey === PRUEFER_B.pk)!;
  assert.ok(b.amountMsat > a.amountMsat, "Reichweite zaehlt, nicht Volumen");
});

test("Die Daempfung verhindert, dass der Groesste alles nimmt", () => {
  // Hundertfache Reichweite bringt das Zehnfache, nicht das Hundertfache.
  const r = distributeToRelays(100_000_000, [
    nachweis(PRUEFER_A, 10_000), nachweis(PRUEFER_B, 100),
  ]);
  const gross = r.payouts.find((x) => x.relayPubkey === PRUEFER_A.pk)!;
  const klein = r.payouts.find((x) => x.relayPubkey === PRUEFER_B.pk)!;
  const faktor = gross.amountMsat / klein.amountMsat;
  assert.ok(faktor > 5 && faktor < 20, `Faktor ${faktor.toFixed(1)} statt 100`);
});

test("Nur erreichbare Relays werden verguetet", () => {
  // Ein Nachweis ist eine Behauptung; die Erreichbarkeit laesst sich nachsehen.
  const r = distributeToRelays(10_000_000, [
    nachweis(PRUEFER_A, 100), nachweis(PRUEFER_B, 100),
  ], { reachable: new Set([PRUEFER_A.pk]) });
  assert.equal(r.payouts.length, 1);
  assert.equal(r.payouts[0].relayPubkey, PRUEFER_A.pk);
});

test("Ein Relay ohne Clients bekommt nichts", () => {
  const r = distributeToRelays(10_000_000, [nachweis(PRUEFER_A, 0, 999_999)]);
  assert.equal(r.payouts.length, 0);
});

test("Der neueste Nachweis je Relay gilt", () => {
  const r = distributeToRelays(10_000_000, [
    nachweis(PRUEFER_A, 10, 1000, NOW - 100_000),
    nachweis(PRUEFER_A, 200, 20_000, NOW),
  ]);
  assert.equal(r.payouts.length, 1);
  assert.match(r.payouts[0].basis, /200 verschiedene Clients/);
});

test("Der Anteil wird nie ueberschritten", () => {
  const pool = 10_000_000;
  const r = distributeToRelays(pool, [
    nachweis(PRUEFER_A, 100), nachweis(PRUEFER_B, 50), nachweis(PRUEFER_C, 25),
  ]);
  const verteilt = r.payouts.reduce((s, x) => s + x.amountMsat, 0);
  assert.ok(verteilt <= (pool * RELAY_SHARE_PERCENT) / 100);
});

test("Ohne Nachweise bleibt der Anteil liegen", () => {
  const r = distributeToRelays(10_000_000, []);
  assert.equal(r.payouts.length, 0);
  assert.ok(r.unallocatedMsat > 0);
});

test("Die Auskunft begruendet die Daempfung", () => {
  const t = relayEconomicsInfo();
  assert.match(t, /nicht das Hundertfache/);
  assert.match(t, /Zentralisierung/);
  assert.match(t, /Nur erreichbare/);
});
