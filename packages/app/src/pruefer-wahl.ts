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

/** Nur die selbst gewählten (ohne Standard) – für die Liste zum Abwählen. */
export function eigenePruefer(speicher: { getItem(k: string): string | null }): string[] {
  const standard = new Set(FREEDOM_PRUEFER);
  return gewaehltePruefer(speicher).filter((pk) => !standard.has(pk));
}

/** Einem Prüfer folgen – false, wenn schon zehn gewählt sind oder der Schlüssel unbrauchbar ist. */
export function folgePruefer(speicher: { getItem(k: string): string | null; setItem(k: string, v: string): void }, pk: string): boolean {
  if (!HEX64.test(pk)) return false;
  const eigene = eigenePruefer(speicher);
  if (eigene.includes(pk) || FREEDOM_PRUEFER.includes(pk)) return true;
  if (gewaehltePruefer(speicher).length >= PRUEFER_MAX) return false;
  speicher.setItem(LS_PRUEFER, JSON.stringify([...eigene, pk]));
  return true;
}

export function entfolgePruefer(speicher: { getItem(k: string): string | null; setItem(k: string, v: string): void }, pk: string): void {
  speicher.setItem(LS_PRUEFER, JSON.stringify(eigenePruefer(speicher).filter((x) => x !== pk)));
}
