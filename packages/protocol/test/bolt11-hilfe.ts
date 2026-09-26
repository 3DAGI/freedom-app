/**
 * Selbst signierte bolt11-Rechnungen fuer Tests (Schritt 4.8) – keine echten
 * Knoten, keine Geheimnisse: jeder Test erzeugt seinen Schluessel.
 */
import { bech32 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

function inBytes(w: number[]): Uint8Array {
  const out: number[] = []; let a = 0, b = 0;
  for (const x of w) { a = (a << 5) | x; b += 5; while (b >= 8) { b -= 8; out.push((a >> b) & 0xff); } }
  if (b > 0) out.push((a << (8 - b)) & 0xff);
  return Uint8Array.from(out);
}

/** Selbst signierte Rechnung (fuer Tests). */
export function rechnung(sk: Uint8Array, prefix: string, preimage: Uint8Array, nennt?: Uint8Array): string {
  const feld = (typ: number, daten: Uint8Array) => { const w = bech32.toWords(daten); return [typ, Math.floor(w.length / 32), w.length % 32, ...w]; };
  const woerter = [0, 0, 0, 0, 0, 0, 1, ...feld(1, sha256(preimage)), ...(nennt ? feld(19, nennt) : [])];
  const sig = secp256k1.sign(new Uint8Array([...new TextEncoder().encode(prefix), ...inBytes(woerter)]), sk, { format: "recovered" });
  return bech32.encode(prefix, [...woerter, ...bech32.toWords(new Uint8Array([...sig.slice(1), sig[0]]))], false);
}

/** Neuer Knotenschluessel fuer Test-Rechnungen. */
export function knotenSchluessel(): Uint8Array {
  return secp256k1.utils.randomSecretKey();
}
