/**
 * Automatischer Rückfluss: hängengebliebene Sperren zurückholen.
 *
 * WAS DER HTLC SCHON LEISTET — UND WAS NICHT
 * Der Timelock im Anchor-Programm garantiert, dass niemand das Geld dauerhaft
 * einbehalten kann. Er gibt es aber nicht von selbst zurück: `refund` ist eine
 * Instruktion, die jemand aufrufen muss. Läuft ein Swap ins Leere und schaut
 * niemand mehr hin, liegt das Geld gesperrt, bis der Nutzer zufällig wieder
 * die App öffnet und den richtigen Knopf findet.
 *
 * Genau das ist der häufigste Weg, auf dem Nutzer in solchen Systemen Geld
 * „verlieren": nicht durch Betrug, sondern durch Vergessen.
 *
 * WAS DIESES MODUL TUT
 * Es merkt sich jede offene Sperre lokal, prüft sie beim Start der App und
 * danach regelmäßig, und holt zurück, was zurückholbar ist. Der Nutzer muss
 * nichts wissen und nichts merken.
 *
 * WAS ES NICHT TUT
 * Es kann nichts vor Ablauf des Timelocks zurückholen — das wäre auch nicht
 * wünschenswert, denn genau diese Wartezeit ist die Absicherung, die den
 * Gegenüber ohne Vertrauen arbeiten lässt. Und es kann nichts zurückholen,
 * was der Gegenüber bereits rechtmäßig eingelöst hat.
 */
import { WalletSigner } from "./sol-htlc.js";

export type PendingKind = "swap" | "deposit";

export interface PendingLock {
  kind: PendingKind;
  /** Fachliche Zuordnung (Session- oder Swap-ID). */
  reference: string;
  /** Die swap_ids, die zu dieser Sperre gehören. */
  swapIds: string[];
  timelockUnix: number;
  amountLamports: number;
  createdAt: number;
  /** Bereits erfolgreich zurückgeholt. */
  settled?: boolean;
  /** Wie oft ein Rückholversuch fehlgeschlagen ist. */
  attempts?: number;
  lastError?: string;
}

export const STORE_PREFIX = "freedom.pending.";

/**
 * Wo die Sperren gemerkt werden. Sie zeigen, wann wie viel SOL wohin ging –
 * mit Tresor liegen sie deshalb dort (4.6c, `setzeSperrSpeicher(geheim)`),
 * sonst in localStorage.
 */
export interface SperrSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  keys(): string[];
}

const lokal: SperrSpeicher = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
  keys: () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null),
};
let speicher: SperrSpeicher = lokal;

export function setzeSperrSpeicher(s: SperrSpeicher): void {
  speicher = s;
}

export async function rememberLock(lock: PendingLock): Promise<void> {
  await speicher.setItem(STORE_PREFIX + lock.reference, JSON.stringify(lock));
}

export async function forgetLock(reference: string): Promise<void> {
  await speicher.removeItem(STORE_PREFIX + reference);
}

export function listPendingLocks(): PendingLock[] {
  const out: PendingLock[] = [];
  for (const k of speicher.keys()) {
    if (!k.startsWith(STORE_PREFIX)) continue;
    try {
      const l = JSON.parse(speicher.getItem(k)!) as PendingLock;
      if (!l.settled) out.push(l);
    } catch { /* beschädigter Eintrag */ }
  }
  return out.sort((a, b) => a.timelockUnix - b.timelockUnix);
}

export type LockStatus = "laeuft" | "faellig" | "aufgegeben";

export interface LockView {
  lock: PendingLock;
  status: LockStatus;
  /** Sekunden bis zur Fälligkeit (0, wenn fällig). */
  secondsLeft: number;
  /** Klartext für die UI. */
  text: string;
}

/**
 * Nach wie vielen Fehlversuchen nicht mehr automatisch versucht wird.
 *
 * Ein dauerhaft scheiternder Rückholversuch bedeutet meist, dass der Gegenüber
 * bereits eingelöst hat — dann gibt es nichts zurückzuholen, und weitere
 * Versuche kosten nur Transaktionsgebühren.
 */
export const MAX_REFUND_ATTEMPTS = 5;

export function viewLock(lock: PendingLock, nowUnix = Math.floor(Date.now() / 1000)): LockView {
  const left = Math.max(0, lock.timelockUnix - nowUnix);
  const sol = (lock.amountLamports / 1e9).toFixed(4);

  if ((lock.attempts ?? 0) >= MAX_REFUND_ATTEMPTS) {
    return {
      lock, status: "aufgegeben", secondsLeft: left,
      text:
        `${sol} SOL: Rückholung mehrfach abgelehnt. Meist heißt das, dass die ` +
        `Gegenseite bereits eingelöst hat — dann ist nichts mehr offen. ` +
        (lock.lastError ? `Letzte Meldung: ${lock.lastError}` : ""),
    };
  }
  if (left > 0) {
    const min = Math.ceil(left / 60);
    return {
      lock, status: "laeuft", secondsLeft: left,
      text:
        `${sol} SOL gesperrt, rückholbar in ${min > 60 ? `${Math.ceil(min / 60)} h` : `${min} min`}. ` +
        `Die Wartezeit ist die Absicherung — vorher kann die Kette nichts freigeben.`,
    };
  }
  return {
    lock, status: "faellig", secondsLeft: 0,
    text: `${sol} SOL sind fällig und werden zurückgeholt.`,
  };
}

