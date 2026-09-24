/**
 * Beitragsvergütung: Mitarbeit bezahlen, ohne sie zu verderben.
 *
 * DIE FALLE, DIE HIER UMGANGEN WIRD
 * Der naheliegende Entwurf ist: X % je Beitrag, automatisch ausgezahlt. Er
 * funktioniert nicht, und zwar vorhersehbar. Sobald ein Betrag an einer
 * zählbaren Größe hängt, optimieren Menschen diese Größe: viele kleine
 * Commits statt weniger guter, Änderungen an Stellen, die niemand braucht,
 * Umformatierungen als „Beiträge". Das ist kein Charakterproblem, sondern
 * eine Eigenschaft von Anreizsystemen — wer nach Zeilen bezahlt, bekommt
 * Zeilen.
 *
 * Schlimmer noch: Bezahlte Beiträge verdrängen freiwillige. Wer vorher aus
 * Interesse mitgearbeitet hat, rechnet danach.
 *
 * WAS STATTDESSEN
 * **Rückwirkende Runden.** In festen Abständen wird ein Topf verteilt — für
 * Arbeit, die bereits getan ist. Niemand weiß vorher, was seine Änderung wert
 * sein wird, also gibt es nichts zu optimieren. Bewertet wird, was tatsächlich
 * geholfen hat.
 *
 * Dazu **Kopfgelder** für vorher beschriebene Aufgaben: Wer eine bestimmte
 * Sache baut, bekommt einen zugesagten Betrag. Das ist der Fall, in dem eine
 * feste Zusage richtig ist, weil die Aufgabe vorher definiert wurde.
 *
 * WER ENTSCHEIDET
 * Am Anfang der Projektgründer, offen und nachvollziehbar. Das ist ehrlicher
 * als eine Abstimmung, die ohnehin er kontrolliert. Die Zuteilung wird
 * signiert veröffentlicht — wer sie für unfair hält, kann das belegen, und
 * das ist die eigentliche Kontrolle.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { Contributor } from "./git-contributors.js";

/** Ankündigung einer Runde. */
export const KIND_FUNDING_ROUND = 38059;
/** Zuteilung innerhalb einer Runde. */
export const KIND_FUNDING_ALLOCATION = 38060;
/** Kopfgeld für eine beschriebene Aufgabe. */
export const KIND_BOUNTY = 38061;

export interface FundingRound {
  roundId: string;
  /** Zeitraum, für den Arbeit berücksichtigt wird. */
  fromUnix: number;
  untilUnix: number;
  /** Topf in msat. */
  poolMsat: number;
  /** Woher das Geld kommt — Transparenz ist hier keine Kür. */
  source: string;
  adminPubkey: string;
  createdAt: number;
}

export function buildFundingRound(r: Omit<FundingRound, "createdAt">, createdAt?: number): UnsignedEvent {
  return buildEvent(
    r.adminPubkey,
    KIND_FUNDING_ROUND,
    [
      ["d", `round:${r.roundId}`],
      ["round", r.roundId],
      ["period", String(r.fromUnix), String(r.untilUnix)],
      ["pool_msat", String(r.poolMsat)],
      ["source", r.source],
    ],
    "",
    createdAt,
  );
}

export function parseFundingRound(ev: NostrEvent): FundingRound {
  if (ev.kind !== KIND_FUNDING_ROUND) throw new Error(`keine Runde: kind ${ev.kind}`);
  const roundId = getTag(ev, "round");
  const zeitraum = ev.tags.find((t) => t[0] === "period");
  const pool = Number(getTag(ev, "pool_msat") ?? "NaN");
  if (!roundId || !zeitraum || !Number.isFinite(pool)) throw new Error("Runde unvollständig");
  return {
    roundId,
    fromUnix: Number(zeitraum[1]),
    untilUnix: Number(zeitraum[2]),
    poolMsat: pool,
    source: getTag(ev, "source") ?? "",
    adminPubkey: ev.pubkey,
    createdAt: ev.created_at,
  };
}

export interface FundingAllocation {
  roundId: string;
  recipientPubkey: string;
  amountMsat: number;
  /** Wofür. Ohne Begründung ist eine Zuteilung nicht überprüfbar. */
  reason: string;
}

