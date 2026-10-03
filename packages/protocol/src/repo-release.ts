/**
 * Releases von Repos (Schritt C-20h1, Vorschlag nach der Entscheidung des
 * MENSCHEN vom 02.10.2026): eine Version mit Titel, Notizen und – auf Wunsch –
 * dem Bundle genau dieser Version, wie ein Release bei GitHub. Nicht zu
 * verwechseln mit dem Release-Manifest der App (`release.ts`, Kind 38054).
 *
 * Format: NIP-51-Satz „Release artifact set“ (Kind 30063), ersetzbar je Autor
 * und `d` = `<repo-kennung>@<version>`. `a` zeigt auf die Ankündigung des
 * Repos (30617) – sie spielt die Rolle der Anwendung aus NIP-51. Das Bundle
 * steht nicht als NIP-94-Datei (1063), sondern wie im Bundle-Verweis (38042)
 * als `blob` samt öffentlichem Schlüssel (`aes-gcm`) im Release selbst: Der
 * Verweis 38042 ist ersetzbar und zeigt immer auf das neueste Bundle, ein
 * Release hält seine Version fest. Es zählen nur Releases von Eigentümer und
 * Maintainern (`darfAnnehmen()`); zurückgezogen wird mit einem Ersatz mit
 * `["zurueckgezogen"]`. Format in `docs/PROTOCOL.md` (19). In privaten Räumen
 * nur als inneres Event (`raumRepoRelease()` in `raum-repo.ts`).
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag } from "./event.js";
import { type DateiSchluessel, istDateiSchluessel } from "./datei-krypto.js";
import { ProtokollFehler } from "./fehler.js";
import { type GelesenesRepo, KIND_REPO_ANKUENDIGUNG, darfAnnehmen, repoAdresse } from "./nip34.js";

export const KIND_REPO_RELEASE = 30063;

/** Grenzen: Version und Titel in Zeichen, Notizen in Byte. */
export const REPO_RELEASE_GRENZEN = { version: 100, titel: 200, notizen: 64_000 } as const;

