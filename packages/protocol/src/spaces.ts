/**
 * Räume: Server, Kanäle, Rollen, Threads.
 *
 * WAS HIER ANDERS IST ALS BEI DISCORD
 * Dort entscheidet ein Server, wer was darf, und setzt es durch. Hier gibt es
 * keinen Server. Rechte sind **Regeln, die jeder Client selbst auswertet** —
 * aus signierten Ereignissen, die alle sehen können.
 *
 * Das hat eine Folge, die man aussprechen muss: **Ein Leserecht ist keine
 * Verschlüsselung.** Wenn ein Kanal öffentlich auf Relays liegt, kann ihn
 * jeder lesen, der die Client-Regeln ignoriert. Was hier durchgesetzt wird,
 * ist die Ordnung unter denen, die mitspielen wollen — wie eine Hausordnung.
 * Wer wirklich Vertraulichkeit braucht, braucht einen verschlüsselten Kanal,
 * und der hat andere Kosten (siehe `ChannelPrivacy`).
 *
 * SCHREIBRECHTE DAGEGEN WIRKEN.
 * Eine Nachricht von jemandem ohne Schreibrecht wird von jedem regeltreuen
 * Client verworfen — sie steht zwar auf dem Relay, erscheint aber nirgends.
 * Das ist derselbe Mechanismus wie bei der Moderation und aus demselben Grund
 * vertretbar.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { type ModerationState, parseModerationAction } from "./moderation.js";
import { ProtokollFehler } from "./fehler.js";

/** Definition eines Raums (Server). */
export const KIND_SPACE = 34700;
/** Rollen und Rechte. */
export const KIND_SPACE_ROLES = 34701;
/** Rollenzuweisung an ein Mitglied. */
export const KIND_ROLE_GRANT = 34702;
/** Kanal eines offenen Raums, signiert von jemandem mit „kanaele_verwalten“ (B-20). */
export const KIND_RAUM_KANAL = 34703;
/** Nachricht in einem Kanal. */
export const KIND_CHANNEL_MESSAGE = 42;

export type Permission =
  | "lesen"
  | "schreiben"
  | "threads"
  | "anheften"
  | "moderieren"
  | "kanaele_verwalten"
  | "rollen_vergeben"
  /** Repos des Raums pflegen: ankündigen, Patches annehmen und schließen (11.4a). */
  | "repos_pflegen";

export const ALL_PERMISSIONS: Permission[] = [
  "lesen", "schreiben", "threads", "anheften", "moderieren",
  "kanaele_verwalten", "rollen_vergeben", "repos_pflegen",
];

const HEX64 = /^[0-9a-f]{64}$/;
const SPACE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Adresse eines öffentlichen Raums (NIP-01 „a“) – an den Besitzer gebunden (11.4a). */
export function raumAdresse(besitzer: string, spaceId: string): string {
  if (!HEX64.test(besitzer) || !SPACE_ID.test(spaceId)) throw new Error("Raum-Adresse ungültig");
  return `${KIND_SPACE}:${besitzer}:space:${spaceId}`;
}

/** Raum-Adresse lesen (fremde Daten); null, wenn es keine ist. */
export function leseRaumAdresse(a: unknown): { besitzer: string; spaceId: string } | null {
  if (typeof a !== "string") return null;
  const m = /^34700:([0-9a-f]{64}):space:([A-Za-z0-9._-]{1,64})$/.exec(a);
  return m ? { besitzer: m[1], spaceId: m[2] } : null;
}

/**
 * Vertraulichkeit eines Kanals.
 *
 * `offen` — jeder liest mit, auch ohne Client. Ehrlich und billig.
 * `verschluesselt` — nur Mitglieder lesen. Kostet eine Schlüsselverteilung,
 *   und wenn jemand den Raum verlässt, muss der Schlüssel gewechselt werden,
 *   sonst liest er weiter mit. Das ist der eigentliche Aufwand, nicht die
 *   Verschlüsselung selbst.
 */
export type ChannelPrivacy = "offen" | "verschluesselt";

