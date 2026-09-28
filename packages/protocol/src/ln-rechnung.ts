/**
 * Lightning-Rechnung versiegelt bei einem Kontakt erfragen (Schritt 6.3b).
 *
 * Seit 6.3a steht die Lightning-Adresse nur noch auf Wunsch im öffentlichen
 * Profil – ohne sie gibt es kein Ziel für NIP-57. Stattdessen fragt der Zahler
 * im Umschlag (NIP-59) nach einer Rechnung über einen Betrag; die App des
 * Empfängers stellt sie mit seiner eigenen Wallet aus (NWC `make_invoice`) und
 * antwortet ebenso versiegelt. Kein LNURL-Dienst, keine Quittung auf einem
 * Relay, keine Rechnung offen neben einer Identität.
 *
 *   Anfrage  innen Kind 25022, von der Identität des Zahlers an die des
 *            Empfängers: ["p", empfaenger], ["amount", msat]
 *   Antwort  innen Kind 25023: ["e", anfrage], ["p", zahler], ["bolt11", …]
 *
 * Der Zahler prüft die Rechnung vor dem Zahlen: Signatur und Betrag genau wie
 * erfragt (das Netz prüft seine Wallet). Wem der Knoten gehört, weiß er nicht –
 * belegt ist eine solche Zahlung nach 4.8 nicht, nur angekündigt.
 */
import { leseBolt11 } from "./bolt11.js";
import { computeEventId, type NostrEvent, type UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

export const KIND_RECHNUNGS_ANFRAGE = 25022;
export const KIND_RECHNUNGS_ANTWORT = 25023;
/** Höchstens 0,1 BTC je Rechnung – größere Beträge nicht über eine Chat-Anfrage. */
export const RECHNUNG_MAX_MSAT = 10_000_000_000;

const HEX64 = /^[0-9a-f]{64}$/;
const tag = (ev: UnsignedEvent, n: string) => ev.tags.find((t) => t[0] === n)?.[1];

function kernOk(inner: UnsignedEvent | undefined, kind: number, absender: string | undefined): inner is UnsignedEvent {
  return !!inner && inner.kind === kind && inner.pubkey === absender
    && Array.isArray(inner.tags) && inner.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))
    && Number.isSafeInteger(inner.created_at);
}

/** Ganze sats, mindestens 1, höchstens `RECHNUNG_MAX_MSAT`. */
export function rechnungsBetragOk(msat: number): boolean {
  return Number.isSafeInteger(msat) && msat >= 1000 && msat <= RECHNUNG_MAX_MSAT && msat % 1000 === 0;
}

/** Anfrage des Zahlers an den Empfänger. */
export async function buildRechnungsAnfrage(p: { von: Signer; anPk: string; betragMsat: number; nowSecs?: number }): Promise<{ wrap: NostrEvent; anfrageId: string }> {
  if (!HEX64.test(p.anPk)) throw new Error("Empfänger ungültig");
  if (!rechnungsBetragOk(p.betragMsat)) throw new Error("Betrag ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.von.publicKey(), kind: KIND_RECHNUNGS_ANFRAGE, created_at: now,
    tags: [["p", p.anPk], ["amount", String(p.betragMsat)]], content: "",
  };
  const wrap = await giftWrapMitSigner(kern, p.von, p.anPk, { fixedJitter: 0, nowSecs: now });
  return { wrap, anfrageId: computeEventId(kern) };
}

/** Anfrage als Empfänger öffnen; null, wenn der Umschlag keine (gültige) ist. */
export async function oeffneRechnungsAnfrage(wrap: NostrEvent, signer: Signer): Promise<{ von: string; anfrageId: string; betragMsat: number; zeit: number } | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !kernOk(r.inner, KIND_RECHNUNGS_ANFRAGE, r.senderPubkey)) return null;
  const roh = tag(r.inner, "amount") ?? "";
  const betragMsat = /^\d{1,16}$/.test(roh) ? Number(roh) : NaN;
  if (!rechnungsBetragOk(betragMsat)) return null;
  return { von: r.inner.pubkey, anfrageId: computeEventId(r.inner), betragMsat, zeit: r.inner.created_at };
}

/** Antwort des Empfängers mit einer Rechnung seiner eigenen Wallet. */
export async function buildRechnungsAntwort(p: { von: Signer; anPk: string; anfrageId: string; bolt11: string; nowSecs?: number }): Promise<NostrEvent> {
  if (!HEX64.test(p.anPk) || !HEX64.test(p.anfrageId)) throw new Error("Zahler oder Anfrage ungültig");
  leseBolt11(p.bolt11); // wirft bei allem, was keine gültige Rechnung ist
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.von.publicKey(), kind: KIND_RECHNUNGS_ANTWORT, created_at: now,
    tags: [["e", p.anfrageId], ["p", p.anPk], ["bolt11", p.bolt11.trim()]], content: "",
  };
  return giftWrapMitSigner(kern, p.von, p.anPk, { fixedJitter: 0, nowSecs: now });
}

/**
 * Antwort als Zahler öffnen – nur vom gefragten Empfänger, nur zur eigenen
 * Anfrage, und nur eine gültige Rechnung über genau den erfragten Betrag.
 */
export async function oeffneRechnungsAntwort(
  wrap: NostrEvent, signer: Signer, erwartet: { vonPk: string; anfrageId: string; betragMsat: number },
): Promise<{ bolt11: string } | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !kernOk(r.inner, KIND_RECHNUNGS_ANTWORT, r.senderPubkey)) return null;
  if (r.inner.pubkey !== erwartet.vonPk || tag(r.inner, "e") !== erwartet.anfrageId) return null;
  const bolt11 = tag(r.inner, "bolt11") ?? "";
  try {
    const b = leseBolt11(bolt11);
    if (b.betragMsat !== erwartet.betragMsat) return null;
  } catch {
    return null;
  }
  return { bolt11 };
}
