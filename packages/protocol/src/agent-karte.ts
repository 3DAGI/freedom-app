/**
 * Agenten in Räumen – Karte, Bestätigung des Besitzers, Rolle (11.3b1, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md`, freigegeben 08.10.2026: F1 A, F4 A, F6 A).
 *
 * - Ein Agent hat einen eigenen Schlüssel, nie die Identität seines Erstellers –
 *   sonst spräche er mit dessen Stimme.
 * - **Karte** (Kind 38090, `d` = `karte`), Autor ist der Agent: Name, Beschreibung,
 *   Betrieb (`knoten` | `geraet`), wer bezahlt (`fragender` | `einlader`), optional
 *   Besitzer, Provider, Modell. Keine Persona und keine Systemanweisung – die hält
 *   der Gastgeber (F4 A).
 * - **Besitzer** zählt nur mit seiner Bestätigung (F1 A): eine NIP-51-Liste seiner
 *   Agenten (Kind 30000, `d` = `freedom-agenten`, je Agent ein `p`). Sonst könnte
 *   jeder einen Agenten „von X“ nennen.
 * - **Rolle** `agent` in offenen Räumen (F6 A): lesen, schreiben, Threads – nie
 *   moderieren, vergeben, verwalten oder Repos pflegen.
 * - **Private Räume:** Karte und Liste nur als innere Events der Gruppe
 *   (`raumAgentKarte()`, `raumAgentenListe()`), nie veröffentlicht – Leak-Regel
 *   `agent-raum-privat`. Den Absender belegt dort MLS.
 *
 * Fremde Karten werden streng gelesen; gezeigt wird alles nur als Text.
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, verifyEvent } from "./event.js";
import type { InneresEvent, InneresSenden } from "./raum-gruppe.js";
import type { Permission, Role } from "./spaces.js";

export const KIND_AGENT_KARTE = 38090;
export const AGENT_KARTE_D = "karte";
/** NIP-51-Set (Kind 30000) des Besitzers – derselbe Kind wie die Kontaktliste, ein anderer Name. */
export const KIND_AGENTEN_LISTE = 30000;
export const AGENTEN_LISTE_D = "freedom-agenten";

export const AGENT_ROLLE = "agent";
export const AGENT_RECHTE: readonly Permission[] = ["lesen", "schreiben", "threads"];

export const AGENT_GRENZEN = Object.freeze({ name: 64, about: 500, modell: 128, agentenJeListe: 100 });

export type AgentBetrieb = "knoten" | "geraet";
export type AgentBezahlung = "fragender" | "einlader";
const BETRIEBE: readonly AgentBetrieb[] = ["knoten", "geraet"];
const BEZAHLUNGEN: readonly AgentBezahlung[] = ["fragender", "einlader"];

export interface AgentKarteDaten {
  name: string;
  about?: string;
  betrieb: AgentBetrieb;
  bezahlung: AgentBezahlung;
  /** Behauptet – zählt nur mit `besitzerBestaetigt()`. */
  besitzer?: string;
  /** Wer rechnet: beim Gerät der gewählte Provider, beim Knoten der Knoten selbst. */
  provider?: string;
  modell?: string;
}

export interface AgentKarte extends AgentKarteDaten {
  /** Schlüssel des Agenten – Autor der Karte. */
  agent: string;
  zeit: number;
  id: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
/** Ein Text ohne Steuerzeichen, nicht leer, höchstens `max` Zeichen. */
const text = (s: unknown, max: number): s is string =>
  typeof s === "string" && s.trim() !== "" && [...s].length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s);

/** Prüft die Angaben einer Karte; wirft bei Unsinn (beim Bauen) – `null` gibt es nur beim Lesen. */
function pruefe(k: AgentKarteDaten): AgentKarteDaten | null {
  if (!text(k.name, AGENT_GRENZEN.name)) return null;
  if (k.about !== undefined && !text(k.about, AGENT_GRENZEN.about)) return null;
  if (!BETRIEBE.includes(k.betrieb) || !BEZAHLUNGEN.includes(k.bezahlung)) return null;
  if (k.besitzer !== undefined && !HEX64.test(k.besitzer)) return null;
  if (k.provider !== undefined && !HEX64.test(k.provider)) return null;
  if (k.modell !== undefined && !text(k.modell, AGENT_GRENZEN.modell)) return null;
  return {
    name: k.name, betrieb: k.betrieb, bezahlung: k.bezahlung,
    ...(k.about !== undefined ? { about: k.about } : {}),
    ...(k.besitzer !== undefined ? { besitzer: k.besitzer } : {}),
    ...(k.provider !== undefined ? { provider: k.provider } : {}),
    ...(k.modell !== undefined ? { modell: k.modell } : {}),
  };
}

