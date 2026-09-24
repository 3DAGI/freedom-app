/**
 * NIP-44-v2-Tests.
 *
 * Diese Datei fehlte — deshalb blieb monatelang unbemerkt, dass die alte
 * "NIP-44"-Implementierung secp256k1-Keys durch X25519 schickte und JEDE DM
 * unentschluesselbar machte. Der erste Test hier ist genau der, der das
 * sofort gefunden haette: einmal hin, einmal zurueck.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { encryptDM, decryptDM, conversationKey, isNip44Payload } from "../src/dm.js";

function keypair(fill: number): { sk: Uint8Array; pk: string } {
  const sk = new Uint8Array(32).fill(fill);
  return { sk, pk: bytesToHex(schnorr.getPublicKey(sk)) };
}

test("NIP-44: Roundtrip — Empfaenger kann lesen, was der Sender schrieb", async () => {
  const alice = keypair(1);
  const bob = keypair(2);

  const msg = "Treffen um 19 Uhr, bring den Ledger mit.";
  const payload = await encryptDM(msg, alice.sk, bob.pk);
  const back = await decryptDM(payload, bob.sk, alice.pk);

  assert.equal(back, msg);
});

test("NIP-44: conversation_key ist symmetrisch (der eigentliche Altbug)", async () => {
  const alice = keypair(7);
  const bob = keypair(9);

  const a = await conversationKey(alice.sk, bob.pk);
  const b = await conversationKey(bob.sk, alice.pk);

  assert.deepEqual(a, b, "beide Seiten muessen denselben Schluessel ableiten");
  assert.equal(a.length, 32);
});

test("NIP-44: Dritter kann nicht mitlesen", async () => {
  const alice = keypair(3);
  const bob = keypair(4);
  const mallory = keypair(5);

  const payload = await encryptDM("geheim", alice.sk, bob.pk);
  await assert.rejects(() => decryptDM(payload, mallory.sk, alice.pk));
});

test("NIP-44: manipulierter Ciphertext wird abgelehnt (MAC greift)", async () => {
  const alice = keypair(11);
  const bob = keypair(12);

  const payload = await encryptDM("Betrag: 100 sats", alice.sk, bob.pk);
  // ein Zeichen in der Mitte kippen
  const idx = Math.floor(payload.length / 2);
  const flipped =
    payload.slice(0, idx) + (payload[idx] === "A" ? "B" : "A") + payload.slice(idx + 1);

  await assert.rejects(() => decryptDM(flipped, bob.sk, alice.pk), /MAC|Padding|base64/);
});

test("NIP-44: Padding verbirgt die Laenge", async () => {
  const alice = keypair(21);
  const bob = keypair(22);

  const kurz = await encryptDM("ja", alice.sk, bob.pk);
  const laenger = await encryptDM("ja, unbedingt, sehr gern", alice.sk, bob.pk);

  assert.equal(kurz.length, laenger.length, "kurze Nachrichten sind ununterscheidbar");
});

test("NIP-44: gleiche Nachricht ergibt zweimal verschiedene Payloads (Nonce)", async () => {
  const alice = keypair(31);
  const bob = keypair(32);

  const a = await encryptDM("wiederholung", alice.sk, bob.pk);
  const b = await encryptDM("wiederholung", alice.sk, bob.pk);

  assert.notEqual(a, b);
  assert.equal(await decryptDM(a, bob.sk, alice.pk), await decryptDM(b, bob.sk, alice.pk));
});

test("NIP-44: Umlaute und Emoji ueberleben den Roundtrip", async () => {
  const alice = keypair(41);
  const bob = keypair(42);

  const msg = "Grüße aus Wiener Neustadt — 100 % läuft ⚡🛰️";
  assert.equal(await decryptDM(await encryptDM(msg, alice.sk, bob.pk), bob.sk, alice.pk), msg);
});

test("NIP-44: offizieller Testvektor fuer conversation_key", async () => {
  // Aus den NIP-44-Referenzvektoren (nostr-protocol/nips, nip44.vectors.json,
  // valid.get_conversation_key[0]). Beweist Interoperabilitaet mit anderen
  // Clients — Roundtrip mit sich selbst allein wuerde das nicht zeigen.
  const sec1 = hexToBytes("315e59ff51cb9209768cf7da80791ddcaae56ac9775eb25b6dee1234bc5d2268");
  const pub2 = "c2f9d9948dc8c7c38321e4b85c8558872eafa0641cd269db76848a6073e69133";
  const expected = "3dfef0ce2a4d80a25e7a328accf73448ef67096f65f79588e358d9a0eb9013f1";

  const key = await conversationKey(sec1, pub2);
  assert.equal(bytesToHex(key), expected);
});

test("NIP-44: isNip44Payload trennt verschluesselt von Klartext", async () => {
  const alice = keypair(51);
  const bob = keypair(52);

  assert.equal(isNip44Payload(await encryptDM("hallo", alice.sk, bob.pk)), true);
  assert.equal(isNip44Payload("hallo, das ist Klartext"), false);
  assert.equal(isNip44Payload("altesNIP04Format?iv=abc"), false);
});
