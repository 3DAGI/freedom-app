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
 *
 * Versiegelt (Schritt 4.9): Dieselben Anfragen kommen im Umschlag (NIP-59,
 * `swap-versiegelt.ts`) von einem Wegwerf-Schluessel des Kunden; der LP
 * antwortet dann ebenso versiegelt. Offen nur noch fuer aeltere Apps – das
 * Angebot sagt mit ["versiegelt", "1"], dass dieser LP beides liest.
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
  LocalSigner,
  KIND_GIFT_WRAP,
  oeffneSwapAnfrage,
  versiegleSwapAntwort,
  type SwapAnfrage,
} from "@freedomstack/protocol";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Ephemere Swap-Signal-Kinds (20000-29999: ephemerer Bereich). */
export const KIND_SWAP_REQUEST = 25001;
export const KIND_SWAP_RESPONSE = 25002;

/** Was der LP von einer Anfrage braucht – offen (signiert) oder aus dem Umschlag. */
type Anfrage = SwapAnfrage;

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
   * Sitzungen der Hinrichtung dauerhaft ablegen (8.3) – ein Neustart darf
   * nicht vergessen, welche SOL gesperrt sind und nach der Frist zurueckgeholt
   * werden muessen.
   */
  hinSpeicher?: { lade(): SwapSession[]; speichere(s: SwapSession[]): void };
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
  return lpSpeicher<RueckSitzung>(pfad);
}

/** Sitzungen der Hinrichtung als Datei (8.3) – wie die der Gegenrichtung. */
export function hinSpeicher(pfad: string): { lade(): SwapSession[]; speichere(s: SwapSession[]): void } {
  return lpSpeicher<SwapSession>(pfad);
}

