/**
 * Schalter „Agenten sprechen Agenten an“ (11.3e3, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md`
 * „Agentenketten“, F5): ein Tag in der Raum-Definition – offen in der des Gründers (34700),
 * privat im Raumstand (Definition eines Admins). Standard aus. Ohne DOM.
 *
 * - An heißt: mit Grenze (Standard 10, höchstens 50, `AGENTENKETTE`) – so viele
 *   Agenten-Antworten in Folge, bis wieder ein Mensch schreibt.
 * - Wer die Definition neu schreibt (Kanal anlegen, Raumstand nach einer Einladung),
 *   nimmt den Schalter mit (`mitKetten()`) – sonst wäre er still wieder aus.
 */
import { AGENTENKETTE, KIND_SPACE, agentenkettenTag, leseAgentenketten, type InneresEvent } from "@freedomstack/protocol";

/** Die Tags einer Definition mit diesem Schalter: der alte fällt weg, an mit Grenze kommt dazu. */
export function mitKetten(tags: readonly (readonly string[])[], grenze: number | null): string[][] {
  const ohne = tags.filter((t) => t[0] !== "agentenketten").map((t) => [...t]);
  const tag = agentenkettenTag(grenze);
  return tag ? [...ohne, tag] : ohne;
}

/** Die geltende Definition eines privaten Raums: die neueste eines Admins (wie `agentRaum()`). */
export function privateDefinition(ereignisse: readonly InneresEvent[], admins: readonly string[]): readonly (readonly string[])[] {
  return ereignisse.filter((e) => e.art === KIND_SPACE && (e.admin ?? admins.includes(e.von))).sort((a, b) => b.zeit - a.zeit)[0]?.tags ?? [];
}

/** Grenze der Agentenketten oder `null` (aus). */
export const kettenGrenze = (tags: readonly (readonly string[])[]): number | null => leseAgentenketten(tags);

/** Grenze aus dem Feld: ganze Zahl 1 … 50, sonst `undefined`. */
export function leseGrenze(text: string): number | undefined {
  const s = text.trim();
  if (!/^\d{1,2}$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= AGENTENKETTE.hoechstens ? n : undefined;
}