export interface RefundRunner {
  refund(swapIds: string[]): Promise<{ signature?: string; refunded: string[]; failed: { swapId: string; reason: string }[] }>;
  /**
   * Welche dieser Sperren liegen noch offen auf der Kette (4.6c)? Eingeloeste,
   * zurueckgeholte oder nie angelegte brauchen keinen Wallet-Dialog – und
   * reissen in einer gemeinsamen Transaktion die offenen nicht mehr mit.
   */
  offen?(swapIds: string[]): Promise<string[]>;
}

export interface SweepResult {
  geprueft: number;
  zurueckgeholt: number;
  lamports: number;
  fehler: { reference: string; reason: string }[];
  /** Noch laufende Sperren, für die Anzeige. */
  offen: LockView[];
}

/**
 * Prüft alle gemerkten Sperren und holt zurück, was fällig ist.
 *
 * Bewusst tolerant: ein Fehlschlag bei einer Sperre darf die anderen nicht
 * verhindern. Und bewusst zählend: nach mehreren Fehlversuchen wird nicht mehr
 * automatisch probiert, weil jeder Versuch Gebühren kostet.
 */
export async function sweepPendingRefunds(
  runner: RefundRunner,
  nowUnix = Math.floor(Date.now() / 1000),
): Promise<SweepResult> {
  const locks = listPendingLocks();
  const result: SweepResult = { geprueft: locks.length, zurueckgeholt: 0, lamports: 0, fehler: [], offen: [] };

  for (const lock of locks) {
    const view = viewLock(lock, nowUnix);
    if (view.status !== "faellig") {
      result.offen.push(view);
      continue;
    }

    try {
      const offen = runner.offen ? await runner.offen(lock.swapIds) : lock.swapIds;
      if (offen.length === 0) {
        // Nichts mehr zurueckzuholen (eingeloest oder schon zurueck) – ohne Transaktion abschliessen.
        await rememberLock({ ...lock, settled: true });
        continue;
      }
      const r = await runner.refund(offen);
      if (r.refunded.length > 0) {
        await rememberLock({ ...lock, settled: true });
        result.zurueckgeholt++;
        result.lamports += lock.amountLamports;
      } else {
        const grund = r.failed[0]?.reason ?? "unbekannt";
        await rememberLock({ ...lock, attempts: (lock.attempts ?? 0) + 1, lastError: grund });
        result.fehler.push({ reference: lock.reference, reason: grund });
        result.offen.push(viewLock({ ...lock, attempts: (lock.attempts ?? 0) + 1, lastError: grund }, nowUnix));
      }
    } catch (e) {
      const grund = (e as Error).message;
      await rememberLock({ ...lock, attempts: (lock.attempts ?? 0) + 1, lastError: grund });
      result.fehler.push({ reference: lock.reference, reason: grund });
    }
  }
  return result;
}

/**
 * Hintergrund-Überwachung.
 *
 * Läuft, solange die App offen ist. Der erste Durchlauf erfolgt sofort — ein
 * Nutzer, der die App nach zwei Tagen wieder öffnet, soll sein Geld bekommen,
 * ohne auf das nächste Intervall zu warten.
 */
export function startRefundWatcher(
  runner: RefundRunner,
  onResult?: (r: SweepResult) => void,
  intervalMs = 5 * 60_000,
): () => void {
  let stopped = false;

  const run = async (): Promise<void> => {
    if (stopped) return;
    try {
      const r = await sweepPendingRefunds(runner);
      onResult?.(r);
    } catch (e) {
      // Ein Fehler in der Überwachung darf die App nicht beeinträchtigen.
      console.warn(`[refund] Durchlauf fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Erzeugt einen Runner auf Basis der Wallet-Anbindung. */
export function walletRefundRunner(
  connection: import("@solana/web3.js").Connection,
  wallet: WalletSigner,
): RefundRunner {
  return {
    async refund(swapIds: string[]) {
      const { refundDepositOnChain } = await import("./sol-htlc.js");
      return refundDepositOnChain({ connection, wallet, swapIds });
    },
    async offen(swapIds: string[]) {
      const { AnchorSolanaHtlc } = await import("@freedomstack/protocol");
      const leser = AnchorSolanaHtlc.reader(connection);
      const offen: string[] = [];
      for (const id of swapIds) {
        const l = await leser.get(id);
        if (l && !l.claimed && !l.refunded) offen.push(id);
      }
      return offen;
    },
  };
}
