/**
 * Private Räume als MLS-Gruppen (Schritt 2.3a).
 *
 * Ein privater Raum ist eine MLS-Gruppe nach Marmot. Alles darin – Definition
 * mit Kanälen, Rollenliste, Zuweisungen, Nachrichten, Löschungen – sind innere
 * Events: MLS verschlüsselt sie und belegt, wer sie schrieb. Relays sehen nur
 * Kind 445 mit einer zufälligen Gruppen-Kennung (Regel „mls-gruppe“).
 *
 * Rechte – anders als im offenen Raum (spaces.ts):
 * - **Moderatoren sind die Admins der MLS-Gruppe.** Wer Admin ist, legt die
 *   Gruppe selbst per Commit fest (`adminsSetzen`), nicht ein Event; nur ein
 *   Admin kann einladen und entfernen. Bei Löschungen (4891) belegt MLS, ob
 *   der Absender beim Senden Admin war (`admin`) – eine spätere Absetzung
 *   macht sie nicht ungültig. Für alles andere stellt MDK das nicht fest;
 *   dort zählt, wer heute Admin ist.
 * - **Definition und Rollenliste** zählen nur von Admins; die neueste gilt.
 *   Wird ihr Autor abgesetzt, gilt die neueste eines heutigen Admins.
 * - **Zuweisungen** wie im offenen Raum: von Admins, sonst nur mit
 *   `rollen_vergeben` und unter dem eigenen Rang.
 * - **Mitglieder ohne Zuweisung** haben die Rolle „mitglied“, wenn es sie
 *   gibt, sonst lesen, schreiben und Threads.
 * - **Lesen können alle Mitglieder alle Kanäle** – ein Kanal ordnet hier,
 *   er verschlüsselt nicht eigens.
 * - **Löschen:** ein Admin jede Nachricht (Kind 4891 nach Marmot), jeder die
 *   eigene (Kind 5).
 */
import type { NostrEvent, UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";
import {
  ALL_PERMISSIONS, KIND_CHANNEL_MESSAGE, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES,
  type Channel, type Permission, type Role, type SpaceState, buildRoleGrant, buildRoles, buildSpace, canWriteTo, parseRoles, parseSpace,
} from "./spaces.js";

/** Chat-Nachricht (Marmot, Kind 9) – im Raum mit dem Kanal im h-Tag. */
export const ART_RAUM_CHAT = 9;
/** Löschen durch einen Admin (Marmot, Kind 4891). */
export const ART_ADMIN_LOESCHUNG = 4891;
/** Eigene Nachricht zurückziehen (Kind 5). */
export const ART_EIGENE_LOESCHUNG = 5;

/** Ein inneres Event, wie MLS es zustellt (`MlsNachricht`). */
export interface InneresEvent {
  id: string;
  /** Absender, von MLS belegt. */
  von: string;
  art: number;
  tags: string[][];
  text: string;
  zeit: number;
  /** War der Absender beim Senden Admin? Nur wo MLS es belegt (4891); sonst fehlt es. */
  admin?: boolean;
}

/** Was in die Gruppe geht (`sendenEvent(gruppe, art, tags, text)`). */
export interface InneresSenden {
  art: number;
  tags: string[][];
  text: string;
}

const ADMIN_ROLLE = "__admin";
const MITGLIED_ROLLE = "mitglied";
const GRUNDRECHTE: Permission[] = ["lesen", "schreiben", "threads"];
const HEX64 = /^[0-9a-f]{64}$/;
const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1];

/** Als Event geformt, damit die Auswertung aus spaces.ts gilt (ohne Signatur – MLS belegt den Absender). */
function alsEvent(e: InneresEvent, kind = e.art, tags = e.tags): NostrEvent {
  return { id: e.id, pubkey: e.von, created_at: e.zeit, kind, tags, content: e.text, sig: "" };
}

const neueste = (l: InneresEvent[]) => l.reduce<InneresEvent | undefined>((a, b) => (!a || b.zeit > a.zeit || (b.zeit === a.zeit && b.id > a.id) ? b : a), undefined);

