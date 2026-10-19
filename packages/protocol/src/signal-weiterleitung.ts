/**
 * Signalverbindung zum Gruppenanruf über den eigenen Knoten (Sammlung B-34e, Entscheidung LK5 A,
 * `docs/GRUPPENANRUF-ENTWURF.md`): `livekit-client` öffnet für die Signalisierung einen WebSocket zur Adresse des SFU
 * (`<url>/rtc/v1`) – der Knoten der anrufenden Person sähe so die IP-Adresse jedes Teilnehmenden. Mit diesem Weg reicht
 * der eigene Knoten die Verbindung weiter: Die App verbindet sich mit `<relay des Knotens>/signal/<zeichen>`, der Knoten
 * öffnet die Verbindung zum SFU (über Tor, wenn er Tor nutzt) und reicht die Rahmen durch.
 *
 * Das Zeichen bekommt nur der Besitzer: Anfrage versiegelt vom Sitzungsschlüssel an den gekoppelten Knoten, mit Nachweis
 * (B-8), Antwort nur versiegelt (docs/PROTOCOL.md 41). Es gilt nur für das genannte Ziel (`wss://`, wie in einer
 * Einladung) und nur bis zum genannten Ablauf.
 */
import { KIND_DVM_SIGNAL } from "./kinds.js";
import { type Kopplung, mitBesitzerNachweis } from "./kopplung.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import { LIVEKIT_GRENZEN, istLivekitUrl } from "./livekit-zugang.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";

/** Pfad im Relay des Knotens: `/signal/<zeichen>/rtc` bzw. `/rtc/v1` (`livekit-client` hängt den Rest an). */
export const SIGNAL_PFAD = "/signal/";
/** Grenzen – höchstens einen Tag gültig wie ein Zugang (`LIVEKIT_GRENZEN`), fünf Minuten Spielraum für die Uhren. */
export const SIGNAL_GRENZEN = { hoechstensSek: LIVEKIT_GRENZEN.hoechstensSek, spielraumSek: 300 } as const;

const ZEICHEN = /^[0-9a-f]{64}$/;

/** Was die App fragt: das Ziel aus der Einladung und deren Ablauf. */
export interface SignalAnfrage {
  ziel: string;
  bis: number;
}

/** Was der Knoten antwortet: das Zeichen für den Pfad (64 Zeichen Hex, zufällig) und bis wann es gilt. */
export interface SignalZugang {
  zeichen: string;
  bis: number;
}

/** Die Weiterleitung anfragen – versiegelt, mit Nachweis, ohne Gebot. */
export async function baueSignalAnfrage(p: {
  sitzung: Signer; kopplung: Kopplung; ziel: string; bis: number; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  const input = JSON.stringify({ ziel: p.ziel, bis: p.bis });
  if (!leseSignalAnfrage(input)) throw new Error("Anfrage ungültig");
  const kern = buildJobRequest({
    kind: KIND_DVM_SIGNAL, customerPubkey: p.sitzung.publicKey(), input, bidMsat: 0, providerPubkey: p.kopplung.knoten,
  }, p.nowSecs);
  const request = mitBesitzerNachweis(kern, p.kopplung);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.kopplung.knoten, powBits: p.powBits, nowSecs: p.nowSecs });
}

/** Die Eingabe streng lesen – Ziel nur `wss://host[:port]` (`istLivekitUrl()`), Ablauf eine ganze Zahl; sonst null. */
export function leseSignalAnfrage(text: string): SignalAnfrage | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const { ziel, bis } = roh as Record<string, unknown>;
  if (typeof ziel !== "string" || !istLivekitUrl(ziel)) return null;
  if (!Number.isSafeInteger(bis) || (bis as number) <= 0) return null;
  return { ziel: ziel.replace(/\/$/, ""), bis: bis as number };
}

/** Antwort des Knotens (6082) – dasselbe Format, das `leseSignalZugang()` liest. */
export function signalZugangText(z: SignalZugang): string {
  return JSON.stringify({ zeichen: z.zeichen, bis: z.bis });
}

/** Die Antwort streng lesen: Zeichen 64 Zeichen Hex, Ablauf in der Zukunft und höchstens einen Tag (plus Spielraum) entfernt. */
export function leseSignalZugang(text: string, jetzt = Math.floor(Date.now() / 1000)): SignalZugang | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const { zeichen, bis } = roh as Record<string, unknown>;
  if (typeof zeichen !== "string" || !ZEICHEN.test(zeichen)) return null;
  if (!Number.isSafeInteger(bis) || (bis as number) <= jetzt || (bis as number) > jetzt + SIGNAL_GRENZEN.hoechstensSek + SIGNAL_GRENZEN.spielraumSek) return null;
  return { zeichen, bis: bis as number };
}

/**
 * Den Pfad einer Verbindung zum Relay des Knotens lesen: `/signal/<zeichen>/rtc` oder `/signal/<zeichen>/rtc/v1`,
 * dahinter höchstens die Anfrage (`?…`). Gibt Zeichen, den Teil für das Ziel und die Anfrage zurück – sonst null.
 */
export function leseSignalPfad(url: string): { zeichen: string; pfad: "/rtc" | "/rtc/v1"; anfrage: string } | null {
  const m = /^\/signal\/([0-9a-f]{64})(\/rtc(?:\/v1)?)(\?[^#]*)?$/.exec(url);
  if (!m) return null;
  return { zeichen: m[1]!, pfad: m[2] as "/rtc" | "/rtc/v1", anfrage: m[3] ?? "" };
}
