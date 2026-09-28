// Spiegel-Schlüssel lesen (5.3c, 5.9b): nsec1… oder 64 Hex-Zeichen – sonst eine feste
// Meldung, nie der Wert selbst (Secrets erscheinen nicht im Protokoll).
import { bech32 } from "@scure/base";

export function spiegelSchluessel(s: string): Uint8Array {
  const t = s.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) return Uint8Array.from(Buffer.from(t, "hex"));
  try {
    const d = bech32.decode(t as `${string}1${string}`, 200);
    const b = bech32.fromWords(d.words);
    if (d.prefix === "nsec" && b.length === 32) return Uint8Array.from(b);
  } catch { /* unten */ }
  throw new Error("SPIEGEL_NSEC unlesbar (nsec1… oder 64 Hex-Zeichen)");
}
