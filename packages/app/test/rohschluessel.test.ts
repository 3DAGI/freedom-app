/**
 * Schritt 1.3e: Der rohe Schluessel steckt nur noch im LocalSigner.
 *
 * Im Zustand der App liegt nur der Pubkey; wer den privaten Schluessel
 * braucht (Sicherung, Nachfolge, Swap-Adressen, Export), leiht ihn ueber
 * `mitRohemSchluessel()` – mit einem entfernten Signer gibt es ihn nicht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocalSigner, deriveBackupKey, generateKeypair, toHex, verifyEvent,
  type NostrEvent, type Signer, type UnsignedEvent,
} from "@freedomstack/protocol";
import { mitRohemSchluessel, setzeIdentitaet, state } from "../src/shell/state.js";
import { uploadBlob } from "../src/blob-client.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function quellen(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? quellen(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("Abnahme 1.3: kein keypair.sk mehr in der App", () => {
  const treffer = quellen(SRC).filter((p) => readFileSync(p, "utf8").includes("keypair.sk"));
  assert.deepEqual(treffer, []);
});

test("Zustand haelt nur den Pubkey – der Schluessel liegt im Signer", () => {
  const kp = generateKeypair();
  setzeIdentitaet(kp.sk);
  assert.deepEqual(Object.keys(state.keypair!), ["pk"]);
  assert.equal(state.keypair!.pk, kp.pk);
  assert.ok(state.signer instanceof LocalSigner);
  assert.ok(!JSON.stringify(state).includes(toHex(kp.sk)), "Schluessel im serialisierten Zustand");
});

test("mitRohemSchluessel: rechnet mit dem lokalen Schluessel", () => {
  const kp = generateKeypair();
  setzeIdentitaet(kp.sk);
  assert.equal(mitRohemSchluessel("Der Export", toHex), toHex(kp.sk));
  assert.deepEqual(mitRohemSchluessel("Die Sicherung", deriveBackupKey), deriveBackupKey(kp.sk));
});

test("mitRohemSchluessel: mit entferntem Signer oder ohne Identitaet – klare Absage", () => {
  const kp = generateKeypair();
  const lokal = new LocalSigner(kp.sk);
  // Ein Signer ohne rohen Schluessel, wie der Nip46Signer.
  const entfernt: Signer = {
    publicKey: () => lokal.publicKey(),
    signEvent: (ev) => lokal.signEvent(ev),
    nip44Encrypt: (p, t) => lokal.nip44Encrypt(p, t),
    nip44Decrypt: (p, t) => lokal.nip44Decrypt(p, t),
  };
  state.signer = entfernt;
  state.keypair = { pk: kp.pk };
  let aufgerufen = false;
  assert.throws(() => mitRohemSchluessel("Die Nachfolge", () => { aufgerufen = true; }), /Die Nachfolge geht nur mit dem Schlüssel auf diesem Gerät, nicht über einen Bunker/);
  assert.equal(aufgerufen, false);
  state.signer = null;
  state.keypair = null;
  assert.throws(() => mitRohemSchluessel("Der Export", toHex), /nicht über einen Bunker/);
});

test("uploadBlob signiert jeden Chunk und das Manifest ueber den Signer", async () => {
  const kp = generateKeypair();
  const lokal = new LocalSigner(kp.sk);
  let signiert = 0;
  const signer: Signer = {
    publicKey: () => lokal.publicKey(),
    signEvent: (ev: UnsignedEvent) => { signiert++; return lokal.signEvent(ev); },
    nip44Encrypt: () => Promise.reject(new Error("nicht gebraucht")),
    nip44Decrypt: () => Promise.reject(new Error("nicht gebraucht")),
  };
  const gesendet: NostrEvent[] = [];
  const pool = { publish: async (ev: unknown) => { gesendet.push(ev as NostrEvent); } };
  const datei = new File([new Uint8Array(3000).fill(42)], "probe.bin", { type: "application/octet-stream" });

  const res = await uploadBlob(datei, pool, signer);

  assert.ok(gesendet.length >= 2);
  assert.equal(signiert, gesendet.length);
  for (const ev of gesendet) {
    assert.equal(ev.pubkey, kp.pk);
    assert.equal(verifyEvent(ev), true);
  }
  // Manifest zuletzt, seine id kommt zurueck.
  assert.equal(res.manifestEventId, gesendet[gesendet.length - 1].id);
});

test("uploadBlob: verweigert der Signer, geht nichts ins Netz", async () => {
  const kp = generateKeypair();
  const signer: Signer = {
    publicKey: () => kp.pk,
    signEvent: () => Promise.reject(new Error("Signer lehnt ab: abgelehnt")),
    nip44Encrypt: () => Promise.reject(new Error("nicht gebraucht")),
    nip44Decrypt: () => Promise.reject(new Error("nicht gebraucht")),
  };
  const gesendet: unknown[] = [];
  const pool = { publish: async (ev: unknown) => { gesendet.push(ev); } };
  const datei = new File([new Uint8Array(100)], "x.bin");
  await assert.rejects(uploadBlob(datei, pool, signer), /Signer lehnt ab/);
  assert.equal(gesendet.length, 0);
});
