/** Roundtrip-Test fuer blob.ts: chunk -> erasure -> shards verlieren -> rekonstruieren. */
import { buildBlob, assembleBlob, parseBlobManifest, pickBlobClass } from "../src/blob.js";

async function main() {
  // 1. Testdaten: 300KB "foto" (small-Klasse, 5 data shards a 64KB)
  const photo = new Uint8Array(300_000);
  for (let i = 0; i < photo.length; i++) photo[i] = (i * 7 + 13) % 256;

  const cls = pickBlobClass(photo.length);
  console.log("klasse:", cls.name, "chunk:", cls.chunkSize);

  const { manifest, manifestEvent, chunkEvents } = await buildBlob(
    { name: "foto.jpg", mime: "image/jpeg", bytes: photo },
    "a".repeat(64),
  );
  console.log("shards gesamt:", chunkEvents.length, "(data", manifest.dataShards, "+ parity", manifest.parityShards, ")");

  // 2. Manifest-Event parsen
  const parsed = parseBlobManifest(manifestEvent);
  if (parsed.blobId !== manifest.blobId) throw new Error("manifest-id mismatch");

  // 3. Alle Chunks sammeln -> vollstaendig
  const all = new Map<number, string>();
  for (const ev of chunkEvents) {
    const idx = Number(ev.tags.find((t) => t[0] === "index")![1]);
    all.set(idx, ev.content);
  }
  const r1 = await assembleBlob(parsed, all);
  console.log("alle shards: complete =", r1.complete, "bytes gleich:", Buffer.from(r1.bytes).equals(Buffer.from(photo)));

  // 4. Haelfte der PARITY-Shards verlieren (8 von 8 weg -> nur data da)
  const noParity = new Map(all);
  for (const ev of chunkEvents) {
    const idx = Number(ev.tags.find((t) => t[0] === "index")![1]);
    if (idx >= manifest.dataShards) noParity.delete(idx);
  }
  const r2 = await assembleBlob(parsed, noParity);
  console.log("ohne parity: complete =", r2.complete);

  // 5. 6 data-Shards verlieren (RS muss rekonstruieren)
  const damaged = new Map(all);
  for (let i = 0; i < 6; i++) damaged.delete(i);
  const r3 = await assembleBlob(parsed, damaged);
  console.log("6 data-shards weg: complete =", r3.complete, "bytes gleich:", Buffer.from(r3.bytes).equals(Buffer.from(photo)));

  // 6. ZU viele weg (9 data + 8 parity = rekonstruierbar? nein: nur 7 von 16 data da)
  const broken = new Map(all);
  for (let i = 0; i < 9; i++) broken.delete(i);
  const r4 = await assembleBlob(parsed, broken);
  console.log("zu viele weg: complete =", r4.complete, "(erwartet: false)");

  // 7. Korrupter Shard wird ignoriert (hash-mismatch)
  const corrupt = new Map(all);
  corrupt.set(0, "ff".repeat(manifest.chunkSize));
  const r5 = await assembleBlob(parsed, corrupt);
  console.log("1 korrupt: complete =", r5.complete, "bytes gleich:", Buffer.from(r5.bytes).equals(Buffer.from(photo)));

  // 8. large-Klasse check
  const big = pickBlobClass(200 * 1024 * 1024);
  console.log("200MB -> klasse:", big.name, "(erwartet: large)");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
