/**
 * DVM-Provider-Daemon: Das Herzstueck des Provider-Knotens.
 *
 * Loop (FreedomStack AGENT_HANDOFF, Aufgabe C):
 *   1. per REQ auf kind 5050 (DVM Text-Generation) lauschen
 *   2. Job an das lokale Inference-Backend geben (Ollama, GX10)
 *   3. Result publizieren (kind 6050) mit Betrag + eigener lud16
 *   4. Zahlung per NIP-57 Zap empfangen (mit 1%-Fee-Split an der Quelle)
 *   5. Leistungs-Event (38010) mit PoW publizieren -> Reputation/WoT
 *
 * Der Daemon verwahrt NICHTS: Kein Konto, keine Balance, kein Custody.
 * Zahlungen laufen direkt Kunde -> Provider via Lightning-Zap.
 */
import {
  NostrEvent,
  Keypair,
  OutboxPool,
  KIND_DVM_TEXT_GENERATION,
  KIND_SESSION_OPEN,
  KIND_SOL_DEPOSIT_OPEN,
  isDvmRequest,
  buildJobResult,
  buildEvent,
  signEvent,
  getTag,
  toHex,
  computeFeeSplit,
  mineEvent,
  buildPerformanceEvent,
  parseSessionOpen,
  parseSessionPayment,
  checkSessionLedger,
  ParsedSessionOpen,
  KIND_SESSION_PAYMENT,
  parseSolDepositOpen,
  ParsedSolDepositOpen,
  PROTOCOL_FEE_PPM,
  PROTOCOL_POOL_SHARE_PERCENT,
  KIND_GIFT_WRAP,
  LocalSigner,
  buildPrivateJobResponse,
  openPrivateKundenEvent,
  KIND_JOB_DISPUTE,
  parseDispute,
  KIND_PRICE_TICKER,
  marktKurs,
  msatZuLamports,
  lamportsProMsat,
} from "@freedomstack/protocol";
import { verifyDepositOnChain, DepositVerificationCache, parseClientFee, checkClientFee } from "@freedomstack/protocol";
import type { Connection } from "@solana/web3.js";
import { InferenceBackend, OllamaBackend } from "./inference.js";
import { ToolRegistry, ToolCall, defaultToolRegistry } from "./tools.js";

export interface ProviderConfig {
  /** Nostr-Keypair des Providers. */
  keypair: Keypair;
  /** Eigene Lightning-Adresse fuer Zap-Empfang. */
  lud16: string;
  /** Optional: eigene Solana-Adresse (2. Zahloption). Wenn gesetzt, bietet
   *  der Provider SOL-Zahlung im Result an. */
  solanaAddress?: string;
  /** Wechselkurs Lamports pro msat (fuer SOL-Betrag im Result), manuell.
   *  Bequemer ist solPriceSats; ohne beides gilt der Marktkurs (4.4). */
  lamportsPerMsat?: number;
  /** Optional: SOL-Preis in sats (z.B. 150000 = 1 SOL ~ 150k sats). Bequemer
   *  als lamportsPerMsat; wird intern umgerechnet (1 SOL = 1e9 lamports,
   *  1 sat = 1000 msat -> lamportsPerMsat = 1e9 / (solPriceSats*1000)). */
  solPriceSats?: number;
  /** Preis in Millisatoshi pro 1k Completion-Tokens. */
  pricePerKTokenMsat: number;
  /** Mindest-Gebot, unter dem Jobs ignoriert werden. */
  minBidMsat: number;
  /** PoW-Difficulty fuer Leistungs-Events (Sybil-Schutz). */
  powDifficulty: number;
  /**
   * Rechenarbeit (NIP-13-Bits), die private Anfragen im Umschlag tragen
   * muessen (Schritt 3.1). Steht im Angebot; ersetzt fuer sie das
   * Gratis-Kontingent je Schluessel. Default 12 (~0,1 s auf einem PC).
   */
  privatePowBits?: number;
  /**
   * Schritt 3.3: Anfragen und Antworten im Klartext protokollieren – nur zur
   * Fehlersuche (`LOG_KLARTEXT=1`), standardmaessig aus. Aus heisst: keine
   * Vorschau im Ergebnis (`outputPreview` leer), also auch keine im Log.
   */
  klartextProtokoll?: boolean;
  /** Season-Kennung fuer Leistungs-Events. */
  seasonId: string;
  /**
   * Grobe Region (eu, na, sa, af, as, oc).
   *
   * Steuert den Knappheitsbonus: ein Knoten in einer unterversorgten Region
   * ist fuer das Netz mehr wert als der zwanzigste in Mitteleuropa.
   */
  region?: string;
  /** RPC-Endpunkt fuer die On-Chain-Pruefung von Deposits. */
  solanaRpcUrl?: string;
  /** Fertige Verbindung statt URL — fuer Tests und fuer geteilte Verbindungen. */
  solConnection?: Connection;
  /** Mindest-Restlaufzeit des Timelocks in Sekunden (Default 1 h). */
  depositMinRemainingSeconds?: number;
  /** Free-Tier (Provider-Marketing, lokal entschieden — KEIN Protokoll-Feature):
   *  Gratis-Tokens pro pubkey pro Tag. 0 = aus. Der Provider verschenkt
   *  eigene Rechenzeit als Werbung; es gibt keinen Topf und keinen Betreiber. */
  freeTokensPerPubkeyPerDay?: number;
  /** Optional: Free-Tier zeitlich begrenzen (Unix-Sekunden). Danach gilt
   *  nur noch die Tages-Allowance. 0/undefined = keine Zeitbegrenzung. */
  freeTierUntil?: number;
  /** Provider-Startzeitpunkt (Unix-Sekunden, erste Registration). Fuer die
   *  24h-Pflicht-Gratis-Phase neuer Provider (Kaltstart-Reputation). */
  providerSince?: number;
  /** Dauer der Pflicht-Gratis-Phase neuer Provider (Sekunden, default 24h).
   *  In dieser Zeit arbeitet der Provider gratis, um Reputation aufzubauen
   *  und Stabilitaet zu beweisen. Danach automatisch paid. */
  bootstrapFreeSecs?: number;
}

