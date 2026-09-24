/**
 * Tests fuer den Schluesselwechsel.
 *
 * Hier geht es um Identitaetsdiebstahl — den einzigen Fall, den man NUR
 * vorher loesen kann. Der Schwerpunkt liegt entsprechend auf dem Dieb: Was
 * kann er, was nicht, und was passiert, wenn niemand vorgesorgt hat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  buildRotationMandate, parseRotationMandate, buildRevocation, parseRevocation,
  resolveKey, trustEvent, rotationWarning, revocationInstructions,
  KIND_ROTATION_MANDATE,
} from "../src/key-rotation.js";

const NOW = 1_800_000_000;
const TAG = 86400;
const ALT = generateKeypair();
const NEU = generateKeypair();
const DIEB = generateKeypair();

const mandat = (von: typeof ALT, an: string, at: number) =>
  signEvent(buildRotationMandate(von.pk, an, at), von.sk);

const widerruf = (neu: typeof NEU, alt: string, grund: "gestohlen" | "planmaessig", at: number, seit?: number) =>
  signEvent(buildRevocation({
    oldPubkey: alt, newPubkey: neu.pk, reason: grund,
    compromisedSince: seit, note: "Test",
  }, at), neu.sk);

const ereignis = (kp: typeof ALT, at: number): NostrEvent =>
  signEvent(buildEvent(kp.pk, 1, [], "inhalt", at), kp.sk);

// ------------------------------------------------------------- Format

test("Mandat: Roundtrip", () => {
  const m = parseRotationMandate(mandat(ALT, NEU.pk, NOW));
  assert.equal(m.oldPubkey, ALT.pk);
  assert.equal(m.newPubkey, NEU.pk);
});

test("Ein Mandat auf sich selbst ist sinnlos", () => {
  assert.throws(() => buildRotationMandate(ALT.pk, ALT.pk), /nicht derselbe/);
});

test("Mandat ohne Nachfolger wird abgelehnt", () => {
  const ev = signEvent(buildEvent(ALT.pk, KIND_ROTATION_MANDATE, [["d", "rotation"]], ""), ALT.sk);
  assert.throws(() => parseRotationMandate(ev), /ohne Nachfolger/);
});

test("Widerruf wird vom NEUEN Schluessel signiert", () => {
  // Der alte ist moeglicherweise in fremder Hand — eine Erklaerung mit ihm zu
  // unterschreiben waere ein Widerspruch in sich.
  const r = parseRevocation(widerruf(NEU, ALT.pk, "gestohlen", NOW));
  assert.equal(r.newPubkey, NEU.pk);
  assert.equal(r.oldPubkey, ALT.pk);
});

// ------------------------------------------------------- Der Normalfall

test("Ohne Vorsorge: gueltig, aber die Warnung steht da", () => {
  // Das ist die wichtigste Meldung des Moduls — Nichtstun ist hier
  // unumkehrbar.
  const st = resolveKey(ALT.pk, []);
  assert.equal(st.status, "gueltig");
  assert.match(st.message, /nach einem Diebstahl wäre nichts mehr zu machen/);
});

test("Mit Vorsorge wird das auch gesagt", () => {
  const st = resolveKey(ALT.pk, [mandat(ALT, NEU.pk, NOW - 100 * TAG)]);
  assert.equal(st.status, "gueltig");
  assert.match(st.message, /Nachfolger ist vorbereitet/);
});

test("Nach dem Widerruf zeigt die Kette auf den neuen Schluessel", () => {
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 100 * TAG),
    widerruf(NEU, ALT.pk, "gestohlen", NOW),
  ]);
  assert.equal(st.status, "widerrufen");
  assert.equal(st.currentPubkey, NEU.pk);
});

// ------------------------------------------------------------- Der Dieb

test("DER ENTSCHEIDENDE FALL: der Dieb kann sich nicht selbst einsetzen", () => {
  // Der Dieb hat den alten Schluessel und stellt damit ein eigenes Mandat auf
  // seinen Schluessel aus. Es ist aber JUENGER als das echte — und das
  // frueheste gewinnt.
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 100 * TAG),        // echt, alt
    mandat(ALT, DIEB.pk, NOW),                   // vom Dieb, jung
    widerruf(DIEB, ALT.pk, "gestohlen", NOW + 10),
    widerruf(NEU, ALT.pk, "gestohlen", NOW + 20),
  ]);
  assert.equal(st.currentPubkey, NEU.pk, "der echte Nachfolger muss gewinnen");
});

test("Ein Widerruf ohne Mandat zaehlt nicht", () => {
  // Sonst koennte jeder jeden fuer ungueltig erklaeren.
  const st = resolveKey(ALT.pk, [widerruf(DIEB, ALT.pk, "gestohlen", NOW)]);
  assert.equal(st.status, "gueltig");
  assert.equal(st.currentPubkey, ALT.pk);
});

test("Ein Widerruf auf einen ANDEREN als den mandatierten Schluessel zaehlt nicht", () => {
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 100 * TAG),
    widerruf(DIEB, ALT.pk, "gestohlen", NOW),
  ]);
  assert.equal(st.currentPubkey, ALT.pk, "nur der mandatierte Nachfolger darf widerrufen");
});

test("Eine Ringkette wird als solche gemeldet, nicht endlos verfolgt", () => {
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 200 * TAG),
    widerruf(NEU, ALT.pk, "planmaessig", NOW - 100 * TAG),
    mandat(NEU, ALT.pk, NOW - 90 * TAG),
    widerruf(ALT, NEU.pk, "planmaessig", NOW),
  ]);
  assert.equal(st.status, "streitig");
  assert.match(st.message, /im Kreis/);
});

// --------------------------------------------- Was bleibt gueltig

test("Ereignisse VOR der Kompromittierung bleiben glaubwuerdig", () => {
  // Alles nachtraeglich fuer ungueltig zu erklaeren wuerde die gesamte
  // Vorgeschichte einer Person loeschen — auch die Belege, auf die sich
  // andere gestuetzt haben.
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 200 * TAG),
    widerruf(NEU, ALT.pk, "gestohlen", NOW, NOW - 10 * TAG),
  ]);
  const alt = trustEvent(ereignis(ALT, NOW - 50 * TAG), st);
  assert.equal(alt.trust, true);
  assert.match(alt.reason, /Vor der Kompromittierung/);
});

test("Ereignisse NACH der Kompromittierung sind unglaubwuerdig", () => {
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 200 * TAG),
    widerruf(NEU, ALT.pk, "gestohlen", NOW, NOW - 10 * TAG),
  ]);
  const neu = trustEvent(ereignis(ALT, NOW - 5 * TAG), st);
  assert.equal(neu.trust, false);
  assert.match(neu.reason, /koennte vom Dieb|könnte vom Dieb/);
});

test("Bei planmaessigem Wechsel bleibt alles gueltig", () => {
  // Ein geplanter Wechsel ist kein Vertrauensbruch — Altes einzufrieren
  // waere unnoetiger Schaden.
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 200 * TAG),
    widerruf(NEU, ALT.pk, "planmaessig", NOW),
  ]);
  assert.equal(st.status, "abgeloest");
  assert.equal(trustEvent(ereignis(ALT, NOW - TAG), st).trust, true);
});

test("Bei streitiger Kette wird nichts angenommen", () => {
  const st = resolveKey(ALT.pk, [
    mandat(ALT, NEU.pk, NOW - 200 * TAG),
    widerruf(NEU, ALT.pk, "planmaessig", NOW - 100 * TAG),
    mandat(NEU, ALT.pk, NOW - 90 * TAG),
    widerruf(ALT, NEU.pk, "planmaessig", NOW),
  ]);
  assert.equal(trustEvent(ereignis(ALT, NOW), st).trust, false);
});

// ------------------------------------------------------------- Texte

test("Die Warnung nennt die Unumkehrbarkeit", () => {
  const t = rotationWarning();
  assert.match(t, /NUR VORHER/);
  assert.match(t, /GETRENNT/);
  assert.match(t, /dauerhaft du/);
});

test("Die Anleitung nennt, was der Widerruf NICHT kann", () => {
  // Wer glaubt, ein Widerruf loesche die Ereignisse des Diebs, wiegt sich in
  // falscher Sicherheit.
  const t = revocationInstructions();
  assert.match(t, /NICHT kann/);
  assert.match(t, /bleiben auf den Relays/);
  assert.match(t, /Clients, die ihn sehen/);
});
