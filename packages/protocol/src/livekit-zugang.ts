/**
 * Zugänge zu einem Gruppenanruf über den SFU des eigenen Knotens (Sammlung B-34, Entscheidungen LK2–LK4 A,
 * `docs/GRUPPENANRUF-ENTWURF.md`): LiveKit läuft als eigener Dienst (wie coturn, B-13b); der Knoten vergibt nur
 * Zugänge – JWT nach LiveKit (HS256, signiert mit dem API-Geheimnis des Dienstes), je Teilnehmer einer, mit einer
 * zufälligen Kennung statt eines Schlüssels, nur für diesen Anruf und kurz gültig.
 *
 * Anfrage nur versiegelt vom Sitzungsschlüssel an den gekoppelten Knoten, mit Besitzer-Nachweis (B-8); die Antwort
 * reist nur versiegelt (docs/PROTOCOL.md 39). Zugänge sind Geheimnisse – nie offen, nie ins Log; an die Teilnehmer
 * nur als inneres Event der MLS-Gruppe (B-34c).
 */
import { KIND_DVM_LIVEKIT } from "./kinds.js";
import { type Kopplung, mitBesitzerNachweis } from "./kopplung.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";

/** Grenzen – was darüber liegt, nimmt weder Knoten noch App. */
export const LIVEKIT_GRENZEN = { teilnehmer: 25, urlZeichen: 200, tokenZeichen: 2000, hoechstensSek: 86_400 } as const;

export interface LivekitZugaenge {
  /** Adresse des SFU (`wss://`). */
  url: string;
  /** Kennung des Anrufs: 32 Zeichen Hex, zufällig – nie die Gruppe oder ein Schlüssel. */
  raum: string;
  /** Je Teilnehmer ein Zugang: zufällige Kennung (16 Zeichen Hex) und das JWT. */
  zugaenge: { kennung: string; token: string }[];
  /** Ablauf, Unix-Sekunden. */
  bis: number;
}

const RAUM = /^[0-9a-f]{32}$/;
const KENNUNG = /^[0-9a-f]{16}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LIVEKIT_URL = /^wss:\/\/[A-Za-z0-9.-]{1,190}(:\d{1,5})?\/?$/;

/** Eine Adresse des SFU in der Form, die Knoten und App annehmen: `wss://host[:port]`. */
export function istLivekitUrl(u: string): boolean {
  return typeof u === "string" && u.length <= LIVEKIT_GRENZEN.urlZeichen && LIVEKIT_URL.test(u);
}

/** Was die App fragt: der Anruf und wie viele Zugänge. */
export interface LivekitAnfrage {
  raum: string;
  anzahl: number;
}

/** Zugänge anfragen – versiegelt, mit Nachweis, ohne Gebot. */
export async function baueLivekitAnfrage(p: {
  sitzung: Signer; kopplung: Kopplung; raum: string; anzahl: number; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  if (!leseLivekitAnfrage(JSON.stringify({ raum: p.raum, anzahl: p.anzahl }))) throw new Error("Anfrage ungültig");
  const kern = buildJobRequest({
    kind: KIND_DVM_LIVEKIT, customerPubkey: p.sitzung.publicKey(), input: JSON.stringify({ raum: p.raum, anzahl: p.anzahl }),
    bidMsat: 0, providerPubkey: p.kopplung.knoten,
  }, p.nowSecs);
  const request = mitBesitzerNachweis(kern, p.kopplung);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.kopplung.knoten, powBits: p.powBits, nowSecs: p.nowSecs });
}

/** Die Eingabe der Anfrage streng lesen – sonst null. */
export function leseLivekitAnfrage(text: string): LivekitAnfrage | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const { raum, anzahl } = roh as Record<string, unknown>;
  if (typeof raum !== "string" || !RAUM.test(raum)) return null;
  if (!Number.isSafeInteger(anzahl) || (anzahl as number) < 1 || (anzahl as number) > LIVEKIT_GRENZEN.teilnehmer) return null;
  return { raum, anzahl: anzahl as number };
}

/** Antwort des Knotens (6081) – dasselbe Format, das `leseLivekitZugaenge()` liest. */
export function livekitZugaengeText(z: LivekitZugaenge): string {
  return JSON.stringify({ url: z.url, raum: z.raum, zugaenge: z.zugaenge.map((x) => ({ kennung: x.kennung, token: x.token })), bis: z.bis });
}

/**
 * Zugänge streng lesen – sonst null: Adresse `wss://`, derselbe Anruf und genau so viele Zugänge wie gefragt,
 * Kennungen verschieden, Tokens in der Form eines JWT, Ablauf in der Zukunft und höchstens einen Tag entfernt.
 */
export function leseLivekitZugaenge(text: string, gefragt: LivekitAnfrage, jetzt = Math.floor(Date.now() / 1000)): LivekitZugaenge | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const { url, raum, zugaenge, bis } = roh as Record<string, unknown>;
  if (typeof url !== "string" || !istLivekitUrl(url) || raum !== gefragt.raum) return null;
  if (!Array.isArray(zugaenge) || zugaenge.length !== gefragt.anzahl) return null;
  const aus: LivekitZugaenge["zugaenge"] = [];
  for (const z of zugaenge) {
    const { kennung, token } = (z ?? {}) as Record<string, unknown>;
    if (typeof kennung !== "string" || !KENNUNG.test(kennung) || aus.some((x) => x.kennung === kennung)) return null;
    if (typeof token !== "string" || token.length > LIVEKIT_GRENZEN.tokenZeichen || !JWT.test(token)) return null;
    aus.push({ kennung, token });
  }
  if (!Number.isSafeInteger(bis) || (bis as number) <= jetzt || (bis as number) > jetzt + LIVEKIT_GRENZEN.hoechstensSek) return null;
  return { url, raum, zugaenge: aus, bis: bis as number };
}
