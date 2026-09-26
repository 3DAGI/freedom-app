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
 *
 * Gegenrichtung (Angebot "buy-sol", Schritt 4.6b): Der Kunde hat SOL fuer den
 * LP gesperrt – unter der Swap-ID `rueckSwapId(bolt11)` – und schickt
 * ["offer"] und ["bolt11"] (Rechnung seiner Wallet). Sein SOL-Konto ist der
 * Initiator der Sperre. Der LP prueft Sperre und Rechnung, zahlt mit
 * cltv_limit und loest mit dem Preimage die SOL ein – nur bis T_sol − 10
 * Minuten. Sitzungen werden gespeichert, BEVOR gezahlt wird: Nach einem
 * Neustart holt `nachholen()` das Preimage bei LND und loest trotzdem ein.
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
  leseBolt11,
  maxCltvLimitFuer,
  pruefeRueckSwapSperre,
  rueckSwapId,
  rueckSwapLamports,
} from "@freedomstack/protocol";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
  /** SOL-Adresse des LP – Empfaenger der Sperren in der Gegenrichtung (4.6b). */
  solAdresse?: string;
  /** Sitzungen der Gegenrichtung dauerhaft ablegen – ein Neustart darf kein Preimage kosten. */
  speicher?: { lade(): RueckSitzung[]; speichere(s: RueckSitzung[]): void };
  /**
   * Gegen Blockaden (4.6b): hoechstens so viele Zahlungen gleichzeitig in der
   * Schwebe. Wer das Preimage zurueckhaelt, bindet sats des LP bis zum
   * cltv_limit – mehr als diese Zahl gleichzeitig geht nicht. Standard 3.
   */
  maxOffeneZahlungen?: number;
}

/**
 * Sitzungen der Gegenrichtung als Datei (nur fuer den Nutzer lesbar, 0600).
 * Geschrieben wird ueber eine Zwischendatei – ein Absturz mitten im Schreiben
 * darf die letzte gute Fassung (mit dem Preimage) nicht zerstoeren.
 */
export function rueckSpeicher(pfad: string): { lade(): RueckSitzung[]; speichere(s: RueckSitzung[]): void } {
  return {
    lade() {
      if (!existsSync(pfad)) return [];
      const daten = JSON.parse(readFileSync(pfad, "utf8")) as unknown;
      if (!Array.isArray(daten)) throw new Error(`${pfad}: keine Liste`);
      return daten as RueckSitzung[];
    },
    speichere(sitzungen) {
      mkdirSync(dirname(pfad), { recursive: true, mode: 0o700 });
      const tmp = `${pfad}.tmp`;
      writeFileSync(tmp, JSON.stringify(sitzungen), { mode: 0o600 });
      renameSync(tmp, pfad);
    },
  };
}

/** Einloesen nur bis T_sol minus 10 Minuten (wie claimAllowed() in der App). */
export const EINLOESE_ABSTAND_SECS = 600;

/**
 * Kommt die Anfrage vor der bestaetigten Sperre, wird sie so lange (ab ihrem
 * Zeitstempel) bei jedem Durchlauf erneut geprueft statt verworfen.
 */
export const WARTE_AUF_SPERRE_SECS = 600;
class NochKeineSperre extends Error {}

/** Oeffentliche Antwort je Phase – nur eigene, feste Texte, nie Meldungen von LND. */
const ANTWORT: Record<RueckSitzung["phase"], string> = {
  ZAHLT: "",
  BEZAHLT: "",
  EINGELOEST: "",
  GESCHEITERT: "Zahlung gescheitert – SOL nach Ablauf der Sperre zurückholen",
  ZU_SPAET: "zu spät bezahlt – SOL nach Ablauf der Sperre zurückholen",
};

/** Gegenrichtung (buy-sol): Kunde gibt SOL, LP zahlt seine Rechnung. */
export interface RueckSitzung {
  requestId: string;
  customerPubkey: string;
  swapId: string;
  kundeSol: string;
  bolt11: string;
  paymentHashHex: string;
  amountSats: number;
  amountLamports: number;
  timelockUnix: number;
  cltvLimit: number;
  /** Erst nach erfolgreicher Zahlung gesetzt. */
  preimageHex?: string;
  phase: "ZAHLT" | "BEZAHLT" | "EINGELOEST" | "GESCHEITERT" | "ZU_SPAET";
  grund?: string;
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
  private rueck = new Map<string, RueckSitzung>();
  /** Zahlungen, die in diesem Prozess gerade laufen (requestId -> Ablauf). */
  private laufend = new Map<string, Promise<void>>();
  private angebotVeroeffentlicht = 0;