export interface Channel {
  id: string;
  name: string;
  topic?: string;
  privacy: ChannelPrivacy;
  /** Rollen, die schreiben dürfen. Leer = alle Mitglieder. */
  writeRoles: string[];
  position: number;
}

export interface Space {
  spaceId: string;
  name: string;
  description?: string;
  ownerPubkey: string;
  channels: Channel[];
  createdAt: number;
}

export function buildSpace(s: Omit<Space, "createdAt">, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `space:${s.spaceId}`],
    ["space", s.spaceId],
    ["name", s.name],
  ];
  if (s.description) tags.push(["about", s.description]);
  for (const c of s.channels) {
    tags.push([
      "channel", c.id, c.name, c.privacy, String(c.position),
      c.writeRoles.join("|"), c.topic ?? "",
    ]);
  }
  return buildEvent(s.ownerPubkey, KIND_SPACE, tags, "", createdAt);
}

export function parseSpace(ev: NostrEvent): Space {
  if (ev.kind !== KIND_SPACE) throw new Error(`kein Raum: kind ${ev.kind}`);
  const spaceId = getTag(ev, "space");
  const name = getTag(ev, "name");
  if (!spaceId || !name) throw new Error("Raum ohne Kennung oder Namen");

  const channels: Channel[] = ev.tags
    .filter((t) => t[0] === "channel" && t.length >= 4)
    .map((t) => ({
      id: t[1],
      name: t[2],
      privacy: (t[3] === "verschluesselt" ? "verschluesselt" : "offen") as ChannelPrivacy,
      position: Number(t[4] ?? 0),
      writeRoles: (t[5] ?? "").split("|").filter(Boolean),
      topic: t[6] || undefined,
    }))
    .filter((c) => c.id && c.name)
    .sort((a, b) => a.position - b.position);

  return {
    spaceId, name, description: getTag(ev, "about") ?? undefined,
    ownerPubkey: ev.pubkey, channels, createdAt: ev.created_at,
  };
}

export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  /** Rang: höher darf niedrigere verwalten. Verhindert Rangfolge-Tricks. */
  rank: number;
  color?: string;
}

export function buildRoles(
  spaceId: string, ownerPubkey: string, roles: Role[], createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [["d", `roles:${spaceId}`], ["space", spaceId]];
  for (const r of roles) {
    tags.push(["role", r.id, r.name, r.permissions.join("|"), String(r.rank), r.color ?? ""]);
  }
  return buildEvent(ownerPubkey, KIND_SPACE_ROLES, tags, "", createdAt);
}

export function parseRoles(ev: NostrEvent): { spaceId: string; ownerPubkey: string; roles: Role[]; createdAt: number } {
  if (ev.kind !== KIND_SPACE_ROLES) throw new Error(`keine Rollenliste: kind ${ev.kind}`);
  const spaceId = getTag(ev, "space");
  if (!spaceId) throw new Error("Rollen ohne Raum");
  const roles: Role[] = ev.tags
    .filter((t) => t[0] === "role" && t.length >= 4)
    .map((t) => ({
      id: t[1],
      name: t[2],
      permissions: (t[3] ?? "").split("|").filter((p): p is Permission =>
        (ALL_PERMISSIONS as string[]).includes(p)),
      rank: Number(t[4] ?? 0),
      color: t[5] || undefined,
    }))
    .filter((r) => r.id);
  return { spaceId, ownerPubkey: ev.pubkey, roles, createdAt: ev.created_at };
}

export function buildRoleGrant(
  spaceId: string, granterPubkey: string, memberPubkey: string, roleIds: string[], createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    granterPubkey, KIND_ROLE_GRANT,
    [["d", `grant:${spaceId}:${memberPubkey}`], ["space", spaceId],
     ["p", memberPubkey], ...roleIds.map((r) => ["role", r])],
    "", createdAt,
  );
}

export interface SpaceState {
  space?: Space;
  roles: Map<string, Role>;
  /** Mitglied -> Rollen-IDs. */
  grants: Map<string, string[]>;
  ownerPubkey?: string;
  /** Verworfene Zuweisungen mit Grund. */
  ignored: { by: string; reason: string }[];
}

