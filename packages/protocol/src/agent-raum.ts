/**
 * Erwähnungen in Räumen beantworten – ohne Netz, gemeinsam für App und Knoten
 * (11.3c2a in der App, seit 11.3d1a hier, damit der Agent auf dem Knoten mit
 * denselben Regeln entscheidet; Entwurf `docs/AGENTEN-RAUM-ENTWURF.md` P3, P4, F5).
 *
 * - Ob ein Agent antwortet, entscheiden nur die Regeln aus 11.3b
 *   (`sollAntworten()`, `AuftragsBremse`) mit dem Stand des Raums: Schreibrecht
 *   je Kanal, Agenten sind Mitglieder mit der Rolle `agent`, Agentenketten nur mit
 *   dem Schalter in der Definition des Gründers.
 * - Der Provider bekommt nur Persona, den Kontext aus `agentKontext()` und die
 *   Frage – Absender als „Person 1“, „Agent 1“, nie Schlüssel oder Namen.
 * - Die Antwort ist eine Nachricht des Agenten im selben Kanal, als Antwort auf
 *   die Erwähnung, mit dem Fragenden als Erwähnung; höchstens 4000 Zeichen.
 */
import type { NostrEvent, UnsignedEvent } from "./event.js";
import { AGENT_ROLLE } from "./agent-karte.js";
import { type AuftragsBremse, type RaumNachricht, agentKontext, ausRaumEvent, kuerzeAgentAntwort, leseAgentenketten, sollAntworten } from "./agent-auftrag.js";
import { KIND_SPACE, type SpaceState, buildChannelMessage, canWriteTo, leseRaumAdresse } from "./spaces.js";

/** Mitglied mit der Rolle `agent` – so erkennt der Raum Agenten, nie an einer Angabe im Text. */
export const istAgentIm = (stand: SpaceState) => (pk: string): boolean => (stand.grants.get(pk) ?? []).includes(AGENT_ROLLE);

/** Schreibrecht in einem Kanal aus dem Stand des Raums. */
export const darfSchreibenIm = (stand: SpaceState) => (pk: string, kanal: string): boolean => {
  const k = stand.space?.channels.find((c) => c.id === kanal);
  return !!k && canWriteTo(pk, k, stand);
};

/**
 * Tags der Definition des Gründers (34700, `d` = `space:<kennung>`) – dort steht der
 * Schalter der Agentenketten (F5). Je Raum die neueste; Definitionen anderer zählen nie.
 */
export function definitionDesGruenders(adresse: string, events: readonly NostrEvent[]): readonly (readonly string[])[] {
  const ort = leseRaumAdresse(adresse);
  if (!ort) return [];
  return events.filter((e) => e.kind === KIND_SPACE && e.pubkey === ort.besitzer && e.tags.some((t) => t[0] === "d" && t[1] === `space:${ort.spaceId}`))
    .sort((a, b) => b.created_at - a.created_at)[0]?.tags ?? [];
}

export type Entscheid =
  | { art: "antworten"; nachricht: RaumNachricht }
  | { art: "schweigen"; grund: string };

/**
 * Was der Agent mit dieser Nachricht tut. `definition`: Tags der Definition des
 * Gründers (34700) – dort steht der Schalter der Agentenketten. Die Bremse zählt
 * nur echte Aufträge.
 */