// ------------------------------------------------------------ Senden

export function raumDefinition(raumId: string, r: { name: string; beschreibung?: string; kanaele: Channel[] }): InneresSenden {
  const u = buildSpace({ spaceId: raumId, name: r.name, description: r.beschreibung, ownerPubkey: "", channels: r.kanaele });
  return { art: u.kind, tags: u.tags, text: "" };
}

export function raumRollen(raumId: string, rollen: Role[]): InneresSenden {
  const u = buildRoles(raumId, "", rollen.filter((r) => r.id !== ADMIN_ROLLE));
  return { art: u.kind, tags: u.tags, text: "" };
}

export function raumZuweisung(raumId: string, mitglied: string, rollen: string[]): InneresSenden {
  if (!HEX64.test(mitglied)) throw new Error("Mitglied ungültig");
  const u = buildRoleGrant(raumId, "", mitglied, rollen.filter((r) => r !== ADMIN_ROLLE));
  return { art: u.kind, tags: u.tags, text: "" };
}

export function raumNachricht(m: { kanal: string; text: string; threadRoot?: string; replyTo?: string; erwaehnt?: string[] }): InneresSenden {
  const tags: string[][] = [["h", m.kanal]];
  if (m.threadRoot) tags.push(["e", m.threadRoot, "", "root"]);
  if (m.replyTo) tags.push(["e", m.replyTo, "", "reply"]);
  for (const p of m.erwaehnt ?? []) tags.push(["p", p, "", "mention"]);
  return { art: ART_RAUM_CHAT, tags, text: m.text };
}

/** Löschen: als Admin jede Nachricht, sonst nur die eigene. */
export function raumLoeschung(ziel: string, alsAdmin: boolean): InneresSenden {
  return { art: alsAdmin ? ART_ADMIN_LOESCHUNG : ART_EIGENE_LOESCHUNG, tags: [["e", ziel]], text: "" };
}

// ------------------------------------------------------------ Auswerten

export interface GruppenRaum {
  /** Für `can`, `canWriteTo`, `buildThreads`, `unreadBadges` aus spaces.ts. */
  zustand: SpaceState;
  /** Kanalnachrichten als Kind-42-Form für `buildThreads` – ohne Gelöschtes und ohne Schreibrecht Verworfenes. */
  nachrichten: NostrEvent[];
  /** Verworfenes mit Grund (Definition oder Rollen nicht von einem Admin, …). */
  verworfen: { id: string; grund: string }[];
}

/**
 * Den Raum aus den inneren Events bauen. `admins`: heutige Admins der Gruppe
 * (`mls.admins()`), `mitglieder`: heutige Mitglieder (`mls.mitglieder()`).
 */
