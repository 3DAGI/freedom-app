/**
 * Blob-Storage: torrent-artige, dezentrale Dateiablage über Nostr.
 *
 * Prinzip:
 * - Dateien werden in Chunks geschnitten (2 Klassen: small=64KB, large=1MB)
 * - Erasure Coding (Reed-Solomon): aus N Daten-Chunks werden N+M Gesamt-Chunks,
 *   die Datei ist aus JEDEM beliebigen N Chunks rekonstruierbar
 * - Jeder Chunk = signiertes Nostr-Event (BLOB_CHUNK, sha256-adressiert → Dedup gratis)
 * - Manifest = "Torrent-Datei" (BLOB_MANIFEST): Chunk-Hashes, Klasse, Erasure-Parameter
 * - Läuft über Relays UND FileRelay/Mesh (normale Events, offline-fähig)
 * - Seeder halten Chunks und werden pro Fetch bezahlt (siehe node Storage-Rolle)
 *
 * Kinds:
 *   38040 BLOB_MANIFEST — Metadaten + Chunk-Hashliste
 *   38041 BLOB_CHUNK    — ein Erasure-Shard (content-addressed)
 */
import { sha256, toHex } from "./htlc.js";
import { UnsignedEvent, buildEvent, getTag } from "./event.js";
import { KIND_BLOB_MANIFEST, KIND_BLOB_CHUNK } from "./kinds.js";

// ------------------------------------------------------------- Konstanten

export interface BlobClass {
  name: "small" | "large";
  chunkSize: number;
  dataShards: number;
  parityShards: number;
  /** Ab dieser Dateigröße wird die Klasse genutzt. */
  minBytes: number;
}

/** small: Fotos/Audio/Doku — kleine Chunks fuer Mesh-Transfer (USB/QR). */
export const BLOB_CLASS_SMALL: BlobClass = {
  name: "small",
  chunkSize: 64 * 1024,          // 64KB
  dataShards: 16,
  parityShards: 8,               // 50% Redundanz: ueberlebt Verlust von 1/3 der Seeder
  minBytes: 0,
};

/** large: Coding-Projekte/grosse Videos — weniger Events pro GB. */
export const BLOB_CLASS_LARGE: BlobClass = {
  name: "large",
  chunkSize: 1024 * 1024,        // 1MB
  dataShards: 16,
  parityShards: 8,
  minBytes: 100 * 1024 * 1024,   // ab 100MB
};

export const BLOB_CLASSES = [BLOB_CLASS_SMALL, BLOB_CLASS_LARGE];

/** Waehlt die passende Chunk-Klasse nach Dateigroesse. */
export function pickBlobClass(sizeBytes: number): BlobClass {
  let chosen = BLOB_CLASS_SMALL;
  for (const c of BLOB_CLASSES) {
    if (sizeBytes >= c.minBytes) chosen = c;
  }
  return chosen;
}

// ------------------------------------------------------------- Typen

export interface BlobManifest {
  /** Content-Hash des GESAMTEN Originals (hex). Identitaet der Datei. */
  blobId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  className: "small" | "large";
  chunkSize: number;
  dataShards: number;
  parityShards: number;
  /** Alle Shard-Hashes (hex), Reihenfolge = Shard-Index. Laenge = data+parity. */
  shardHashes: string[];
  /** Optional: verschluesseltes Manifest (privater Blob) — dann sind name/mime leer. */
  encrypted?: boolean;
}

export interface ParsedShardRef {
  blobId: string;
  shardIndex: number;
  shardHash: string;
  data: Uint8Array;
}

// ------------------------------------------------------------- Chunking

/** Teilt Bytes in dataShards-grosse Daten-Shards (letzter gepaddet). */
function sliceIntoDataShards(bytes: Uint8Array, cls: BlobClass): Uint8Array[] {
  const shards: Uint8Array[] = [];
  for (let off = 0; off < bytes.length; off += cls.chunkSize) {
    shards.push(bytes.subarray(off, Math.min(off + cls.chunkSize, bytes.length)));
  }
  // mindestens 1 Shard; letzten auf chunkSize padden (Erasure braucht gleiche Laengen)
  while (shards.length % cls.dataShards !== 0 || shards.length === 0) {
    shards.push(new Uint8Array(cls.chunkSize));
  }
  // alle Shards auf volle Chunk-Groesse bringen (letzter ist evtl. kuerzer)
  return shards.map((s) => {
    if (s.length === cls.chunkSize) return s;
    const padded = new Uint8Array(cls.chunkSize);
    padded.set(s);
    return padded;
  });
}

