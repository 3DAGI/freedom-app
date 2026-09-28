/**
 * Private Räume in der App (Schritt 2.3b): ein Raum ist eine MLS-Gruppe –
 * Kanäle, Rollen und Nachrichten sind innere Events (`raum-gruppe.ts`), Relays
 * sehen nur Kind 445. Neue Räume sind privat; öffentliche (Kind 42) nur
 * ausdrücklich.
 *
 * Wer eingeladen wird, liest ältere Nachrichten nicht (Vorwärtsgeheimnis) –
 * also auch nicht Kanäle und Rollenliste. Nach jeder Einladung sendet der
 * Einladende deshalb den Raumstand (Definition, Rollen, Zuweisungen) erneut.
 *
 * Welche Räume privat sind, liegt nur im Tresor (`freedom.raeume.privat`) –
 * MLS gibt es ohnehin nur mit Tresor.
 */
import {
  baueRaumMeldung, gruppenRaum, oeffneRaumMeldung, raumDefinition, raumLoeschung, raumNachricht, raumRollen, raumZuweisung,
  type Channel, type GruppenRaum, type InneresSenden, type MeldeGrund, type NostrEvent, type RaumMeldung, type Role,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { type EinladungsErgebnis, mlsEntferne, mlsGesperrt, mlsGruende, mlsGruppenStand, mlsLadeEin, mlsSendeEvent, mlsSetzeAdmins } from "./mls-konto.js";
import { posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim } from "./tresor.js";

export const LS_PRIVATE_RAEUME = "freedom.raeume.privat";
/** So heißen private Räume in der Raumleiste und in `freedom.spaces`-freien Listen. */
export const PRIVAT = "mls:";
const HEX = /^[0-9a-f]{32,64}$/;

export const istPrivat = (raumId: string | null | undefined): boolean => !!raumId?.startsWith(PRIVAT);
export const gruppeVon = (raumId: string) => raumId.slice(PRIVAT.length);

/** Private Räume (Gruppen-Ids) aus dem Tresor. */
export function privateRaeume(): string[] {
  try {
    const l = JSON.parse(geheim.getItem(LS_PRIVATE_RAEUME) ?? "[]") as unknown;
    return Array.isArray(l) ? l.filter((g): g is string => typeof g === "string" && HEX.test(g)) : [];
  } catch {
    return [];
  }
}

export async function merkePrivatenRaum(gruppe: string): Promise<void> {
  if (!HEX.test(gruppe) || privateRaeume().includes(gruppe)) return;
  await geheim.setItem(LS_PRIVATE_RAEUME, JSON.stringify([...privateRaeume(), gruppe]));
}

/** Grundausstattung wie bei offenen Räumen – nur verschlüsselt. */
const KANAELE: Channel[] = [
  { id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 },
  { id: "ankuendigungen", name: "ankündigungen", privacy: "verschluesselt", writeRoles: ["mod"], position: 1 }, // kein UI-Text
];
const ROLLEN: Role[] = [
  { id: "mod", name: "Redaktion", rank: 50, permissions: ["lesen", "schreiben", "threads", "anheften"] }, // kein UI-Text
  { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben", "threads"] }, // kein UI-Text
];

/** Einen privaten Raum anlegen: Gruppe nur mit mir, dann Kanäle und Rollen hinein. */
export async function legePrivatenRaumAn(name: string): Promise<string> {
  const gesperrt = mlsGesperrt();
  if (gesperrt) throw new Error(t("bau.raeumeGesperrt", { grund: gesperrt }));
  const gruppe = await mlsGruende(name);
  if (!gruppe) throw new Error(t("bau.raeumeNichtAngelegt"));
  await merkePrivatenRaum(gruppe);
  for (const s of [raumDefinition(gruppe, { name, kanaele: KANAELE }), raumRollen(gruppe, ROLLEN)]) {
    if (!(await mlsSendeEvent(gruppe, s))) throw new Error(t("bau.kanaeleNichtGesendet"));
  }
  return gruppe;
}

export interface PrivaterRaum extends GruppenRaum {
  gruppe: string;
  admins: string[];
  mitglieder: string[];
  ich: string;
}

/** Den Raum aus den inneren Events bauen (nach dem Abgleich der Gruppe). */
export async function ladePrivatenRaum(gruppe: string): Promise<PrivaterRaum | null> {
  const stand = await mlsGruppenStand(gruppe);
  if (!stand) return null;
  return { ...gruppenRaum(gruppe, stand.ereignisse, stand), gruppe, admins: stand.admins, mitglieder: stand.mitglieder, ich: stand.ich };
}

/** Seit C.2c mit Bezug: Thread (`threadRoot`), Antwort auf (`replyTo`), Erwähnte – Ids der inneren Events. */
export function sendePrivat(gruppe: string, kanal: string, text: string, bezug: { threadRoot?: string; replyTo?: string; erwaehnt?: string[] } = {}): Promise<boolean> {
  return mlsSendeEvent(gruppe, raumNachricht({ kanal, text, ...bezug }));
}

/**
 * Jemanden einladen – danach den Raumstand erneut senden, sonst sähe der
 * Neue weder Kanäle noch Rollen (er liest nur, was nach seinem Eintritt kommt).
 */
export async function ladeInPrivatenRaum(raum: PrivaterRaum, pk: string): Promise<EinladungsErgebnis | "ohne Raumstand"> { // kein UI-Text
  const r = await mlsLadeEin(raum.gruppe, pk);
  if (r !== "eingeladen") return r;
  const st = raum.zustand;
  const stand: InneresSenden[] = [];
  if (st.space) stand.push(raumDefinition(raum.gruppe, { name: st.space.name, beschreibung: st.space.description, kanaele: st.space.channels }));
  const rollen = [...st.roles.values()].filter((x) => !x.id.startsWith("__"));
  if (rollen.length > 0) stand.push(raumRollen(raum.gruppe, rollen));
  for (const [wer, ids] of st.grants) {
    const eigene = ids.filter((id) => !id.startsWith("__") && id !== "mitglied");
    if (eigene.length > 0 && !raum.admins.includes(wer)) stand.push(raumZuweisung(raum.gruppe, wer, eigene));
  }
  for (const s of stand) if (!(await mlsSendeEvent(raum.gruppe, s))) return "ohne Raumstand"; // kein UI-Text
  return "eingeladen";
}

/** Kennung → Schlüssel des Textes. */
const EINLADUNG: Record<Exclude<EinladungsErgebnis, "eingeladen"> | "ohne Raumstand", string> = { // kein UI-Text
  "kein Admin": "bau.einladungKeinAdmin", // kein UI-Text
  "kein KeyPackage": "bau.einladungKeinKeyPackage", // kein UI-Text
  "nicht zugestellt": "bau.einladungNichtZugestellt", // kein UI-Text
  "ohne Raumstand": "bau.einladungOhneRaumstand", // kein UI-Text
};

/** Warum eine Einladung nicht (ganz) klappte – in der Sprache der Oberfläche; anderes (Fehlermeldung) bleibt. */
export function einladungsText(r: string): string {
  const k = (EINLADUNG as Record<string, string>)[r];
  return k ? t(k) : r;
}

/**
 * Kanal anlegen (C.2d2, nur Moderatoren): die Definition mit dem neuen Kanal
 * in die Gruppe – `gruppenRaum()` nimmt Definitionen nur von Admins an.
 */
export function legePrivatenKanalAn(raum: PrivaterRaum, kanal: Channel): Promise<boolean> {
  const sp = raum.zustand.space;
  if (!sp || !raum.admins.includes(raum.ich)) return Promise.resolve(false);
  return mlsSendeEvent(raum.gruppe, raumDefinition(raum.gruppe, { name: sp.name, beschreibung: sp.description, kanaele: [...sp.channels, kanal] }));
}

/** Moderatoren ernennen oder absetzen – die Admins der Gruppe, per Commit. Ich bleibe dabei. */
export function setzeModeratoren(raum: PrivaterRaum, moderatoren: string[]): Promise<boolean> {
  const neu = [...new Set([raum.ich, ...moderatoren.filter((m) => raum.mitglieder.includes(m))])];
  return mlsSetzeAdmins(raum.gruppe, neu);
}

// ------------------------------------------------------------ Moderation (2.3c, 8.5)

/**
 * Löschen: als Moderator jede Nachricht (4891, MDK prüft beim Senden, dass
 * ich Admin bin), sonst nur die eigene (5). Nie ein öffentliches Event.
 */
export function loescheImRaum(raum: PrivaterRaum, id: string): Promise<boolean> {
  return mlsSendeEvent(raum.gruppe, raumLoeschung(id, raum.admins.includes(raum.ich)));
}

/** Mitglied entfernen (nur Moderatoren): Commit, neuer Schlüssel – keine Sperrliste irgendwo. */
export function entferneAusRaum(raum: PrivaterRaum, pk: string): Promise<boolean> {
  return mlsEntferne(raum.gruppe, pk);
}

/**
 * Melden (8.5): versiegelt an jeden Moderator einzeln, an seinen Posteingang –
 * nie in die Gruppe. Ergebnis: an wie viele Moderatoren es ging.
 */
export async function meldeImRaum(raum: PrivaterRaum, ziel: string, autor: string, grund: MeldeGrund, notiz: string): Promise<number> {
  if (!state.signer) return 0;
  const wraps = await baueRaumMeldung({ von: state.signer, moderatoren: raum.admins, gruppe: raum.gruppe, ziel, autor, grund, notiz });
  let zugestellt = 0;
  for (const w of wraps) {
    const an = w.tags.find((t) => t[0] === "p")?.[1] ?? "";
    const ziele = await posteingangVon(an).catch(() => [] as string[]);
    if (ziele.length > 0 && (await veroeffentlicheAn(w, ziele)) > 0) zugestellt++;
  }
  return zugestellt;
}

/** Erledigte Meldungen (nur die Ids der Umschläge – nichts vom Inhalt); im Tresor wie die Raumliste. */
export const LS_MELDUNGEN_ERLEDIGT = "freedom.raeume.meldungen.erledigt";
const offeneMeldungen = new Map<string, RaumMeldung>();
const erledigt = (): string[] => {
  try {
    const l = JSON.parse(geheim.getItem(LS_MELDUNGEN_ERLEDIGT) ?? "[]") as unknown;
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
let beiMeldung: () => void = () => {};
export const wennMeldung = (f: () => void) => { beiMeldung = f; };

/**
 * Posteingang (aus tabs/kommunikation.ts): eine Meldung zu einem meiner
 * privaten Räume? Nur im Speicher – sie trägt, was jemand über andere sagt.
 */
export async function alsRaumMeldung(w: NostrEvent): Promise<null> {
  if (!state.signer || offeneMeldungen.has(w.id) || erledigt().includes(w.id)) return null;
  const m = await oeffneRaumMeldung(w, state.signer);
  if (m && privateRaeume().includes(m.gruppe)) {
    offeneMeldungen.set(w.id, m);
    beiMeldung();
  }
  return null;
}

/** Offene Meldungen zu einem Raum – nur für seine Moderatoren. */
export function meldungenFuer(raum: PrivaterRaum): [string, RaumMeldung][] {
  if (!raum.admins.includes(raum.ich)) return [];
  return [...offeneMeldungen].filter(([, m]) => m.gruppe === raum.gruppe);
}

export async function meldungErledigt(wrapId: string): Promise<void> {
  offeneMeldungen.delete(wrapId);
  await geheim.setItem(LS_MELDUNGEN_ERLEDIGT, JSON.stringify([...erledigt(), wrapId].slice(-500)));
}
