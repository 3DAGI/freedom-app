/**
 * Tests fuer die Storage-Rolle.
 *
 * Sie haelt fremde Daten auf der Platte des Betreibers. Der Schwerpunkt liegt
 * deshalb auf dem, was schiefgehen kann, ohne dass es auffaellt: ein Chunk,
 * der nicht das ist, was er zu sein vorgibt, und eine Quote, die nicht haelt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StorageRole } from "../src/storage-role.js";

const daten = (s: string) => new TextEncoder().encode(s);
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function mitSpeicher<T>(
  fn: (s: StorageRole, dir: string) => Promise<T>,
  quotaBytes = 1_000_000,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "freedom-store-"));
  try {
    const s = new StorageRole({ dir, quotaBytes, bootstrapSeeder: false });
    await s.init();
    return await fn(s, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Chunk ablegen und wiederfinden", async () => {
  await mitSpeicher(async (s) => {
    const b = daten("ein shard");
    await s.put("blob1", 0, b);
    assert.deepEqual(await s.getByBlobIndex("blob1", 0), b);
    assert.deepEqual(await s.get(hash(b)), b);
  });
});

test("Chunks werden ueber ihren Inhalt adressiert", async () => {
  // Der Hash ist die Adresse: Ein Chunk, der nicht das ist, was er zu sein
  // vorgibt, ist damit nicht auffindbar statt still falsch.
  await mitSpeicher(async (s) => {
    const b = daten("inhalt");
    await s.put("blob1", 0, b);
    assert.equal(await s.has(hash(b)), true);
    assert.equal(await s.has(hash(daten("etwas anderes"))), false);
    assert.equal(await s.get(hash(daten("etwas anderes"))), null);
  });
});

test("Nicht vorhandene Chunks geben null, nicht undefined oder Fehler", async () => {
  await mitSpeicher(async (s) => {
    assert.equal(await s.getByBlobIndex("gibtesnicht", 0), null);
    assert.equal(await s.get("0".repeat(64)), null);
  });
});

test("Derselbe Inhalt wird nicht doppelt abgelegt", async () => {
  // Zwei Blobs koennen denselben Shard enthalten — ihn zweimal zu speichern
  // waere verschenkter Platz auf fremder Hardware.
  await mitSpeicher(async (s, dir) => {
    const b = daten("gleicher inhalt");
    await s.put("blob1", 0, b);
    await s.put("blob2", 0, b);
    const chunkDateien = (await readdir(dir)).filter((f) => f.endsWith(".bin"));
    assert.equal(chunkDateien.length, 1, "derselbe Inhalt liegt genau einmal");
  });
});

test("Quote haelt: aelteste Chunks werden verdraengt", async () => {
  // Ohne harte Grenze laeuft die Platte des Betreibers voll — und er merkt es
  // erst, wenn sein System nicht mehr startet. Verdraengen ist hier richtiger
  // als Ablehnen: Ein Seeder soll neue Daten annehmen koennen.
  await mitSpeicher(async (s) => {
    const a = new Uint8Array(400).fill(65);
    await s.put("b", 0, a);
    await s.put("b", 1, new Uint8Array(400).fill(66));
    await s.put("b", 2, new Uint8Array(400).fill(67));

    assert.ok(s.stats().totalBytes <= 1000, `${s.stats().totalBytes} Byte ueber der Quote`);
    assert.equal(await s.get(hash(a)), null, "der aelteste ist weg");
  }, 1000);
});

test("Bootstrap-Seeder verdraengt nie", async () => {
  // In der Startphase des Netzes ist Vollstaendigkeit wichtiger als die
  // Plattengrenze — das muss aber eine bewusste Entscheidung sein.
  const dir = await mkdtemp(join(tmpdir(), "freedom-store-"));
  try {
    const s = new StorageRole({ dir, quotaBytes: 500, bootstrapSeeder: true });
    await s.init();
    const a = new Uint8Array(400).fill(65);
    await s.put("b", 0, a);
    await s.put("b", 1, new Uint8Array(400).fill(66));
    assert.deepEqual(await s.get(hash(a)), a, "nichts wird verdraengt");
    assert.ok(s.stats().totalBytes > 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Statistik meldet den tatsaechlichen Verbrauch", async () => {
  await mitSpeicher(async (s) => {
    await s.put("b", 0, new Uint8Array(100));
    await s.put("b", 1, new Uint8Array(250));
    const st = s.stats();
    assert.equal(st.chunks, 2);
    assert.equal(st.totalBytes, 350);
    assert.ok(st.quotaBytes >= st.totalBytes);
  });
});

test("Bestand ueberlebt einen Neustart", async () => {
  // Ein Seeder, der nach jedem Neustart leer ist, traegt nichts bei — und
  // meldet trotzdem, er halte etwas vor.
  const dir = await mkdtemp(join(tmpdir(), "freedom-store-"));
  try {
    const b = daten("bleibt");
    const a = new StorageRole({ dir, quotaBytes: 1_000_000, bootstrapSeeder: false });
    await a.init();
    await a.put("blob1", 0, b);

    const c = new StorageRole({ dir, quotaBytes: 1_000_000, bootstrapSeeder: false });
    await c.init();
    assert.deepEqual(await c.get(hash(b)), b);
    assert.equal(c.stats().chunks, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Statistik meldet den Bootstrap-Modus mit", async () => {
  // Ein Betreiber soll sehen koennen, ob sein Knoten gerade unbegrenzt
  // sammelt — sonst wundert er sich ueber die volle Platte.
  await mitSpeicher(async (s) => {
    assert.equal(s.stats().bootstrap, false);
  });
});
