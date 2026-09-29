/**
 * Kommentare nach NIP-22 (Kind 1111, Schritt C-17a) – in Repos an Issues
 * (1621) und Patches (1617), wie die Diskussion unter einem Issue oder Pull
 * Request bei GitHub. Die Wurzel steht in Großbuchstaben (`E`, `K`, `P`), das,
 * worauf geantwortet wird, in Kleinbuchstaben (`e`, `k`, `p`); direkt am Issue
 * ist beides dasselbe, eine Antwort auf einen Kommentar nennt ihn als `e`.
 *
 * Öffentlich wie Issues und Patches; in privaten Räumen nur als inneres Event
 * der Gruppe (`raumRepoKommentar()`, `raum-repo.ts`).
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag } from "./event.js";
import { ProtokollFehler } from "./fehler.js";
import { KIND_ISSUE, KIND_PATCH } from "./nip34.js";

export const KIND_KOMMENTAR = 1111;
/** Obergrenze eines Kommentars – längere Texte gehören ins Issue selbst oder in eine Datei. */
export const KOMMENTAR_MAX_BYTES = 20_000;
/** Woran in Repos kommentiert werden darf. */
export const KOMMENTAR_WURZELN: readonly number[] = [KIND_ISSUE, KIND_PATCH];

const HEX64 = /^[0-9a-f]{64}$/;

/** Ein Event, auf das sich ein Kommentar bezieht. */
export interface KommentarBezug {
  id: string;
  autor: string;
  kind: number;
}

export interface GelesenerKommentar {
  id: string;
  autor: string;
  /** Issue oder Patch, unter dem die Diskussion steht. */
  wurzel: KommentarBezug;
  /** Worauf geantwortet wird – die Wurzel selbst oder ein Kommentar. */
  eltern: KommentarBezug;
  text: string;
  zeit: number;
}

function pruefeBezug(b: KommentarBezug): void {
  if (!HEX64.test(b.id) || !HEX64.test(b.autor)) throw new ProtokollFehler("kommentar-bezug", "Kommentar ohne gültigen Bezug");
}

export function baueKommentar(k: { wurzel: KommentarBezug; eltern?: KommentarBezug; text: string }, autor: string): UnsignedEvent {
  const text = k.text.trim();
  if (!text) throw new ProtokollFehler("kommentar-leer", "Kommentar ohne Text");
  if (new TextEncoder().encode(text).length > KOMMENTAR_MAX_BYTES) {
    throw new ProtokollFehler("kommentar-gross", `Kommentar zu groß (höchstens ${KOMMENTAR_MAX_BYTES / 1000} KB)`, { kb: KOMMENTAR_MAX_BYTES / 1000 });
  }
  if (!KOMMENTAR_WURZELN.includes(k.wurzel.kind)) throw new ProtokollFehler("kommentar-wurzel", "Kommentare nur an Issues und Patches");
  const eltern = k.eltern ?? k.wurzel;
  const direkt = eltern.id === k.wurzel.id && eltern.kind === k.wurzel.kind;
  if (!direkt && eltern.kind !== KIND_KOMMENTAR) throw new ProtokollFehler("kommentar-wurzel", "Kommentare nur an Issues und Patches");
  pruefeBezug(k.wurzel);
  pruefeBezug(eltern);
  return buildEvent(autor, KIND_KOMMENTAR, [
    ["E", k.wurzel.id, "", k.wurzel.autor], ["K", String(k.wurzel.kind)], ["P", k.wurzel.autor],
    ["e", eltern.id, "", eltern.autor], ["k", String(eltern.kind)], ["p", eltern.autor],
  ], text);
}

/** Kommentar streng lesen: fremde Daten – nur an Issues und Patches, Bezüge in fester Form. */
export function leseKommentar(ev: NostrEvent): GelesenerKommentar {
  if (ev.kind !== KIND_KOMMENTAR) throw new Error(`Kein Kommentar: Kind ${ev.kind}`);
  const tag = (name: string) => ev.tags.find((t) => t[0] === name);
  const wurzel = { id: tag("E")?.[1] ?? "", autor: getTag(ev, "P") ?? "", kind: Number(getTag(ev, "K")) };
  const eltern = { id: tag("e")?.[1] ?? "", autor: getTag(ev, "p") ?? "", kind: Number(getTag(ev, "k")) };
  for (const b of [wurzel, eltern]) if (!HEX64.test(b.id) || !HEX64.test(b.autor)) throw new Error("Kommentar ohne gültigen Bezug");
  if (!KOMMENTAR_WURZELN.includes(wurzel.kind)) throw new Error("Kommentar nicht an einem Issue oder Patch");
  // Direkt an der Wurzel: dasselbe Event; sonst die Antwort auf einen Kommentar
  const direkt = eltern.kind === wurzel.kind && eltern.id === wurzel.id;
  if (!direkt && eltern.kind !== KIND_KOMMENTAR) throw new Error("Kommentar mit ungültigem Bezug");
  const text = ev.content.trim();
  if (!text || new TextEncoder().encode(text).length > KOMMENTAR_MAX_BYTES) throw new Error("Kommentar leer oder zu groß");
  return { id: ev.id, autor: ev.pubkey, wurzel, eltern, text, zeit: ev.created_at };
}

/** Die Kommentare unter einer Wurzel, ältester zuerst – Ungültiges fällt heraus. */
export function kommentareZu(wurzelId: string, events: readonly NostrEvent[]): GelesenerKommentar[] {
  const out: GelesenerKommentar[] = [];
  for (const ev of events) {
    try {
      const k = leseKommentar(ev);
      if (k.wurzel.id === wurzelId) out.push(k);
    } catch { /* fremdes Unfug-Event */ }
  }
  return out.sort((a, b) => a.zeit - b.zeit || a.id.localeCompare(b.id));
}
