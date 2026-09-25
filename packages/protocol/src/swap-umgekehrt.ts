/**
 * Swap in der Gegenrichtung (Schritt 4.6): Kunde gibt SOL, erhaelt sats.
 *
 *   1 Kunde laesst seine Wallet eine Rechnung ueber die sats erstellen; das
 *     Preimage R bleibt in der Wallet, bekannt ist nur H.
 *   2 Kunde sperrt SOL im HTLC (Hashlock H, Frist T_sol, Empfaenger = LP).
 *   3 LP prueft die Sperre auf der Kette (Empfaenger, Betrag, Hashlock, Frist)
 *     und die Rechnung (Betrag, Hash).
 *   4 LP zahlt die Rechnung mit `cltv_limit` – seine Zahlung endet auch bei
 *     langsamen Bloecken sicher vor T_sol (`validateReverseTimelock`).
 *   5 Mit dem Preimage aus der Zahlung loest der LP die SOL ein.
 *
 * Haelt der Kunde R zurueck, scheitert die Zahlung nach cltv_limit, der LP
 * behaelt seine sats, und der Kunde holt nach T_sol seine SOL zurueck. Zahlt
 * der LP nicht, ebenso. Niemand verliert Geld.
 */
import type { LightningAdapter, SolanaHtlcAdapter } from "./adapters.js";
import { toHex, verifyPreimage } from "./htlc.js";
import { validateReverseTimelock } from "./timelock.js";

export interface ReverseSwapConfig {
  swapId: string;
  amountSats: number;
  amountLamports: number;
  kundeSolAdresse: string;
  lpSolAdresse: string;
  tSolSecs: number;
  lnCltvLimitBlocks: number;
  slowBlockSecs?: number;
  minSafetyMarginSecs?: number;
  now?: () => number;
  /** Simulation: Zeit ueber T_sol hinaus vorruecken, bevor der Kunde zurueckholt. */
  advanceClockForRefund?: () => void;
}

export type ReverseSwapPhase = "ABORTED" | "SOL_LOCKED" | "LN_PAID" | "DONE" | "REFUNDED";

export interface ReverseSwapResult {
  phase: ReverseSwapPhase;
  log: string[];
}

/**
 * Was der LP vor dem Zahlen prueft – als eigene Funktion, weil der
 * LP-Daemon (4.6b) genau das mit der echten Kette und der echten Rechnung tut.
 */
export function pruefeRueckSwapSperre(
  sperre: { recipient: string; amountLamports: number; hashlock: Uint8Array; timelockUnix: number; claimed: boolean; refunded: boolean } | undefined,
  erwartet: { lpSolAdresse: string; amountLamports: number; paymentHash: Uint8Array; jetzt: number; lnCltvLimitBlocks: number; slowBlockSecs?: number; minSafetyMarginSecs?: number },
): { ok: true } | { ok: false; grund: string } {
  if (!sperre) return { ok: false, grund: "keine Sperre auf der Kette" };
  if (sperre.claimed || sperre.refunded) return { ok: false, grund: "Sperre bereits abgeschlossen" };
  if (sperre.recipient !== erwartet.lpSolAdresse) return { ok: false, grund: "Sperre gehört einem anderen Empfänger" };
  if (sperre.amountLamports < erwartet.amountLamports) return { ok: false, grund: `nur ${sperre.amountLamports} statt ${erwartet.amountLamports} Lamports gesperrt` };
  if (toHex(sperre.hashlock) !== toHex(erwartet.paymentHash)) return { ok: false, grund: "Hashlock passt nicht zur Rechnung" };
  const frist = validateReverseTimelock({
    tSolSecs: sperre.timelockUnix - erwartet.jetzt,
    lnCltvLimitBlocks: erwartet.lnCltvLimitBlocks,
    slowBlockSecs: erwartet.slowBlockSecs,
    minSafetyMarginSecs: erwartet.minSafetyMarginSecs,
  });
  return frist.ok ? { ok: true } : { ok: false, grund: `Frist zu kurz: ${frist.reason}` };
}

