/**
 * NIP-57 Lightning Zaps.
 *
 * kind 9734 = Zap-Request: wird NICHT auf Relays publiziert, sondern an den
 *             LNURL-Pay-Callback des Empfaengers geschickt.
 * kind 9735 = Zap-Receipt: erzeugt vom Lightning-Knoten nach Zahlung,
 *             publiziert auf die im Request genannten Relays.
 *
 * Wichtige Verbindung zu unserem Swap: Der Zap-Receipt darf laut NIP-57 einen
 * `preimage`-Tag tragen, der zum Payment-Hash der bolt11-Invoice passt. Das ist
 * exakt dieselbe Preimage/Hash-Beziehung wie im HTLC - wir pruefen beides mit
 * derselben Funktion (`verifyPreimage`).
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag } from "./event.js";
import { KIND_ZAP_REQUEST, KIND_ZAP_RECEIPT } from "./kinds.js";
import { verifyPreimage, fromHex } from "./htlc.js";

export interface ZapRequestParams {
  /** Pubkey des Zahlers. */
  senderPubkey: string;
  /** Pubkey des Empfaengers (p-Tag). */
  recipientPubkey: string;
  /** Optionale Event-ID, die gezappt wird (e-Tag) - z. B. ein KI-Ergebnis. */
  eventId?: string;
  /** Betrag in Millisatoshi. */
  amountMsat: number;
  /** Relays, auf die der Receipt publiziert werden soll. */
  relays: string[];
  comment?: string;
}

export function buildZapRequest(p: ZapRequestParams, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["p", p.recipientPubkey],
    ["amount", String(p.amountMsat)],
    // relays MUSS eine flache Liste sein (nicht verschachtelt).
    ["relays", ...p.relays],
  ];
  if (p.eventId) tags.push(["e", p.eventId]);
  return buildEvent(p.senderPubkey, KIND_ZAP_REQUEST, tags, p.comment ?? "", createdAt);
}

export interface ZapReceiptParams {
  /** Pubkey des Zappers (Lightning-Knoten, der den Receipt erzeugt). */
  zapperPubkey: string;
  recipientPubkey: string;
  eventId?: string;
  /** Der Zap-Request als JSON-String (description-Tag). */
  zapRequestJson: string;
  bolt11: string;
  /** Optional: Preimage, hex - erlaubt Zahlungsbeweis. */
  preimageHex?: string;
  senderPubkey?: string;
}

export function buildZapReceipt(p: ZapReceiptParams, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["p", p.recipientPubkey],
    ["bolt11", p.bolt11],
    ["description", p.zapRequestJson],
  ];
  if (p.eventId) tags.push(["e", p.eventId]);
  if (p.senderPubkey) tags.push(["P", p.senderPubkey]);
  if (p.preimageHex) tags.push(["preimage", p.preimageHex]);
  // content SOLL leer sein
  return buildEvent(p.zapperPubkey, KIND_ZAP_RECEIPT, tags, "", createdAt);
}

export interface ParsedZapReceipt {
  recipientPubkey: string;
  senderPubkey?: string;
  eventId?: string;
  amountMsat?: number;
  bolt11: string;
  preimageHex?: string;
}

export function parseZapReceipt(ev: UnsignedEvent): ParsedZapReceipt {
  if (ev.kind !== KIND_ZAP_RECEIPT) throw new Error(`kein Zap-Receipt: ${ev.kind}`);
  const bolt11 = getTag(ev, "bolt11");
  const recipient = getTag(ev, "p");
  if (!bolt11 || !recipient) throw new Error("Zap-Receipt ohne bolt11/p-Tag");

  // Betrag aus dem eingebetteten Zap-Request lesen.
  let amountMsat: number | undefined;
  const desc = getTag(ev, "description");
  if (desc) {
    try {
      const req = JSON.parse(desc) as UnsignedEvent;
      const a = req.tags?.find((t) => t[0] === "amount")?.[1];
      if (a) amountMsat = Number(a);
    } catch { /* description nicht parsebar -> Betrag unbekannt */ }
  }

  return {
    recipientPubkey: recipient,
    senderPubkey: getTag(ev, "P"),
    eventId: getTag(ev, "e"),
    amountMsat,
    bolt11,
    preimageHex: getTag(ev, "preimage"),
  };
}

/**
 * Prueft den Zahlungsbeweis eines Zap-Receipts: passt die offengelegte
 * Preimage zum Payment-Hash der Invoice?
 *
 * Dieselbe Beziehung wie im HTLC - deshalb dieselbe Verifikationsfunktion.
 * (Der Payment-Hash wird hier uebergeben; in Produktion aus der bolt11-Invoice
 * dekodiert.)
 */
export function verifyZapPayment(receipt: ParsedZapReceipt, paymentHashHex: string): boolean {
  if (!receipt.preimageHex) return false;
  try {
    return verifyPreimage(fromHex(receipt.preimageHex), fromHex(paymentHashHex));
  } catch {
    return false;
  }
}

/** Summiert Zap-Betraege pro Empfaenger (Basis fuer Leaderboards). */
export function sumZapsByRecipient(receipts: NostrEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const ev of receipts) {
    try {
      const z = parseZapReceipt(ev);
      if (z.amountMsat === undefined) continue;
      out.set(z.recipientPubkey, (out.get(z.recipientPubkey) ?? 0) + z.amountMsat);
    } catch { /* ungueltige Receipts ignorieren */ }
  }
  return out;
}
