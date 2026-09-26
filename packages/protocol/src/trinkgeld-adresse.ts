/**
 * Adresse fuer ein SOL-Trinkgeld versiegelt anfragen (Schritt 4.9d).
 *
 * Bis 4.9 las die App die Adresse aus dem oeffentlichen Profil (Feld `sol`) –
 * jedes Trinkgeld dorthin war fuer jeden mit dem Empfaenger verknuepft, und
 * alle Trinkgelder landeten auf derselben Adresse. Jetzt fragt der Geber im
 * Umschlag (NIP-59) an, und die App des Empfaengers antwortet ebenso
 * versiegelt mit einer eigenen Adresse fuer genau diesen Kontakt.
 *
 *   Anfrage  innen Kind 25020, von der Identitaet des Gebers an die des
 *            Empfaengers: ["p", empfaenger], ["kette", "solana:…"]
 *   Antwort  innen Kind 25021: ["e", anfrage], ["p", geber],
 *            ["sol_address", …], ["kette", …]
 *
 * Kein Zeitversatz: Der Geber wartet. Relays sehen nur, dass zwei Schluessel
 * Post bekommen.
 */
import { computeEventId, type NostrEvent, type UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

export const KIND_ADRESS_ANFRAGE = 25020;
export const KIND_ADRESS_ANTWORT = 25021;

const HEX64 = /^[0-9a-f]{64}$/;
const KETTE = /^solana:(mainnet|devnet|testnet)$/;
const SOL_ADRESSE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const tag = (ev: UnsignedEvent, n: string) => ev.tags.find((t) => t[0] === n)?.[1];

function kernOk(inner: UnsignedEvent | undefined, kind: number, absender: string | undefined): inner is UnsignedEvent {
  return !!inner && inner.kind === kind && inner.pubkey === absender
    && Array.isArray(inner.tags) && inner.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))
    && Number.isSafeInteger(inner.created_at);
}

/** Anfrage des Gebers an den Empfaenger. */
export async function buildAdressAnfrage(p: { von: Signer; anPk: string; kette: string; nowSecs?: number }): Promise<{ wrap: NostrEvent; anfrageId: string }> {
  if (!HEX64.test(p.anPk)) throw new Error("Empfänger ungültig");
  if (!KETTE.test(p.kette)) throw new Error("Kette ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = { pubkey: p.von.publicKey(), kind: KIND_ADRESS_ANFRAGE, created_at: now, tags: [["p", p.anPk], ["kette", p.kette]], content: "" };
  const wrap = await giftWrapMitSigner(kern, p.von, p.anPk, { fixedJitter: 0, nowSecs: now });
  return { wrap, anfrageId: computeEventId(kern) };
}

/** Anfrage als Empfaenger oeffnen; null, wenn der Umschlag keine ist. */
export async function oeffneAdressAnfrage(wrap: NostrEvent, signer: Signer): Promise<{ von: string; anfrageId: string; kette: string; zeit: number } | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !kernOk(r.inner, KIND_ADRESS_ANFRAGE, r.senderPubkey)) return null;
  const kette = tag(r.inner, "kette") ?? "";
  if (!KETTE.test(kette)) return null;
  return { von: r.inner.pubkey, anfrageId: computeEventId(r.inner), kette, zeit: r.inner.created_at };
}

/** Antwort des Empfaengers mit einer Adresse nur fuer diesen Geber. */
export async function buildAdressAntwort(p: {
  von: Signer; anPk: string; anfrageId: string; adresse: string; kette: string; nowSecs?: number;
}): Promise<NostrEvent> {
  if (!HEX64.test(p.anPk) || !HEX64.test(p.anfrageId)) throw new Error("Geber oder Anfrage ungültig");
  if (!SOL_ADRESSE.test(p.adresse) || !KETTE.test(p.kette)) throw new Error("Adresse oder Kette ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.von.publicKey(), kind: KIND_ADRESS_ANTWORT, created_at: now,
    tags: [["e", p.anfrageId], ["p", p.anPk], ["sol_address", p.adresse], ["kette", p.kette]], content: "",
  };
  return giftWrapMitSigner(kern, p.von, p.anPk, { fixedJitter: 0, nowSecs: now });
}

/** Antwort als Geber oeffnen – nur vom gefragten Empfaenger und nur zur eigenen Anfrage. */
export async function oeffneAdressAntwort(
  wrap: NostrEvent, signer: Signer, erwartet: { vonPk: string; anfrageId: string },
): Promise<{ adresse: string; kette: string } | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !kernOk(r.inner, KIND_ADRESS_ANTWORT, r.senderPubkey)) return null;
  if (r.inner.pubkey !== erwartet.vonPk || tag(r.inner, "e") !== erwartet.anfrageId) return null;
  const adresse = tag(r.inner, "sol_address") ?? "";
  const kette = tag(r.inner, "kette") ?? "";
  if (!SOL_ADRESSE.test(adresse) || !KETTE.test(kette)) return null;
  return { adresse, kette };
}
