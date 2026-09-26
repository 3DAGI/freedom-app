/**
 * Swap-Anfragen und -Antworten versiegelt (Schritt 4.9).
 *
 * Bis 4.9 standen Anfrage (Kind 25001) und Antwort (Kind 25002) offen auf den
 * Relays: in der Hinrichtung die SOL-Empfangsadresse neben dem npub, in der
 * Gegenrichtung die Lightning-Rechnung; die Antwort nannte Swap-ID und
 * Rechnung des LP – ueber die Swap-ID findet jeder die Sperre auf der Kette
 * und damit die Adresse des Kunden.
 *
 * Jetzt liegt dieselbe Anfrage als Kern in einem Umschlag (NIP-59) an den LP,
 * versiegelt von einem Wegwerf-Schluessel des Kunden; die Antwort geht ebenso
 * versiegelt an diesen Schluessel zurueck. Relays sehen nur, dass der LP und
 * ein unbekannter Schluessel Post bekommen.
 *
 * Kein Zeitversatz auf den Umschlaegen: Anfrage und Antwort sind eilig (der LP
 * liest die letzte Stunde, Fristen laufen). Der Zeitpunkt bleibt sichtbar –
 * wer schreibt und was, nicht.
 *
 * Tags und Inhalt des Kerns sind dieselben wie in der offenen Fassung; der LP
 * bearbeitet beide gleich (offen nur noch fuer aeltere Apps).
 */
import { computeEventId, type NostrEvent, type UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

export const KIND_SWAP_ANFRAGE = 25001;
export const KIND_SWAP_ANTWORT = 25002;

const HEX64 = /^[0-9a-f]{64}$/;
/** Genug fuer eine Rechnung und Tags; alles darueber ist keine Swap-Nachricht. */
const MAX_INHALT = 5000;

/** Eine geoeffnete Anfrage: der Kern samt berechneter ID (fuer ["e", …] der Antwort). */
export type SwapAnfrage = UnsignedEvent & { id: string };

function kernPruefen(kern: UnsignedEvent, kind: number, absender: string | undefined): boolean {
  return kern.kind === kind
    && kern.pubkey === absender
    && Array.isArray(kern.tags)
    && kern.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))
    && typeof kern.content === "string"
    && kern.content.length <= MAX_INHALT
    && Number.isSafeInteger(kern.created_at);
}

/**
 * Anfrage an den LP versiegeln. `tags` wie in der offenen Anfrage (ohne
 * ["p"] – der Empfaenger steht davor). Der Absender sollte ein
 * Wegwerf-Schluessel sein, nie die eigene Identitaet.
 */
export async function versiegleSwapAnfrage(p: {
  tags: string[][]; kunde: Signer; lpPk: string; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; anfrageId: string }> {
  if (!HEX64.test(p.lpPk)) throw new Error("LP-Pubkey ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.kunde.publicKey(), kind: KIND_SWAP_ANFRAGE, created_at: now,
    tags: [["p", p.lpPk], ...p.tags.filter((t) => t[0] !== "p")], content: "",
  };
  const wrap = await giftWrapMitSigner(kern, p.kunde, p.lpPk, { fixedJitter: 0, nowSecs: now });
  return { wrap, anfrageId: computeEventId(kern) };
}

/** Umschlag als LP oeffnen; null, wenn er keine Swap-Anfrage enthaelt. */
export async function oeffneSwapAnfrage(wrap: NostrEvent, lp: Signer): Promise<SwapAnfrage | null> {
  const r = await giftUnwrapMitSigner(wrap, lp);
  if (!r.ok || !r.inner || !kernPruefen(r.inner, KIND_SWAP_ANFRAGE, r.senderPubkey)) return null;
  return { ...r.inner, id: computeEventId(r.inner) };
}

/** Antwort des LP versiegelt an den Schluessel, der angefragt hat. */
export async function versiegleSwapAntwort(p: {
  lp: Signer; kundePk: string; anfrageId: string; tags: string[][]; content: string; nowSecs?: number;
}): Promise<NostrEvent> {
  if (!HEX64.test(p.kundePk) || !HEX64.test(p.anfrageId)) throw new Error("Kunde oder Anfrage ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.lp.publicKey(), kind: KIND_SWAP_ANTWORT, created_at: now,
    tags: [["e", p.anfrageId], ["p", p.kundePk], ...p.tags.filter((t) => t[0] !== "e" && t[0] !== "p")],
    content: p.content,
  };
  return giftWrapMitSigner(kern, p.lp, p.kundePk, { fixedJitter: 0, nowSecs: now });
}

/**
 * Antwort als Kunde oeffnen – nur vom erwarteten LP und nur zur eigenen
 * Anfrage. Eine fremde „Antwort“ (etwa eine untergeschobene Rechnung) ergibt null.
 */
export async function oeffneSwapAntwort(
  wrap: NostrEvent, kunde: Signer, erwartet: { lpPk: string; anfrageId: string },
): Promise<UnsignedEvent | null> {
  const r = await giftUnwrapMitSigner(wrap, kunde);
  if (!r.ok || !r.inner || !kernPruefen(r.inner, KIND_SWAP_ANTWORT, r.senderPubkey)) return null;
  if (r.inner.pubkey !== erwartet.lpPk) return null;
  if (r.inner.tags.find((t) => t[0] === "e")?.[1] !== erwartet.anfrageId) return null;
  return r.inner;
}