/** Reed-Solomon: erzeugt parityShards zusaetzliche Shards. */
async function erasureEncode(dataShards: Uint8Array[], cls: BlobClass): Promise<Uint8Array[]> {
  // Gruppenweise verarbeiten (RS arbeitet auf einer Gruppe von dataShards Stueck)
  const { encode } = await import("wasm-reed-solomon-erasure");
  const out: Uint8Array[] = [];
  for (let g = 0; g < dataShards.length; g += cls.dataShards) {
    const group = dataShards.slice(g, g + cls.dataShards);
    const encoded = encode(group as unknown as Uint8Array[], cls.parityShards);
    out.push(...(encoded as unknown as Uint8Array[]));
  }
  return out;
}

/** Rekonstruiert fehlende DATA-Shards. shards = [data... parity...].
 *  WICHTIG: RS-Gruppen bestehen NUR aus den dataShards; die parity-Shards
 *  der jeweiligen Gruppe stehen direkt dahinter (gleiche Gruppen-Groesse). */
async function erasureReconstruct(shards: (Uint8Array | null)[], cls: BlobClass): Promise<Uint8Array[] | null> {
  const { reconstruct } = await import("wasm-reed-solomon-erasure");
  const totalData = cls.dataShards * Math.ceil(shards.length / (cls.dataShards + cls.parityShards));
  const out: Uint8Array[] = [];
  // gruppen ueber data+parity zusammen: [d0..d15, p0..p7] pro RS-gruppe
  for (let g = 0; g < totalData + (shards.length - totalData); g += cls.dataShards + cls.parityShards) {
    const groupRaw = shards.slice(g, Math.min(g + cls.dataShards + cls.parityShards, shards.length));
    if (groupRaw.length === 0) break;
    // tote shards MUESSEN length 0 haben (lib-erkennung), nicht null-bytes voller laenge
    const groupAll = groupRaw.map((s) => (s && s.length > 0 ? s : new Uint8Array(0)));
    const dead: number[] = [];
    groupAll.forEach((s, i) => { if (!s || s.length === 0) dead.push(i); });
    if (dead.length > cls.parityShards) return null;
    if (dead.length === 0) {
      out.push(...(groupAll as Uint8Array[]));
      continue;
    }
    const rec = reconstruct(groupAll as unknown as Uint8Array[], cls.parityShards, Uint32Array.from(dead));
    if (!rec) return null;
    out.push(...(rec as unknown as Uint8Array[]));
  }
  return out.slice(0, totalData);
}

// ------------------------------------------------------------- Upload

export interface BuildBlobResult {
  manifest: BlobManifest;
  manifestEvent: UnsignedEvent;
  /** Ein Event pro Shard (data+parity). */
  chunkEvents: UnsignedEvent[];
}

