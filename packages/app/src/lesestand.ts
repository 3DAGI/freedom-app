/**
 * Lesestand je Kanal (seit C-14): wann man welchen Kanal zuletzt las. Das
 * verrät Gewohnheiten – deshalb liegt er über `geheim` (mit Tresor im Tresor)
 * und nicht im Klartext. Gespeichert als Objekt `{ kanal: sekunden }`, damit
 * die Zusammenführung der Sicherung (`spaetestes`, B-5) ihn je Kanal mischen
 * kann; bis C-14 stand er als Liste von Paaren in `localStorage` – die liest
 * `leseLesestand()` weiter.
 */

export const LS_LESESTAND = "freedom.lastRead";

/** Gespeicherten Stand lesen – Objekt (neu) oder Liste von Paaren (bis C-14); Unbrauchbares fällt weg. */
export function leseLesestand(roh: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!roh) return out;
  let wert: unknown;
  try { wert = JSON.parse(roh); } catch { return out; }
  const paare: unknown[] = Array.isArray(wert)
    ? wert
    : wert && typeof wert === "object" ? Object.entries(wert as Record<string, unknown>) : [];
  for (const p of paare) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const [kanal, zeit] = p as [unknown, unknown];
    if (typeof kanal === "string" && kanal && Number.isSafeInteger(zeit) && (zeit as number) >= 0) out.set(kanal, zeit as number);
  }
  return out;
}

/** Zum Speichern: als Objekt. */
export function schreibeLesestand(stand: ReadonlyMap<string, number>): string {
  return JSON.stringify(Object.fromEntries(stand));
}
