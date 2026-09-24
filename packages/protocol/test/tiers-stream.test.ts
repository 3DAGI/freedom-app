/**
 * Tests fuer Provider-Stufen und Streaming-Sessions.
 *
 * Die Stufe entscheidet, welcher Provider einen Auftrag ueberhaupt annehmen
 * darf — eine zu grosszuegige Pruefung fuehrt zu Kunden, die auf einer
 * ueberforderten Maschine warten. Die Session ist der Weg, auf dem waehrend
 * eines Jobs laufend bezahlt wird.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildCapabilities, parseCapabilities, tierSatisfies, recommendedTier,
} from "../src/tiers.js";
import {
  buildSessionOpen, parseSessionOpen, buildSessionPayment, parseSessionPayment,
} from "../src/stream.js";

const KP = generateKeypair();
const KUNDE = generateKeypair();

// ------------------------------------------------------------- Stufen

const faehigkeiten = (over: Record<string, unknown> = {}) => signEvent(buildCapabilities({
  pubkey: KP.pk, tier: "classic", models: ["qwen3.5:9b"], tools: [],
  textRatePerKTokenMsat: 1000, currentlyFree: false, ...over,
} as never), KP.sk);

test("Faehigkeiten: Roundtrip", () => {
  const c = parseCapabilities(faehigkeiten());
  assert.equal(c.tier, "classic");
  assert.ok(c.models.includes("qwen3.5:9b"));
  assert.equal(c.textRatePerKTokenMsat, 1000);
});

test("Speicherangabe wird uebertragen, wenn vorhanden", () => {
  const mit = parseCapabilities(faehigkeiten({
    storage: { capacityBytes: 1_000_000_000, priceMsatPerMB: 1, bootstrap: false },
  }));
  assert.equal(mit.storage?.capacityBytes, 1_000_000_000);
  assert.equal(mit.storage?.bootstrap, false);
});

test("Gratis-Anfragen nimmt jede Stufe an", () => {
  // Ein Gratis-Auftrag darf nicht an der Stufe scheitern — sonst bekommt ein
  // neuer Nutzer in der Anschubphase gar keine Antwort.
  for (const t of ["free", "classic", "pro"] as const) {
    assert.equal(tierSatisfies(t, "free"), true);
  }
});

test("Gratis-Kennzeichnung wird uebertragen", () => {
  // Ein Provider, der gerade gratis arbeitet, muss das ankuendigen koennen —
  // sonst waehlt ihn niemand in der Anschubphase.
  assert.equal(parseCapabilities(faehigkeiten({ currentlyFree: true })).currentlyFree, true);
  assert.equal(parseCapabilities(faehigkeiten()).currentlyFree, false);
});

test("Eine hoehere Stufe erfuellt eine niedrigere", () => {
  // Ein Spark kann alles, was ein Laptop kann — umgekehrt nicht.
  assert.equal(tierSatisfies("pro", "classic"), true);
  assert.equal(tierSatisfies("pro", "free"), true);
  assert.equal(tierSatisfies("classic", "free"), true);
});

test("Eine niedrigere Stufe erfuellt eine hoehere NICHT", () => {
  // Der teure Fehler waere andersherum: Ein Kunde wartet auf einer
  // ueberforderten Maschine, statt einen passenden Provider zu bekommen.
  assert.equal(tierSatisfies("free", "pro"), false);
  assert.equal(tierSatisfies("classic", "pro"), false);
});

test("Gleiche Stufe erfuellt sich selbst", () => {
  for (const t of ["free", "classic", "pro"] as const) {
    assert.equal(tierSatisfies(t, t), true);
  }
});

test("Die Stufe folgt aus Vertrauen und geleisteter Arbeit", () => {
  // Wichtig: Die Stufe ist KEINE Hardwareklasse, sondern eine Reputation.
  // Ein neuer Provider mit starker Hardware faengt trotzdem unten an — sonst
  // waere die Stufe mit Geld kaufbar.
  assert.equal(recommendedTier({ trustScore: 90, jobsCompleted: 100, inBootstrap: false }), "pro");
  assert.equal(recommendedTier({ trustScore: 30, jobsCompleted: 5, inBootstrap: false }), "classic");
  assert.equal(recommendedTier({ trustScore: 0, jobsCompleted: 0, inBootstrap: false }), "free");
});

test("In der Anschubphase gilt immer die unterste Stufe", () => {
  // Auch mit perfekten Werten — die Bootstrap-Phase ist eine bewusste
  // Einschraenkung, keine Momentaufnahme der Reputation.
  assert.equal(recommendedTier({ trustScore: 100, jobsCompleted: 1000, inBootstrap: true }), "free");
});

test("Beide Bedingungen zaehlen: Vertrauen ODER Erfahrung", () => {
  // Viel Arbeit ohne Vertrauen reicht fuer die mittlere Stufe, viel Vertrauen
  // ohne Arbeit auch — fuer die oberste braucht es beides.
  assert.equal(recommendedTier({ trustScore: 0, jobsCompleted: 50, inBootstrap: false }), "classic");
  assert.equal(recommendedTier({ trustScore: 90, jobsCompleted: 0, inBootstrap: false }), "classic");
});

test("Kaputte Faehigkeiten werden abgelehnt", () => {
  const ev = signEvent(buildEvent(KP.pk, 38025, [], ""), KP.sk);
  assert.throws(() => parseCapabilities(ev));
});

// ------------------------------------------------------------ Sessions

const NOW = 1_800_000_000;
const session = (over: Record<string, unknown> = {}) => signEvent(buildSessionOpen({
  sessionId: "s1", customerPubkey: KUNDE.pk, providerPubkey: KP.pk,
  maxTotalMsat: 100_000, maxRatePerKTokenMsat: 2000,
  settleEveryMsat: 20_000, ttlSecs: 3600, ...over,
} as never, NOW), KUNDE.sk);

test("Session: Roundtrip mit allen Grenzen", () => {
  const s = parseSessionOpen(session());
  assert.equal(s.sessionId, "s1");
  assert.equal(s.maxTotalMsat, 100_000);
  assert.equal(s.providerPubkey, KP.pk);
});

test("Eine Session traegt DREI Grenzen, nicht eine", () => {
  // Gesamtbudget allein reicht nicht: Ohne Ratenobergrenze koennte ein
  // Provider das Budget mit einem einzigen ueberteuerten Aufruf leeren,
  // und ohne Abrechnungsintervall erst am Ende abrechnen.
  const s = parseSessionOpen(session());
  assert.ok(s.maxTotalMsat > 0);
  assert.ok(s.maxRatePerKTokenMsat > 0);
  assert.ok(s.settleEveryMsat > 0);
});

test("Die Session laeuft ab", () => {
  // Eine unbefristete Session waere eine dauerhafte Vollmacht.
  const s = parseSessionOpen(session({ ttlSecs: 3600 }));
  assert.equal(s.expiration, NOW + 3600);
});

test("Unvollstaendige Session wird abgelehnt", () => {
  const ev = signEvent(buildEvent(KUNDE.pk, 38021, [["d", "s1"]], ""), KUNDE.sk);
  assert.throws(() => parseSessionOpen(ev), /fehlendes Tag/);
});

const zahlung = (over: Record<string, unknown> = {}) => signEvent(buildSessionPayment({
  customerPubkey: KUNDE.pk, sessionId: "s1", seq: 1,
  cumulativeMsat: 5000, unitsSinceLast: 500, ...over,
} as never, NOW), KUNDE.sk);

test("Zahlung verweist auf ihre Session", () => {
  // Ohne diesen Bezug koennte ein Provider eine fremde Zahlung fuer sich
  // verbuchen.
  const p = parseSessionPayment(zahlung());
  assert.equal(p.sessionId, "s1");
  assert.equal(p.cumulativeMsat, 5000);
});

test("Belege sind fortlaufend nummeriert — Luecken sind ein Warnzeichen", () => {
  // Der Betrag ist kumuliert, die Nummer fortlaufend. Fehlt eine Nummer,
  // fehlt ein Beleg, und der Kunde kann nachfragen, statt erst am Ende zu
  // merken, dass die Summe nicht stimmt.
  const erste = parseSessionPayment(zahlung({ seq: 1, cumulativeMsat: 5000 }));
  const dritte = parseSessionPayment(zahlung({ seq: 3, cumulativeMsat: 15_000 }));
  assert.equal(erste.seq, 1);
  assert.equal(dritte.seq, 3);
  assert.ok(dritte.cumulativeMsat > erste.cumulativeMsat, "kumuliert, nicht je Schritt");
});

test("Kaputte Zahlung wird abgelehnt", () => {
  const ev = signEvent(buildEvent(KUNDE.pk, 38022, [], ""), KUNDE.sk);
  assert.throws(() => parseSessionPayment(ev));
});