export function entscheide(p: {
  agent: string;
  ev: NostrEvent;
  alle: readonly NostrEvent[];
  stand: SpaceState;
  definition: readonly (readonly string[])[];
  bremse: AuftragsBremse;
  jetzt: number;
  /** Wer ein Agent ist – offen die Rolle `agent` (Standard), privat die Karten der Gruppe (11.3c3b). */
  istAgent?: (pk: string) => boolean;
  /**
   * Kommen die Antworten aus einem Budget? Beim Agenten auf dem Gerät immer (F3 B);
   * beim Knoten mit „wer fragt, zahlt“ nicht – dann antwortet er nie einem Agenten (F5).
   */
  ausBudget?: boolean;
}): Entscheid {
  const nachricht = ausRaumEvent(p.ev);
  if (!nachricht) return { art: "schweigen", grund: "keine-nachricht" };
  const darfSchreiben = darfSchreibenIm(p.stand);
  if (!darfSchreiben(p.agent, nachricht.kanal)) return { art: "schweigen", grund: "agent-ohne-schreibrecht" };
  const alle = p.alle.map(ausRaumEvent).filter((n): n is RaumNachricht => n !== null);
  const r = sollAntworten({
    agent: p.agent, nachricht, alle, darfSchreiben, istAgent: p.istAgent ?? istAgentIm(p.stand),
    ketten: leseAgentenketten(p.definition), ausBudget: p.ausBudget ?? true,
  });
  if (!r.ja) return { art: "schweigen", grund: r.grund };
  if (!p.bremse.erlaubt(nachricht.von, p.jetzt)) return { art: "schweigen", grund: "bremse" };
  return { art: "antworten", nachricht };
}

/** Grenzen des Verlaufs im Auftrag – in der App aus `VERLAUF_UMFANG`, beim Knoten „kurz“. */
export interface AgentVerlaufGrenzen {
  nachrichten: number;
  zeichen: number;
  jeNachricht: number;
}

/**
 * Der Text für das Modell: Persona, Verlauf des Kanals bzw. Threads bis zur
 * Erwähnung, die Frage. Absender nur als Pseudonym je Auftrag; der Agent selbst
 * heißt „Du“.
 */
export function agentPromptMit(p: {
  agent: string;
  persona: string;
  nachricht: RaumNachricht;
  alle: readonly RaumNachricht[];
  istAgent: (pk: string) => boolean;
  grenzen: AgentVerlaufGrenzen;
}): string {
  const g = p.grenzen;
  const kontext = g.nachrichten === 0 ? [] : agentKontext({ nachricht: p.nachricht, alle: p.alle, nachrichten: g.nachrichten, zeichen: g.zeichen, istAgent: p.istAgent });
  const personen = new Map<string, string>();
  let menschen = 0;
  let agenten = 0;
  const name = (pk: string): string => {
    if (pk === p.agent) return "Du"; // kein UI-Text
    let n = personen.get(pk);
    if (!n) {
      n = p.istAgent(pk) ? `Agent ${++agenten}` : `Person ${++menschen}`; // kein UI-Text
      personen.set(pk, n);
    }
    return n;
  };
  const zeilen = kontext.map((k) => {
    const text = [...k.text].length > g.jeNachricht ? `${[...k.text].slice(0, g.jeNachricht).join("")} …` : k.text;
    return `${name(k.von)}: ${text}`;
  });
  // Geht ans Modell, nicht in die Oberfläche – bleibt in jeder Sprache gleich
  return [
    `[Rolle]:\n${p.persona}`, // kein UI-Text
    ...(zeilen.length ? [`[Bisheriger Verlauf]:\n${zeilen.join("\n")}`] : []), // kein UI-Text
    `[Nachricht von ${name(p.nachricht.von)}]:\n${p.nachricht.text}`, // kein UI-Text
  ].join("\n\n");
}

/** Antwort des Agenten (Kind 42): selber Kanal und Thread, Antwort auf die Erwähnung, der Fragende erwähnt. */
export function agentAntwortEvent(p: { agent: string; kennung: string; auf: RaumNachricht; text: string; jetzt?: number }): UnsignedEvent {
  return buildChannelMessage({
    authorPubkey: p.agent, spaceId: p.kennung, channelId: p.auf.kanal, content: kuerzeAgentAntwort(p.text),
    mentions: [p.auf.von], replyTo: p.auf.id, ...(p.auf.threadRoot ? { threadRoot: p.auf.threadRoot } : {}),
  }, p.jetzt);
}

/** Hinweis des Agenten (Budget erreicht) – im Kanal der Erwähnung, ohne jemanden zu erwähnen. */
export function agentHinweisEvent(p: { agent: string; kennung: string; kanal: string; text: string; jetzt?: number }): UnsignedEvent {
  return buildChannelMessage({ authorPubkey: p.agent, spaceId: p.kennung, channelId: p.kanal, content: p.text, mentions: [] }, p.jetzt);
}
