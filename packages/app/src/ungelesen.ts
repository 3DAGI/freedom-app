/**
 * Ungelesenes in Direktnachrichten (C-30, Nutzertest C-11): Nichts zeigte an, dass
 * eine Nachricht da war – kein Fettdruck, kein Zähler in der Liste oder in der
 * Navigation. Je Unterhaltung zählen zwei Zeitpunkte (Sekunden): `eingang`, die
 * neueste Nachricht vom Gegenüber, und `gelesen`, wann man sie zuletzt vor Augen
 * hatte. Ohne DOM, damit es sich testen lässt.
 */

export interface LeseStand {
  /** Neueste Nachricht vom Gegenüber (eigene zählen nicht). */
  eingang?: number;
  /** Zuletzt gelesen – beim Öffnen und solange die Unterhaltung vor Augen ist. */
  gelesen?: number;
}

/** Ungelesen, wenn vom Gegenüber etwas Neueres kam, als man zuletzt sah. */
export function istUngelesen(c: LeseStand): boolean {
  return (c.eingang ?? 0) > (c.gelesen ?? 0);
}

/** Wie viele Unterhaltungen Ungelesenes haben. */
export function zahlUngelesen(liste: readonly LeseStand[]): number {
  return liste.filter(istUngelesen).length;
}

/** Zähler für die Navigation – ab 100 „99+“. */
export function zaehlerText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * Gespeicherte Unterhaltungen von vor C-30 haben kein `gelesen`: Sie gelten bis zu
 * ihrer letzten Nachricht als gelesen – sonst stünde nach dem Update alles als neu da.
 */
export function ergaenzeGelesen<T extends LeseStand & { lastTs?: number }>(c: T): T {
  if (c.gelesen === undefined && typeof c.lastTs === "number" && c.lastTs > 0) c.gelesen = c.lastTs;
  return c;
}
