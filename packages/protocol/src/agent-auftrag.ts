/**
 * Agenten in Räumen – wann ein Agent antwortet und womit (11.3b2, Entwurf
 * `docs/AGENTEN-RAUM-ENTWURF.md` P3, P5, Entscheidungen F2 und F5 vom 08.10.2026).
 *
 * - **Auslöser:** nur eine Nachricht, die den Agenten erwähnt (`p` … `mention`), von
 *   einem Mitglied mit Schreibrecht im Kanal. Mitlesen allein löst nichts aus.
 * - **Agentenketten (F5):** Schreibt ein Agent, antwortet ein anderer nur, wenn der
 *   Raum es erlaubt (Schalter, Standard aus), seine Antworten aus einem Budget kommen
 *   und die Kette seit dem letzten Menschen kürzer ist als die Grenze des Raums
 *   (Standard 10, höchstens 50). Gezählt wird aus dem Raum, nie aus einer Angabe des Agenten.
 * - **Bremse:** je Absender höchstens 3 Aufträge je Minute – auch für Agenten.
 * - **Kontext:** nur der Kanal bzw. Thread der Erwähnung, bis zur Erwähnung, in den
 *   Grenzen des Fragenden (in der App `VERLAUF_UMFANG`); andere Agenten gekennzeichnet.
 * - **Verweis im Auftrag:** Raum und Erwähnung – nur im versiegelten Kern an einen
 *   Knoten-Agenten, damit er prüft, dass es die Erwähnung gibt.
 * - **Antwort:** im selben Kanal, als Antwort auf die Erwähnung, mit dem Fragenden;
 *   höchstens 4000 Zeichen.
 * - **Monatsbudget (F2):** Gutschriften im Zahlkanal sind kumulativ; die nächste liegt
 *   je eine Stufe (Standard 10 % des Budgets) über dem Verbrauchten, nie über dem Budget.
 *   Ohne Arbeit kann der Knoten so nie mehr als eine Stufe einlösen.
 */
import type { NostrEvent } from "./event.js";
import type { InneresEvent, InneresSenden } from "./raum-gruppe.js";
import { raumNachricht } from "./raum-gruppe.js";
import { leseRaumAdresse } from "./spaces.js";
import { RateLimiter } from "./antispam.js";

export const AGENT_AUFTRAG = Object.freeze({ jeMinute: 3, antwortZeichen: 4000 });
export const AGENTENKETTE = Object.freeze({ vorgabe: 10, hoechstens: 50 });
export const BUDGET_STUFE_PROZENT = 10;

const HEX64 = /^[0-9a-f]{64}$/;

/** Eine Nachricht im Raum – offen (Kind 42) oder innen (Art 9) –, wie die Regeln hier sie brauchen. */
export interface RaumNachricht {
  id: string;
  von: string;
  zeit: number;
  text: string;
  kanal: string;
  threadRoot?: string;
  replyTo?: string;
  erwaehnt: string[];
}

function ausTags(id: string, von: string, zeit: number, text: string, tags: readonly (readonly string[])[]): RaumNachricht | null {
  const kanal = tags.find((t) => t[0] === "h")?.[1];
  if (!kanal) return null;
  const e = (marke: string) => tags.find((t) => t[0] === "e" && t[3] === marke)?.[1];
  const threadRoot = e("root"), replyTo = e("reply");
  return {
    id, von, zeit, text, kanal,
    ...(threadRoot ? { threadRoot } : {}),
    ...(replyTo ? { replyTo } : {}),
    erwaehnt: tags.filter((t) => t[0] === "p" && t[3] === "mention" && HEX64.test(t[1] ?? "")).map((t) => t[1]!),
  };
}

/** Offene Nachricht (Kind 42, schon geprüft) für die Regeln. */
export function ausRaumEvent(ev: NostrEvent): RaumNachricht | null {
  return ev.kind === 42 ? ausTags(ev.id, ev.pubkey, ev.created_at, ev.content, ev.tags) : null;
}

/** Innere Nachricht eines privaten Raums (Art 9, Absender aus MLS) für die Regeln. */
export function ausInnererNachricht(e: InneresEvent): RaumNachricht | null {
  return e.art === 9 ? ausTags(e.id, e.von, e.zeit, e.text, e.tags) : null;
}

// ------------------------------------------------------------ Agentenketten (F5)

/** Schalter in der Raum-Definition (offen 34700 vom Gründer, privat im Raumstand): an mit Grenze, sonst kein Tag. */
export function agentenkettenTag(grenze: number | null): string[] | null {
  if (grenze === null) return null;
  if (!Number.isInteger(grenze) || grenze < 1 || grenze > AGENTENKETTE.hoechstens) throw new Error("Grenze der Agentenketten ungültig");
  return ["agentenketten", String(grenze)];
}

