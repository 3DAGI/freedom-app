/**
 * Gewählte Prüfer der Freedom-Prüfung (P2b, E7, `docs/FREEDOM-PRUEFUNG.md`):
 * der Standard-Prüfer des Projekts (`FREEDOM_PRUEFER`, leer bis MENSCH) und
 * die, denen der Nutzer selbst folgt (`freedom.pruefer`) – wie die Abos der
 * Modellkataloge (5.7). Nur ihre Messberichte zählen bei der Auswahl, und nur,
 * wo die eigene Messung zu wenig hat (`stufeFuerAuswahl()`).
 */
import { FREEDOM_PRUEFER } from "@freedomstack/protocol";

export const LS_PRUEFER = "freedom.pruefer";
/** Mehr folgt niemand – jeder Bericht wird bei jeder Auswahl gelesen. */
export const PRUEFER_MAX = 10;

const HEX64 = /^[0-9a-f]{64}$/;

/** Standard-Prüfer plus eigene Wahl – ohne Doppelte, Unbrauchbares fällt weg. */
export function gewaehltePruefer(speicher: { getItem(k: string): string | null }): string[] {
  let eigene: unknown = [];
  try { eigene = JSON.parse(speicher.getItem(LS_PRUEFER) ?? "[]"); } catch { /* kaputt – nur der Standard */ }
  const liste = [...FREEDOM_PRUEFER, ...(Array.isArray(eigene) ? eigene : [])].filter((pk): pk is string => typeof pk === "string" && HEX64.test(pk));
  return [...new Set(liste)].slice(0, PRUEFER_MAX);
}
