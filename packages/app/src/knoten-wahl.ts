/**
 * „Mein Knoten“ in der Modellwahl (Sammlung B-9a): der Wahlwert
 * `knoten:<modell>` – leer heißt das Modell, das der Knoten selbst wählt. Ohne
 * DOM, damit die Tests ihn lesen können (wie `ki-lokal.ts` für „Dieses Gerät“).
 */
export const KNOTEN_PRAEFIX = "knoten:";

export function knotenWahlwert(modell: string): string {
  return KNOTEN_PRAEFIX + modell;
}

/** Das Modell bei meinem Knoten, wenn die Wahl eines ist („“ = das des Knotens), sonst null. */
export function knotenModellAus(wahl: string | undefined | null): string | null {
  return wahl?.startsWith(KNOTEN_PRAEFIX) ? wahl.slice(KNOTEN_PRAEFIX.length) : null;
}
