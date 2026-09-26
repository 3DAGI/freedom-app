/**
 * Schritt 8.9a – Abnahme: Datei nach Ausfall zweier Speicherknoten
 * wiederhergestellt.
 *
 * Vier Speicherknoten halten je 12 der 24 Stuecke einer verschluesselten
 * Datei (versetzt, 16 genuegen). Das Relay hat die Stuecke verloren, nur das
 * Manifest ist noch da. Zwei Knoten fallen aus – fuer jedes der sechs Paare.
 * Die Kundin fragt die uebrigen versiegelt ab; sie veroeffentlichen ihre
 * Stuecke erneut, die Datei wird zusammengesetzt und entschluesselt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_BLOB_CHUNK, LocalSigner, MemoryRelay, OutboxPool, assembleBlob, baueStueckAbruf, buildBlob,
  entschluesseleDatei, generateKeypair, getTag, openPrivateJobResponse, parseBlobManifest, sha256, signEvent,
  toHex, verschluesseleDatei, type NostrEvent,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { StorageRole } from "../src/storage-role.js";
import type { InferenceBackend } from "../src/inference.js";

const keinLlm: InferenceBackend = {
  name: () => "keins", available: async () => true,
  complete: async () => { throw new Error("kein LLM fuer Speicher-Abrufe"); },
};

const KLARTEXT = new TextEncoder().encode("Vertrauliches Protokoll der Sitzung vom 3. Mai. ".repeat(4000)); // ~190 KB

async function hochladen() {
  const ich = generateKeypair();
  const { chiffrat, schluessel } = verschluesseleDatei(KLARTEXT);
  const b = await buildBlob({ name: "", mime: "application/octet-stream", bytes: chiffrat }, ich.pk, { verschluesselt: true });
  return {
    schluessel,
    manifest: signEvent(b.manifestEvent, ich.sk),
    stuecke: b.chunkEvents.map((ev) => signEvent(ev, ich.sk)),
  };
}

async function knoten(relay: MemoryRelay, dirs: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "freedom-speicher-"));
  dirs.push(dir);
  const storage = new StorageRole({ dir, quotaBytes: 0, bootstrapSeeder: false });
  await storage.init();
  const kp = generateKeypair();
  const provider = new DvmProvider({
    keypair: kp, lud16: "k@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", privatePowBits: 0,
  }, new OutboxPool([relay], { minAcks: 1 }), keinLlm, undefined, storage);
  return { kp, storage, provider };
}

test("8.9a ABNAHME: Datei nach Ausfall zweier Speicherknoten wiederhergestellt – fuer jedes Paar", async () => {
  const dirs: string[] = [];
  try {
    const { schluessel, manifest, stuecke } = await hochladen();
    assert.equal(stuecke.length, 24);
    const paare = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (const ausfall of paare) {
      const relay = new MemoryRelay(`mem://speicher-${ausfall.join("")}`);
      await relay.publish(manifest); // das Relay hat nur noch das Manifest
      const alle = await Promise.all([0, 1, 2, 3].map(() => knoten(relay, dirs)));
      // Knoten k haelt die Stuecke 6k … 6k+11 (reihum)
      for (const [k, n] of alle.entries()) {
        for (let j = 0; j < 12; j++) assert.deepEqual(await n.storage.nimmAuf(stuecke[(6 * k + j) % 24]!), { ok: true });
      }
      const lebend = alle.filter((_, k) => !ausfall.includes(k));
      const sitzung = new LocalSigner(generateKeypair().sk);
      for (const n of lebend) {
        for (let i = 0; i < 24; i++) {
          const { wrap } = await baueStueckAbruf({ sitzung, knotenPk: n.kp.pk, blobId: getTag(manifest, "blob")!, index: i });
          await relay.publish(wrap);
        }
      }
      for (const n of lebend) await n.provider.pollOnce();

      // Wie die App: Stuecke vom Relay, gegen das Manifest geprueft
      const m = parseBlobManifest(manifest);
      const vomRelay = await relay.query({ kinds: [KIND_BLOB_CHUNK], "#blob": [m.blobId] });
      const karte = new Map<number, string>();
      for (const ev of vomRelay) {
        const idx = Number(getTag(ev, "index"));
        if (m.shardHashes[idx] === toHex(sha256(Uint8Array.from(ev.content.match(/../g)!, (h) => parseInt(h, 16))))) karte.set(idx, ev.content);
      }
      assert.ok(karte.size >= 16, `Ausfall ${ausfall}: nur ${karte.size} Stücke`);
      const r = await assembleBlob(m, karte);
      assert.equal(r.complete, true, `Ausfall ${ausfall}`);
      assert.deepEqual(entschluesseleDatei(r.bytes, schluessel), KLARTEXT);

      // Antworten versiegelt an die Sitzung: „veroeffentlicht“ fuer Gehaltenes, sonst Absage
      const antworten = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
      const ok = antworten.filter((a) => a.ok && a.response.kind === 6075);
      const absagen = antworten.filter((a) => a.ok && a.response.kind === 7000);
      assert.equal(ok.length, 24, "zwei Knoten je 12");
      assert.equal(absagen.length, 24);
      assert.ok(!(await relay.query({ kinds: [5075, 6075] })).length, "Abruf und Antwort nie offen");
    }
  } finally {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  }
});

test("8.9a: nur zwei von vier Knoten mit je 12 Stuecken – ein einzelner reicht nicht", async () => {
  const dirs: string[] = [];
  try {
    const { manifest, stuecke } = await hochladen();
    const relay = new MemoryRelay("mem://speicher-einer");
    await relay.publish(manifest);
    const n = await knoten(relay, dirs);
    for (let j = 0; j < 12; j++) await n.storage.nimmAuf(stuecke[j]!);
    const sitzung = new LocalSigner(generateKeypair().sk);
    for (let i = 0; i < 24; i++) await relay.publish((await baueStueckAbruf({ sitzung, knotenPk: n.kp.pk, blobId: getTag(manifest, "blob")!, index: i })).wrap);
    await n.provider.pollOnce();
    const m = parseBlobManifest(manifest);
    const karte = new Map((await relay.query({ kinds: [KIND_BLOB_CHUNK] })).map((ev) => [Number(getTag(ev, "index")), ev.content] as [number, string]));
    assert.equal(karte.size, 12);
    assert.equal((await assembleBlob(m, karte)).complete, false);
  } finally {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  }
});

test("8.9a: der Knoten nimmt Klartext nicht auf – auch nicht mit Kennzeichen", async () => {
  const dirs: string[] = [];
  try {
    const relay = new MemoryRelay("mem://speicher-klartext");
    const n = await knoten(relay, dirs);
    const ich = generateKeypair();
    const offen = await buildBlob({ name: "notiz.txt", mime: "text/plain", bytes: KLARTEXT }, ich.pk);
    const luege = await buildBlob({ name: "", mime: "application/octet-stream", bytes: KLARTEXT }, ich.pk, { verschluesselt: true });
    const r1 = await n.storage.nimmAuf(signEvent(offen.chunkEvents[0]!, ich.sk) as NostrEvent);
    const r2 = await n.storage.nimmAuf(signEvent(luege.chunkEvents[0]!, ich.sk) as NostrEvent);
    assert.deepEqual(r1, { ok: false, grund: "nicht als verschlüsselt gekennzeichnet" });
    assert.deepEqual(r2, { ok: false, grund: "sieht nicht verschlüsselt aus" });
    assert.equal(n.storage.stats().chunks, 0);
    // Ein Abruf eines nicht gehaltenen Stuecks: Absage, nichts veroeffentlicht
    const sitzung = new LocalSigner(generateKeypair().sk);
    await relay.publish((await baueStueckAbruf({ sitzung, knotenPk: n.kp.pk, blobId: "ab".repeat(32), index: 0 })).wrap);
    await n.provider.pollOnce();
    assert.equal((await relay.query({ kinds: [KIND_BLOB_CHUNK] })).length, 0);
  } finally {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  }
});
