/**
 * Zahlweg einer KI-Anfrage (Phase 12.4a, Entscheidung E3 A vom 04.10.2026).
 *
 * Die Standard-Schiene (Währung › Zahlen) gilt seit 12.4a auch für KI:
 * - SOL: nur über einen Zahlkanal zu diesem Provider – „vorab einzahlen, Rest
 *   zurück“. Ohne Kanal geht nichts hinaus, nie still über Lightning (E3 A:
 *   Kanal anbieten, sonst nichts).
 * - Lightning: per Rechnung. Hat der Nutzer zu diesem Provider einen Kanal
 *   geöffnet, zahlt weiter der Kanal – so ist es seit 4.3d.
 * Gratis-Anfragen (Gebot 0) brauchen keinen Zahlweg.
 */
export type KiZahlweg = "kanal" | "lightning" | "kanal-noetig";

export function kiZahlweg(schiene: "lightning" | "solana", kanalDa: boolean): KiZahlweg {
  if (kanalDa) return "kanal";
  return schiene === "solana" ? "kanal-noetig" : "lightning";
}

/** Ziele eines Laufs (Failover): mit SOL nur Provider mit Kanal, die Reihenfolge bleibt. */
export function kiZiele(liste: readonly string[], schiene: "lightning" | "solana", kanalDa: (pk: string) => boolean): string[] {
  return schiene === "solana" ? liste.filter(kanalDa) : [...liste];
}
