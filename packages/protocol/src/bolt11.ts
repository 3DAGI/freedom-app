/**
 * bolt11-Rechnungen lesen und ihre Signatur pruefen (Schritt 4.8).
 *
 * Ein Preimage beweist nur, dass *irgendeine* Rechnung mit diesem Hash bezahlt
 * wurde. Wer wem gezahlt hat, steht in der Rechnung: Sie ist vom Knoten des
 * Empfaengers signiert. Aus der Signatur laesst sich sein Schluessel
 * zurueckrechnen (oder, wenn die Rechnung ihn im Feld `n` nennt, pruefen).
 *
 * Signiert wird sha256(hrp als UTF-8 ‖ Datenteil ohne Signatur, auf volle
 * Bytes mit Null-Bits aufgefuellt); die Signatur sind 64 Byte plus ein Byte
 * Recovery-ID (BOLT 11).
 */
import { bech32 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface Bolt11 {
  /** Netz aus dem Praefix: bc (Mainnet), tb (Testnet), bcrt (Regtest), tbs (Signet). */
  netz: string;
  /** Betrag in msat; null bei einer Rechnung ohne Betrag. */
  betragMsat: number | null;
  /** Payment-Hash (hex, 32 Byte). */
  zahlungsHash: string;
  /** Knoten des Empfaengers (hex, 33 Byte komprimiert) – aus der Signatur. */
  empfaengerKnoten: string;
  /** Unix-Sekunden. */
  zeit: number;
}

const FAKTOR: Record<string, number> = { m: 1e8, u: 1e5, n: 100, p: 0.1 };

/** 5-Bit-Woerter in Bytes, mit Null-Bits auf volle Bytes aufgefuellt (BOLT 11). */
function woerterZuBytes(woerter: readonly number[]): Uint8Array {
  const out: number[] = [];
  let akku = 0, bits = 0;
  for (const w of woerter) {
    akku = (akku << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((akku >> bits) & 0xff);
    }
  }
  if (bits > 0) out.push((akku << (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

function zahl(woerter: readonly number[]): number {
  return woerter.reduce((n, w) => n * 32 + w, 0);
}

/** Liest eine bolt11-Rechnung und prueft ihre Signatur; wirft bei jedem Fehler. */
export function leseBolt11(rechnung: string): Bolt11 {
  const pr = rechnung.trim().toLowerCase();
  const { prefix, words } = bech32.decode(pr as `${string}1${string}`, 2000);
  const m = /^ln(bcrt|bc|tbs|tb)(\d+)?([munp])?$/.exec(prefix);
  if (!m) throw new Error("kein bolt11-Präfix");
  let betragMsat: number | null = null;
  if (m[2]) {
    const roh = Number(m[2]) * (m[3] ? FAKTOR[m[3]] : 1e11);
    if (!Number.isSafeInteger(roh)) throw new Error("ungültiger Betrag in der Rechnung");
    betragMsat = roh;
  }
  if (words.length < 7 + 104) throw new Error("Rechnung zu kurz");
  const daten = words.slice(0, words.length - 104);
  const sig = woerterZuBytes(words.slice(words.length - 104)); // 65 Byte
  const zeit = zahl(daten.slice(0, 7));
  let zahlungsHash = "";
  let genannterKnoten = "";
  for (let i = 7; i + 3 <= daten.length;) {
    const typ = daten[i], laenge = daten[i + 1] * 32 + daten[i + 2];
    const feld = daten.slice(i + 3, i + 3 + laenge);
    if (feld.length !== laenge) throw new Error("abgeschnittenes Feld");
    if (typ === 1 && laenge === 52) zahlungsHash = bytesToHex(woerterZuBytes(feld).slice(0, 32));
    if (typ === 19 && laenge === 53) genannterKnoten = bytesToHex(woerterZuBytes(feld).slice(0, 33));
    i += 3 + laenge;
  }
  if (!/^[0-9a-f]{64}$/.test(zahlungsHash)) throw new Error("Rechnung ohne Payment-Hash");
  const nachricht = new Uint8Array([...new TextEncoder().encode(prefix), ...woerterZuBytes(daten)]);
  const rec = sig[64];
  if (rec > 3) throw new Error("ungültige Recovery-ID");
  let knoten: string;
  try {
    knoten = bytesToHex(secp256k1.recoverPublicKey(new Uint8Array([rec, ...sig.slice(0, 64)]), nachricht));
  } catch {
    throw new Error("Signatur der Rechnung ungültig");
  }
  if (genannterKnoten && genannterKnoten !== knoten) throw new Error("Signatur passt nicht zum genannten Knoten");
  return { netz: m[1], betragMsat, zahlungsHash, empfaengerKnoten: knoten, zeit };
}
