/**
 * Tests fuer den Geschenkumschlag.
 *
 * Der Zweck ist, den Sozialgraphen zu verbergen. Die Tests pruefen deshalb
 * vor allem, was nach AUSSEN sichtbar bleibt — und dass die Auskunft darueber
 * nicht mehr verspricht, als der Aufbau haelt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, buildEvent, signEvent, NostrEvent } from "../src/event.js";
import {
  giftWrap, giftUnwrap, wrapDisclosure, wrapInfo, shouldWrap,
  KIND_GIFT_WRAP, KIND_SEAL,
} from "../src/gift-wrap.js";

const NOW = 1_800_000_000;
const ABSENDER = generateKeypair();
const EMPFAENGER = generateKeypair();
const DRITTER = generateKeypair();

const kern = (text = "geheim") => buildEvent(ABSENDER.pk, 14, [], text, NOW);

// ------------------------------------------------------------- Grundlage

test("Einpacken und auspacken", async () => {
  const w = await giftWrap(kern("Treffen um 19 Uhr"), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk,
    { nowSecs: NOW, fixedJitter: 0 });
  const r = await giftUnwrap(w, EMPFAENGER.sk);

  assert.equal(r.ok, true, r.message);
  assert.equal(r.inner!.content, "Treffen um 19 Uhr");
  assert.equal(r.senderPubkey, ABSENDER.pk);
});

test("DER KERN: der Absender steht NICHT im Umschlag", async () => {
  // Das ist der ganze Zweck. Ein Relay sieht einen Schluessel, den es nie
  // wieder sieht.
  const w = await giftWrap(kern(), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk, { nowSecs: NOW });
  assert.notEqual(w.pubkey, ABSENDER.pk);
  assert.equal(w.kind, KIND_GIFT_WRAP);
  // Auch in den Tags nicht.
  assert.ok(!JSON.stringify(w.tags).includes(ABSENDER.pk));
});

test("Zwei Nachrichten desselben Absenders sehen unverbunden aus", async () => {
  // Sonst waere der Sozialgraph ueber wiederkehrende Wegwerfschluessel
  // trotzdem rekonstruierbar.
  const a = await giftWrap(kern("eins"), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk, { nowSecs: NOW });
  const b = await giftWrap(kern("zwei"), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk, { nowSecs: NOW });
  assert.notEqual(a.pubkey, b.pubkey);
});

test("Der Empfaenger steht im Klartext — und das ist unvermeidbar", async () => {
  // Ohne ihn koennte niemand seine Post finden. Die Auskunft sagt das auch.
  const w = await giftWrap(kern(), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk, { nowSecs: NOW });
  assert.ok(w.tags.some((t) => t[0] === "p" && t[1] === EMPFAENGER.pk));
});

test("Der Zeitstempel wird verschoben", async () => {
  // Exakte Gleichzeitigkeit von Absenden und Empfangen wuerde die Beziehung
  // verraten.
  const w = await giftWrap(kern(), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk,
    { nowSecs: NOW, fixedJitter: 50_000 });
  assert.equal(w.created_at, NOW - 50_000);
});

// ------------------------------------------------------------- Abwehr

test("Ein Dritter kann den Umschlag nicht oeffnen", async () => {
  const w = await giftWrap(kern("privat"), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk, { nowSecs: NOW });
  const r = await giftUnwrap(w, DRITTER.sk);
  assert.equal(r.ok, false);
  assert.equal(r.inner, undefined);
  assert.equal(r.senderPubkey, undefined);
});

test("Ein von Hand gebauter Umschlag mit falschem Absender faellt auf", async () => {
  // Der echte Angriff: Ein Dritter baut Siegel und Umschlag selbst und
  // schreibt in den Kern einen fremden Absender. Die Signatur des Siegels
  // deckt nur den verschluesselten Inhalt — ohne die Gleichheitspruefung
  // koennte er sich als beliebige Person ausgeben.
  const { encryptDM } = await import("../src/dm.js");

  const gefaelschterKern = JSON.stringify({
    pubkey: ABSENDER.pk, kind: 14, tags: [], content: "das habe ich nie geschrieben",
    created_at: NOW,
  });
  // DRITTER versiegelt — der Kern behauptet aber, von ABSENDER zu sein.
  const siegel = signEvent(buildEvent(DRITTER.pk, KIND_SEAL, [],
    await encryptDM(gefaelschterKern, DRITTER.sk, EMPFAENGER.pk), NOW), DRITTER.sk);

  const wegwerf = generateKeypair();
  const umschlag = signEvent(buildEvent(wegwerf.pk, KIND_GIFT_WRAP, [["p", EMPFAENGER.pk]],
    await encryptDM(JSON.stringify(siegel), wegwerf.sk, EMPFAENGER.pk), NOW), wegwerf.sk);

  const r = await giftUnwrap(umschlag, EMPFAENGER.sk);
  assert.equal(r.ok, false, "eine Faelschung darf nicht durchgehen");
  assert.match(r.message, /stimmt nicht mit dem Siegel/);
});

test("giftWrap setzt den Absender selbst — Aufrufer koennen ihn nicht faelschen", () => {
  // Zweite Verteidigungslinie: Selbst wenn eine App einen falschen Absender
  // in den Kern schreibt, wird er beim Einpacken ueberschrieben.
  return giftWrap({ ...kern("x"), pubkey: DRITTER.pk } as never,
    ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk, { nowSecs: NOW })
    .then((w) => giftUnwrap(w, EMPFAENGER.sk))
    .then((r) => {
      assert.equal(r.ok, true);
      assert.equal(r.senderPubkey, ABSENDER.pk, "der echte Absender gewinnt");
    });
});

test("Ein fremder Ereignistyp wird abgelehnt", async () => {
  const ev = signEvent(buildEvent(ABSENDER.pk, 1, [], "text", NOW), ABSENDER.sk);
  assert.equal((await giftUnwrap(ev, EMPFAENGER.sk)).ok, false);
});

test("Ein beschaedigter Umschlag stuerzt nicht ab", async () => {
  const w = await giftWrap(kern(), ABSENDER.sk, ABSENDER.pk, EMPFAENGER.pk, { nowSecs: NOW });
  const kaputt: NostrEvent = { ...w, content: "kein gueltiger chiffretext" };
  const r = await giftUnwrap(kaputt, EMPFAENGER.sk);
  assert.equal(r.ok, false);
  assert.match(r.message, /nicht für dich oder beschädigt/);
});

test("Ein Umschlag, der kein Siegel enthaelt, wird abgelehnt", async () => {
  // Jemand koennte beliebigen verschluesselten Inhalt als Umschlag ausgeben.
  const { encryptDM } = await import("../src/dm.js");
  const wegwerf = generateKeypair();
  const falsch = signEvent(buildEvent(wegwerf.pk, KIND_GIFT_WRAP,
    [["p", EMPFAENGER.pk]],
    await encryptDM(JSON.stringify({ kind: 1, content: "kein siegel" }), wegwerf.sk, EMPFAENGER.pk),
    NOW), wegwerf.sk);

  const r = await giftUnwrap(falsch, EMPFAENGER.sk);
  assert.equal(r.ok, false);
  assert.match(r.message, /kein Siegel/);
  assert.equal(KIND_SEAL, 13);
});

// ------------------------------------------------------------- Auskunft

test("Die Auskunft nennt beide Seiten", () => {
  // Eine Funktion, die nur die Staerken nennt, erzeugt falsches Vertrauen.
  const d = wrapDisclosure();
  assert.ok(d.hidden.length >= 3);
  assert.ok(d.visible.length >= 3);
  assert.ok(d.hidden.some((x) => /geschrieben/.test(x)));
  assert.ok(d.visible.some((x) => /bekommt/.test(x)));
});

test("Die Auskunft nennt die Grenze ausdruecklich", () => {
  const t = wrapInfo();
  assert.match(t, /Empfänger steht im Klartext/);
  assert.match(t, /Mixnetz/);
});

test("Bei Direktnachrichten lohnt der Umschlag", () => {
  assert.equal(shouldWrap({ kind: "dm" }).wrap, true);
});

test("In Kanaelen und oeffentlich lohnt er nicht", () => {
  // Er kostet Groesse und Rechenzeit — dort gibt es nichts zu verbergen.
  assert.equal(shouldWrap({ kind: "kanal" }).wrap, false);
  assert.equal(shouldWrap({ kind: "oeffentlich" }).wrap, false);
});

test("Der Nutzer kann ihn trotzdem erzwingen", () => {
  assert.equal(shouldWrap({ kind: "oeffentlich", forced: true }).wrap, true);
});
