/**
 * Treasury: Anonyme Development-Fee-Auszahlung (Freedom Protocol v1).
 *
 * PRINZIP: Der Development-Anteil (2500 ppm) fließt an wöchentlich rotierende
 * Empfangs-Adressen, die DETERMINISTISCH aus einem Treasury-Master-Key
 * abgeleitet werden. Die Adressen sind mit keiner Person verknüpfbar — nicht
 * verschleiert, sondern nie dagewesen:
 *
 *   weekKey(n)  = HMAC-SHA512(masterSk, "freedom-treasury-week-" + n)
 *   solWallet(n)= Keypair aus weekKey(n)          (Ed25519 -> SOL-kompatibel)
 *   sweep       = Wochen-Wallet -> Haupt-Wallet (automatisch, Schwelle)
 *
 * Sicherheitseigenschaften:
 * - Kennt jemand eine Wochen-Adresse, kann er NICHT auf Master oder andere
 *   Wochen schließen (einwegige HMAC-Ableitung).
 * - Nur der Treasury-Node kennt den Master. Server-Kompromittierung gibt
 *   Vergangenheit frei, aber die Haupt-Wallet (Hardware, offline) bleibt sicher.
 * - Nach Launch ist der MASTER-PUBKEY im Protokoll hardcoded — niemand,
 *   auch der Entwickler nicht, kann den Empfänger nachträglich ändern.
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { toHex } from "./htlc.js";

/** ISO-Wochennummer seit Epoch — deterministische Zeitachse. */
export function weekNumber(nowMs = Date.now()): number {
  return Math.floor(nowMs / (7 * 24 * 3600 * 1000));
}

/** Deterministischer Wochen-Seed aus dem Treasury-Master-Secret. */
export function deriveWeekSeed(masterSecretHex: string, week: number): Uint8Array {
  const master = typeof masterSecretHex === "string"
    ? Uint8Array.from((masterSecretHex.match(/.{1,2}/g) ?? []).map((h) => parseInt(h, 16)))
    : masterSecretHex;
  return hmac(sha512, master, new TextEncoder().encode(`freedom-treasury-week-${week}`));
}

export interface WeekRecipient {
  week: number;
  /** Ed25519-Pubkey (32 bytes hex). */
  pubkeyHex: string;
  /**
   * SOL-Empfangsadresse in base58 — DAS ist das Format, das Solana erwartet.
   * Vorher wurde ueberall pubkeyHex als Adresse durchgereicht; `new PublicKey(hex)`
   * wirft aber (Hex ist kein base58), weshalb der Sweep nie laufen konnte.
   */
  address: string;
  /**
   * Ed25519-Seed (32 bytes) dieser Woche. NUR am Treasury-Node vorhanden.
   * Ohne diesen Wert kann niemand die Wochen-Wallet ausgeben — deshalb gab
   * der Sweep frueher eine falsche Signatur ab: er leitete sein Keypair aus
   * dem PUBLIC key ab.
   */
  seed: Uint8Array;
  /** Kurzform fuer Logs/UI. */
  short: string;
}

/** base58 (Bitcoin/Solana-Alphabet) — keine externe Abhaengigkeit noetig. */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function toBase58(bytes: Uint8Array): string {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  const digits: number[] = [];
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/** Wochen-Empfänger ableiten (nur mit dem Secret — läuft nur am Treasury-Node). */
export function deriveWeekRecipient(masterSecretHex: string, week = weekNumber()): WeekRecipient {
  const seed = deriveWeekSeed(masterSecretHex, week);
  // Ed25519: Seed (32b) -> Pubkey. Solana nutzt Ed25519 — direkt kompatibel.
  const priv = seed.slice(0, 32);
  const pub = ed25519.getPublicKey(priv);
  const hex = toHex(pub);
  const address = toBase58(pub);
  return {
    week,
    pubkeyHex: hex,
    address,
    seed: priv,
    short: address.slice(0, 6) + "…" + address.slice(-4),
  };
}

/**
 * Prüfung am Treasury-Node: Ist `address` die erwartete Wochen-Adresse?
 *
 * Die frühere Signatur nahm einen Master-PUBKEY und gab immer `false` zurück —
 * eine tote Funktion, die im Zweifel das Gegenteil des Gemeinten behauptete.
 * Ableiten kann die Adresse nur, wer das Master-SECRET hat; öffentlich prüfbar
 * ist die Adresse ausschließlich über das signierte Announcement (kind 38050).
 */
export function verifyWeekRecipient(
  masterSecretHex: string,
  address: string,
  week = weekNumber(),
): boolean {
  const expected = deriveWeekRecipient(masterSecretHex, week);
  return expected.address === address || expected.pubkeyHex === address;
}

// ------------------------------------------------------------- Payout-Events

/** Tag im Payout-Announcement-Event (kind 38050). */
export interface PayoutAnnouncement {
  week: number;
  /** SOL-Empfangsadresse dieser Woche (hex). */
  recipientAddressHex: string;
}

/**
 * Baut das wöchentliche Announcement (kind 38050): "Diese Woche zahlt das
 * Protokoll Development-Fees an <address>." Signiert vom TREASURY-NOSTR-KEY.
 * Clients/Provider prüfen Signatur + bekannten Treasury-Pubkey und senden
 * ihre Dev-Fee dorthin.
 */
export function buildPayoutAnnouncement(
  a: PayoutAnnouncement,
  treasuryNostrPubkey: string,
  createdAt?: number,
): UnsignedEventLike {
  return {
    pubkey: treasuryNostrPubkey,
    kind: 38050,
    tags: [
      ["d", `treasury-week-${a.week}`],
      ["week", String(a.week)],
      ["address", a.recipientAddressHex],
      ["chain", "solana"],
    ],
    content: "",
    created_at: createdAt,
  };
}

/** Liest ein Announcement (ohne Trust — Signaturen werden beim Verify geprüft). */
export function parsePayoutAnnouncement(ev: { kind: number; tags: string[][] }): PayoutAnnouncement | null {
  if (ev.kind !== 38050) return null;
  const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1];
  const week = Number(get("week") ?? "-1");
  const addr = get("address");
  if (!addr || Number.isNaN(week)) return null;
  return { week, recipientAddressHex: addr };
}

/** Sweep-Schwelle: ab wie viel msat Äquivalent wird zur Haupt-Wallet gesweept? */
export const SWEEP_THRESHOLD_MSAT = 100_000; // 100 sats

interface UnsignedEventLike {
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
}
