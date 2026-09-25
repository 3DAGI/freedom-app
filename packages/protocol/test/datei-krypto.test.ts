/**
 * Schritt 2.4a: verschluesselte Anhaenge – AES-256-GCM je Datei, Schluessel
 * nur in der Nachricht. Abnahme der Karte: Upload ≠ Klartext, Entschluesseln
 * klappt, Manipulation faellt auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { entschluesseleDatei, istDateiSchluessel, verschluesseleDatei } from "../src/datei-krypto.js";
import { buildBlob } from "../src/blob.js";
import { regelUploadVerschluesselt } from "../src/leak-rules.js";

const datei = () => crypto.getRandomValues(new Uint8Array(20_000));

test("Datei: verschluesseln und wieder oeffnen", () => {
  const klar = datei();
  const { chiffrat, schluessel } = verschluesseleDatei(klar);
  assert.equal(chiffrat.length, klar.length + 16, "Klartext plus GCM-Tag");
  assert.ok(istDateiSchluessel(schluessel));
  assert.deepEqual(entschluesseleDatei(chiffrat, schluessel), klar);
  // Auch eine leere Datei
  const leer = verschluesseleDatei(new Uint8Array(0));
  assert.equal(entschluesseleDatei(leer.chiffrat, leer.schluessel).length, 0);
});

test("Datei: jeder Aufruf mit frischem Schluessel und frischer Nonce", () => {
  const klar = datei();
  const a = verschluesseleDatei(klar);
  const b = verschluesseleDatei(klar);
  assert.notEqual(a.schluessel.key, b.schluessel.key);
  assert.notEqual(a.schluessel.nonce, b.schluessel.nonce);
  assert.notDeepEqual(a.chiffrat, b.chiffrat);
  assert.equal(a.schluessel.ox, b.schluessel.ox, "derselbe Klartext-Hash");
});

test("Datei: Manipulation, falscher Schluessel, falscher Hash fallen auf", () => {
  const klar = datei();
  const { chiffrat, schluessel } = verschluesseleDatei(klar);
  const kaputt = chiffrat.slice();
  kaputt[100] ^= 1;
  assert.throws(() => entschluesseleDatei(kaputt, schluessel), /beschädigt/);
  assert.throws(() => entschluesseleDatei(chiffrat.slice(0, -1), schluessel), /beschädigt/);
  const fremd = verschluesseleDatei(klar).schluessel;
  assert.throws(() => entschluesseleDatei(chiffrat, { ...schluessel, key: fremd.key }), /beschädigt/);
  assert.throws(() => entschluesseleDatei(chiffrat, { ...schluessel, ox: "0".repeat(64) }), /Hash/);
});

test("Datei-Schluessel aus fremder Nachricht: nur exakte Form", () => {
  const { schluessel } = verschluesseleDatei(datei());
  assert.ok(istDateiSchluessel(schluessel));
  for (const kaputt of [
    null, "x", {}, { ...schluessel, alg: "aes-cbc" }, { ...schluessel, key: schluessel.key.slice(2) },
    { ...schluessel, key: schluessel.key.toUpperCase() }, { ...schluessel, nonce: `${schluessel.nonce}00` },
    { ...schluessel, ox: `${schluessel.ox.slice(0, 63)}g` }, { ...schluessel, key: 7 },
  ]) {
    assert.equal(istDateiSchluessel(kaputt), false, JSON.stringify(kaputt));
  }
  assert.throws(() => entschluesseleDatei(new Uint8Array(32), { ...schluessel, nonce: "zz" } as never), /ungültig/);
});

test("Upload ≠ Klartext: das Blob-Netz sieht nur Chiffrat", async () => {
  const klar = datei();
  const { chiffrat } = verschluesseleDatei(klar);
  const { manifestEvent, chunkEvents } = await buildBlob(
    { name: "", mime: "application/octet-stream", bytes: chiffrat }, "a".repeat(64),
  );
  const events = [manifestEvent, ...chunkEvents].map((e) => ({ ...e, id: "", sig: "" }));
  assert.deepEqual(regelUploadVerschluesselt(events, klar), []);
  // Gegenprobe: der Klartext selbst wuerde gefunden
  const offen = await buildBlob({ name: "", mime: "application/octet-stream", bytes: klar }, "a".repeat(64));
  assert.ok(regelUploadVerschluesselt([offen.manifestEvent, ...offen.chunkEvents].map((e) => ({ ...e, id: "", sig: "" })), klar).length > 0);
});
