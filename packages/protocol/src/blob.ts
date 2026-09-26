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
 *
 * Seit 8.9a: Speicherknoten halten NUR Verschluesseltes. Wer verschluesselt
 * hochlaedt, kennzeichnet Manifest und Stuecke mit ["verschluesselt", "1"];
 * jedes Stueck nennt ausserdem Groesse und Erasure-Parameter, damit ein Knoten
 * es ohne Manifest pruefen kann (`pruefeSpeicherStueck`). Beweisen kann ein
 * Knoten Verschluesselung nicht – er prueft das Kennzeichen und ob der echte
 * Datenbereich wie Zufall aussieht. Das faengt Text und Rohdaten, nicht
 * komprimierte Medien (JPEG, ZIP), die ebenfalls zufaellig wirken.
 */
import { sha256, toHex } from "./htlc.js";
import { UnsignedEvent, buildEvent, getTag } from "./event.js";
import { KIND_BLOB_MANIFEST, KIND_BLOB_CHUNK, KIND_DVM_BLOB_FETCH } from "./kinds.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";

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
  opts: { verschluesselt?: boolean } = {},
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
    ...(opts.verschluesselt ? { encrypted: true } : {}),
  };
  const marke = opts.verschluesselt ? [["verschluesselt", "1"]] : [];

  // Manifest-Event: content = JSON, tags mit blob-id fuer Discovery
  const manifestEvent = buildEvent(uploaderPubkey, KIND_BLOB_MANIFEST, [
    ["blob", blobId],
    ["name", file.name],
    ["mime", file.mime],
    ["size", String(file.bytes.length)],
    ["class", cls.name],
    ["shards", String(allShards.length)],
    ...marke,
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
      // Seit 8.9a: damit ein Speicherknoten das Stueck ohne Manifest pruefen kann
      ["size", String(file.bytes.length)],
      ["data-shards", String(cls.dataShards)],
      ["parity-shards", String(cls.parityShards)],
      ...marke,
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

// ------------------------------------------------ Speicherknoten (8.9a)

/**
 * Wie viele Bytes am Anfang dieses Stuecks echte Daten sind; der Rest ist
 * Fuellung aus Nullen. Daten-Stueck k deckt [k·C, (k+1)·C) der Datei, ein
 * Paritaets-Stueck ist eine Linearkombination der Daten-Stuecke seiner Gruppe –
 * also so lang wie deren laengstes.
 */
export function nutzLaenge(index: number, groesse: number, chunkSize: number, daten: number, paritaet: number): number {
  const gruppe = Math.floor(index / (daten + paritaet));
  const pos = index % (daten + paritaet);
  const start = pos < daten ? (gruppe * daten + pos) * chunkSize : gruppe * daten * chunkSize;
  return Math.max(0, Math.min(chunkSize, groesse - start));
}

/**
 * Sieht das aus wie Zufall (Chiffrat)? Ab 1024 Byte Chi-Quadrat ueber die
 * Byte-Haeufigkeiten (Zufall: im Mittel 255, Streuung ~23 – Grenze 400);
 * darunter die Zahl verschiedener Bytewerte gegen die erwartete.
 */
export function wirktZufaellig(bytes: Uint8Array): boolean {
  const n = bytes.length;
  if (n === 0) return true;
  const zaehler = new Uint32Array(256);
  for (const b of bytes) zaehler[b]++;
  if (n >= 1024) {
    const erwartet = n / 256;
    let chi = 0;
    for (const z of zaehler) chi += (z - erwartet) ** 2 / erwartet;
    return chi < 400;
  }
  let verschieden = 0;
  for (const z of zaehler) if (z > 0) verschieden++;
  const erwartet = 256 * (1 - (255 / 256) ** n);
  return verschieden >= Math.floor(erwartet * 0.8);
}

const HEX = /^(?:[0-9a-f]{2})*$/;
const ZAHL = /^\d{1,12}$/;

export type SpeicherPruefung =
  | { ok: true; blobId: string; index: number; bytes: Uint8Array }
  | { ok: false; grund: string };

/**
 * Darf ein Speicherknoten dieses Stueck halten? Nur mit Kennzeichen, in
 * gueltiger Form, passendem Hash, Nullen in der Fuellung und einem
 * Datenbereich, der wie Zufall aussieht.
 */
export function pruefeSpeicherStueck(ev: UnsignedEvent): SpeicherPruefung {
  if (ev.kind !== KIND_BLOB_CHUNK) return { ok: false, grund: "kein Blob-Stück" };
  if (getTag(ev, "verschluesselt") !== "1") return { ok: false, grund: "nicht als verschlüsselt gekennzeichnet" };
  const blobId = getTag(ev, "blob") ?? "";
  const sha = getTag(ev, "sha256") ?? "";
  const zahlen = ["index", "total", "chunk-size", "size", "data-shards", "parity-shards"].map((t) => getTag(ev, t) ?? "");
  if (!/^[0-9a-f]{64}$/.test(blobId) || !/^[0-9a-f]{64}$/.test(sha) || !zahlen.every((z) => ZAHL.test(z))) {
    return { ok: false, grund: "Stück unvollständig" };
  }
  const [index, total, chunkSize, groesse, daten, paritaet] = zahlen.map(Number) as [number, number, number, number, number, number];
  if (daten < 1 || paritaet < 0 || total % (daten + paritaet) !== 0 || index >= total || chunkSize < 1 || chunkSize > 1024 * 1024) {
    return { ok: false, grund: "Erasure-Angaben unstimmig" };
  }
  if (!HEX.test(ev.content) || ev.content.length !== chunkSize * 2) return { ok: false, grund: "Inhalt kein Hex der angegebenen Länge" };
  const bytes = hexToBytes(ev.content);
  if (toHex(sha256(bytes)) !== sha) return { ok: false, grund: "Hash passt nicht" };
  const nutz = nutzLaenge(index, groesse, chunkSize, daten, paritaet);
  for (let i = nutz; i < bytes.length; i++) if (bytes[i] !== 0) return { ok: false, grund: "Füllung nicht leer" };
  if (!wirktZufaellig(bytes.subarray(0, nutz))) return { ok: false, grund: "sieht nicht verschlüsselt aus" };
  return { ok: true, blobId, index, bytes };
}

/**
 * Abruf bei einem Speicherknoten (8.9a), versiegelt vom Sitzungsschluessel:
 * „Veroeffentliche Stueck `index` von `blobId` wieder.“ Das Stueck selbst
 * passt in keinen Umschlag (64 KB als Hex, NIP-44 fasst 64 KB) – der Knoten
 * veroeffentlicht das gespeicherte, ohnehin oeffentliche Stueck-Event erneut
 * und antwortet versiegelt, ob er es hatte. Bezahlung folgt mit 8.9c.
 */
export async function baueStueckAbruf(p: {
  sitzung: Signer; knotenPk: string; blobId: string; index: number; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  if (!/^[0-9a-f]{64}$/.test(p.blobId) || !Number.isInteger(p.index) || p.index < 0) throw new Error("Abruf ungültig");
  const request = buildJobRequest({
    kind: KIND_DVM_BLOB_FETCH, customerPubkey: p.sitzung.publicKey(), input: p.blobId, bidMsat: 0,
    providerPubkey: p.knotenPk, params: [["shard", String(p.index)]],
  }, p.nowSecs);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.knotenPk, powBits: p.powBits, nowSecs: p.nowSecs });
}