/** Schalter lesen: Grenze oder `null` (aus). Unsinn heißt aus – nie mehr als erlaubt. */
export function leseAgentenketten(tags: readonly (readonly string[])[]): number | null {
  const l = tags.filter((t) => t[0] === "agentenketten");
  if (l.length !== 1 || !/^\d{1,2}$/.test(l[0]![1] ?? "")) return null;
  const n = Number(l[0]![1]);
  return n >= 1 && n <= AGENTENKETTE.hoechstens ? n : null;
}

/**
 * Wie viele Agenten-Antworten in Folge stehen bis hier – rückwärts über `replyTo`,
 * bis zur ersten Nachricht eines Menschen. Fehlt ein Glied, endet die Kette dort.
 */
export function kettenLaenge(nachricht: RaumNachricht, alle: readonly RaumNachricht[], istAgent: (pk: string) => boolean): number {
  const je = new Map(alle.map((n) => [n.id, n]));
  const gesehen = new Set<string>();
  let n: RaumNachricht | undefined = nachricht;
  let zahl = 0;
  while (n && istAgent(n.von) && !gesehen.has(n.id) && zahl <= AGENTENKETTE.hoechstens) {
    gesehen.add(n.id);
    zahl++;
    n = n.replyTo ? je.get(n.replyTo) : undefined;
  }
  return zahl;
}

// ------------------------------------------------------------ Auslöser (P3)

export type KeinAuftrag = "nicht-erwaehnt" | "selbst" | "kein-schreibrecht" | "agent-ohne-ketten" | "ohne-budget" | "kette-voll";

/**
 * Soll der Agent auf diese Nachricht antworten? Die Bremse je Absender prüft
 * `AuftragsBremse` danach – sie zählt nur, was hier durchgeht.
 */
export function sollAntworten(p: {
  agent: string;
  nachricht: RaumNachricht;
  alle: readonly RaumNachricht[];
  /** Schreibrecht im Kanal, aus dem Stand des Raums. */
  darfSchreiben: (pk: string, kanal: string) => boolean;
  istAgent: (pk: string) => boolean;
  /** Grenze der Agentenketten des Raums, `null` = aus. */
  ketten: number | null;
  /** Kommen die Antworten dieses Agenten aus einem Budget (Einlader, beim Gerät der Ersteller)? */
  ausBudget: boolean;
}): { ja: true } | { ja: false; grund: KeinAuftrag } {
  const n = p.nachricht;
  if (!n.erwaehnt.includes(p.agent)) return { ja: false, grund: "nicht-erwaehnt" };
  if (n.von === p.agent) return { ja: false, grund: "selbst" };
  if (!p.darfSchreiben(n.von, n.kanal)) return { ja: false, grund: "kein-schreibrecht" };
  if (p.istAgent(n.von)) {
    if (p.ketten === null) return { ja: false, grund: "agent-ohne-ketten" };
    // „Wer fragt, zahlt“ gilt nur für Menschen – Knoten zahlen nichts aus (5.1.2)
    if (!p.ausBudget) return { ja: false, grund: "ohne-budget" };
    if (kettenLaenge(n, p.alle, p.istAgent) >= p.ketten) return { ja: false, grund: "kette-voll" };
  }
  return { ja: true };
}

/** Bremse: je Absender höchstens `AGENT_AUFTRAG.jeMinute` Aufträge je Minute – auch für Agenten. */
export class AuftragsBremse {
  private readonly l = new RateLimiter({ maxPerWindow: AGENT_AUFTRAG.jeMinute, windowSecs: 60, paidMultiplier: 1 });

  erlaubt(von: string, jetztSek: number): boolean {
    return this.l.check(von, false, jetztSek).allowed;
  }
}

// ------------------------------------------------------------ Kontext (P3)

/**
 * Kontext eines Auftrags – nur, was der Fragende sieht: der Kanal der Erwähnung,
 * im Thread nur der Thread (samt Anfang), ohne Thread nur Nachrichten ohne Thread;
 * nur davor; die letzten `nachrichten`, zusammen höchstens `zeichen` Zeichen.
 * Andere Räume, Kanäle oder Direktnachrichten kommen nie hinein.
 */
