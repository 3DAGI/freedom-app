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
 *
 * DIE REKLAMATION (Schritt 3.4)
 * Eine Reklamation (Kind 38072) nennt Auftrag, Grund, Betrag und eine Notiz.
 * Sie geht nur versiegelt hinaus: je ein Umschlag an den Provider und an einen
 * Pruefer, den der Kunde waehlt – vom Sitzungsschluessel, wie der Auftrag.
 */
import { type NostrEvent, type UnsignedEvent, computeEventId, getTag, verifyEvent } from "./event.js";
import { KIND_GIFT_WRAP, giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import { KIND_JOB_DISPUTE } from "./disputes-relays.js";
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

/** Empfaenger einer Reklamation: der Provider und hoechstens ein Pruefer. */
export const MAX_REKLAMATION_EMPFAENGER = 2;

/**
 * Reklamation versiegeln (Schritt 3.4): je ein Umschlag an den beschuldigten
 * Provider und an den Pruefer, jeder mit der Rechenarbeit aus dessen Angebot.
 * Auf den Relays steht kein Grund, kein Betrag, keine Notiz und nicht, wer
 * reklamiert.
 */
export async function buildPrivateDispute(p: {
  dispute: UnsignedEvent;
  sessionSigner: Signer;
  empfaenger: ReadonlyArray<{ pk: string; powBits?: number }>;
  nowSecs?: number;
}): Promise<{ wraps: NostrEvent[]; disputeId: string }> {
  if (p.dispute.kind !== KIND_JOB_DISPUTE) throw new Error(`Keine Reklamation: Kind ${p.dispute.kind}`);
  const selbst = p.sessionSigner.publicKey();
  if (p.dispute.pubkey !== selbst) throw new Error("Reklamation gehört nicht zum Sitzungsschlüssel");
  const pks = p.empfaenger.map((e) => e.pk);
  if (pks.length < 1 || pks.length > MAX_REKLAMATION_EMPFAENGER) {
    throw new Error(`Reklamation an 1–${MAX_REKLAMATION_EMPFAENGER} Empfänger, nicht ${pks.length}`);
  }
  if (new Set(pks).size !== pks.length) throw new Error("Empfänger doppelt");
  for (const e of p.empfaenger) {
    if (!HEX64.test(e.pk)) throw new Error("Empfänger-Pubkey ungültig (64 Zeichen hex erwartet)");
    const bits = e.powBits ?? 0;
    if (!Number.isInteger(bits) || bits < 0 || bits > MAX_POW_BITS) throw new Error(`Rechenarbeit ${bits} außerhalb 0–${MAX_POW_BITS}`);
  }
  if (pks.includes(selbst)) throw new Error("Wer reklamiert, prüft nicht selbst");
  const provider = p.dispute.tags.find((t) => t[0] === "p")?.[1];
  if (!provider || !pks.includes(provider)) throw new Error("Der Provider muss die Reklamation bekommen");
  const wraps: NostrEvent[] = [];
  for (const e of p.empfaenger) {
    wraps.push(await giftWrapMitSigner(p.dispute, p.sessionSigner, e.pk, { fixedJitter: 0, nowSecs: p.nowSecs, powBits: e.powBits ?? 0 }));
  }
  return { wraps, disputeId: computeEventId(p.dispute) };
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

/**
 * Wie openPrivateJobRequest, nimmt aber auch Sitzung (38021) und Belege
 * (38022) an (Schritt 3.2) sowie Reklamationen (38072, Schritt 3.4) – auch als
 * Pruefer, an den der Umschlag geht.
 */
export async function openPrivateKundenEvent(
  wrap: NostrEvent,
  providerSigner: Signer,
  minPowBits = 0,
): Promise<GeoeffneterJob> {
  return oeffneVomKunden(
    wrap, providerSigner, minPowBits,
    (k) => isDvmRequest(k) || istSitzungsEvent(k) || k === KIND_JOB_DISPUTE,
    "Weder Anfrage noch Sitzungs-Event noch Reklamation",
  );
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