export const DEFAULT_PROVIDER_CONFIG: Omit<ProviderConfig, "keypair" | "lud16"> = {
  pricePerKTokenMsat: 1000,
  minBidMsat: 100,
  powDifficulty: 8,
  privatePowBits: 12,
  seasonId: "season-1",
  freeTokensPerPubkeyPerDay: 0, // aus; Provider aktiviert es bewusst
  freeTierUntil: undefined,
  bootstrapFreeSecs: 24 * 3600, // 24h Pflicht-Gratis fuer neue Provider
};

/**
 * Liest die vom Client deklarierte Gebuehr aus dem Job-Event.
 *
 * Der Provider entscheidet, ob er sie akzeptiert — nicht der Client. Ohne
 * Obergrenze koennte eine manipulierte App den Nutzer ausnehmen, und die
 * Offenheit der Client-Schicht waere ein Nachteil statt eines Vorteils.
 */
function clientFeeFor(
  request: NostrEvent,
  amountMsat: number,
): { clientFeeMsat?: number; clientFeeRecipient?: string } {
  const fee = parseClientFee(request.tags);
  const verdict = checkClientFee(fee);
  if (!verdict.accepted || !fee) {
    if (fee) console.warn(`[fee] Client-Gebuehr abgelehnt: ${verdict.reason}`);
    return {};
  }
  return {
    clientFeeMsat: Math.floor((amountMsat * verdict.ppm) / 1_000_000),
    clientFeeRecipient: fee.recipient,
  };
}

/** Betrag fuers Log: nur ganze, nicht negative Zahlen – sonst "?". */
function ganzeZahlLog(n: number): string {
  return Number.isSafeInteger(n) && n >= 0 ? String(n) : "?";
}

export interface ProcessedJob {
  requestId: string;
  /** Vom Client deklarierte Gebuehr (msat) — 0, wenn keine deklariert wurde. */
  clientFeeMsat?: number;
  /** Empfaenger der Client-Gebuehr aus dem Job-Event. */
  clientFeeRecipient?: string;
  /** ID des veroeffentlichten Ergebnis-Events — Anker fuer den Fee-Beweis. */
  resultEventId: string;
  customerPubkey: string;
  amountMsat: number;
  feeSplit: { recipientMsat: number; poolMsat: number; protocolMsat: number };
  /** Antwort-Anfang fuers Log – leer, solange `klartextProtokoll` aus ist (3.3). */
  outputPreview: string;
  durationMs: number;
}

export class DvmProvider {
  /**
   * Bereits bearbeitete Job-IDs.
   *
   * Wuchs bisher unbegrenzt: ein Knoten, der monatelang laeuft, sammelt jede
   * je gesehene Event-ID im Arbeitsspeicher. Jetzt mit Obergrenze — die
   * aeltesten Eintraege fallen heraus, sobald sie erreicht ist. Das ist
   * unbedenklich, weil die Abfrage ohnehin nur die letzte Stunde umfasst:
   * ein Eintrag, der aus dem Fenster gefallen ist, kann gar nicht mehr
   * auftauchen.
   */
  private seen = new Set<string>();
  /** Oeffnet Umschlaege privater Anfragen (Schritt 3.1). */
  private readonly signer: LocalSigner;
  private static readonly SEEN_LIMIT = 20_000;

  /** Aelteste Eintraege verwerfen, wenn das Limit ueberschritten ist. */
  private pruneSeen(): void {
    if (this.seen.size <= DvmProvider.SEEN_LIMIT) return;
    // Set haelt die Einfuegereihenfolge — die ersten sind die aeltesten.
    const drop = this.seen.size - Math.floor(DvmProvider.SEEN_LIMIT * 0.8);
    let i = 0;
    for (const id of this.seen) {
      this.seen.delete(id);
      if (++i >= drop) break;
    }
  }
  /** Ergebnisse der On-Chain-Pruefung, damit nicht jeder Job eine RPC-Abfrage ausloest. */
  private readonly depositCache = new DepositVerificationCache(60);
  /** Nur-Lese-Verbindung zur Kette; undefined = Deposits werden abgelehnt. */
  private solConnection?: Connection;
  /** Free-Tier: verbrauchte Gratis-Tokens pro pubkey pro Tag (RAM). */
  private freeUsage = new Map<string, { day: string; used: number }>();

  /** Free-Quota-Status für einen Kunden (für die Quota-API / App-Anzeige). */
  freeQuotaFor(customerPubkey: string, now = Math.floor(Date.now() / 1000)): {
    limitTokens: number; usedTokens: number; remainingTokens: number; resetsAt: string;
  } {
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const rec = this.freeUsage.get(customerPubkey);
    const used = rec && rec.day === day ? rec.used : 0;
    const limit = this.cfg.freeTokensPerPubkeyPerDay ?? 0;
    // Reset um Mitternacht UTC
    const resetsAt = `${day}T23:59:59Z`;
    return { limitTokens: limit, usedTokens: used, remainingTokens: Math.max(0, limit - used), resetsAt };
  }
  constructor(
    private cfg: ProviderConfig,
    private pool: OutboxPool,
    private backend: InferenceBackend = new OllamaBackend(),
    private toolRegistry?: ToolRegistry,
    /** Storage-Rolle (optional): aktiviert Blob-Fetch-Jobs (5075). */
    public storage?: import("./storage-role.js").StorageRole,
  ) {
    this.signer = new LocalSigner(cfg.keypair.sk);
    // Verbindung nur aufbauen, wenn beides konfiguriert ist. Fehlt eines,
    // bleibt solConnection undefined und Deposits werden abgelehnt statt
    // ungeprueft akzeptiert.
    if (cfg.solConnection && cfg.solanaAddress) {
      this.solConnection = cfg.solConnection;
    } else if (cfg.solanaRpcUrl && cfg.solanaAddress) {
      void (async () => {
        try {
          const { Connection } = await import("@solana/web3.js");
          this.solConnection = new Connection(cfg.solanaRpcUrl!, "confirmed");
          console.log(`[deposit] On-Chain-Pruefung aktiv (${cfg.solanaRpcUrl})`);
        } catch (e) {
          console.warn(`[deposit] Solana-Verbindung fehlgeschlagen: ${(e as Error).message}`);
        }
      })();
    } else if (cfg.solanaRpcUrl || cfg.solanaAddress) {
      console.warn(
        "[deposit] SOLANA_RPC_URL und die eigene Solana-Adresse muessen BEIDE " +
        "gesetzt sein — Deposits werden bis dahin abgelehnt.",
      );
    }
  }

