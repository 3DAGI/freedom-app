/**
 * NIP-98 HTTP-Auth: signierte Nostr-Events als Auth für HTTP-Services.
 *
 * Nutzen hier: Storage-Provider (Chunk-Upload/Fetch) authentifizieren Clients
 * ohne Passwörter/Tokens — die Nostr-Identität IST der Zugang.
 *
 * Format: Authorization: Nostr base64-encoded-kind-27235-event
 * Event-Tags: u=<url>, method=<GET|PUT|...>, optional payload=<sha256>
 */
import { sha256, toHex } from "./htlc.js";
import { buildEvent, verifyEvent, getTag, NostrEvent } from "./event.js";

export const KIND_HTTP_AUTH = 27235;

export interface HttpAuthParams {
  pubkey: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** sha256 des request-bodys (fuer PUT/Pflicht bei Upload). */
  payloadHash?: string;
}

export function buildHttpAuth(p: HttpAuthParams, createdAt?: number): UnsignedEventLike {
  const tags: string[][] = [
    ["u", p.url],
    ["method", p.method],
  ];
  if (p.payloadHash) tags.push(["payload", p.payloadHash]);
  return buildEvent(p.pubkey, KIND_HTTP_AUTH, tags, "", createdAt);
}

export interface VerifiedAuth {
  pubkey: string;
  url: string;
  method: string;
  payloadHash?: string;
}

/** Verifiziert einen NIP-98 Authorization-Header. Wirft bei Ungueltigkeit. */
export function verifyHttpAuth(header: string, expectedUrl: string, expectedMethod: string, bodyBytes?: Uint8Array): VerifiedAuth {
  if (!header.startsWith("Nostr ")) throw new Error("kein nostr-auth header");
  let ev: NostrEvent;
  try {
    const json = atobBase64(header.slice(6).trim());
    ev = JSON.parse(json);
  } catch {
    throw new Error("auth-event ungueltig (base64/json)");
  }
  if (ev.kind !== KIND_HTTP_AUTH) throw new Error("auth-event falsches kind");
  if (!verifyEvent(ev)) throw new Error("auth-signatur ungueltig");

  const url = getTag(ev, "u");
  const method = getTag(ev, "method");
  if (url !== expectedUrl) throw new Error("auth-url mismatch");
  if (method !== expectedMethod) throw new Error("auth-method mismatch");

  // created_at max 60s alt / nicht in der zukunft
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ev.created_at) > 60) throw new Error("auth-event abgelaufen");

  let payloadHash: string | undefined;
  const ph = getTag(ev, "payload");
  if (ph) {
    if (!bodyBytes) throw new Error("auth verlangt payload-hash aber kein body");
    const actual = toHex(sha256(bodyBytes));
    if (actual !== ph) throw new Error("payload-hash mismatch");
    payloadHash = ph;
  }

  return { pubkey: ev.pubkey, url, method, payloadHash };
}

export interface AuthCheck {
  ok: boolean;
  /** Warum abgelehnt — gehoert ins Log, nicht in die Antwort an den Client. */
  reason?: string;
  auth?: VerifiedAuth;
}

/**
 * Wie `verifyHttpAuth`, aber ohne zu werfen.
 *
 * In einem HTTP-Handler ist ein ungefangener Wurf ein Serverfehler mit Status
 * 500 — obwohl der Fall „falsche Zugangsdaten" ein 401 ist. Der Unterschied
 * ist nicht kosmetisch: Ein 500 sagt einem Angreifer, dass er etwas
 * Unerwartetes ausgeloest hat, und einem Betreiber, dass sein Dienst kaputt
 * ist. Beides ist falsch.
 */
export function checkHttpAuth(
  header: string | undefined,
  expectedUrl: string,
  expectedMethod: string,
  bodyBytes?: Uint8Array,
): AuthCheck {
  if (!header) return { ok: false, reason: "kein Authorization-Kopf" };
  try {
    return { ok: true, auth: verifyHttpAuth(header, expectedUrl, expectedMethod, bodyBytes) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Base64 encode/decode (browser + node kompatibel). */
function atobBase64(s: string): string {
  if (typeof atob === "function") return atob(s);
  return Buffer.from(s, "base64").toString("utf8");
}
export function btoaBase64(s: string): string {
  if (typeof btoa === "function") return btoa(s);
  return Buffer.from(s, "utf8").toString("base64");
}

interface UnsignedEventLike {
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
}
