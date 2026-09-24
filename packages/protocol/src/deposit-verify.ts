/**
 * On-Chain-Prüfung von Deposit-Sessions.
 *
 * DIE LÜCKE, DIE DAS SCHLIESST
 * `validateSolDeposit()` im Provider prüfte bisher ausschließlich, ob das
 * Deposit-Event in sich schlüssig ist: stimmt spend + refund = total, ist der
 * Provider der richtige, ist der Timelock noch offen. Alles davon steht in
 * einem Event, das der Kunde selbst signiert hat. Ein beliebiger Betrag ließ
 * sich also einfach behaupten — im Client wurde die Zahl obendrein nur in
 * `localStorage` hochgezählt, ohne dass je eine Transaktion stattfand.
 *
 * Damit war die bezahlte Nutzung effektiv kostenlos: Deposit-Event mit
 * 10 SOL veröffentlichen, Inferenz verbrauchen, nie etwas hinterlegen.
 *
 * WAS HIER GEPRÜFT WIRD
 * Der Provider schaut selbst auf die Kette und vergleicht, was das Event
 * behauptet, mit dem, was tatsächlich gesperrt ist:
 *   - existiert das Verbrauchs-HTLC überhaupt?
 *   - liegt mindestens der behauptete Betrag darin?
 *   - ist der Provider der Empfänger (und nicht jemand anderes)?
 *   - läuft der Timelock lange genug, um die Arbeit noch abrechnen zu können?
 *   - wurde das HTLC bereits geleert (claimed/refunded)?
 *
 * BEWUSST NICHT GEPRÜFT
 * Ob der Kunde das Geld „legitim" besitzt. Das geht das Protokoll nichts an.
 */
import { AnchorSolanaHtlc } from "./solana-adapter.js";
import { ParsedSolDepositOpen } from "./sol-deposit.js";
import type { Connection } from "@solana/web3.js";

export interface OnChainCheck {
  ok: boolean;
  /** Tatsächlich auf der Kette gesperrte Lamports im Verbrauchs-HTLC. */
  lockedLamports: number;
  /** Wieviel davon nutzbar ist (0, wenn nicht verwendbar). */
  usableLamports: number;
  problems: string[];
  /** Kurzfassung für Logs und für die Rückmeldung an den Kunden. */
  summary: string;
}

export interface DepositVerifyOptions {
  /**
   * Wie lange der Timelock nach Jobbeginn mindestens noch laufen muss.
   *
   * Läuft er während der Arbeit ab, kann der Kunde alles zurückholen, während
   * der Provider bereits gerechnet hat. Eine Stunde Vorlauf ist die
   * Untergrenze, unter der ein längerer Job nicht mehr sicher abrechenbar ist.
   */
  minRemainingSeconds?: number;
  /** Abweichung nach unten, die als Rundungsrest toleriert wird. */
  toleranceLamports?: number;
  nowUnix?: number;
  /**
   * Solana-Adresse des Providers (base58).
   *
   * Steht bewusst NICHT im Deposit-Event: dort ist nur der Nostr-Pubkey
   * hinterlegt, und die beiden Schluessel haben nichts miteinander zu tun.
   * Der Provider kennt seine eigene Adresse — sie vom Kunden zu uebernehmen
   * hiesse, die Pruefung dem zu ueberlassen, der geprueft wird.
   */
  expectedRecipient?: string;
}

/**
 * Prüft eine Deposit-Session gegen die Kette.
 *
 * Gibt niemals `ok: true` zurück, wenn die Kette nicht erreichbar war — im
 * Zweifel gilt das Deposit als ungedeckt. Ein Netzwerkproblem beim Provider
 * darf nicht dazu führen, dass unbezahlte Arbeit ausgeliefert wird.
 */
