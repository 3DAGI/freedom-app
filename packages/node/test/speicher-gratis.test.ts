/**
 * Schritt E9-2 (V2 A aus `docs/E9-ENTWURF.md`): Ein Speicherknoten hält gratis
 * nur bis zu der Größe, die er nennt (`STORAGE_GRATIS_MB`) – Stücke größerer
 * Dateien nimmt er nicht auf, außer für seinen Besitzer. Im Angebot steht die
 * Grenze als vierter Wert im `storage`-Tag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBlob, generateKeypair, signEvent, verschluesseleDatei, type NostrEvent } from "@freedomstack/protocol";
import { StorageRole, speicherGratisAusUmgebung } from "../src/storage-role.js";

const MB = 1024 * 1024;

async function stuecke(bytes: number): Promise<NostrEvent[]> {
  const ich = generateKeypair();
  const { chiffrat } = verschluesseleDatei(new Uint8Array(bytes).fill(7));
  const b = await buildBlob({ name: "", mime: "application/octet-stream", bytes: chiffrat }, ich.pk, { verschluesselt: true });
  return b.chunkEvents.map((ev) => signEvent(ev, ich.sk) as NostrEvent);
}

test("STORAGE_GRATIS_MB: leer heißt keine Grenze, ganze MB bis 1 TiB, sonst kein Start", () => {
  assert.deepEqual(speicherGratisAusUmgebung({}), {});
  assert.deepEqual(speicherGratisAusUmgebung({ STORAGE_GRATIS_MB: " " }), {});
  assert.deepEqual(speicherGratisAusUmgebung({ STORAGE_GRATIS_MB: "50" }), { gratisBytes: 50 * MB });
  assert.deepEqual(speicherGratisAusUmgebung({ STORAGE_GRATIS_MB: "0" }), { gratisBytes: 0 });
  assert.deepEqual(speicherGratisAusUmgebung({ STORAGE_GRATIS_MB: "1048576" }), { gratisBytes: 2 ** 40 });
  for (const roh of ["-1", "1.5", "5e3", "050", "1048577", "zehn"]) assert.ok(speicherGratisAusUmgebung({ STORAGE_GRATIS_MB: roh }).grund, roh);
});

test("Gratis nur bis zur Grenze: größere Dateien nimmt der Knoten nicht auf – für den Besitzer schon", async () => {
  const dir = await mkdtemp(join(tmpdir(), "speicher-gratis-"));
  try {
    const s = new StorageRole({ dir, quotaBytes: 50 * MB, bootstrapSeeder: false, gratisBytes: 100_000 });
    await s.init();
    const klein = await stuecke(50_000);
    const gross = await stuecke(300_000);
    assert.deepEqual(await s.nimmAuf(klein[0]!), { ok: true });
    assert.deepEqual(await s.nimmAuf(gross[0]!), { ok: false, grund: "größer als gratis" });
    assert.equal(s.stats().chunks, 1, "das große Stück liegt nicht da");
    assert.deepEqual(await s.nimmAuf(gross[0]!, { halten: true }), { ok: true }, "der Besitzer hält auch Größeres");
    // Ohne Grenze wie bisher
    const ohne = new StorageRole({ dir: join(dir, "ohne"), quotaBytes: 50 * MB, bootstrapSeeder: false });
    await ohne.init();
    assert.deepEqual(await ohne.nimmAuf(gross[1]!), { ok: true });
    // Null heißt: nichts gratis
    const null0 = new StorageRole({ dir: join(dir, "null"), quotaBytes: 50 * MB, bootstrapSeeder: false, gratisBytes: 0 });
    await null0.init();
    assert.equal((await null0.nimmAuf(klein[1]!)).ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Verdrahtet: main.ts liest STORAGE_GRATIS_MB (ungültig → kein Start), gibt es beiden Speicher-Rollen und dem Angebot", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const speicherGratis = speicherGratisAusUmgebung\(process\.env\);\n  if \(speicherGratis\.grund\) \{\n    console\.error\(`\[speicher\] \$\{speicherGratis\.grund\} – der Knoten startet nicht`\);\n    process\.exit\(1\);/);
  assert.equal(main.match(/\.\.\.\(speicherGratis\.gratisBytes !== undefined \? \{ gratisBytes: speicherGratis\.gratisBytes \} : \{\}\),/g)?.length, 3, "zwei Speicher-Rollen und das Angebot");
});
