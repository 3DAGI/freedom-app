/**
 * Wecken in der App (Sammlung B-12d2, Entscheidungen W1 A, W2 A, W3 A): Mit
 * dem Haken „Wecken“ in „Mein Knoten“ meldet die App den Weck-Worker an,
 * abonniert Web Push mit dem VAPID-Schlüssel des eigenen Knotens (aus seinem
 * Status, B-11) und meldet die Push-Adresse versiegelt bei ihm an (5078). Hier
 * nur, was ohne DOM geht – damit testbar.
 */
import { WECKEN_GRENZEN, WECK_SCHLUESSEL } from "@freedomstack/protocol";

/** Kann dieser Browser hier geweckt werden? Nur im sicheren Kontext, mit Service Worker, Push und Meldungen. */
export function weckenMoeglich(g: {
  isSecureContext?: boolean; navigator?: { serviceWorker?: unknown }; PushManager?: unknown; Notification?: unknown;
}): boolean {
  return g.isSecureContext === true && !!g.navigator?.serviceWorker && !!g.PushManager && !!g.Notification;
}

/** Adresse des Workers neben freedom.html – mit der Sprache der App, die zeigt er in der Meldung. */
export function weckWorkerAdresse(sprache: "de" | "en"): string {
  return `freedom-sw.js?sprache=${sprache}`;
}

/** VAPID-Schlüssel des Knotens (base64url, 65 Byte) als `applicationServerKey` – streng geprüft, sonst null. */
export function weckSchluesselBytes(b64url: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!b64url || !WECK_SCHLUESSEL.test(b64url)) return null;
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=";
  const roh = atob(b64);
  if (roh.length !== 65 || roh.charCodeAt(0) !== 0x04) return null;
  const bytes = new Uint8Array(new ArrayBuffer(65));
  for (let i = 0; i < 65; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

/**
 * Schlüssel, deren Post weckt: die Person und ihre Geräte – dieselben, für die
 * die App Umschläge öffnet (`auchFuer`). Ohne Doppelte, nur 64 Hex-Zeichen,
 * höchstens so viele, wie der Knoten nimmt.
 */
export function weckSchluesselFuer(ich: string, geraete: readonly string[]): string[] {
  return [...new Set([ich, ...geraete])].filter((k) => /^[0-9a-f]{64}$/.test(k)).slice(0, WECKEN_GRENZEN.schluessel);
}
