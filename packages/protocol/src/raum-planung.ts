/**
 * Umfragen und Termine in privaten Räumen (Sammlung Neuordnung, B-15a;
 * entschieden 30.09.2026, R1 A).
 *
 * Standard-Events anderer Clients, kein eigenes Format – aber nur als innere
 * Events der MLS-Gruppe, wie alles im privaten Raum: Relays sehen Kind 445.
 * - **Umfrage** nach NIP-88: Kind 1068, die Frage als Inhalt, je Antwort
 *   `["option", <id>, <text>]`, `["polltype", "singlechoice" | "multiplechoice"]`,
 *   optional `["endsAt", <unix>]`. **Stimme**: Kind 1018 mit `["e", <umfrage>]`
 *   und je gewählter Antwort `["response", <id>]`.
 * - **Termin** nach NIP-52: Kind 31923 mit Uhrzeit (`start`/`end` als
 *   Unix-Zeit, `start_tzid`) oder 31922 ganztägig (`start`/`end` als
 *   JJJJ-MM-TT), dazu `d`, `title`, `location`; die Beschreibung als Inhalt.
 *   **Antwort**: Kind 31925 mit `["e", <termin>]`, `["a", <art>:<autor>:<d>]`
 *   und `["status", "accepted" | "declined" | "tentative"]`.
 * Vorn steht wie bei jedem inneren Event `["space", <raum>]`, bei Umfrage und
 * Termin dazu `["h", <kanal>]`. Bezüge sind die Ids der inneren Events (wie bei
 * Antworten und Löschungen); wer schrieb, belegt MLS.
 *
 * Ausgewertet wird streng (Fremddaten): Umfrage und Termin nur von jemandem,
 * der in den Kanal schreiben darf; je Mitglied zählt die letzte Stimme bzw.
 * Antwort – bei einer Umfrage nur bis `endsAt`, bei einfacher Wahl nur die
 * erste bekannte Antwort. Gelöschtes (5 vom Autor, 4891 vom Admin) fällt weg.
 */
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { ProtokollFehler } from "./fehler.js";
import type { GruppenRaum, InneresEvent, InneresSenden } from "./raum-gruppe.js";
import { canWriteTo } from "./spaces.js";

/** Umfrage (NIP-88). */
export const ART_UMFRAGE = 1068;
/** Stimme zu einer Umfrage (NIP-88). */
export const ART_STIMME = 1018;
/** Ganztägiger Termin (NIP-52). */
export const ART_TERMIN_TAG = 31922;
/** Termin mit Uhrzeit (NIP-52). */
export const ART_TERMIN_ZEIT = 31923;
/** Zu- oder Absage zu einem Termin (NIP-52). */
export const ART_TERMIN_ANTWORT = 31925;

/** Grenzen – beim Bauen geprüft, beim Lesen fällt heraus, was sie überschreitet. */
export const PLANUNG_GRENZEN = {
  frage: 500,
  optionenMin: 2,
  optionenMax: 20,
  option: 100,
  titel: 200,
  ort: 200,
  text: 2000,
} as const;

export type TerminStatus = "accepted" | "declined" | "tentative";
export const TERMIN_STATUS: readonly TerminStatus[] = ["accepted", "declined", "tentative"];

const HEX64 = /^[0-9a-f]{64}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const KANAL = /^[A-Za-z0-9._-]{1,64}$/;
const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1];

function ungueltig(was: string): never {
  throw new ProtokollFehler("planung-ungueltig", `Umfrage oder Termin ungültig: ${was}`, { was });
}

