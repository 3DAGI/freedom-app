/**
 * Code für einen Repo-Auftrag holen (Schritt 11.5c2a, `docs/REPO-AGENTEN-ENTWURF.md` V3): nur das Bundle,
 * auf das der Bundle-Verweis (38042) eines Pflegers zeigt – nie über Klon-Adressen (git ginge dort am
 * SSR-Wächter und an Tor vorbei ins Netz).
 *
 * Geholt über `holeVerschluesselt()` (`blob-holen.ts`: Stücke nur vom Autor des Manifests, Chiffrat = Blob-Id – ein
 * fremdes Manifest mit derselben Id schiebt keinen anderen Code unter, der Schlüssel im Verweis ist öffentlich), dann
 * `leseBundle()` mit `BUNDLE_GRENZEN`. Nur im Speicher; nach außen nur Kennungen.
 */
import { BUNDLE_GRENZEN, leseBundle, parseGitRepoRef, type GelesenesBundle, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";
import { holeVerschluesselt } from "./blob-holen.js";

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
  const klartext = await holeVerschluesselt(pool, { blob: ref.blobId, schluessel: ref.schluessel, hoechstBytes: BUNDLE_GRENZEN.bytes });
  if (!klartext) return nein;
  try {
    return { ok: true, bundle: await leseBundle(klartext) };
  } catch {
    return nein;
  }
}
