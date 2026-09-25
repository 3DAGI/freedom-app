/**
 * Timelock-Ordnung.
 *
 * Sicherheitskern des Swaps: Die zuerst eingeloeste Seite (Solana, wo die
 * Preimage offengelegt wird) MUSS die kuerzere Frist haben, die zweite Seite
 * (Lightning) die laengere -> T_lightning_real > T_sol.
 * Sonst koennte die einloesende Partei die Preimage erst nach Ablauf der
 * Lightning-Frist offenlegen und sich beide Seiten sichern.
 *
 * Lightning misst in Bitcoin-Bloecken (CLTV-Delta), Solana in Sekunden.
 * Wir rechnen die Blockfrist konservativ in Sekunden um und verlangen einen
 * Sicherheitspuffer.
 */

/** Konservative Annahme fuer die reale Blockzeit (Sekunden). Bitcoin ~10 min. */
export const ASSUMED_BLOCK_SECS = 600;

/** Mindest-Sicherheitspuffer zwischen den Fristen (Sekunden). */
export const MIN_SAFETY_MARGIN_SECS = 3600; // 1 h

export interface TimelockParams {
  /** Solana-HTLC-Frist in Sekunden ab jetzt. */
  tSolSecs: number;
  /** Lightning-CLTV-Delta in Bloecken. */
  lnCltvDeltaBlocks: number;
  /** Optional: abweichende Blockzeit-Annahme. */
  assumedBlockSecs?: number;
  /** Optional: abweichender Mindestpuffer. */
  minSafetyMarginSecs?: number;
}

export interface TimelockCheck {
  ok: boolean;
  reason?: string;
  tSolSecs: number;
  tLnSecs: number;
  marginSecs: number;
}

/**
 * Validiert die Timelock-Ordnung. Gibt ok=false zurueck, wenn die
 * Lightning-Frist nicht ausreichend laenger ist als die Solana-Frist.
 */
export function validateTimelockOrdering(p: TimelockParams): TimelockCheck {
  const blockSecs = p.assumedBlockSecs ?? ASSUMED_BLOCK_SECS;
  const margin = p.minSafetyMarginSecs ?? MIN_SAFETY_MARGIN_SECS;
  const tLnSecs = p.lnCltvDeltaBlocks * blockSecs;
  const actualMargin = tLnSecs - p.tSolSecs;

  if (p.tSolSecs <= 0) {
    return { ok: false, reason: "tSolSecs muss > 0 sein", tSolSecs: p.tSolSecs, tLnSecs, marginSecs: actualMargin };
  }
  if (tLnSecs <= p.tSolSecs) {
    return {
      ok: false,
      reason: `Lightning-Frist (${tLnSecs}s) muss groesser sein als Solana-Frist (${p.tSolSecs}s)`,
      tSolSecs: p.tSolSecs,
      tLnSecs,
      marginSecs: actualMargin,
    };
  }
  if (actualMargin < margin) {
    return {
      ok: false,
      reason: `Sicherheitspuffer ${actualMargin}s < Minimum ${margin}s`,
      tSolSecs: p.tSolSecs,
      tLnSecs,
      marginSecs: actualMargin,
    };
  }
  return { ok: true, tSolSecs: p.tSolSecs, tLnSecs, marginSecs: actualMargin };
}

// ------------------------------------------------------------ SOL -> Lightning (4.6)

/**
 * Langsame Bloecke fuer die Gegenrichtung: Hier muss die Lightning-Frist
 * VOR der Solana-Frist enden. Laufen die Bloecke langsamer als gedacht, endet
 * sie spaeter – also rechnen wir mit langsamen Bloecken (20 min statt 10).
 */
export const SLOW_BLOCK_SECS = 1200;

export interface ReverseTimelockParams {
  /** Restlaufzeit des Solana-HTLC des Kunden in Sekunden. */
  tSolSecs: number;
  /** Hoechstlaufzeit der Lightning-Zahlung des LP (cltv_limit) in Bloecken. */
  lnCltvLimitBlocks: number;
  slowBlockSecs?: number;
  minSafetyMarginSecs?: number;
}

/**
 * Gegenrichtung (Kunde sperrt SOL, LP zahlt die Rechnung des Kunden):
 * Der Kunde koennte das Preimage zurueckhalten, bis die Solana-Frist
 * abgelaufen ist, dann SOL zurueckholen UND die Lightning-Zahlung annehmen.
 * Deshalb zahlt der LP nur mit einem `cltv_limit`, dessen Frist auch bei
 * langsamen Bloecken plus Sicherheitsabstand vor T_sol endet:
 *   cltv_limit · langsame Blockzeit + Abstand ≤ T_sol.
 * Dann gilt: Entweder das Preimage kommt vor Ablauf der Lightning-Frist (und
 * der LP hat mindestens den Abstand, um SOL einzuloesen), oder die Zahlung
 * scheitert und der LP bekommt seine sats zurueck.
 */
export function validateReverseTimelock(p: ReverseTimelockParams): TimelockCheck {
  const blockSecs = p.slowBlockSecs ?? SLOW_BLOCK_SECS;
  const margin = p.minSafetyMarginSecs ?? MIN_SAFETY_MARGIN_SECS;
  const tLnSecs = p.lnCltvLimitBlocks * blockSecs;
  const actualMargin = p.tSolSecs - tLnSecs;
  const ergebnis = { tSolSecs: p.tSolSecs, tLnSecs, marginSecs: actualMargin };
  if (!Number.isSafeInteger(p.lnCltvLimitBlocks) || p.lnCltvLimitBlocks <= 0) {
    return { ok: false, reason: "cltv_limit muss eine positive ganze Zahl (Bloecke) sein", ...ergebnis };
  }
  if (p.tSolSecs <= 0) return { ok: false, reason: "tSolSecs muss > 0 sein", ...ergebnis };
  if (actualMargin < margin) {
    return {
      ok: false,
      reason: `Lightning-Frist (${tLnSecs}s bei langsamen Bloecken) plus Abstand ${margin}s muss vor der Solana-Frist (${p.tSolSecs}s) enden`,
      ...ergebnis,
    };
  }
  return { ok: true, ...ergebnis };
}

/** Groesstes cltv_limit, das zu einer Solana-Restlaufzeit passt (0 = zu kurz fuer jede Zahlung). */
export function maxCltvLimitFuer(tSolSecs: number, slowBlockSecs = SLOW_BLOCK_SECS, minSafetyMarginSecs = MIN_SAFETY_MARGIN_SECS): number {
  return Math.max(0, Math.floor((tSolSecs - minSafetyMarginSecs) / slowBlockSecs));
}
