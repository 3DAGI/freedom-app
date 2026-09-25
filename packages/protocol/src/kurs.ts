/**
 * Marktkurs SOL/sats (Schritt 4.4) – aus den Kurs-Events der
 * Liquiditaetsgeber (Kind 38026), ohne zentrales Orakel.
 *
 * Der Median zaehlt jeden Absender einmal (sein juengster Kurs): Wer zehn
 * Events schickt, bekommt keine zehn Stimmen. Zu wenige Quellen, weit
 * auseinanderliegende Quellen oder ein Kurs, der von einer Referenz (etwa dem
 * Kurs eines Anbieters) abweicht, ergeben eine Warnung – angezeigt wird sie,
 * nicht verschluckt.
 *
 * Umrechnung ganzzahlig mit BigInt: Beträge in msat mal 1e9 sprengen sonst
 * schnell den sicheren Zahlenbereich.
 */
import type { UnsignedEvent } from "./event.js";
import { parsePriceTicker } from "./price-ticker.js";

export const KURS_PAAR = "SOL/BTC";
/** Kurse aelter als eine Stunde zaehlen nicht. */
export const KURS_MAX_ALTER_SECS = 3600;
/** Unter drei unabhaengigen Quellen warnt die App. */
export const KURS_MIN_QUELLEN = 3;
/** Ab 10 % Abweichung warnt die App. */
export const KURS_WARN_ABWEICHUNG = 0.1;
/** Obergrenze fuer plausible Kurse (sats pro SOL) – alles darueber ist Unfug. */
const KURS_MAX = 1e10;

export interface MarktKurs {
  /** sats pro 1 SOL (ganzzahlig). */
  satsProSol: number;
  /** Anzahl unabhaengiger Quellen (Absender). */
  quellen: number;
  /** Groesste Abweichung einer Quelle vom Median (0.05 = 5 %). */
  streuung: number;
  warnungen: string[];
}

function prozent(x: number): string {
  return `${Math.round(x * 100)} %`;
}

/** Abweichung von a gegenueber b (0.1 = 10 %). */
export function abweichung(a: number, b: number): number {
  return Math.abs(a - b) / b;
}

/**
 * Marktkurs aus Kurs-Events. `referenz` (sats pro SOL) prueft einen anderen
 * Kurs gegen den Markt, z. B. den, mit dem ein Anbieter rechnet.
 */
export function marktKurs(
  events: readonly (UnsignedEvent & { pubkey: string })[],
  jetzt: number,
  opts: { maxAlterSecs?: number; minQuellen?: number; referenz?: number } = {},
): MarktKurs | undefined {
  const maxAlter = opts.maxAlterSecs ?? KURS_MAX_ALTER_SECS;
  const juengster = new Map<string, { zeit: number; kurs: number }>();
  for (const ev of events) {
    try {
      const t = parsePriceTicker(ev);
      if (t.pair !== KURS_PAAR) continue;
      if (!Number.isFinite(t.satsPerUnit) || t.satsPerUnit <= 0 || t.satsPerUnit > KURS_MAX) continue;
      if (t.publishedAt > jetzt + 300 || jetzt - t.publishedAt > maxAlter) continue;
      const alt = juengster.get(ev.pubkey);
      if (!alt || t.publishedAt > alt.zeit) juengster.set(ev.pubkey, { zeit: t.publishedAt, kurs: Math.round(t.satsPerUnit) });
    } catch { /* ungueltiges Event: ignorieren */ }
  }
  const kurse = [...juengster.values()].map((k) => k.kurs).sort((a, b) => a - b);
  if (kurse.length === 0) return undefined;
  const mitte = Math.floor(kurse.length / 2);
  const satsProSol = kurse.length % 2 === 1 ? kurse[mitte] : Math.round((kurse[mitte - 1] + kurse[mitte]) / 2);
  const streuung = Math.max(...kurse.map((k) => abweichung(k, satsProSol)));
  const warnungen: string[] = [];
  const minQuellen = opts.minQuellen ?? KURS_MIN_QUELLEN;
  if (kurse.length < minQuellen) warnungen.push(`Kurs aus nur ${kurse.length} Quelle${kurse.length === 1 ? "" : "n"}`);
  if (streuung > KURS_WARN_ABWEICHUNG) warnungen.push(`Kursquellen weichen bis ${prozent(streuung)} voneinander ab`);
  if (opts.referenz !== undefined && opts.referenz > 0 && abweichung(opts.referenz, satsProSol) > KURS_WARN_ABWEICHUNG) {
    warnungen.push(`Kurs des Anbieters weicht ${prozent(abweichung(opts.referenz, satsProSol))} vom Markt ab`);
  }
  return { satsProSol, quellen: kurse.length, streuung, warnungen };
}

function pruefeKurs(satsProSol: number): bigint {
  if (!Number.isSafeInteger(satsProSol) || satsProSol <= 0) throw new Error("Kurs muss eine positive ganze Zahl (sats pro SOL) sein");
  return BigInt(satsProSol);
}

function pruefeBetrag(n: number): bigint {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Betrag muss eine nicht negative ganze Zahl sein");
  return BigInt(n);
}

/** msat → Lamports, aufgerundet: 1 SOL = 1e9 Lamports = satsProSol · 1000 msat. */
export function msatZuLamports(msat: number, satsProSol: number): number {
  const nenner = pruefeKurs(satsProSol) * 1000n;
  return Number((pruefeBetrag(msat) * 1_000_000_000n + nenner - 1n) / nenner);
}

/** Lamports → msat, aufgerundet. */
export function lamportsZuMsat(lamports: number, satsProSol: number): number {
  const zaehler = pruefeBetrag(lamports) * pruefeKurs(satsProSol) * 1000n;
  return Number((zaehler + 999_999_999n) / 1_000_000_000n);
}

/** Lamports je msat (fuer `inBeidenEinheiten`). */
export function lamportsProMsat(satsProSol: number): number {
  return 1e9 / (Number(pruefeKurs(satsProSol)) * 1000);
}
