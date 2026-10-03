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
import type { NostrEvent, UnsignedEvent } from "./event.js";
import { buildGitRepoRef, type GitRepoRef } from "./git.js";
import { KIND_GIT_REPO_REF } from "./kinds.js";
import {
  KIND_ISSUE, KIND_PATCH, KIND_REPO_ANKUENDIGUNG, KIND_STATUS_ANGENOMMEN, KIND_STATUS_ENTWURF, KIND_STATUS_GESCHLOSSEN, KIND_STATUS_OFFEN,
  baueIssue, baueIssueStatus, baueRepoAnkuendigung, bauePatch, baueStatus, type GelesenesRepo, type RepoAnkuendigung,
} from "./nip34.js";
import { KIND_KOMMENTAR, baueKommentar } from "./kommentar.js";
import { KIND_REPO_RELEASE, baueRepoRelease, baueRepoReleaseRueckzug } from "./repo-release.js";
import { baueBewertung, baueZeilenKommentar } from "./review.js";
import type { InneresEvent, InneresSenden } from "./raum-gruppe.js";
import { KIND_SPACE, buildSpaceState, can, leseRaumAdresse, mitRaumKanaelen, type SpaceState } from "./spaces.js";

export const RAUM_REPO_RECHT = "repos_pflegen" as const;