/**
 * Wer einen offenen Raum gegründet hat, wenn nur seine Kennung bekannt ist
 * (Sammlung Neuordnung, B-7): der eigene Schlüssel, wenn er eine gültige
 * Definition geschrieben hat, sonst der einzige Autor gültiger Definitionen.
 * Schreiben mehrere, ist die Kennung mehrdeutig – dann gilt nur die ganze
 * Adresse (`raumAdresse()`), sonst übernähme den Raum, wer zuletzt schreibt.
 */
export function gruenderZurKennung(
  spaceId: string, events: readonly NostrEvent[], ich?: string,
): { besitzer: string } | { fall: "keiner" | "mehrdeutig" } {
  const autoren = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== KIND_SPACE || getTag(ev, "space") !== spaceId || !HEX64.test(ev.pubkey)) continue;
    try { parseSpace(ev); } catch { continue; }
    autoren.add(ev.pubkey);
  }
  if (ich && autoren.has(ich)) return { besitzer: ich };
  if (autoren.size === 1) return { besitzer: [...autoren][0]! };
  return { fall: autoren.size === 0 ? "keiner" : "mehrdeutig" };
}

/**
 * Baut den Zustand eines Raums.
 *
 * Offene Räume nie direkt mit Events aus dem Netz: Hier gewinnt die neueste
 * Definition, gleich von wem – `raumZustandFuer()` (`raum-repo.ts`) nimmt nur
 * die des Gründers aus der Adresse (B-7).
 *
 * Eine Zuweisung zählt nur, wenn der Zuweisende `rollen_vergeben` hat UND
 * einen höheren Rang als die vergebene Rolle. Ohne die Rangprüfung könnte ein
 * Moderator sich selbst zum Besitzer machen — der häufigste Fehler in
 * Rechtesystemen.
 */
export function buildSpaceState(spaceId: string, events: NostrEvent[]): SpaceState {
  const state: SpaceState = { roles: new Map(), grants: new Map(), ignored: [] };

  // Neueste Definition des Besitzers gewinnt: Er muss Kanäle ändern können.
  let spaceEv: NostrEvent | null = null;
  let rolesEv: NostrEvent | null = null;
  for (const ev of events) {
    if (ev.kind === KIND_SPACE && getTag(ev, "space") === spaceId) {
      if (!spaceEv || ev.created_at > spaceEv.created_at) spaceEv = ev;
    }
  }
  if (!spaceEv) return state;

  try {
    state.space = parseSpace(spaceEv);
    state.ownerPubkey = state.space.ownerPubkey;
  } catch {
    return state;
  }

  for (const ev of events) {
    if (ev.kind !== KIND_SPACE_ROLES) continue;
    if (getTag(ev, "space") !== spaceId) continue;
    // Nur der Besitzer definiert Rollen. Sonst legt sich jeder eine an.
    if (ev.pubkey !== state.ownerPubkey) {
      state.ignored.push({ by: ev.pubkey, reason: "Rollen nur vom Besitzer" });
      continue;
    }
    if (!rolesEv || ev.created_at > rolesEv.created_at) rolesEv = ev;
  }
  if (rolesEv) {
    for (const r of parseRoles(rolesEv).roles) state.roles.set(r.id, r);
  }

  // Zuweisungen in zeitlicher Reihenfolge, damit ein frisch Berechtigter
  // weiter vergeben kann.
  const grantEvents = events
    .filter((e) => e.kind === KIND_ROLE_GRANT && getTag(e, "space") === spaceId)
    .sort((a, b) => a.created_at - b.created_at);

  for (const ev of grantEvents) {
    const member = getTag(ev, "p");
    if (!member) continue;
    const roleIds = ev.tags.filter((t) => t[0] === "role").map((t) => t[1]).filter((r) => state.roles.has(r));

    const istBesitzer = ev.pubkey === state.ownerPubkey;
    if (!istBesitzer) {
      const eigene = (state.grants.get(ev.pubkey) ?? []).map((id) => state.roles.get(id)!).filter(Boolean);
      if (!eigene.some((r) => r.permissions.includes("rollen_vergeben"))) {
        state.ignored.push({ by: ev.pubkey, reason: "darf keine Rollen vergeben" });
        continue;
      }
      // Rangprüfung: Niemand vergibt eine Rolle, die über der eigenen steht.
      // Ohne das macht sich ein Moderator selbst zum Besitzer.
      const eigenerRang = Math.max(...eigene.map((r) => r.rank));
      const zuHoch = roleIds.filter((id) => state.roles.get(id)!.rank >= eigenerRang);
      if (zuHoch.length > 0) {
        state.ignored.push({ by: ev.pubkey, reason: `Rolle über eigenem Rang: ${zuHoch.join(", ")}` });
        continue;
      }
    }
    state.grants.set(member, roleIds);
  }

  return state;
}

