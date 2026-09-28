/**
 * Repos in öffentlichen Räumen (Schritt 11.4a).
 *
 * Eine Repo-Ankündigung (NIP-34, Kind 30617) verweist mit
 * `["a", "34700:<besitzer>:space:<kennung>"]` auf einen öffentlichen Raum.
 * Zum Raum gehört sie nur, wenn der Ankündigende dort das Recht
 * „repos_pflegen“ hat (der Besitzer hat es immer) – sonst könnte jeder sein
 * Repo einem fremden Raum zuschreiben. Dann gelten die Raum-Rollen: Wer
 * „repos_pflegen“ hat, pflegt das Repo wie ein eingetragener Maintainer
 * (Patches annehmen, als Entwurf markieren, schließen).
 *
 * Wie alle Rechte in Räumen ist das eine Regel, die jeder Client selbst
 * auswertet – aus signierten Events. Den Raum-Zustand baut
 * `raumZustandFuer()` nur aus der Definition, die der Besitzer aus der
 * Adresse signiert hat; eine gleichnamige Definition eines anderen zählt nicht.
 */
import type { NostrEvent } from "./event.js";
import type { GelesenesRepo } from "./nip34.js";
import { KIND_SPACE, buildSpaceState, can, leseRaumAdresse, type SpaceState } from "./spaces.js";

export const RAUM_REPO_RECHT = "repos_pflegen" as const;

/** Raum-Zustand zur Adresse – Definitionen anderer Autoren fallen vorher heraus. */
export function raumZustandFuer(adresse: string, events: readonly NostrEvent[]): SpaceState | undefined {
  const a = leseRaumAdresse(adresse);
  if (!a) return undefined;
  const eigene = events.filter((e) => e.kind !== KIND_SPACE || e.pubkey === a.besitzer);
  const zustand = buildSpaceState(a.spaceId, eigene);
  return zustand.space && zustand.ownerPubkey === a.besitzer ? zustand : undefined;
}

/**
 * Das Repo mit den Rechten aus dem Raum: Gehört es bestätigt zum Raum, sind
 * alle mit „repos_pflegen“ (und der Besitzer) Maintainer – `darfAnnehmen()`
 * und `patchStatus()` zählen sie dann wie eingetragene. Sonst bleibt es,
 * wie es ist.
 */
export function mitRaumRechten(repo: GelesenesRepo, zustand: SpaceState | undefined): GelesenesRepo & { raumBestaetigt: boolean } {
  if (!repo.raum || !zustand?.ownerPubkey || leseRaumAdresse(repo.raum)?.besitzer !== zustand.ownerPubkey
    || !can(repo.eigentuemer, RAUM_REPO_RECHT, zustand)) {
    return { ...repo, raumBestaetigt: false };
  }
  const pfleger = [zustand.ownerPubkey, ...[...zustand.grants.keys()].filter((pk) => can(pk, RAUM_REPO_RECHT, zustand))];
  const maintainer = [...new Set([...repo.maintainer, ...pfleger])].filter((pk) => pk !== repo.eigentuemer);
  return { ...repo, maintainer, raumBestaetigt: true };
}
