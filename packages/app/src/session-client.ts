/**
 * Session-Client (App-Seite, Stufe B): Streaming-Sats im KI-Tab.
 *
 * Ablauf aus User-Sicht:
 *   1. Erste Frage an einen Provider: Session wird eroeffnet (kind 38021,
 *      Budget + Rate-Deckel). Noch keine Zahlung.
 *   2. Jede Antwort: App prueft usage, publiziert Zahlungs-Beleg (38022)
 *      und loest Keysend-Settlement aus, sobald das Fenster faellig ist.
 *   3. Budget-Warnung bei 80%, Session-Close wenn leer oder TTL abgelaufen.
 *
 * Ohne verbundene Lightning-Wallet laeuft der "Beleg-only"-Modus: Die App
 * dokumentiert die Schuld signiert (38022), Settlement erfolgt dann beim
 * naechsten Wallet-Connect oder manuell. Der Provider sieht beides und
 * entscheidet selbst, wie viel Kredit er gibt (Betrugsrisiko = 1 Intervall).
 */
import {
  type NostrEvent,
  type Signer,
  OutboxPool,
  buildPrivateSessionEvent,
  buildEvent,
  buildSessionOpen,
  buildSessionPayment,
  parseSessionOpen,
  parseSessionPayment,
  checkSessionLedger,
  ParsedSessionOpen,
  ParsedSessionPayment,
  KIND_SESSION_OPEN,
  KIND_SESSION_PAYMENT,
  KIND_DVM_TEXT_GENERATION,
} from "@freedomstack/protocol";

export interface SessionClientConfig {
  /**
   * Signer je Provider – der Sitzungsschluessel (Schritt 3.1), nie die
   * Identitaet und nie der rohe Schluessel (Schritt 1.3).
   */
  signerFuer: (providerPubkey: string) => Signer;
  pool: OutboxPool;
  /** Standard-Budget pro Session in sats. */
  defaultBudgetSats: number;
  /** Settlement-Fenster in sats (so oft wird bezahlt). */
  settleEverySats: number;
  /** Session-TTL in Sekunden. */
  ttlSecs: number;
  /**
   * Rechenarbeit laut Angebot des Providers (Schritt 3.2): Sitzung und Belege
   * gehen versiegelt an ihn, der Knoten prueft sie vor dem Entschluesseln.
   */
  powFuer?: (providerPubkey: string) => number;
}

export const DEFAULT_SESSION_CONFIG = {
  defaultBudgetSats: 100,
  settleEverySats: 20,
  ttlSecs: 3600,
};

export interface ActiveSession {
  open: ParsedSessionOpen;
  payments: ParsedSessionPayment[];
  /** Gesamte aufgelaufene Schuld in msat (monoton, aus Results). */
  chargedMsat: number;
  /** Bereits per Keysend bezahlte Summe in msat. */
  paidMsat: number;
}

/** Keysend-Schnittstelle der App (WebLN/LND-Bridge; injizierbar fuer Tests). */
export interface KeysendWallet {
  /** Ziel = Provider-Lightning-Node-Pubkey oder lud16-alias. Gibt payment_ref zurueck. */
  keysend(destPubkey: string, amountMsat: number): Promise<string>;
}

export class SessionClient {
  private sessions = new Map<string, ActiveSession>();
  private seqCounters = new Map<string, number>();

  constructor(private cfg: SessionClientConfig) {}

