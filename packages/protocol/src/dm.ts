/**
 * Nostr-DM (NIP-44 verschlüsselte Nachrichten).
 *
 * kind 4 = verschlüsselte DM (NIP-44)
 * - Sender verschlüsselt für Empfänger
 * - Nur Empfänger kann entschlüsseln
 * - Kein Server sieht den Inhalt
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag } from "./event.js";
import { KIND_DM } from "./kinds.js";

export interface DMParams {
  senderPubkey: string;
  recipientPubkey: string;
  /** Verschlüsselter Inhalt (NIP-44). */
  encryptedContent: string;
  /** Optional: Referenz auf vorherige Nachricht (thread). */
  replyTo?: string;
}

export function buildDM(p: DMParams, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["p", p.recipientPubkey],
  ];
  if (p.replyTo) tags.push(["e", p.replyTo, "", "reply"]);
  return buildEvent(p.senderPubkey, KIND_DM, tags, p.encryptedContent, createdAt);
}

export interface ParsedDM {
  senderPubkey: string;
  recipientPubkey: string;
  encryptedContent: string;
  replyTo?: string;
}

export function parseDM(ev: UnsignedEvent): ParsedDM {
  if (ev.kind !== KIND_DM) throw new Error(`keine DM: ${ev.kind}`);
  const recipient = getTag(ev, "p");
  if (!recipient) throw new Error("DM ohne p-Tag");
  return {
    senderPubkey: ev.pubkey,
    recipientPubkey: recipient,
    encryptedContent: ev.content,
    replyTo: getTag(ev, "e"),
  };
}

/** Filtert DMs für einen bestimmten Nutzer (als Empfänger). */
export function filterDMsForUser(events: NostrEvent[], userPubkey: string): ParsedDM[] {
  return events
    .filter((ev) => ev.kind === KIND_DM)
    .map((ev) => {
      try {
        return parseDM(ev);
      } catch {
        return null;
      }
    })
    .filter((dm): dm is ParsedDM => dm !== null)
    .filter((dm) => dm.recipientPubkey === userPubkey || dm.senderPubkey === userPubkey)
    .sort((a, b) => (a as unknown as { created_at: number }).created_at - (b as unknown as { created_at: number }).created_at);
}

// ---------------------------------------------------------------- NIP-44 v2
//
// WARUM DIESE DATEI NEU GESCHRIEBEN WURDE
//
// Die vorherige Fassung war als "NIP-44" deklariert, tat aber etwas anderes:
// sie steckte einen secp256k1-Secret-Key in X25519 und den x-only-secp256k1-
// Pubkey als X25519-U-Koordinate. Beide Seiten leiteten dadurch VERSCHIEDENE
// Shared Secrets ab — jede DM war fuer den Empfaenger unentschluesselbar
// ("invalid tag"), und mit anderen Nostr-Clients war gar nichts kompatibel.
//
// Diese Implementierung folgt NIP-44 v2:
//   conversation_key = HKDF-Extract(IKM = ECDH-x(sk, pk), salt = "nip44-v2")
//   nonce            = 32 zufaellige Bytes pro Nachricht
//   (cc_key, cc_nonce, hmac_key) = HKDF-Expand(conversation_key, nonce, 76)
//   ciphertext       = ChaCha20(cc_key, cc_nonce, pad(plaintext))
//   mac              = HMAC-SHA256(hmac_key, nonce || ciphertext)
//   payload          = base64(0x02 || nonce || ciphertext || mac)
//
// Padding versteckt die exakte Laenge (sonst verraet die Ciphertext-Groesse
// den Nachrichteninhalt bei kurzen Standardantworten).

const NIP44_VERSION = 2;

/** base64 ohne Buffer/btoa — laeuft in Node UND im Browser-Bundle.
 *  (Der Browser-Build shimt Buffer nur teilweise, siehe build.mjs.) */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}

