/**
 * Solana-Deposit-Session: Escrow-basierte Live-Chat-Abrechnung.
 *
 * Das Solana-Gegenstueck zu Streaming-Sats (stream.ts). On-chain ist
 * streaming nicht moeglich (Fees, Latenz), also:
 *
 *   1. User lockt SOL als Deposit ins HTLC (bestehendes Programm,
 *      Swap-PDA — NIEMAND kontrolliert es, non-custodial)
 *   2. Live-Chat: Provider metered Tokens, publiziert signierte
 *      Metering-Events (38010). Noch kein Geldfluss.
 *   3. Session-Ende:
 *      - Normalfall: Provider legt Final-Metering offen; der verbrauchte
 *        Anteil geht an den Provider, der Rest wird dem User refunded.
 *      - User verschwindet / Provider betruegt: nach Timelock T bekommt
 *        der User ALLES zurueck (on-chain erzwungen, kein Vertrauen noetig).
 *
 * INVARIANTEN (nicht verletzen):
 *   - Kein neuer Custody-Contract. Das HTLC ist keyless, kein Owner.
 *   - Kein Protokoll-Topf. Deposit liegt im PDA, nicht bei einer Partei.
 *   - Refund ist on-chain garantiert (Timelock), nicht vom Provider abhaengig.
 *
 * Settlement-Modell (ehrlich ueber das HTLC-Limit):
 *   Das Basis-HTLC zahlt claim() voll an den Empfaenger. Eine TEILWEISE
 *   Auszahlung (verbraucht an Provider, Rest an User) braucht entweder:
 *     a) Zwei-HTLC-Muster: User lockt in ZWEI PDAs — eines in Hoehe des
 *        erwarteten Verbrauchs (Empfaenger=Provider), eines fuer den Rest
 *        (Empfaenger=User). Am Ende: Provider-HTLC wird per Preimage
 *        geclaimed (nur der tatsaechliche Verbrauch), das Rest-HTLC wird
 *        refunded. -> Exakte, non-custodiale Teilung OHNE Contract-Aenderung.
 *     b) Contract-Erweiterung um partial_claim (spaeter, braucht Redeploy).
 *   v1 nutzt (a): kein Redeploy, keine neue Angriffsflaeche.
 */
import { UnsignedEvent, buildEvent, getTag } from "./event.js";
import { KIND_SOL_DEPOSIT_OPEN, KIND_SOL_DEPOSIT_SETTLE } from "./kinds.js";

// (Kinds sind zentral in kinds.ts registriert — siehe dort.)

export interface SolDepositOpenParams {
  customerPubkey: string;
  providerPubkey: string;
  sessionId: string;
  /** Gesamt-Deposit in Lamports. */
  totalLamports: number;
  /** swap_id des Verbrauchs-HTLC (Empfaenger = Provider). */
  spendSwapId: string;
  /** swap_id des Rest-HTLC (Empfaenger = User, wird refunded). */
  refundSwapId: string;
  /** Lamports im Verbrauchs-HTLC (maximaler moeglicher Verbrauch). */
  spendLamports: number;
  /** Lamports im Rest-HTLC (sofort refundbarer Anteil). */
  refundLamports: number;
  /** Timelock (Unix-Sekunden) — danach kann der User alles zurueckholen. */
  timelockUnix: number;
  /** Preis-Deckel: lamports pro 1k tokens. */
  maxLamportsPerKToken: number;
}

export function buildSolDepositOpen(p: SolDepositOpenParams, createdAt = Math.floor(Date.now() / 1000)): UnsignedEvent {
  return buildEvent(
    p.customerPubkey,
    KIND_SOL_DEPOSIT_OPEN,
    [
      ["d", p.sessionId],
      ["p", p.providerPubkey],
      ["total_lamports", String(p.totalLamports)],
      ["spend_swap", p.spendSwapId],
      ["refund_swap", p.refundSwapId],
      ["spend_lamports", String(p.spendLamports)],
      ["refund_lamports", String(p.refundLamports)],
      ["timelock", String(p.timelockUnix)],
      ["max_lamports_per_ktoken", String(p.maxLamportsPerKToken)],
    ],
    "",
    createdAt,
  );
}

