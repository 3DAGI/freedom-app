/**
 * LP-Daemon: Liquidity-Provider-Knoten fuer den Atomic-Swap-Marktplatz.
 *
 * Rolle im Protokoll (FreedomStack Whitepaper 5.3):
 *   - Veroeffentlicht ein LP-Angebot (kind 38001) auf Nostr-Relays
 *   - Lauscht auf Swap-Anfragen: Kunde will sats -> SOL tauschen
 *   - Fuehrt die LP-Seite des Swaps aus: SOL im HTLC sperren, Hold-Invoice
 *     stellen, nach Preimage-Offenlegung abrechnen
 *   - Verdient fee_ppm pro Swap (zweiter Revenue-Stream des Knotens,
 *     neben DVM-Jobs und der 1%-Protokollfee)
 *
 * Swap-Anfrage-Transport: v1 nutzt eine einfache Nostr-Konvention —
 * der Kunde publiziert ein ephemeres Request-Event (kind 25001) mit
 *   ["p", lpPubkey], ["offer", offerId], ["amount_sats", N],
 *   ["hashlock", H-hex], ["solana_address", addr]
 * Der LP antwortet mit kind 25002 (["e", requestId], bolt11 im content).
 * So bleibt alles Multi-Relay und ohne zentralen Server.
 *
 * Non-custodial: Der LP verwahrt nur seine eigenen SOL/sats. Der Kunde
 * erhaelt sein SOL direkt aus dem HTLC, niemals aus einer LP-Wallet.
 */
import {
  Keypair,
  OutboxPool,
  NostrEvent,
  signEvent,
  buildEvent,
  getTag,
  LpOffer,
  buildLpOffer,
  KIND_LP_OFFER,
  LightningAdapter,
  SolanaHtlcAdapter,
  generatePreimage,
  hashlock,
  fromHex,
  toHex,
  validateTimelockOrdering,
} from "@freedomstack/protocol";

/** Ephemere Swap-Signal-Kinds (20000-29999: ephemerer Bereich). */
export const KIND_SWAP_REQUEST = 25001;
export const KIND_SWAP_RESPONSE = 25002;

export interface LpConfig {
  keypair: Keypair;
  offer: Omit<LpOffer, "expiry">;
  /** Wie lange das Angebot gueltig ist (Sekunden, wird periodisch erneuert). */
  offerTtlSecs: number;
  /** Verfuegbare SOL-Liquiditaet in Lamports (Sicherheitsdeckel pro Swap). */
  maxLamportsPerSwap: number;
}

export interface SwapSession {
  requestId: string;
  customerPubkey: string;
  amountSats: number;
  amountLamports: number;
  hashlockHex: string;
  phase: "OFFERED" | "SOL_LOCKED" | "INVOICE_CREATED" | "SETTLED" | "REFUNDED" | "FAILED";
}

/** Wechselkurs-Quelle (spaeter: Orakel/Markt). v1: fixer Satz in Config. */
export interface RateProvider {
  /** Lamports pro Satoshi. */
  lamportsPerSat(): number;
}

export class FixedRate implements RateProvider {
  constructor(private rate: number) {}
  lamportsPerSat(): number {
    return this.rate;
  }
}

export class LpDaemon {
  private sessions = new Map<string, SwapSession>();
  private seenRequests = new Set<string>();

  constructor(
    private cfg: LpConfig,
    private pool: OutboxPool,
    private ln: LightningAdapter,
    private sol: SolanaHtlcAdapter,
    private rate: RateProvider,
  ) {}

  /** LP-Angebot auf den Relays veroeffentlichen (ersetzbar via d-Tag). */
  async publishOffer(now = Math.floor(Date.now() / 1000)): Promise<string> {
    const ev = signEvent(
      buildLpOffer(
        { ...this.cfg.offer, expiry: now + this.cfg.offerTtlSecs },
        this.cfg.keypair.pk,
        now,
      ),
      this.cfg.keypair.sk,
    );
    await this.pool.publish(ev);
    return ev.id;
  }

  /** Einmal pollen: neue Swap-Requests an diesen LP abarbeiten. */
  async pollOnce(now = Math.floor(Date.now() / 1000)): Promise<SwapSession[]> {
    const events = await this.pool.query({
      kinds: [KIND_SWAP_REQUEST],
      "#p": [this.cfg.keypair.pk],
      since: now - 3600,
    });
    const out: SwapSession[] = [];
    for (const ev of events) {
      if (this.seenRequests.has(ev.id)) continue;
      this.seenRequests.add(ev.id);
      try {
        out.push(await this.handleRequest(ev));
      } catch (err) {
        console.error(`Swap-Request ${ev.id} fehlgeschlagen:`, err);
      }
    }
    return out;
  }

