/**
 * Preise in beiden Einheiten (Schritt 4.4b) – ohne DOM.
 *
 * Jede Preisanzeige nennt sats und SOL. Die zweite Einheit kommt aus dem
 * Marktkurs (Median der Kurs-Events, eine Stimme je Absender); ohne Kurs
 * steht dort ehrlich „kein Kurs“ statt einer erfundenen Zahl. Bis 4.4 rechnete
 * die App mit festen 150.000 sats pro SOL.
 */
import { type MarktKurs, abweichung, lamportsZuMsat, msatZuLamports, KURS_WARN_ABWEICHUNG } from "@freedomstack/protocol";

const de = (n: number, stellen = 9) => n.toLocaleString("de-DE", { maximumFractionDigits: stellen });

export function satsText(msat: number): string {
  const sats = msat / 1000;
  return `${de(sats, sats < 10 ? 3 : 0)} sats`;
}

export function solText(lamports: number): string {
  return `${de(lamports / 1e9)} SOL`;
}

/** „21 sats ≈ 0,00014 SOL“ – ohne Kurs „21 sats (SOL: kein Kurs)“. */
export function ausMsat(msat: number, kurs?: Pick<MarktKurs, "satsProSol">): string {
  const m = Math.max(0, Math.round(msat));
  return kurs ? `${satsText(m)} ≈ ${solText(msatZuLamports(m, kurs.satsProSol))}` : `${satsText(m)} (SOL: kein Kurs)`;
}

/** „0,002 SOL ≈ 300 sats“ – ohne Kurs „0,002 SOL (sats: kein Kurs)“. */
export function ausLamports(lamports: number, kurs?: Pick<MarktKurs, "satsProSol">): string {
  const l = Math.max(0, Math.round(lamports));
  return kurs ? `${solText(l)} ≈ ${satsText(lamportsZuMsat(l, kurs.satsProSol))}` : `${solText(l)} (sats: kein Kurs)`;
}

/** Kurszeile fuer die Anzeige: Kurs, Quellen, Warnungen. */
export function kursZeile(kurs?: MarktKurs): { text: string; warnung: boolean } {
  if (!kurs) return { text: "Kurs SOL/sats: keine Kurs-Events gefunden – SOL-Preise nicht verfügbar", warnung: true };
  const basis = `Kurs: 1 SOL ≈ ${de(kurs.satsProSol, 0)} sats (Median aus ${kurs.quellen} Quelle${kurs.quellen === 1 ? "" : "n"})`;
  return kurs.warnungen.length ? { text: `${basis} ⚠ ${kurs.warnungen.join("; ")}`, warnung: true } : { text: basis, warnung: false };
}

/**
 * Deckel fuer ein SOL-Deposit (Lamports je 1k Tokens) aus dem Preis des
 * Anbieters und dem Marktkurs, mit 10 % Spielraum. Bis 4.4 war er fest 1000 –
 * mit richtiger Umrechnung weit unter jedem Preis.
 */
export function depositDeckel(textRateMsatPerK: number, kurs: Pick<MarktKurs, "satsProSol">): number {
  if (!Number.isFinite(textRateMsatPerK) || textRateMsatPerK <= 0) throw new Error("Anbieter nennt keinen Preis");
  return Math.ceil(msatZuLamports(Math.ceil(textRateMsatPerK), kurs.satsProSol) * 1.1);
}

/** Warnung, wenn der Kurs des Anbieters mehr als 10 % neben dem Markt liegt. */
export function anbieterKursWarnung(anbieter: { satsProSol: number } | undefined, markt: Pick<MarktKurs, "satsProSol">): string | undefined {
  if (!anbieter) return undefined;
  const a = abweichung(anbieter.satsProSol, markt.satsProSol);
  return a > KURS_WARN_ABWEICHUNG
    ? `Der Anbieter rechnet mit 1 SOL ≈ ${de(anbieter.satsProSol, 0)} sats, der Markt mit ${de(markt.satsProSol, 0)} sats (${Math.round(a * 100)} % Abweichung).`
    : undefined;
}
