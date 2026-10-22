/**
 * Eine verschlüsselte Datei aus dem Blob-Netz holen (seit 11.5c2a in `repo-bundle.ts`, herausgelöst mit B-38b2 für den
 * Ton aus `sprache-auftrag.ts`): Wie beim Halten (B-9b1) Manifest und Stücke nur vom Autor des Manifests, jedes Stück
 * gegen seinen Hash; zusammengesetzt muss das Chiffrat die Blob-Id als SHA-256 haben – die Kennung ist der Inhalt, ein
 * fremdes Manifest mit derselben Id schiebt also nichts anderes unter. Dann mit dem Schlüssel entschlüsseln (`ox` prüft
 * den Klartext). Nur im Speicher; nach außen nur `null`.
 */
import {
  KIND_BLOB_CHUNK, KIND_BLOB_MANIFEST, assembleBlob, entschluesseleDatei, getTag, halteManifest, sha256, toHex, verifyEvent,
  type BlobManifest, type DateiSchluessel, type NostrEvent, type RelayFilter,
} from "@freedomstack/protocol";

/** Höchstens so viele Manifeste mit derselben Blob-Id werden versucht. */
const MANIFESTE = 5;

/**
 * Den Klartext zum Blob – oder `null`, wenn er nicht vollständig, unverändert und höchstens `hoechstBytes` groß zu holen
 * ist. Mit `manifest` zählt nur genau dieses Manifest (die App nennt es im Auftrag), sonst bis zu fünf mit der Blob-Id.
 */
export async function holeVerschluesselt(
  pool: { query(f: RelayFilter): Promise<NostrEvent[]> },
  p: { blob: string; schluessel: DateiSchluessel; hoechstBytes: number; manifest?: string },
): Promise<Uint8Array | null> {
  if (!/^[0-9a-f]{64}$/.test(p.blob) || (p.manifest !== undefined && !/^[0-9a-f]{64}$/.test(p.manifest))) return null;
  const filter: RelayFilter = p.manifest
    ? { kinds: [KIND_BLOB_MANIFEST], ids: [p.manifest], limit: 1 }
    : { kinds: [KIND_BLOB_MANIFEST], "#blob": [p.blob], limit: MANIFESTE };
  const manifeste = (await pool.query(filter).catch(() => []))
    .filter((ev) => ev.kind === KIND_BLOB_MANIFEST && verifyEvent(ev) && (!p.manifest || ev.id === p.manifest)).slice(0, MANIFESTE);
  for (const manifest of manifeste) {
    const m = halteManifest(manifest, p.blob);
    if (!m) continue;
    const roh = JSON.parse(manifest.content) as BlobManifest;
    // Das Chiffrat hat 16 Byte Prüfwert mehr als die Datei
    if (!Number.isSafeInteger(roh.sizeBytes) || roh.sizeBytes < 1 || roh.sizeBytes > p.hoechstBytes + 16) continue;
    const stuecke = await pool.query({
      kinds: [KIND_BLOB_CHUNK], authors: [manifest.pubkey], "#blob": [p.blob], limit: Math.min(m.hashes.length * 2, 5000),
    }).catch(() => []);
    const daten = new Map<number, string>();
    for (const ev of stuecke) {
      if (ev.pubkey !== manifest.pubkey || ev.kind !== KIND_BLOB_CHUNK || !verifyEvent(ev)) continue;
      const index = Number(getTag(ev, "index") ?? "-1");
      if (!Number.isInteger(index) || index < 0 || index >= m.hashes.length || daten.has(index)) continue;
      if (getTag(ev, "sha256") !== m.hashes[index] || !/^(?:[0-9a-f]{2})*$/.test(ev.content)) continue;
      daten.set(index, ev.content);
    }
    const zusammen = await assembleBlob(roh, daten);
    if (!zusammen.complete || toHex(sha256(zusammen.bytes)) !== p.blob) continue;
    try {
      return entschluesseleDatei(zusammen.bytes, p.schluessel);
    } catch {
      return null;
    }
  }
  return null;
}
