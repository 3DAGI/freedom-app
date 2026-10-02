/**
 * Halten für den Besitzer im Knoten (B-9b, L4 A): Ein versiegelter
 * Halte-Auftrag mit Nachweis lässt den Knoten die Stücke eines verschlüsselten
 * Blobs holen und ohne Verdrängung halten – nur genau das genannte Manifest,
 * nur Stücke seines Autors, innerhalb der Quota, über einen Neustart hinweg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_BLOB_HALTEN, LocalSigner, MemoryRelay, OutboxPool, baueHalteAuftrag, buildBlob, buildJobRequest, buildPrivateJobRequest,
  generateKeypair, leseHalteAntwort, neueKopplung, openPrivateJobResponse, signEvent, type Kopplung,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { StorageRole } from "../src/storage-role.js";

async function aufbau(quotaBytes = 0) {
  const relay = new MemoryRelay(`mem://halten-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const dir = mkdtempSync(join(tmpdir(), "halten-"));
  const storage = new StorageRole({ dir, quotaBytes, bootstrapSeeder: false });
  await storage.init();
  const geheim = { liste: [] as string[] };
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", besitzer: () => geheim.liste,
  }, pool, undefined, undefined, storage);
  const k = neueKopplung(kp.pk);
  geheim.liste = [k.geheimnis];
  return { relay, pool, kp, dir, storage, provider, k };
}

/** Ein verschlüsselter Blob, hochgeladen wie in der App: Stücke und Manifest signiert vom Uploader. */
async function lade(pool: OutboxPool, groesse = 150_000) {
  const uploader = generateKeypair();
  const { manifestEvent, chunkEvents, manifest } = await buildBlob(
    { name: "", mime: "application/octet-stream", bytes: new Uint8Array(randomBytes(groesse)) }, uploader.pk, { verschluesselt: true },
  );
  for (const ev of chunkEvents) await pool.publish(signEvent(ev, uploader.sk));
  const m = signEvent(manifestEvent, uploader.sk);
  await pool.publish(m);
  return { manifest, manifestId: m.id, uploader };
}

async function halte(pool: OutboxPool, k: Kopplung, blobId: string, manifestId: string) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await baueHalteAuftrag({ sitzung, kopplung: k, blobId, manifestId });
  await pool.publish(wrap);
  return sitzung;
}

async function antworten(relay: MemoryRelay, sitzung: LocalSigner) {
  const roh = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  return roh.flatMap((a) => (a.ok ? [a.response] : []));
}

test("B-9b: der Besitzer lässt halten – alle Stücke, versiegelte Antwort, kein Verdrängen, nach dem Neustart noch da", async () => {
  const { relay, pool, dir, storage, provider, k } = await aufbau();
  const { manifest, manifestId } = await lade(pool);
  const sitzung = await halte(pool, k, manifest.blobId, manifestId);
  const jobs = await provider.pollOnce();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.amountMsat, 0, "kostet den Besitzer nichts");
  for (const h of manifest.shardHashes) assert.ok(storage.haelt(h), `Stück ${h.slice(0, 8)} gehalten`);
  const a = (await antworten(relay, sitzung)).find((r) => r.kind === KIND_DVM_BLOB_HALTEN + 1000);
  assert.ok(a, "Antwort versiegelt an die Sitzung");
  assert.deepEqual(leseHalteAntwort(a.content), { gehalten: manifest.shardHashes.length, noetig: manifest.dataShards, gesamt: manifest.shardHashes.length });
  // gehalten.json: nur Hashes, nur für den Knoten
  const liste = JSON.parse(readFileSync(join(dir, "gehalten.json"), "utf8")) as string[];
  assert.deepEqual([...liste].sort(), [...new Set(manifest.shardHashes)].sort(), "je Hash einmal – leere Füllstücke teilen sich einen");
  // Neustart: dieselbe Liste, und der Abruf (5075) liefert die Stücke weiter
  const neu = new StorageRole({ dir, quotaBytes: 0, bootstrapSeeder: false });
  await neu.init();
  for (const h of manifest.shardHashes) assert.ok(neu.haelt(h));
  assert.ok(await neu.ereignis(manifest.blobId, 0), "wieder veröffentlichbar");
});

test("B-9b: gehaltene Stücke verdrängt die LRU nie – andere schon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "halten-lru-"));
  const relay = new MemoryRelay("mem://halten-lru");
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const { manifest } = await lade(pool, 70_000);
  const stuecke = await relay.query({ kinds: [38041], "#blob": [manifest.blobId] });
  // Quota: der gehaltene Blob plus zwei Stücke – der fremde passt nicht hinein, er muss verdrängen
  const einzeln = new Map(stuecke.map((ev) => [ev.tags.find((t) => t[0] === "sha256")![1]!, ev.content.length / 2]));
  const gehaltenGroesse = [...einzeln.values()].reduce((a, b) => a + b, 0);
  const quota = gehaltenGroesse + 2 * 65_536;
  const storage = new StorageRole({ dir, quotaBytes: quota, bootstrapSeeder: false });
  await storage.init();
  for (const ev of stuecke) assert.ok((await storage.nimmAuf(ev, { halten: true })).ok);
  const fremd = await lade(pool, 300_000);
  for (const ev of await relay.query({ kinds: [38041], "#blob": [fremd.manifest.blobId] })) await storage.nimmAuf(ev);
  for (const h of manifest.shardHashes) assert.ok(await storage.has(h), `gehaltenes Stück ${h.slice(0, 8)} noch da`);
  const verdraengt = (await Promise.all(fremd.manifest.shardHashes.map((h) => storage.has(h)))).filter((da) => !da).length;
  assert.ok(verdraengt > 0, "ungehaltene Stücke wurden verdrängt");
  const st = storage.stats();
  assert.ok(st.totalBytes <= quota, "Quota eingehalten");
  assert.equal(st.gehalten, einzeln.size);
});