function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("ungueltiges base64-Zeichen im NIP-44-Payload");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** NIP-44 calc_padded_len: Laengen werden auf Stufen gerundet. */
function paddedLen(len: number): number {
  if (len <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function pad(plaintext: string): Uint8Array {
  const bytes = new TextEncoder().encode(plaintext);
  if (bytes.length < 1 || bytes.length > 65535) {
    throw new Error(`NIP-44: Laenge ${bytes.length} ausserhalb 1..65535`);
  }
  const total = 2 + paddedLen(bytes.length);
  const out = new Uint8Array(total); // Rest bleibt 0 = Padding
  out[0] = bytes.length >> 8;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function unpad(padded: Uint8Array): string {
  if (padded.length < 2) throw new Error("NIP-44: Payload zu kurz");
  const len = (padded[0] << 8) | padded[1];
  const bytes = padded.subarray(2, 2 + len);
  if (len === 0 || bytes.length !== len || padded.length !== 2 + paddedLen(len)) {
    throw new Error("NIP-44: ungueltiges Padding");
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Conversation-Key: HKDF-Extract ueber die x-Koordinate des ECDH-Punktes.
 * Symmetrisch — beide Seiten kommen auf denselben Wert. Genau das war vorher
 * kaputt, deshalb prueft der Test das explizit in beide Richtungen.
 */
export async function conversationKey(sk: Uint8Array, pkHex: string): Promise<Uint8Array> {
  const { secp256k1 } = await import("@noble/curves/secp256k1.js");
  const { extract } = await import("@noble/hashes/hkdf.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { hexToBytes } = await import("@noble/hashes/utils.js");
  // Nostr-Pubkeys sind x-only (32 byte). Fuer ECDH auf den geraden Punkt
  // ergaenzen (Praefix 02) — so schreibt es NIP-44 vor.
  // @noble/curves v2 will Bytes, keine Hex-Strings.
  const shared = secp256k1.getSharedSecret(sk, hexToBytes("02" + pkHex));
  const sharedX = shared.subarray(1, 33); // x-Koordinate ohne Praefix-Byte
  return extract(sha256, sharedX, new TextEncoder().encode("nip44-v2"));
}

async function messageKeys(convKey: Uint8Array, nonce: Uint8Array): Promise<{
  chachaKey: Uint8Array;
  chachaNonce: Uint8Array;
  hmacKey: Uint8Array;
}> {
  const { expand } = await import("@noble/hashes/hkdf.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const keys = expand(sha256, convKey, nonce, 76);
  return {
    chachaKey: keys.subarray(0, 32),
    chachaNonce: keys.subarray(32, 44),
    hmacKey: keys.subarray(44, 76),
  };
}

/** NIP-44 v2 Verschluesselung. Gibt den base64-Payload fuer event.content. */
export async function encryptDM(
  plaintext: string,
  senderSk: Uint8Array,
  recipientPk: string,
): Promise<string> {
  const { chacha20 } = await import("@noble/ciphers/chacha.js");
  const { hmac } = await import("@noble/hashes/hmac.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { randomBytes } = await import("@noble/hashes/utils.js");

  const convKey = await conversationKey(senderSk, recipientPk);
  const nonce = randomBytes(32);
  const { chachaKey, chachaNonce, hmacKey } = await messageKeys(convKey, nonce);

  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext));

  // MAC deckt Nonce UND Ciphertext ab (sonst waere die Nonce manipulierbar).
  const macInput = new Uint8Array(nonce.length + ciphertext.length);
  macInput.set(nonce, 0);
  macInput.set(ciphertext, nonce.length);
  const mac = hmac(sha256, hmacKey, macInput);

  const payload = new Uint8Array(1 + nonce.length + ciphertext.length + mac.length);
  payload[0] = NIP44_VERSION;
  payload.set(nonce, 1);
  payload.set(ciphertext, 1 + nonce.length);
  payload.set(mac, 1 + nonce.length + ciphertext.length);
  return toBase64(payload);
}

/** NIP-44 v2 Entschluesselung. Wirft bei falschem MAC (keine stille Ausgabe). */
export async function decryptDM(
  payloadB64: string,
  recipientSk: Uint8Array,
  senderPk: string,
): Promise<string> {
  const { chacha20 } = await import("@noble/ciphers/chacha.js");
  const { hmac } = await import("@noble/hashes/hmac.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");

  if (payloadB64.startsWith("#")) {
    throw new Error("NIP-44: nicht unterstuetzte Payload-Version");
  }
  const payload = fromBase64(payloadB64);
  if (payload.length < 1 + 32 + 32 + 32) throw new Error("NIP-44: Payload zu kurz");
  if (payload[0] !== NIP44_VERSION) {
    throw new Error(`NIP-44: unbekannte Version ${payload[0]}`);
  }

  const nonce = payload.subarray(1, 33);
  const ciphertext = payload.subarray(33, payload.length - 32);
  const mac = payload.subarray(payload.length - 32);

  const convKey = await conversationKey(recipientSk, senderPk);
  const { chachaKey, chachaNonce, hmacKey } = await messageKeys(convKey, nonce);

  const macInput = new Uint8Array(nonce.length + ciphertext.length);
  macInput.set(nonce, 0);
  macInput.set(ciphertext, nonce.length);
  const expected = hmac(sha256, hmacKey, macInput);

  // Konstante Laufzeit: kein frueher Abbruch beim ersten abweichenden Byte.
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected[i] ^ mac[i];
  if (diff !== 0) throw new Error("NIP-44: MAC ungueltig (manipuliert oder falscher Schluessel)");

  return unpad(chacha20(chachaKey, chachaNonce, ciphertext));
}

/** Erkennt, ob ein event.content ein NIP-44-v2-Payload ist (fuer Migration:
 *  alte Klartext-Nachrichten sollen weiter lesbar bleiben). */
export function isNip44Payload(content: string): boolean {
  if (content.length < 132 || content.includes("?iv=")) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return false;
  try {
    return fromBase64(content)[0] === NIP44_VERSION;
  } catch {
    return false;
  }
}