/** Rechte einer Person in diesem Raum. */
export function permissionsOf(pubkey: string, state: SpaceState): Set<Permission> {
  if (pubkey === state.ownerPubkey) return new Set(ALL_PERMISSIONS);
  const out = new Set<Permission>();
  for (const id of state.grants.get(pubkey) ?? []) {
    const r = state.roles.get(id);
    if (r) for (const p of r.permissions) out.add(p);
  }
  return out;
}

export function can(pubkey: string, perm: Permission, state: SpaceState): boolean {
  return permissionsOf(pubkey, state).has(perm);
}

/** Rang einer Person im Raum: der Gründer über allen, sonst die höchste Rolle (ohne Rolle 0). */
function rangVon(pubkey: string, state: SpaceState): number {
  if (pubkey === state.ownerPubkey) return Number.POSITIVE_INFINITY;
  return Math.max(0, ...(state.grants.get(pubkey) ?? []).map((id) => state.roles.get(id)?.rank ?? 0));
}

/**
 * Moderation eines offenen Raums (Sammlung Neuordnung, B-19): Ausblenden
 * (34551) und Sperren (34552) mit `["h", <kennung>]` zählen nur von jemandem,
 * der im Raum „moderieren“ darf – und nur gegen Niedrigere: Den Gründer trifft
 * keine Maßnahme eines anderen, sonst nur, wenn der Moderator einen höheren
 * Rang hat als das Ziel (wie beim Vergeben von Rollen). Ziel einer
 * Ausblendung ist der Autor der Nachricht aus `nachrichten`. Das Ergebnis ist
 * ein `ModerationState` für `applyModeration()` (moderation.ts).
 */
export function raumModeration(state: SpaceState, massnahmen: readonly NostrEvent[], nachrichten: readonly NostrEvent[]): ModerationState {
  const aus: ModerationState = {
    communityId: state.space?.spaceId ?? "", ownerPubkey: state.ownerPubkey, moderators: new Set(),
    hiddenEvents: new Map(), bannedPubkeys: new Map(), ignored: [],
  };
  if (!state.space || !state.ownerPubkey) return aus;
  for (const pk of [state.ownerPubkey, ...state.grants.keys()]) if (can(pk, "moderieren", state)) aus.moderators.add(pk);
  const autor = new Map(nachrichten.map((e) => [e.id, e.pubkey]));
  for (const ev of [...massnahmen].sort((a, b) => a.created_at - b.created_at)) {
    let m;
    try { m = parseModerationAction(ev); } catch { continue; }
    if (m.communityId !== aus.communityId) continue;
    if (!aus.moderators.has(m.moderatorPubkey)) {
      aus.ignored.push({ by: m.moderatorPubkey, reason: "darf hier nicht moderieren" });
      continue;
    }
    const ziel = m.kind === "ban" ? m.target : autor.get(m.target);
    if (ziel && ziel !== m.moderatorPubkey && rangVon(ziel, state) >= rangVon(m.moderatorPubkey, state)) {
      aus.ignored.push({ by: m.moderatorPubkey, reason: "Ziel steht nicht unter dem Moderator" });
      continue;
    }
    (m.kind === "hide" ? aus.hiddenEvents : aus.bannedPubkeys).set(m.target, m);
  }
  return aus;
}

// ------------------------------------------------------------ Kanäle offener Räume (B-20)

