/**
 * Wecken über den eigenen Knoten (Sammlung B-12, Entscheidungen W1 A, W2 A):
 * Die App meldet beim gekoppelten Knoten eine Push-Adresse (Web Push) und die
 * Schlüssel an, an die Post für sie geht – die Person und ihre Geräte. Kommt
 * ein Umschlag (1059) an einen davon, weckt der Knoten den Browser: ohne
 * Inhalt, ohne Absender, nur mit VAPID (RFC 8030, RFC 8292). Der Push-Dienst
 * des Browserherstellers sieht, *dass* geweckt wird, nicht was.
 *
 * Anmelden und Abmelden nur versiegelt vom Sitzungsschlüssel an den Knoten,
 * mit Besitzer-Nachweis (B-8). Die Push-Adresse ist ein Zugang zu diesem
 * Browser – sie steht nur im Kern, nie offen (docs/PROTOCOL.md 25).
 */
import { isPrivateAddress } from "./adressbereich.js";
import { KIND_DVM_WECKEN } from "./kinds.js";
import { type Kopplung, mitBesitzerNachweis } from "./kopplung.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";

/** Grenzen der Anmeldung – was darüber liegt, nimmt der Knoten nicht. */
export const WECKEN_GRENZEN = { endpunktZeichen: 1000, schluessel: 20 } as const;

export type WeckAktion = "an" | "ab";

export interface WeckAnmeldung {
  /** „an“ meldet an (ersetzt eine frühere Anmeldung derselben Adresse), „ab“ meldet ab. */
  aktion: WeckAktion;
  /** Push-Adresse aus `PushSubscription.endpoint` – nur https, öffentlich. */
  endpunkt: string;
  /** Schlüssel, deren Post weckt: die Person und ihre Geräte (64 Hex-Zeichen); beim Abmelden leer. */
  schluessel: string[];
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Push-Adresse prüfen – https, ohne Zugangsdaten, kein lokaler oder privater
 * Host, höchstens 1000 Zeichen. Gibt die Adresse in fester Schreibweise
 * zurück oder null. Die Namensauflösung prüft der Knoten vor dem Senden.
 */
export function pruefeWeckEndpunkt(roh: string): string | null {
  if (typeof roh !== "string" || roh.length > WECKEN_GRENZEN.endpunktZeichen) return null;
  let u: URL;
  try {
    u = new URL(roh);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.hash) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || (!host.includes(".") && !host.includes(":"))) return null;
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isPrivateAddress(host)) return null;
  }
  return u.href.length <= WECKEN_GRENZEN.endpunktZeichen ? u.href : null;
}

/** Anmeldung streng prüfen – sonst null. */
function gepruefteAnmeldung(a: WeckAnmeldung): WeckAnmeldung | null {
  if (a.aktion !== "an" && a.aktion !== "ab") return null;
  const endpunkt = pruefeWeckEndpunkt(a.endpunkt);
  if (!endpunkt || !Array.isArray(a.schluessel)) return null;
  if (a.schluessel.length > WECKEN_GRENZEN.schluessel || new Set(a.schluessel).size !== a.schluessel.length) return null;
  if (!a.schluessel.every((k) => typeof k === "string" && HEX64.test(k))) return null;
  if (a.aktion === "an" && a.schluessel.length === 0) return null;
  if (a.aktion === "ab" && a.schluessel.length > 0) return null;
  return { aktion: a.aktion, endpunkt, schluessel: [...a.schluessel] };
}

/** An- oder Abmeldung beim eigenen Knoten – versiegelt, mit Nachweis, ohne Gebot. */
export async function baueWeckAnmeldung(p: {
  sitzung: Signer; kopplung: Kopplung; anmeldung: WeckAnmeldung; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  const a = gepruefteAnmeldung(p.anmeldung);
  if (!a) throw new Error("Weck-Anmeldung ungültig");
  const kern = buildJobRequest({
    kind: KIND_DVM_WECKEN, customerPubkey: p.sitzung.publicKey(), input: "wecken", bidMsat: 0, providerPubkey: p.kopplung.knoten,
    params: [["aktion", a.aktion], ["endpunkt", a.endpunkt], ...a.schluessel.map((k) => ["schluessel", k])],
  }, p.nowSecs);
  const request = mitBesitzerNachweis(kern, p.kopplung);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.kopplung.knoten, powBits: p.powBits, nowSecs: p.nowSecs });
}

/** Anmeldung aus dem Kern lesen (Knoten) – je Name genau ein Wert, Schlüssel beliebig oft; sonst null. */
export function leseWeckAnmeldung(request: Pick<NostrEvent, "kind" | "tags">): WeckAnmeldung | null {
  if (request.kind !== KIND_DVM_WECKEN) return null;
  const params = request.tags.filter((t) => t[0] === "param");
  const einzeln = (name: string): string | null => {
    const w = params.filter((t) => t[1] === name);
    return w.length === 1 && typeof w[0]![2] === "string" ? w[0]![2] : null;
  };
  const aktion = einzeln("aktion"), endpunkt = einzeln("endpunkt");
  if ((aktion !== "an" && aktion !== "ab") || endpunkt === null) return null;
  if (params.some((t) => t[1] !== "aktion" && t[1] !== "endpunkt" && t[1] !== "schluessel")) return null;
  const schluessel = params.filter((t) => t[1] === "schluessel").map((t) => t[2] ?? "");
  return gepruefteAnmeldung({ aktion, endpunkt, schluessel });
}

export interface WeckAntwort {
  aktion: WeckAktion;
  /** Wie viele Schlüssel der Knoten für diese Adresse beobachtet (nach dem Abmelden 0). */
  schluessel: number;
}

/** Antwort des Knotens (6078) – dasselbe Format, das `leseWeckAntwort()` liest. */
export function weckAntwortText(a: WeckAntwort): string {
  return JSON.stringify({ aktion: a.aktion, schluessel: a.schluessel });
}

/** Antwort streng lesen – sonst null. */
export function leseWeckAntwort(text: string): WeckAntwort | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  const { aktion, schluessel } = (typeof roh === "object" && roh !== null ? roh : {}) as Record<string, unknown>;
  if (aktion !== "an" && aktion !== "ab") return null;
  if (!Number.isSafeInteger(schluessel) || (schluessel as number) < 0 || (schluessel as number) > WECKEN_GRENZEN.schluessel) return null;
  if (aktion === "ab" && schluessel !== 0) return null;
  return { aktion, schluessel: schluessel as number };
}