/** Tags einer Karte – dieselben offen (38090) und innen (privater Raum). */
export function agentKarteTags(k: AgentKarteDaten): string[][] {
  const p = pruefe(k);
  if (!p) throw new Error("Agent-Karte ungültig");
  const tags: string[][] = [["d", AGENT_KARTE_D], ["name", p.name], ["betrieb", p.betrieb], ["bezahlung", p.bezahlung]];
  if (p.about !== undefined) tags.push(["about", p.about]);
  if (p.besitzer !== undefined) tags.push(["p", p.besitzer, "", "besitzer"]);
  if (p.provider !== undefined) tags.push(["provider", p.provider]);
  if (p.modell !== undefined) tags.push(["modell", p.modell]);
  return tags;
}

/** Karte für einen offenen Raum – Autor (und Signierer) ist der Agent. */
export function baueAgentKarte(agent: string, k: AgentKarteDaten, nowSecs?: number): UnsignedEvent {
  if (!HEX64.test(agent)) throw new Error("Agent ungültig");
  if (k.besitzer === agent) throw new Error("Agent und Besitzer gleich");
  return buildEvent(agent, KIND_AGENT_KARTE, agentKarteTags(k), "", nowSecs);
}

/** Tags streng lesen: jedes Feld höchstens einmal, nur bekannte Werte. */
function ausTags(tags: readonly (readonly string[])[], agent: string): AgentKarteDaten | null {
  const einmal = (n: string): string | undefined | null => {
    const l = tags.filter((t) => t[0] === n);
    return l.length > 1 ? null : l[0]?.[1];
  };
  const d = einmal("d"), name = einmal("name"), about = einmal("about"), betrieb = einmal("betrieb"),
    bezahlung = einmal("bezahlung"), provider = einmal("provider"), modell = einmal("modell");
  if (d !== AGENT_KARTE_D || [name, about, betrieb, bezahlung, provider, modell].includes(null)) return null;
  const besitzerTags = tags.filter((t) => t[0] === "p" && t[3] === "besitzer");
  if (besitzerTags.length > 1) return null;
  const besitzer = besitzerTags[0]?.[1];
  if (besitzer === agent) return null;
  return pruefe({
    name: name as string, betrieb: betrieb as AgentBetrieb, bezahlung: bezahlung as AgentBezahlung,
    ...(about != null ? { about } : {}), ...(besitzer !== undefined ? { besitzer } : {}),
    ...(provider != null ? { provider } : {}), ...(modell != null ? { modell } : {}),
  });
}

/** Eine fremde Karte lesen – Signatur, Art, Form; sonst `null`. */
export function leseAgentKarte(ev: NostrEvent): AgentKarte | null {
  if (ev.kind !== KIND_AGENT_KARTE || !verifyEvent(ev) || ev.content !== "") return null;
  const k = ausTags(ev.tags, ev.pubkey);
  return k ? { ...k, agent: ev.pubkey, zeit: ev.created_at, id: ev.id } : null;
}

/** Je Agent die neueste gültige Karte (ersetzbar je Autor und `d`). */
export function aktuelleAgentKarten(evs: readonly NostrEvent[]): AgentKarte[] {
  return neuesteJeAgent(evs.map(leseAgentKarte).filter((k): k is AgentKarte => k !== null));
}

function neuesteJeAgent(karten: readonly AgentKarte[]): AgentKarte[] {
  const je = new Map<string, AgentKarte>();
  for (const k of karten) {
    const alt = je.get(k.agent);
    if (!alt || k.zeit > alt.zeit || (k.zeit === alt.zeit && k.id > alt.id)) je.set(k.agent, k);
  }
  return [...je.values()];
}

// ------------------------------------------------------------ Besitzer (F1 A)

/** Tags der Liste des Besitzers – je Agent ein `p`, ohne Doppelte, nie der Besitzer selbst. */
export function agentenListeTags(besitzer: string, agenten: readonly string[]): string[][] {
  const eindeutig = [...new Set(agenten)];
  if (eindeutig.length > AGENT_GRENZEN.agentenJeListe || eindeutig.some((a) => !HEX64.test(a) || a === besitzer)) {
    throw new Error("Agenten-Liste ungültig");
  }
  return [["d", AGENTEN_LISTE_D], ...eindeutig.map((a) => ["p", a])];
}

