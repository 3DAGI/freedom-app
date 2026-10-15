/**
 * Kopplung mit Code zum Eintippen (VKf, K1 aus `docs/VIBECODEN-ENTWURF.md`, VK-W9 – MENSCH 14.10.):
 * Statt den Kopplungscode zu scannen, tippt der Besitzer zwölf Zeichen ab, die `npm run koppeln
 * -- --code` zeigt (`7KQ2-9XMB-4TRP`, Crockford-Base32, 60 Bit, zehn Minuten gültig).
 *
 * Ohne neue Kryptografie: Aus dem Code entstehen mit PBKDF2-SHA256 (600 000 Runden wie der Tresor)
 * 64 Byte – die ersten 32 sind der NIP-44-Schlüssel, die letzten 32 die Suchkennung (`d`). Der
 * Knoten legt den Kopplungscode damit verschlüsselt in ein Event (Kind 38076, signiert von ihm,
 * Ablauf nach NIP-40). Wer das Event mitliest, muss für jeden der 2^60 Codes 600 000 Runden rechnen
 * – auch um es überhaupt einem Code zuzuordnen, denn die Suchkennung kommt aus derselben Rechnung.
 *
 * Gekoppelt wird nur, wenn der entschlüsselte Kopplungscode den Autor des Events als Knoten nennt:
 * Wer das Event unter eigenem Schlüssel wiederholt, bekommt nichts Gültiges.
 */
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { KIND_LOESCHUNG } from "./coverage.js";
import { nip44MitSchluessel, nip44OeffnenMitSchluessel } from "./dm.js";
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag, verifyEvent } from "./event.js";
import { type Kopplung, kopplungscode, leseKopplungscode } from "./kopplung.js";

export const KIND_KURZCODE = 38076;
/** So lange gilt ein Code (Sekunden). */
export const KURZCODE_GUELTIG = 600;
export const KURZCODE_RUNDEN = 600_000;
const SALZ = "freedomstack-kurzcode-v1";
/** Crockford-Base32: ohne I, L, O, U – beim Abtippen verwechselt man nichts. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Ein neuer Code: zwölf Zeichen in drei Vierern (60 Bit). */
export function neuerKurzcode(): string {
  const b = randomBytes(12);
  const zeichen = [...b].map((x) => ALPHABET[x & 31]!).join("");
  return `${zeichen.slice(0, 4)}-${zeichen.slice(4, 8)}-${zeichen.slice(8)}`;
}

/** Eingabe lesen wie Crockford: Groß/klein egal, Striche und Leerzeichen egal, I/L → 1, O → 0. Sonst null. */
export function leseKurzcode(text: string): string | null {
  const roh = text.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (roh.length !== 12 || [...roh].some((z) => !ALPHABET.includes(z))) return null;
  return `${roh.slice(0, 4)}-${roh.slice(4, 8)}-${roh.slice(8)}`;
}

/** Schlüssel und Suchkennung aus dem Code – WebCrypto, wo vorhanden (schneller), sonst `@noble/hashes`; dasselbe Ergebnis. */
export async function kurzcodeAbleitung(code: string): Promise<{ schluessel: Uint8Array; suche: string }> {
  const c = leseKurzcode(code);
  if (!c) throw new Error("Kurzcode ungültig");
  const passwort = new TextEncoder().encode(c.replace(/-/g, ""));
  const salz = new TextEncoder().encode(SALZ);
  const subtle = globalThis.crypto?.subtle;
  let roh: Uint8Array;
  if (subtle) {
    const k = await subtle.importKey("raw", passwort, "PBKDF2", false, ["deriveBits"]);
    roh = new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salz, iterations: KURZCODE_RUNDEN }, k, 512));
  } else {
    roh = await pbkdf2Async(sha256, passwort, salz, { c: KURZCODE_RUNDEN, dkLen: 64 });
  }
  return { schluessel: roh.slice(0, 32), suche: bytesToHex(roh.slice(32)) };
}

/** Das Event des Knotens (unsigniert): adressierbar unter der Suchkennung, Ablauf nach `KURZCODE_GUELTIG`. */
export async function baueKurzcodeEvent(p: { kopplung: Kopplung; code: string; jetzt: number }): Promise<UnsignedEvent> {
  const { schluessel, suche } = await kurzcodeAbleitung(p.code);
  return {
    kind: KIND_KURZCODE, pubkey: p.kopplung.knoten, created_at: p.jetzt,
    tags: [["d", suche], ["expiration", String(p.jetzt + KURZCODE_GUELTIG)]],
    content: await nip44MitSchluessel(kopplungscode(p.kopplung), schluessel),
  };
}

/**
 * Die Kopplung aus einem gefundenen Event – nur bei gültiger Signatur, passender Suchkennung, nicht
 * abgelaufen (und nicht länger gültig als erlaubt), entschlüsselbar und mit dem Autor als Knoten. Sonst null.
 */
export async function leseKurzcodeEvent(
  ev: NostrEvent, ableitung: { schluessel: Uint8Array; suche: string }, jetzt: number,
): Promise<Kopplung | null> {
  if (ev.kind !== KIND_KURZCODE || getTag(ev, "d") !== ableitung.suche || !verifyEvent(ev)) return null;
  const bis = Number(getTag(ev, "expiration"));
  if (!Number.isInteger(bis) || bis <= jetzt || bis > ev.created_at + KURZCODE_GUELTIG) return null;
  let text: string;
  try {
    text = await nip44OeffnenMitSchluessel(ev.content, ableitung.schluessel);
  } catch {
    return null;
  }
  const k = leseKopplungscode(text);
  return k && k.knoten === ev.pubkey ? k : null;
}

/** Tag im versiegelten Kern der Statusabfrage, mit der die App den Code einlöst – der Knoten löscht dann das Event. */
export const KURZCODE_TAG = "kurzcode";

/** Löschwunsch (NIP-09) für das Event eines Codes – nach dem Einlösen oder der Frist; Relays mit NIP-40 verwerfen es ohnehin. */
export function baueKurzcodeLoeschung(ev: Pick<NostrEvent, "id" | "pubkey" | "tags">, jetzt?: number): UnsignedEvent {
  const d = getTag(ev as NostrEvent, "d") ?? "";
  return buildEvent(ev.pubkey, KIND_LOESCHUNG, [["e", ev.id], ["a", `${KIND_KURZCODE}:${ev.pubkey}:${d}`], ["k", String(KIND_KURZCODE)]], "", jetzt);
}