export function gruppenRaum(raumId: string, ereignisse: readonly InneresEvent[], p: { admins: readonly string[]; mitglieder: readonly string[] }): GruppenRaum {
  const zustand: SpaceState = { roles: new Map(), grants: new Map(), ignored: [] };
  const verworfen: { id: string; grund: string }[] = [];
  const imRaum = (e: InneresEvent) => tag(e, "space") === raumId;
  // Von MLS belegt, wo es das gibt – sonst die heutige Admin-Liste der Gruppe
  const warAdmin = (e: InneresEvent) => e.admin ?? p.admins.includes(e.von);

  for (const e of ereignisse) {
    if ((e.art === KIND_SPACE || e.art === KIND_SPACE_ROLES) && imRaum(e) && !warAdmin(e)) verworfen.push({ id: e.id, grund: "nur Admins legen Kanäle und Rollen fest" });
  }
  const def = neueste(ereignisse.filter((e) => e.art === KIND_SPACE && imRaum(e) && warAdmin(e)));
  if (def) {
    try {
      zustand.space = parseSpace(alsEvent(def));
    } catch {
      verworfen.push({ id: def.id, grund: "Definition unlesbar" });
    }
  }
  const rollenEv = neueste(ereignisse.filter((e) => e.art === KIND_SPACE_ROLES && imRaum(e) && warAdmin(e)));
  if (rollenEv) for (const r of parseRoles(alsEvent(rollenEv)).roles) if (r.id !== ADMIN_ROLLE) zustand.roles.set(r.id, r);
  // Admins haben alle Rechte und jede Rolle (auch Kanäle mit Schreibrollen)
  zustand.roles.set(ADMIN_ROLLE, { id: ADMIN_ROLLE, name: "Moderator", permissions: [...ALL_PERMISSIONS], rank: Number.MAX_SAFE_INTEGER });

  // Zuweisungen in zeitlicher Folge – wie spaces.ts, nur mit Admins statt Besitzer
  const zuweisungen = ereignisse.filter((e) => e.art === KIND_ROLE_GRANT && imRaum(e)).sort((a, b) => a.zeit - b.zeit || (a.id < b.id ? -1 : 1));
  for (const e of zuweisungen) {
    const wer = tag(e, "p");
    if (!wer || !HEX64.test(wer)) continue;
    const rollen = e.tags.filter((t) => t[0] === "role").map((t) => t[1]!).filter((r) => r !== ADMIN_ROLLE && zustand.roles.has(r));
    if (!warAdmin(e)) {
      const eigene = (zustand.grants.get(e.von) ?? []).map((id) => zustand.roles.get(id)!).filter(Boolean);
      if (!eigene.some((r) => r.permissions.includes("rollen_vergeben"))) {
        verworfen.push({ id: e.id, grund: "darf keine Rollen vergeben" });
        continue;
      }
      const rang = Math.max(...eigene.map((r) => r.rank));
      if (rollen.some((r) => zustand.roles.get(r)!.rank >= rang)) {
        verworfen.push({ id: e.id, grund: "Rolle über eigenem Rang" });
        continue;
      }
    }
    zustand.grants.set(wer, rollen);
  }

  // Mitglieder und Autoren ohne Zuweisung: Grundrechte. Wer schrieb, war beim Schreiben Mitglied (MLS).
  if (!zustand.roles.has(MITGLIED_ROLLE)) zustand.roles.set(MITGLIED_ROLLE, { id: MITGLIED_ROLLE, name: "Mitglied", permissions: GRUNDRECHTE, rank: 0 });
  for (const pk of new Set([...p.mitglieder, ...ereignisse.map((e) => e.von)])) {
    if (!zustand.grants.has(pk)) zustand.grants.set(pk, [MITGLIED_ROLLE]);
  }
  const alleRollen = [...zustand.roles.keys()];
  for (const pk of p.admins) zustand.grants.set(pk, alleRollen);

  // Löschungen: Admin (beim Senden) jede Nachricht, sonst nur die eigene
  const autorVon = new Map(ereignisse.filter((e) => e.art === ART_RAUM_CHAT).map((e) => [e.id, e.von]));
  const geloescht = new Set<string>();
  for (const e of ereignisse) {
    const ziel = tag(e, "e");
    if (!ziel || !autorVon.has(ziel)) continue;
    if ((e.art === ART_ADMIN_LOESCHUNG && warAdmin(e)) || (e.art === ART_EIGENE_LOESCHUNG && autorVon.get(ziel) === e.von)) geloescht.add(ziel);
    else if (e.art === ART_ADMIN_LOESCHUNG || e.art === ART_EIGENE_LOESCHUNG) verworfen.push({ id: e.id, grund: "darf diese Nachricht nicht löschen" });
  }

  // Schreibrecht je Nachricht nach der heutigen Rollenlage (für Chat belegt MDK
  // keinen Admin-Stand beim Senden) – nach einer Absetzung verschwinden also
  // Nachrichten in Kanälen, in die nur Moderatoren schreiben.
  const kanaele = new Map((zustand.space?.channels ?? []).map((c) => [c.id, c]));
  const nachrichten: NostrEvent[] = [];
  for (const e of ereignisse) {
    const kanal = e.art === ART_RAUM_CHAT ? kanaele.get(tag(e, "h") ?? "") : undefined;
    if (!kanal || geloescht.has(e.id)) continue;
    if (!canWriteTo(e.von, kanal, zustand)) {
      verworfen.push({ id: e.id, grund: "kein Schreibrecht in diesem Kanal" });
      continue;
    }
    nachrichten.push(alsEvent(e, KIND_CHANNEL_MESSAGE, [["space", raumId], ...e.tags.filter((t) => t[0] !== "space")]));
  }
  return { zustand, nachrichten, verworfen };
}

