/**
 * Tests fuer den Spam- und Flutschutz.
 *
 * Die entscheidende Eigenschaft ist nicht, dass Spam abgewehrt wird, sondern
 * dass dabei NICHTS VERLOREN geht. Fuer jemanden, der Hinweise von
 * Unbekannten bekommt — ein Teil der Zielgruppe —, waere ein loeschender
 * Filter das Gegenteil von hilfreich.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  difficulty, powRequired, checkPow, sortIncoming,
  RateLimiter, spamFilterInfo,
} from "../src/antispam.js";

const NOW = 1_800_000_000;
const FREUND = generateKeypair();
const FREMD = generateKeypair();
const VERTRAUT = new Set([FREUND.pk]);

/** Ereignis mit vorgegebener Kennung — fuer Schwierigkeitstests. */
const mitId = (id: string): NostrEvent => ({
  id, kind: 4, pubkey: FREMD.pk, created_at: NOW, tags: [], content: "", sig: "0".repeat(128),
});

const echt = (kp: typeof FREUND) => signEvent(buildEvent(kp.pk, 4, [], "hallo", NOW), kp.sk);

// ------------------------------------------------------- Schwierigkeit

test("Fuehrende Nullen werden korrekt gezaehlt", () => {
  assert.equal(difficulty("f" + "0".repeat(63)), 0);
  assert.equal(difficulty("8" + "0".repeat(63)), 0);
  assert.equal(difficulty("1" + "0".repeat(63)), 3);
  assert.equal(difficulty("0" + "f".repeat(63)), 4);
  assert.equal(difficulty("00" + "8" + "0".repeat(61)), 8);
  assert.equal(difficulty("000" + "1" + "0".repeat(60)), 15);
});

test("Eine Kennung aus lauter Nullen ist maximal schwer", () => {
  assert.equal(difficulty("0".repeat(64)), 256);
});

// ------------------------------------------------------- Staffelung

test("Bekannte brauchen KEINEN Nachweis", () => {
  // Eine Huerde fuer Freunde waere reine Schikane.
  const r = powRequired({ known: true });
  assert.equal(r.bits, 0);
});

test("Fremde brauchen einen spuerbaren, aber kleinen Nachweis", () => {
  // Fuer einen Menschen unmerklich, fuer zehntausend Nachrichten Stunden.
  const r = powRequired({ known: false, recentFromSender: 0 });
  assert.ok(r.bits >= 16 && r.bits <= 22, `${r.bits} Bit`);
  assert.ok(r.approxSeconds <= 2);
});

test("Wiederholung wird teurer", () => {
  // Die Staffelung ist der eigentliche Entwurf: Massenversand wird
  // unbezahlbar, Einzelnachrichten nicht.
  const erste = powRequired({ known: false, recentFromSender: 0 });
  const zehnte = powRequired({ known: false, recentFromSender: 10 });
  assert.ok(zehnte.bits > erste.bits);
  assert.ok(zehnte.approxSeconds > erste.approxSeconds * 10);
});

test("Die Kosten wachsen nicht ins Unendliche", () => {
  // Sonst waere ein Absender nach genug Nachrichten dauerhaft gesperrt — und
  // das waere eine Sperre mit anderem Namen.
  const viel = powRequired({ known: false, recentFromSender: 1000 });
  assert.ok(viel.bits <= 30, `${viel.bits} Bit waere eine Dauersperre`);
});

test("Nachweispruefung meldet Ist und Soll", () => {
  const r = checkPow(mitId("0".repeat(8) + "f".repeat(56)), powRequired({ known: false }));
  assert.equal(r.ok, true);
  assert.equal(r.actual, 32);

  const schwach = checkPow(mitId("f".repeat(64)), powRequired({ known: false }));
  assert.equal(schwach.ok, false);
  // Die Meldung nennt den Verbleib — der Nutzer soll wissen, dass nichts weg ist.
  assert.match(schwach.message, /nicht im Papierkorb/);
});

// ------------------------------------------------------- Posteingaenge

test("Bekannte landen im Hauptposteingang", () => {
  const r = sortIncoming(echt(FREUND), { trusted: VERTRAUT });
  assert.equal(r.inbox, "haupt");
});

