/**
 * Abzeichen: die einen bedeuten etwas, die anderen sind Dekoration.
 *
 * DER UNTERSCHIED, DER ZÄHLT
 * Ein Abzeichen, das man sich selbst verleihen kann, sagt nichts aus. Hier
 * gibt es drei Herkünfte, und sie werden getrennt angezeigt:
 *
 *   **verdient** — aus Protokoll-Ereignissen abgeleitet. Jeder kann
 *     nachrechnen, dass der Träger dreißig Tage lang Jobs geliefert hat.
 *     Das ist die einzige Sorte, die ohne Vertrauen funktioniert.
 *   **verliehen** — jemand hat es vergeben. Wert genau so viel wie der
 *     Ruf des Ausstellers.
 *   **selbst** — jemand hat es sich selbst gegeben.
 *
 * Selbstverliehene werden NICHT weggelassen. Sie zu verstecken wäre
 * bevormundend; sie wie die anderen aussehen zu lassen wäre irreführend. Der
 * Betrachter soll den Unterschied sehen und selbst urteilen.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { inspectPicture } from "./profile.js";

/** Abzeichen-Definition (NIP-58). */
export const KIND_BADGE_DEFINITION = 30009;
/** Verleihung. */
export const KIND_BADGE_AWARD = 8;

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  image?: string;
  issuerPubkey: string;
  createdAt: number;
}

export function buildBadgeDefinition(
  b: Omit<BadgeDefinition, "createdAt">, createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", b.id],
    ["name", b.name],
    ["description", b.description],
  ];
  if (b.image) tags.push(["image", b.image]);
  return buildEvent(b.issuerPubkey, KIND_BADGE_DEFINITION, tags, "", createdAt);
}

export function parseBadgeDefinition(ev: NostrEvent): BadgeDefinition {
  if (ev.kind !== KIND_BADGE_DEFINITION) throw new Error(`keine Abzeichen-Definition: kind ${ev.kind}`);
  const id = getTag(ev, "d");
  if (!id) throw new Error("Abzeichen ohne Kennung");
  const bild = getTag(ev, "image") ?? undefined;
  return {
    id,
    name: getTag(ev, "name") ?? id,
    description: getTag(ev, "description") ?? "",
    // Ein Abzeichenbild ist eine fremde Adresse wie jede andere.
    image: inspectPicture(bild).ok ? bild : undefined,
    issuerPubkey: ev.pubkey,
    createdAt: ev.created_at,
  };
}

export function buildBadgeAward(
  badgeId: string, issuerPubkey: string, recipients: string[], createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    issuerPubkey, KIND_BADGE_AWARD,
    [["a", `${KIND_BADGE_DEFINITION}:${issuerPubkey}:${badgeId}`],
     ...recipients.map((r) => ["p", r])],
    "", createdAt,
  );
}

export type BadgeSource = "verdient" | "verliehen" | "selbst";

export interface HeldBadge {
  definition: BadgeDefinition;
  source: BadgeSource;
  awardedAt: number;
  /** Bei "verdient": woraus es folgt. */
  basis?: string;
}

export interface EarnedBadge {
  id: string;
  name: string;
  description: string;
  basis: string;
}

/**
 * Sammelt die Abzeichen einer Person.
 *
 * Verdiente stehen oben, weil sie die einzigen sind, die ohne Vertrauen
 * gelten. Danach Verliehene, zuletzt Selbstvergebene.
 */
export function collectBadges(
  pubkey: string,
  events: NostrEvent[],
  earned: EarnedBadge[] = [],
): HeldBadge[] {
  const definitionen = new Map<string, BadgeDefinition>();
  for (const ev of events) {
    if (ev.kind !== KIND_BADGE_DEFINITION) continue;
    try {
      const d = parseBadgeDefinition(ev);
      definitionen.set(`${d.issuerPubkey}:${d.id}`, d);
    } catch { /* unbrauchbar */ }
  }

  const out: HeldBadge[] = earned.map((e) => ({
    definition: {
      id: e.id, name: e.name, description: e.description,
      issuerPubkey: "protokoll", createdAt: 0,
    },
    source: "verdient" as const,
    awardedAt: 0,
    basis: e.basis,
  }));

  const gesehen = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== KIND_BADGE_AWARD) continue;
    if (!ev.tags.some((t) => t[0] === "p" && t[1] === pubkey)) continue;
    const a = getTag(ev, "a");
    if (!a) continue;
    const teile = a.split(":");
    if (teile.length < 3) continue;
    const key = `${teile[1]}:${teile.slice(2).join(":")}`;
    const def = definitionen.get(key);
    if (!def) continue;
    if (gesehen.has(key)) continue;

    // Nur der Aussteller selbst kann sein Abzeichen verleihen. Ohne diese
    // Pruefung koennte jeder fremde Abzeichen an sich vergeben.
    if (ev.pubkey !== def.issuerPubkey) continue;
    gesehen.add(key);

    out.push({
      definition: def,
      source: def.issuerPubkey === pubkey ? "selbst" : "verliehen",
      awardedAt: ev.created_at,
    });
  }

  const rang: Record<BadgeSource, number> = { verdient: 0, verliehen: 1, selbst: 2 };
  return out.sort((a, b) => rang[a.source] - rang[b.source] || b.awardedAt - a.awardedAt);
}

/** Herkunftstext — gehoert in die Anzeige, nicht in einen Hilfetext. */
export function badgeSourceLabel(b: HeldBadge): string {
  switch (b.source) {
    case "verdient":
      return `Nachgerechnet: ${b.basis ?? "aus Protokoll-Ereignissen"}`;
    case "verliehen":
      return `Verliehen von ${b.definition.issuerPubkey.slice(0, 8)}…`;
    default:
      return "Selbst vergeben — sagt nichts über irgendetwas aus.";
  }
}