  /** Parst angeforderte Tool-Aufrufe aus dem Job: ["tool", kind, input]. */
  private parseToolCalls(request: NostrEvent): ToolCall[] {
    return request.tags
      .filter((t) => t[0] === "tool" && t.length >= 3)
      .map((t) => ({ kind: Number(t[1]), name: `tool-${t[1]}`, input: t.slice(2).join(" ") }));
  }

  /**
   * Kurs in sats pro SOL (Schritt 4.4). Vorrang: 1) solPriceSats (manuell),
   * 2) lamportsPerMsat (manuell, umgerechnet), 3) Marktkurs – Median der
   * Kurs-Events, je Absender eine Stimme. Ohne Kurs gibt es keinen SOL-Preis:
   * Frueher galt dann still 0,2 Lamports/msat (5 Mio. sats pro SOL).
   */
  kurs(): { satsProSol: number; quelle: "manuell" | "markt" } | undefined {
    if (this.cfg.solPriceSats && this.cfg.solPriceSats > 0) return { satsProSol: Math.round(this.cfg.solPriceSats), quelle: "manuell" };
    if (this.cfg.lamportsPerMsat && this.cfg.lamportsPerMsat > 0) {
      return { satsProSol: Math.round(1e9 / (this.cfg.lamportsPerMsat * 1000)), quelle: "manuell" };
    }
    if (this.tickerSatsPerSol && this.tickerSatsPerSol > 0) return { satsProSol: this.tickerSatsPerSol, quelle: "markt" };
    return undefined;
  }

  /**
   * Lamports pro msat: 1 SOL = 1e9 Lamports = Kurs · 1000 msat. Bis 4.4 stand
   * hier eine Tausend zu viel im Nenner – SOL-Preise waren 1000× zu niedrig.
   */
  private lamportsPerMsat(): number | undefined {
    const k = this.kurs();
    return k ? lamportsProMsat(k.satsProSol) : undefined;
  }

  /** Letzter Markt-Kurs (sats pro SOL) aus den Kurs-Events. */
  private tickerSatsPerSol?: number;

  /** Holt den Marktkurs aus Kurs-Events (Kind 38026), wenn kein manueller gesetzt ist. */
  private async refreshTickerPrice(): Promise<void> {
    if (this.cfg.solPriceSats || this.cfg.lamportsPerMsat) return; // manuell hat Vorrang
    try {
      const events = await this.pool.query({ kinds: [KIND_PRICE_TICKER], limit: 100 });
      const markt = marktKurs(events, Math.floor(Date.now() / 1000));
      if (markt) this.tickerSatsPerSol = markt.satsProSol;
    } catch { /* Kurs optional – ohne ihn keine SOL-Preise */ }
  }

  /** msat -> Lamports (SOL-Betrag im Ergebnis), aufgerundet und ganzzahlig. */
  private msatToLamports(msat: number): number {
    const k = this.kurs();
    if (!k) throw new Error("Kein SOL-Kurs");
    return msatZuLamports(msat, k.satsProSol);
  }

  /** Antwort-Anfang fuers Log – nur mit `klartextProtokoll` (Schritt 3.3). */
  private vorschau(output: string): string {
    return this.cfg.klartextProtokoll ? output.slice(0, 120) : "";
  }

  /**
   * Free-Tier-Check (lokal, Provider-Marketing):
   * Gibt die verbleibenden Gratis-Tokens fuer diese pubkey heute zurueck.
   * Zeitbegrenzung (freeTierUntil) ueberschreibt: vor Ablauf unbegrenzt.
   */
  private freeAllowanceLeft(customerPubkey: string, now = Math.floor(Date.now() / 1000)): number {
    // Zeitbegrenztes Free-Tier: vor Ablauf fuer alle unbegrenzt
    if (this.cfg.freeTierUntil && now < this.cfg.freeTierUntil) return Number.MAX_SAFE_INTEGER;
    const daily = this.cfg.freeTokensPerPubkeyPerDay ?? 0;
    if (daily <= 0) return 0;
    const day = new Date(now * 1000).toISOString().slice(0, 10); // YYYY-MM-DD
    const rec = this.freeUsage.get(customerPubkey);
    const used = rec && rec.day === day ? rec.used : 0;
    return Math.max(0, daily - used);
  }

  /**
   * Bootstrap-Phase (Kaltstart): Ist dieser Provider noch in den ersten 24h?
   * Neue Provider arbeiten gratis, um Reputation (38010-Events) aufzubauen
   * und Stabilitaet zu beweisen. Danach automatisch paid.
   * Ohne providerSince gilt: nicht in Bootstrap (rueckwaertskompatibel).
   */
  isInBootstrap(now = Math.floor(Date.now() / 1000)): boolean {
    if (!this.cfg.providerSince) return false;
    const secs = this.cfg.bootstrapFreeSecs ?? 24 * 3600;
    return now < this.cfg.providerSince + secs;
  }

  /** Ob dieser Provider aktuell gratis arbeitet (Bootstrap ODER freiwillig). */
  isCurrentlyFree(now = Math.floor(Date.now() / 1000)): boolean {
    if (this.isInBootstrap(now)) return true;
    if (this.cfg.freeTierUntil && now < this.cfg.freeTierUntil) return true;
    return (this.cfg.freeTokensPerPubkeyPerDay ?? 0) > 0;
  }

  /**
   * Darf dieser Job gratis laufen? Offene Anfragen: Kontingent je Schluessel.
   * Private Anfragen (3.1): Jeder Umschlag hat die verlangte Rechenarbeit
   * geleistet, der Schluessel wechselt je Sitzung – also gilt nur, ob der
   * Provider ueberhaupt gratis anbietet.
   */
  private gratisErlaubt(customerPubkey: string, now: number, privat: boolean): boolean {
    return privat ? this.isCurrentlyFree(now) : this.freeAllowanceLeft(customerPubkey, now) > 0;
  }

  private recordFreeUsage(customerPubkey: string, tokens: number, now = Math.floor(Date.now() / 1000)): void {
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const rec = this.freeUsage.get(customerPubkey);
    const used = rec && rec.day === day ? rec.used : 0;
    this.freeUsage.set(customerPubkey, { day, used: used + tokens });
  }

