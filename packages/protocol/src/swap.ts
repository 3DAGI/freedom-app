/**
 * Swap-Orchestrierung (Richtung: Nutzer zahlt sats -> erhaelt SOL).
 *
 * Ablauf (siehe Whitepaper 5.3):
 *   1 Nutzer erzeugt R, H = SHA256(R). Sendet nur H an den LP.
 *   3 LP sperrt SOL im HTLC (H, T_sol, Empfaenger=Nutzer).
 *   4 LP stellt Hold-Invoice mit Payment-Hash H aus.
 *   5 Nutzer zahlt die Hold-Invoice -> in flight, noch nicht abgerechnet.
 *   6 Nutzer loest SOL ein, legt R offen -> R wird auf Solana oeffentlich.
 *   7 LP liest R und rechnet die Hold-Invoice ab -> LP erhaelt sats.
 *
 * Sicherheit: T_lightning_real > T_sol (per timelock.ts erzwungen).
 */
import { LightningAdapter, SolanaHtlcAdapter } from "./adapters.js";
import { generatePreimage, hashlock, verifyPreimage, toHex } from "./htlc.js";
import { validateTimelockOrdering } from "./timelock.js";

export type SwapPhase =
  | "INIT"
  | "SOL_LOCKED"
  | "LN_INVOICE_CREATED"
  | "LN_PAYMENT_INFLIGHT"
  | "SOL_CLAIMED"
  | "LN_SETTLED"
  | "DONE"
  | "REFUNDED"
  | "ABORTED";

export interface SwapConfig {
  swapId: string;
  amountSats: number;
  amountLamports: number;
  userSolanaAddress: string;
  lpSolanaAddress: string;
  tSolSecs: number;
  lnCltvDeltaBlocks: number;
  /** Fuer die Timelock-Umrechnung in Tests konfigurierbar. */
  assumedBlockSecs?: number;
  minSafetyMarginSecs?: number;
  /** Aktuelle Unix-Zeit (injizierbar fuer deterministische Tests). */
  now?: () => number;
  /**
   * Nur fuer Simulation/Test des Refund-Pfads: rueckt die Uhr ueber die
   * Solana-Timelock hinaus, bevor refund aufgerufen wird (modelliert "Zeit
   * vergeht bis zum Timeout"). In Produktion entfaellt das - dort vergeht
   * reale Zeit.
   */
  advanceClockForRefund?: () => void;
}

export interface SwapResult {
  phase: SwapPhase;
  log: string[];
  preimageHex?: string;
}

/**
 * Fuehrt den vollstaendigen Swap kooperativ aus. Beide Parteien werden hier
 * der Einfachheit halber gemeinsam getrieben; in Produktion laufen Nutzer- und
 * LP-Seite getrennt und kommunizieren ueber Nostr (siehe nostr-order.ts).
 *
 * `userClaims` = false simuliert den Fall, dass der Nutzer NICHT einloest
 * (z. B. Absturz) -> Refund-Pfad, ohne dass jemand Geld verliert.
 */
export async function runSwap(
  ln: LightningAdapter,
  sol: SolanaHtlcAdapter,
  cfg: SwapConfig,
  userClaims = true,
): Promise<SwapResult> {
  const log: string[] = [];
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  let phase: SwapPhase = "INIT";

  // Schritt 0: Timelock-Ordnung pruefen, BEVOR Gelder bewegt werden.
  const tl = validateTimelockOrdering({
    tSolSecs: cfg.tSolSecs,
    lnCltvDeltaBlocks: cfg.lnCltvDeltaBlocks,
    assumedBlockSecs: cfg.assumedBlockSecs,
    minSafetyMarginSecs: cfg.minSafetyMarginSecs,
  });
  if (!tl.ok) {
    log.push(`ABBRUCH: unsichere Timelock-Ordnung: ${tl.reason}`);
    return { phase: "ABORTED", log };
  }
  log.push(`Timelock ok: T_sol=${tl.tSolSecs}s < T_ln=${tl.tLnSecs}s (Puffer ${tl.marginSecs}s)`);

  // Schritt 1: Nutzer erzeugt R und H.
  const preimage = generatePreimage();
  const H = hashlock(preimage);
  log.push(`1 Nutzer: R erzeugt, H=${toHex(H).slice(0, 16)}... (nur H geht an LP)`);

  // Schritt 3: LP sperrt SOL im HTLC.
  const timelockUnix = now() + cfg.tSolSecs;
  await sol.lock({
    swapId: cfg.swapId,
    hashlock: H,
    amountLamports: cfg.amountLamports,
    timelockUnix,
    recipient: cfg.userSolanaAddress,
    initiator: cfg.lpSolanaAddress,
  });
  phase = "SOL_LOCKED";
  log.push(`3 LP: ${cfg.amountLamports} lamports im Solana-HTLC gesperrt (Empfaenger=Nutzer)`);

  // Schritt 4: LP erstellt Hold-Invoice mit demselben H.
  const invoice = await ln.createHoldInvoice(H, cfg.amountSats, cfg.lnCltvDeltaBlocks);
  phase = "LN_INVOICE_CREATED";
  log.push(`4 LP: Hold-Invoice ueber ${invoice.amountSats} sats mit Payment-Hash H erstellt`);

  // Schritt 5: Nutzer zahlt die Hold-Invoice (HTLC in flight, nicht abgerechnet).
  await ln.payHoldInvoice(invoice.bolt11);
  phase = "LN_PAYMENT_INFLIGHT";
  const st = await ln.getInvoiceState(H);
  log.push(`5 Nutzer: Hold-Invoice gezahlt -> Zustand ${st} (gehalten, nicht abgerechnet)`);

  if (!userClaims) {
    // Nutzer loest NICHT ein. Niemand darf Geld verlieren:
    // - Solana wird nach Ablauf der Timelock an den LP zurueckerstattet.
    // - Lightning-Zahlung wird storniert -> zurueck an den Nutzer.
    log.push(`6 Nutzer loest NICHT ein (Simulation Absturz/Abbruch)`);
    // Zeit vergeht ueber die Solana-Frist hinaus (in Produktion real):
    cfg.advanceClockForRefund?.();
    await sol.refund(cfg.swapId);
    await ln.cancelHoldInvoice(H);
    phase = "REFUNDED";
    log.push(`   Refund: SOL zurueck an LP, Lightning-Zahlung zurueck an Nutzer. Kein Verlust.`);
    return { phase, log };
  }

  // Schritt 6: Nutzer loest SOL ein und legt R offen.
  await sol.claim(cfg.swapId, preimage, cfg.lpSolanaAddress);
  phase = "SOL_CLAIMED";
  log.push(`6 Nutzer: SOL eingeloest, R on-chain offengelegt`);

  // Schritt 7: LP liest R von der Chain und rechnet die Hold-Invoice ab.
  const revealed = await sol.getRevealedPreimage(cfg.swapId);
  if (!revealed || !verifyPreimage(revealed, H)) {
    // Sollte nie passieren; defensiver Abbruch.
    log.push(`ABBRUCH: offengelegte Preimage passt nicht zu H`);
    await ln.cancelHoldInvoice(H);
    return { phase: "ABORTED", log };
  }
  await ln.settleHoldInvoice(revealed);
  phase = "LN_SETTLED";
  log.push(`7 LP: R von Solana gelesen, Hold-Invoice abgerechnet -> LP erhaelt sats`);

  phase = "DONE";
  log.push(`OK: Nutzer hat SOL, LP hat sats. Kein Dritter hielt je Gelder.`);
  return { phase, log, preimageHex: toHex(preimage) };
}
