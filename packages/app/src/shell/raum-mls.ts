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
  gruppenRaum, raumDefinition, raumNachricht, raumRollen, raumZuweisung,
  type Channel, type GruppenRaum, type InneresSenden, type Role,
} from "@freedomstack/protocol";
import { mlsGesperrt, mlsGruende, mlsGruppenStand, mlsLadeEin, mlsSendeEvent, mlsSetzeAdmins } from "./mls-konto.js";
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
  { id: "ankuendigungen", name: "ankündigungen", privacy: "verschluesselt", writeRoles: ["mod"], position: 1 },
];
const ROLLEN: Role[] = [
  { id: "mod", name: "Redaktion", rank: 50, permissions: ["lesen", "schreiben", "threads", "anheften"] },
  { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben", "threads"] },
];

/** Einen privaten Raum anlegen: Gruppe nur mit mir, dann Kanäle und Rollen hinein. */
export async function legePrivatenRaumAn(name: string): Promise<string> {
  const gesperrt = mlsGesperrt();
  if (gesperrt) throw new Error(`Private Räume: ${gesperrt}`);
  const gruppe = await mlsGruende(name);
  if (!gruppe) throw new Error("Private Räume: keine eigenen Relays oder Gruppe nicht angelegt");
  await merkePrivatenRaum(gruppe);
  for (const s of [raumDefinition(gruppe, { name, kanaele: KANAELE }), raumRollen(gruppe, ROLLEN)]) {
    if (!(await mlsSendeEvent(gruppe, s))) throw new Error("Raum angelegt, aber Kanäle nicht gesendet – kein Relay nahm an");
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

export function sendePrivat(gruppe: string, kanal: string, text: string): Promise<boolean> {
  return mlsSendeEvent(gruppe, raumNachricht({ kanal, text }));
}

/**
 * Jemanden einladen – danach den Raumstand erneut senden, sonst sähe der
 * Neue weder Kanäle noch Rollen (er liest nur, was nach seinem Eintritt kommt).
 */
export async function ladeInPrivatenRaum(raum: PrivaterRaum, pk: string): Promise<string> {
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
  for (const s of stand) if (!(await mlsSendeEvent(raum.gruppe, s))) return "eingeladen – Raumstand nicht gesendet";
  return "eingeladen";
}

/** Moderatoren ernennen oder absetzen – die Admins der Gruppe, per Commit. Ich bleibe dabei. */
export function setzeModeratoren(raum: PrivaterRaum, moderatoren: string[]): Promise<boolean> {
  const neu = [...new Set([raum.ich, ...moderatoren.filter((m) => raum.mitglieder.includes(m))])];
  return mlsSetzeAdmins(raum.gruppe, neu);
}
