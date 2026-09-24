/**
 * Community-Moderation: opt-in, auf Community-Ebene, vom Gründer gesetzt.
 *
 * WARUM ÜBERHAUPT
 * Der öffentliche Feed wurde gestrichen, weil ein unmoderierter globaler Stream
 * zwangsläufig Inhalte transportiert, für die es in einem betreiberlosen System
 * keine Handhabe gibt. Communities haben dasselbe Problem eine Ebene tiefer —
 * es verschwindet nicht dadurch, dass die Gruppe kleiner ist.
 *
 * WAS MODERATION HIER IST — UND WAS NICHT
 * Sie ist ein **Filter beim Empfänger**, kein Löschen. Niemand kann ein Event
 * von den Relays entfernen; wer behauptet, er könne es, lügt. Was geht: Der
 * Gründer einer Community benennt Moderatoren, diese veröffentlichen signierte
 * Ausblend- und Sperrlisten, und Clients wenden sie an — für **diese**
 * Community und für niemanden sonst.
 *
 * DIE EIGENSCHAFT, DIE DAS VERTRETBAR MACHT
 * Jeder Nutzer kann die Moderation seiner Community abschalten und sieht dann
 * alles. Das ist kein Schlupfloch, sondern der Unterschied zwischen einer
 * Hausordnung und einer Zensur: Die eine gilt, weil man dazugehören will, die
 * andere, weil man nicht anders kann.
 *
 * WAS BEWUSST FEHLT
 * Keine netzweite Sperrliste. Eine Liste, die für alle Communities gilt, wäre
 * genau die zentrale Instanz, die das Projekt nicht haben will — und der erste
 * Ort, an dem jemand Druck ausüben würde.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Moderatoren einer Community — nur der Gründer darf das setzen. */
export const KIND_COMMUNITY_MODERATORS = 34550;
/** Eine Nachricht ausblenden. */
export const KIND_MODERATION_HIDE = 34551;
/** Ein Mitglied sperren. */
export const KIND_MODERATION_BAN = 34552;

export interface CommunityModerators {
  communityId: string;
  ownerPubkey: string;
  moderators: string[];
  /** Regeln im Klartext — was gilt hier. */
  rules?: string;
  createdAt: number;
}

export function buildModeratorList(
  communityId: string,
  ownerPubkey: string,
  moderators: string[],
  rules?: string,
  createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", `mods:${communityId}`],
    ["h", communityId],
    ...moderators.map((m) => ["p", m, "moderator"]),
  ];
  return buildEvent(ownerPubkey, KIND_COMMUNITY_MODERATORS, tags, rules ?? "", createdAt);
}

export function parseModeratorList(ev: NostrEvent): CommunityModerators {
  if (ev.kind !== KIND_COMMUNITY_MODERATORS) throw new Error(`keine Moderatorenliste: kind ${ev.kind}`);
  const communityId = getTag(ev, "h");
  if (!communityId) throw new Error("Liste ohne Community");
  return {
    communityId,
    ownerPubkey: ev.pubkey,
    moderators: ev.tags.filter((t) => t[0] === "p" && t[2] === "moderator").map((t) => t[1]),
    rules: ev.content || undefined,
    createdAt: ev.created_at,
  };
}

export interface ModerationAction {
  communityId: string;
  moderatorPubkey: string;
  /** Bei "hide": Event-ID. Bei "ban": Pubkey. */
  target: string;
  kind: "hide" | "ban";
  /** Begründung. Ohne sie wirkt Moderation willkürlich. */
  reason: string;
  createdAt: number;
}

export function buildHide(
  communityId: string, moderatorPubkey: string, eventId: string, reason: string, createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    moderatorPubkey, KIND_MODERATION_HIDE,
    [["d", `hide:${eventId}`], ["h", communityId], ["e", eventId]],
    reason, createdAt,
  );
}

export function buildBan(
  communityId: string, moderatorPubkey: string, pubkey: string, reason: string, createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    moderatorPubkey, KIND_MODERATION_BAN,
    [["d", `ban:${pubkey}`], ["h", communityId], ["p", pubkey]],
    reason, createdAt,
  );
}

export function parseModerationAction(ev: NostrEvent): ModerationAction {
  const communityId = getTag(ev, "h");
  if (!communityId) throw new Error("Maßnahme ohne Community");
  if (ev.kind === KIND_MODERATION_HIDE) {
    const target = getTag(ev, "e");
    if (!target) throw new Error("Ausblendung ohne Ziel");
    return { communityId, moderatorPubkey: ev.pubkey, target, kind: "hide", reason: ev.content, createdAt: ev.created_at };
  }
  if (ev.kind === KIND_MODERATION_BAN) {
    const target = getTag(ev, "p");
    if (!target) throw new Error("Sperre ohne Ziel");
    return { communityId, moderatorPubkey: ev.pubkey, target, kind: "ban", reason: ev.content, createdAt: ev.created_at };
  }
  throw new Error(`keine Moderations-Maßnahme: kind ${ev.kind}`);
}

export interface ModerationState {
  communityId: string;
  ownerPubkey?: string;
  moderators: Set<string>;
  hiddenEvents: Map<string, ModerationAction>;
  bannedPubkeys: Map<string, ModerationAction>;
  rules?: string;
  /** Maßnahmen von Nicht-Moderatoren — verworfen, aber nachvollziehbar. */
  ignored: { by: string; reason: string }[];
}