export function agentKontext(p: {
  nachricht: RaumNachricht;
  alle: readonly RaumNachricht[];
  nachrichten: number;
  zeichen: number;
  istAgent: (pk: string) => boolean;
}): { von: string; agent: boolean; text: string }[] {
  const n = p.nachricht;
  const passt = (m: RaumNachricht) => m.kanal === n.kanal && m.id !== n.id
    && (m.zeit < n.zeit || (m.zeit === n.zeit && m.id < n.id))
    && (n.threadRoot ? m.threadRoot === n.threadRoot || m.id === n.threadRoot : !m.threadRoot);
  const davor = p.alle.filter(passt).sort((a, b) => a.zeit - b.zeit || (a.id < b.id ? -1 : 1));
  const aus: { von: string; agent: boolean; text: string }[] = [];
  let rest = Math.max(0, p.zeichen);
  for (const m of davor.reverse()) {
    if (aus.length >= p.nachrichten || m.text.length > rest) break;
    rest -= m.text.length;
    aus.unshift({ von: m.von, agent: p.istAgent(m.von), text: m.text });
  }
  return aus;
}

// ------------------------------------------------------------ Verweis im Auftrag (P5)

/** Tags für den versiegelten Kern eines Auftrags an einen Knoten-Agenten: Raum und Erwähnung. */
export function auftragsVerweisTags(v: { raum: string; erwaehnung: string }): string[][] {
  if (!gueltigerRaum(v.raum) || !HEX64.test(v.erwaehnung)) throw new Error("Verweis ungültig");
  return [["agent-raum", v.raum], ["agent-erwaehnung", v.erwaehnung]];
}

/** Verweis aus dem Kern lesen – Raum (Adresse eines offenen Raums oder Gruppe) und Id der Erwähnung. */
export function leseAuftragsVerweis(tags: readonly (readonly string[])[]): { raum: string; erwaehnung: string } | null {
  const eins = (n: string) => { const l = tags.filter((t) => t[0] === n); return l.length === 1 ? l[0]![1] : undefined; };
  const raum = eins("agent-raum"), erwaehnung = eins("agent-erwaehnung");
  return raum && erwaehnung && gueltigerRaum(raum) && HEX64.test(erwaehnung) ? { raum, erwaehnung } : null;
}

/** Gruppen-Ids von MDK sind 16 Byte (32 Zeichen Hex) – wie bei Meldungen 32 bis 64 Zeichen (bis 11.3d2b nur 64: keine echte Gruppe passte). */
const GRUPPE_HEX = /^[0-9a-f]{32,64}$/;
const gueltigerRaum = (r: string) => GRUPPE_HEX.test(r) || leseRaumAdresse(r) !== null;

// ------------------------------------------------------------ Antwort (P3)

/** Antwort kürzen: höchstens `AGENT_AUFTRAG.antwortZeichen` Zeichen (nach Codepunkten). */
export function kuerzeAgentAntwort(text: string): string {
  const z = [...text];
  return z.length <= AGENT_AUFTRAG.antwortZeichen ? text : z.slice(0, AGENT_AUFTRAG.antwortZeichen - 1).join("") + "…";
}

/** Tags einer offenen Antwort (Kind 42): Kanal, Thread, Antwort auf die Erwähnung, der Fragende. */
export function agentAntwortTags(auf: RaumNachricht): string[][] {
  const tags: string[][] = [["h", auf.kanal]];
  if (auf.threadRoot) tags.push(["e", auf.threadRoot, "", "root"]);
  tags.push(["e", auf.id, "", "reply"], ["p", auf.von, "", "mention"]);
  return tags;
}

/** Antwort im privaten Raum – inneres Event, wie jede Nachricht der Gruppe. */
export function raumAgentAntwort(auf: RaumNachricht, text: string): InneresSenden {
  return raumNachricht({ kanal: auf.kanal, text: kuerzeAgentAntwort(text), ...(auf.threadRoot ? { threadRoot: auf.threadRoot } : {}), replyTo: auf.id, erwaehnt: [auf.von] });
}

// ------------------------------------------------------------ Monatsbudget (F2)

/** Eine Stufe: `prozent` des Budgets, mindestens 1. */
export function budgetStufe(budget: bigint, prozent = BUDGET_STUFE_PROZENT): bigint {
  if (budget <= 0n || !Number.isInteger(prozent) || prozent < 1 || prozent > 100) throw new Error("Budget oder Stufe ungültig");
  const s = (budget * BigInt(prozent)) / 100n;
  return s > 0n ? s : 1n;
}

/**
 * Nächste kumulative Gutschrift: eine Stufe über dem Verbrauchten, nie über dem
 * Budget. `null`, wenn die bisherige reicht oder das Budget erreicht ist – dann
 * schweigt der Agent, bis neu eingezahlt wird (nur auf Klick).
 */
export function naechsteStufe(p: { budget: bigint; stufe: bigint; verbraucht: bigint; gutgeschrieben: bigint }): bigint | null {
  if (p.verbraucht < 0n || p.gutgeschrieben < 0n || p.stufe <= 0n) throw new Error("Stand ungültig");
  const ziel = p.verbraucht + p.stufe < p.budget ? p.verbraucht + p.stufe : p.budget;
  return ziel > p.gutgeschrieben ? ziel : null;
}