export async function verifyDepositOnChain(
  deposit: ParsedSolDepositOpen,
  conn: Connection,
  opts: DepositVerifyOptions = {},
): Promise<OnChainCheck> {
  const now = opts.nowUnix ?? Math.floor(Date.now() / 1000);
  const minRemaining = opts.minRemainingSeconds ?? 3600;
  const tolerance = opts.toleranceLamports ?? 0;
  const problems: string[] = [];

  let lock: Awaited<ReturnType<AnchorSolanaHtlc["get"]>>;
  try {
    // Nur lesend — dafür wird kein Keypair gebraucht.
    const reader = AnchorSolanaHtlc.reader(conn);
    lock = await reader.get(deposit.spendSwapId);
  } catch (e) {
    return {
      ok: false,
      lockedLamports: 0,
      usableLamports: 0,
      problems: [`Kette nicht erreichbar: ${(e as Error).message}`],
      summary:
        "Deposit nicht prüfbar — die Solana-Verbindung antwortet nicht. " +
        "Im Zweifel gilt es als ungedeckt.",
    };
  }

  if (!lock) {
    return {
      ok: false,
      lockedLamports: 0,
      usableLamports: 0,
      problems: [`Kein HTLC unter swap_id ${deposit.spendSwapId} auf der Kette.`],
      summary: "Das Deposit wurde behauptet, aber nie hinterlegt.",
    };
  }

  if (lock.claimed) problems.push("Das Verbrauchs-HTLC wurde bereits eingelöst.");
  if (lock.refunded) problems.push("Das Verbrauchs-HTLC wurde bereits zurückgeholt.");

  if (opts.expectedRecipient && lock.recipient !== opts.expectedRecipient) {
    problems.push(
      `Empfänger auf der Kette (${lock.recipient.slice(0, 8)}…) ist nicht der Provider ` +
        `(${opts.expectedRecipient.slice(0, 8)}…).`,
    );
  } else if (!opts.expectedRecipient) {
    // Ohne bekannte eigene Adresse ist die wichtigste Frage offen: das Geld
    // könnte an einen Dritten gesperrt sein. Lieber ablehnen als raten.
    problems.push("Eigene SOL-Adresse nicht konfiguriert — Empfänger nicht prüfbar (SOL_ADDRESS setzen).");
  }

  if (lock.amountLamports + tolerance < deposit.spendLamports) {
    problems.push(
      `Gesperrt sind ${lock.amountLamports} Lamports, behauptet werden ${deposit.spendLamports}.`,
    );
  }

  const remaining = lock.timelockUnix - now;
  if (remaining <= 0) {
    problems.push("Der Timelock ist bereits abgelaufen — der Kunde kann jederzeit zurückholen.");
  } else if (remaining < minRemaining) {
    problems.push(
      `Timelock läuft in ${Math.floor(remaining / 60)} Minuten ab; für eine sichere ` +
        `Abrechnung sind mindestens ${Math.floor(minRemaining / 60)} nötig.`,
    );
  }

  if (lock.timelockUnix < deposit.timelockUnix) {
    // Das Event darf keine längere Frist versprechen als die Kette hergibt.
    problems.push(
      `Das Event nennt einen späteren Timelock (${deposit.timelockUnix}) als die Kette (${lock.timelockUnix}).`,
    );
  }

  const ok = problems.length === 0;
  const usable = ok ? Math.min(lock.amountLamports, deposit.spendLamports) : 0;

  return {
    ok,
    lockedLamports: lock.amountLamports,
    usableLamports: usable,
    problems,
    summary: ok
      ? `Deposit gedeckt: ${lock.amountLamports} Lamports gesperrt, Timelock läuft noch ${Math.floor(remaining / 60)} Minuten.`
      : problems[0],
  };
}

/**
 * Cache für On-Chain-Prüfungen.
 *
 * Ohne den würde jeder einzelne Job derselben Session eine RPC-Abfrage
 * auslösen — bei einem Chat mit zwanzig Nachrichten also zwanzigmal dieselbe
 * Antwort. Die TTL ist bewusst kurz: eine Session kann zwischenzeitlich
 * eingelöst oder zurückgeholt worden sein.
 */
export class DepositVerificationCache {
  private entries = new Map<string, { check: OnChainCheck; expiresAt: number }>();

  constructor(private ttlSeconds = 60) {}

  get(sessionId: string, nowUnix = Math.floor(Date.now() / 1000)): OnChainCheck | undefined {
    const e = this.entries.get(sessionId);
    if (!e) return undefined;
    if (e.expiresAt <= nowUnix) {
      this.entries.delete(sessionId);
      return undefined;
    }
    return e.check;
  }

  set(sessionId: string, check: OnChainCheck, nowUnix = Math.floor(Date.now() / 1000)): void {
    // Negative Ergebnisse kürzer cachen: ein Kunde, der gerade nachlegt, soll
    // nicht eine volle Minute abgewiesen werden.
    const ttl = check.ok ? this.ttlSeconds : Math.min(this.ttlSeconds, 15);
    this.entries.set(sessionId, { check, expiresAt: nowUnix + ttl });
  }

  /** Nach Verbrauch invalidieren — der Betrag hat sich geändert. */
  invalidate(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  size(): number {
    return this.entries.size;
  }

  /** Abgelaufene Einträge entfernen, damit die Map nicht unbegrenzt wächst. */
  prune(nowUnix = Math.floor(Date.now() / 1000)): number {
    let removed = 0;
    for (const [k, v] of this.entries) {
      if (v.expiresAt <= nowUnix) {
        this.entries.delete(k);
        removed++;
      }
    }
    return removed;
  }
}
