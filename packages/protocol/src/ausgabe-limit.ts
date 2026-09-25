/**
 * Tageslimit fuer eine eingebaute Wallet (Schritt 4.2) – wie das Budget einer
 * NWC-Verbindung, nur dass hier die App selbst aufpasst, weil sie den
 * Schluessel haelt. Gezaehlt wird in einem rollenden 24-Stunden-Fenster:
 * Ein Kalendertag liesse sich um Mitternacht zweimal ausschoepfen.
 */

export const FENSTER_SECS = 24 * 3600;

export interface Ausgabe {
  /** Unix-Sekunden */
  zeit: number;
  /** In der Einheit der Wallet (Lamports). */
  betrag: number;
}

export interface LimitPruefung {
  /** Passt die Zahlung ohne Nachfrage ins Limit? */
  ohneNachfrage: boolean;
  /** In den letzten 24 Stunden schon ausgegeben. */
  verbraucht: number;
  /** Was ohne Nachfrage noch geht. */
  rest: number;
}

/** Nur die Ausgaben im Fenster, gueltige Zahlen – aeltere fallen heraus. */
export function imFenster(verlauf: readonly Ausgabe[], jetzt: number): Ausgabe[] {
  return verlauf.filter((a) => Number.isSafeInteger(a.betrag) && a.betrag > 0 && a.zeit > jetzt - FENSTER_SECS && a.zeit <= jetzt);
}

/**
 * Prueft eine Zahlung gegen das Tageslimit. Ueber dem Limit ist sie nicht
 * verboten – die App fragt dann ausdruecklich nach (Karte 4.2). Limit 0 heisst:
 * jede Zahlung braucht eine Bestaetigung.
 */
export function pruefeTageslimit(verlauf: readonly Ausgabe[], betrag: number, limit: number, jetzt: number): LimitPruefung {
  if (!Number.isSafeInteger(betrag) || betrag <= 0) throw new Error("Betrag muss eine positive ganze Zahl sein");
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Limit muss eine nicht negative ganze Zahl sein");
  const verbraucht = imFenster(verlauf, jetzt).reduce((s, a) => s + a.betrag, 0);
  const rest = Math.max(0, limit - verbraucht);
  return { ohneNachfrage: betrag <= rest, verbraucht, rest };
}
