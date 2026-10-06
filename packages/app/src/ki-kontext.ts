/**
 * Gespraechskontext fuer KI-Anfragen (Schritt 3.3).
 *
 * Bis 3.3 merkte sich der Provider-Knoten je Sitzung den Verlauf – Prompts und
 * Antworten im Klartext. Seit 3.3 verwirft er beides nach der Antwort. Den
 * Zusammenhang bringt deshalb die App mit: die letzten Nachrichten des
 * aktuellen Verlaufs, vor den Prompt gesetzt und mit ihm versiegelt. Das
 * geht auch beim Wechsel des Providers nicht verloren.
 *
 * Seit D1c (`docs/DATENSCHUTZ-PROVIDER.md`) weniger: Was mitgeht, liest der
 * Provider. Standard „kurz“, einstellbar „aus“ und „lang“ (der Umfang bis D1c)
 * in Settings › Datenschutz (`freedom.verlauf`).
 */

/** Wie viel Verlauf mitgeht: Nachrichten (die neuesten), Zeichen insgesamt, Zeichen je Nachricht. */
export const VERLAUF_UMFANG = Object.freeze({
  aus: Object.freeze({ nachrichten: 0, zeichen: 0, jeNachricht: 0 }),
  kurz: Object.freeze({ nachrichten: 6, zeichen: 3000, jeNachricht: 1000 }),
  lang: Object.freeze({ nachrichten: 12, zeichen: 6000, jeNachricht: 1500 }),
});
export type VerlaufUmfang = keyof typeof VERLAUF_UMFANG;
export const LS_VERLAUF = "freedom.verlauf";

/** Gespeicherte Wahl – Unbekanntes und nichts heißt „kurz“. */
export function leseUmfang(wert: string | null): VerlaufUmfang {
  return wert === "aus" || wert === "lang" ? wert : "kurz";
}

/** Hoechstens so viele Nachrichten, die neuesten zuerst gewaehlt (Standard „kurz“). */
export const KONTEXT_NACHRICHTEN = VERLAUF_UMFANG.kurz.nachrichten;
/** Hoechstens so viele Zeichen Verlauf – grosse Umschlaege lehnen Relays ab. */
export const KONTEXT_ZEICHEN = VERLAUF_UMFANG.kurz.zeichen;
/** Eine einzelne lange Nachricht wird gekuerzt, damit sie nicht alles verdraengt. */
export const KONTEXT_JE_NACHRICHT = VERLAUF_UMFANG.kurz.jeNachricht;

export interface KontextNachricht {
  role: "user" | "ai";
  text: string;
}

/**
 * Praefix fuer den Prompt: bisheriger Verlauf, aelteste Nachricht zuerst.
 * Leer, wenn es keinen Verlauf gibt.
 */
export function kontextPraefix(nachrichten: readonly KontextNachricht[], umfang: VerlaufUmfang = "kurz"): string {
  const g = VERLAUF_UMFANG[umfang];
  if (g.nachrichten === 0) return "";
  const zeilen: string[] = [];
  let rest = g.zeichen;
  for (const n of nachrichten.slice(-g.nachrichten).reverse()) {
    const text = n.text.trim();
    if (!text) continue;
    const gekuerzt = text.length > g.jeNachricht ? `${text.slice(0, g.jeNachricht)} …` : text;
    const zeile = `${n.role === "user" ? "Du" : "KI"}: ${gekuerzt}`;
    if (zeile.length > rest) break;
    zeilen.unshift(zeile);
    rest -= zeile.length;
  }
  // Geht ans Modell, nicht in die Oberfläche – bleibt in jeder Sprache gleich
  return zeilen.length ? `[Bisheriger Verlauf]:\n${zeilen.join("\n")}\n\n[Neue Nachricht]:\n` : ""; // kein UI-Text
}