// ------------------------------------------------------------ Meldungen (8.5)

/** Meldung nach NIP-56 (Kind 1984) – in privaten Räumen nur versiegelt an die Moderatoren. */
export const KIND_RAUM_MELDUNG = 1984;
/** Gründe nach NIP-56. */
export const MELDE_GRUENDE = ["spam", "illegal", "nudity", "profanity", "impersonation", "malware", "other"] as const;
export type MeldeGrund = (typeof MELDE_GRUENDE)[number];
const GRUPPE_HEX = /^[0-9a-f]{32,64}$/;

export interface RaumMeldung {
  /** Wer meldet – aus dem Siegel, nicht aus dem Umschlag. */
  von: string;
  gruppe: string;
  /** Id des inneren Events der gemeldeten Nachricht. */
  ziel: string;
  autor: string;
  grund: MeldeGrund;
  notiz: string;
  zeit: number;
}

/**
 * Eine Nachricht melden (8.5): je Moderator ein eigener Umschlag, nie in die
 * Gruppe – die anderen Mitglieder erfahren nichts, die Relays sehen nur
 * Umschläge. Nicht an sich selbst.
 */
export async function baueRaumMeldung(p: {
  von: Signer; moderatoren: readonly string[]; gruppe: string; ziel: string; autor: string; grund: MeldeGrund; notiz?: string; nowSecs?: number;
}): Promise<NostrEvent[]> {
  if (!GRUPPE_HEX.test(p.gruppe) || !HEX64.test(p.ziel) || !HEX64.test(p.autor)) throw new Error("Meldung unvollständig");
  if (!MELDE_GRUENDE.includes(p.grund)) throw new Error("Grund ungültig");
  const ich = p.von.publicKey();
  const an = [...new Set(p.moderatoren)].filter((m) => HEX64.test(m) && m !== ich);
  if (an.length === 0) throw new Error("kein Moderator außer dir");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: ich, kind: KIND_RAUM_MELDUNG, created_at: now,
    tags: [["e", p.ziel, p.grund], ["p", p.autor, p.grund], ["h", p.gruppe]],
    content: (p.notiz ?? "").slice(0, 500),
  };
  return Promise.all(an.map((m) => giftWrapMitSigner(kern, p.von, m, { nowSecs: now })));
}

/** Umschlag öffnen: eine Meldung an mich? Sonst null (dann ist es etwas anderes). */
export async function oeffneRaumMeldung(wrap: NostrEvent, signer: Signer): Promise<RaumMeldung | null> {
  const u = await giftUnwrapMitSigner(wrap, signer).catch(() => null);
  if (!u?.ok || !u.inner || !u.senderPubkey || u.inner.kind !== KIND_RAUM_MELDUNG) return null;
  const e = u.inner.tags.find((t) => t[0] === "e");
  const autor = tag(u.inner, "p");
  const gruppe = tag(u.inner, "h");
  const grund = e?.[2] as MeldeGrund | undefined;
  if (!e || !HEX64.test(e[1] ?? "") || !autor || !HEX64.test(autor) || !gruppe || !GRUPPE_HEX.test(gruppe) || !grund || !MELDE_GRUENDE.includes(grund)) return null;
  return { von: u.senderPubkey, gruppe, ziel: e[1]!, autor, grund, notiz: u.inner.content.slice(0, 500), zeit: u.inner.created_at };
}
