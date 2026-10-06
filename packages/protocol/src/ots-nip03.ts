/**
 * NIP-03 (Schritt 5.10b, B-17b1, K3 A): der OpenTimestamps-Beweis zu einem
 * Event als Kind 1040 – `e` (Kennung), `k` (Art), Inhalt die .ots-Datei in
 * Base64. Veröffentlicht wird nur ein fertiger Beweis: ein Weg zur
 * niedrigsten Bitcoin-Höhe (`nurBitcoin()`), keine ausstehenden Versprechen.
 *
 * Gelesen wird streng: Die Datei muss genau die Kennung im `e`-Tag beweisen.
 * Wer das Event signiert hat, spielt keine Rolle – der Beweis trägt sich
 * selbst. „In Bitcoin verankert“ heißt er aber erst nach der Prüfung gegen
 * den Blockkopf (B-17b2); ein Kind 1040 allein nennt nur eine Höhe.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { type NostrEvent, type UnsignedEvent, buildEvent } from "./event.js";
import { OTS_GRENZEN, OtsFehler, attestierungenVon, leseOtsDatei, nurBitcoin, schreibeOtsDatei, type OtsDatei } from "./ots.js";

export const KIND_OTS_BEWEIS = 1040;

const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_BASE64 = Math.ceil(OTS_GRENZEN.bytes / 3) * 4;

function zuBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function niedrigste(d: OtsDatei): number | undefined {
  const h = attestierungenVon(d.zeitstempel).flatMap(({ attestierung: a }) => (a.art === "bitcoin" ? [a.hoehe] : []));
  return h.length ? Math.min(...h) : undefined;
}

/** Kind 1040 zu einem Event – nur mit Bitcoin-Attestierung, sonst `nicht-verankert`. */
export function baueOtsBeweis(autor: string, ziel: { id: string; kind: number }, datei: OtsDatei, createdAt?: number): UnsignedEvent {
  if (!HEX64.test(ziel.id) || bytesToHex(datei.digest) !== ziel.id) throw new OtsFehler("anderes-event");
  if (!Number.isInteger(ziel.kind) || ziel.kind < 0 || ziel.kind > 65535) throw new OtsFehler("art");
  const z = nurBitcoin(datei.zeitstempel);
  if (!z) throw new OtsFehler("nicht-verankert");
  const inhalt = zuBase64(schreibeOtsDatei({ digest: hexToBytes(ziel.id), zeitstempel: z }));
  return buildEvent(autor, KIND_OTS_BEWEIS, [["e", ziel.id], ["k", String(ziel.kind)]], inhalt, createdAt);
}

export interface OtsBeweis {
  eventId: string;
  kind: number;
  datei: OtsDatei;
  /** Niedrigste Bitcoin-Höhe im Beweis – noch ungeprüft. */
  hoehe: number;
}

/** Kind 1040 lesen; Fehler nur als `OtsFehler`-Kennung. */
export function leseOtsBeweis(ev: NostrEvent): OtsBeweis {
  if (ev.kind !== KIND_OTS_BEWEIS) throw new OtsFehler("kein-beweis");
  const e = ev.tags.filter((t) => t[0] === "e");
  const k = ev.tags.filter((t) => t[0] === "k");
  if (e.length !== 1 || typeof e[0]![1] !== "string" || !HEX64.test(e[0]![1])) throw new OtsFehler("anderes-event");
  if (k.length !== 1 || typeof k[0]![1] !== "string" || !/^\d{1,5}$/.test(k[0]![1]) || Number(k[0]![1]) > 65535) throw new OtsFehler("art");
  if (typeof ev.content !== "string" || ev.content.length > MAX_BASE64) throw new OtsFehler("zu-gross");
  if (!BASE64.test(ev.content)) throw new OtsFehler("base64");
  const datei = leseOtsDatei(Uint8Array.from(atob(ev.content), (c) => c.charCodeAt(0)));
  const eventId = e[0]![1];
  if (bytesToHex(datei.digest) !== eventId) throw new OtsFehler("anderes-event");
  const hoehe = niedrigste(datei);
  if (hoehe === undefined) throw new OtsFehler("nicht-verankert");
  return { eventId, kind: Number(k[0]![1]), datei, hoehe };
}
