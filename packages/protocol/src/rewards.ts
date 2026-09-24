/**
 * Fee-Splits, Reward-Pools und Leaderboard.
 *
 * Grundregel (Whitepaper 8): Der Fee wird AN DER QUELLE aufgeteilt. Es gibt
 * keinen zentralen Topf, den jemand haelt - jede Zahlung traegt ihre Aufteilung
 * bereits in sich. Deshalb berechnet dieses Modul Splits, es verwahrt nichts.
 *
 * Sybil-Schutz: Leaderboard-Punkte werden mit Web-of-Trust-Gewicht multipliziert
 * und erfordern Mindest-PoW. Wer beliebig viele Keys erzeugt, bekommt viele
 * Eintraege mit Gewicht ~0.
 */
import { NostrEvent } from "./event.js";
import { ParsedPerformance, parsePerformance, Chain } from "./performance.js";
import { verifyPow } from "./pow.js";
import { computeTrust, extractEdges, WotOptions } from "./wot.js";
import { FEE_REFERRAL_SHARE_PERCENT } from "./protocol-fee.js";

// ---------------------------------------------------------------- Fee-Split

export interface FeeSplitConfig {
  /** Gesamter Protokoll-Fee in Parts-per-Million des Zahlbetrags. */
  totalFeePpm: number;
  /** Anteil des Fees, der in den Reward-Pool geht (Prozent). Rest -> Protokoll. */
  poolSharePercent: number;
}

export interface FeeSplit {
  /** Betrag, der beim Empfaenger ankommt. */
  recipientMsat: number;
  /** Anteil an den Reward-Pool. */
  poolMsat: number;
  /** Anteil an das Protokoll/den Betreiber (Dev+Referral zusammengefasst). */
  protocolMsat: number;
  /** Anteil Development (Teilmenge von protocolMsat). */
  devMsat?: number;
  /** Anteil Referral-Pool (Teilmenge von protocolMsat). */
  referralMsat?: number;
  totalMsat: number;
}

/**
 * Berechnet die Aufteilung einer Zahlung. Non-custodial: Diese drei Betraege
 * werden als getrennte Zahlungsziele ausgefuehrt (Lightning-Split bzw.
 * Contract), nicht nacheinander durch ein Wallet geschleust.
 */
export function computeFeeSplit(amountMsat: number, cfg: FeeSplitConfig): FeeSplit {
  if (amountMsat < 0) throw new Error("Betrag darf nicht negativ sein");
  if (cfg.totalFeePpm < 0 || cfg.totalFeePpm > 1_000_000) throw new Error("totalFeePpm ausserhalb 0..1e6");
  if (cfg.poolSharePercent < 0 || cfg.poolSharePercent > 100) throw new Error("poolSharePercent ausserhalb 0..100");

  const fee = Math.floor((amountMsat * cfg.totalFeePpm) / 1_000_000);
  const pool = Math.floor((fee * cfg.poolSharePercent) / 100);
  const protocol = fee - pool;
  // Protokoll v2: Der Rest neben dem Pool geht vollstaendig an Referral. Der
  // frueher hier abgezweigte Dev-Anteil liegt jetzt in der Client-Schicht
  // (client-fee.ts) und taucht in der Protokoll-Rechnung nicht mehr auf.
  return {
    recipientMsat: amountMsat - fee,
    poolMsat: pool,
    protocolMsat: protocol,
    devMsat: 0,
    referralMsat: protocol,
    totalMsat: amountMsat,
  };
}

/**
 * Bleibt fuer Bestandscode auf 0: Das Protokoll kennt keinen Dev-Anteil mehr.
 *
 * Nicht geloescht, damit ein alter Aufrufer nicht mit einem Referenzfehler
 * abbricht, sondern eine ehrliche Null bekommt.
 */
export const FEE_DEV_SHARE_OF_PROTOCOL_PCT = 0;
void FEE_REFERRAL_SHARE_PERCENT;

// ---------------------------------------------------------------- Pool

export interface PoolState {
  chain: Chain;
  seasonId: string;
  balanceMsat: number;
}

