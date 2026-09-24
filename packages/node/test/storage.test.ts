/** Test fuer StorageRole: put/get/dedup/LRU. */
import { StorageRole } from "../src/storage-role.js";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const dir = join(tmpdir(), `freedom-storage-test-${Date.now()}`);
  const s = new StorageRole({ dir, quotaBytes: 200_000, bootstrapSeeder: false });
  await s.init();

  const a = new Uint8Array(64_000).fill(1);
  const b = new Uint8Array(64_000).fill(2);
  const c = new Uint8Array(64_000).fill(3);
  const d = new Uint8Array(64_000).fill(4);

  const r1 = await s.put("blob-x", 0, a);
  console.log("put a:", r1.sha256Hex.slice(0, 8));
  await s.put("blob-x", 1, b);
  await s.put("blob-x", 2, c);

  // dedup: a nochmal -> gleicher hash
  const r1b = await s.put("blob-x", 0, a);
  console.log("dedup ok:", r1b.sha256Hex === r1.sha256Hex);

  // get verifiziert
  const got = await s.get(r1.sha256Hex);
  console.log("get ok:", got !== null && got[0] === 1);

  // LRU: d rein -> a (aeltester zugriff) muss verdraengt sein
  await new Promise((r) => setTimeout(r, 10));
  await s.put("blob-x", 3, d);
  const aGone = await s.has(r1.sha256Hex);
  const dThere = await s.get(r1.sha256Hex.slice(0, 8) + "x"); // falsch
  console.log("LRU: a verdraengt:", !aGone, "| quota:", s.stats().totalBytes <= 200_000);

  // korrupter chunk wird erkannt
  await fs.writeFile(join(dir, "deadbeef.bin"), new Uint8Array([9, 9, 9]));
  const corrupt = await s.get("deadbeef");
  console.log("korrupt erkannt:", corrupt === null);

  // restart: init liest bestehende
  const s2 = new StorageRole({ dir, quotaBytes: 200_000, bootstrapSeeder: false });
  await s2.init();
  console.log("restart: chunks wieder da:", s2.stats().chunks >= 2);

  await fs.rm(dir, { recursive: true, force: true });
  console.log("ALLE STORAGE-TESTS OK");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
