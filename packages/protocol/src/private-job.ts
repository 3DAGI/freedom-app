/**
 * Private KI-Auftraege (Schritt 3.1).
 *
 * DAS PROBLEM
 * Eine KI-Anfrage (Kind 5xxx) stand bisher offen auf den Relays: der Prompt im
 * i-Tag, der Kunde als Autor. Jeder Relay-Betreiber konnte mitlesen, wer was
 * fragt – ueber Monate, mit Zeitstempel.
 *
 * WAS HIER GEBAUT IST
 * Die Anfrage bleibt ein gewoehnliches Kind-5xxx-Event, reist aber als Kern in
 * einem Umschlag (NIP-59) an den Provider:
 * - versiegelt vom **Sitzungsschluessel** des Kunden, nicht von seiner
 *   Identitaet – der Provider sieht nur einen Schluessel pro KI-Sitzung;
 * - Relays sehen einen Wegwerf-Autor, den p-Tag des Providers und Chiffrat;
 * - gegen Spam traegt der Umschlag Rechenarbeit (NIP-13); die Schwierigkeit
 *   legt der Provider in seinem Angebot fest (`pow`-Tag, siehe tiers.ts).
 *
 * Der Umschlag bekommt keinen Zeitversatz: Der Provider abonniert nur die
 * juengste Zeit, und die Empfangszeit sieht das Relay ohnehin.
 *
 * DIE ANTWORT (Schritt 3.2)
 * Ergebnis (Kind 6xxx) samt Betrag, Rechnung, SOL-Adresse und usage sowie
 * Rueckmeldungen (Kind 7000) gehen genauso zurueck: als Kern im Umschlag an
 * den Sitzungsschluessel, versiegelt vom Provider. Relays sehen weder Antwort
 * noch Betrag noch, an wen sie geht.
 */
