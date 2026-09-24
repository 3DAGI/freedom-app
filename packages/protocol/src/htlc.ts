/**
 * HTLC-Primitive.
 *
 * Der gemeinsame Nenner des Lightning<->Solana-Swaps ist die Hashfunktion:
 * Lightning verwendet fuer den Payment-Hash SHA-256, und das Solana-HTLC-Programm
 * prueft mit demselben SHA-256-Syscall. Dieselbe Preimage `R` entsperrt daher
 * beide Seiten -> das ist die Grundlage der Atomizitaet.
 */
import { randomBytes, createHash } from "node:crypto";

/** 32-Byte-Geheimnis. Wird vom Zahler erzeugt und geheim gehalten, bis er einloest. */
export function generatePreimage(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/** SHA-256, identisch zu Lightnings Payment-Hash und Solanas `hash`-Syscall. */
export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

/** Der oeffentlich geteilte Hashlock H = SHA256(R). */
export function hashlock(preimage: Uint8Array): Uint8Array {
  return sha256(preimage);
}

/** Prueft, ob eine offengelegte Preimage zum Hashlock passt (konstanter Vergleich). */
export function verifyPreimage(preimage: Uint8Array, lock: Uint8Array): boolean {
  const got = hashlock(preimage);
  if (got.length !== lock.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ lock[i];
  return diff === 0;
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

export function fromHex(h: string): Uint8Array {
  return new Uint8Array(Buffer.from(h, "hex"));
}
