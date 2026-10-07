/**
 * Signierschlüssel, denen die App bei Release-Manifesten vertraut (5.2), und
 * das Laden der Manifeste – für die Echtheitsprüfung der eigenen Datei
 * (Settings) und einer Kopie an der eigenen Adresse (Earn › Werben, 11.2a).
 *
 * Ohne diese Liste könnte jeder ein Manifest für seine eigene manipulierte
 * Datei veröffentlichen und sie als echt ausweisen. Die Prüfung ist genau so
 * viel wert wie diese Liste – deshalb steht sie im Quelltext und nicht in
 * einer Konfiguration, die sich unterwegs ändern lässt. Seit 5.2 müssen
 * mindestens `RELEASE_MIN_SIGNATUREN` (2) von ihnen dieselbe Version
 * bestätigen – ein einzelner gestohlener Schlüssel reicht nicht.
 */
import { KIND_RELEASE_MANIFEST, parseReleaseManifest, type NostrEvent, type ReleaseManifest } from "@freedomstack/protocol";

export const TRUSTED_SIGNERS: string[] = [
  // VOR DEM RELEASE SETZEN: Pubkeys der Signierschluessel (mindestens zwei Personen oder Geraete).
];

type ManifestPool = { query(f: { kinds: number[]; limit: number }): Promise<NostrEvent[]> };

/** Release-Manifeste als signierte Events – für `suchUpdate()` (6.1a2), das jede Signatur selbst prüft. */
export async function ladeManifestEvents(pool: ManifestPool): Promise<NostrEvent[]> {
  return pool.query({ kinds: [KIND_RELEASE_MANIFEST], limit: 50 });
}

/** Release-Manifeste aus dem Netz, unlesbare übersprungen. */
export async function ladeManifeste(pool: ManifestPool): Promise<ReleaseManifest[]> {
  return manifesteAus(await ladeManifestEvents(pool));
}

/** Lesbare Manifeste aus Events. */
export function manifesteAus(evs: NostrEvent[]): ReleaseManifest[] {
  return evs.flatMap((e) => {
    try { return [parseReleaseManifest(e)]; } catch { return []; }
  });
}
