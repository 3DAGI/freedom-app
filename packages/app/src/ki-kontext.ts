/**
 * Gespraechskontext fuer KI-Anfragen (Schritt 3.3).
 *
 * Bis 3.3 merkte sich der Provider-Knoten je Sitzung den Verlauf – Prompts und
 * Antworten im Klartext. Seit 3.3 verwirft er beides nach der Antwort. Den
 * Zusammenhang bringt deshalb die App mit: die letzten Nachrichten des
 * aktuellen Verlaufs, vor den Prompt gesetzt und mit ihm versiegelt. Das
 * geht auch beim Wechsel des Providers nicht verloren.
 */

/** Hoechstens so viele Nachrichten, die neuesten zuerst gewaehlt. */
export const KONTEXT_NACHRICHTEN = 12;
/** Hoechstens so viele Zeichen Verlauf – grosse Umschlaege lehnen Relays ab. */
export const KONTEXT_ZEICHEN = 6000;
/** Eine einzelne lange Nachricht wird gekuerzt, damit sie nicht alles verdraengt. */
export const KONTEXT_JE_NACHRICHT = 1500;

export interface KontextNachricht {
  role: "user" | "ai";
  text: string;
}

/**
 * Praefix fuer den Prompt: bisheriger Verlauf, aelteste Nachricht zuerst.
 * Leer, wenn es keinen Verlauf gibt.
 */
export function kontextPraefix(nachrichten: readonly KontextNachricht[]): string {
  const zeilen: string[] = [];
  let rest = KONTEXT_ZEICHEN;
  for (const n of nachrichten.slice(-KONTEXT_NACHRICHTEN).reverse()) {
    const text = n.text.trim();
    if (!text) continue;
    const gekuerzt = text.length > KONTEXT_JE_NACHRICHT ? `${text.slice(0, KONTEXT_JE_NACHRICHT)} …` : text;
    const zeile = `${n.role === "user" ? "Du" : "KI"}: ${gekuerzt}`;
    if (zeile.length > rest) break;
    zeilen.unshift(zeile);
    rest -= zeile.length;
  }
  return zeilen.length ? `[Bisheriger Verlauf]:\n${zeilen.join("\n")}\n\n[Neue Nachricht]:\n` : "";
}