/** Raum-Zustand zur Adresse – Definitionen anderer Autoren fallen vorher heraus, Kanal-Events (B-20) kommen dazu. */
export function raumZustandFuer(adresse: string, events: readonly NostrEvent[], jetzt?: number): SpaceState | undefined {
  const a = leseRaumAdresse(adresse);
  if (!a) return undefined;
  const eigene = events.filter((e) => e.kind !== KIND_SPACE || e.pubkey === a.besitzer);
  const zustand = buildSpaceState(a.spaceId, eigene);
  // Kanäle (B-20): auch von Berechtigten, nur an diese Adresse
  return zustand.space && zustand.ownerPubkey === a.besitzer ? mitRaumKanaelen(zustand, events, jetzt) : undefined;
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

// ------------------------------------------------------------ Private Räume (11.4b)

/**
 * Repos in privaten Räumen (MLS): Ankündigung (30617), Bundle-Verweis samt
 * Schlüssel (38042), Patches (1617) und Status (1630–1633) sind nur innere
 * Events der Gruppe, mit `["space", <raum>]` – nie offen. Relays sehen Kind
 * 445, Speicherknoten nur Chiffrat. Wer pflegt, bestimmen die Rechte der
 * Gruppe (`gruppenRaum()`): Admins haben alle, sonst `repos_pflegen`.
 */
export const RAUM_REPO_ARTEN: readonly number[] = [
  KIND_REPO_ANKUENDIGUNG, KIND_GIT_REPO_REF, KIND_PATCH, KIND_STATUS_OFFEN, KIND_STATUS_ANGENOMMEN, KIND_STATUS_GESCHLOSSEN, KIND_STATUS_ENTWURF,
  KIND_ISSUE, KIND_KOMMENTAR, KIND_REPO_RELEASE,
];

/** Ein NIP-34-Baustein als inneres Event des Raums – der Autor ist, wen MLS belegt. */
function inRaum(raumId: string, u: UnsignedEvent): InneresSenden {
  return { art: u.kind, tags: [["space", raumId], ...u.tags.filter((t) => t[0] !== "space")], text: u.content };
}

/** Ankündigung im privaten Raum – ohne Verweis auf einen öffentlichen Raum. */
export function raumRepoAnkuendigung(raumId: string, r: RepoAnkuendigung): InneresSenden {
  const { raum: _offen, ...rest } = r;
  return inRaum(raumId, baueRepoAnkuendigung(rest, ""));
}

/** Bundle-Verweis mit Schlüssel – nur in der Gruppe (öffentlich stünde der Schlüssel offen, 8.9b). */
export function raumRepoBundle(raumId: string, ref: GitRepoRef): InneresSenden {
  return inRaum(raumId, buildGitRepoRef(ref, ""));
}

/** Patch an ein Repo des Raums (`eigentuemer`: wer es angekündigt hat). */
export function raumRepoPatch(raumId: string, p: Parameters<typeof bauePatch>[0]): InneresSenden {
  return inRaum(raumId, bauePatch(p, ""));
}

/** Status eines Patches im Raum. */
export function raumRepoStatus(raumId: string, p: Parameters<typeof baueStatus>[0]): InneresSenden {
  return inRaum(raumId, baueStatus(p, ""));
}

/** Issue an ein Repo des Raums (C-17a). */
export function raumRepoIssue(raumId: string, i: Parameters<typeof baueIssue>[0]): InneresSenden {
  return inRaum(raumId, baueIssue(i, ""));
}

/** Status eines Issues im Raum (C-17a). */
export function raumRepoIssueStatus(raumId: string, p: Parameters<typeof baueIssueStatus>[0]): InneresSenden {
  return inRaum(raumId, baueIssueStatus(p, ""));
}

/** Kommentar an ein Issue oder einen Patch im Raum (C-17a) – Bezüge sind Ids innerer Events. */
export function raumRepoKommentar(raumId: string, k: Parameters<typeof baueKommentar>[0]): InneresSenden {
  return inRaum(raumId, baueKommentar(k, ""));
}

/** Kommentar an einer Zeile eines Patches im Raum (C-20g1) – der Patch ist ein inneres Event. */
export function raumRepoZeilenKommentar(raumId: string, k: Parameters<typeof baueZeilenKommentar>[0]): InneresSenden {
  return inRaum(raumId, baueZeilenKommentar(k, ""));
}

/** Bewertung eines Patches im Raum (C-20g1). */
export function raumRepoBewertung(raumId: string, b: Parameters<typeof baueBewertung>[0]): InneresSenden {
  return inRaum(raumId, baueBewertung(b, ""));
}

/** Release eines Repos im Raum (C-20h1) – samt Schlüssel des Bundles nur in der Gruppe. */
export function raumRepoRelease(raumId: string, r: Parameters<typeof baueRepoRelease>[0]): InneresSenden {
  return inRaum(raumId, baueRepoRelease(r, ""));
}

/** Release im Raum zurückziehen (C-20h1). */
export function raumRepoReleaseRueckzug(raumId: string, r: Parameters<typeof baueRepoReleaseRueckzug>[0]): InneresSenden {
  return inRaum(raumId, baueRepoReleaseRueckzug(r, ""));
}

/**
 * Die Repos eines privaten Raums aus seinen inneren Events – in der Form, die
 * die Repo-Ansicht liest. Ankündigungen und Bundles zählen nur von Pflegern
 * (Admins oder `repos_pflegen`), je Autor und Kennung die neueste; ihre
 * Maintainer sind alle Pfleger (als `maintainers` eingesetzt – der Absender
 * ist von MLS belegt). Patches, Issues und Kommentare (C-17a) von jedem
 * Mitglied; Status werten `patchStatus()` bzw. `issueStatus()` nach diesen
 * Maintainern aus, Releases (C-20h1) ebenso `repoReleasesZu()`.
 */
export function raumReposPrivat(raumId: string, ereignisse: readonly InneresEvent[], zustand: SpaceState): {
  ankuendigungen: NostrEvent[]; bundles: NostrEvent[]; patches: NostrEvent[]; status: NostrEvent[]; issues: NostrEvent[]; kommentare: NostrEvent[];
  releases: NostrEvent[];
} {
  const imRaum = ereignisse.filter((e) => RAUM_REPO_ARTEN.includes(e.art) && e.tags.find((t) => t[0] === "space")?.[1] === raumId);
  const alsEv = (e: InneresEvent, tags = e.tags): NostrEvent => ({ id: e.id, pubkey: e.von, created_at: e.zeit, kind: e.art, tags, content: e.text, sig: "" });
  const pflegt = (pk: string) => can(pk, RAUM_REPO_RECHT, zustand);
  const pfleger = [...zustand.grants.keys()].filter(pflegt);
  const neueste = new Map<string, InneresEvent>();
  for (const e of imRaum) {
    if ((e.art !== KIND_REPO_ANKUENDIGUNG && e.art !== KIND_GIT_REPO_REF) || !pflegt(e.von)) continue;
    const k = `${e.art}:${e.von}:${e.tags.find((t) => t[0] === "d")?.[1] ?? ""}`;
    const alt = neueste.get(k);
    if (!alt || e.zeit > alt.zeit || (e.zeit === alt.zeit && e.id > alt.id)) neueste.set(k, e);
  }
  const ankuendigungen: NostrEvent[] = [];
  const bundles: NostrEvent[] = [];
  for (const e of neueste.values()) {
    if (e.art === KIND_GIT_REPO_REF) { bundles.push(alsEv(e)); continue; }
    const andere = pfleger.filter((pk) => pk !== e.von);
    ankuendigungen.push(alsEv(e, [...e.tags.filter((t) => t[0] !== "maintainers"), ...(andere.length ? [["maintainers", ...andere]] : [])]));
  }
  return {
    ankuendigungen, bundles,
    patches: imRaum.filter((e) => e.art === KIND_PATCH).map((e) => alsEv(e)),
    status: imRaum.filter((e) => e.art >= KIND_STATUS_OFFEN && e.art <= KIND_STATUS_ENTWURF).map((e) => alsEv(e)),
    // Issues und Kommentare (C-17a) von jedem Mitglied, wie Patches
    issues: imRaum.filter((e) => e.art === KIND_ISSUE).map((e) => alsEv(e)),
    kommentare: imRaum.filter((e) => e.art === KIND_KOMMENTAR).map((e) => alsEv(e)),
    releases: imRaum.filter((e) => e.art === KIND_REPO_RELEASE).map((e) => alsEv(e)),
  };
}
