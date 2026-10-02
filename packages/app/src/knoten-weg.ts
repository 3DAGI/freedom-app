/**
 * Alles über meinen Knoten (Sammlung B-9c2, Entscheidung L5 A): Mit Haken
 * gehen KI-Anfragen und Halte-Aufträge an den eigenen Knoten nur über sein
 * Relay – nie über fremde, nie still daneben. Dort meldet sich die App auch mit
 * dem Sitzungsschlüssel an (der Knoten kennt ihn als Provider ohnehin); an
 * keinem anderen Relay. Ohne DOM, damit testbar.
 *
 * Woher die Adresse kommt: Läuft die App vom Knoten selbst (B-10), ist es ihr
 * eigener Ursprung – aber nur, wenn NIP-11 dort den Schlüssel des Knotens nennt.
 * Sonst aus der NIP-65-Liste, die der Knoten signiert (Kind 10002).
 */
import { KIND_RELAY_LIST, isPlausibleRelayUrl, type NostrEvent } from "@freedomstack/protocol";

/** Haken „Alles über meinen Knoten“ – nur „1“ heißt an. Eine Einstellung, kein Geheimnis. */
export const LS_NUR_KNOTEN = "freedom.knoten.nurUeber";

/** Standard aus: Ohne erreichbares Relay des Knotens ginge dann nichts mehr an ihn. */
export function nurUeberKnoten(ls: Pick<Storage, "getItem">): boolean {
  return ls.getItem(LS_NUR_KNOTEN) === "1";
}

/** Relay aus der neuesten NIP-65-Liste des Knotens – das erste zum Schreiben, mit öffentlicher Adresse. */
export function knotenRelayAus(listen: readonly NostrEvent[], knoten: string): string | null {
  const neueste = listen.filter((e) => e.kind === KIND_RELAY_LIST && e.pubkey === knoten).sort((a, b) => b.created_at - a.created_at)[0];
  for (const t of neueste?.tags ?? []) {
    if (t[0] !== "r" || typeof t[1] !== "string" || t[2] === "read") continue;
    if (isPlausibleRelayUrl(t[1]).ok) return t[1];
  }
  return null;
}

/**
 * Der eigene Ursprung als Relay des Knotens (B-10): nur http(s), und nur wenn
 * NIP-11 dort genau den Schlüssel des Knotens nennt. `info` ist die gelesene
 * Antwort auf `Accept: application/nostr+json`.
 */
export function ursprungAlsKnotenRelay(ort: { protocol: string; host: string }, info: unknown, knoten: string): string | null {
  if (ort.protocol !== "http:" && ort.protocol !== "https:") return null;
  if (typeof info !== "object" || info === null || (info as { pubkey?: unknown }).pubkey !== knoten) return null;
  return `${ort.protocol === "https:" ? "wss" : "ws"}://${ort.host}`;
}