export function buildAllocation(
  a: FundingAllocation, adminPubkey: string, createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    adminPubkey,
    KIND_FUNDING_ALLOCATION,
    [
      ["d", `alloc:${a.roundId}:${a.recipientPubkey}`],
      ["round", a.roundId],
      ["p", a.recipientPubkey],
      ["amount_msat", String(a.amountMsat)],
    ],
    a.reason,
    createdAt,
  );
}

export function parseAllocation(ev: NostrEvent): FundingAllocation & { adminPubkey: string } {
  if (ev.kind !== KIND_FUNDING_ALLOCATION) throw new Error(`keine Zuteilung: kind ${ev.kind}`);
  const roundId = getTag(ev, "round");
  const recipient = getTag(ev, "p");
  const amount = Number(getTag(ev, "amount_msat") ?? "NaN");
  if (!roundId || !recipient || !Number.isFinite(amount)) throw new Error("Zuteilung unvollständig");
  return { roundId, recipientPubkey: recipient, amountMsat: amount, reason: ev.content, adminPubkey: ev.pubkey };
}

export interface RoundResult {
  round: FundingRound;
  allocations: FundingAllocation[];
  distributedMsat: number;
  remainingMsat: number;
  problems: string[];
  ok: boolean;
}

/**
 * Prüft eine veröffentlichte Runde.
 *
 * Jeder kann das nachrechnen — und genau das ist die Kontrolle. Eine
 * Zuteilung, die niemand überprüfen kann, ist eine Behauptung.
 */
export function verifyRound(roundEvent: NostrEvent, allocationEvents: NostrEvent[]): RoundResult {
  const round = parseFundingRound(roundEvent);
  const problems: string[] = [];
  const allocations: FundingAllocation[] = [];
  const gesehen = new Set<string>();

  for (const ev of allocationEvents) {
    let a: FundingAllocation & { adminPubkey: string };
    try {
      a = parseAllocation(ev);
    } catch {
      continue;
    }
    if (a.roundId !== round.roundId) continue;
    if (a.adminPubkey !== round.adminPubkey) {
      // Sonst könnte jeder sich selbst etwas zuteilen.
      problems.push(`Zuteilung von ${a.adminPubkey.slice(0, 8)}… stammt nicht vom Runden-Admin`);
      continue;
    }
    if (gesehen.has(a.recipientPubkey)) {
      problems.push(`Doppelte Zuteilung an ${a.recipientPubkey.slice(0, 8)}…`);
      continue;
    }
    if (a.amountMsat <= 0) {
      problems.push(`Zuteilung über ${a.amountMsat} msat ist unsinnig`);
      continue;
    }
    if (!a.reason.trim()) {
      // Eine Zuteilung ohne Begründung ist nicht überprüfbar — sie zählt
      // trotzdem, wird aber benannt.
      problems.push(`Zuteilung an ${a.recipientPubkey.slice(0, 8)}… ohne Begründung`);
    }
    gesehen.add(a.recipientPubkey);
    allocations.push(a);
  }

  const distributed = allocations.reduce((s, a) => s + a.amountMsat, 0);
  if (distributed > round.poolMsat) {
    problems.push(`Es wurden ${distributed} msat verteilt, im Topf waren ${round.poolMsat}`);
  }

  return {
    round,
    allocations,
    distributedMsat: distributed,
    remainingMsat: round.poolMsat - distributed,
    problems,
    ok: problems.length === 0,
  };
}

export interface SuggestionInput {
  contributors: Contributor[];
  poolMsat: number;
  /** Mindestbetrag — darunter lohnt die Zahlung nicht. */
  minPayoutMsat?: number;
}

export interface Suggestion {
  pubkey: string;
  suggestedMsat: number;
  share: number;
  basis: string;
}

/**
 * Vorschlag für eine Aufteilung — ausdrücklich nur ein Vorschlag.
 *
 * Gewichtet nach AKTIVEN TAGEN, nicht nach Anzahl der Beiträge. Wer an dreißig
 * Tagen etwas beigetragen hat, hat das Projekt länger getragen als jemand mit
 * dreißig Beiträgen an einem Nachmittag — und die Zahl der Beiträge ist die,
 * die sich am leichtesten aufblähen lässt.
 *
 * Die Entscheidung bleibt beim Menschen. Ein Automatismus würde genau die
 * Optimierung zurückbringen, die rückwirkende Runden vermeiden sollen.
 */
