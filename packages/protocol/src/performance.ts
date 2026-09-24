/**
 * Leistungs-Events (kind 38010) und Reward-Ausschuettungsnachweise (38011).
 *
 * Jede abrechenbare Aktion erzeugt ein signiertes Leistungs-Event: wer, was,
 * welcher Betrag, welche Chain. Diese Events sind der Rohstoff fuer Leaderboard
 * und Reward-Verteilung - faelschungssicher, oeffentlich pruefbar, off-chain.
 *
 * Bewusst als Nostr-Event modelliert (Buzz-Muster: neue Funktion = neue Kind),
 * damit die Events auf jedem Relay liegen koennen und kein Server noetig ist.
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag } from "./event.js";
import { KIND_PERFORMANCE, KIND_REWARD_PAYOUT, KIND_SEASON_DEF } from "./kinds.js";

export type WorkType = "message" | "ai_job" | "liquidity" | "relay";
export type Chain = "lightning" | "solana" | "polygon" | "ton";

export interface PerformanceParams {
  /** Wer die Leistung erbracht hat. */
  workerPubkey: string;
  workType: WorkType;
  /** Verrechnungseinheit: Anzahl Nachrichten, Jobs, msats Liquiditaet ... */
  units: number;
  /** Erloes/Volumen in Millisatoshi (fuer Fee-Berechnung). */
  volumeMsat: number;
  chain: Chain;
  /** Referenz auf den Beleg (z. B. Zap-Receipt-ID oder Job-Result-ID). */
  proofEventId?: string;
  /** Season-Kennung. */
  seasonId: string;
}

export function buildPerformanceEvent(p: PerformanceParams, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `${p.seasonId}:${p.workerPubkey}:${p.proofEventId ?? String(createdAt ?? "")}`],
    ["season", p.seasonId],
    ["worker", p.workerPubkey],
    ["work_type", p.workType],
    ["units", String(p.units)],
    ["volume_msat", String(p.volumeMsat)],
    ["chain", p.chain],
  ];
  if (p.proofEventId) tags.push(["proof", p.proofEventId]);
  return buildEvent(p.workerPubkey, KIND_PERFORMANCE, tags, "", createdAt);
}

export interface ParsedPerformance {
  workerPubkey: string;
  seasonId: string;
  workType: WorkType;
  units: number;
  volumeMsat: number;
  chain: Chain;
  proofEventId?: string;
  eventId: string;
  createdAt: number;
}

export function parsePerformance(ev: NostrEvent): ParsedPerformance {
  if (ev.kind !== KIND_PERFORMANCE) throw new Error(`kein Performance-Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  const worker = req("worker");
  // Selbstbezeugung: Der Autor muss der Worker sein, sonst faelschbar.
  if (worker !== ev.pubkey) throw new Error("worker-Tag stimmt nicht mit Autor ueberein");
  return {
    workerPubkey: worker,
    seasonId: req("season"),
    workType: req("work_type") as WorkType,
    units: Number(req("units")),
    volumeMsat: Number(req("volume_msat")),
    chain: req("chain") as Chain,
    proofEventId: getTag(ev, "proof"),
    eventId: ev.id,
    createdAt: ev.created_at,
  };
}

export interface SeasonDef {
  seasonId: string;
  startUnix: number;
  endUnix: number;
  chain: Chain;
  /** Fee-Anteil in Parts-per-Million, der in den Pool geht. */
  poolFeePpm: number;
  /** Anteil, der pro Leistung (statt saisonal) ausgeschuettet wird, in Prozent. */
  perWorkPercent: number;
}

export function buildSeasonDef(pubkey: string, s: SeasonDef, createdAt?: number): UnsignedEvent {
  return buildEvent(
    pubkey,
    KIND_SEASON_DEF,
    [
      ["d", s.seasonId],
      ["start", String(s.startUnix)],
      ["end", String(s.endUnix)],
      ["chain", s.chain],
      ["pool_fee_ppm", String(s.poolFeePpm)],
      ["per_work_percent", String(s.perWorkPercent)],
    ],
    "",
    createdAt,
  );
}

export interface RewardPayoutParams {
  /** Wer den Nachweis publiziert (Verteil-Contract-Betreiber ODER Worker selbst). */
  pubkey: string;
  seasonId: string;
  recipientPubkey: string;
  amountMsat: number;
  chain: Chain;
  /** Beleg der tatsaechlichen Zahlung (Zap-Receipt-ID / Tx-Hash). */
  settlementRef: string;
  rank?: number;
}

export function buildRewardPayout(p: RewardPayoutParams, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `${p.seasonId}:${p.recipientPubkey}`],
    ["season", p.seasonId],
    ["p", p.recipientPubkey],
    ["amount_msat", String(p.amountMsat)],
    ["chain", p.chain],
    ["settlement", p.settlementRef],
  ];
  if (p.rank !== undefined) tags.push(["rank", String(p.rank)]);
  return buildEvent(p.pubkey, KIND_REWARD_PAYOUT, tags, "", createdAt);
}
