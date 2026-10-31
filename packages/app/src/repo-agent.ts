/**
 * Agenten am Repo beauftragen (11.5d1, `docs/REPO-AGENTEN-ENTWURF.md` V1, W2 A, W5 A) – ohne DOM.
 *
 * - Beauftragt wird ein Agent auf einem Knoten, der im Raum des Repos ist und „wer fragt, zahlt“
 *   nennt (`zuBezahlen()`, wie bei Fragen im Raum). Der Auftrag ist eine gewöhnliche Raum-Nachricht,
 *   die ihn erwähnt und über `repoAuftragTags()` auf das Repo zeigt – alle im Raum sehen sie.
 * - Die Obergrenze wählt der Fragende vorher (W5 A); der Knoten rechnet Tokens bis höchstens dahin
 *   und hört dort auf. `hoechstens` fängt Vertipper ab, mehr nicht.
 * - Geschrieben wird im ersten Kanal (nach Position), in dem beide schreiben dürfen, der Fragende und
 *   der Agent – sonst schwiege der Agent (`entscheide()`).
 */
import { canWriteTo, repoAuftragTags, type SpaceState } from "@freedomstack/protocol";
import { type RaumAgentKarte, type ZuBezahlen, zuBezahlen } from "./knoten-agent-wahl.js";
import { ganzeSats } from "./shell-logic.js";

/** Obergrenze eines Repo-Auftrags in sats: Vorgabe im Dialog und höchstens. */
export const REPO_GEBOT_SATS = Object.freeze({ vorgabe: 1000, hoechstens: 20_000 });

/** So lange wartet die App auf das Ergebnis: der Lauf beim Knoten (höchstens 30 min) und Zeit für Bundle und Pakete. */
export const REPO_WARTEN_MS = 35 * 60_000;

/** Höchstens so lang ist die Aufgabe (Zeichen) – sie steht als Nachricht im Raum. */
export const REPO_AUFGABE_MAX = 2000;

/** Agenten im Raum, die man am Repo beauftragen kann – auf einem Knoten, „wer fragt, zahlt“, nie man selbst. */
export function repoAgenten(karten: readonly RaumAgentKarte[], ich: string): ZuBezahlen[] {
  return zuBezahlen(karten.map((k) => k.agent), karten, ich);
}

/** Obergrenze aus dem Eingabefeld – ganze sats von 1 bis `hoechstens`, sonst `null`. */
export function leseObergrenze(v: unknown): number | null {
  const n = ganzeSats(v);
  return n > 0 && n <= REPO_GEBOT_SATS.hoechstens ? n : null;
}

/** Die Aufgabe aus dem Eingabefeld – getrimmt, nicht leer, höchstens `REPO_AUFGABE_MAX` Zeichen, sonst `null`. */
export function leseAufgabe(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && [...s].length <= REPO_AUFGABE_MAX ? s : null;
}

/** Der erste Kanal (nach Position), in dem ich und der Agent schreiben dürfen – oder keiner. */
export function auftragsKanal(zustand: SpaceState, ich: string, agent: string): string | undefined {
  return [...(zustand.space?.channels ?? [])].sort((a, b) => a.position - b.position)
    .find((c) => canWriteTo(ich, c, zustand) && canWriteTo(agent, c, zustand))?.id;
}

/** Text und Tags der Nachricht: „@Name Aufgabe“, dazu das Repo (und ein Issue) über `repoAuftragTags()`. */
export function repoAuftragNachricht(p: { name: string; aufgabe: string; repo: string; issue?: string }): { text: string; tags: string[][] } {
  return { text: `@${p.name} ${p.aufgabe}`, tags: repoAuftragTags({ repo: p.repo, ...(p.issue ? { issue: p.issue } : {}) }) };
}
