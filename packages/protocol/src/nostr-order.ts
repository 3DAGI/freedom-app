/**
 * LP-Orderbook ueber Nostr.
 *
 * Kein zentraler Server: LPs veroeffentlichen signierte Angebots-Events auf
 * Relays; Clients matchen lokal. Hier: Bau/Parsen der Event-Struktur (ohne
 * Signatur/Relay-Transport, die die Nostr-Lib uebernimmt).
 *
 * Kinds (app-spezifisch, addressierbar-ersetzbarer Bereich 30000-39999):
 *   38001  LP-Liquiditaetsangebot
 *   38002  Swap-Abschluss-Attestierung (Reputation/Web-of-Trust)
 */

export { KIND_LP_OFFER, KIND_SWAP_ATTESTATION } from "./kinds.js";
import { KIND_LP_OFFER, KIND_SWAP_ATTESTATION } from "./kinds.js";

export type SwapDirection = "sell-sol" | "buy-sol";

export interface LpOffer {
  /** eindeutige, ersetzbare Angebots-ID (Nostr `d`-Tag). */
  offerId: string;
  pair: string; // z. B. "LN-BTC/SOL"
  direction: SwapDirection;
  minSats: number;
  maxSats: number;
  /** Fee in Parts-per-Million. */
  feePpm: number;
  tSolSecs: number;
  lnCltvDeltaBlocks: number;
  /** Unix-Sekunden, ab wann das Angebot ungueltig ist. */
  expiry: number;
  note?: string;
  /**
   * Gegenrichtung (buy-sol, 4.6b) – dort Pflicht: das SOL-Konto des LP
   * (Empfaenger der Sperre) und sein genauer Kurs. Der Kunde sperrt
   * `rueckSwapLamports(sats, lamportsPerSat, feePpm)`; ein gerundeter Kurs
   * aus dem Ticker laege daneben.
   */
  solAddress?: string;
  lamportsPerSat?: number;
  /**
   * Hinrichtung (sell-sol, 4.6d): nicht erstattbare Vorab-Gebuehr in sats,
   * bevor der LP SOL sperrt – gegen Anfragen, die nur Liquiditaet binden.
   */
  vorabSats?: number;
}

import { UnsignedEvent } from "./event.js";

/** Rueckwaertskompatibler Alias. */
export type UnsignedNostrEvent = UnsignedEvent;

export function buildLpOffer(o: LpOffer, pubkey: string, createdAt = Math.floor(Date.now() / 1000)): UnsignedEvent {
  return {
    pubkey,
    kind: KIND_LP_OFFER,
    created_at: createdAt,
    tags: [
      ["d", o.offerId],
      ["pair", o.pair],
      ["direction", o.direction],
      ["min_sats", String(o.minSats)],
      ["max_sats", String(o.maxSats)],
      ["fee_ppm", String(o.feePpm)],
      ["t_sol_secs", String(o.tSolSecs)],
      ["ln_cltv_delta_blocks", String(o.lnCltvDeltaBlocks)],
      ["expiry", String(o.expiry)],
      ...(o.solAddress ? [["sol_address", o.solAddress]] : []),
      ...(o.lamportsPerSat !== undefined ? [["lamports_per_sat", String(o.lamportsPerSat)]] : []),
      ...(o.vorabSats ? [["vorab_sats", String(o.vorabSats)]] : []),
    ],
    content: o.note ?? "",
  };
}

function tag(ev: UnsignedEvent, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

export function parseLpOffer(ev: UnsignedEvent): LpOffer {
  if (ev.kind !== KIND_LP_OFFER) throw new Error(`falscher Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = tag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  const dir = req("direction");
  if (dir !== "sell-sol" && dir !== "buy-sol") throw new Error(`ungueltige direction: ${dir}`);
  const solAddress = tag(ev, "sol_address");
  if (solAddress !== undefined && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solAddress)) throw new Error("ungueltige sol_address");
  const kurs = tag(ev, "lamports_per_sat");
  const lamportsPerSat = kurs === undefined ? undefined : Number(kurs);
  if (lamportsPerSat !== undefined && !(Number.isFinite(lamportsPerSat) && lamportsPerSat > 0)) throw new Error("ungueltiger lamports_per_sat");
  if (dir === "buy-sol" && (!solAddress || lamportsPerSat === undefined)) throw new Error("buy-sol ohne sol_address oder lamports_per_sat");
  const vorab = tag(ev, "vorab_sats");
  const vorabSats = vorab === undefined ? undefined : Number(vorab);
  if (vorabSats !== undefined && !(Number.isSafeInteger(vorabSats) && vorabSats > 0)) throw new Error("ungueltiger vorab_sats");
  return {
    offerId: req("d"),
    pair: req("pair"),
    direction: dir,
    minSats: Number(req("min_sats")),
    maxSats: Number(req("max_sats")),
    feePpm: Number(req("fee_ppm")),
    tSolSecs: Number(req("t_sol_secs")),
    lnCltvDeltaBlocks: Number(req("ln_cltv_delta_blocks")),
    expiry: Number(req("expiry")),
    note: ev.content || undefined,
    ...(solAddress ? { solAddress } : {}),
    ...(lamportsPerSat !== undefined ? { lamportsPerSat } : {}),
    ...(vorabSats !== undefined ? { vorabSats } : {}),
  };
}

export interface SwapAttestation {
  swapId: string;
  counterpartyPubkey: string;
  success: boolean;
}

export function buildSwapAttestation(a: SwapAttestation, pubkey: string, createdAt = Math.floor(Date.now() / 1000)): UnsignedEvent {
  return {
    pubkey,
    kind: KIND_SWAP_ATTESTATION,
    created_at: createdAt,
    tags: [
      ["d", a.swapId],
      ["p", a.counterpartyPubkey],
      ["result", a.success ? "success" : "fail"],
    ],
    content: "",
  };
}

/** Feld-Filter fuer Angebote, die zu einem gewuenschten Betrag/Paar passen. */
export function offerMatches(o: LpOffer, opts: { pair: string; direction: SwapDirection; amountSats: number; now: number }): boolean {
  return (
    o.pair === opts.pair &&
    o.direction === opts.direction &&
    opts.amountSats >= o.minSats &&
    opts.amountSats <= o.maxSats &&
    o.expiry > opts.now
  );
}
