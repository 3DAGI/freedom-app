/**
 * Kontostand oben im Wallet (C-50a, Oberflächen-Review 15.10.2026) – ohne DOM.
 *
 * Bis C-50 stand kein Gesamtbetrag auf der Übersicht, nur je Karte ein eigener Stand. Hier wird
 * er zusammengezählt: Lightning (msat, aus NWC) und Solana (Lamports, Browser-Wallet und eingebaute
 * Wallet). Eine Summe gibt es nur mit Kurs (`kurs.ts`, Regel „ohne Kurs keinen SOL-Preis erfinden“)
 * – ohne Kurs stehen beide Beträge getrennt da. Ein Konto, dessen Stand die App nicht kennt, fehlt
 * in der Summe; das sagt `vollstaendig`.
 */
import { type MarktKurs, lamportsZuMsat, msatZuLamports } from "@freedomstack/protocol";
import { gebietsschema } from "./i18n.js";
import { type AnzeigeEinheit, anzeigeEinheit } from "./standard-schiene.js";

/** Was die App gerade weiß – `undefined`: kein solches Konto, `null`: Konto da, Stand unbekannt. */
export interface KontenStand {
  lnMsat?: number | null;
  solLamports?: number | null;
  /** Ein weiteres Konto, dessen Stand gerade nicht abrufbar ist (etwa eine von zwei Solana-Wallets). */
  fehlt?: boolean;
}

export interface Gesamt {
  /** Die große Zahl, ohne Einheit. */
  betrag: string;
  einheit: "sats" | "SOL";
  /** Die Zeile darunter: die andere Einheit, oder ohne Kurs der zweite Betrag. */
  zusatz: string;
  /** Mit Kurs als eine Summe gerechnet. */
  summe: boolean;
  /** Jeder bekannte Stand ist enthalten (kein Konto mit unbekanntem Stand). */
  vollstaendig: boolean;
}

const zahl = (n: number, stellen: number) => n.toLocaleString(gebietsschema(), { maximumFractionDigits: stellen });
const sats = (msat: number) => zahl(Math.floor(msat / 1000), 0);
const sol = (lamports: number) => zahl(lamports / 1e9, 4);

/** Ohne Konto `null` – dann zeigt die Übersicht die Einrichtung statt einer Null. */
export function gesamtStand(stand: KontenStand, kurs?: Pick<MarktKurs, "satsProSol">, einheit: AnzeigeEinheit = anzeigeEinheit()): Gesamt | null {
  const hatLn = stand.lnMsat !== undefined;
  const hatSol = stand.solLamports !== undefined;
  if (!hatLn && !hatSol) return null;
  const ln = Math.max(0, Math.round(stand.lnMsat ?? 0));
  const lamports = Math.max(0, Math.round(stand.solLamports ?? 0));
  const vollstaendig = stand.lnMsat !== null && stand.solLamports !== null && !stand.fehlt;
  const inSol = einheit === "sol";
  if (kurs) {
    const msat = ln + lamportsZuMsat(lamports, kurs.satsProSol);
    const alsSol = msatZuLamports(msat, kurs.satsProSol);
    return inSol
      ? { betrag: sol(alsSol), einheit: "SOL", zusatz: `≈ ${sats(msat)} sats`, summe: true, vollstaendig }
      : { betrag: sats(msat), einheit: "sats", zusatz: `≈ ${sol(alsSol)} SOL`, summe: true, vollstaendig };
  }
  // Ohne Kurs keine Summe: die Einheit des Kontos, das es gibt (bei beiden die gewählte), der zweite Betrag daneben
  const erstSol = hatSol && (!hatLn || inSol);
  return erstSol
    ? { betrag: sol(lamports), einheit: "SOL", zusatz: hatLn ? `+ ${sats(ln)} sats` : "", summe: false, vollstaendig }
    : { betrag: sats(ln), einheit: "sats", zusatz: hatSol ? `+ ${sol(lamports)} SOL` : "", summe: false, vollstaendig };
}
