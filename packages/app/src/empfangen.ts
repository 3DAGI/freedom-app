/**
 * Empfangen in die Wallet (Schritt 12.7b), ohne DOM: was der QR-Code trägt –
 * Formate, die andere Wallets lesen. Lightning als `lightning:<rechnung>`,
 * SOL nach Solana Pay als `solana:<adresse>` mit `amount=` in SOL, wenn ein
 * Betrag gewählt ist. `leseSendeZiel()` liest beides zurück.
 */
import { lamportsZuSol } from "./zahlungs-anforderung.js";

export function empfangsLink(p: { rechnung: string } | { adresse: string; lamports?: number }): string {
  if ("rechnung" in p) return `lightning:${p.rechnung}`;
  return p.lamports ? `solana:${p.adresse}?amount=${lamportsZuSol(p.lamports)}` : `solana:${p.adresse}`;
}