/**
 * Grenzen für Kanal-Events: Kanäle je Raum, Länge von Name und Thema,
 * Schreibrollen je Kanal, und wie weit ein Event in der Zukunft liegen darf.
 * Ohne die Zukunftsgrenze gewönne ein vordatiertes Event gegen jede spätere
 * Änderung, auch die des Gründers.
 */
export const KANAL_GRENZEN = { anzahl: 100, name: 100, thema: 500, rollen: 20, zukunft: 600 } as const;

/** Ein gelesenes Kanal-Event: der Kanal, oder `null`, wenn er entfernt wird. */
export interface RaumKanal {
  adresse: string;
  spaceId: string;
  kanalId: string;
  kanal: Channel | null;
  autor: string;
  zeit: number;
}

function raumKanalEvent(autor: string, adresse: string, kanalId: string, inhalt: string[], createdAt?: number): UnsignedEvent {
  const a = leseRaumAdresse(adresse);
  if (!a || !HEX64.test(autor) || !SPACE_ID.test(kanalId)) throw new ProtokollFehler("raum-kanal", "Kanal ungültig");
  const u = buildEvent(autor, KIND_RAUM_KANAL, [
    ["d", `kanal:${a.spaceId}:${kanalId}`], ["space", a.spaceId], ["a", adresse], inhalt,
  ], "", createdAt);
  if (!leseRaumKanal({ ...u, id: "", sig: "" })) throw new ProtokollFehler("raum-kanal", "Kanal ungültig");
  return u;
}

/**
 * Kanal eines offenen Raums anlegen oder ändern (B-20): ein Event je Kanal,
 * an die Adresse des Raums gebunden. Zählt nur vom Gründer oder von jemandem
 * mit „kanaele_verwalten“ (`mitRaumKanaelen()`). Offene Räume liest jeder mit –
 * ein Kanal hier ist immer „offen“.
 */
export function baueRaumKanal(autor: string, adresse: string, k: Channel, createdAt?: number): UnsignedEvent {
  if (k.privacy !== "offen") throw new ProtokollFehler("raum-kanal", "Kanal ungültig");
  return raumKanalEvent(autor, adresse, k.id, [
    "channel", k.id, k.name, "offen", String(k.position), k.writeRoles.join("|"), k.topic ?? "",
  ], createdAt);
}

/** Kanal eines offenen Raums entfernen (B-20) – mit denselben Rechten wie ändern. */
export function baueKanalEntfernung(autor: string, adresse: string, kanalId: string, createdAt?: number): UnsignedEvent {
  return raumKanalEvent(autor, adresse, kanalId, ["entfernt", kanalId], createdAt);
}

/** Kanal-Event lesen (fremde Daten); null, wenn es keins ist oder eine Grenze überschreitet. */
export function leseRaumKanal(ev: NostrEvent): RaumKanal | null {
  if (ev.kind !== KIND_RAUM_KANAL || !HEX64.test(ev.pubkey) || !Number.isSafeInteger(ev.created_at)) return null;
  const adresse = getTag(ev, "a") ?? "";
  const a = leseRaumAdresse(adresse);
  if (!a || getTag(ev, "space") !== a.spaceId) return null;
  const setzen = ev.tags.filter((t) => t[0] === "channel");
  const entfernt = ev.tags.filter((t) => t[0] === "entfernt");
  if (setzen.length + entfernt.length !== 1) return null;
  const kanalId = (setzen[0] ?? entfernt[0])![1] ?? "";
  if (!SPACE_ID.test(kanalId) || getTag(ev, "d") !== `kanal:${a.spaceId}:${kanalId}`) return null;
  const basis = { adresse, spaceId: a.spaceId, kanalId, autor: ev.pubkey, zeit: ev.created_at };
  if (entfernt.length) return { ...basis, kanal: null };
  const [, , name = "", privacy, position = "", rollen = "", thema = ""] = setzen[0]!;
  const writeRoles = rollen.split("|").filter(Boolean);
  if (!name || name.length > KANAL_GRENZEN.name || privacy !== "offen" || !/^\d{1,6}$/.test(position)
    || writeRoles.length > KANAL_GRENZEN.rollen || thema.length > KANAL_GRENZEN.thema) return null;
  return { ...basis, kanal: { id: kanalId, name, privacy: "offen", position: Number(position), writeRoles, topic: thema || undefined } };
}