/** Liste der eigenen Agenten (offen) – bestätigt Karten, die einen als Besitzer nennen. */
export function baueAgentenListe(besitzer: string, agenten: readonly string[], nowSecs?: number): UnsignedEvent {
  if (!HEX64.test(besitzer)) throw new Error("Besitzer ungültig");
  return buildEvent(besitzer, KIND_AGENTEN_LISTE, agentenListeTags(besitzer, agenten), "", nowSecs);
}

/** Eine Liste, offen (signiert) oder innen (MLS belegt den Absender). */
type ListenEvent = { id: string; pubkey: string; kind: number; created_at: number; tags: readonly (readonly string[])[] };

/**
 * Wer die Karte besitzt – nur, wenn die neueste Liste des genannten Besitzers
 * den Agenten nennt. Sonst `null` (kein Besitzer, nicht bestätigt, widerrufen).
 * Offene Listen müssen signiert sein (`verifyEvent` vor dem Aufruf, z. B. über
 * `query()`); innere kommen aus `raumListenEvents()`.
 */
export function besitzerBestaetigt(karte: Pick<AgentKarte, "agent" | "besitzer">, listen: readonly ListenEvent[]): string | null {
  const b = karte.besitzer;
  if (!b) return null;
  const eigene = listen.filter((l) => l.pubkey === b && l.kind === KIND_AGENTEN_LISTE && l.tags.some((t) => t[0] === "d" && t[1] === AGENTEN_LISTE_D));
  const neueste = eigene.reduce<ListenEvent | undefined>((a, l) => (!a || l.created_at > a.created_at || (l.created_at === a.created_at && l.id > a.id) ? l : a), undefined);
  return neueste?.tags.some((t) => t[0] === "p" && t[1] === karte.agent) ? b : null;
}

// ------------------------------------------------------------ Rolle (F6 A)

/** Die Standardrolle für Agenten in offenen Räumen – Rang unter jeder vergebenen Rolle. */
export function agentRolle(): Role {
  return { id: AGENT_ROLLE, name: "Agent", rank: 1, permissions: [...AGENT_RECHTE] };
}

/**
 * Rollenliste mit der Rolle `agent`: fehlt sie, kommt sie dazu; steht sie mit mehr
 * Rechten da, gilt sie nur mit den Grundrechten – ein Agent moderiert nie.
 */
export function mitAgentRolle(rollen: readonly Role[]): Role[] {
  const da = rollen.find((r) => r.id === AGENT_ROLLE);
  if (!da) return [...rollen, agentRolle()];
  return rollen.map((r) => (r.id === AGENT_ROLLE ? { ...r, permissions: r.permissions.filter((p) => AGENT_RECHTE.includes(p)) } : r));
}

// ------------------------------------------------------------ Private Räume

/** Karte als inneres Event der Gruppe – gesendet vom Agenten selbst. */
export function raumAgentKarte(k: AgentKarteDaten): InneresSenden {
  return { art: KIND_AGENT_KARTE, tags: agentKarteTags(k), text: "" };
}

/** Liste des Besitzers als inneres Event – nur in dieser Gruppe sichtbar. */
export function raumAgentenListe(besitzer: string, agenten: readonly string[]): InneresSenden {
  return { art: KIND_AGENTEN_LISTE, tags: agentenListeTags(besitzer, agenten), text: "" };
}

/** Karten aus den inneren Events einer Gruppe – je Agent die neueste; Absender aus MLS. */
export function raumAgentKarten(ereignisse: readonly InneresEvent[]): AgentKarte[] {
  return neuesteJeAgent(ereignisse.flatMap((e) => {
    if (e.art !== KIND_AGENT_KARTE || e.text !== "" || !HEX64.test(e.von)) return [];
    const k = ausTags(e.tags, e.von);
    return k ? [{ ...k, agent: e.von, zeit: e.zeit, id: e.id }] : [];
  }));
}

/** Listen aus den inneren Events, geformt für `besitzerBestaetigt()`. */
export function raumListenEvents(ereignisse: readonly InneresEvent[]): ListenEvent[] {
  return ereignisse.filter((e) => e.art === KIND_AGENTEN_LISTE).map((e) => ({ id: e.id, pubkey: e.von, kind: e.art, created_at: e.zeit, tags: e.tags }));
}