import { type NostrEvent, type UnsignedEvent, computeEventId, getTag, verifyEvent } from "./event.js";
import { KIND_GIFT_WRAP, giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import { KIND_DVM_FEEDBACK, KIND_SESSION_OPEN, KIND_SESSION_PAYMENT, isDvmRequest, isDvmResult } from "./kinds.js";
import { eventDifficulty } from "./pow.js";
import type { Signer } from "./signer.js";

const HEX64 = /^[0-9a-f]{64}$/;
/** Obergrenze fuer die verlangte Rechenarbeit – darueber rechnet ein Handy zu lange. */
export const MAX_POW_BITS = 24;

export interface PrivateJobInput {
  /** Die Anfrage (Kind 5xxx), Autor = Sitzungsschluessel. */
  request: UnsignedEvent;
  sessionSigner: Signer;
  providerPk: string;
  /** Rechenarbeit laut Angebot des Providers. */
  powBits?: number;
  nowSecs?: number;
}

/** Anfrage versiegeln und in einen Umschlag an den Provider packen. */
export async function buildPrivateJobRequest(p: PrivateJobInput): Promise<{ wrap: NostrEvent; requestId: string }> {
  if (!isDvmRequest(p.request.kind)) throw new Error(`Keine Job-Anfrage: Kind ${p.request.kind}`);
  if (!HEX64.test(p.providerPk)) throw new Error("Provider-Pubkey ungültig (64 Zeichen hex erwartet)");
  if (p.request.pubkey !== p.sessionSigner.publicKey()) throw new Error("Anfrage gehört nicht zum Sitzungsschlüssel");
  const bits = p.powBits ?? 0;
  if (!Number.isInteger(bits) || bits < 0 || bits > MAX_POW_BITS) throw new Error(`Rechenarbeit ${bits} außerhalb 0–${MAX_POW_BITS}`);
  const wrap = await giftWrapMitSigner(p.request, p.sessionSigner, p.providerPk, {
    fixedJitter: 0, nowSecs: p.nowSecs, powBits: bits,
  });
  return { wrap, requestId: computeEventId(p.request) };
}

/** Sitzung (38021) und Belege (38022) des Kunden – seit 3.2 ebenfalls nur versiegelt. */
function istSitzungsEvent(kind: number): boolean {
  return kind === KIND_SESSION_OPEN || kind === KIND_SESSION_PAYMENT;
}

/**
 * Sitzungseroeffnung oder Beleg versiegelt an den Provider (Schritt 3.2) –
 * Budget, Rate und bezahlte Summen stehen dann in keinem oeffentlichen Event.
 */
export async function buildPrivateSessionEvent(p: {
  event: UnsignedEvent; sessionSigner: Signer; providerPk: string; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; eventId: string }> {
  if (!istSitzungsEvent(p.event.kind)) throw new Error(`Kein Sitzungs-Event: Kind ${p.event.kind}`);
  if (!HEX64.test(p.providerPk)) throw new Error("Provider-Pubkey ungültig (64 Zeichen hex erwartet)");
  if (p.event.pubkey !== p.sessionSigner.publicKey()) throw new Error("Event gehört nicht zum Sitzungsschlüssel");
  const bits = p.powBits ?? 0;
  if (!Number.isInteger(bits) || bits < 0 || bits > MAX_POW_BITS) throw new Error(`Rechenarbeit ${bits} außerhalb 0–${MAX_POW_BITS}`);
  const wrap = await giftWrapMitSigner(p.event, p.sessionSigner, p.providerPk, { fixedJitter: 0, nowSecs: p.nowSecs, powBits: bits });
  return { wrap, eventId: computeEventId(p.event) };
}

export type GeoeffneterJob =
  | { ok: true; request: UnsignedEvent & { id: string }; kundePk: string; powBits: number }
  | { ok: false; grund: string };

/**
 * Umschlag als Provider oeffnen. Guenstiges zuerst: Form, Signatur und
 * Rechenarbeit werden geprueft, bevor irgendetwas entschluesselt wird.
 * Nur Anfragen (5xxx).
 */
export async function openPrivateJobRequest(
  wrap: NostrEvent,
  providerSigner: Signer,
  minPowBits = 0,
): Promise<GeoeffneterJob> {
  return oeffneVomKunden(wrap, providerSigner, minPowBits, isDvmRequest, "Keine Job-Anfrage");
}

/** Wie openPrivateJobRequest, nimmt aber auch Sitzung (38021) und Belege (38022) an (Schritt 3.2). */
export async function openPrivateKundenEvent(
  wrap: NostrEvent,
  providerSigner: Signer,
  minPowBits = 0,
): Promise<GeoeffneterJob> {
  return oeffneVomKunden(wrap, providerSigner, minPowBits, (k) => isDvmRequest(k) || istSitzungsEvent(k), "Weder Anfrage noch Sitzungs-Event");
}

async function oeffneVomKunden(
  wrap: NostrEvent,
  providerSigner: Signer,
  minPowBits: number,
  erlaubt: (kind: number) => boolean,
  fehltext: string,
): Promise<GeoeffneterJob> {
  if (wrap.kind !== KIND_GIFT_WRAP) return { ok: false, grund: "Kein Umschlag" };
  if (getTag(wrap, "p") !== providerSigner.publicKey()) return { ok: false, grund: "Umschlag nicht an diesen Provider" };
  if (!verifyEvent(wrap)) return { ok: false, grund: "Umschlag-Signatur ungültig" };
  const bits = eventDifficulty(wrap);
  if (bits < minPowBits) return { ok: false, grund: `Zu wenig Rechenarbeit: ${bits} statt ${minPowBits} Bits` };
  const r = await giftUnwrapMitSigner(wrap, providerSigner);
  if (!r.ok || !r.inner || !r.senderPubkey) return { ok: false, grund: r.message };
  // Der Kern ist fremdes JSON: nur die bekannten Felder, jedes mit Typ geprueft.
  const k = r.inner as Partial<UnsignedEvent>;
  const form = Number.isInteger(k.kind) && Number.isInteger(k.created_at) && typeof k.content === "string"
    && Array.isArray(k.tags) && k.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"));
  if (!form) return { ok: false, grund: "Anfrage beschädigt" };
  if (!erlaubt(k.kind!)) return { ok: false, grund: `${fehltext}: Kind ${k.kind}` };
  const request: UnsignedEvent = {
    pubkey: r.senderPubkey, created_at: k.created_at!, kind: k.kind!, tags: k.tags!, content: k.content!,
  };
  return { ok: true, request: { ...request, id: computeEventId(request) }, kundePk: r.senderPubkey, powBits: bits };
}

/** Was ein Provider privat zuruecksendet: Ergebnis oder Rueckmeldung. */
function istAntwort(kind: number): boolean {
  return isDvmResult(kind) || kind === KIND_DVM_FEEDBACK;
}

export interface PrivateJobResponseInput {
  /** Ergebnis (Kind 6xxx) oder Rueckmeldung (7000), Autor = Provider. */
  response: UnsignedEvent;
  providerSigner: Signer;
  /** Sitzungsschluessel des Kunden – aus der geoeffneten Anfrage. */
  sessionPk: string;
  nowSecs?: number;
}

/** Antwort des Providers versiegeln und an den Sitzungsschluessel packen (Schritt 3.2). */
export async function buildPrivateJobResponse(p: PrivateJobResponseInput): Promise<{ wrap: NostrEvent; responseId: string }> {
  if (!istAntwort(p.response.kind)) throw new Error(`Keine Antwort: Kind ${p.response.kind}`);
  if (!HEX64.test(p.sessionPk)) throw new Error("Sitzungsschlüssel ungültig (64 Zeichen hex erwartet)");
  if (p.response.pubkey !== p.providerSigner.publicKey()) throw new Error("Antwort gehört nicht zum Provider");
  const wrap = await giftWrapMitSigner(p.response, p.providerSigner, p.sessionPk, { fixedJitter: 0, nowSecs: p.nowSecs });
  return { wrap, responseId: computeEventId(p.response) };
}

export type GeoeffneteAntwort =
  | { ok: true; response: UnsignedEvent & { id: string }; providerPk: string }
  | { ok: false; grund: string };

/** Umschlag mit einer Antwort als Kunde (Sitzungsschluessel) oeffnen – gleiche Pruefungen wie beim Provider. */
export async function openPrivateJobResponse(wrap: NostrEvent, sessionSigner: Signer): Promise<GeoeffneteAntwort> {
  if (wrap.kind !== KIND_GIFT_WRAP) return { ok: false, grund: "Kein Umschlag" };
  if (getTag(wrap, "p") !== sessionSigner.publicKey()) return { ok: false, grund: "Umschlag nicht an diese Sitzung" };
  if (!verifyEvent(wrap)) return { ok: false, grund: "Umschlag-Signatur ungültig" };
  const r = await giftUnwrapMitSigner(wrap, sessionSigner);
  if (!r.ok || !r.inner || !r.senderPubkey) return { ok: false, grund: r.message };
  const k = r.inner as Partial<UnsignedEvent>;
  const form = Number.isInteger(k.kind) && Number.isInteger(k.created_at) && typeof k.content === "string"
    && Array.isArray(k.tags) && k.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"));
  if (!form) return { ok: false, grund: "Antwort beschädigt" };
  if (!istAntwort(k.kind!)) return { ok: false, grund: `Keine Antwort: Kind ${k.kind}` };
  const response: UnsignedEvent = {
    pubkey: r.senderPubkey, created_at: k.created_at!, kind: k.kind!, tags: k.tags!, content: k.content!,
  };
  return { ok: true, response: { ...response, id: computeEventId(response) }, providerPk: r.senderPubkey };
}
