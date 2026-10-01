/**
 * Halte-Auftrag an den eigenen Knoten (B-9b, L4 A): versiegelt, mit
 * Besitzer-Nachweis, an genau ein Manifest gebunden; die Antwort nur in
 * fester Form.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  KIND_DVM_BLOB_HALTEN, KIND_GIFT_WRAP, LocalSigner, baueHalteAuftrag, buildBlob, generateKeypair, getTag, halteAntwortText,
  halteManifest, istBesitzer, leseHalteAntwort, neueKopplung, openPrivateKundenEvent,
} from "../src/index.js";

const HEX = (n: number) => randomBytes(n).toString("hex");

test("B-9b: baueHalteAuftrag – versiegelt an den Knoten, Kern 5076 mit Blob, Manifest und Nachweis; offen steht davon nichts", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const blobId = HEX(32), manifestId = HEX(32);
  const { wrap, requestId } = await baueHalteAuftrag({ sitzung, kopplung: k, blobId, manifestId });
  assert.equal(wrap.kind, KIND_GIFT_WRAP);
  assert.equal(getTag(wrap, "p"), knoten.pk);
  const offen = JSON.stringify(wrap);
  for (const geheim of [blobId, manifestId, k.geheimnis, sitzung.publicKey()]) assert.ok(!offen.includes(geheim), "nichts davon offen");
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.kind, KIND_DVM_BLOB_HALTEN);
  assert.equal(getTag(r.request, "i"), blobId);
  assert.deepEqual(r.request.tags.find((t) => t[0] === "param"), ["param", "manifest", manifestId]);
  assert.ok(istBesitzer(r.request, [k.geheimnis], r.request.created_at), "mit Nachweis des Besitzers");
  assert.ok(!istBesitzer(r.request, [neueKopplung(knoten.pk).geheimnis], r.request.created_at), "ein anderes Geheimnis passt nicht");
  // Ungültige Kennungen gehen nicht hinaus
  for (const [b, m] of [["kurz", manifestId], [blobId, "kurz"], [blobId.toUpperCase(), manifestId]]) {
    await assert.rejects(baueHalteAuftrag({ sitzung, kopplung: k, blobId: b!, manifestId: m! }));
  }
});

test("B-9b: halteManifest – nur genau dieser Blob, nur verschlüsselt, stimmige Angaben; sonst null", async () => {
  const uploader = generateKeypair();
  const bytes = new Uint8Array(randomBytes(200_000));
  const { manifestEvent, manifest } = await buildBlob({ name: "", mime: "application/octet-stream", bytes }, uploader.pk, { verschluesselt: true });
  const m = halteManifest(manifestEvent, manifest.blobId);
  assert.ok(m);
  assert.deepEqual(m.hashes, manifest.shardHashes);
  const gruppen = manifest.shardHashes.length / (manifest.dataShards + manifest.parityShards);
  assert.equal(m.noetig, gruppen * manifest.dataShards, "Daten-Stücke über alle Gruppen");
  assert.equal(halteManifest(manifestEvent, HEX(32)), null, "anderer Blob");
  const offen = await buildBlob({ name: "x.txt", mime: "text/plain", bytes }, uploader.pk);
  assert.equal(halteManifest(offen.manifestEvent, offen.manifest.blobId), null, "unverschlüsselt hält der Knoten nicht");
  const mit = (aenderung: Record<string, unknown>) => ({ ...manifestEvent, content: JSON.stringify({ ...manifest, ...aenderung }) });
  for (const kaputt of [
    { shardHashes: [...manifest.shardHashes.slice(0, -1), "zz"] },
    { shardHashes: manifest.shardHashes.slice(0, -1) },
    { dataShards: 0 },
    { parityShards: -1 },
    { dataShards: 1.5 },
    { blobId: HEX(32) },
    { encrypted: "ja" },
  ]) assert.equal(halteManifest(mit(kaputt), manifest.blobId), null, JSON.stringify(Object.keys(kaputt)));
  assert.equal(halteManifest({ ...manifestEvent, content: "{" }, manifest.blobId), null);
  assert.equal(halteManifest({ ...manifestEvent, kind: 1 }, manifest.blobId), null);
});

test("B-9b: Antwort des Knotens – nur in fester Form, sonst null", () => {
  const a = { gehalten: 24, noetig: 16, gesamt: 24 };
  assert.deepEqual(leseHalteAntwort(halteAntwortText(a)), a);
  assert.deepEqual(leseHalteAntwort(halteAntwortText({ gehalten: 0, noetig: 16, gesamt: 24 })), { gehalten: 0, noetig: 16, gesamt: 24 });
  for (const kaputt of [
    "", "veroeffentlicht", "{", "null", "[]", '"x"',
    JSON.stringify({ gehalten: 25, noetig: 16, gesamt: 24 }),
    JSON.stringify({ gehalten: 1, noetig: 25, gesamt: 24 }),
    JSON.stringify({ gehalten: 1, noetig: 0, gesamt: 24 }),
    JSON.stringify({ gehalten: -1, noetig: 16, gesamt: 24 }),
    JSON.stringify({ gehalten: 1.5, noetig: 16, gesamt: 24 }),
    JSON.stringify({ gehalten: "24", noetig: 16, gesamt: 24 }),
    JSON.stringify({ gehalten: 1, noetig: 1, gesamt: 1e9 }),
  ]) assert.equal(leseHalteAntwort(kaputt), null, kaputt);
});
