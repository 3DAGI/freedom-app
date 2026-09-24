/**
 * Echte Nostr-Events (NIP-01).
 *
 * Event-ID = SHA256 der kanonischen JSON-Serialisierung:
 *   [0, pubkey, created_at, kind, tags, content]
 * Signatur = BIP-340 Schnorr ueber die Event-ID (secp256k1, x-only Pubkey).
 *
 * Das ist dasselbe Format, das Buzz auf der Leitung spricht (NIP-01 wire
 * format) - unsere Events sind damit von jedem Nostr-Relay/-Client lesbar.
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "./htlc.js";
import { toHex, fromHex } from "./htlc.js";

export interface UnsignedEvent {
  pubkey: string;      // 32-Byte x-only Pubkey, hex
  created_at: number;  // Unix-Sekunden
  kind: number;
  tags: string[][];
  content: string;
}

export interface NostrEvent extends UnsignedEvent {
  id: string;   // 32-Byte SHA256, hex
  sig: string;  // 64-Byte Schnorr, hex
}

export interface Keypair {
  sk: Uint8Array;
  pk: string; // hex, x-only
}

export function generateKeypair(): Keypair {
  const sk = schnorr.utils.randomSecretKey();
  return { sk, pk: toHex(schnorr.getPublicKey(sk)) };
}

/** Keypair aus einem vorhandenen Secret — fuer Release-Signierung und Import. */
export function keypairFromSecret(sk: Uint8Array): Keypair {
  if (sk.length !== 32) throw new Error(`Secret muss 32 Bytes haben, hat ${sk.length}`);
  return { sk, pk: toHex(schnorr.getPublicKey(sk)) };
}

/** Kanonische NIP-01-Serialisierung fuer die ID-Berechnung. */
export function serializeEvent(e: UnsignedEvent): string {
  return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
}

export function computeEventId(e: UnsignedEvent): string {
  return toHex(sha256(new TextEncoder().encode(serializeEvent(e))));
}

export function signEvent(e: UnsignedEvent, sk: Uint8Array): NostrEvent {
  const id = computeEventId(e);
  const sig = toHex(schnorr.sign(fromHex(id), sk));
  return { ...e, id, sig };
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/**
 * Form eines Events nach NIP-01 – geprueft, BEVOR irgendetwas dekodiert wird.
 *
 * fromHex() (Buffer.from(h, "hex")) bricht beim ersten ungueltigen Zeichen
 * still ab. Ein pubkey aus 64 Hex-Zeichen plus angehaengtem Text bestand
 * deshalb die Signaturpruefung: geprueft wurde gegen den echten Schluessel,
 * der Text lief bis in die Oberflaeche mit (Schritt 0.J).
 */
export function hasValidEventShape(e: unknown): e is NostrEvent {
  if (typeof e !== "object" || e === null) return false;
  const ev = e as Record<string, unknown>;
  return typeof ev.id === "string" && HEX64.test(ev.id)
    && typeof ev.pubkey === "string" && HEX64.test(ev.pubkey)
    && typeof ev.sig === "string" && HEX128.test(ev.sig)
    && Number.isSafeInteger(ev.created_at) && (ev.created_at as number) >= 0
    && Number.isSafeInteger(ev.kind) && (ev.kind as number) >= 0
    && Array.isArray(ev.tags)
    && ev.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))
    && typeof ev.content === "string";
}

/** Vollstaendige Pruefung: Form nach NIP-01, ID korrekt berechnet UND Signatur gueltig. */
export function verifyEvent(e: NostrEvent): boolean {
  try {
    if (!hasValidEventShape(e)) return false;
    if (computeEventId(e) !== e.id) return false;
    return schnorr.verify(fromHex(e.sig), fromHex(e.id), fromHex(e.pubkey));
  } catch {
    return false;
  }
}

/** Erstes Tag mit gegebenem Namen. */
export function getTag(e: UnsignedEvent, name: string): string | undefined {
  return e.tags.find((t) => t[0] === name)?.[1];
}

/** Alle Tags mit gegebenem Namen. */
export function getTags(e: UnsignedEvent, name: string): string[][] {
  return e.tags.filter((t) => t[0] === name);
}

/** Baut ein unsigniertes Event mit Standardzeit. */
export function buildEvent(
  pubkey: string,
  kind: number,
  tags: string[][],
  content = "",
  createdAt = Math.floor(Date.now() / 1000),
): UnsignedEvent {
  return { pubkey, created_at: createdAt, kind, tags, content };
}
