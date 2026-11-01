/**
 * Welche erwähnten Agenten bezahlt, wer fragt (11.3d1b2, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P4, „wer fragt, zahlt“) – ohne DOM.
 *
 * - Nur Agenten auf einem Knoten, deren Karte „wer fragt, zahlt“ und den Knoten
 *   (`provider`) nennt. Agenten auf einem Gerät zahlt ihr Ersteller (11.3c).
 * - Nur, wer in dieser Nachricht erwähnt ist, in der Reihenfolge der Erwähnungen,
 *   nie der eigene Schlüssel.
 * - Ablehnungen des Knotens nur über ihre Kennung (`fall`, PROTOCOL §32) – nie
 *   über Text vom Knoten.
 */
import type { AgentKarte } from "@freedomstack/protocol";

/** Was die App aus der Karte eines Agenten im offenen Raum braucht. */
export type RaumAgentKarte = Pick<AgentKarte, "agent" | "name" | "betrieb" | "bezahlung" | "provider" | "modell">;

export type ZuBezahlen = RaumAgentKarte & { provider: string };

export function zuBezahlen(erwaehnt: readonly string[], karten: readonly RaumAgentKarte[], ich: string): ZuBezahlen[] {
  const je = new Map(karten.map((k) => [k.agent, k]));
  return [...new Set(erwaehnt)].flatMap((pk) => {
    const k = je.get(pk);
    return k && pk !== ich && k.betrieb === "knoten" && k.bezahlung === "fragender" && k.provider ? [{ ...k, provider: k.provider }] : [];
  });
}

/** Text-Schlüssel je Kennung – Unbekanntes bekommt den allgemeinen Satz mit der Kennung. */
export function ablehnungsText(fall: string | undefined): string {
  switch (fall) {
    case "agent-schon-beantwortet": return "agentKnoten.schonBeantwortet";
    case "agent-keine-erwaehnung":
    case "agent-raum-nicht-erreichbar":
    case "agent-kein-raum": return "agentKnoten.nichtGefunden";
    case "agent-agent-ohne-schreibrecht": return "agentKnoten.agentOhneRecht";
    case "agent-kein-schreibrecht": return "agentKnoten.keinRecht";
    case "agent-bremse": return "agentKnoten.bremse";
    // Repo-Aufträge (11.5d2a): je Kennung des Knotens ein eigener Satz
    case "agent-repo-aus": return "agentRepo.aus";
    case "agent-repo-bezahlt": return "agentRepo.bezahlt";
    case "agent-repo-fremd": return "agentRepo.fremd";
    case "agent-repo-bundle": return "agentRepo.bundle";
    case "agent-repo-issue": return "agentRepo.issue";
    case "agent-repo-modell": return "agentRepo.modell";
    case "agent-repo-belegt": return "agentRepo.belegt";
    case "agent-repo-fehler": return "agentRepo.fehler";
    default: return "agentKnoten.abgelehnt";
  }
}
