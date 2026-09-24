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
