/**
 * Tauschformular (C-51, Oberflächen-Review 15.10.2026) – ohne DOM. Bis jetzt zeigte „Tauschen“ nur die
 * Liste der LP-Angebote; wer tauschen wollte, musste Gebühren und Grenzen selbst vergleichen.
 *
 * Hier: das günstigste gültige Angebot je Richtung vorwählen und „Du zahlst / Du bekommst“ ausrechnen.
 * Nur Oberfläche – der Ablauf und alle Prüfungen bleiben (`docs/SWAPS.md`, `tausch.ts`). Ehrlich:
 * - SOL → sats (buy-sol): der Betrag in SOL ist genau – derselbe `rueckSwapLamports()` wie beim Sperren.
 * - sats → SOL (sell-sol): den genauen SOL-Betrag nennt der LP erst in seiner Antwort; vorher nur eine
 *   Schätzung mit dem Marktkurs (≈), ohne Kurs keine.
 */
import { type LpOffer, type MarktKurs, msatZuLamports, rueckSwapLamports } from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";
import { liestUmschlaege } from "./swap-umschlag.js";

export type Richtung = "sats-sol" | "sol-sats";
export interface AngebotMitLp { pubkey: string; offer: LpOffer }

const zahl = (n: number, stellen = 0) => n.toLocaleString(gebietsschema(), { maximumFractionDigits: stellen });
export const richtungVon = (o: Pick<LpOffer, "direction">): Richtung => (o.direction === "buy-sol" ? "sol-sats" : "sats-sol");

/** Zahlen eines fremden Angebots, mit denen sich rechnen lässt – `parseLpOffer()` prüft Gebühr und Grenzen nicht. */
const rechenbar = (o: LpOffer): boolean =>
  Number.isSafeInteger(o.feePpm) && o.feePpm >= 0 && o.feePpm < 1_000_000 &&
  Number.isSafeInteger(o.minSats) && Number.isSafeInteger(o.maxSats) && o.minSats > 0 && o.minSats <= o.maxSats &&
  Number.isSafeInteger(o.tSolSecs) && o.tSolSecs > 0;

/** Das günstigste gültige Angebot einer Richtung: nicht abgelaufen, liest Umschläge (4.9b); bei gleicher Gebühr das größere. */
export function bestesAngebot(liste: readonly AngebotMitLp[], richtung: Richtung, jetzt: number): AngebotMitLp | undefined {
  return liste
    .filter(({ offer }) => richtungVon(offer) === richtung && offer.expiry > jetzt && liestUmschlaege(offer) && rechenbar(offer))
    .sort((a, b) => a.offer.feePpm - b.offer.feePpm || b.offer.maxSats - a.offer.maxSats)[0];
}

/** Gebühr des Angebots; in der Hinrichtung samt nicht erstattbarer Vorab-Gebühr (4.6d), die vor der Sperre fällig ist. */
export function gebuehrText(offer: LpOffer): string {
  const anteil = `${zahl(offer.feePpm / 10_000, 2)} %`;
  return offer.direction === "sell-sol" && offer.vorabSats ? `${anteil} ${t("tausch.vorab", { sats: zahl(offer.vorabSats) })}` : anteil;
}

export const grenzenText = (offer: LpOffer): string => `${zahl(offer.minSats)}–${zahl(offer.maxSats)} sats`;

/** Frist der Sperre auf Solana (T_sol): danach geht das Geld an den zurück, der gesperrt hat. */
export const fristText = (offer: LpOffer): string => `${zahl(offer.tSolSecs / 3600, 1)} h`;

/** Kurs: in der Gegenrichtung der genaue des Anbieters, sonst der Marktkurs (≈) – ohne beides keiner (leer). */
export function kursText(offer: LpOffer, kurs?: Pick<MarktKurs, "satsProSol">): string {
  if (offer.direction === "buy-sol") return offer.lamportsPerSat ? `1 SOL = ${zahl(1e9 / offer.lamportsPerSat)} sats` : "";
  return kurs ? `≈ 1 SOL = ${zahl(kurs.satsProSol)} sats` : "";
}

export interface Vorschau {
  /** Was weggeht und was ankommt – als Text mit Einheit. */
  zahlst: string;
  bekommst: string;
  /** `bekommst` bzw. `zahlst` ist genau (nicht geschätzt). */
  genau: boolean;
  /** Betrag innerhalb der Grenzen des Angebots. */
  imBereich: boolean;
  gebuehr: string;
  grenzen: string;
}

/**
 * „Du zahlst / Du bekommst“ für `sats` (die Lightning-Seite des Tauschs). `undefined` bei ungültigem Betrag.
 * Für sats → SOL ohne Kurs: „bekommst“ ist leer – der LP nennt den Betrag.
 */
export function tauschVorschau(offer: LpOffer, sats: number, kurs?: Pick<MarktKurs, "satsProSol">): Vorschau | undefined {
  if (!Number.isSafeInteger(sats) || sats <= 0) return undefined;
  const imBereich = sats >= offer.minSats && sats <= offer.maxSats;
  const gebuehr = gebuehrText(offer);
  const grenzen = grenzenText(offer);
  // Werte aus fremden Angeboten: was die Rechnung ablehnt (Gebühr, Kurs), ergibt keine Vorschau statt eines Fehlers
  try {
    if (offer.direction === "buy-sol" && offer.lamportsPerSat) {
      const lamports = rueckSwapLamports(sats, offer.lamportsPerSat, offer.feePpm);
      return { zahlst: `${zahl(lamports / 1e9, 9)} SOL`, bekommst: `${zahl(sats)} sats`, genau: true, imBereich, gebuehr, grenzen };
    }
    if (offer.direction === "buy-sol") return undefined;
    const nachGebuehr = Math.floor((sats * 1000 * (1_000_000 - offer.feePpm)) / 1_000_000);
    const bekommst = kurs ? `≈ ${zahl(msatZuLamports(nachGebuehr, kurs.satsProSol) / 1e9, 6)} SOL` : "";
    return { zahlst: `${zahl(sats)} sats`, bekommst, genau: false, imBereich, gebuehr, grenzen };
  } catch {
    return undefined;
  }
}
