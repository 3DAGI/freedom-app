/**
 * Zugang zum TURN des eigenen Knotens (Sammlung B-13, Entscheidungen T1 A,
 * T2 A): Anrufe laufen nur über einen Vermittler (TURN, RFC 8656) auf dem
 * eigenen Knoten – so sieht das Gegenüber nie die IP. Den Vermittler stellt
 * coturn als eigener Dienst; der Knoten vergibt nur zeitlich begrenzte
 * Zugänge nach dem TURN-REST-Verfahren (Nutzer = Ablauf:Zufall, Passwort =
 * HMAC-SHA1 mit dem gemeinsamen Geheimnis von coturn).
 *
 * Anfrage nur versiegelt vom Sitzungsschlüssel an den gekoppelten Knoten,
 * mit Besitzer-Nachweis (B-8); die Antwort trägt den Zugang und reist nur
 * versiegelt (docs/PROTOCOL.md 26). Der Zugang ist ein Geheimnis – nie offen,
 * nie ins Log, nie gemerkt über seinen Ablauf hinaus.
 */
import { KIND_DVM_TURN } from "./kinds.js";
import { type Kopplung, mitBesitzerNachweis } from "./kopplung.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";

/** Grenzen des Zugangs – was darüber liegt, nimmt die App nicht. */
export const TURN_GRENZEN = { urls: 4, urlZeichen: 200, hoechstensSek: 86_400 } as const;

export interface TurnZugang {
  /** `turn:`/`turns:`-Adressen des Vermittlers (RFC 7065), höchstens vier. */
  urls: string[];
  /** Nutzername nach TURN-REST: `<Ablauf in Unix-Sekunden>:<Zufall>`. */
  nutzer: string;
  /** Passwort: base64(HMAC-SHA1(Geheimnis, Nutzer)) – 28 Zeichen. */
  passwort: string;
  /** Ablauf, Unix-Sekunden – gleich der Zahl vor dem Doppelpunkt im Nutzernamen. */
  bis: number;
}

const TURN_URL = /^turns?:[A-Za-z0-9.-]{1,190}(:\d{1,5})?(\?transport=(udp|tcp))?$/;

/** Eine `turn:`/`turns:`-Adresse in der Form, die App und Knoten annehmen (Host, Port, `transport`). */
export function istTurnUrl(u: string): boolean {
  return typeof u === "string" && u.length <= TURN_GRENZEN.urlZeichen && TURN_URL.test(u);
}

const NUTZER = /^(\d{1,12}):[A-Za-z0-9_-]{8,64}$/;
const PASSWORT = /^[A-Za-z0-9+/]{27}=$/;

/** Zugang anfragen – versiegelt, mit Nachweis, ohne Gebot. */
export async function baueTurnAnfrage(p: {
  sitzung: Signer; kopplung: Kopplung; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  const kern = buildJobRequest({
    kind: KIND_DVM_TURN, customerPubkey: p.sitzung.publicKey(), input: "turn", bidMsat: 0, providerPubkey: p.kopplung.knoten,
  }, p.nowSecs);
  const request = mitBesitzerNachweis(kern, p.kopplung);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.kopplung.knoten, powBits: p.powBits, nowSecs: p.nowSecs });
}

/** Antwort des Knotens (6079) – dasselbe Format, das `leseTurnZugang()` liest. */
export function turnZugangText(z: TurnZugang): string {
  return JSON.stringify({ urls: z.urls, nutzer: z.nutzer, passwort: z.passwort, bis: z.bis });
}

/**
 * Zugang streng lesen – sonst null: gültige `turn:`/`turns:`-Adressen, Nutzer
 * und Passwort in der Form von TURN-REST, Ablauf in der Zukunft, höchstens
 * einen Tag entfernt, gleich dem im Nutzernamen.
 */
export function leseTurnZugang(text: string, jetzt = Math.floor(Date.now() / 1000)): TurnZugang | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const { urls, nutzer, passwort, bis } = roh as Record<string, unknown>;
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > TURN_GRENZEN.urls || new Set(urls).size !== urls.length) return null;
  if (!urls.every((u) => istTurnUrl(u as string))) return null;
  if (typeof nutzer !== "string" || typeof passwort !== "string" || !PASSWORT.test(passwort)) return null;
  const m = nutzer.match(NUTZER);
  if (!m || !Number.isSafeInteger(bis) || Number(m[1]) !== bis) return null;
  if ((bis as number) <= jetzt || (bis as number) > jetzt + TURN_GRENZEN.hoechstensSek) return null;
  return { urls: urls as string[], nutzer, passwort, bis: bis as number };
}