/**
 * Darf diese Person den Kanal von `vorher` nach `nachher` bringen (anlegen:
 * `vorher` leer, entfernen: `nachher` null)? Der Gründer immer; sonst nur mit
 * „kanaele_verwalten“ und nur, wenn der Kanal vorher wie nachher nur
 * Schreibrollen bis zum eigenen Rang nennt (B-20). Dieselbe Regel wie in
 * `mitRaumKanaelen()` – die App fragt vorher, statt ein Event zu senden, das
 * niemand zählt (B-20c).
 */
export function darfKanalAendern(pubkey: string, vorher: Channel | null | undefined, nachher: Channel | null, zustand: SpaceState): boolean {
  if (pubkey === zustand.ownerPubkey) return true;
  if (!can(pubkey, "kanaele_verwalten", zustand)) return false;
  const rang = rangVon(pubkey, zustand);
  const rolleRang = (r: string) => zustand.roles.get(r)?.rank ?? Number.POSITIVE_INFINITY;
  return ![vorher, nachher].some((c) => c?.writeRoles.some((r) => rolleRang(r) > rang));
}

/**
 * Kanäle eines offenen Raums (B-20): zur Definition des Gründers kommen die
 * Kanal-Events (34703) an die Adresse des Raums. Je Kanal gilt die neueste
 * Aussage – die Definition sagt etwas über jeden Kanal, den sie nennt, zu
 * ihrer Zeit; was sie nicht nennt, entfernt sie nicht.
 *
 * Von anderen als dem Gründer zählt ein Event nur, wenn der Autor heute
 * „kanaele_verwalten“ hat (wie bei der Moderation, B-19: Wird ihm das Recht
 * entzogen, fallen seine Änderungen weg – ein zurückdatiertes Event aus der
 * Zeit davor hilft ihm deshalb nicht) und der Kanal vorher wie nachher nur
 * Schreibrollen bis zu seinem eigenen Rang nennt: Einen Kanal, in den nur
 * Höhere schreiben, öffnet oder entfernt er nicht. Neue Kanäle höchstens bis
 * `KANAL_GRENZEN.anzahl`, Events höchstens `zukunft` Sekunden voraus.
 */
