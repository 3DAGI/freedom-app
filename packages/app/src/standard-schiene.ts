/**
 * Einstellung „Standard-Schiene“ (Schritt 4.1c) – Vorgabe fuer Zaps und
 * Trinkgeld, bei jeder Zahlung aenderbar. Seit 12.4a auch fuer KI: mit SOL nur
 * ueber einen Zahlkanal (`ki-zahlweg.ts`). Eigenes Modul ohne Abhaengigkeiten,
 * damit Dialoge es lesen koennen, ohne die Wallets mitzuladen.
 */
export const LS_STANDARD_SCHIENE = "freedom.standardSchiene";

export function standardSchiene(): "lightning" | "solana" {
  return localStorage.getItem(LS_STANDARD_SCHIENE) === "solana" ? "solana" : "lightning";
}