/** Zerlegt eine Datei in Chunk-Events + Manifest-Event. (Noch NICHT signiert.) */
export async function buildBlob(
  file: { name: string; mime: string; bytes: Uint8Array },
  uploaderPubkey: string,
): Promise<BuildBlobResult> {
  const cls = pickBlobClass(file.bytes.length);
  const blobId = toHex(sha256(file.bytes));

  const dataShards = sliceIntoDataShards(file.bytes, cls);
  const allShards = await erasureEncode(dataShards, cls);

  const shardHashes = allShards.map((s) => toHex(sha256(s)));

  const manifest: BlobManifest = {
    blobId,
    name: file.name,
    mime: file.mime,
    sizeBytes: file.bytes.length,
    className: cls.name,
    chunkSize: cls.chunkSize,
    dataShards: cls.dataShards,
    parityShards: cls.parityShards,
    shardHashes,
  };

  // Manifest-Event: content = JSON, tags mit blob-id fuer Discovery
  const manifestEvent = buildEvent(uploaderPubkey, KIND_BLOB_MANIFEST, [
    ["blob", blobId],
    ["name", file.name],
    ["mime", file.mime],
    ["size", String(file.bytes.length)],
    ["class", cls.name],
    ["shards", String(allShards.length)],
  ], JSON.stringify(manifest));

  // Chunk-Events: content = base64 der Shard-Daten? Nein — raw-bytes als hex
  // waere 2x Groesse. Wir nutzen hex (einfach, dedup via hash im d-tag).
  const chunkEvents = allShards.map((shard, i) =>
    buildEvent(uploaderPubkey, KIND_BLOB_CHUNK, [
      ["blob", blobId],
      ["d", `${blobId}:${i}`],           // replaceable-per-index
      ["sha256", shardHashes[i]],
      ["index", String(i)],
      ["total", String(allShards.length)],
      ["chunk-size", String(cls.chunkSize)],
    ], toHex(shard)),
  );

  return { manifest, manifestEvent, chunkEvents };
}

// ------------------------------------------------------------- Download

/** Baut die Datei aus vorhandenen Chunk-Events wieder zusammen.
 *  @param chunks Map shardIndex -> hex-Daten. Mindestens dataShards noetig. */
export async function assembleBlob(
  manifest: BlobManifest,
  chunks: Map<number, string>,
): Promise<{ bytes: Uint8Array; complete: boolean }> {
  const total = manifest.shardHashes.length;
  const cls: BlobClass = {
    ...BLOB_CLASS_SMALL,
    name: manifest.className,
    chunkSize: manifest.chunkSize,
    dataShards: manifest.dataShards,
    parityShards: manifest.parityShards,
  };

  // Hash-Verifikation je vorhandenem Shard
  const shards: (Uint8Array | null)[] = new Array(total).fill(null);
  let valid = 0;
  for (const [idx, hex] of chunks) {
    if (idx < 0 || idx >= total) continue;
    const bytes = hexToBytes(hex);
    const h = toHex(sha256(bytes));
    if (h !== manifest.shardHashes[idx]) continue; // korrupt -> ignorieren
    shards[idx] = bytes;
    valid++;
  }

  if (valid < manifest.dataShards) {
    return { bytes: new Uint8Array(0), complete: false };
  }

  // Falls alle DATA-shards da: kein RS noetig (parity ist nur Backup).
  // Sonst rekonstruieren.
  let full = shards;
  const missingData = shards.slice(0, manifest.dataShards).some((s) => !s);
  if (missingData) {
    const rec = await erasureReconstruct(shards, cls);
    if (!rec) return { bytes: new Uint8Array(0), complete: false };
    full = rec;
  }

  // Data-Shards in Reihe concaten, Padding am Ende abschneiden
  const out = new Uint8Array(manifest.sizeBytes);
  let off = 0;
  for (let i = 0; i < full.length && off < manifest.sizeBytes; i++) {
    const s = full[i] ?? new Uint8Array(0);
    const take = Math.min(s.length, manifest.sizeBytes - off);
    out.set(s.subarray(0, take), off);
    off += take;
  }
  return { bytes: out, complete: true };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ------------------------------------------------------------- Parsing

export function parseBlobManifest(ev: UnsignedEvent): BlobManifest {
  if (ev.kind !== KIND_BLOB_MANIFEST) throw new Error(`kein blob-manifest: kind ${ev.kind}`);
  return JSON.parse(ev.content) as BlobManifest;
}

export function parseBlobChunk(ev: UnsignedEvent): ParsedShardRef {
  if (ev.kind !== KIND_BLOB_CHUNK) throw new Error(`kein blob-chunk: kind ${ev.kind}`);
  const blob = getTag(ev, "blob");
  const index = getTag(ev, "index");
  const sha = getTag(ev, "sha256");
  if (!blob || index === undefined || !sha) throw new Error("blob-chunk ohne tags");
  return {
    blobId: blob,
    shardIndex: Number(index),
    shardHash: sha,
    data: hexToBytes(ev.content),
  };
}