// Wie ein Git-Tag: beginnt mit Buchstabe oder Ziffer, dann auch . _ + - /, kein „..“
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+/-]*$/;
const REPO_ID = /^[a-zA-Z0-9._-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/;

export interface RepoReleaseBundle {
  /** Manifest-Id im Blob-Netz. */
  blobId: string;
  schluessel: DateiSchluessel;
}

export interface RepoReleaseAngaben {
  repo: Pick<GelesenesRepo, "eigentuemer" | "id">;
  version: string;
  titel: string;
  /** Markdown. */
  notizen?: string;
  commit?: string;
  bundle?: RepoReleaseBundle;
  /** Vorabversion – nie „neuestes Release“. */
  vorab?: boolean;
}

export interface GelesenesRepoRelease {
  id: string;
  autor: string;
  repoAdresse: string;
  version: string;
  titel: string;
  notizen: string;
  commit?: string;
  bundle?: RepoReleaseBundle;
  vorab: boolean;
  zurueckgezogen: boolean;
  zeit: number;
}

export const gueltigeReleaseVersion = (v: string): boolean => v.length <= REPO_RELEASE_GRENZEN.version && VERSION.test(v) && !v.includes("..");

function pruefeRepo(r: Pick<GelesenesRepo, "eigentuemer" | "id">): void {
  if (!HEX64.test(r.eigentuemer) || !REPO_ID.test(r.id)) throw new ProtokollFehler("release-repo", "Release ohne gültiges Repo");
}

/** Release veröffentlichen (nur Eigentümer und Maintainer zählen beim Lesen). */
export function baueRepoRelease(r: RepoReleaseAngaben, autor: string): UnsignedEvent {
  pruefeRepo(r.repo);
  if (!gueltigeReleaseVersion(r.version)) throw new ProtokollFehler("release-version", "Version wie ein Git-Tag (Buchstaben, Ziffern, . _ + - /, höchstens 100)");
  const titel = r.titel.trim();
  if (!titel || titel.length > REPO_RELEASE_GRENZEN.titel || STEUERZEICHEN.test(titel)) throw new ProtokollFehler("release-titel", "Titel fehlt oder ist zu lang (höchstens 200 Zeichen)");
  const notizen = (r.notizen ?? "").trim();
  if (new TextEncoder().encode(notizen).length > REPO_RELEASE_GRENZEN.notizen) {
    throw new ProtokollFehler("release-gross", `Notizen zu groß (höchstens ${REPO_RELEASE_GRENZEN.notizen / 1000} KB)`, { kb: REPO_RELEASE_GRENZEN.notizen / 1000 });
  }
  if (r.commit !== undefined && !SHA1.test(r.commit)) throw new ProtokollFehler("release-commit", "Commit muss ein SHA-1 sein");
  if (r.bundle && (!HEX64.test(r.bundle.blobId) || !istDateiSchluessel(r.bundle.schluessel))) throw new ProtokollFehler("release-bundle", "Bundle ohne gültige Id oder Schlüssel");
  const tags: string[][] = [
    ["d", `${r.repo.id}@${r.version}`], ["a", repoAdresse(r.repo.eigentuemer, r.repo.id)], ["p", r.repo.eigentuemer],
    ["version", r.version], ["title", titel],
  ];
  if (r.commit) tags.push(["commit", r.commit]);
  if (r.bundle) tags.push(["blob", r.bundle.blobId], ["aes-gcm", r.bundle.schluessel.key, r.bundle.schluessel.nonce, r.bundle.schluessel.ox]);
  if (r.vorab) tags.push(["vorab"]);
  return buildEvent(autor, KIND_REPO_RELEASE, tags, notizen);
}

/** Release zurückziehen – ersetzt das eigene Release dieser Version, ohne Inhalt. */
export function baueRepoReleaseRueckzug(r: { repo: Pick<GelesenesRepo, "eigentuemer" | "id">; version: string }, autor: string): UnsignedEvent {
  pruefeRepo(r.repo);
  if (!gueltigeReleaseVersion(r.version)) throw new ProtokollFehler("release-version", "Version wie ein Git-Tag (Buchstaben, Ziffern, . _ + - /, höchstens 100)");
  return buildEvent(autor, KIND_REPO_RELEASE, [
    ["d", `${r.repo.id}@${r.version}`], ["a", repoAdresse(r.repo.eigentuemer, r.repo.id)], ["p", r.repo.eigentuemer],
    ["version", r.version], ["zurueckgezogen"],
  ], "");
}

/** Ein Release streng lesen – fremde Daten; ein kaputtes Bundle fällt heraus, der Rest bleibt. */
export function leseRepoRelease(ev: NostrEvent): GelesenesRepoRelease {
  if (ev.kind !== KIND_REPO_RELEASE) throw new Error(`Kein Release: Kind ${ev.kind}`);
  const version = getTag(ev, "version") ?? "";
  const repoA = getTag(ev, "a") ?? "";
  const teile = repoA.split(":");
  if (!gueltigeReleaseVersion(version) || teile.length !== 3 || teile[0] !== String(KIND_REPO_ANKUENDIGUNG) || !HEX64.test(teile[1]!) || !REPO_ID.test(teile[2]!)
    || getTag(ev, "d") !== `${teile[2]}@${version}`) {
    throw new Error("Release ohne gültige Version oder Repo");
  }
  const zurueckgezogen = ev.tags.some((t) => t[0] === "zurueckgezogen");
  const titel = (getTag(ev, "title") ?? "").trim();
  if (!zurueckgezogen && (!titel || titel.length > REPO_RELEASE_GRENZEN.titel || STEUERZEICHEN.test(titel))) throw new Error("Release ohne gültigen Titel");
  const notizen = ev.content.trim();
  if (new TextEncoder().encode(notizen).length > REPO_RELEASE_GRENZEN.notizen) throw new Error("Release zu groß");
  const commit = getTag(ev, "commit");
  const blob = getTag(ev, "blob");
  const k = ev.tags.find((t) => t[0] === "aes-gcm");
  const schluessel = k ? { alg: "aes-gcm", key: k[1], nonce: k[2], ox: k[3] } : null;
  return {
    id: ev.id, autor: ev.pubkey, repoAdresse: repoA, version, titel: zurueckgezogen ? "" : titel, notizen: zurueckgezogen ? "" : notizen,
    ...(commit && SHA1.test(commit) && !zurueckgezogen ? { commit } : {}),
    ...(blob && HEX64.test(blob) && istDateiSchluessel(schluessel) && !zurueckgezogen ? { bundle: { blobId: blob, schluessel } } : {}),
    vorab: ev.tags.some((t) => t[0] === "vorab"), zurueckgezogen, zeit: ev.created_at,
  };
}

/**
 * Die Releases eines Repos, neuestes zuerst: nur von Eigentümer und
 * Maintainern, je Version die neueste Aussage (bei gleicher Sekunde die
 * größere Id) – ist sie ein Rückzug, fehlt die Version.
 */
export function repoReleasesZu(repo: Pick<GelesenesRepo, "eigentuemer" | "maintainer" | "adresse">, events: readonly NostrEvent[]): GelesenesRepoRelease[] {
  const je = new Map<string, GelesenesRepoRelease>();
  for (const ev of events) {
    let r: GelesenesRepoRelease;
    try { r = leseRepoRelease(ev); } catch { continue; }
    if (r.repoAdresse !== repo.adresse || !darfAnnehmen(repo, r.autor)) continue;
    const alt = je.get(r.version);
    if (!alt || r.zeit > alt.zeit || (r.zeit === alt.zeit && r.id > alt.id)) je.set(r.version, r);
  }
  return [...je.values()].filter((r) => !r.zurueckgezogen).sort((a, b) => b.zeit - a.zeit || b.id.localeCompare(a.id));
}

/** Das neueste Release, das keine Vorabversion ist – wie „Latest“ bei GitHub. */
export const neuestesRepoRelease = (liste: readonly GelesenesRepoRelease[]): GelesenesRepoRelease | undefined => liste.find((r) => !r.vorab);
