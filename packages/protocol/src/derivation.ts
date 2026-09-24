/**
 * Schluesselableitung fuer Solana (Schritt 1.1 im Ausbauplan).
 *
 * Aus EINER Merkphrase entstehen alle dauerhaften Schluessel, jeder mit
 * eigenem Zweck. Die Nostr-Identitaet bleibt unveraendert bei NIP-06
 * (m/44'/1237'/0'/0/0, siehe app/src/identity.ts). Dazu kommt hier die
 * Solana-Seite nach SLIP-10 fuer Ed25519:
 *
 *   m/44'/501'/0'/0'   Haupt-Wallet – dieselbe Adresse wie in Phantom/Solflare
 *   m/44'/501'/n'/0'   frische Adressen je Sitzung, Swap oder Zahlung
 *
 * WICHTIG: Ed25519 kennt nach SLIP-10 nur gehaertete Ableitung. Es gibt also
 * keinen oeffentlichen Erweiterungsschluessel, aus dem Dritte Adressen
 * ableiten koennten – wer Geld empfangen will, erzeugt jede Adresse selbst
 * und schickt sie (verschluesselt) mit.
 *
 * Geprueft gegen die offiziellen SLIP-0010-Testvektoren (test/derivation.test.ts).
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";

const HARDENED = 0x80000000;
const MASTER_KEY = new TextEncoder().encode("ed25519 seed");

export interface Slip10Node {
  privateKey: Uint8Array;
  chainCode: Uint8Array;
}

/** Pfad der Solana-Wallet mit Index n (Phantom-kompatibel). */
export function solanaPath(index = 0): string {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error(`Ungueltiger Solana-Index: ${index}`);
  }
  return `m/44'/501'/${index}'/0'`;
}

/** Zerlegt einen Pfad wie m/44'/501'/0'/0' in Indizes; ' oder H markiert gehaertet. */
export function parseDerivationPath(path: string): number[] {
  const teile = path.trim().split("/");
  if (teile[0] !== "m") throw new Error(`Pfad muss mit "m" beginnen: ${path}`);
  return teile.slice(1).map((t) => {
    const hart = /['hH]$/.test(t);
    const zahl = hart ? t.slice(0, -1) : t;
    if (!/^\d+$/.test(zahl)) throw new Error(`Ungueltiger Pfadteil: ${t}`);
    const n = Number(zahl);
    if (n >= HARDENED) throw new Error(`Pfadteil zu gross: ${t}`);
    return hart ? n + HARDENED : n;
  });
}

/** SLIP-10-Wurzel fuer Ed25519. */
export function slip10Master(seed: Uint8Array): Slip10Node {
  if (seed.length < 16 || seed.length > 64) throw new Error("Seed muss 16 bis 64 Byte lang sein");
  const I = hmac(sha512, MASTER_KEY, seed);
  return { privateKey: I.slice(0, 32), chainCode: I.slice(32) };
}

/** Ein gehaerteter Ableitungsschritt nach SLIP-10 (Ed25519). */
export function slip10Child(parent: Slip10Node, index: number): Slip10Node {
  if (index < HARDENED) throw new Error("SLIP-10 fuer Ed25519 erlaubt nur gehaertete Ableitung");
  const data = new Uint8Array(37);
  data.set(parent.privateKey, 1);
  new DataView(data.buffer).setUint32(33, index >>> 0, false);
  const I = hmac(sha512, parent.chainCode, data);
  return { privateKey: I.slice(0, 32), chainCode: I.slice(32) };
}

/** Leitet einen Knoten entlang eines vollstaendig gehaerteten Pfads ab. */
export function slip10Derive(seed: Uint8Array, path: string): Slip10Node {
  let knoten = slip10Master(seed);
  for (const i of parseDerivationPath(path)) knoten = slip10Child(knoten, i);
  return knoten;
}

/** Oeffentlicher Schluessel im SLIP-10-Format (fuehrendes 0x00, 33 Byte). */
export function slip10PublicKey(privateKey: Uint8Array): Uint8Array {
  const out = new Uint8Array(33);
  out.set(ed25519.getPublicKey(privateKey), 1);
  return out;
}

export interface DerivedSolanaKey {
  /** 64 Byte: privater Seed ‖ oeffentlicher Schluessel – das Format von Keypair.fromSecretKey. */
  secretKey: Uint8Array;
  /** 32 Byte, Base58-kodiert ist das die Solana-Adresse. */
  publicKey: Uint8Array;
  path: string;
}

/** Solana-Schluessel mit Index n aus dem BIP-39-Seed. */
export function deriveSolanaKey(seed: Uint8Array, index = 0): DerivedSolanaKey {
  const path = solanaPath(index);
  const { privateKey } = slip10Derive(seed, path);
  const publicKey = ed25519.getPublicKey(privateKey);
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKey, 0);
  secretKey.set(publicKey, 32);
  return { secretKey, publicKey, path };
}