/**
 * Fuehrt den Swap kooperativ aus (Simulation mit Adaptern). `lpZahlt = false`
 * simuliert einen LP, der nie zahlt.
 */
export async function runReverseSwap(
  ln: LightningAdapter,
  sol: SolanaHtlcAdapter,
  cfg: ReverseSwapConfig,
  verhalten: { lpZahlt?: boolean; hashlockDaneben?: Uint8Array } = {},
): Promise<ReverseSwapResult> {
  const log: string[] = [];
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  if (!ln.createInvoice || !ln.payInvoice) return { phase: "ABORTED", log: ["ABBRUCH: Lightning-Adapter kann keine Gegenrichtung"] };

  // 0: Fristen pruefen, bevor Geld bewegt wird.
  const tl = validateReverseTimelock(cfg);
  if (!tl.ok) return { phase: "ABORTED", log: [`ABBRUCH: unsichere Fristen: ${tl.reason}`] };
  log.push(`Fristen ok: Lightning hoechstens ${tl.tLnSecs}s, SOL ${tl.tSolSecs}s (Abstand ${tl.marginSecs}s)`);

  // 1: Rechnung aus der Wallet des Kunden.
  const rechnung = await ln.createInvoice(cfg.amountSats);
  log.push(`1 Kunde: Rechnung ueber ${rechnung.amountSats} sats, H=${toHex(rechnung.paymentHash).slice(0, 16)}...`);

  // 2: Kunde sperrt SOL.
  await sol.lock({
    swapId: cfg.swapId,
    hashlock: verhalten.hashlockDaneben ?? rechnung.paymentHash,
    amountLamports: cfg.amountLamports,
    timelockUnix: now() + cfg.tSolSecs,
    recipient: cfg.lpSolAdresse,
    initiator: cfg.kundeSolAdresse,
  });
  log.push(`2 Kunde: ${cfg.amountLamports} Lamports gesperrt (Empfaenger LP)`);

  // 3: LP prueft Sperre und Rechnung.
  const pruefung = rechnung.amountSats === cfg.amountSats
    ? pruefeRueckSwapSperre(await sol.get(cfg.swapId), {
        lpSolAdresse: cfg.lpSolAdresse, amountLamports: cfg.amountLamports, paymentHash: rechnung.paymentHash,
        jetzt: now(), lnCltvLimitBlocks: cfg.lnCltvLimitBlocks, slowBlockSecs: cfg.slowBlockSecs, minSafetyMarginSecs: cfg.minSafetyMarginSecs,
      })
    : { ok: false as const, grund: "Rechnung nennt einen anderen Betrag" };
  const kundeHoltZurueck = async (warum: string): Promise<ReverseSwapResult> => {
    log.push(warum);
    cfg.advanceClockForRefund?.();
    await sol.refund(cfg.swapId);
    log.push("   Kunde holt nach T_sol seine SOL zurueck. Kein Verlust.");
    return { phase: "REFUNDED", log };
  };
  if (!pruefung.ok) return kundeHoltZurueck(`3 LP zahlt NICHT: ${pruefung.grund}`);
  if (verhalten.lpZahlt === false) return kundeHoltZurueck("3 LP zahlt nicht (Simulation)");

  // 4: LP zahlt mit cltv_limit und erfaehrt das Preimage.
  let preimage: Uint8Array;
  try {
    ({ preimage } = await ln.payInvoice(rechnung.bolt11, cfg.lnCltvLimitBlocks));
  } catch (e) {
    return kundeHoltZurueck(`4 Zahlung gescheitert (${(e as Error).message}) – sats bleiben beim LP`);
  }
  if (!verifyPreimage(preimage, rechnung.paymentHash)) return { phase: "ABORTED", log: [...log, "ABBRUCH: Preimage passt nicht"] };
  log.push(`4 LP: Rechnung bezahlt (cltv_limit ${cfg.lnCltvLimitBlocks}), Preimage erhalten`);

  // 5: LP loest SOL ein.
  await sol.claim(cfg.swapId, preimage, cfg.lpSolAdresse);
  log.push("5 LP: SOL eingeloest. Kunde hat sats, LP hat SOL.");
  return { phase: "DONE", log };
}
