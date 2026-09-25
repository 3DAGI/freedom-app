/**
 * Verschluesselte Anhaenge (Schritt 2.4).
 *
 * DAS PROBLEM
 * Grosse Chat-Anhaenge gingen im Klartext ins Blob-Netz (Chunks als Hex) oder
 * zu einem Blossom-Server – dazu Name und Typ im oeffentlichen Manifest. Die
 * Direktnachricht selbst war verschluesselt, die Datei daneben nicht.
 *
 * WAS HIER GEBAUT IST
 * AES-256-GCM mit einem zufaelligen Schluessel und einer zufaelligen Nonce je
 * Datei (wie NIP-17 Kind 15 mit `aes-gcm`). Hochgeladen wird nur das
 * Chiffrat. Schluessel, Nonce, der SHA-256 des Klartexts (`ox`), Typ und
 * Groesse reisen nur in der verschluesselten Nachricht. Beim Oeffnen prueft
 * GCM die Unversehrtheit; der Hash prueft zusaetzlich, dass es die gemeinte
 * Datei ist.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

/** Was ein Empfaenger zum Oeffnen braucht – steht nur in der verschluesselten Nachricht. */
export interface DateiSchluessel {
  alg: "aes-gcm";
  /** 32 Byte, hex */
  key: string;
  /** 12 Byte, hex */
  nonce: string;
  /** SHA-256 des Klartexts, hex */
  ox: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX24 = /^[0-9a-f]{24}$/;

/** Prueft einen Schluessel aus fremder Nachricht – Form und Laengen, sonst false. */
export function istDateiSchluessel(x: unknown): x is DateiSchluessel {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return s.alg === "aes-gcm" && typeof s.key === "string" && HEX64.test(s.key)
    && typeof s.nonce === "string" && HEX24.test(s.nonce) && typeof s.ox === "string" && HEX64.test(s.ox);
}

/** Datei verschluesseln: frischer Schluessel und frische Nonce je Aufruf. */
export function verschluesseleDatei(klartext: Uint8Array): { chiffrat: Uint8Array; schluessel: DateiSchluessel } {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const chiffrat = gcm(key, nonce).encrypt(klartext);
  const schluessel: DateiSchluessel = { alg: "aes-gcm", key: bytesToHex(key), nonce: bytesToHex(nonce), ox: bytesToHex(sha256(klartext)) };
  key.fill(0);
  return { chiffrat, schluessel };
}

/**
 * Datei entschluesseln. Wirft, wenn der Schluessel kaputt ist, das Chiffrat
 * veraendert wurde (GCM-Tag) oder der Klartext nicht zum Hash passt.
 */
export function entschluesseleDatei(chiffrat: Uint8Array, schluessel: DateiSchluessel): Uint8Array {
  if (!istDateiSchluessel(schluessel)) throw new Error("Datei-Schlüssel ungültig");
  let klartext: Uint8Array;
  try {
    klartext = gcm(hexToBytes(schluessel.key), hexToBytes(schluessel.nonce)).decrypt(chiffrat);
  } catch {
    throw new Error("Datei beschädigt oder falscher Schlüssel");
  }
  if (bytesToHex(sha256(klartext)) !== schluessel.ox) throw new Error("Datei passt nicht zum Hash");
  return klartext;
}
