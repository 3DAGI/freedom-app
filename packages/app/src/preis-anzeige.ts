/**
 * Preise in beiden Einheiten (Schritt 4.4b) – ohne DOM.
 *
 * Jede Preisanzeige nennt sats und SOL. Die zweite Einheit kommt aus dem
 * Marktkurs (Median der Kurs-Events, eine Stimme je Absender); ohne Kurs
 * steht dort ehrlich „kein Kurs“ statt einer erfundenen Zahl. Bis 4.4 rechnete
 * die App mit festen 150.000 sats pro SOL.
 */
import { type MarktKurs, abweichung, lamportsZuMsat, msatZuLamports, KURS_MIN_QUELLEN, KURS_WARN_ABWEICHUNG } from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";
import { anzeigeEinheit, type AnzeigeEinheit } from "./standard-schiene.js";

const de = (n: number, stellen = 9) => n.toLocaleString(gebietsschema(), { maximumFractionDigits: stellen });

export function satsText(msat: number): string {
  const sats = msat / 1000;
  return `${de(sats, sats < 10 ? 3 : 0)} sats`;
}

export function solText(lamports: number): string {
  return `${de(lamports / 1e9)} SOL`;
}

/**
 * „21 sats ≈ 0,00014 SOL“ – mit der Anzeigeeinheit SOL (12.1) „≈ 0,00014 SOL (21 sats)“:
 * zuerst die gewählte Einheit, der genaue Betrag steht immer dabei. Ohne Kurs
 * „21 sats (SOL: kein Kurs)“ – nie eine erfundene Zahl.
 */
export function ausMsat(msat: number, kurs?: Pick<MarktKurs, "satsProSol">, einheit: AnzeigeEinheit = anzeigeEinheit()): string {
  const m = Math.max(0, Math.round(msat));
  if (!kurs) return t("zahl.ohneKursSol", { betrag: satsText(m) });
  const sol = solText(msatZuLamports(m, kurs.satsProSol));
  return einheit === "sol" ? `≈ ${sol} (${satsText(m)})` : `${satsText(m)} ≈ ${sol}`;
}

/** „0,002 SOL ≈ 300 sats“ – mit der Anzeigeeinheit sats „≈ 300 sats (0,002 SOL)“; ohne Kurs „0,002 SOL (sats: kein Kurs)“. */
export function ausLamports(lamports: number, kurs?: Pick<MarktKurs, "satsProSol">, einheit: AnzeigeEinheit = anzeigeEinheit()): string {
  const l = Math.max(0, Math.round(lamports));
  if (!kurs) return t("zahl.ohneKursSats", { betrag: solText(l) });
  const sats = satsText(lamportsZuMsat(l, kurs.satsProSol));
  return einheit === "sats" ? `≈ ${sats} (${solText(l)})` : `${solText(l)} ≈ ${sats}`;
}

/**
 * Eine Einnahme in der Einheit ihrer Kette (C-2): Lightning in sats, Solana in
 * SOL. Das Leistungs-Event (38010) nennt den Wert nur in msat – SOL also nur
 * umgerechnet mit dem Kurs von jetzt (≈); ohne Kurs keinen SOL-Betrag erfinden.
 */
export function einnahmeText(volumeMsat: unknown, kette: unknown, kurs?: Pick<MarktKurs, "satsProSol">): string {
  const msat = typeof volumeMsat === "string" && /^\d{1,18}$/.test(volumeMsat) ? Number(volumeMsat) : NaN;
  if (!Number.isSafeInteger(msat)) return "—";
  if (kette !== "solana") return satsText(msat);
  return kurs
    ? t("earn.betragSol", { sol: solText(msatZuLamports(msat, kurs.satsProSol)), sats: satsText(msat) })
    : t("earn.betragSolOhneKurs", { sats: satsText(msat) });
}

/** Kurszeile fuer die Anzeige: Kurs, Quellen, Warnungen. */
export function kursZeile(kurs?: MarktKurs): { text: string; warnung: boolean } {
  if (!kurs) return { text: t("zahl.keinKurs"), warnung: true };
  const basis = t(kurs.quellen === 1 ? "zahl.kursEineQuelle" : "zahl.kursQuellen", { sats: de(kurs.satsProSol, 0), n: kurs.quellen });
  // Warnungen aus den Zahlen (8.16e: die Texte von `marktKurs()` sind Deutsch). Die App fragt ohne
  // Referenzkurs, also gibt es nur diese beiden; weicht die Zahl ab, gelten die des Protokolls.
  const eigene = [
    ...(kurs.quellen < KURS_MIN_QUELLEN ? [t("zahl.kursWenigeQuellen", { n: kurs.quellen })] : []),
    ...(kurs.streuung > KURS_WARN_ABWEICHUNG ? [t("zahl.kursStreuung", { prozent: Math.round(kurs.streuung * 100) })] : []),
  ];
  const alle = eigene.length === kurs.warnungen.length ? eigene : kurs.warnungen;
  return alle.length ? { text: `${basis} ⚠ ${alle.join("; ")}`, warnung: true } : { text: basis, warnung: false };
}

/**
 * Deckel fuer ein SOL-Deposit (Lamports je 1k Tokens) aus dem Preis des
 * Anbieters und dem Marktkurs, mit 10 % Spielraum. Bis 4.4 war er fest 1000 –
 * mit richtiger Umrechnung weit unter jedem Preis.
 */
export function depositDeckel(textRateMsatPerK: number, kurs: Pick<MarktKurs, "satsProSol">): number {
  if (!Number.isFinite(textRateMsatPerK) || textRateMsatPerK <= 0) throw new Error(t("zahl.anbieterOhnePreis"));
  return Math.ceil(msatZuLamports(Math.ceil(textRateMsatPerK), kurs.satsProSol) * 1.1);
}

/** Warnung, wenn der Kurs des Anbieters mehr als 10 % neben dem Markt liegt. */
export function anbieterKursWarnung(anbieter: { satsProSol: number } | undefined, markt: Pick<MarktKurs, "satsProSol">): string | undefined {
  if (!anbieter) return undefined;
  const a = abweichung(anbieter.satsProSol, markt.satsProSol);
  return a > KURS_WARN_ABWEICHUNG
    ? t("zahl.anbieterKurs", { anbieter: de(anbieter.satsProSol, 0), markt: de(markt.satsProSol, 0), prozent: Math.round(a * 100) })
    : undefined;
}
