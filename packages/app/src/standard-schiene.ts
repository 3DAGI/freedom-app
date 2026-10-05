/**
 * Einstellung „Standard-Schiene“ (Schritt 4.1c) – Vorgabe fuer Zaps und
 * Trinkgeld, bei jeder Zahlung aenderbar. Seit 12.4a auch fuer KI: mit SOL nur
 * ueber einen Zahlkanal (`ki-zahlweg.ts`), seit 12.1 fuer Zahlungsanforderungen
 * mit beiden Einheiten und fuer die Anzeige (`anzeigeEinheit()`). Eigenes Modul
 * ohne Abhaengigkeiten, damit Dialoge es lesen koennen, ohne die Wallets mitzuladen.
 */
export const LS_STANDARD_SCHIENE = "freedom.standardSchiene";

export function standardSchiene(): "lightning" | "solana" {
  return localStorage.getItem(LS_STANDARD_SCHIENE) === "solana" ? "solana" : "lightning";
}

/** Eigene Wahl der Anzeigeeinheit (12.1) – die Auswahl baut Spur C; bis dahin gilt die Standard-Schiene. */
export const LS_ANZEIGE_EINHEIT = "freedom.anzeigeEinheit";

/** „eigene“: jeder Betrag zuerst in seiner Einheit (sats bei Lightning, SOL bei Solana). */
export type AnzeigeEinheit = "sats" | "sol" | "eigene";

/**
 * Welche Einheit Beträge zuerst zeigen (12.1): die eigene Wahl, sonst mit SOL als
 * Standard-Schiene SOL, sonst jeder Betrag in seiner Einheit – wie bisher. Ohne
 * `localStorage` (Tests, Worker) ebenfalls wie bisher.
 */
export function anzeigeEinheit(): AnzeigeEinheit {
  try {
    const wahl = localStorage.getItem(LS_ANZEIGE_EINHEIT);
    if (wahl === "sats" || wahl === "sol") return wahl;
    return standardSchiene() === "solana" ? "sol" : "eigene";
  } catch {
    return "eigene";
  }
}
