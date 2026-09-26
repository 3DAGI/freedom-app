/**
 * Relayer-Dienst des Knotens (Schritt 4.6e): zahlt die Gebuehr fuer
 * Einloesungen von Kunden ohne eigenes SOL.
 *
 * Er veroeffentlicht ein Angebot (Kind 38032), nimmt versiegelte Auftraege an,
 * prueft jede Transaktion mit `pruefeRelayAuftrag` (nur Einloesung plus
 * Erstattung an ihn, Kunde hat signiert), signiert als Gebuehrenzahler mit und
 * sendet sie – mit Vorabsimulation, nie `skipPreflight`: Eine abgelehnte
 * Einloesung soll gar nicht erst in einen Block gelangen.
 *
 * Kein Klartext im Log: Auftraege tragen ein Preimage – geloggt werden nur
 * Status und Fehlername.
 */
import {
  type NostrEvent, type OutboxPool, type Signer,
  KIND_GIFT_WRAP, buildRelayAntwort, buildRelayerAngebot, oeffneRelayAuftrag, pruefeRelayAuftrag,
} from "@freedomstack/protocol";
import { Transaction, type Keypair } from "@solana/web3.js";

export interface RelayerConfig {
  /** Nostr-Schluessel des Knotens (Auftraege kommen versiegelt an ihn). */
  signer: Signer;
  /** Solana-Schluessel, der die Gebuehren zahlt. */
  solKeypair: Keypair;
  programmId: string;
  /** Was der Kunde in derselben Transaktion zurueckzahlt (deckt Gebuehr plus Aufschlag). */
  erstattungLamports: number;
  kette: "solana:mainnet" | "solana:devnet" | "solana:testnet";
  /** Hoechstens so viele Einloesungen je Stunde (schuetzt das Guthaben). */
  maxProStunde: number;
}

export class RelayerDienst {
  private gesehen = new Set<string>();
  private gesendet: number[] = [];

  constructor(
    private cfg: RelayerConfig,
    private pool: OutboxPool,
    /** Sendet eine vollstaendig signierte Transaktion (mit Vorabsimulation), liefert die Signatur. */
    private senden: (roh: Uint8Array) => Promise<string>,
    private jetzt: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  get solAdresse(): string {
    return this.cfg.solKeypair.publicKey.toBase58();
  }

  async veroeffentlicheAngebot(): Promise<void> {
    await this.pool.publish(await this.cfg.signer.signEvent(buildRelayerAngebot({
      solAdresse: this.solAdresse, erstattungLamports: this.cfg.erstattungLamports, kette: this.cfg.kette,
    }, this.cfg.signer.publicKey(), this.jetzt())));
  }

  /** Neue Umschlaege an den Knoten abarbeiten; liefert je Auftrag den Ausgang. */
  async pollOnce(): Promise<Array<{ status: "GESENDET" | "ABGELEHNT"; grund?: string }>> {
    const wraps = await this.pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [this.cfg.signer.publicKey()], since: this.jetzt() - 600 });
    const out: Array<{ status: "GESENDET" | "ABGELEHNT"; grund?: string }> = [];
    for (const w of wraps) {
      if (this.gesehen.has(w.id)) continue;
      this.gesehen.add(w.id);
      const r = await this.bearbeite(w);
      if (r) out.push(r);
    }
    return out;
  }

  /** Einen Umschlag bearbeiten; undefined, wenn er kein Relay-Auftrag ist. */
  async bearbeite(wrap: NostrEvent): Promise<{ status: "GESENDET" | "ABGELEHNT"; grund?: string } | undefined> {
    const a = await oeffneRelayAuftrag(wrap, this.cfg.signer);
    if (!a) return undefined;
    const antworte = async (status: "GESENDET" | "ABGELEHNT", x: { signatur?: string; grund?: string } = {}) => {
      await this.pool.publish(await buildRelayAntwort({
        relayer: this.cfg.signer, kundePk: a.kunde, auftragId: a.auftragId, status, ...x, nowSecs: this.jetzt(),
      })).catch(() => undefined);
      return { status, ...(x.grund ? { grund: x.grund } : {}) };
    };
    const stunde = this.jetzt() - 3600;
    this.gesendet = this.gesendet.filter((t) => t > stunde);
    if (this.gesendet.length >= this.cfg.maxProStunde) return antworte("ABGELEHNT", { grund: "Relayer ausgelastet – später erneut" });
    const p = pruefeRelayAuftrag(a.tx, { relayer: this.solAdresse, programmId: this.cfg.programmId, erstattungMin: this.cfg.erstattungLamports });
    if (!p.ok) return antworte("ABGELEHNT", { grund: p.grund });
    try {
      const tx = Transaction.from(a.tx);
      tx.partialSign(this.cfg.solKeypair);
      const signatur = await this.senden(tx.serialize());
      this.gesendet.push(this.jetzt());
      return antworte("GESENDET", { signatur });
    } catch (e) {
      // Meldungen der Kette koennen die Transaktion zitieren – nur den Namen.
      console.error("[relayer] Einloesung nicht gesendet:", (e as Error).name);
      return antworte("ABGELEHNT", { grund: "Einlösung von der Kette abgelehnt (Vorabsimulation)" });
    }
  }
}