  /** Einmal pro Intervall: neue DVM-Requests holen und abarbeiten. */
  /**
   * Dauer-Abo statt Abfrage-Schleife.
   *
   * Der Knoten fragte bisher alle 15 Sekunden nach neuen Jobs. Das bedeutet
   * bis zu 15 Sekunden Verzoegerung, bevor ein Job ueberhaupt GESEHEN wird —
   * bei einem Chat der Unterschied zwischen "antwortet" und "haengt". Mit
   * einem stehenden Abo kommt der Job an, sobald er veroeffentlicht ist.
   *
   * Gibt eine Stopp-Funktion zurueck. Wirft, wenn kein Relay Abos kann; der
   * Aufrufer faellt dann auf pollOnce() zurueck.
   */
  async subscribeJobs(onJob: (job: ProcessedJob) => void): Promise<() => void> {
    const kinds = [KIND_DVM_TEXT_GENERATION];
    if (this.storage && process.env.STORAGE_ENABLED === "1") kinds.push(5075);

    const stopOffen = await this.pool.subscribe({ kinds, since: Math.floor(Date.now() / 1000) - 60 }, (ev) => {
      if (this.seen.has(ev.id)) return;
      this.seen.add(ev.id);
      this.pruneSeen();

      // Bewusst nicht awaiten: ein langsamer Job darf den Empfang der
      // naechsten nicht blockieren.
      void this.handleJob(ev)
        .then((job) => { if (job) onJob(job); })
        .catch((e) => console.warn(`[dvm] Job ${ev.id.slice(0, 8)} fehlgeschlagen: ${(e as Error).message}`));
    });
    // Private Anfragen (Schritt 3.1): Umschlaege an diesen Provider.
    let stopPrivat: () => void;
    try {
      stopPrivat = await this.pool.subscribe(
        { kinds: [KIND_GIFT_WRAP], "#p": [this.cfg.keypair.pk], since: Math.floor(Date.now() / 1000) - 60 },
        (wrap) => {
          if (this.seen.has(wrap.id)) return;
          this.seen.add(wrap.id);
          this.pruneSeen();
          void this.handlePrivate(wrap)
            .then((job) => { if (job) onJob(job); })
            .catch((e) => console.warn(`[dvm] Private Anfrage fehlgeschlagen: ${(e as Error).message}`));
        },
      );
    } catch (e) {
      stopOffen();
      throw e;
    }
    return () => { stopOffen(); stopPrivat(); };
  }

  /**
   * Private Anfrage (Schritt 3.1): Umschlag pruefen und oeffnen, dann wie eine
   * offene Anfrage abarbeiten. Fremdes, Kaputtes oder zu wenig Rechenarbeit
   * wird verworfen, bevor irgendetwas laeuft; Kontingente je Schluessel gibt
   * es hier nicht – die Rechenarbeit ersetzt sie.
   */
  async handlePrivate(wrap: NostrEvent): Promise<ProcessedJob | null> {
    const request = await this.oeffnePrivat(wrap);
    return request ? this.bearbeitePrivat(request) : null;
  }

  /**
   * Umschlag oeffnen. Sitzung und Belege (3.2d) werden gemerkt – keine Arbeit –,
   * eine Anfrage kommt zurueck. Fremdes, Kaputtes, Wiederholtes: null.
   */
  private async oeffnePrivat(wrap: NostrEvent): Promise<NostrEvent | null> {
    const r = await openPrivateKundenEvent(wrap, this.signer, this.cfg.privatePowBits ?? 0);
    if (!r.ok) {
      console.warn(`[dvm] Umschlag ${wrap.id.slice(0, 8)} verworfen: ${r.grund}`);
      return null;
    }
    // Dieselbe Anfrage in einem zweiten Umschlag zaehlt nicht doppelt.
    if (this.seen.has(r.request.id)) return null;
    this.seen.add(r.request.id);
    const request: NostrEvent = { ...r.request, sig: "" };
    if (request.kind === KIND_SESSION_OPEN || request.kind === KIND_SESSION_PAYMENT) {
      this.merkeSitzungsEvent(request);
      return null;
    }
    if (request.kind === KIND_JOB_DISPUTE) {
      this.meldeReklamation(request);
      return null;
    }
    return request;
  }

  /**
   * Reklamation (Schritt 3.4), versiegelt an diesen Knoten – als beschuldigter
   * Provider oder als Pruefer, den der Kunde gewaehlt hat. Ins Log kommen nur
   * Auftrag, Grund und Betrag: Die Notiz des Kunden kann Klartext aus dem
   * Auftrag tragen (3.3).
   */
  private meldeReklamation(ev: NostrEvent): void {
    try {
      const d = parseDispute(ev);
      const rolle = d.providerPubkey === this.cfg.keypair.pk ? "gegen diesen Knoten" : "zur Nachpruefung";
      const job = /^[0-9a-f]{64}$/.test(d.jobId) ? d.jobId.slice(0, 8) : "ungueltig";
      console.log(`[reklamation] ${rolle}: Job ${job}, ${d.reason}, ${ganzeZahlLog(d.amountMsat)} msat`);
    } catch (e) {
      console.warn(`[reklamation] unvollstaendig: ${(e as Error).message}`);
    }
  }

  private async bearbeitePrivat(request: NostrEvent): Promise<ProcessedJob> {
    try {
      return await this.handleJob(request, true);
    } catch (err) {
      await this.meldeFehler(request, err, true);
      throw err;
    }
  }

  /**
   * Antwort an den Kunden (Schritt 3.2): auf private Anfragen versiegelt an den
   * Sitzungsschluessel – Relays sehen weder Antwort noch Betrag noch Empfaenger
   * als Autor –, auf offene Anfragen wie bisher offen.
   */
  private async antworte(ev: NostrEvent, request: NostrEvent, privat: boolean): Promise<void> {
    if (!privat) {
      await this.pool.publish(ev);
      return;
    }
    const { wrap } = await buildPrivateJobResponse({ response: ev, providerSigner: this.signer, sessionPk: request.pubkey });
    await this.pool.publish(wrap);
  }

  /**
   * Versiegelt erhaltene Sitzungen und Belege (Schritt 3.2d), je Kunde und
   * Sitzungs-ID. Nur im Speicher: Sitzungen laufen hoechstens Stunden, und
   * nach einem Neustart eroeffnet der Kunde eine neue.
   */
  private privateSitzungen = new Map<string, { open?: NostrEvent; belege: NostrEvent[] }>();
  private static MAX_PRIVATE_SITZUNGEN = 5000;

