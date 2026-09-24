/**
 * NIP-04 (Legacy-Verschlüsselung).
 *
 * WARUM DAS HIER TROTZDEM STEHT
 * Für DMs ist NIP-04 überholt — dafür nutzt das Projekt NIP-44 (siehe dm.ts).
 * NWC-Wallets (NIP-47) sprechen aber überwiegend noch NIP-04, und ein
 * Wallet-Connect, der die verbreiteten Wallets nicht erreicht, hilft niemandem.
 * Deshalb: NIP-04 als Kompatibilitätsschicht, ausschließlich für NWC, mit
 * automatischer Bevorzugung von NIP-44 wo das Wallet es ankündigt.
 *
 * BEKANNTE SCHWÄCHEN von NIP-04 (bewusst dokumentiert, nicht verschwiegen):
 * - AES-CBC ohne MAC: der Ciphertext ist nicht authentifiziert, ein Angreifer
 *   kann ihn manipulieren, ohne dass es auffällt.
 * - Die Länge des Klartexts ist sichtbar (kein Padding-Schema wie bei NIP-44).
 * Für NWC-Kommandos zwischen Nutzer und eigenem Wallet ist das vertretbar;
 * für Nachrichteninhalte wäre es das nicht.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { cbc } from "@noble/ciphers/aes.js";
import { randomBytes, hexToBytes } from "@noble/hashes/utils.js";

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
}

function b64decode(s: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}

/** Gemeinsames Geheimnis: x-Koordinate des ECDH-Punktes (wie NIP-04 vorschreibt). */
export function nip04SharedSecret(sk: Uint8Array, pkHex: string): Uint8Array {
  const point = secp256k1.getSharedSecret(sk, hexToBytes("02" + pkHex));
  return point.subarray(1, 33);
}

/** NIP-04 verschlüsseln. Ergebnis: "<base64-ct>?iv=<base64-iv>". */
export function nip04Encrypt(plaintext: string, sk: Uint8Array, pkHex: string): string {
  const key = nip04SharedSecret(sk, pkHex);
  const iv = randomBytes(16);
  const ct = cbc(key, iv).encrypt(new TextEncoder().encode(plaintext));
  return `${b64encode(ct)}?iv=${b64encode(iv)}`;
}

/** NIP-04 entschlüsseln. */
export function nip04Decrypt(payload: string, sk: Uint8Array, pkHex: string): string {
  const [ctB64, ivPart] = payload.split("?iv=");
  if (!ctB64 || !ivPart) throw new Error("NIP-04: Payload ohne ?iv= — falsches Format");
  const key = nip04SharedSecret(sk, pkHex);
  const pt = cbc(key, b64decode(ivPart)).decrypt(b64decode(ctB64));
  return new TextDecoder().decode(pt);
}

/** Erkennt NIP-04-Payloads (zur Unterscheidung von NIP-44). */
export function isNip04Payload(content: string): boolean {
  return content.includes("?iv=");
}