export function mitRaumKanaelen(
  zustand: SpaceState, events: readonly NostrEvent[], jetzt = Math.floor(Date.now() / 1000),
): SpaceState {
  const space = zustand.space;
  const gruender = zustand.ownerPubkey;
  if (!space || !gruender || !HEX64.test(gruender) || !SPACE_ID.test(space.spaceId)) return zustand;
  const adresse = raumAdresse(gruender, space.spaceId);
  type Aussage = { zeit: number; id: string; autor: string; kanalId: string; kanal: Channel | null; definition: boolean };
  const aussagen: Aussage[] = space.channels.map((c) => ({ zeit: space.createdAt, id: "", autor: gruender, kanalId: c.id, kanal: c, definition: true }));
  for (const ev of events) {
    if (ev.kind !== KIND_RAUM_KANAL || ev.created_at > jetzt + KANAL_GRENZEN.zukunft) continue;
    const k = leseRaumKanal(ev);
    if (k?.adresse === adresse) aussagen.push({ zeit: k.zeit, id: ev.id, autor: k.autor, kanalId: k.kanalId, kanal: k.kanal, definition: false });
  }
  // Zeitlich; bei gleicher Sekunde erst die Definition, dann nach Id – so rechnet jeder Client gleich
  aussagen.sort((x, y) => x.zeit - y.zeit || Number(y.definition) - Number(x.definition) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  const ignored = [...zustand.ignored];
  const stand = new Map<string, Channel | null>();
  for (const a of aussagen) {
    const vorher = stand.get(a.kanalId);
    if (a.autor !== gruender && !darfKanalAendern(a.autor, vorher, a.kanal, zustand)) {
      ignored.push({ by: a.autor, reason: can(a.autor, "kanaele_verwalten", zustand) ? "Kanal über eigenem Rang" : "darf keine Kanäle verwalten" });
      continue;
    }
    if (a.kanal && !vorher && !a.definition && [...stand.values()].filter(Boolean).length >= KANAL_GRENZEN.anzahl) {
      ignored.push({ by: a.autor, reason: "zu viele Kanäle" });
      continue;
    }
    stand.set(a.kanalId, a.kanal);
  }
  const channels = [...stand.values()].filter((c): c is Channel => !!c)
    .sort((x, y) => x.position - y.position || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { ...zustand, space: { ...space, channels }, ignored };
}

/**
 * Darf diese Person in diesen Kanal schreiben?
 *
 * Zwei Bedingungen: das allgemeine Schreibrecht und, falls der Kanal Rollen
 * nennt, eine davon. Ein Ankündigungskanal ist genau das — alle lesen, wenige
 * schreiben.
 */
export function canWriteTo(pubkey: string, channel: Channel, state: SpaceState): boolean {
  if (pubkey === state.ownerPubkey) return true;
  if (!can(pubkey, "schreiben", state)) return false;
  if (channel.writeRoles.length === 0) return true;
  const eigene = new Set(state.grants.get(pubkey) ?? []);
  return channel.writeRoles.some((r) => eigene.has(r));
}

export interface ChannelMessage {
  id: string;
  authorPubkey: string;
  spaceId: string;
  channelId: string;
  content: string;
  /** Wurzelnachricht, wenn dies eine Thread-Antwort ist. */
  threadRoot?: string;
  /** Direkt beantwortete Nachricht. */
  replyTo?: string;
  mentions: string[];
  createdAt: number;
}

export function buildChannelMessage(
  m: Omit<ChannelMessage, "id" | "createdAt">, createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [["space", m.spaceId], ["h", m.channelId]];
  // NIP-10-artig: root vor reply, damit Clients den Thread bauen können.
  if (m.threadRoot) tags.push(["e", m.threadRoot, "", "root"]);
  if (m.replyTo) tags.push(["e", m.replyTo, "", "reply"]);
  for (const p of m.mentions) tags.push(["p", p, "", "mention"]);
  return buildEvent(m.authorPubkey, KIND_CHANNEL_MESSAGE, tags, m.content, createdAt);
}

export function parseChannelMessage(ev: NostrEvent): ChannelMessage {
  if (ev.kind !== KIND_CHANNEL_MESSAGE) throw new Error(`keine Kanalnachricht: kind ${ev.kind}`);
  const channelId = getTag(ev, "h");
  const spaceId = getTag(ev, "space");
  if (!channelId || !spaceId) throw new Error("Nachricht ohne Raum oder Kanal");
  const e = ev.tags.filter((t) => t[0] === "e");
  return {
    id: ev.id,
    authorPubkey: ev.pubkey,
    spaceId,
    channelId,
    content: ev.content,
    threadRoot: e.find((t) => t[3] === "root")?.[1],
    replyTo: e.find((t) => t[3] === "reply")?.[1],
    mentions: ev.tags.filter((t) => t[0] === "p" && t[3] === "mention").map((t) => t[1]),
    createdAt: ev.created_at,
  };
}

export interface ThreadView {
  root: ChannelMessage;
  replies: ChannelMessage[];
  participants: string[];
  lastActivity: number;
}

/**
 * Baut Threads aus einer Kanalliste.
 *
 * Nachrichten von Personen ohne Schreibrecht fallen heraus — auf dem Relay
 * stehen sie weiter, im Kanal erscheinen sie nicht.
 */
export function buildThreads(
  messages: NostrEvent[],
  channel: Channel,
  state: SpaceState,
): { topLevel: ChannelMessage[]; threads: Map<string, ThreadView> } {
  const gueltig: ChannelMessage[] = [];
  for (const ev of messages) {
    let m: ChannelMessage;
    try {
      m = parseChannelMessage(ev);
    } catch {
      continue;
    }
    if (m.channelId !== channel.id) continue;
    if (!canWriteTo(m.authorPubkey, channel, state)) continue;
    gueltig.push(m);
  }
  gueltig.sort((a, b) => a.createdAt - b.createdAt);

  const topLevel = gueltig.filter((m) => !m.threadRoot);
  const threads = new Map<string, ThreadView>();

  for (const m of gueltig) {
    if (!m.threadRoot) continue;
    const root = topLevel.find((t) => t.id === m.threadRoot);
    // Eine Antwort auf eine Nachricht, die es hier nicht gibt, gehoert
    // nirgendwohin — sie verschwinden zu lassen ist ehrlicher, als sie als
    // eigenständige Nachricht auszugeben.
    if (!root) continue;
    const t = threads.get(root.id) ?? { root, replies: [], participants: [], lastActivity: root.createdAt };
    t.replies.push(m);
    if (!t.participants.includes(m.authorPubkey)) t.participants.push(m.authorPubkey);
    t.lastActivity = Math.max(t.lastActivity, m.createdAt);
    threads.set(root.id, t);
  }

  return { topLevel, threads };
}

export interface UnreadState {
  /** Kanal -> Zeitpunkt des letzten Lesens. */
  lastRead: Map<string, number>;
}

export interface ChannelBadge {
  channelId: string;
  unread: number;
  /** Ungelesene, in denen ich erwähnt wurde. */
  mentions: number;
}

/**
 * Ungelesenes je Kanal.
 *
 * Rein lokal — der Lesestand gehört niemandem sonst. Ihn zu veröffentlichen
 * würde verraten, wann jemand online war und was er liest.
 */
export function unreadBadges(
  pubkey: string,
  messages: ChannelMessage[],
  read: UnreadState,
): ChannelBadge[] {
  const proKanal = new Map<string, ChannelBadge>();
  for (const m of messages) {
    if (m.authorPubkey === pubkey) continue;
    const seit = read.lastRead.get(m.channelId) ?? 0;
    if (m.createdAt <= seit) continue;
    const b = proKanal.get(m.channelId) ?? { channelId: m.channelId, unread: 0, mentions: 0 };
    b.unread++;
    if (m.mentions.includes(pubkey)) b.mentions++;
    proKanal.set(m.channelId, b);
  }
  // Erwähnungen zuerst: Sie sind der Grund, warum jemand die App öffnet.
  return [...proKanal.values()].sort((a, b) => b.mentions - a.mentions || b.unread - a.unread);
}

/** Durchsucht Nachrichten. Rein lokal, ohne Suchserver. */
export function searchMessages(
  query: string,
  messages: ChannelMessage[],
  opts: { channelId?: string; fromPubkey?: string; limit?: number } = {},
): ChannelMessage[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  return messages
    .filter((m) => !opts.channelId || m.channelId === opts.channelId)
    .filter((m) => !opts.fromPubkey || m.authorPubkey === opts.fromPubkey)
    .filter((m) => m.content.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, opts.limit ?? 50);
}

/**
 * Was der Nutzer über die Vertraulichkeit eines Kanals wissen muss.
 *
 * Steht im Protokoll, damit jeder Client dieselbe Auskunft gibt. „Privat" ist
 * das Wort, bei dem Missverständnisse am teuersten sind.
 */
export function privacyInfo(channel: Channel): string {
  if (channel.privacy === "verschluesselt") {
    // Seit 2.3: private Räume sind MLS-Gruppen – Entfernen ist ein Schlüsselwechsel
    return [
      "Verschlüsselt (MLS): Nur Mitglieder können mitlesen – alle Kanäle des Raums.",
      "",
      "Grenze: Wer entfernt wird, behält den Schlüssel für alles, was er vorher",
      "gesehen hat. Das Entfernen wechselt den Schlüssel – danach liest er nichts",
      "mehr. Neue Mitglieder lesen nur, was nach ihrem Eintritt kommt.",
    ].join("\n");
  }
  return [
    "Offen: Jeder kann mitlesen, auch ohne diese App.",
    "",
    "Die Rechte hier regeln, wer schreiben darf — nicht, wer lesen kann.",
    "Nachrichten liegen unverschlüsselt auf den Relays.",
  ].join("\n");
}
