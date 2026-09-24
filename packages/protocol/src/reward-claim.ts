/**
 * Reward-Claim: Provider fordern ihre Season-Belohnung an.
 *
 * Flow (dezentral, kein Betreiber noetig):
 * 1. Worker publiziert CLAIM (38013) mit seiner Saison-Performance
 * 2. Pool-Verteiler (kann jeder Node sein, z.B. der mit hoechstem Trust)
 *    prueft die Performance-Events und zahlt aus
 * 3. Auszahlung = Zap an worker-lud16 ODER Solana-Transfer + PAYOUT-Nachweis (38011)
 *
 * Der Claim ist damit ein signierter "Rechnungslauf" — jeder kann die
 * Berechnung nachvollziehen (alle Belege sind oeffentliche Events).
 */
import { UnsignedEvent, buildEvent, getTag } from "./event.js";
import { KIND_REWARD_CLAIM } from "./kinds.js";

export interface RewardClaimParams {
  seasonId: string;
  /** Anzahl der 38010-Leistungs-Events der Season. */
  jobCount: number;
  /** Summe aller volume_msat der Season. */
  volumeMsat: number;
  /** Gewuenschter Auszahlungskanal. */
  chain: "lightning" | "solana";
  /** Lightning-Adresse oder SOL-Adresse fuer die Auszahlung. */
  payoutAddress: string;
}

export function buildRewardClaim(p: RewardClaimParams, workerPubkey: string, createdAt?: number): UnsignedEvent {
  return buildEvent(workerPubkey, KIND_REWARD_CLAIM, [
    ["d", `${p.seasonId}:claim`],
    ["season", p.seasonId],
    ["jobs", String(p.jobCount)],
    ["volume_msat", String(p.volumeMsat)],
    ["chain", p.chain],
    ["payout", p.payoutAddress],
  ], "", createdAt);
}

export interface ParsedRewardClaim {
  workerPubkey: string;
  seasonId: string;
  jobCount: number;
  volumeMsat: number;
  chain: "lightning" | "solana";
  payoutAddress: string;
}

export function parseRewardClaim(ev: UnsignedEvent): ParsedRewardClaim {
  if (ev.kind !== KIND_REWARD_CLAIM) throw new Error(`kein reward-claim: kind ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (!v) throw new Error(`claim ohne ${n}`);
    return v;
  };
  const chain = req("chain");
  if (chain !== "lightning" && chain !== "solana") throw new Error(`ungueltige chain: ${chain}`);
  return {
    workerPubkey: ev.pubkey,
    seasonId: req("season"),
    jobCount: Number(req("jobs")),
    volumeMsat: Number(req("volume_msat")),
    chain,
    payoutAddress: req("payout"),
  };
}
