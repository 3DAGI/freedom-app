/**
 * Koppeln mit dem Code zum Eintippen (VKf, K1): aus dem Code Schlüssel und Suchkennung ableiten
 * (`kurzcodeAbleitung()`, 600 000 Runden PBKDF2), das Event des Knotens an den Relays suchen und
 * nur eine Kopplung nehmen, die `leseKurzcodeEvent()` durchlässt (Signatur, Frist, Schlüssel, der
 * Autor als Knoten). Gefragt wird nur nach der Kennung – die Relays erfahren weder Code noch Knoten.
 */
import { KIND_KURZCODE, kurzcodeAbleitung, leseKurzcodeEvent, type Kopplung, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";

export async function kopplungAusKurzcode(
  code: string, frage: (filter: RelayFilter) => Promise<NostrEvent[]>, jetzt = Math.floor(Date.now() / 1000),
): Promise<{ kopplung: Kopplung; suche: string } | null> {
  const ab = await kurzcodeAbleitung(code);
  for (const ev of await frage({ kinds: [KIND_KURZCODE], "#d": [ab.suche], limit: 10 })) {
    const kopplung = await leseKurzcodeEvent(ev, ab, jetzt);
    if (kopplung) return { kopplung, suche: ab.suche };
  }
  return null;
}