  private sessionIdFor(providerPubkey: string): string {
    return `sess-${this.cfg.signerFuer(providerPubkey).publicKey().slice(0, 8)}-${providerPubkey.slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;
  }

  /** Aktive Session zu einem Provider (oder null). */
  activeFor(providerPubkey: string): ActiveSession | null {
    for (const s of this.sessions.values()) {
      if (s.open.providerPubkey === providerPubkey) {
        const now = Math.floor(Date.now() / 1000);
        if (now <= s.open.expiration && s.chargedMsat < s.open.maxTotalMsat) return s;
      }
    }
    return null;
  }

  /** Session eroeffnen (publiziert kind 38021). */
  async openSession(
    providerPubkey: string,
    budgetSats = this.cfg.defaultBudgetSats,
  ): Promise<ActiveSession> {
    const sessionId = this.sessionIdFor(providerPubkey);
    const signer = this.cfg.signerFuer(providerPubkey);
    const ev = await signer.signEvent(
      buildSessionOpen({
        customerPubkey: signer.publicKey(),
        providerPubkey,
        sessionId,
        maxTotalMsat: budgetSats * 1000,
        maxRatePerKTokenMsat: 2000, // Deckel: 2 sats/1k tokens
        settleEveryMsat: this.cfg.settleEverySats * 1000,
        ttlSecs: this.cfg.ttlSecs,
      }),
    );
    await this.versiegeltSenden(ev, providerPubkey, signer);
    const session: ActiveSession = {
      open: parseSessionOpen(ev),
      payments: [],
      chargedMsat: 0,
      paidMsat: 0,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /** Tags fuer einen DVM-Job: session-Tag wenn aktiv, sonst bid-Fallback. */
  jobTags(providerPubkey: string, fallbackBidMsat: number): string[][] {
    const session = this.activeFor(providerPubkey);
    if (session) {
      return [["session", session.open.sessionId]];
    }
    return [["bid", String(fallbackBidMsat)]];
  }

  /**
   * Nach empfangener Antwort: Schuld verbuchen, Beleg publizieren,
   * Settlement ausloesen wenn Fenster erreicht.
   * Gibt { settled, paymentRef } zurueck (settled=false im Beleg-only-Modus).
   */
  async chargeForResult(
    providerPubkey: string,
    amountMsat: number,
    resultEventId: string,
    wallet?: KeysendWallet,
  ): Promise<{ settled: boolean; paymentRef?: string; remainingMsat: number }> {
    let session = this.activeFor(providerPubkey);
    if (!session) session = await this.openSession(providerPubkey);

    session.chargedMsat += amountMsat;
    const seq = (this.seqCounters.get(session.open.sessionId) ?? 0) + 1;
    this.seqCounters.set(session.open.sessionId, seq);

    // Settlement-Fenster erreicht?
    const due = session.chargedMsat - session.paidMsat;
    let paymentRef: string | undefined;
    let settled = false;

    if (due >= session.open.settleEveryMsat && wallet) {
      // Keysend an den Provider (sein Nostr-pubkey-als-Node ist eine
      // Konvention; Produktion: Node-Pubkey aus dem Profil/Result-Tag).
      try {
        paymentRef = await wallet.keysend(providerPubkey, due);
        settled = true;
        session.paidMsat += due;
      } catch {
        settled = false; // Beleg-only: Schuld bleibt dokumentiert
      }
    }

    const cumulativeMsat = session.paidMsat;
    const signer = this.cfg.signerFuer(providerPubkey);
    const payment = await signer.signEvent(
      buildSessionPayment({
        customerPubkey: signer.publicKey(),
        sessionId: session.open.sessionId,
        seq,
        cumulativeMsat,
        unitsSinceLast: amountMsat,
        refEventId: resultEventId,
        paymentRef,
      }),
    );
    await this.versiegeltSenden(payment, providerPubkey, signer);
    session.payments.push(parseSessionPayment(payment));

    return {
      settled,
      paymentRef,
      remainingMsat: session.open.maxTotalMsat - session.chargedMsat,
    };
  }

  /**
   * Sitzung und Belege nur versiegelt an den Provider (Schritt 3.2): Budget,
   * Rate und bezahlte Summen stehen in keinem oeffentlichen Event.
   */
  private async versiegeltSenden(ev: NostrEvent, providerPubkey: string, signer: Signer): Promise<void> {
    const { wrap } = await buildPrivateSessionEvent({
      event: ev, sessionSigner: signer, providerPk: providerPubkey, powBits: this.cfg.powFuer?.(providerPubkey) ?? 0,
    });
    await this.cfg.pool.publish(wrap);
  }

  /** Budget-Stand einer Session (UI). */
  budgetState(providerPubkey: string): { charged: number; max: number; pct: number } | null {
    const s = this.activeFor(providerPubkey);
    if (!s) return null;
    return {
      charged: s.chargedMsat,
      max: s.open.maxTotalMsat,
      pct: Math.round((s.chargedMsat / s.open.maxTotalMsat) * 100),
    };
  }
}
