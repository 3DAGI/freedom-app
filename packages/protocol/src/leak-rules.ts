/**
 * Regeln fuer Leak-Tests (Schritt 1.5 im Ausbauplan).
 *
 * Ein Leak-Test schneidet mit, was veroeffentlicht wird, und prueft es gegen
 * diese Regeln. Jede Regel liefert die Verstoesse – eine leere Liste heisst:
 * eingehalten.
 */
import type { NostrEvent } from "./event.js";

export interface LeakFinding {
  regel: string;
  eventId: string;
  detail: string;
}

/** Keine Direktnachrichten im alten, offenen Format (Kind 4). */
export function regelKeinKind4(events: readonly NostrEvent[]): LeakFinding[] {
  return events
    .filter((e) => e.kind === 4)
    .map((e) => ({ regel: "kein-kind4", eventId: e.id, detail: "Kind-4-DM veröffentlicht" }));
}

/** Kein Klartext (ab 6 Zeichen) im Inhalt oder in Tags. */
export function regelKeinKlartext(events: readonly NostrEvent[], klartexte: readonly string[]): LeakFinding[] {
  const funde: LeakFinding[] = [];
  for (const e of events) {
    const sichtbar = e.content + "\n" + JSON.stringify(e.tags);
    for (const k of klartexte) {
      if (k.length >= 6 && sichtbar.includes(k)) {
        funde.push({ regel: "kein-klartext", eventId: e.id, detail: `Klartext sichtbar: ${k.slice(0, 20)}…` });
      }
    }
  }
  return funde;
}

/** Ein bestimmter Schluessel darf nicht als Autor auftauchen. */
export function regelAutorNicht(events: readonly NostrEvent[], pubkey: string): LeakFinding[] {
  return events
    .filter((e) => e.pubkey === pubkey)
    .map((e) => ({ regel: "autor-verborgen", eventId: e.id, detail: "echter Absender ist Autor" }));
}

/** p-Tags nur an erlaubte Empfaenger. */
export function regelPTagsNur(events: readonly NostrEvent[], erlaubt: readonly string[]): LeakFinding[] {
  const funde: LeakFinding[] = [];
  for (const e of events) {
    for (const t of e.tags) {
      if (t[0] === "p" && !erlaubt.includes(t[1])) {
        funde.push({ regel: "p-tags", eventId: e.id, detail: `unerwarteter Empfänger ${t[1].slice(0, 8)}…` });
      }
    }
  }
  return funde;
}
