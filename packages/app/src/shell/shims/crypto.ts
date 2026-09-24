/**
 * Browser-Shim fuer node:crypto — deckt exakt die API ab, die
 * @freedomstack/protocol nutzt: randomBytes, createHash("sha256").
 * Nutzt WebCrypto + @noble/hashes (bereits Dependency des Protokolls).
 */
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// --- zusätzliche Exporte für turbo-sdk/arbundles (Browser-Builds nutzen
// webcrypto direkt; diese Node-APIs werden im Browser nie ausgeführt) ---
export const constants = {};
export function createSign(): never { throw new Error("node-only: createSign"); }
const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
export default { randomBytes, webcrypto, constants, createSign };

class Hash {
  private data: Uint8Array[] = [];
  constructor(private algo: string) {
    if (algo !== "sha256") throw new Error(`shim: ${algo} nicht unterstuetzt`);
  }
  update(d: Uint8Array | string): this {
    this.data.push(typeof d === "string" ? new TextEncoder().encode(d) : d);
    return this;
  }
  digest(): Uint8Array {
    const total = this.data.reduce((s, x) => s + x.length, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const d of this.data) {
      all.set(d, off);
      off += d.length;
    }
    return nobleSha256(all);
  }
}

export function createHash(algo: string): Hash {
  return new Hash(algo);
}