  private async handleRequest(req: NostrEvent): Promise<SwapSession> {
    const offerId = getTag(req, "offer");
    const amountSats = Number(getTag(req, "amount_sats") ?? "0");
    const hashlockHex = getTag(req, "hashlock");
    const customerSol = getTag(req, "solana_address");
    if (offerId !== this.cfg.offer.offerId) throw new Error("fremdes Angebot");
    if (!hashlockHex || !customerSol) throw new Error("unvollstaendiger Request");
    // Genau 32 Byte hex. fromHex() schneidet sonst still ab, und das Sperren
    // fuellt mit Nullen auf: SOL laege unter einem Hash, dessen Preimage
    // niemand kennt, bis zur Frist fest (Schritt 0.J).
    if (!/^[0-9a-f]{64}$/i.test(hashlockHex)) throw new Error("Hashlock ungueltig (32 Byte hex erwartet)");
    if (amountSats < this.cfg.offer.minSats || amountSats > this.cfg.offer.maxSats) {
      throw new Error(`Betrag ausserhalb Angebot: ${amountSats}`);
    }

    const H = fromHex(hashlockHex);
    const amountLamports = amountSats * this.rate.lamportsPerSat();
    if (amountLamports > this.cfg.maxLamportsPerSwap) {
      throw new Error("ueber Liquiditaetsdeckel");
    }

    // Timelock-Ordnung VOR jeder Geldbewegung pruefen (Invariante 9)
    const tl = validateTimelockOrdering({
      tSolSecs: this.cfg.offer.tSolSecs,
      lnCltvDeltaBlocks: this.cfg.offer.lnCltvDeltaBlocks,
    });
    if (!tl.ok) throw new Error(`Timelock unsicher: ${tl.reason}`);

    const session: SwapSession = {
      requestId: req.id,
      customerPubkey: req.pubkey,
      amountSats,
      amountLamports,
      hashlockHex,
      phase: "OFFERED",
    };
    this.sessions.set(req.id, session);

    // LP-Seite: SOL sperren + Hold-Invoice stellen (LP zahlt mit sats-Eingang)
    const swapId = `swap-${req.id.slice(0, 16)}`;
    const timelockUnix = Math.floor(Date.now() / 1000) + this.cfg.offer.tSolSecs;
    await this.sol.lock({
      swapId,
      hashlock: H,
      amountLamports,
      timelockUnix,
      recipient: customerSol,
      initiator: this.cfg.keypair.pk,
    });
    session.phase = "SOL_LOCKED";

    const invoice = await this.ln.createHoldInvoice(
      H,
      amountSats,
      this.cfg.offer.lnCltvDeltaBlocks,
    );
    session.phase = "INVOICE_CREATED";

    // Antwort-Event: Kunde erhaelt die bolt11 zum Bezahlen
    const response = signEvent(
      buildEvent(
        this.cfg.keypair.pk,
        KIND_SWAP_RESPONSE,
        [
          ["e", req.id],
          ["p", req.pubkey],
          ["swap_id", swapId],
          ["amount_lamports", String(amountLamports)],
        ],
        invoice.bolt11,
      ),
      this.cfg.keypair.sk,
    );
    await this.pool.publish(response);
    return session;
  }

  /**
   * Settlement-Sweep: fuer alle Swaps mit gezahlter Invoice pruefen, ob die
   * Preimage auf Solana offengelegt wurde, und dann die Hold-Invoice settle.
   * Muss periodisch laufen (zusammen mit pollOnce).
   */
  async settleSweep(): Promise<string[]> {
    const settled: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.phase !== "INVOICE_CREATED") continue;
      const swapId = `swap-${session.requestId.slice(0, 16)}`;
      const revealed = await this.sol.getRevealedPreimage(swapId);
      if (!revealed) continue;
      if (toHex(hashlock(revealed)) !== session.hashlockHex) continue;
      await this.ln.settleHoldInvoice(revealed);
      session.phase = "SETTLED";
      settled.push(session.requestId);
    }
    return settled;
  }

  /** Aktive Sessions (Monitoring). */
  activeSessions(): SwapSession[] {
    return [...this.sessions.values()];
  }
}
