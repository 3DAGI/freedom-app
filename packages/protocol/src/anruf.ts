/**
 * Anruf-Aufbau (Sammlung B-13c, Entscheidungen T1 A, T2 A): Angebot,
 * Antwort, Kandidaten und Ende eines Anrufs reisen nur versiegelt (NIP-59),
 * je Empfänger ein Umschlag – an die Person und ihre Geräte. Innen Kind 25040,
 * Inhalt JSON (docs/PROTOCOL.md 27).
 *
 * - Nur Relay-Kandidaten: Gesprochen wird nur über den TURN des eigenen
 *   Knotens (`iceTransportPolicy: "relay"`). Eine Host-, srflx- oder
 *   prflx-Adresse im SDP verriete dem Gegenüber die IP – solche baut
 *   `baueAnrufNachricht()` nie und liest `oeffneAnrufNachricht()` nie.
 * - DTLS-Fingerabdruck Pflicht in Angebot und Antwort: Er bindet die
 *   verschlüsselten Medien (DTLS-SRTP) an den Absender des Siegels – wer den
 *   Kontakt geprüft hat (B-4), weiß, mit wem er spricht.
 * - Ablauf nach fünf Minuten (NIP-40), kein Zeitversatz: Ein Anruf ist jetzt
 *   oder nie; Relays sollen ihn nicht aufheben. Was älter als fünf Minuten ist,
 *   liest die App nicht mehr.
 */