test("Unbekannte landen im ZWEITEN Posteingang, nie im Papierkorb", () => {
  // Der wesentliche Unterschied zu einem Spamfilter.
  const r = sortIncoming(echt(FREMD), { trusted: VERTRAUT });
  assert.equal(r.inbox, "zweit");
  assert.notEqual(r.inbox, "verworfen");
});

test("Auch ohne jeden Nachweis geht nichts verloren", () => {
  const r = sortIncoming(mitId("f".repeat(64)), { trusted: VERTRAUT });
  assert.equal(r.inbox, "zweit");
});

test("Ein Nachweis wird in der Begruendung gewuerdigt", () => {
  const r = sortIncoming(mitId("0".repeat(8) + "a".repeat(56)), { trusted: VERTRAUT });
  assert.match(r.reason, /mit Rechennachweis/);
});

test("Der Filter ist abschaltbar", () => {
  // Ein Spamfilter, den man nicht umgehen kann, ist eine Zensur mit anderem
  // Namen.
  const r = sortIncoming(echt(FREMD), { trusted: VERTRAUT, disabled: true });
  assert.equal(r.inbox, "haupt");
  assert.match(r.reason, /abgeschaltet/);
});

test("Die Auskunft erklaert den zweiten Posteingang", () => {
  const t = spamFilterInfo(5);
  assert.match(t, /nicht gelöscht/);
  assert.match(t, /abschaltbar/);
  assert.match(t, /gilt er als bekannt/);
});

// ------------------------------------------------------- Ratenbegrenzung

const limiter = () => new RateLimiter({ maxPerWindow: 3, windowSecs: 60, paidMultiplier: 10 });

test("Bis zur Grenze geht alles durch", () => {
  const l = limiter();
  for (let i = 0; i < 3; i++) {
    assert.equal(l.check(FREMD.pk, false, NOW).allowed, true, `Anfrage ${i + 1}`);
  }
});

test("Darueber wird abgelehnt — mit Zeitangabe", () => {
  const l = limiter();
  for (let i = 0; i < 3; i++) l.check(FREMD.pk, false, NOW);
  const r = l.check(FREMD.pk, false, NOW);
  assert.equal(r.allowed, false);
  assert.ok(r.resetIn > 0);
  // Der Ausweg gehoert in die Meldung.
  assert.match(r.message, /bezahlte Anfragen gehen weiter/);
});

test("Wer zahlt, ist kein Angreifer", () => {
  const l = limiter();
  for (let i = 0; i < 25; i++) {
    assert.equal(l.check(FREMD.pk, true, NOW).allowed, true, `bezahlt ${i + 1}`);
  }
});

test("Auch bezahlte Anfragen sind nicht unbegrenzt", () => {
  const l = limiter();
  for (let i = 0; i < 30; i++) l.check(FREMD.pk, true, NOW);
  assert.equal(l.check(FREMD.pk, true, NOW).allowed, false);
});

test("Das Fenster gleitet", () => {
  const l = limiter();
  for (let i = 0; i < 3; i++) l.check(FREMD.pk, false, NOW);
  assert.equal(l.check(FREMD.pk, false, NOW).allowed, false);
  assert.equal(l.check(FREMD.pk, false, NOW + 61).allowed, true, "nach dem Fenster wieder frei");
});

test("Absender werden getrennt gezaehlt", () => {
  // Sonst sperrt ein Angreifer alle anderen mit.
  const l = limiter();
  for (let i = 0; i < 3; i++) l.check(FREMD.pk, false, NOW);
  assert.equal(l.check(FREUND.pk, false, NOW).allowed, true);
});

test("Alte Eintraege werden aufgeraeumt", () => {
  // Ohne das waechst die Karte unbegrenzt — und ein Angreifer mit vielen
  // Wegwerf-Schluesseln fuellt den Speicher des Providers.
  const l = limiter();
  for (let i = 0; i < 100; i++) l.check(`pk${i}`, false, NOW);
  assert.equal(l.trackedSenders, 100);
  assert.equal(l.prune(NOW + 120), 100);
  assert.equal(l.trackedSenders, 0);
});
