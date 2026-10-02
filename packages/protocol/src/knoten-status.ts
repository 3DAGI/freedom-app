/**
 * Status meines Knotens (Sammlung B-11, Entscheidung L6 A – zuerst nur lesen):
 * Der gekoppelte Besitzer fragt versiegelt und mit Nachweis (B-8), der Knoten
 * antwortet versiegelt an den Sitzungsschlüssel. Die Antwort hat eine feste
 * Form: Zahlen, feste Kennungen und die Namen der angebotenen Modelle – kein
 * Text aus Aufträgen, keine Meldungen, keine Adressen (docs/PROTOCOL.md 24).
 * Steuern (Modelle laden, Neustart, Einstellungen) gehört nicht dazu – das
 * wäre L6 B und eine eigene Entscheidung.
 */
import { KIND_DVM_KNOTEN_STATUS } from "./kinds.js";
import { type Kopplung, mitBesitzerNachweis } from "./kopplung.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";

/** Rollen, die ein Knoten melden kann – feste Kennungen, die App übersetzt sie. */
export const STATUS_ROLLEN = ["ki", "relay", "speicher", "gateway", "zahlkanal", "lnurl", "lp", "relayer", "tor", "app"] as const;
export type StatusRolle = (typeof STATUS_ROLLEN)[number];

/** Grenzen der Antwort – was darüber liegt, liest `leseKnotenStatus()` nicht. */
export const STATUS_GRENZEN = { zeichen: 20_000, modelle: 50, modellZeichen: 100, fassungZeichen: 32 } as const;

export interface KnotenStatus {
  /** Fassung des Knotens (`version` aus `packages/node/package.json`). */
  fassung: string;
  /** Start des Prozesses, Unix-Sekunden. */
  seit: number;
  /** Was gerade läuft – nur Rollen, die gestartet sind. */
  rollen: StatusRolle[];
  /** Angebotene Modelle – Namen, in der App nur als Text. */
  modelle: string[];
  /** Aufträge seit dem Start: erledigt (davon gratis) und abgelehnt; Statusabfragen zählen nicht. */
  auftraege: { erledigt: number; gratis: number; abgelehnt: number };
  /** In Antworten seit dem Start abgerechnet (msat) – verlangt, nicht unbedingt schon bezahlt. */
  abgerechnetMsat: number;
  /** Speicher-Rolle (8.9, B-9b): belegt, Quota (0 = ohne Grenze), für den Besitzer gehaltene Stücke. */
  speicher: { belegtBytes: number; quotaBytes: number; gehalten: number } | null;
  /** Relay-Rolle (8.4): gespeicherte Events und offene Verbindungen. */
  relay: { events: number; verbindungen: number } | null;
}

/** Statusabfrage an den eigenen Knoten – versiegelt, mit Nachweis, ohne Gebot. */
export async function baueStatusAuftrag(p: {
  sitzung: Signer; kopplung: Kopplung; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  const kern = buildJobRequest({
    kind: KIND_DVM_KNOTEN_STATUS, customerPubkey: p.sitzung.publicKey(), input: "status", bidMsat: 0, providerPubkey: p.kopplung.knoten,
  }, p.nowSecs);
  const request = mitBesitzerNachweis(kern, p.kopplung);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.kopplung.knoten, powBits: p.powBits, nowSecs: p.nowSecs });
}

/** Ausgabe für die Antwort des Knotens – nur die bekannten Felder, dasselbe Format, das `leseKnotenStatus()` liest. */
export function knotenStatusText(s: KnotenStatus): string {
  return JSON.stringify({
    fassung: s.fassung,
    seit: s.seit,
    rollen: STATUS_ROLLEN.filter((r) => s.rollen.includes(r)),
    modelle: s.modelle.slice(0, STATUS_GRENZEN.modelle),
    auftraege: { erledigt: s.auftraege.erledigt, gratis: s.auftraege.gratis, abgelehnt: s.auftraege.abgelehnt },
    abgerechnetMsat: s.abgerechnetMsat,
    speicher: s.speicher && { belegtBytes: s.speicher.belegtBytes, quotaBytes: s.speicher.quotaBytes, gehalten: s.speicher.gehalten },
    relay: s.relay && { events: s.relay.events, verbindungen: s.relay.verbindungen },
  });
}

const zahl = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const objekt = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const STEUERZEICHEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Antwort des Knotens streng lesen – sonst null. Unbekannte Felder bleiben
 * unbeachtet (ein neuerer Knoten darf mehr melden), bekannte müssen stimmen.
 */
export function leseKnotenStatus(text: string): KnotenStatus | null {
  if (typeof text !== "string" || text.length > STATUS_GRENZEN.zeichen) return null;
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (!objekt(roh)) return null;
  const { fassung, seit, rollen, modelle, auftraege, abgerechnetMsat, speicher, relay } = roh;
  if (typeof fassung !== "string" || !new RegExp(`^[0-9A-Za-z.+-]{1,${STATUS_GRENZEN.fassungZeichen}}$`).test(fassung)) return null;
  if (!zahl(seit) || !zahl(abgerechnetMsat)) return null;
  if (!Array.isArray(rollen) || rollen.length > STATUS_ROLLEN.length || new Set(rollen).size !== rollen.length) return null;
  if (!rollen.every((r) => (STATUS_ROLLEN as readonly unknown[]).includes(r))) return null;
  if (!Array.isArray(modelle) || modelle.length > STATUS_GRENZEN.modelle || new Set(modelle).size !== modelle.length) return null;
  if (!modelle.every((m) => typeof m === "string" && m.length >= 1 && m.length <= STATUS_GRENZEN.modellZeichen && !STEUERZEICHEN.test(m))) return null;
  if (!objekt(auftraege) || !zahl(auftraege.erledigt) || !zahl(auftraege.gratis) || !zahl(auftraege.abgelehnt)) return null;
  if (auftraege.gratis > auftraege.erledigt) return null;
  if (speicher !== null && (!objekt(speicher) || !zahl(speicher.belegtBytes) || !zahl(speicher.quotaBytes) || !zahl(speicher.gehalten))) return null;
  if (relay !== null && (!objekt(relay) || !zahl(relay.events) || !zahl(relay.verbindungen))) return null;
  return {
    fassung,
    seit,
    rollen: rollen as StatusRolle[],
    modelle: modelle as string[],
    auftraege: { erledigt: auftraege.erledigt, gratis: auftraege.gratis, abgelehnt: auftraege.abgelehnt },
    abgerechnetMsat,
    speicher: speicher === null ? null : { belegtBytes: speicher.belegtBytes as number, quotaBytes: speicher.quotaBytes as number, gehalten: speicher.gehalten as number },
    relay: relay === null ? null : { events: relay.events as number, verbindungen: relay.verbindungen as number },
  };
}
