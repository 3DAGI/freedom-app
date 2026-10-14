/**
 * Repo-Aufträge an Agenten in Räumen (11.5b, Entwurf `docs/REPO-AGENTEN-ENTWURF.md`
 * V1 und V6, `docs/PROTOCOL.md` 33): Eine Erwähnung des Agenten zeigt mit
 * `["a", "30617:<eigentümer>:<kennung>", "", "repo"]` auf ein Repo des Raums,
 * optional mit `["e", <issue>, "", "issue"]` auf ein Issue. Offen steht das an der
 * Raum-Nachricht (Kind 42), privat am inneren Event (Kind 9).
 *
 * - Das Repo muss zum Raum gehören: offen bestätigt über `mitRaumRechten()`, privat
 *   von einem Pfleger angekündigt (`raumReposPrivat()`). Sonst lehnt der Agent ab
 *   (`agent-repo-fremd`).
 * - Agenten pflegen nie: Sie kündigen keine Repos an und setzen keinen Status –
 *   `istAgent` geht an `mitRaumRechten()`, `raumReposPrivat()` und `patchStatus()`.
 */
import type { NostrEvent } from "./event.js";
import { KIND_REPO_ANKUENDIGUNG, REPO_ADRESSE, leseRepoAnkuendigung, type GelesenesRepo } from "./nip34.js";
import { mitRaumRechten, raumReposPrivat } from "./raum-repo.js";
import type { InneresEvent } from "./raum-gruppe.js";
import type { SpaceState } from "./spaces.js";

const HEX64 = /^[0-9a-f]{64}$/;

export interface RepoAuftrag {
  /** Adresse des Repos (`30617:<eigentümer>:<kennung>`). */
  repo: string;
  /** Id eines Issues des Repos – offen das Event, privat das innere Event. */
  issue?: string;
}

/** Ablehnungen eines Repo-Auftrags – feste Kennungen wie die übrigen `agent-…`. */
export type RepoAuftragFall = "agent-repo-fremd";

/** Tags für die Erwähnung (vor dem Signieren bzw. im inneren Event). */
export function repoAuftragTags(a: RepoAuftrag): string[][] {
  if (!REPO_ADRESSE.test(a.repo)) throw new Error("Repo-Auftrag ungültig: keine Repo-Adresse");
  if (a.issue !== undefined && !HEX64.test(a.issue)) throw new Error("Repo-Auftrag ungültig: Issue ist keine Id");
  return [["a", a.repo, "", "repo"], ...(a.issue ? [["e", a.issue, "", "issue"]] : [])];
}

/** Aus den Tags einer Erwähnung – genau ein Repo, höchstens ein Issue, sonst keiner (`null`). */
export function leseRepoAuftrag(tags: readonly (readonly string[])[]): RepoAuftrag | null {
  const repos = tags.filter((t) => t[0] === "a" && t[3] === "repo");
  const issues = tags.filter((t) => t[0] === "e" && t[3] === "issue");
  if (repos.length !== 1 || issues.length > 1) return null;
  const repo = repos[0]![1] ?? "";
  const issue = issues[0]?.[1];
  if (!REPO_ADRESSE.test(repo) || (issue !== undefined && !HEX64.test(issue))) return null;
  return { repo, ...(issue ? { issue } : {}) };
}

export type RepoImRaum = { ok: true; repo: GelesenesRepo } | { ok: false; fall: RepoAuftragFall };

/** Die neueste Ankündigung genau dieser Adresse (Eigentümer und Kennung) – oder keine. */
function neuesteZu(adresse: string, ankuendigungen: readonly NostrEvent[]): GelesenesRepo | undefined {
  let beste: NostrEvent | undefined;
  for (const ev of ankuendigungen) {
    if (ev.kind !== KIND_REPO_ANKUENDIGUNG) continue;
    let r: GelesenesRepo;
    try {
      r = leseRepoAnkuendigung(ev);
    } catch {
      continue;
    }
    if (r.adresse !== adresse) continue;
    if (!beste || ev.created_at > beste.created_at || (ev.created_at === beste.created_at && ev.id > beste.id)) beste = ev;
  }
  return beste ? leseRepoAnkuendigung(beste) : undefined;
}

/**
 * Offener Raum: Das Repo verweist auf genau diesen Raum, und sein Eigentümer hat dort
 * `repos_pflegen` (`mitRaumRechten()`) – und ist kein Agent. Die Rechte des Raums
 * kommen mit: Pfleger zählen als Maintainer, Agenten nie.
 */
export function repoImOffenenRaum(p: {
  auftrag: RepoAuftrag; raum: string; ankuendigungen: readonly NostrEvent[]; zustand: SpaceState | undefined; istAgent?: (pk: string) => boolean;
}): RepoImRaum {
  const repo = neuesteZu(p.auftrag.repo, p.ankuendigungen);
  if (!repo || repo.raum !== p.raum) return { ok: false, fall: "agent-repo-fremd" };
  const { raumBestaetigt, ...mitRechten } = mitRaumRechten(repo, p.zustand, p.istAgent);
  return raumBestaetigt ? { ok: true, repo: mitRechten } : { ok: false, fall: "agent-repo-fremd" };
}

/**
 * Privater Raum: nur, was ein Pfleger der Gruppe angekündigt hat (`raumReposPrivat()`),
 * Agenten zählen nicht als Pfleger (privat erkennt man sie an ihrer Karte).
 */
export function repoImPrivatenRaum(p: {
  auftrag: RepoAuftrag; raumId: string; ereignisse: readonly InneresEvent[]; zustand: SpaceState; istAgent?: (pk: string) => boolean;
}): RepoImRaum {
  const { ankuendigungen } = raumReposPrivat(p.raumId, p.ereignisse, p.zustand, p.istAgent);
  const repo = neuesteZu(p.auftrag.repo, ankuendigungen);
  return repo ? { ok: true, repo } : { ok: false, fall: "agent-repo-fremd" };
}
