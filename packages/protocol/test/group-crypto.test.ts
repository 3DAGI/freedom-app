/**
 * Tests fuer verschluesselte Kanaele.
 *
 * Der Schwerpunkt liegt auf dem Schluesselwechsel — dem Teil, der den Aufwand
 * ausmacht und an dem solche Systeme scheitern. Und darauf, dass die drei
 * Grenzen ehrlich benannt sind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  generateEpochKey, epochKeyId, buildEpochKeyGrant, parseEpochKeyGrant,
  openEpochKey, buildKeyring, buildEncryptedMessage, decryptChannelMessage,
  planRotation, encryptionInfo, KIND_EPOCH_KEY,
} from "../src/group-crypto.js";

const NOW = 1_800_000_000;
const KANAL = "kanal-1";
const GRUENDER = generateKeypair();
const ALICE = generateKeypair(), BOB = generateKeypair(), MALLORY = generateKeypair();

const zuteilung = async (epoch: number, key: Uint8Array, an: typeof ALICE, von = GRUENDER) =>
  signEvent(await buildEpochKeyGrant(KANAL, epoch, key, von.sk, von.pk, an.pk, NOW), von.sk);

// ------------------------------------------------------------- Grundlage

test("Epochenschluessel sind zufaellig und 32 Byte", () => {
  const a = generateEpochKey(), b = generateEpochKey();
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
});

test("Die Kennung verraet den Schluessel nicht", () => {
  const k = generateEpochKey();
  const id = epochKeyId(k);
  assert.equal(id.length, 16);
  assert.notEqual(id, Buffer.from(k).toString("hex").slice(0, 16));
});

test("Zuteilung: Roundtrip", async () => {
  const k = generateEpochKey();
  const g = parseEpochKeyGrant(await zuteilung(0, k, ALICE));
  assert.equal(g.channelId, KANAL);
  assert.equal(g.epoch, 0);
  assert.equal(g.memberPubkey, ALICE.pk);
});

test("Das Mitglied kann seinen Schluessel auspacken", async () => {
  const k = generateEpochKey();
  const r = await openEpochKey(await zuteilung(0, k, ALICE), ALICE.sk);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.key, k);
});

test("Ein Fremder kann es nicht", async () => {
  const k = generateEpochKey();
  const r = await openEpochKey(await zuteilung(0, k, ALICE), MALLORY.sk);
  assert.equal(r.ok, false);
  assert.equal(r.key, undefined);
});

test("Ein untergeschobener Schluessel faellt an der Kennung auf", async () => {
  // Der Verteiler koennte einer Person einen ANDEREN Schluessel geben als
  // dem Rest — und damit ihre Nachrichten aussortieren. Die angekuendigte
  // Kennung deckt das auf.
  const echt = generateEpochKey(), falsch = generateEpochKey();
  const ev = signEvent(await buildEpochKeyGrant(KANAL, 0, falsch, GRUENDER.sk, GRUENDER.pk, ALICE.pk, NOW), GRUENDER.sk);
  const manipuliert = {
    ...ev,
    tags: ev.tags.map((t) => (t[0] === "key_id" ? ["key_id", epochKeyId(echt)] : t)),
  };
  const r = await openEpochKey(manipuliert, ALICE.sk);
  assert.equal(r.ok, false);
  assert.match(r.message, /passt nicht zur angekündigten Kennung/);
});

test("Unvollstaendige Zuteilung wird abgelehnt", () => {
  const ev = signEvent(buildEvent(GRUENDER.pk, KIND_EPOCH_KEY, [["h", KANAL]], ""), GRUENDER.sk);
  assert.throws(() => parseEpochKeyGrant(ev), /unvollständig/);
});

// ------------------------------------------------------- Nachrichten

test("Verschluesseln und entschluesseln", async () => {
  const k = generateEpochKey();
  const ring = await buildKeyring(KANAL, [await zuteilung(0, k, ALICE)], ALICE.sk);
  const msg = signEvent(await buildEncryptedMessage(
    KANAL, 0, k, ALICE.sk, ALICE.pk, "Treffen um 19 Uhr", NOW), ALICE.sk);

  const r = await decryptChannelMessage(msg, ring);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.plaintext, "Treffen um 19 Uhr");
});

test("Alle Mitglieder derselben Epoche lesen dasselbe", async () => {
  // Ein gemeinsamer Schluessel je Epoche — sonst braeuchte es einen
  // Austausch je Paar.
  const k = generateEpochKey();
  const msg = signEvent(await buildEncryptedMessage(
    KANAL, 0, k, ALICE.sk, ALICE.pk, "an alle", NOW), ALICE.sk);

  for (const m of [ALICE, BOB]) {
    const ring = await buildKeyring(KANAL, [await zuteilung(0, k, m)], m.sk);
    assert.equal((await decryptChannelMessage(msg, ring)).plaintext, "an alle");
  }
});

test("Ohne Schluessel bleibt die Nachricht unlesbar", async () => {
  const k = generateEpochKey();
  const msg = signEvent(await buildEncryptedMessage(
    KANAL, 0, k, ALICE.sk, ALICE.pk, "geheim", NOW), ALICE.sk);

  const leer = await buildKeyring(KANAL, [], MALLORY.sk);
  const r = await decryptChannelMessage(msg, leer);
  assert.equal(r.ok, false);
  assert.equal(r.plaintext, undefined);
});

// --------------------------------------------- DER Schluesselwechsel

test("Nach dem Ausschluss liest der Ausgeschlossene NICHT mehr mit", async () => {
  // Der Kern des Ganzen.
  const k0 = generateEpochKey(), k1 = generateEpochKey();

  // Epoche 0: alle drei dabei.
  const e0 = [await zuteilung(0, k0, ALICE), await zuteilung(0, k0, BOB), await zuteilung(0, k0, MALLORY)];
  // Epoche 1: Mallory raus.
  const e1 = [await zuteilung(1, k1, ALICE), await zuteilung(1, k1, BOB)];
  const alle = [...e0, ...e1];

  const neu = signEvent(await buildEncryptedMessage(
    KANAL, 1, k1, ALICE.sk, ALICE.pk, "ohne Mallory", NOW), ALICE.sk);

  assert.equal((await decryptChannelMessage(neu, await buildKeyring(KANAL, alle, BOB.sk))).ok, true);

  const malloryRing = await buildKeyring(KANAL, alle, MALLORY.sk);
  const r = await decryptChannelMessage(neu, malloryRing);
  assert.equal(r.ok, false, "der Ausgeschlossene darf nicht mehr lesen");
});

test("GRENZE: die Vergangenheit bleibt ihm", async () => {
  // Rueckwirkende Vertraulichkeit gibt es nicht — auch MLS bietet sie nicht.
  // Ein Nutzer, der das Gegenteil glaubt, schreibt anders, als er sollte.
  const k0 = generateEpochKey(), k1 = generateEpochKey();
  const alle = [
    await zuteilung(0, k0, MALLORY),
    await zuteilung(1, k1, ALICE),
  ];
  const alt = signEvent(await buildEncryptedMessage(
    KANAL, 0, k0, ALICE.sk, ALICE.pk, "damals gesagt", NOW - 1000), ALICE.sk);

  const ring = await buildKeyring(KANAL, alle, MALLORY.sk);
  assert.equal((await decryptChannelMessage(alt, ring)).plaintext, "damals gesagt");
});

test("Ein Neuling kann die Zeit vor seinem Beitritt nicht lesen", async () => {
  const k0 = generateEpochKey(), k1 = generateEpochKey();
  const alt = signEvent(await buildEncryptedMessage(
    KANAL, 0, k0, ALICE.sk, ALICE.pk, "vor deiner Zeit", NOW - 1000), ALICE.sk);

  // BOB bekommt nur den Schluessel der neuen Epoche.
  const ring = await buildKeyring(KANAL, [await zuteilung(1, k1, BOB)], BOB.sk);
  const r = await decryptChannelMessage(alt, ring);
  assert.equal(r.ok, false);
  assert.match(r.message, /vor deinem Beitritt/);
});

test("Fehlt der aktuelle Schluessel, wird zum Verbinden geraten", async () => {
  const k1 = generateEpochKey();
  const neu = signEvent(await buildEncryptedMessage(
    KANAL, 5, k1, ALICE.sk, ALICE.pk, "neu", NOW), ALICE.sk);
  const ring = await buildKeyring(KANAL, [], BOB.sk);
  assert.match((await decryptChannelMessage(neu, ring)).message, /Verbinde dich/);
});

test("Der Schluesselbund behaelt ALTE Epochen", async () => {
  // Sie wegzuwerfen wuerde die eigene Vergangenheit unlesbar machen.
  const k0 = generateEpochKey(), k1 = generateEpochKey(), k2 = generateEpochKey();
  const ring = await buildKeyring(KANAL, [
    await zuteilung(0, k0, ALICE), await zuteilung(1, k1, ALICE), await zuteilung(2, k2, ALICE),
  ], ALICE.sk);
  assert.equal(ring.keys.size, 3);
  assert.equal(ring.currentEpoch, 2);
});

test("Bei zwei Zuteilungen fuer dieselbe Epoche gewinnt die erste", async () => {
  // Eine spaetere koennte von jemandem stammen, der die Gruppe uebernehmen
  // will.
  const echt = generateEpochKey(), spaeter = generateEpochKey();
  const ring = await buildKeyring(KANAL, [
    signEvent(await buildEpochKeyGrant(KANAL, 0, echt, GRUENDER.sk, GRUENDER.pk, ALICE.pk, NOW), GRUENDER.sk),
    signEvent(await buildEpochKeyGrant(KANAL, 0, spaeter, MALLORY.sk, MALLORY.pk, ALICE.pk, NOW + 100), MALLORY.sk),
  ], ALICE.sk);
  assert.deepEqual(ring.keys.get(0), echt);
});

test("Fremde Kanaele landen nicht im Schluesselbund", async () => {
  const k = generateEpochKey();
  const fremd = signEvent(await buildEpochKeyGrant(
    "anderer-kanal", 0, k, GRUENDER.sk, GRUENDER.pk, ALICE.pk, NOW), GRUENDER.sk);
  assert.equal((await buildKeyring(KANAL, [fremd], ALICE.sk)).keys.size, 0);
});

// ------------------------------------------------------------- Planung

test("Der Wechsel nennt die Kosten", () => {
  // Bei grossen Gruppen entscheidet diese Zahl, ob ein Wechsel praktikabel ist.
  const p = planRotation(3, [ALICE.pk, BOB.pk, MALLORY.pk], [MALLORY.pk]);
  assert.equal(p.newEpoch, 4);
  assert.equal(p.eventCount, 2);
  assert.deepEqual(p.excluded, [MALLORY.pk]);
  assert.match(p.message, /behalten sie/);
});

test("Ein planmaessiger Wechsel schliesst niemanden aus", () => {
  const p = planRotation(0, [ALICE.pk, BOB.pk], []);
  assert.equal(p.recipients.length, 2);
  assert.match(p.message, /planmäßiger Wechsel/);
});

test("Die Auskunft nennt ALLE DREI Grenzen", () => {
  const t = encryptionInfo(12, 3);
  assert.match(t, /behält alles, was er vorher gelesen/);
  assert.match(t, /Wer offline bleibt/);
  assert.match(t, /Mitgliederliste ist öffentlich/);
});
