/**
 * Dezentraler SOL/sats-Kurs-Ticker (kein zentrales Oracle).
 *
 * Problem: Die Preisliste ist in sats; SOL-Zahlung braucht einen echten
 * SOL/sats-Kurs. Ein zentrales Oracle waere ein Chokepoint (Invarianten).
 *
 * Loesung: Mehrere unabhaengige Akteure (LPs, Oracle-Knoten) publizieren
 * signierte Kurs-Events (kind 38026) mit ihrem aktuellen SOL/sats-Kurs.
 * Der Client/Provider nimmt den MEDIAN ueber alle frischen Kurse — robust
 * gegen einzelne Ausfaelle/Manipulation, komplett dezentral.
 *
 * Vertrauensmodell: Wer dem Median nicht traut, setzt solPriceSats manuell
 * (Provider-Config hat weiterhin Vorrang). Der Ticker ist ein Default,
 * kein Zwang — invarianten-konform.
 */
import { UnsignedEvent, buildEvent, getTag } from "./event.js";
import { KIND_PRICE_TICKER } from "./kinds.js";

export interface PriceTicker {
  /** Asset-Paar, z.B. "SOL/BTC" (Kurs = sats pro 1 SOL). */
  pair: string;
  /** Kurs: sats pro 1 Einheit des Basis-Assets (hier: sats pro 1 SOL). */
  satsPerUnit: number;
  /** Unix-Sekunden — Kurse aelter als maxAgeSek werden ignoriert. */
  publishedAt: number;
}

/** Baut ein Kurs-Ticker-Event (kind 38026, addressierbar via d=pair). */
export function buildPriceTicker(t: PriceTicker, publisherPubkey: string): UnsignedEvent {
  return buildEvent(
    publisherPubkey,
    KIND_PRICE_TICKER,
    [
      ["d", t.pair],
      ["pair", t.pair],
      ["sats_per_unit", String(t.satsPerUnit)],
    ],
    "",
    t.publishedAt,
  );
}

/** Parst ein Kurs-Ticker-Event. */
export function parsePriceTicker(ev: UnsignedEvent): PriceTicker {
  if (ev.kind !== KIND_PRICE_TICKER) throw new Error(`kein Ticker: kind ${ev.kind}`);
  const pair = getTag(ev, "pair");
  const sats = getTag(ev, "sats_per_unit");
  if (!pair || !sats) throw new Error("Ticker ohne pair/sats_per_unit");
  return { pair, satsPerUnit: Number(sats), publishedAt: ev.created_at };
}

/**
 * Median-Kurs aus mehreren Ticker-Events (frisch + gueltig).
 * Gibt undefined, wenn kein gueltiger Kurs vorliegt.
 */
export function medianPrice(
  events: UnsignedEvent[],
  pair: string,
  maxAgeSek = 3600,
  now = Math.floor(Date.now() / 1000),
): number | undefined {
  const fresh: number[] = [];
  for (const ev of events) {
    try {
      const t = parsePriceTicker(ev);
      if (t.pair !== pair) continue;
      if (now - t.publishedAt > maxAgeSek) continue; // zu alt
      if (!(t.satsPerUnit > 0)) continue;
      fresh.push(t.satsPerUnit);
    } catch { /* ungueltiges Event ignorieren */ }
  }
  if (fresh.length === 0) return undefined;
  fresh.sort((a, b) => a - b);
  const mid = Math.floor(fresh.length / 2);
  return fresh.length % 2 === 1 ? fresh[mid] : Math.floor((fresh[mid - 1] + fresh[mid]) / 2);
}
