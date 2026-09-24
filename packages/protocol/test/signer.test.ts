/**
 * Signer-Schnittstelle (Schritt 1.3): LocalSigner signiert und ver-/entschluesselt
 * wie bisher die Funktionen mit rohem Schluessel – und gibt den Schluessel nicht her.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalSigner } from "../src/signer.js";
import { buildEvent, generateKeypair, signEvent, verifyEvent, toHex } from "../src/index.js";
import { decryptDM, encryptDM } from "../src/dm.js";

const alice = generateKeypair();
const bob = generateKeypair();

test("LocalSigner: gleicher Pubkey, gueltige Signatur, gleiches Ergebnis wie signEvent", async () => {
  const s = new LocalSigner(alice.sk);
  assert.equal(s.publicKey(), alice.pk);
  const ev = buildEvent(alice.pk, 1, [["t", "x"]], "hallo", 1_790_000_000);
  const signiert = await s.signEvent(ev);
  assert.equal(verifyEvent(signiert), true);
  assert.equal(signiert.id, signEvent(ev, alice.sk).id, "dieselbe Event-ID wie bisher");
});

test("LocalSigner: fremdes Event wird nicht signiert", async () => {
  const s = new LocalSigner(alice.sk);
  await assert.rejects(s.signEvent(buildEvent(bob.pk, 1, [], "x")), /anderen Schlüssel/);
});

test("LocalSigner: NIP-44 kompatibel mit encryptDM/decryptDM in beide Richtungen", async () => {
  const a = new LocalSigner(alice.sk);
  const b = new LocalSigner(bob.sk);
  const payload = await a.nip44Encrypt(bob.pk, "geheim 🔐");
  assert.equal(await b.nip44Decrypt(alice.pk, payload), "geheim 🔐");
  assert.equal(await decryptDM(payload, bob.sk, alice.pk), "geheim 🔐", "wie bisher lesbar");
  const alt = await encryptDM("von frueher", bob.sk, alice.pk);
  assert.equal(await a.nip44Decrypt(bob.pk, alt), "von frueher");
});

test("LocalSigner: manipulierte Nachricht und falscher Peer scheitern laut", async () => {
  const a = new LocalSigner(alice.sk);
  const b = new LocalSigner(bob.sk);
  const payload = await a.nip44Encrypt(bob.pk, "text");
  const kaputt = payload.slice(0, 50) + (payload[50] === "A" ? "B" : "A") + payload.slice(51);
  await assert.rejects(b.nip44Decrypt(alice.pk, kaputt), /MAC|Padding|Version/);
  await assert.rejects(b.nip44Decrypt(generateKeypair().pk, payload), /MAC/);
});

test("LocalSigner: fremde Pubkeys werden vor dem Rechnen geprueft", async () => {
  const a = new LocalSigner(alice.sk);
  for (const peer of [bob.pk + "ff", bob.pk.slice(0, 62), bob.pk.toUpperCase(), bob.pk.slice(0, 63) + "g", "", "npub1xyz"]) {
    await assert.rejects(a.nip44Encrypt(peer, "x"), /Pubkey ungültig/, peer);
    await assert.rejects(a.nip44Decrypt(peer, "x"), /Pubkey ungültig/, peer);
  }
});

test("LocalSigner: der Schluessel taucht in keiner Darstellung auf", () => {
  const s = new LocalSigner(alice.sk);
  const skHex = toHex(alice.sk);
  const darstellungen = [
    JSON.stringify(s),
    JSON.stringify({ ...s }),
    JSON.stringify(Object.entries(s)),
    Object.keys(s).join(","),
    String(s),
  ];
  for (const d of darstellungen) assert.ok(!d.includes(skHex), d.slice(0, 60));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), { type: "LocalSigner", pubkey: alice.pk });
  assert.equal("sk" in s, false);
});

test("LocalSigner: haelt eine Kopie – das Original zu ueberschreiben aendert nichts", async () => {
  const sk = Uint8Array.from(alice.sk);
  const s = new LocalSigner(sk);
  sk.fill(0);
  assert.equal(s.publicKey(), alice.pk);
  assert.equal(verifyEvent(await s.signEvent(buildEvent(alice.pk, 1, [], "x"))), true);
});

test("LocalSigner: falsche Schluessellaenge wird abgelehnt", () => {
  assert.throws(() => new LocalSigner(new Uint8Array(31)), /32 Bytes/);
});