  private merkeSitzungsEvent(ev: NostrEvent): void {
    const sessionId = getTag(ev, "d");
    if (!sessionId) return;
    const schluessel = `${ev.pubkey}:${sessionId}`;
    let s = this.privateSitzungen.get(schluessel);
    if (!s) {
      if (this.privateSitzungen.size >= DvmProvider.MAX_PRIVATE_SITZUNGEN) {
        // Aelteste zuerst verwerfen – Map haelt die Einfuegereihenfolge.
        this.privateSitzungen.delete(this.privateSitzungen.keys().next().value!);
      }
      s = { belege: [] };
      this.privateSitzungen.set(schluessel, s);
    }
    if (ev.kind === KIND_SESSION_OPEN) {
      if (!s.open) s.open = ev;  // die erste Eroeffnung gilt – spaetere aendern Budget und Rate nicht
    } else if (!s.belege.some((b) => b.id === ev.id)) {
      s.belege.push(ev);
    }
  }

  /** NIP-90-Rueckmeldung (Kind 7000): dem Kunden sofort sagen, warum abgelehnt. */
  private async meldeFehler(request: NostrEvent, err: unknown, privat = false): Promise<void> {
    try {
      const fb = signEvent(
        buildEvent(this.cfg.keypair.pk, 7000, [
          ["e", request.id],
          ["p", request.pubkey],
          ["status", "error"],
        ], `error: ${(err as Error).message.slice(0, 200)}`),
        this.cfg.keypair.sk,
      );
      await this.antworte(fb, request, privat);
    } catch { /* feedback ist best-effort */ }
  }

