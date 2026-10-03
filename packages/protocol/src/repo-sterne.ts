/**
 * Sterne und Beobachten für Repos (Schritt C-20j1, Vorschlag nach der
 * Entscheidung des MENSCHEN vom 02.10.2026) – wie bei GitHub, mit einem
 * Unterschied: Beobachten ist hier privat.
 *
 * Stern: öffentlich, eine Reaktion nach NIP-25 (Kind 7, Inhalt „⭐“) an die
 * Ankündigung (`a` = Repo, `k` = 30617). Zurücknehmen mit einer Löschung nach
 * NIP-09 (Kind 5, `e` = Id des Sterns). Gezählt wird je Person höchstens ein
 * Stern, ein gelöschter zählt nicht – auch dann nicht, wenn ein Relay die
 * Löschung nicht befolgt.
 *
 * Beobachten: eine NIP-51-Liste „Git repositories“ (Kind 10018), aber nur mit
 * privaten Einträgen – der Inhalt ist mit dem eigenen Schlüssel verschlüsselt
 * (NIP-44, das tut der Signer der App), offene Tags gibt es nicht. Wen man
 * beobachtet, verrät die Liste so niemandem. Zählen lässt sich das darum
 * nicht – anders als bei GitHub gibt es keine Zahl der Beobachter.
 *
 * Format in `docs/PROTOCOL.md` (19).
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag, getTags } from "./event.js";
import { KIND_LOESCHUNG } from "./coverage.js";
import { ProtokollFehler } from "./fehler.js";
import { type GelesenesRepo, KIND_REPO_ANKUENDIGUNG, REPO_ADRESSE, repoAdresse } from "./nip34.js";

export const KIND_REAKTION = 7;
/** NIP-51 „Git repositories“ – hier nur mit verschlüsselten Einträgen. */
export const KIND_GIT_REPOS = 10018;
export const STERN = "⭐";
/** Höchstens so viele beobachtete Repos – die Liste reist in einem Event. */
export const BEOBACHTEN_MAX = 500;

const HEX64 = /^[0-9a-f]{64}$/;

/** Stern an ein Repo – öffentlich. */
export function baueStern(repo: Pick<GelesenesRepo, "eigentuemer" | "id">, autor: string): UnsignedEvent {
  const adresse = repoAdresse(repo.eigentuemer, repo.id);
  if (!REPO_ADRESSE.test(adresse)) throw new ProtokollFehler("stern-repo", "Stern nur an ein gültiges Repo");
  return buildEvent(autor, KIND_REAKTION, [["a", adresse], ["p", repo.eigentuemer], ["k", String(KIND_REPO_ANKUENDIGUNG)]], STERN);
}

/** Stern zurücknehmen – Löschung nach NIP-09 des eigenen Sterns. */
export function baueSternWeg(sternId: string, autor: string): UnsignedEvent {
  if (!HEX64.test(sternId)) throw new ProtokollFehler("stern-repo", "Stern nur an ein gültiges Repo");
  return buildEvent(autor, KIND_LOESCHUNG, [["e", sternId], ["k", String(KIND_REAKTION)]], "");
}

/** Sterne eines Repos: je Person der jüngste, gelöschte zählen nicht. `eigener` ist die Id des eigenen Sterns. */
export function sterneZu(adresse: string, events: readonly NostrEvent[], ich?: string): { anzahl: number; von: string[]; eigener?: string } {
  const geloescht = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== KIND_LOESCHUNG) continue;
    for (const t of getTags(ev, "e")) geloescht.add(`${ev.pubkey}:${t[1] ?? ""}`);
  }
  const je = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== KIND_REAKTION || ev.content !== STERN || getTag(ev, "k") !== String(KIND_REPO_ANKUENDIGUNG)) continue;
    const ziele = getTags(ev, "a").map((t) => t[1]);
    if (ziele.length !== 1 || ziele[0] !== adresse || geloescht.has(`${ev.pubkey}:${ev.id}`)) continue;
    const alt = je.get(ev.pubkey);
    if (!alt || ev.created_at > alt.created_at) je.set(ev.pubkey, ev);
  }
  const eigener = ich ? je.get(ich)?.id : undefined;
  return { anzahl: je.size, von: [...je.keys()], ...(eigener ? { eigener } : {}) };
}

/** Klartext der privaten Einträge (NIP-51): `[["a", <adresse>], …]` – verschlüsselt erst der Signer. */
export function beobachtungsInhalt(adressen: readonly string[]): string {
  const liste = [...new Set(adressen)];
  if (liste.length > BEOBACHTEN_MAX || liste.some((a) => !REPO_ADRESSE.test(a))) throw new ProtokollFehler("beobachten-liste", "Beobachten nur für gültige Repos");
  return JSON.stringify(liste.map((a) => ["a", a]));
}

/** Entschlüsselte Einträge streng lesen – Unfug fällt heraus, ein kaputter Text ergibt eine leere Liste. */
export function leseBeobachtungsInhalt(klartext: string): string[] {
  let o: unknown;
  try { o = JSON.parse(klartext); } catch { return []; }
  if (!Array.isArray(o)) return [];
  const aus = o.filter((t): t is [string, string] => Array.isArray(t) && t[0] === "a" && typeof t[1] === "string" && REPO_ADRESSE.test(t[1])).map((t) => t[1]);
  return [...new Set(aus)].slice(0, BEOBACHTEN_MAX);
}

/** Die Liste als Event – nur das Chiffrat, keine offenen Tags. */
export function baueBeobachtungsListe(chiffrat: string, autor: string): UnsignedEvent {
  if (!chiffrat) throw new ProtokollFehler("beobachten-liste", "Beobachten nur für gültige Repos");
  return buildEvent(autor, KIND_GIT_REPOS, [], chiffrat);
}

/** Die jüngste eigene Liste – nur ohne offene Einträge (sonst wäre sie nicht privat). */
export function eigeneBeobachtungsListe(ich: string, events: readonly NostrEvent[]): NostrEvent | undefined {
  return events.filter((e) => e.kind === KIND_GIT_REPOS && e.pubkey === ich && !e.tags.some((t) => t[0] === "a"))
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
}

/** Forks eines Repos aus gelesenen Ankündigungen (Tag `["a", …, "", "fork"]`, C-20j1). */
export const forksVon = (adresse: string, repos: readonly Pick<GelesenesRepo, "forkVon" | "adresse">[]): string[] =>
  repos.filter((r) => r.forkVon === adresse).map((r) => r.adresse);