  constructor(
    private cfg: LpConfig,
    private pool: OutboxPool,
    private ln: LightningAdapter,
    private sol: SolanaHtlcAdapter,
    private rate: RateProvider,
    private jetzt: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    for (const s of cfg.speicher?.lade() ?? []) {
      this.rueck.set(s.requestId, s);
      this.seenRequests.add(s.requestId);
    }
  }

  /** LP-Angebot auf den Relays veroeffentlichen (ersetzbar via d-Tag). */
  async publishOffer(now = Math.floor(Date.now() / 1000)): Promise<string> {
    // Gegenrichtung: Ohne SOL-Konto und genauen Kurs kann kein Kunde sperren.
    const rueck = this.cfg.offer.direction === "buy-sol";
    if (rueck && !this.cfg.solAdresse) throw new Error("buy-sol braucht eine SOL-Adresse des LP");
    const ev = signEvent(
      buildLpOffer(
        {
          ...this.cfg.offer,
          expiry: now + this.cfg.offerTtlSecs,
          ...(rueck ? { solAddress: this.cfg.solAdresse, lamportsPerSat: this.rate.lamportsPerSat() } : {}),
        },
        this.cfg.keypair.pk,
        now,
      ),
      this.cfg.keypair.sk,
    );
    await this.pool.publish(ev);
    this.angebotVeroeffentlicht = now;
    return ev.id;
  }

  /**
   * Angebot erneuern, sobald die Haelfte seiner Gueltigkeit um ist – sonst
   * verschwindet der LP nach `offerTtlSecs` aus jeder App. Liefert die
   * Event-ID, wenn neu veroeffentlicht wurde.
   */
  async erneuereAngebot(now = Math.floor(Date.now() / 1000)): Promise<string | undefined> {
    if (now - this.angebotVeroeffentlicht < this.cfg.offerTtlSecs / 2) return undefined;
    return this.publishOffer(now);
  }

