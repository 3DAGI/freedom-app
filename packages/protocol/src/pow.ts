/**
 * NIP-13 Proof of Work.
 *
 * Schwierigkeit = Anzahl fuehrender Null-BITS der Event-ID. Da die ID ein
 * SHA-256 ueber das gesamte Event ist, kostet jedes Event echte Rechenzeit.
 *
 * Zweck hier: Sybil-Schutz. Sobald Rewards an Aktivitaet haengen, wird gefarmt.
 * PoW macht Massen-Fake-Events teuer, ohne irgendeine zentrale Instanz.
 */
import { UnsignedEvent, computeEventId } from "./event.js";
import { fromHex } from "./htlc.js";

/** Zaehlt fuehrende Null-Bits eines Hex-Hash. */
export function countLeadingZeroBits(hex: string): number {
  const bytes = fromHex(hex);
  let bits = 0;
  for (const b of bytes) {
    if (b === 0) { bits += 8; continue; }
    bits += Math.clz32(b) - 24; // fuehrende Nullen im Byte
    break;
  }
  return bits;
}

/** Schwierigkeit eines Events = fuehrende Null-Bits seiner ID. */
export function eventDifficulty(ev: UnsignedEvent & { id?: string }): number {
  const id = ev.id ?? computeEventId(ev);
  return countLeadingZeroBits(id);
}

/**
 * Mined ein Event auf die Zielschwierigkeit, indem ein `nonce`-Tag variiert
 * wird (NIP-13). Gibt das Event mit gueltigem Nonce zurueck.
 */
export function mineEvent(ev: UnsignedEvent, targetDifficulty: number, maxTries = 5_000_000): UnsignedEvent {
  const base: UnsignedEvent = {
    ...ev,
    tags: [...ev.tags.filter((t) => t[0] !== "nonce")],
  };
  for (let nonce = 0; nonce < maxTries; nonce++) {
    const candidate: UnsignedEvent = {
      ...base,
      tags: [...base.tags, ["nonce", String(nonce), String(targetDifficulty)]],
    };
    if (countLeadingZeroBits(computeEventId(candidate)) >= targetDifficulty) return candidate;
  }
  throw new Error(`PoW nicht gefunden nach ${maxTries} Versuchen`);
}

/** Prueft, ob ein Event die geforderte Mindestschwierigkeit erfuellt. */
export function verifyPow(ev: UnsignedEvent & { id?: string }, minDifficulty: number): boolean {
  return eventDifficulty(ev) >= minDifficulty;
}
