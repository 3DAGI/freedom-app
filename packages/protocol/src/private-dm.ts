/**
 * Private Direktnachrichten nach NIP-17 (Schritt 2.1 im Ausbauplan).
 *
 * Aufbau: Kind 14 (Inhalt, unsigniert) -> Seal Kind 13 (vom Absender signiert,
 * NIP-44-verschluesselt) -> Gift-Wrap Kind 1059 (mit Wegwerfschluessel
 * signiert, an den Empfaenger adressiert). Relays sehen nur, dass ein
 * Posteingang Post bekommt – nicht, wer schreibt, und keinen Inhalt. Die
 * Zeitstempel von Seal und Umschlag sind zufaellig bis zu zwei Tage
 * zurueckdatiert.
 *
 * Der Absender verpackt eine zweite Kopie an sich selbst, damit eigene Geraete
 * den Verlauf sehen. Beide Kopien tragen im Inneren denselben Empfaenger.
 *
 * Grenze: NIP-44 hat keine Forward Secrecy. Wer spaeter den Schluessel stiehlt,
 * kann alte Nachrichten lesen. Das loest erst MLS (Schritt 2.2b).
 */
import { buildEvent, computeEventId, type NostrEvent, type UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner, KIND_GIFT_WRAP, type GiftWrapOptions } from "./gift-wrap.js";
import { LocalSigner, type Signer } from "./signer.js";

export const KIND_PRIVATE_DM = 14;
export const KIND_DM_RELAYS = 10050;

const HEX64 = /^[0-9a-f]{64}$/;

export interface PrivateDmInput {
  /** Mit rohem Schluessel … */
  senderSk?: Uint8Array;
  senderPk?: string;
  /** … oder ueber den Signer (Schritt 1.3) – so auch mit einem entfernten Signer. */
  signer?: Signer;
  recipientPk: string;
  content: string;
  nowSecs?: number;
  wrapOptions?: GiftWrapOptions;
}

export interface PrivateDmOutput {
  /** Umschlag an den Empfaenger – auf dessen Posteingangs-Relays veroeffentlichen. */
  toRecipient: NostrEvent;
  /** Kopie an sich selbst – fuer den eigenen Verlauf auf allen Geraeten. */
  toSelf: NostrEvent;
  /** Stabile ID der Nachricht (des inneren Kind-14-Events). */
  rumorId: string;
}

/** Baut eine private Direktnachricht samt Kopie an sich selbst. */
export async function buildPrivateDm(i: PrivateDmInput): Promise<PrivateDmOutput> {
  if (!HEX64.test(i.recipientPk)) throw new Error("Empfänger muss ein 64-stelliger Hex-Schlüssel sein");
  const signer = signerAus(i.signer, i.senderSk, i.senderPk);
  const senderPk = signer.publicKey();
  if (!HEX64.test(senderPk)) throw new Error("Absender muss ein 64-stelliger Hex-Schlüssel sein");
  const now = i.nowSecs ?? Math.floor(Date.now() / 1000);
  const rumor = buildEvent(senderPk, KIND_PRIVATE_DM, [["p", i.recipientPk]], i.content, now);
  const rumorId = computeEventId(rumor);
  const toRecipient = await giftWrapMitSigner(rumor, signer, i.recipientPk, i.wrapOptions);
  const toSelf = await giftWrapMitSigner(rumor, signer, senderPk, i.wrapOptions);
  return { toRecipient, toSelf, rumorId };
}

/** Signer aus den Angaben: entweder ein Signer oder Schluessel samt passendem Pubkey. */
function signerAus(signer: Signer | undefined, sk: Uint8Array | undefined, pk: string | undefined): Signer {
  if (signer) return signer;
  if (!sk || pk === undefined) throw new Error("Absender fehlt: Signer oder Schlüssel angeben");
  if (!HEX64.test(pk)) throw new Error("Absender muss ein 64-stelliger Hex-Schlüssel sein");
  const lokal = new LocalSigner(sk);
  if (lokal.publicKey() !== pk) throw new Error("Absender-Pubkey passt nicht zum Schlüssel");
  return lokal;
}

export interface PrivateDm {
  /** ID des inneren Events – gleich fuer beide Kopien, gut zum Entdoppeln. */
  id: string;
  from: string;
  /** Die andere Person der Unterhaltung. */
  partner: string;
  createdAt: number;
  content: string;
}

export type OpenResult = { ok: true; dm: PrivateDm } | { ok: false; reason: string };

/**
 * Oeffnet einen Umschlag und prueft Absender, Art und Empfaenger – mit rohem
 * Schluessel (mySk, myPk) oder ueber den Signer (Schritt 1.3).
 */
export async function openPrivateDm(wrap: NostrEvent, mySkOderSigner: Uint8Array | Signer, myPkAngabe?: string): Promise<OpenResult> {
  if (wrap.kind !== KIND_GIFT_WRAP) return { ok: false, reason: "kein Gift-Wrap" };
  const signer = mySkOderSigner instanceof Uint8Array
    ? signerAus(undefined, mySkOderSigner, myPkAngabe)
    : mySkOderSigner;
  const myPk = signer.publicKey();
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !r.inner) return { ok: false, reason: r.message };
  const inner = r.inner as UnsignedEvent;
  if (inner.kind !== KIND_PRIVATE_DM) return { ok: false, reason: `anderer Inhalt (Kind ${inner.kind})` };
  const from = inner.pubkey;
  if (!from || from !== r.senderPubkey) return { ok: false, reason: "Absender nicht belegt" };
  const p = inner.tags.find((t) => t[0] === "p")?.[1];
  if (!p || !HEX64.test(p)) return { ok: false, reason: "kein gültiger Empfänger im Inhalt" };
  if (from !== myPk && p !== myPk) return { ok: false, reason: "Nachricht betrifft mich nicht" };
  const partner = from === myPk ? p : from;
  return {
    ok: true,
    dm: { id: computeEventId(inner), from, partner, createdAt: inner.created_at, content: inner.content },
  };
}

/** Ist diese Relay-Adresse als Posteingang brauchbar? Nur wss://, keine lokalen Netze. */
export function isUsableDmRelay(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "wss:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h === "[::1]" || h === "::1") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

/** Eigene Posteingangs-Relays als Kind 10050 (NIP-17). */
export function buildDmRelayList(pk: string, relays: string[], nowSecs?: number): UnsignedEvent {
  const liste = [...new Set(relays.filter(isUsableDmRelay))].slice(0, 5);
  return buildEvent(pk, KIND_DM_RELAYS, liste.map((r) => ["relay", r]), "", nowSecs);
}

/** Liest eine Kind-10050-Liste; unbrauchbare Adressen fallen weg, hoechstens fuenf. */
export function parseDmRelayList(ev: NostrEvent | undefined | null): string[] {
  if (!ev || ev.kind !== KIND_DM_RELAYS) return [];
  const urls = ev.tags.filter((t) => t[0] === "relay" && typeof t[1] === "string").map((t) => t[1]);
  return [...new Set(urls.filter(isUsableDmRelay))].slice(0, 5);
}