const textOk = (s: string, max: number) => s.trim().length > 0 && s.length <= max;
function gueltigesDatum(s: string): boolean {
  if (!DATUM.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ------------------------------------------------------------ Bauen

/** Eine Umfrage im Kanal. Die Antworten heißen „0“, „1“, … in ihrer Reihenfolge. */
export function raumUmfrage(raumId: string, u: { kanal: string; frage: string; optionen: readonly string[]; mehrfach?: boolean; endet?: number }): InneresSenden {
  if (!KANAL.test(u.kanal)) ungueltig("Kanal");
  if (!textOk(u.frage, PLANUNG_GRENZEN.frage)) ungueltig("Frage");
  const optionen = u.optionen.map((o) => o.trim());
  if (optionen.length < PLANUNG_GRENZEN.optionenMin || optionen.length > PLANUNG_GRENZEN.optionenMax) ungueltig("Zahl der Antworten");
  if (optionen.some((o) => !textOk(o, PLANUNG_GRENZEN.option)) || new Set(optionen).size !== optionen.length) ungueltig("Antwort");
  if (u.endet !== undefined && (!Number.isSafeInteger(u.endet) || u.endet <= 0)) ungueltig("Ende");
  const tags: string[][] = [["space", raumId], ["h", u.kanal], ...optionen.map((o, i) => ["option", String(i), o]), ["polltype", u.mehrfach ? "multiplechoice" : "singlechoice"]];
  if (u.endet !== undefined) tags.push(["endsAt", String(u.endet)]);
  return { art: ART_UMFRAGE, tags, text: u.frage.trim() };
}

/** Stimme: die gewählten Antworten einer Umfrage (Id des inneren Events). */
export function raumStimme(raumId: string, umfrage: string, optionen: readonly string[]): InneresSenden {
  if (!HEX64.test(umfrage)) ungueltig("Umfrage");
  if (optionen.length === 0 || optionen.some((o) => !/^\d{1,2}$/.test(o))) ungueltig("Antwort");
  return { art: ART_STIMME, tags: [["space", raumId], ["e", umfrage], ...[...new Set(optionen)].map((o) => ["response", o])], text: "" };
}

/**
 * Ein Termin im Kanal: `beginn` als Unix-Zeit (mit Uhrzeit) oder als
 * JJJJ-MM-TT (ganztägig); `ende` in derselben Form, nicht vor dem Beginn.
 */
export function raumTermin(raumId: string, t: {
  kanal: string; titel: string; beginn: number | string; ende?: number | string; ort?: string; text?: string; zeitzone?: string;
}): InneresSenden {
  if (!KANAL.test(t.kanal)) ungueltig("Kanal");
  if (!textOk(t.titel, PLANUNG_GRENZEN.titel)) ungueltig("Titel");
  const ganztags = typeof t.beginn === "string";
  const zeitOk = (v: number | string) => (ganztags ? typeof v === "string" && gueltigesDatum(v) : typeof v === "number" && Number.isSafeInteger(v) && v > 0);
  if (!zeitOk(t.beginn)) ungueltig("Beginn");
  if (t.ende !== undefined && (!zeitOk(t.ende) || t.ende < t.beginn)) ungueltig("Ende");
  if (t.ort !== undefined && t.ort.length > PLANUNG_GRENZEN.ort) ungueltig("Ort");
  if ((t.text ?? "").length > PLANUNG_GRENZEN.text) ungueltig("Beschreibung");
  const tags: string[][] = [["space", raumId], ["h", t.kanal], ["d", bytesToHex(randomBytes(16))], ["title", t.titel.trim()], ["start", String(t.beginn)]];
  if (t.ende !== undefined) tags.push(["end", String(t.ende)]);
  if (!ganztags && t.zeitzone && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(t.zeitzone)) tags.push(["start_tzid", t.zeitzone]);
  if (t.ort?.trim()) tags.push(["location", t.ort.trim()]);
  return { art: ganztags ? ART_TERMIN_TAG : ART_TERMIN_ZEIT, tags, text: (t.text ?? "").trim() };
}

/** Zu- oder Absage zu einem Termin (so, wie `raumTermine()` ihn liefert). */
export function raumTerminAntwort(raumId: string, termin: { id: string; von: string; art: number; d: string }, status: TerminStatus): InneresSenden {
  if (!HEX64.test(termin.id) || !HEX64.test(termin.von) || !/^[0-9a-f]{32}$/.test(termin.d)) ungueltig("Termin");
  if (termin.art !== ART_TERMIN_TAG && termin.art !== ART_TERMIN_ZEIT) ungueltig("Termin");
  if (!TERMIN_STATUS.includes(status)) ungueltig("Status");
  return {
    art: ART_TERMIN_ANTWORT,
    tags: [["space", raumId], ["e", termin.id], ["a", `${termin.art}:${termin.von}:${termin.d}`], ["d", bytesToHex(randomBytes(16))], ["status", status]],
    text: "",
  };
}

// ------------------------------------------------------------ Auswerten

export interface RaumUmfrage {
  id: string;
  von: string;
  kanal: string;
  frage: string;
  mehrfach: boolean;
  endet?: number;
  beendet: boolean;
  zeit: number;
  optionen: { id: string; text: string; stimmen: number }[];
  /** Wie viele Mitglieder abgestimmt haben. */
  teilnehmer: number;
  /** Meine Wahl (letzte Stimme), wenn ich abgestimmt habe. */
  meine?: string[];
}

export interface RaumTermin {
  id: string;
  von: string;
  art: number;
  d: string;
  kanal: string;
  titel: string;
  ganztags: boolean;
  beginn: number | string;
  ende?: number | string;
  zeitzone?: string;
  ort?: string;
  text: string;
  zeit: number;
  zusagen: number;
  absagen: number;
  vielleicht: number;
  meine?: TerminStatus;
}

/** Je Mitglied das letzte Event (Zeit, bei Gleichstand die größere Id). */
function letzteJe(l: readonly InneresEvent[]): Map<string, InneresEvent> {
  const out = new Map<string, InneresEvent>();
  for (const e of l) {
    const a = out.get(e.von);
    if (!a || e.zeit > a.zeit || (e.zeit === a.zeit && e.id > a.id)) out.set(e.von, e);
  }
  return out;
}

/** Darf der Autor in diesen Kanal schreiben (wie bei Nachrichten)? */
function imKanal(e: InneresEvent, raum: GruppenRaum): string | undefined {
  const kanal = tag(e, "h");
  const k = raum.zustand.space?.channels.find((c) => c.id === kanal);
  return k && canWriteTo(e.von, k, raum.zustand) ? k.id : undefined;
}

/** Die Umfragen des Raums, älteste zuerst. `jetzt` in Sekunden. */
export function raumUmfragen(raumId: string, ereignisse: readonly InneresEvent[], raum: GruppenRaum, p: { ich?: string; jetzt?: number } = {}): RaumUmfrage[] {
  const jetzt = p.jetzt ?? Math.floor(Date.now() / 1000);
  const imRaum = (e: InneresEvent) => tag(e, "space") === raumId && !raum.geloescht.has(e.id);
  const out: RaumUmfrage[] = [];
  for (const e of ereignisse) {
    if (e.art !== ART_UMFRAGE || !imRaum(e)) continue;
    const kanal = imKanal(e, raum);
    if (!kanal || !textOk(e.text, PLANUNG_GRENZEN.frage)) continue;
    const optionen = new Map<string, string>();
    for (const t of e.tags) if (t[0] === "option" && t[1] && !optionen.has(t[1]) && textOk(t[2] ?? "", PLANUNG_GRENZEN.option)) optionen.set(t[1], t[2]!);
    if (optionen.size < PLANUNG_GRENZEN.optionenMin || optionen.size > PLANUNG_GRENZEN.optionenMax) continue;
    const ende = Number(tag(e, "endsAt"));
    const endet = Number.isSafeInteger(ende) && ende > 0 ? ende : undefined;
    const mehrfach = tag(e, "polltype") === "multiplechoice";
    // Stimmen: nur bekannte Antworten, bis zum Ende; je Mitglied die letzte gültige
    const gueltig = ereignisse.filter((s) => s.art === ART_STIMME && tag(s, "space") === raumId && tag(s, "e") === e.id
      && (endet === undefined || s.zeit <= endet) && s.tags.some((t) => t[0] === "response" && optionen.has(t[1] ?? "")));
    const zaehler = new Map([...optionen.keys()].map((id) => [id, 0]));
    let meine: string[] | undefined;
    const letzte = letzteJe(gueltig);
    for (const [wer, s] of letzte) {
      const wahl = [...new Set(s.tags.filter((t) => t[0] === "response" && optionen.has(t[1] ?? "")).map((t) => t[1]!))];
      const zaehlt = mehrfach ? wahl : wahl.slice(0, 1);
      for (const id of zaehlt) zaehler.set(id, zaehler.get(id)! + 1);
      if (wer === p.ich) meine = zaehlt;
    }
    out.push({
      id: e.id, von: e.von, kanal, frage: e.text.trim(), mehrfach, endet, beendet: endet !== undefined && jetzt > endet, zeit: e.zeit,
      optionen: [...optionen].map(([id, text]) => ({ id, text, stimmen: zaehler.get(id)! })), teilnehmer: letzte.size, meine,
    });
  }
  return out.sort((a, b) => a.zeit - b.zeit || (a.id < b.id ? -1 : 1));
}

/** Die Termine des Raums, nach Beginn. */
export function raumTermine(raumId: string, ereignisse: readonly InneresEvent[], raum: GruppenRaum, p: { ich?: string } = {}): RaumTermin[] {
  const imRaum = (e: InneresEvent) => tag(e, "space") === raumId && !raum.geloescht.has(e.id);
  const out: RaumTermin[] = [];
  for (const e of ereignisse) {
    if ((e.art !== ART_TERMIN_TAG && e.art !== ART_TERMIN_ZEIT) || !imRaum(e)) continue;
    const kanal = imKanal(e, raum);
    const titel = tag(e, "title") ?? "";
    const d = tag(e, "d") ?? "";
    if (!kanal || !textOk(titel, PLANUNG_GRENZEN.titel) || !/^[0-9a-f]{32}$/.test(d) || e.text.length > PLANUNG_GRENZEN.text) continue;
    const ganztags = e.art === ART_TERMIN_TAG;
    const lies = (roh: string | undefined): number | string | undefined => {
      if (roh === undefined) return undefined;
      if (ganztags) return gueltigesDatum(roh) ? roh : undefined;
      const n = Number(roh);
      return /^\d{1,12}$/.test(roh) && Number.isSafeInteger(n) && n > 0 ? n : undefined;
    };
    const beginn = lies(tag(e, "start"));
    if (beginn === undefined) continue;
    const endeRoh = tag(e, "end");
    const ende = lies(endeRoh);
    if (endeRoh !== undefined && (ende === undefined || ende < beginn)) continue;
    const ort = tag(e, "location");
    const zeitzone = ganztags ? undefined : tag(e, "start_tzid");
    const antworten = ereignisse.filter((a) => a.art === ART_TERMIN_ANTWORT && tag(a, "space") === raumId && tag(a, "e") === e.id
      && TERMIN_STATUS.includes(tag(a, "status") as TerminStatus));
    const zahl = { accepted: 0, declined: 0, tentative: 0 };
    let meine: TerminStatus | undefined;
    for (const [wer, a] of letzteJe(antworten)) {
      const s = tag(a, "status") as TerminStatus;
      zahl[s]++;
      if (wer === p.ich) meine = s;
    }
    out.push({
      id: e.id, von: e.von, art: e.art, d, kanal, titel: titel.trim(), ganztags, beginn, ende,
      zeitzone: zeitzone && zeitzone.length <= 64 ? zeitzone : undefined,
      ort: ort && ort.length <= PLANUNG_GRENZEN.ort ? ort : undefined, text: e.text.trim(), zeit: e.zeit,
      zusagen: zahl.accepted, absagen: zahl.declined, vielleicht: zahl.tentative, meine,
    });
  }
  const sekunden = (v: number | string) => (typeof v === "number" ? v : Date.parse(`${v}T00:00:00Z`) / 1000);
  return out.sort((a, b) => sekunden(a.beginn) - sekunden(b.beginn) || (a.id < b.id ? -1 : 1));
}