import type { NostrEvent, UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

/** Innen Kind des Anruf-Aufbaus – nie offen veröffentlicht. */
export const KIND_ANRUF = 25040;

export const ANRUF_GRENZEN = { sdpZeichen: 16_000, kandidatZeichen: 600, ablaufSek: 300, empfaenger: 20 } as const;
export const ANRUF_TYPEN = ["angebot", "antwort", "kandidat", "ende"] as const;
export const ENDE_GRUENDE = ["aufgelegt", "abgelehnt", "besetzt", "zeit", "fehler"] as const;
export type AnrufTyp = (typeof ANRUF_TYPEN)[number];
export type EndeGrund = (typeof ENDE_GRUENDE)[number];
export type Medium = "audio" | "video";

export type AnrufNachricht =
  | { anruf: string; typ: "angebot"; sdp: string; medien: Medium[] }
  | { anruf: string; typ: "antwort"; sdp: string }
  | { anruf: string; typ: "kandidat"; kandidat: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }
  | { anruf: string; typ: "ende"; grund: EndeGrund };

const ANRUF_ID = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const FINGERABDRUCK = /^a=fingerprint:sha-256 ([0-9A-F]{2}:){31}[0-9A-F]{2}$/m;

/** Neue Kennung eines Anrufs (16 Byte Hex). */
export function neueAnrufKennung(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ein ICE-Kandidat (ohne „a=“) – nur vom Typ „relay“, sonst stünde eine eigene Adresse darin. */
export function istRelayKandidat(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length > ANRUF_GRENZEN.kandidatZeichen || /[\r\n]/.test(candidate)) return false;
  const m = candidate.match(/^candidate:\S+ \d+ (udp|tcp) \d+ \S+ \d+ typ (\w+)( .*)?$/i);
  return !!m && m[2]!.toLowerCase() === "relay";
}

/**
 * SDP für Angebot oder Antwort prüfen: begrenzt, mit DTLS-Fingerabdruck
 * (SHA-256), jeder Kandidat vom Typ „relay“. Kandidaten dürfen fehlen
 * (Trickle ICE) – dann kommen sie einzeln als „kandidat“.
 */
export function pruefeSdpNurRelay(sdp: string): boolean {
  if (typeof sdp !== "string" || sdp.length === 0 || sdp.length > ANRUF_GRENZEN.sdpZeichen || !sdp.startsWith("v=0")) return false;
  const zeilen = sdp.split(/\r?\n/);
  if (!zeilen.some((z) => FINGERABDRUCK.test(z))) return false;
  return zeilen.filter((z) => z.startsWith("a=candidate:")).every((z) => istRelayKandidat(z.slice(2)));
}

/** Nachricht streng prüfen – sonst null. */
function geprueft(n: unknown): AnrufNachricht | null {
  if (typeof n !== "object" || n === null || Array.isArray(n)) return null;
  const x = n as Record<string, unknown>;
  if (typeof x.anruf !== "string" || !ANRUF_ID.test(x.anruf)) return null;
  switch (x.typ) {
    case "angebot": {
      const medien = x.medien;
      if (!Array.isArray(medien) || medien.length < 1 || medien.length > 2 || new Set(medien).size !== medien.length) return null;
      if (!medien.every((m) => m === "audio" || m === "video") || !medien.includes("audio")) return null;
      if (!pruefeSdpNurRelay(x.sdp as string)) return null;
      return { anruf: x.anruf, typ: "angebot", sdp: x.sdp as string, medien: medien as Medium[] };
    }
    case "antwort":
      return pruefeSdpNurRelay(x.sdp as string) ? { anruf: x.anruf, typ: "antwort", sdp: x.sdp as string } : null;
    case "kandidat": {
      const k = x.kandidat as Record<string, unknown> | null;
      if (typeof k !== "object" || k === null || !istRelayKandidat(k.candidate as string)) return null;
      const mid = k.sdpMid, idx = k.sdpMLineIndex;
      if (mid !== null && (typeof mid !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(mid))) return null;
      if (idx !== null && (!Number.isSafeInteger(idx) || (idx as number) < 0 || (idx as number) > 15)) return null;
      return { anruf: x.anruf, typ: "kandidat", kandidat: { candidate: k.candidate as string, sdpMid: mid as string | null, sdpMLineIndex: idx as number | null } };
    }
    case "ende":
      return (ENDE_GRUENDE as readonly unknown[]).includes(x.grund) ? { anruf: x.anruf, typ: "ende", grund: x.grund as EndeGrund } : null;
    default:
      return null;
  }
}

/**
 * Eine Anruf-Nachricht an die Person und ihre Geräte – je Empfänger ein
 * Umschlag, Ablauf in fünf Minuten, kein Zeitversatz. Was nicht nur über
 * Relays ginge, geht nicht hinaus.
 */
export async function baueAnrufNachricht(p: {
  von: Signer; an: readonly string[]; nachricht: AnrufNachricht; nowSecs?: number;
}): Promise<NostrEvent[]> {
  const n = geprueft(p.nachricht);
  if (!n) throw new Error("Anruf-Nachricht ungültig (nur Relay-Kandidaten, mit Fingerabdruck)");
  const an = [...new Set(p.an)];
  if (an.length < 1 || an.length > ANRUF_GRENZEN.empfaenger || !an.every((k) => HEX64.test(k))) throw new Error("Empfänger ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern = (empfaenger: string): UnsignedEvent => ({
    pubkey: p.von.publicKey(), kind: KIND_ANRUF, created_at: now, tags: [["p", empfaenger], ["anruf", n.anruf]], content: JSON.stringify(n),
  });
  return Promise.all(an.map((k) => giftWrapMitSigner(kern(k), p.von, k, { fixedJitter: 0, nowSecs: now, ablaufBis: now + ANRUF_GRENZEN.ablaufSek })));
}

/**
 * Umschlag öffnen – nur eine gültige Anruf-Nachricht an diesen Schlüssel, nicht
 * älter als fünf Minuten und nicht aus der Zukunft; sonst null.
 */
export async function oeffneAnrufNachricht(
  wrap: NostrEvent, signer: Signer, jetzt = Math.floor(Date.now() / 1000),
): Promise<{ von: string; nachricht: AnrufNachricht } | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  const inner = r.inner;
  if (!r.ok || !inner || inner.kind !== KIND_ANRUF || inner.pubkey !== r.senderPubkey) return null;
  if (!Number.isSafeInteger(inner.created_at) || inner.created_at < jetzt - ANRUF_GRENZEN.ablaufSek || inner.created_at > jetzt + 60) return null;
  if (inner.tags.find((t) => t[0] === "p")?.[1] !== signer.publicKey()) return null;
  let roh: unknown;
  try {
    roh = JSON.parse(inner.content);
  } catch {
    return null;
  }
  const n = geprueft(roh);
  if (!n || inner.tags.find((t) => t[0] === "anruf")?.[1] !== n.anruf) return null;
  return { von: inner.pubkey, nachricht: n };
}