export function suggestAllocations(input: SuggestionInput): {
  suggestions: Suggestion[];
  unallocatedMsat: number;
  note: string;
} {
  const min = input.minPayoutMsat ?? 10_000;
  const gesamt = input.contributors.reduce((s, c) => s + c.activeDays, 0);
  if (gesamt === 0 || input.poolMsat <= 0) {
    return { suggestions: [], unallocatedMsat: input.poolMsat, note: "Keine Grundlage für einen Vorschlag." };
  }

  const roh = input.contributors.map((c) => ({
    pubkey: c.pubkey,
    share: c.activeDays / gesamt,
    suggestedMsat: Math.floor((input.poolMsat * c.activeDays) / gesamt),
    basis: `${c.activeDays} aktive Tage, ${c.contributions} Beiträge`,
  }));

  const suggestions = roh.filter((s) => s.suggestedMsat >= min);
  const verteilt = suggestions.reduce((s, x) => s + x.suggestedMsat, 0);

  return {
    suggestions: suggestions.sort((a, b) => b.suggestedMsat - a.suggestedMsat),
    unallocatedMsat: input.poolMsat - verteilt,
    note:
      "Vorschlag auf Basis aktiver Tage. Er ersetzt keine Bewertung: Eine " +
      "einzelne Änderung kann mehr wert sein als monatelange Kleinarbeit, und " +
      "das sieht keine Kennzahl.",
  };
}

// ------------------------------------------------------------- Kopfgelder

export interface Bounty {
  bountyId: string;
  title: string;
  description: string;
  amountMsat: number;
  /** Wer zahlt. */
  funderPubkey: string;
  /** Offen, vergeben, erledigt. */
  status: "offen" | "vergeben" | "erledigt";
  /** Bei vergeben/erledigt: an wen. */
  claimedBy?: string;
  createdAt: number;
}

export function buildBounty(b: Omit<Bounty, "createdAt">, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `bounty:${b.bountyId}`],
    ["bounty", b.bountyId],
    ["title", b.title],
    ["amount_msat", String(b.amountMsat)],
    ["status", b.status],
  ];
  if (b.claimedBy) tags.push(["p", b.claimedBy]);
  return buildEvent(b.funderPubkey, KIND_BOUNTY, tags, b.description, createdAt);
}

export function parseBounty(ev: NostrEvent): Bounty {
  if (ev.kind !== KIND_BOUNTY) throw new Error(`kein Kopfgeld: kind ${ev.kind}`);
  const bountyId = getTag(ev, "bounty");
  const amount = Number(getTag(ev, "amount_msat") ?? "NaN");
  if (!bountyId || !Number.isFinite(amount)) throw new Error("Kopfgeld unvollständig");
  const status = getTag(ev, "status") ?? "offen";
  return {
    bountyId,
    title: getTag(ev, "title") ?? bountyId,
    description: ev.content,
    amountMsat: amount,
    funderPubkey: ev.pubkey,
    status: (["offen", "vergeben", "erledigt"].includes(status) ? status : "offen") as Bounty["status"],
    claimedBy: getTag(ev, "p") ?? undefined,
    createdAt: ev.created_at,
  };
}

/** Offene Kopfgelder, größte zuerst. */
export function openBounties(events: NostrEvent[]): Bounty[] {
  const neueste = new Map<string, Bounty>();
  for (const ev of events) {
    try {
      const b = parseBounty(ev);
      const bisher = neueste.get(b.bountyId);
      // Neuester Stand gewinnt: Ein Kopfgeld muss von offen auf erledigt
      // wechseln können.
      if (!bisher || b.createdAt > bisher.createdAt) neueste.set(b.bountyId, b);
    } catch { /* unbrauchbar */ }
  }
  return [...neueste.values()]
    .filter((b) => b.status === "offen")
    .sort((a, b) => b.amountMsat - a.amountMsat);
}