/**
 * Baut den Moderationsstand einer Community.
 *
 * Nur Maßnahmen von benannten Moderatoren zählen. Ohne diese Prüfung könnte
 * jeder alles ausblenden — die „Moderation" wäre dann ein Werkzeug für genau
 * die Leute, gegen die sie helfen soll.
 */
export function buildModerationState(
  communityId: string,
  events: NostrEvent[],
): ModerationState {
  const state: ModerationState = {
    communityId,
    moderators: new Set(),
    hiddenEvents: new Map(),
    bannedPubkeys: new Map(),
    ignored: [],
  };

  // 1. Neueste Moderatorenliste des Gründers finden.
  let neueste: CommunityModerators | null = null;
  for (const ev of events) {
    if (ev.kind !== KIND_COMMUNITY_MODERATORS) continue;
    let m: CommunityModerators;
    try {
      m = parseModeratorList(ev);
    } catch {
      continue;
    }
    if (m.communityId !== communityId) continue;
    // Bei Moderatorenlisten gewinnt die NEUESTE: Der Gründer muss jemanden
    // absetzen können. (Anders als beim Referral, wo die früheste zählt —
    // dort geht es um eine Zuordnung, hier um eine Vollmacht.)
    if (!neueste || m.createdAt > neueste.createdAt) neueste = m;
  }
  if (neueste) {
    state.ownerPubkey = neueste.ownerPubkey;
    state.rules = neueste.rules;
    state.moderators = new Set([neueste.ownerPubkey, ...neueste.moderators]);
  }

  // 2. Maßnahmen anwenden — nur von Moderatoren.
  for (const ev of events) {
    if (ev.kind !== KIND_MODERATION_HIDE && ev.kind !== KIND_MODERATION_BAN) continue;
    let a: ModerationAction;
    try {
      a = parseModerationAction(ev);
    } catch {
      continue;
    }
    if (a.communityId !== communityId) continue;
    if (!state.moderators.has(a.moderatorPubkey)) {
      state.ignored.push({ by: a.moderatorPubkey, reason: "nicht als Moderator benannt" });
      continue;
    }
    if (a.kind === "hide") state.hiddenEvents.set(a.target, a);
    else state.bannedPubkeys.set(a.target, a);
  }

  return state;
}

export interface FilterOptions {
  /** Moderation anwenden? Der Nutzer entscheidet. */
  enabled: boolean;
  /**
   * Ausgeblendetes als Platzhalter zeigen statt spurlos zu entfernen.
   *
   * Der Unterschied ist wichtig: Eine Lücke, die man sieht, ist Moderation.
   * Eine, die man nicht sieht, ist Manipulation.
   */
  showPlaceholders?: boolean;
}

export interface FilteredMessage {
  event: NostrEvent;
  hidden: boolean;
  /** Warum ausgeblendet — steht im Platzhalter. */
  reason?: string;
  by?: string;
}

/**
 * Wendet den Moderationsstand auf Nachrichten an.
 *
 * Entfernt nichts, sondern markiert. Der Client entscheidet, ob er einen
 * Platzhalter zeigt oder die Nachricht weglässt — und der Nutzer kann die
 * Moderation abschalten und sieht dann alles.
 */
export function applyModeration(
  messages: NostrEvent[],
  state: ModerationState,
  opts: FilterOptions,
): FilteredMessage[] {
  return messages.map((ev) => {
    if (!opts.enabled) return { event: ev, hidden: false };

    const versteckt = state.hiddenEvents.get(ev.id);
    if (versteckt) {
      return { event: ev, hidden: true, reason: versteckt.reason || "ausgeblendet", by: versteckt.moderatorPubkey };
    }
    const gesperrt = state.bannedPubkeys.get(ev.pubkey);
    if (gesperrt) {
      return { event: ev, hidden: true, reason: gesperrt.reason || "Absender gesperrt", by: gesperrt.moderatorPubkey };
    }
    return { event: ev, hidden: false };
  });
}

/** Darf diese Person in dieser Community moderieren? */
export function canModerate(pubkey: string, state: ModerationState): boolean {
  return state.moderators.has(pubkey);
}

/**
 * Was der Nutzer über die Moderation seiner Community wissen soll.
 *
 * Steht im Protokoll, damit jeder Client dieselbe Auskunft geben kann.
 * Moderation, die man nicht durchschaut, erzeugt genau das Misstrauen, das
 * dieses Projekt vermeiden will.
 */
export function moderationInfo(state: ModerationState, enabled: boolean): string {
  if (!state.ownerPubkey) {
    return "Diese Community hat keine Moderation. Du siehst alles, was gesendet wird.";
  }
  const zeilen = [
    `Moderiert von ${state.moderators.size} Person(en), eingesetzt vom Gründer.`,
    state.rules ? `Regeln: ${state.rules}` : "Keine Regeln hinterlegt.",
    `${state.hiddenEvents.size} Nachricht(en) ausgeblendet, ${state.bannedPubkeys.size} Absender gesperrt.`,
    "",
    enabled
      ? "Du siehst die moderierte Ansicht. Abschaltbar — dann siehst du alles."
      : "Moderation ist bei dir AUS. Du siehst auch, was ausgeblendet wurde.",
    "",
    // Die ehrliche Grenze gehört dazu.
    "Ausblenden heißt nicht löschen: Die Nachrichten bleiben auf den Relays und",
    "sind für jeden sichtbar, der ohne diesen Filter liest.",
  ];
  return zeilen.join("\n");
}
