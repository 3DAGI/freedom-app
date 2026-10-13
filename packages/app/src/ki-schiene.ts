/**
 * Schiene für KI (Schritt 12.4b, Sammlung A-1): der Schalter „sats / SOL“ auf
 * der Agent-Seite. Ohne eigene Wahl gilt die Standard-Schiene wie seit 12.4a.
 *
 * Das Gebot steht in der gewählten Einheit. Der Auftrag nennt es in msat (so
 * liest es jeder Knoten); SOL rechnet die App nur über `kurs.ts` um – ohne
 * Kurs gibt es kein Gebot in SOL, und es geht nichts hinaus. Abgerundet: Das
 * Gebot ist eine Obergrenze, mehr als eingetippt darf es nie werden.
 *
 * Mit SOL zahlt KI weiter nur über einen Zahlkanal (`ki-zahlweg.ts`, E3 A).
 * Ohne DOM, damit Tests es lesen können.
 */
import { lamportsZuMsat, msatZuLamports } from "@freedomstack/protocol";
import { standardSchiene } from "./standard-schiene.js";
import { lamportsZuSol, solZuLamports } from "./zahlungs-anforderung.js";

export const LS_KI_SCHIENE = "freedom.ki.schiene";

export type Schiene = "lightning" | "solana";

/** Die eigene Wahl auf der Agent-Seite, sonst die Standard-Schiene. Ohne `localStorage` wie die Standard-Schiene. */
export function kiSchiene(): Schiene {
  try {
    const wahl = localStorage.getItem(LS_KI_SCHIENE);
    if (wahl === "lightning" || wahl === "solana") return wahl;
  } catch { /* ohne Speicher gilt die Vorgabe */ }
  return standardSchiene();
}

export function waehleKiSchiene(schiene: Schiene): void {
  localStorage.setItem(LS_KI_SCHIENE, schiene);
}

/**
 * Gebot aus dem Feld in ganzen sats. Mit Lightning eine ganze Zahl ab 1, mit SOL
 * höchstens neun Nachkommastellen und nur mit Kurs. Was keinen ganzen sat ergibt,
 * ist kein Gebot – 0 hieße gratis.
 */
export function gebotInSats(text: string, schiene: Schiene, satsProSol: number | undefined): number | undefined {
  if (schiene === "lightning") {
    const sats = Number(text.trim());
    return text.trim() !== "" && Number.isSafeInteger(sats) && sats > 0 ? sats : undefined;
  }
  const lamports = solZuLamports(text);
  if (lamports === undefined || !satsProSol) return undefined;
  // lamportsZuMsat rundet auf – kostet der ganze sat mehr Lamports als eingetippt, einer weniger
  let sats = Math.floor(lamportsZuMsat(lamports, satsProSol) / 1000);
  if (sats > 0 && msatZuLamports(sats * 1000, satsProSol) > lamports) sats -= 1;
  return sats > 0 ? sats : undefined;
}

/** Gebot in sats für das Feld in der gewählten Einheit; SOL nur mit Kurs (sonst leer). */
export function gebotAlsText(sats: number, schiene: Schiene, satsProSol: number | undefined): string {
  if (schiene === "lightning") return String(sats);
  if (!satsProSol || !(sats > 0)) return "";
  return lamportsZuSol(msatZuLamports(sats * 1000, satsProSol));
}