function lpSpeicher<T>(pfad: string): { lade(): T[]; speichere(s: T[]): void } {
  return {
    lade() {
      if (!existsSync(pfad)) return [];
      const daten = JSON.parse(readFileSync(pfad, "utf8")) as unknown;
      if (!Array.isArray(daten)) throw new Error(`${pfad}: keine Liste`);
      return daten as T[];
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
 * Hinrichtung (8.3): Zurueckholen erst so lange nach der Frist – die Uhr der
 * Kette darf etwas nachgehen, das Programm lehnt eine verfruehte Rueckholung ab.
 */
export const RUECKHOL_PUFFER_SECS = 120;

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
  /** Anfrage kam im Umschlag – Antworten gehen ebenso versiegelt (4.9). */
  versiegelt?: boolean;
}

export interface SwapSession {
  requestId: string;
  customerPubkey: string;
  amountSats: number;
  amountLamports: number;
  hashlockHex: string;
  /**
   * VORAB: Vorab-Gebuehr gestellt, noch nicht bezahlt (4.6d). SPERRT: gespeichert,
   * die Sperre ist unterwegs (8.3). REFUNDED: nach der Frist zurueckgeholt, die
   * Hold-Invoice abgebrochen (8.3).
   */
  phase: "VORAB" | "OFFERED" | "SPERRT" | "SOL_LOCKED" | "INVOICE_CREATED" | "SETTLED" | "REFUNDED" | "FAILED";
  /** Swap-ID, Frist und Empfaenger der Sperre (8.3) – noetig, um sie nach der Frist zurueckzuholen. */
  swapId?: string;
  timelockUnix?: number;
  kundeSol?: string;
  /** Anfrage kam im Umschlag – Antworten gehen ebenso versiegelt (4.9). */
  versiegelt?: boolean;
}

/** So lange wartet der LP auf die Vorab-Gebuehr (so lange gilt auch ihre Rechnung). */
export const VORAB_FRIST_SECS = 600;

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
  /** Hinrichtung: Anfragen, deren Vorab-Gebuehr noch aussteht (requestId -> …). */
  private vorab = new Map<string, { paymentHash: Uint8Array; bis: number; H: Uint8Array; kundeSol: string }>();
  /** Geoeffnete Umschlaege (ID -> Anfrage oder null) – jeder wird nur einmal entschluesselt. */
  private umschlaege = new Map<string, { createdAt: number; anfrage: SwapAnfrage | null }>();
  private signer: LocalSigner;

  constructor(
    private cfg: LpConfig,
    private pool: OutboxPool,
    private ln: LightningAdapter,
    private sol: SolanaHtlcAdapter,
    private rate: RateProvider,
    private jetzt: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.signer = new LocalSigner(cfg.keypair.sk);
    for (const s of cfg.speicher?.lade() ?? []) {
      this.rueck.set(s.requestId, s);
      this.seenRequests.add(s.requestId);
    }
    for (const s of cfg.hinSpeicher?.lade() ?? []) {
      this.sessions.set(s.requestId, s);
      this.seenRequests.add(s.requestId);
    }
  }

  /** Hinrichtung (8.3): Sitzungen mit Sperre ablegen – erledigte fallen heraus. */
  private hinSpeichern(): void {
    this.cfg.hinSpeicher?.speichere([...this.sessions.values()].filter((s) => s.swapId && ["SPERRT", "SOL_LOCKED", "INVOICE_CREATED"].includes(s.phase)));
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
          versiegelt: true,
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
    const filter = { "#p": [this.cfg.keypair.pk], since: now - 3600 };
    const [offen, umschlaege] = await Promise.all([
      this.pool.query({ kinds: [KIND_SWAP_REQUEST], ...filter }),
      this.pool.query({ kinds: [KIND_GIFT_WRAP], ...filter }),
    ]);
    const anfragen: Array<{ req: Anfrage; versiegelt: boolean }> = offen.map((req) => ({ req, versiegelt: false }));
    for (const w of umschlaege) {
      let u = this.umschlaege.get(w.id);
      if (!u) {
        // Auch Umschlaege anderer Dienste an denselben Schluessel (KI-Auftraege) – die ergeben null.
        u = { createdAt: w.created_at, anfrage: await oeffneSwapAnfrage(w, this.signer).catch(() => null) };
        this.umschlaege.set(w.id, u);
      }
      if (u.anfrage) anfragen.push({ req: u.anfrage, versiegelt: true });
    }
    for (const [id, u] of this.umschlaege) if (u.createdAt < now - 7200) this.umschlaege.delete(id);

    const out: Array<SwapSession | RueckSitzung> = [...await this.vorabPruefen()];
    for (const { req, versiegelt } of anfragen) {
      if (this.seenRequests.has(req.id)) continue;
      this.seenRequests.add(req.id);
      // Anfragen an ein anderes Angebot desselben LP (andere Richtung) still uebergehen.
      if (getTag(req, "offer") !== this.cfg.offer.offerId) continue;
      try {
        out.push(this.cfg.offer.direction === "buy-sol" ? await this.handleRueckRequest(req, versiegelt) : await this.handleRequest(req, versiegelt));
      } catch (err) {
        if (err instanceof NochKeineSperre && now - req.created_at < WARTE_AUF_SPERRE_SECS) {
          this.seenRequests.delete(req.id); // beim naechsten Durchlauf erneut
          continue;
        }
        console.error(`Swap-Request ${req.id} fehlgeschlagen:`, err);
        // Gegenrichtung: Der Kunde hat SOL gesperrt und muss wissen, dass er nach Ablauf zurueckholen muss.
        if (this.cfg.offer.direction === "buy-sol") await this.sende(req.id, req.pubkey, versiegelt, "ABGELEHNT", (err as Error).message);
      }
    }
    return out;
  }

  /** Antwort an den Kunden – versiegelt, wenn seine Anfrage versiegelt kam. */
  private async antwortSenden(requestId: string, kunde: string, versiegelt: boolean | undefined, tags: string[][], content: string): Promise<void> {
    await this.pool.publish(versiegelt
      ? await versiegleSwapAntwort({ lp: this.signer, kundePk: kunde, anfrageId: requestId, tags, content })
      : signEvent(buildEvent(this.cfg.keypair.pk, KIND_SWAP_RESPONSE, [["e", requestId], ["p", kunde], ...tags], content), this.cfg.keypair.sk));
  }

  private async handleRequest(req: Anfrage, versiegelt = false): Promise<SwapSession> {
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
      ...(versiegelt ? { versiegelt } : {}),
    };
    this.sessions.set(req.id, session);

    // Gegen Blockaden (4.6d): erst eine kleine, nicht erstattbare Vorab-Gebuehr,
    // dann sperren. Sonst koennte jeder mit Anfragen, die er nie bezahlt, die
    // Liquiditaet des LP bis T_sol binden.
    const vorabSats = this.cfg.offer.vorabSats ?? 0;
    if (vorabSats > 0) {
      if (!this.ln.createInvoice) throw new Error("Lightning-Adapter kann keine Vorab-Rechnung stellen");
      const r = await this.ln.createInvoice(vorabSats);
      this.vorab.set(req.id, { paymentHash: r.paymentHash, bis: this.jetzt() + VORAB_FRIST_SECS, H, kundeSol: customerSol });
      session.phase = "VORAB";
      await this.antwortSenden(req.id, req.pubkey, versiegelt, [["status", "VORAB"], ["vorab_sats", String(vorabSats)]], r.bolt11);
      return session;
    }
    return this.sperreUndStelle(session, H, customerSol);
  }

  /**
   * Vorab-Gebuehren nachsehen: bezahlt → jetzt sperren und die Hold-Invoice
   * stellen; nach VORAB_FRIST_SECS unbezahlt → verwerfen.
   */
  private async vorabPruefen(): Promise<SwapSession[]> {
    const now = this.jetzt();
    const weiter: SwapSession[] = [];
    for (const [id, v] of this.vorab) {
      const session = this.sessions.get(id)!;
      try {
        if ((await this.ln.getInvoiceState(v.paymentHash)) === "SETTLED") {
          this.vorab.delete(id);
          weiter.push(await this.sperreUndStelle(session, v.H, v.kundeSol));
        } else if (now >= v.bis) {
          this.vorab.delete(id);
          session.phase = "FAILED";
        }
      } catch (err) {
        console.error(`Swap-Request ${id} nach Vorab-Gebuehr fehlgeschlagen:`, (err as Error).name);
        this.vorab.delete(id);
        session.phase = "FAILED";
        await this.sende(id, session.customerPubkey, session.versiegelt, "ABGELEHNT", "Sperren fehlgeschlagen");
      }
    }
    return weiter;
  }

  /** LP-Seite: SOL sperren + Hold-Invoice stellen (LP zahlt mit sats-Eingang). */
  private async sperreUndStelle(session: SwapSession, H: Uint8Array, customerSol: string): Promise<SwapSession> {
    const { requestId, amountSats, amountLamports } = session;
    const req = { id: requestId, pubkey: session.customerPubkey };
    const swapId = `swap-${req.id.slice(0, 16)}`;
    const timelockUnix = this.jetzt() + this.cfg.offer.tSolSecs;
    // Erst ablegen, dann sperren (8.3): Ein Neustart darf gesperrte SOL nicht vergessen.
    Object.assign(session, { swapId, timelockUnix, kundeSol: customerSol, phase: "SPERRT" });
    this.hinSpeichern();
    await this.sol.lock({
      swapId,
      hashlock: H,
      amountLamports,
      timelockUnix,
      recipient: customerSol,
      initiator: this.cfg.keypair.pk,
    });
    session.phase = "SOL_LOCKED";
    this.hinSpeichern();

    // Scheitert die Rechnung, bleibt die Sperre in der Ablage – nach der Frist holt der LP sie zurueck.
    const invoice = await this.ln.createHoldInvoice(
      H,
      amountSats,
      this.cfg.offer.lnCltvDeltaBlocks,
    );
    session.phase = "INVOICE_CREATED";
    this.hinSpeichern();

    // Antwort: Kunde erhaelt die bolt11 zum Bezahlen
    await this.antwortSenden(req.id, req.pubkey, session.versiegelt, [
      ["swap_id", swapId],
      ["amount_lamports", String(amountLamports)],
    ], invoice.bolt11);
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
      const swapId = session.swapId ?? `swap-${session.requestId.slice(0, 16)}`;
      const revealed = await this.sol.getRevealedPreimage(swapId);
      if (!revealed) continue;
      if (toHex(hashlock(revealed)) !== session.hashlockHex) continue;
      await this.ln.settleHoldInvoice(revealed);
      session.phase = "SETTLED";
      settled.push(session.requestId);
    }
    if (settled.length > 0) this.hinSpeichern();
    return settled;
  }

  /**
   * Ablauf der Hinrichtung (8.3): Hat der Kunde bis zur Frist nicht eingeloest,
   * holt der LP seine SOL zurueck und bricht danach die Hold-Invoice ab – die
   * Reihenfolge ist wichtig: Nach der Rueckholung kann niemand mehr einloesen,
   * vorher waere ein Abbruch ein Geschenk (SOL weg, sats zurueck). Hat der
   * Kunde doch eingeloest, wird abgerechnet. Fehler bleiben fuer die naechste Runde.
   */
  async holeAbgelaufeneZurueck(): Promise<SwapSession[]> {
    const now = this.jetzt();
    const erledigt: SwapSession[] = [];
    for (const s of this.sessions.values()) {
      if (!s.swapId || s.timelockUnix === undefined || !["SPERRT", "SOL_LOCKED", "INVOICE_CREATED"].includes(s.phase)) continue;
      if (now < s.timelockUnix + RUECKHOL_PUFFER_SECS) continue;
      try {
        const offengelegt = await this.sol.getRevealedPreimage(s.swapId);
        if (offengelegt && toHex(hashlock(offengelegt)) === s.hashlockHex) {
          // Eingeloest: Die sats gehoeren dem LP – die Hold-Invoice laeuft laenger als die Sperre.
          if (s.phase === "INVOICE_CREATED") await this.ln.settleHoldInvoice(offengelegt);
          s.phase = "SETTLED";
        } else {
          const sperre = await this.sol.get(s.swapId);
          if (sperre?.claimed || (!sperre && s.phase !== "SPERRT")) {
            // Eingeloest oder schon geschlossen, das Preimage aber (noch) nicht lesbar: nie
            // abbrechen – sonst haette der Kunde SOL und sats. Weiter nach dem Preimage suchen;
            // erst wenn die Hold-Invoice ohnehin abgelaufen ist, aufgeben.
            if (now < s.timelockUnix + this.cfg.offer.lnCltvDeltaBlocks * 600) continue;
            s.phase = "FAILED";
          } else {
            if (sperre && !sperre.refunded) await this.sol.refund(s.swapId);
            if (s.phase === "INVOICE_CREATED") {
              await this.ln.cancelHoldInvoice(fromHex(s.hashlockHex)).catch((e) => {
                // Schon abgelaufen oder abgebrochen: nichts mehr zu tun
                console.warn(`[lp] Hold-Invoice ${s.swapId}: ${(e as Error).name}`);
              });
            }
            s.phase = sperre ? "REFUNDED" : "FAILED";
          }
        }
        erledigt.push(s);
      } catch (e) {
        console.error(`[lp] Ablauf ${s.swapId}:`, (e as Error).name);
      }
    }
    if (erledigt.length > 0) this.hinSpeichern();
    return erledigt;
  }

  // ------------------------------------------------------ Gegenrichtung (4.6b)

  private async handleRueckRequest(req: Anfrage, versiegelt = false): Promise<RueckSitzung> {
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
      ...(versiegelt ? { versiegelt } : {}),
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
    await this.sende(s.requestId, s.customerPubkey, s.versiegelt, s.phase, ANTWORT[s.phase], s.swapId);
  }

  private async sende(requestId: string, kunde: string, versiegelt: boolean | undefined, status: string, text: string, swapId?: string): Promise<void> {
    try {
      await this.antwortSenden(requestId, kunde, versiegelt, [...(swapId ? [["swap_id", swapId]] : []), ["status", status]], text);
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
