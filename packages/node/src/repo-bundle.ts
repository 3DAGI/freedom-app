/**
 * Code für einen Repo-Auftrag holen (Schritt 11.5c2a, `docs/REPO-AGENTEN-ENTWURF.md` V3): nur das Bundle,
 * auf das der Bundle-Verweis (38042) eines Pflegers zeigt – nie über Klon-Adressen (git ginge dort am
 * SSR-Wächter und an Tor vorbei ins Netz).
 *
 * Wie beim Halten (B-9b1): Manifest und Stücke nur vom Autor des Manifests, jedes Stück gegen seinen Hash;
 * zusammengesetzt muss das Chiffrat die Blob-Id als SHA-256 haben – die Kennung ist der Inhalt, ein fremdes
 * Manifest mit derselben Id schiebt also keinen anderen Code unter (der Schlüssel im Verweis ist öffentlich).
 * Dann mit dem Schlüssel aus dem Verweis entschlüsseln (`ox` prüft den Klartext) und `leseBundle()` mit
 * `BUNDLE_GRENZEN`. Nur im Speicher; nach außen nur Kennungen.
 */
import {
  BUNDLE_GRENZEN, KIND_BLOB_CHUNK, KIND_BLOB_MANIFEST, assembleBlob, entschluesseleDatei, getTag, halteManifest, leseBundle,
  parseGitRepoRef, sha256, toHex, verifyEvent, type BlobManifest, type GelesenesBundle, type NostrEvent, type RelayFilter,
} from "@freedomstack/protocol";

/** Höchstens so viele Manifeste mit derselben Blob-Id werden versucht. */
const MANIFESTE = 5;

export type RepoBundleErgebnis = { ok: true; bundle: GelesenesBundle } | { ok: false; fall: "agent-repo-bundle" };

/** Das Bundle zum Verweis – oder `agent-repo-bundle`, wenn es nicht vollständig und unverändert zu holen ist. */
export async function holeRepoBundle(pool: { query(f: RelayFilter): Promise<NostrEvent[]> }, verweis: NostrEvent): Promise<RepoBundleErgebnis> {
  const nein = { ok: false, fall: "agent-repo-bundle" } as const;
  let ref: ReturnType<typeof parseGitRepoRef>;
  try {
    ref = parseGitRepoRef(verweis);
  } catch {
    return nein;
  }
  if (!ref.schluessel || !/^[0-9a-f]{64}$/.test(ref.blobId)) return nein;
  const manifeste = (await pool.query({ kinds: [KIND_BLOB_MANIFEST], "#blob": [ref.blobId], limit: MANIFESTE }).catch(() => []))
    .filter((ev) => ev.kind === KIND_BLOB_MANIFEST && verifyEvent(ev)).slice(0, MANIFESTE);
  for (const manifest of manifeste) {
    const m = halteManifest(manifest, ref.blobId);
    if (!m) continue;
    const roh = JSON.parse(manifest.content) as BlobManifest;
    // Das Chiffrat hat 16 Byte Prüfwert mehr als das Bundle
    if (!Number.isSafeInteger(roh.sizeBytes) || roh.sizeBytes < 1 || roh.sizeBytes > BUNDLE_GRENZEN.bytes + 16) continue;
    const stuecke = await pool.query({
      kinds: [KIND_BLOB_CHUNK], authors: [manifest.pubkey], "#blob": [ref.blobId], limit: Math.min(m.hashes.length * 2, 5000),
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
    if (!zusammen.complete || toHex(sha256(zusammen.bytes)) !== ref.blobId) continue;
    try {
      return { ok: true, bundle: await leseBundle(entschluesseleDatei(zusammen.bytes, ref.schluessel)) };
    } catch {
      return nein;
    }
  }
  return nein;
}