/** Summiert die Pool-Anteile aller Zahlungen einer Season/Chain. */
export function accumulatePool(
  splits: FeeSplit[],
  seasonId: string,
  chain: Chain,
): PoolState {
  return {
    chain,
    seasonId,
    balanceMsat: splits.reduce((s, x) => s + x.poolMsat, 0),
  };
}

// ---------------------------------------------------------------- Leaderboard

export interface ScoringConfig {
  /** Punkte pro Arbeitseinheit, nach Arbeitstyp. */
  pointsPerUnit: Record<string, number>;
  /** Zusatzpunkte pro 1000 msat Volumen. */
  pointsPerKMsat: number;
  /** Mindest-PoW-Schwierigkeit, sonst wird das Event ignoriert. */
  minPowDifficulty: number;
  /** Web-of-Trust-Konfiguration fuer die Gewichtung. */
  wot: WotOptions;
}

export interface LeaderboardEntry {
  pubkey: string;
  rawPoints: number;
  trustWeight: number;
  /** rawPoints * trustWeight - das ist die Rangfolge. */
  score: number;
  units: number;
  volumeMsat: number;
}

/**
 * Baut das Leaderboard aus signierten Leistungs-Events.
 *
 * Filterkette (in dieser Reihenfolge):
 *   1 Signatur/Selbstbezeugung gueltig (in parsePerformance geprueft)
 *   2 richtige Season
 *   3 Mindest-PoW erfuellt   -> verteuert Masse
 *   4 Gewichtung per WoT     -> entwertet unbekannte Sybils
 */
export function buildLeaderboard(
  performanceEvents: NostrEvent[],
  attestationEvents: NostrEvent[],
  seasonId: string,
  cfg: ScoringConfig,
): LeaderboardEntry[] {
  const trust = computeTrust(extractEdges(attestationEvents), cfg.wot);

  const agg = new Map<string, { points: number; units: number; volume: number }>();
  for (const ev of performanceEvents) {
    let p: ParsedPerformance;
    try {
      p = parsePerformance(ev);
    } catch {
      continue; // ungueltig oder gefaelscht
    }
    if (p.seasonId !== seasonId) continue;
    if (!verifyPow(ev, cfg.minPowDifficulty)) continue;

    const perUnit = cfg.pointsPerUnit[p.workType] ?? 0;
    const points = perUnit * p.units + (p.volumeMsat / 1000) * cfg.pointsPerKMsat;

    const cur = agg.get(p.workerPubkey) ?? { points: 0, units: 0, volume: 0 };
    cur.points += points;
    cur.units += p.units;
    cur.volume += p.volumeMsat;
    agg.set(p.workerPubkey, cur);
  }

  const entries: LeaderboardEntry[] = [...agg.entries()].map(([pubkey, a]) => {
    const w = trust.get(pubkey) ?? 0;
    return {
      pubkey,
      rawPoints: a.points,
      trustWeight: w,
      score: a.points * w,
      units: a.units,
      volumeMsat: a.volume,
    };
  });

  return entries.sort((a, b) => b.score - a.score || a.pubkey.localeCompare(b.pubkey));
}

// ---------------------------------------------------------------- Verteilung

export interface Allocation {
  pubkey: string;
  amountMsat: number;
  rank: number;
}

/**
 * Proportionale Verteilung nach Score ("pay for work" - die rechtlich
 * sauberste Form, siehe Whitepaper 8). Kein Gewinnertopf, kein Losprinzip:
 * jeder erhaelt anteilig seiner nachgewiesenen Leistung.
 *
 * Rundungsreste bleiben im Pool (verfallen nicht an einen Einzelnen).
 */
export function allocateProportional(pool: PoolState, board: LeaderboardEntry[]): Allocation[] {
  const totalScore = board.reduce((s, e) => s + e.score, 0);
  if (totalScore <= 0) return [];
  return board
    .filter((e) => e.score > 0)
    .map((e, i) => ({
      pubkey: e.pubkey,
      amountMsat: Math.floor((pool.balanceMsat * e.score) / totalScore),
      rank: i + 1,
    }));
}

/** Summe einer Verteilung - darf nie groesser als der Pool sein. */
export function totalAllocated(allocs: Allocation[]): number {
  return allocs.reduce((s, a) => s + a.amountMsat, 0);
}