export interface ParsedSolDepositOpen {
  sessionId: string;
  customerPubkey: string;
  providerPubkey: string;
  totalLamports: number;
  spendSwapId: string;
  refundSwapId: string;
  spendLamports: number;
  refundLamports: number;
  timelockUnix: number;
  maxLamportsPerKToken: number;
}

export function parseSolDepositOpen(ev: UnsignedEvent): ParsedSolDepositOpen {
  if (ev.kind !== KIND_SOL_DEPOSIT_OPEN) throw new Error(`kein Deposit-Open-Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  return {
    sessionId: req("d"),
    customerPubkey: ev.pubkey,
    providerPubkey: req("p"),
    totalLamports: Number(req("total_lamports")),
    spendSwapId: req("spend_swap"),
    refundSwapId: req("refund_swap"),
    spendLamports: Number(req("spend_lamports")),
    refundLamports: Number(req("refund_lamports")),
    timelockUnix: Number(req("timelock")),
    maxLamportsPerKToken: Number(req("max_lamports_per_ktoken")),
  };
}

export interface SolDepositSettleParams {
  providerPubkey: string;
  sessionId: string;
  customerPubkey: string;
  /** Tatsaechlich verbrauchte Lamports (<= spendLamports). */
  usedLamports: number;
  /** Verbrauchte Tokens gesamt. */
  totalTokens: number;
  /** Referenz auf das letzte Metering-Event. */
  lastMeteringId?: string;
}

export function buildSolDepositSettle(p: SolDepositSettleParams, createdAt = Math.floor(Date.now() / 1000)): UnsignedEvent {
  const tags: string[][] = [
    ["d", p.sessionId],
    ["p", p.customerPubkey],
    ["used_lamports", String(p.usedLamports)],
    ["total_tokens", String(p.totalTokens)],
  ];
  if (p.lastMeteringId) tags.push(["e", p.lastMeteringId]);
  return buildEvent(p.providerPubkey, KIND_SOL_DEPOSIT_SETTLE, tags, "", createdAt);
}

export interface ParsedSolDepositSettle {
  sessionId: string;
  providerPubkey: string;
  customerPubkey: string;
  usedLamports: number;
  totalTokens: number;
  lastMeteringId?: string;
}

export function parseSolDepositSettle(ev: UnsignedEvent): ParsedSolDepositSettle {
  if (ev.kind !== KIND_SOL_DEPOSIT_SETTLE) throw new Error(`kein Deposit-Settle-Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  return {
    sessionId: req("d"),
    providerPubkey: ev.pubkey,
    customerPubkey: req("p"),
    usedLamports: Number(req("used_lamports")),
    totalTokens: Number(req("total_tokens")),
    lastMeteringId: getTag(ev, "e"),
  };
}

// ------------------------------------------------------------ Validierung

export interface DepositCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Prueft die Konsistenz einer Deposit-Session (beide Seiten + Auditor):
 *   - spend + refund == total (kein Geld erschaft/verloren)
 *   - used <= spend (Provider kann nicht mehr nehmen als das Verbrauchs-HTLC hergibt)
 *   - used == totalTokens * rate (gedeckelt auf max_lamports_per_ktoken)
 */
export function checkSolDeposit(
  open: ParsedSolDepositOpen,
  settle: ParsedSolDepositSettle | null,
): DepositCheck {
  const problems: string[] = [];
  if (open.spendLamports + open.refundLamports !== open.totalLamports) {
    problems.push(
      `Inkonsistent: spend(${open.spendLamports}) + refund(${open.refundLamports}) != total(${open.totalLamports})`,
    );
  }
  if (settle) {
    if (settle.providerPubkey !== open.providerPubkey) {
      problems.push("Settle von fremdem Provider");
    }
    if (settle.usedLamports > open.spendLamports) {
      problems.push(`Verbrauch (${settle.usedLamports}) > Verbrauchs-HTLC (${open.spendLamports})`);
    }
    // Rate-Deckel: maxLamportsPerKToken ist pro 1000 tokens.
    // expected = (totalTokens / 1000) * maxLamportsPerKToken
    const expected = Math.floor((settle.totalTokens / 1000) * open.maxLamportsPerKToken);
    if (expected > 0 && settle.usedLamports > expected) {
      problems.push(`Verbrauch (${settle.usedLamports}) ueber Rate-Deckel (${expected} bei ${settle.totalTokens} tokens)`);
    }
  }
  return { ok: problems.length === 0, problems };
}
