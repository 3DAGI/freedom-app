/**
 * Blob-Client (Browser-Seite): Upload/Download ueber das Chunk-Netz.
 *
 * - Upload: Datei -> Chunks + Manifest (buildBlob aus protocol) -> publish
 *   + eigene Chunks IMMER in IndexedDB halten (man seedet automatisch selbst)
 * - Download: Manifest laden -> Chunks aus IndexedDB/Relay sammeln -> assemble
 * - Browser-Seeding: IndexedDB haelt eigene Uploads + optional gesehene Chunks
 */

import type { DateiSchluessel, NostrEvent, Signer } from "@freedomstack/protocol";

const DB_NAME = "freedom-blobs";
const STORE = "chunks";

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "hash" });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function idbPut(hash: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ hash, bytes });
    tx.oncomplete = () => { db.close(); res(); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}

async function idbGet(hash: string): Promise<Uint8Array | null> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(hash);
    req.onsuccess = () => { db.close(); res(req.result?.bytes ?? null); };
    req.onerror = () => { db.close(); rej(req.error); };
  });
}

/** Aus dem lokalen Speicher lesen – ohne IndexedDB (privates Fenster, Tests) einfach nichts. */
async function ausCache(hash: string): Promise<Uint8Array | null> {
  try { return await idbGet(hash); } catch { return null; }
}

/** Eigene Chunks + empfangene lokal halten (auto-seeding). */
export async function cacheChunk(hash: string, bytes: Uint8Array): Promise<void> {
  try { await idbPut(hash, bytes); } catch { /* quota */ }
}

export interface BlobUploadResult {
  blobId: string;
  manifestEventId: string;
}

/** Datei hochladen: chunked + erasure + als Events publizieren – signiert ueber den Signer (1.3e). */
export async function uploadBlob(
  file: File,
  pool: { publish: (ev: NostrEvent) => Promise<unknown> },
  signer: Signer,
): Promise<BlobUploadResult> {
  const { buildBlob } = await import("@freedomstack/protocol");
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { manifestEvent, chunkEvents, manifest } = await buildBlob(
    { name: file.name, mime: file.type || "application/octet-stream", bytes },
    signer.publicKey(),
  );

  // eigene chunks zuerst cachen (wir seeden unsere eigenen uploads immer)
  for (let i = 0; i < chunkEvents.length; i++) {
    const hex = chunkEvents[i].content;
    const chunkBytes = new Uint8Array(hex.length / 2);
    for (let j = 0; j < chunkBytes.length; j++) chunkBytes[j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
    await cacheChunk(manifest.shardHashes[i], chunkBytes);
  }

  // chunks publizieren (in batches um relay-flood zu vermeiden)
  const BATCH = 4;
  for (let i = 0; i < chunkEvents.length; i += BATCH) {
    await Promise.all(chunkEvents.slice(i, i + BATCH).map(async (ev) => pool.publish(await signer.signEvent(ev))));
  }
  // manifest zuletzt (entdeckt die datei erst wenn chunks verteilt sind)
  const signedManifest = await signer.signEvent(manifestEvent);
  await pool.publish(signedManifest);

  return { blobId: manifest.blobId, manifestEventId: signedManifest.id };
}

/**
 * Chat-Anhang hochladen (Schritt 2.4): nur das Chiffrat geht ins Blob-Netz,
 * ohne Name und Typ im Manifest. Der Schluessel kommt zurueck und gehoert nur
 * in die (verschluesselte) Nachricht.
 */
export async function uploadAnhang(
  file: File,
  pool: { publish: (ev: NostrEvent) => Promise<unknown> },
  signer: Signer,
): Promise<{ blobId: string; schluessel: DateiSchluessel }> {
  const { verschluesseleDatei } = await import("@freedomstack/protocol");
  const { chiffrat, schluessel } = verschluesseleDatei(new Uint8Array(await file.arrayBuffer()));
  const res = await uploadBlob(new File([chiffrat as BlobPart], "", { type: "application/octet-stream" }), pool, signer);
  return { blobId: res.blobId, schluessel };
}

/** Verschluesselte Datei oeffnen (2.4) – wirft bei Manipulation oder falschem Schluessel. */
export async function oeffneAnhang(chiffrat: Uint8Array, schluessel: DateiSchluessel): Promise<Uint8Array> {
  const { entschluesseleDatei } = await import("@freedomstack/protocol");
  return entschluesseleDatei(chiffrat, schluessel);
}

/** Datei herunterladen: manifest -> shards aus cache+relay -> rekonstruieren. */
export async function downloadBlob(
  manifestEventIdOrBlobId: string,
  pool: { query: (f: unknown) => Promise<Array<Record<string, unknown>>> },
  onProgress?: (have: number, need: number) => void,
): Promise<{ bytes: Uint8Array; name: string; mime: string } | null> {
  const { parseBlobManifest, KIND_BLOB_MANIFEST, KIND_BLOB_CHUNK } = await import("@freedomstack/protocol");

  // manifest finden (per event-id ODER per blob-tag)
  let manifests = await pool.query({ kinds: [KIND_BLOB_MANIFEST], ids: [manifestEventIdOrBlobId], limit: 1 });
  if (manifests.length === 0) {
    manifests = await pool.query({ kinds: [KIND_BLOB_MANIFEST], "#blob": [manifestEventIdOrBlobId], limit: 1 });
  }
  if (manifests.length === 0) return null;
  const manifest = parseBlobManifest(manifests[0] as never);
  const total = manifest.shardHashes.length;

  // chunks sammeln: erst lokaler cache, dann relay
  const chunks = new Map<number, string>();
  const missingShards: Array<{ idx: number; ev: Record<string, unknown> }> = [];

  for (let i = 0; i < total && chunks.size < manifest.dataShards; i++) {
    const cached = await ausCache(manifest.shardHashes[i]);
    if (cached) chunks.set(i, toHexLocal(cached));
  }
  onProgress?.(chunks.size, manifest.dataShards);

  if (chunks.size < manifest.dataShards) {
    const { sha256, toHex } = await import("@freedomstack/protocol");
    const events = await pool.query({ kinds: [KIND_BLOB_CHUNK], "#blob": [manifest.blobId], limit: 500 });
    for (const ev of events) {
      const tags = (ev.tags as string[][]) ?? [];
      const idx = Number(tags.find((t) => t[0] === "index")?.[1] ?? "-1");
      const sha = tags.find((t) => t[0] === "sha256")?.[1] ?? "";
      if (!Number.isInteger(idx) || idx < 0 || idx >= total || chunks.has(idx)) continue;
      // Gegen den Hash aus dem Manifest pruefen. Bis 2.4 stand hier der Vergleich
      // des Hex-Inhalts mit dem Hash – er schlug immer fehl, und kein Chunk vom
      // Relay wurde angenommen: Empfaenger konnten grosse Anhaenge nie laden.
      const bytes = hexToLocal(ev.content as string);
      if (sha !== manifest.shardHashes[idx] || toHex(sha256(bytes)) !== sha) continue;
      chunks.set(idx, ev.content as string);
      void cacheChunk(sha, bytes); // seeding: gefundene chunks cachen
      onProgress?.(Math.min(chunks.size, manifest.dataShards), manifest.dataShards);
      if (chunks.size >= manifest.dataShards) break;
    }
    missingShards.length = 0;
  }

  const { assembleBlob } = await import("@freedomstack/protocol");
  const result = await assembleBlob(manifest, chunks);
  if (!result.complete) return null;
  return { bytes: result.bytes, name: manifest.name, mime: manifest.mime };
}

function toHexLocal(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToLocal(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