  /** Einmal pollen: neue Swap-Requests an diesen LP abarbeiten. */
  async pollOnce(now = Math.floor(Date.now() / 1000)): Promise<Array<SwapSession | RueckSitzung>> {
    const events = await this.pool.query({
      kinds: [KIND_SWAP_REQUEST],
      "#p": [this.cfg.keypair.pk],
      since: now - 3600,
    });
    const out: Array<SwapSession | RueckSitzung> = [];
    for (const ev of events) {
      if (this.seenRequests.has(ev.id)) continue;
      this.seenRequests.add(ev.id);
      // Anfragen an ein anderes Angebot desselben LP (andere Richtung) still uebergehen.
      if (getTag(ev, "offer") !== this.cfg.offer.offerId) continue;
      try {
        out.push(this.cfg.offer.direction === "buy-sol" ? await this.handleRueckRequest(ev) : await this.handleRequest(ev));
      } catch (err) {
        if (err instanceof NochKeineSperre && now - ev.created_at < WARTE_AUF_SPERRE_SECS) {
          this.seenRequests.delete(ev.id); // beim naechsten Durchlauf erneut
          continue;
        }
        console.error(`Swap-Request ${ev.id} fehlgeschlagen:`, err);
        // Gegenrichtung: Der Kunde hat SOL gesperrt und muss wissen, dass er nach Ablauf zurueckholen muss.
        if (this.cfg.offer.direction === "buy-sol") await this.sende(ev.id, ev.pubkey, "ABGELEHNT", (err as Error).message);
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

  // ------------------------------------------------------ Gegenrichtung (4.6b)

  private async handleRueckRequest(req: NostrEvent): Promise<RueckSitzung> {
    const now = this.jetzt();
    if (getTag(req, "offer") !== this.cfg.offer.offerId) throw new Error("fremdes Angebot");
    const lpSol = this.cfg.solAdresse;
    if (!lpSol) throw new Error("LP ohne SOL-Adresse (LP_SOL_ADDRESS)");
    const bolt11 = (getTag(req, "bolt11") ?? "").trim().toLowerCase();
    if (!bolt11 || bolt11.length > 2000) throw new Error("unvollstaendiger Request");
    const swapId = rueckSwapId(bolt11);
    if ([...this.rueck.values()].some((s) => s.swapId === swapId)) throw new Error("Swap schon bearbeitet");
    const offen = [...this.rueck.values()].filter((s) => s.phase === "ZAHLT").length;
    if (offen >= (this.cfg.maxOffeneZahlungen ?? 3)) throw new Error("zu viele offene Zahlungen – spaeter erneut");

    // Rechnung: gueltig signiert, ganzer sats-Betrag im Angebot.
    let rechnung: ReturnType<typeof leseBolt11>;
    try {
      rechnung = leseBolt11(bolt11);
    } catch (e) {
      // Meldungen der bech32-Bibliothek tragen die ganze fremde Rechnung – die nicht ins Log.
      const m = (e as Error).message;
      throw new Error(`Rechnung ungueltig: ${m.length > 80 ? "Kodierung" : m}`);
    }
    if (rechnung.betragMsat === null || rechnung.betragMsat % 1000 !== 0) throw new Error("Rechnung ohne ganzen sats-Betrag");
    const amountSats = rechnung.betragMsat / 1000;
    if (amountSats < this.cfg.offer.minSats || amountSats > this.cfg.offer.maxSats) throw new Error(`Betrag ausserhalb Angebot: ${amountSats}`);
    // Der Kunde gibt SOL im Wert der sats plus Gebuehr des LP.
    const amountLamports = rueckSwapLamports(amountSats, this.rate.lamportsPerSat(), this.cfg.offer.feePpm);

    // Sperre auf der Kette: Empfaenger, Betrag, Hashlock gleich dem Hash der
    // Rechnung, Frist lang genug fuer ein cltv_limit mit Abstand.
    const sperre = await this.sol.get(swapId);
    if (!sperre) throw new NochKeineSperre("keine Sperre auf der Kette");
    const cltvLimit = Math.min(this.cfg.offer.lnCltvDeltaBlocks, maxCltvLimitFuer(sperre.timelockUnix - now));
    if (cltvLimit <= 0) throw new Error("Frist der Sperre zu kurz fuer eine Zahlung");
    const p = pruefeRueckSwapSperre(sperre, { lpSolAdresse: lpSol, amountLamports, paymentHash: fromHex(rechnung.zahlungsHash), jetzt: now, lnCltvLimitBlocks: cltvLimit });
    if (!p.ok) throw new Error(p.grund);

    const s: RueckSitzung = {
      requestId: req.id, customerPubkey: req.pubkey, swapId, kundeSol: sperre.initiator, bolt11,
      paymentHashHex: rechnung.zahlungsHash, amountSats, amountLamports, timelockUnix: sperre.timelockUnix, cltvLimit, phase: "ZAHLT",
    };
    // Erst speichern, dann zahlen: Ein Neustart waehrend der Zahlung darf das Preimage nicht kosten.
    this.rueck.set(req.id, s);
    this.speichern();
    const lauf = this.zahleUndLoeseEin(s)
      .catch((e) => console.error(`[lp] Swap ${swapId.slice(0, 8)}:`, (e as Error).name))
      .finally(() => this.laufend.delete(s.requestId));
    this.laufend.set(s.requestId, lauf);
    return s;
  }

  private async zahleUndLoeseEin(s: RueckSitzung): Promise<void> {
    try {
      if (!this.ln.payInvoice) throw new Error("Lightning-Adapter kann nicht zahlen");
      this.bezahlt(s, (await this.ln.payInvoice(s.bolt11, s.cltvLimit)).preimage);
    } catch (e) {
      s.grund = (e as Error).message.slice(0, 200);
      // Ob die Zahlung wirklich gescheitert ist, weiss nur LND (Abbruch der
      // Verbindung ≠ gescheiterte Zahlung). Ohne Auskunft: gescheitert.
      if (!this.ln.zahlungsstand) s.phase = "GESCHEITERT";
      else await this.stand(s);
    }
    if (s.phase === "BEZAHLT") await this.loeseEin(s);
    this.speichern();
    if (s.phase !== "ZAHLT") await this.antworte(s);
  }

  /** Preimage uebernehmen – nur wenn es zum Hash der Rechnung passt. */
  private bezahlt(s: RueckSitzung, preimage: Uint8Array): void {
    if (toHex(hashlock(preimage)) !== s.paymentHashHex) throw new Error("Preimage passt nicht zur Rechnung");
    s.preimageHex = toHex(preimage);
    s.phase = "BEZAHLT";
    s.grund = undefined;
    this.speichern();
  }

  /** Stand einer offenen Zahlung bei LND nachschlagen. */
  private async stand(s: RueckSitzung): Promise<void> {
    const st = await this.ln.zahlungsstand!(fromHex(s.paymentHashHex));
    if (st.status === "erfolgreich" && st.preimage) this.bezahlt(s, st.preimage);
    else if (st.status === "gescheitert") {
      s.phase = "GESCHEITERT";
      s.grund = "Zahlung gescheitert";
    } else if (st.status === "unbekannt" && this.jetzt() >= s.timelockUnix - EINLOESE_ABSTAND_SECS) {
      // Nie bei LND angekommen, und die Frist ist ohnehin vorbei.
      s.phase = "GESCHEITERT";
      s.grund = "Zahlung bei LND unbekannt";
    }
  }

  private async loeseEin(s: RueckSitzung): Promise<void> {
    if (this.jetzt() >= s.timelockUnix - EINLOESE_ABSTAND_SECS) {
      s.phase = "ZU_SPAET";
      s.grund = "Frist der Sperre zu nah – nicht mehr eingeloest";
      return;
    }
    try {
      await this.sol.claim(s.swapId, fromHex(s.preimageHex!), s.kundeSol);
      s.phase = "EINGELOEST";
      s.grund = undefined;
    } catch (e) {
      // Bleibt BEZAHLT – nachholen() versucht es erneut.
      s.grund = `Einloesen: ${(e as Error).message.slice(0, 200)}`;
    }
  }

  /**
   * Nach einem Neustart und periodisch: Zahlungen, deren Ausgang offen ist,
   * bei LND nachschlagen; bezahlte, aber nicht eingeloeste Swaps einloesen.
   * Was in diesem Prozess gerade gezahlt wird, bleibt unberuehrt.
   */
  async nachholen(): Promise<RueckSitzung[]> {
    const geaendert: RueckSitzung[] = [];
    for (const s of this.rueck.values()) {
      if (this.laufend.has(s.requestId)) continue;
      const vorher = s.phase;
      try {
        if (s.phase === "ZAHLT" && this.ln.zahlungsstand) await this.stand(s);
        if (s.phase === "BEZAHLT") await this.loeseEin(s);
      } catch (e) {
        s.grund = (e as Error).message.slice(0, 200);
      }
      if (s.phase !== vorher) {
        geaendert.push(s);
        if (s.phase !== "BEZAHLT" && s.phase !== "ZAHLT") await this.antworte(s);
      }
    }
    if (geaendert.length) this.speichern();
    return geaendert;
  }

  /** Wartet auf laufende Zahlungen (Tests, sauberes Beenden). */
  async warteAufZahlungen(): Promise<void> {
    await Promise.all([...this.laufend.values()]);
  }

  private speichern(): void {
    this.cfg.speicher?.speichere([...this.rueck.values()]);
  }

  private async antworte(s: RueckSitzung): Promise<void> {
    await this.sende(s.requestId, s.customerPubkey, s.phase, ANTWORT[s.phase], s.swapId);
  }

  private async sende(requestId: string, kunde: string, status: string, text: string, swapId?: string): Promise<void> {
    try {
      await this.pool.publish(signEvent(buildEvent(this.cfg.keypair.pk, KIND_SWAP_RESPONSE, [
        ["e", requestId], ["p", kunde], ...(swapId ? [["swap_id", swapId]] : []), ["status", status],
      ], text), this.cfg.keypair.sk));
    } catch { /* Antwort ist best-effort; der Kunde sieht den Stand auch auf der Kette */ }
  }

  /** Sitzungen der Gegenrichtung (Monitoring, Tests). */
  rueckSitzungen(): RueckSitzung[] {
    return [...this.rueck.values()];
  }

  /** Aktive Sessions (Monitoring). */
  activeSessions(): SwapSession[] {
    return [...this.sessions.values()];
  }
}