  async pollOnce(now = Math.floor(Date.now() / 1000)): Promise<ProcessedJob[]> {
    // Markt-Kurs aus dezentralem Ticker aktualisieren (wenn nicht manuell gesetzt)
    await this.refreshTickerPrice();
    const events = await this.pool.query({
      kinds: [KIND_DVM_TEXT_GENERATION],
      since: now - 3600,
    });
    // Blob-Fetch-Jobs (5075): nur wenn Storage-Rolle aktiv
    if (this.storage && process.env.STORAGE_ENABLED === "1") {
      try {
        const blobJobs = await this.pool.query({ kinds: [5075], since: now - 3600 });
        events.push(...blobJobs);
      } catch { /* relay */ }
    }
    const processed: ProcessedJob[] = [];
    for (const ev of events) {
      if (this.seen.has(ev.id)) continue;
      if (!isDvmRequest(ev.kind)) continue;
      this.seen.add(ev.id);
      this.pruneSeen();
      try {
        processed.push(await this.handleJob(ev));
      } catch (err) {
        // NIP-90 Feedback (kind 7000): Dem Client SOFORT mitteilen warum der
        // Job abgelehnt wurde — sonst wartet er bis zum Timeout.
        console.error(`Job ${ev.id} fehlgeschlagen:`, err);
        await this.meldeFehler(ev, err);
      }
    }
    // Private Anfragen (Schritt 3.1) – Rueckmeldung bei Fehlern schickt handlePrivate.
    let umschlaege: NostrEvent[] = [];
    try {
      umschlaege = await this.pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [this.cfg.keypair.pk], since: now - 3600 });
    } catch { /* relay */ }
    // Erst alle oeffnen (Sitzungen und Belege sind dann bekannt), dann arbeiten –
    // sonst haengt es an der Reihenfolge, ob eine Anfrage ihre Sitzung findet.
    const anfragen: NostrEvent[] = [];
    for (const wrap of umschlaege) {
      if (this.seen.has(wrap.id)) continue;
      this.seen.add(wrap.id);
      this.pruneSeen();
      const request = await this.oeffnePrivat(wrap);
      if (request) anfragen.push(request);
    }
    for (const request of anfragen) {
      try {
        processed.push(await this.bearbeitePrivat(request));
      } catch (err) {
        console.error(`Private Anfrage fehlgeschlagen:`, err);
      }
    }
    return processed;
  }

  /** Chunk-Fetch-Job: [i, <blobId>], ["param","shard",<idx>] — liefert hex-Shard.
   *  Micro-Bid pro Shard; Ergebnis als kind 6075 mit content=hex. */
  private async handleBlobFetch(request: NostrEvent, privat = false): Promise<ProcessedJob> {
    const start = Date.now();
    const blobId = getTag(request, "i");
    const shardIdx = Number(getTag(request, "param") === "shard" ? request.tags.find((t) => t[0] === "param" && t[1] === "shard")?.[2] ?? "-1" : "-1");
    if (!blobId || shardIdx < 0) throw new Error("blob-fetch-job ohne blob/shard");

    // chunk aus dem lokalen store suchen: wir kennen hash nicht direkt,
    // daher alle blobs scannen ist teuer — stattdessen index-datei:
    // storage-role haelt chunks nach hash; wir brauchen hash->bytes fuer (blobId, idx).
    // Der Seeder speichert beim put() einen lookup: data/index.jsonl
    const bytes = await this.storage!.getByBlobIndex(blobId, shardIdx);
    if (!bytes) throw new Error(`chunk ${blobId}:${shardIdx} nicht gehalten`);

    // micro-preis: bid des jobs (klein, z.b. 10 msat) oder default; gratis-jobs
    // (bid=0 in bootstrap) werden mit 0 abgerechnet
    const amountMsat = Number(getTag(request, "bid") ?? "0") || 10;
    const feeSplit = computeFeeSplit(amountMsat, {
      totalFeePpm: PROTOCOL_FEE_PPM,
      poolSharePercent: PROTOCOL_POOL_SHARE_PERCENT,
    });
    const output = toHex(bytes);
    const resultEvent = signEvent(
      buildJobResult({
        providerPubkey: this.cfg.keypair.pk,
        requestId: request.id,
        requestKind: request.kind,
        customerPubkey: request.pubkey,
        output,
        amountMsat: amountMsat === 0 ? 0 : amountMsat,
      }),
      this.cfg.keypair.sk,
    );
    await this.antworte(resultEvent, request, privat);
    return {
      requestId: request.id,
      ...clientFeeFor(request, amountMsat),
      resultEventId: resultEvent.id,
      customerPubkey: request.pubkey,
      amountMsat,
      feeSplit,
      outputPreview: `chunk ${blobId.slice(0, 8)}:${shardIdx} (${bytes.length}b)`,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Session-Validierung (Provider-Seite, Stufe B):
   *   1. Session-Open vom Relay laden (d-Tag = sessionId, Autor = Kunde)
   *   2. Muss an UNS adressiert sein (p-Tag = eigener pubkey)
   *   3. Nicht abgelaufen
   *   4. Buchhaltung pruefen: Belege des Kunden muessen konsistent sein
   *      (checkSessionLedger) und das Budget darf nicht ueberzogen sein
   * Gibt die Session bei Erfolg zurueck, sonst undefined.
   */
  private async validateSession(
    sessionId: string,
    customerPubkey: string,
  ): Promise<ParsedSessionOpen | undefined> {
    // Versiegelt erhaltene Sitzung zuerst (3.2d), sonst wie bisher vom Relay.
    const privat = this.privateSitzungen.get(`${customerPubkey}:${sessionId}`);
    const opens = privat?.open ? [privat.open] : await this.pool.query({
      kinds: [KIND_SESSION_OPEN],
      authors: [customerPubkey],
      "#d": [sessionId],
    });
    if (opens.length === 0) return undefined;
    let session: ParsedSessionOpen;
    try {
      session = parseSessionOpen(opens[0]);
    } catch {
      return undefined;
    }
    if (session.providerPubkey !== this.cfg.keypair.pk) return undefined;
    if (Math.floor(Date.now() / 1000) > session.expiration) return undefined;

    // Buchhaltung pruefen: bisherige Belege konsistent + Budget frei
    const belege = privat?.open ? privat.belege : await this.pool.query({
      kinds: [KIND_SESSION_PAYMENT],
      authors: [customerPubkey],
      "#d": [sessionId],
    });
    let payments;
    try {
      payments = belege.map(parseSessionPayment);
    } catch {
      return undefined;
    }
    const check = checkSessionLedger({ open: session, payments });
    if (!check.ok) return undefined;
    if (check.totalPaidMsat >= session.maxTotalMsat) return undefined;
    return session;
  }

  /**
   * Solana-Deposit-Session validieren (Provider-Seite):
   *   1. Deposit-Open vom Relay laden (d-Tag = sessionId, Autor = Kunde)
   *   2. Muss an UNS adressiert sein, nicht abgelaufen (Timelock)
   *   3. Konsistenz: spend+refund == total
   * Gibt die Deposit-Session bei Erfolg zurueck, sonst undefined.
   * (On-chain-Verifikation des HTLC-Locks ist Aufgabe des Solana-Adapters —
   *  hier pruefen wir die Event-Konsistenz.)
   */
  private async validateSolDeposit(
    sessionId: string,
    customerPubkey: string,
  ): Promise<ParsedSolDepositOpen | undefined> {
    const opens = await this.pool.query({
      kinds: [KIND_SOL_DEPOSIT_OPEN],
      authors: [customerPubkey],
      "#d": [sessionId],
    });
    if (opens.length === 0) return undefined;
    let deposit: ParsedSolDepositOpen;
    try {
      deposit = parseSolDepositOpen(opens[0]);
    } catch {
      return undefined;
    }
    if (deposit.providerPubkey !== this.cfg.keypair.pk) return undefined;
    if (Math.floor(Date.now() / 1000) > deposit.timelockUnix) return undefined;
    if (deposit.spendLamports + deposit.refundLamports !== deposit.totalLamports) return undefined;

    // ---------------------------------------------------------------------
    // Bis hierher wurde ausschliesslich geprueft, ob das Event in sich
    // schluessig ist — und dieses Event signiert der KUNDE selbst. Ein
    // beliebiger Betrag liess sich damit einfach behaupten. Jetzt schaut der
    // Provider selbst auf die Kette.
    //
    // Ohne konfigurierte Solana-Verbindung wird das Deposit ABGELEHNT, nicht
    // durchgewunken: eine fehlende Pruefmoeglichkeit ist kein Beweis fuer
    // Deckung.
    // ---------------------------------------------------------------------
    if (!this.solConnection) {
      console.warn(
        `[deposit] ${sessionId}: keine Solana-Verbindung konfiguriert — ` +
        `Deposit nicht pruefbar, abgelehnt (SOLANA_RPC_URL + eigene SOL-Adresse setzen)`,
      );
      return undefined;
    }

    const cached = this.depositCache.get(sessionId);
    const check = cached ?? await verifyDepositOnChain(deposit, this.solConnection, {
      expectedRecipient: this.cfg.solanaAddress,
      minRemainingSeconds: this.cfg.depositMinRemainingSeconds ?? 3600,
    });
    if (!cached) this.depositCache.set(sessionId, check);

    if (!check.ok) {
      console.warn(`[deposit] ${sessionId} abgelehnt: ${check.summary}`);
      return undefined;
    }
    return deposit;
  }

  private async handleJob(request: NostrEvent, privat = false): Promise<ProcessedJob> {
    const input = getTag(request, "i");
    const bidMsat = Number(getTag(request, "bid") ?? "0");
    const sessionId = getTag(request, "session");
    if (!input) throw new Error("Job ohne Input");

    // Session-Modus (Streaming-Sats, Stufe B): Job referenziert eine offene
    // Session statt eines Einzel-Gebots. Der Provider prueft Budget + Belege
    // und rechnet gegen die Session ab — kein Bid noetig.
    // Solana-Deposit-Modus: Job referenziert eine Deposit-Session (HTLC-Escrow),
    // Abrechnung in lamports gegen das Verbrauchs-HTLC.
    let session: ParsedSessionOpen | undefined;
    let solDeposit: ParsedSolDepositOpen | undefined;
    let isFreeJob = false;
    const now = Math.floor(Date.now() / 1000);

    // Bootstrap-Phase (neue Provider, erste 24h): NUR Gratis-Jobs annehmen.
    // Bezahlte Jobs werden abgelehnt — der Provider muss erst Reputation
    // (38010-Events) und Stabilitaet beweisen, bevor er verdienen darf.
    // TEST-MODUS: SKIP_BOOTSTRAP=1 umgeht die Bootstrap-Phase (nur fuer Entwicklung!)
    const skipBootstrap = process.env.SKIP_BOOTSTRAP === "1";
    const bootstrap = this.isInBootstrap(now) && !skipBootstrap;

    if (sessionId) {
      if (bootstrap) throw new Error("Bootstrap-Phase: neue Provider nehmen nur Gratis-Jobs");
      session = await this.validateSession(sessionId, request.pubkey);
      if (!session) {
        // Fallback: vielleicht eine Solana-Deposit-Session
        solDeposit = await this.validateSolDeposit(sessionId, request.pubkey);
        // Ohne Kurs kein fairer SOL-Preis: ablehnen, bevor gerechnet wird.
        if (solDeposit && !this.kurs()) {
          throw new Error("Kein SOL-Kurs: Anbieter braucht SOL_PRICE_SATS oder Kurs-Events von Liquiditätsgebern");
        }
        if (!solDeposit) {
          // Ungueltige Session (abgelaufen, fremder Provider, Budget leer,
          // inkonsistente Belege). Frueher wurde der Job hier bedingungslos
          // als Gratis-Job durchgewunken — das war ein unbegrenztes Schlupfloch:
          // eine erfundene session-ID reichte fuer kostenlose Inferenz.
          //
          // Jetzt: Rueckfall NUR auf das GEMESSENE Free-Tier-Kontingent dieser
          // pubkey. Der Chat bricht bei einem Provider-Neustart also weiterhin
          // nicht ab (solange Gratis-Tokens uebrig sind), aber die Sybil-Grenze
          // aus freeAllowanceLeft() gilt.
          if (this.gratisErlaubt(request.pubkey, now, privat)) {
            console.warn(`[provider] Session ${sessionId} ungueltig — fahre auf Free-Tier fort`);
            isFreeJob = true;
          } else {
            throw new Error(`Session ${sessionId} ungueltig und kein Free-Tier-Kontingent`);
          }
        }
      }
    } else if (bidMsat >= this.cfg.minBidMsat) {
      // Bezahlter Bid-Job — in Bootstrap ABLEHNEN (Reputation zuerst aufbauen)
      if (bootstrap) throw new Error("Bootstrap-Phase: neue Provider nehmen nur Gratis-Jobs");
    } else if (this.gratisErlaubt(request.pubkey, now, privat) || bootstrap) {
      // Free-Tier ODER Bootstrap: Gratis-Job ohne Bid
      isFreeJob = true;
    } else {
      throw new Error(`Bid zu niedrig: ${bidMsat} und kein Free-Tier-Kontingent`);
    }

    // 2. Lokale Inferenz (kein Cloud-Call, keine Custody).
    // Schritt 3.3: Der Knoten merkt sich keinen Gespraechsverlauf mehr – der
    // Klartext ist nach der Antwort weg. Den Kontext bringt die App selbst mit,
    // versiegelt in der Anfrage.

    // TOOL-EXECUTION: Job kann Tool-Aufrufe anfordern (["tool", kind, input]).
    // Werden LOKAL ausgefuehrt, Ergebnisse in den Prompt-Kontext eingebaut
    // und als usage.toolCalls abgerechnet.
    const toolCalls = this.parseToolCalls(request);
    const toolResults: Array<{ name: string; kind: number; costMsat: number; output: string; ok: boolean }> = [];
    let toolContext = "";
    if (toolCalls.length > 0 && this.toolRegistry) {
      const { defaultToolPrice } = await import("@freedomstack/protocol");
      for (const tc of toolCalls) {
        const res = await this.toolRegistry.run(tc);
        const price = defaultToolPrice(tc.kind);
        const costMsat = (price?.satsPerCall ?? 0) * 1000;
        toolResults.push({ name: tc.name, kind: tc.kind, costMsat, output: res.output, ok: res.ok });
        toolContext += `\n[Tool ${tc.name} Ergebnis]:\n${res.output}\n`;
      }
    }

    // SWARM-MODUS: Job mit ["swarm", "1"] tag -> beide Modelle parallel
    const isSwarm = request.tags.some((t) => t[0] === "swarm" && t[1] === "1");
    if (isSwarm) {
      console.log("[dvm] Swarm-Modus erkannt — beide Modelle parallel");
      const result = await this.backend.complete({
        jobId: request.id,
        prompt: input,
        swarm: true,
      });
      // Swarm-Result direkt zurueckgeben (keine Tool-Logik noetig)
      const amountMsat = Math.ceil((result.completionTokens / 1000) * this.cfg.pricePerKTokenMsat);
      const feeSplit = computeFeeSplit(amountMsat, {
        totalFeePpm: PROTOCOL_FEE_PPM,
        poolSharePercent: PROTOCOL_POOL_SHARE_PERCENT,
      });
      const resultEvent = signEvent(
        buildJobResult({
          providerPubkey: this.cfg.keypair.pk,
          requestId: request.id,
          requestKind: request.kind,
          customerPubkey: request.pubkey,
          output: result.output,
          amountMsat,
          usage: {
            model: result.model,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          },
        }),
        this.cfg.keypair.sk,
      );
      await this.antworte(resultEvent, request, privat);
      return {
        requestId: request.id,
        ...clientFeeFor(request, amountMsat),
        resultEventId: resultEvent.id,
        customerPubkey: request.pubkey,
        amountMsat,
        feeSplit: {
          recipientMsat: feeSplit.recipientMsat,
          poolMsat: feeSplit.poolMsat,
          protocolMsat: feeSplit.protocolMsat,
        },
        outputPreview: this.vorschau(result.output),
        durationMs: result.durationMs,
      };
    }

    // Anhang (multimodal): ["attach", type, name, dataUrl] -> als Kontext-Hinweis
    const attachTag = request.tags.find((t) => t[0] === "attach");
    let attachNote = "";
    if (attachTag) {
      const [, atype, aname] = attachTag;
      attachNote = `\n[Anhang: ${atype} "${aname}"]\n`;
    }
    // Blob-Fetch-Jobs (5075) haben eigenen Handler (kein LLM!)
    if (request.kind === 5075) {
      return this.handleBlobFetch(request, privat);
    }

    // WICHTIG: Wenn es Tool-Ergebnisse gibt, sende sie als SEPARATE Nachricht
    // (nicht als Teil des Prompts). Das LLM soll das Ergebnis als neue Eingabe sehen.
    let finalPrompt = input + attachNote;
    if (toolResults.length > 0) {
      // Tool-Ergebnis als eigene Nachricht — das LLM antwortet darauf
      finalPrompt = toolContext + `\nBasierend auf dem obigen Tool-Ergebnis, beantworte jetzt die urspruengliche Frage: ${input}`;
    }
    // Gewuenschtes Modell aus dem Job lesen ([\"param\", \"model\", \"...\"]).
    // Nur akzeptieren wenn der Provider dieses Modell anbietet; sonst Default.
    const modelParam = request.tags.find((t) => t[0] === "param" && t[1] === "model")?.[2];
    const offeredModels = (process.env.PROVIDER_MODELS ?? process.env.OLLAMA_MODEL ?? "")
      .split(",").map((m) => m.trim()).filter(Boolean);
    const requestedModel = modelParam && offeredModels.includes(modelParam) ? modelParam : undefined;

    // Live-Progress: bei jedem Tool-Aufruf ein kind-7000 (status=progress) an
    // den Kunden — die App zeigt daraus den passenden Schritt in der Leiste.
    const onProgress = (step: string): void => {
      void this.antworte(signEvent(
        buildEvent(this.cfg.keypair.pk, 7000, [
          ["e", request.id],
          ["p", request.pubkey],
          ["status", "progress"],
        ], step),
        this.cfg.keypair.sk,
      ), request, privat).catch(() => { /* best-effort */ });
    };

    const result = await this.backend.complete({
      jobId: request.id,
      prompt: finalPrompt,
      model: requestedModel,
      onProgress,
    });

    // Preis: Session-Rate, Deposit-Rate, Free-Tier (0), oder Bid-Preis.
    // PLUS Tool-Kosten (web_search etc.) — werden on top gerechnet.
    const toolCostMsat = toolResults.reduce((s, t) => s + t.costMsat, 0);
    const rawPrice = Math.ceil((result.completionTokens / 1000) * this.cfg.pricePerKTokenMsat);
    let amountMsat: number;
    let chain: "lightning" | "solana" = "lightning";
    if (isFreeJob) {
      amountMsat = 0; // Gratis — Provider-Marketing, kein Topf (Tools in free auch 0)
      if (!privat) this.recordFreeUsage(request.pubkey, result.completionTokens);
    } else if (solDeposit) {
      // Deposit: Preis in msat (text-Rate gedeckelt auf Deposit-Rate) + Tools,
      // dann in lamports umgerechnet (msatToLamports beim Result).
      const rate = this.lamportsPerMsat()!; // oben geprueft
      const depositRateMsatPerK = solDeposit.maxLamportsPerKToken / rate; // lamports/1k -> msat/1k
      const textMsat = Math.min(rawPrice, Math.ceil((result.completionTokens / 1000) * depositRateMsatPerK));
      amountMsat = textMsat + toolCostMsat;
      chain = "solana";
    } else if (session) {
      amountMsat = Math.min(rawPrice, Math.ceil((result.completionTokens / 1000) * session.maxRatePerKTokenMsat)) + toolCostMsat;
    } else {
      amountMsat = Math.min(bidMsat, rawPrice) + toolCostMsat;
    }

    // 1%-Fee-Split AN DER QUELLE berechnen (Aufteilung, nicht Verwahrung)
    const feeSplit = computeFeeSplit(amountMsat, {
      totalFeePpm: PROTOCOL_FEE_PPM,
      poolSharePercent: PROTOCOL_POOL_SHARE_PERCENT,
    });

    // 3. Result publizieren (kind 6050), Multi-Relay via OutboxPool.
    // Bei Solana-Deposit: SOL-Adresse + lamports-Betrag als Zahloption mitgeben.
    // Der SOL-Betrag ist amountMsat (inkl. Tools) in lamports umgerechnet — so
    // sind ALLE Preise (text + tools) echt in SOL verfuegbar.
    const usedLamports = solDeposit ? this.msatToLamports(amountMsat) : undefined;
    const resultEvent = signEvent(
      buildJobResult({
        providerPubkey: this.cfg.keypair.pk,
        requestId: request.id,
        requestKind: request.kind,
        customerPubkey: request.pubkey,
        output: result.output,
        amountMsat,
        solanaAddress: solDeposit ? this.cfg.solanaAddress : undefined,
        amountLamports: usedLamports,
        usage: {
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          toolCalls: toolResults.length > 0
            ? toolResults.map((t) => ({ name: t.name, kind: t.kind, costMsat: t.costMsat }))
            : undefined,
        },
      }),
      this.cfg.keypair.sk,
    );
    await this.antworte(resultEvent, request, privat);

    // 5. Leistungs-Event (kind 38010) mit PoW -> oeffentlich pruefbare Reputation.
    // WICHTIG: Gratis-Jobs (Bootstrap + freiwilliges Free-Tier) erzeugen
    // 38010-Events mit volume_msat=0 — das ist der Reputations-Nachweis.
    // Mehr ehrliche Arbeit -> hoeheres Ranking -> mehr bezahlte Nachfrage.
    // (KEIN Bonus-Pool noetig; der Markt belohnt Reputation mit Nachfrage.)
    const perf = buildPerformanceEvent({
      workerPubkey: this.cfg.keypair.pk,
      workType: "ai_job",
      units: result.completionTokens,
      volumeMsat: amountMsat,
      chain,
      proofEventId: resultEvent.id,
      seasonId: this.cfg.seasonId,
    });
    // Bootstrap-Markierung (oeffentlich sichtbar: neuer Provider beweist sich)
    if (bootstrap) perf.tags.push(["bootstrap", "1"]);
    // Region grob mitgeben. Ohne dieses Tag kann das Netz nicht erkennen, wo
    // Kapazitaet fehlt — der Knappheitsbonus liefe im Leeren. Bewusst
    // selbstdeklariert und kontinentweit: keine IP-Geolokalisierung, kein
    // Standortnachweis. Manipulierbar ist es trotzdem, deshalb ist der Bonus
    // gedeckelt und an nachgewiesene Arbeit gekoppelt.
    if (this.cfg.region) perf.tags.push(["region", this.cfg.region]);
    // Erst alle Tags, dann minen: Jede spaetere Aenderung aendert die ID, und
    // die Rechenarbeit gaelte nicht mehr (so war es bis 3.2c).
    const perfMined = mineEvent(perf, this.cfg.powDifficulty);
    await this.pool.publish(signEvent(perfMined, this.cfg.keypair.sk));

    return {
      requestId: request.id,
      ...clientFeeFor(request, amountMsat),
      resultEventId: resultEvent.id,
      customerPubkey: request.pubkey,
      amountMsat,
      feeSplit: {
        recipientMsat: feeSplit.recipientMsat,
        poolMsat: feeSplit.poolMsat,
        protocolMsat: feeSplit.protocolMsat,
      },
      outputPreview: this.vorschau(result.output),
      durationMs: result.durationMs,
    };
  }
}