test("B-9b: ohne Nachweis, offen oder mit fremdem Manifest hält der Knoten nichts", async () => {
  const { relay, pool, kp, storage, provider, k } = await aufbau();
  const { manifest, manifestId } = await lade(pool);
  // Ohne Nachweis (versiegelt, aber ohne Kopplung) und mit einem fremden Geheimnis
  const ohne = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({ kind: KIND_DVM_BLOB_HALTEN, customerPubkey: ohne.publicKey(), input: manifest.blobId, bidMsat: 0, providerPubkey: kp.pk, params: [["manifest", manifestId]] });
  await pool.publish((await buildPrivateJobRequest({ request: kern, sessionSigner: ohne, providerPk: kp.pk })).wrap);
  await halte(pool, neueKopplung(kp.pk), manifest.blobId, manifestId);
  // Offen mit Nachweis zählt nie
  const kunde = generateKeypair();
  const { mitBesitzerNachweis } = await import("@freedomstack/protocol");
  await pool.publish(signEvent(mitBesitzerNachweis(buildJobRequest({ kind: KIND_DVM_BLOB_HALTEN, customerPubkey: kunde.pk, input: manifest.blobId, bidMsat: 0, providerPubkey: kp.pk, params: [["manifest", manifestId]] }), k), kunde.sk));
  assert.equal((await provider.pollOnce()).length, 0);
  assert.equal(storage.stats().gehalten, 0, "nichts gehalten");
  const fehler = await antworten(relay, ohne);
  assert.ok(fehler.some((f) => f.kind === 7000 && f.content.includes("Halten nur für den Besitzer")), "Rückmeldung mit festem Text");

  // Ein Fremder veröffentlicht ein Manifest mit derselben Blob-Id und eigenen Stücken: zählt nicht
  const angreifer = generateKeypair();
  const falsch = await buildBlob({ name: "", mime: "application/octet-stream", bytes: new Uint8Array(randomBytes(60_000)) }, angreifer.pk, { verschluesselt: true });
  const falschesManifest = signEvent({ ...falsch.manifestEvent, tags: falsch.manifestEvent.tags.map((t) => (t[0] === "blob" ? ["blob", manifest.blobId] : t)) }, angreifer.sk);
  await pool.publish(falschesManifest);
  for (const ev of falsch.chunkEvents) await pool.publish(signEvent({ ...ev, tags: ev.tags.map((t) => (t[0] === "blob" ? ["blob", manifest.blobId] : t)) }, angreifer.sk));
  await halte(pool, k, manifest.blobId, falschesManifest.id);
  assert.equal((await provider.pollOnce()).length, 0, "fremdes Manifest: Blob-Id im Inhalt passt nicht");
  // Das richtige Manifest: nur die Stücke seines Autors, keins des Angreifers
  await halte(pool, k, manifest.blobId, manifestId);
  assert.equal((await provider.pollOnce()).length, 1);
  assert.equal(storage.stats().gehalten, new Set(manifest.shardHashes).size);
  for (const h of falsch.manifest.shardHashes) if (!manifest.shardHashes.includes(h)) assert.ok(!storage.haelt(h), "kein Stück des Angreifers");
});

test("B-9b: unverschlüsselt nie, über die Quota nie", async () => {
  const { pool, storage, provider, k } = await aufbau(140_000);
  const offen = generateKeypair();
  const klar = await buildBlob({ name: "a.txt", mime: "text/plain", bytes: new Uint8Array(randomBytes(10_000)) }, offen.pk);
  for (const ev of klar.chunkEvents) await pool.publish(signEvent(ev, offen.sk));
  const klarManifest = signEvent(klar.manifestEvent, offen.sk);
  await pool.publish(klarManifest);
  await halte(pool, k, klar.manifest.blobId, klarManifest.id);
  assert.equal((await provider.pollOnce()).length, 0, "unverschlüsselt: kein Halten");
  // Größer als die Quota: was hineinpasst, wird gehalten, mehr nie
  const { manifest, manifestId } = await lade(pool, 150_000);
  await halte(pool, k, manifest.blobId, manifestId);
  const jobs = await provider.pollOnce();
  assert.equal(jobs.length, 1);
  const st = storage.stats();
  assert.ok(st.gehalten > 0 && st.gehalten < new Set(manifest.shardHashes).size, `teilweise gehalten (${st.gehalten})`);
  assert.ok(st.gehaltenBytes <= 140_000, "nie über die Quota");
  assert.match(jobs[0]!.outputPreview, new RegExp(`/${manifest.shardHashes.length} Stücke gehalten$`), "die Antwort sagt, wie viele");
});
