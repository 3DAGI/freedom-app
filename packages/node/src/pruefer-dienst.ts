/**
 * Prüfer-Rolle im Netz (Freedom-Prüfung P3b, E7, `docs/FREEDOM-PRUEFUNG.md` 3.2):
 * verbindet den Kern aus `pruefer-rolle.ts` mit den Relays. Nur mit `PRUEFER=1`
 * (`main.ts`), je Runde (`PRUEFER_NETZ.rundeMs`):
 *
 * 1. Angebote (38027) lesen, höchstens alle `angeboteSek` – je Provider das
 *    neueste, nur frische und nur mit Rechenarbeit bis `powMax` (sie wird im
 *    Prozess gerechnet und hielte sonst den Knoten auf).
 * 2. Fällige Prüffragen senden – Art zufällig, je Frage ein Wegwerf-Schlüssel.
 * 3. Antworten abholen: Umschläge an die Sitzungsschlüssel der offenen Fragen,
 *    nur vom gefragten Provider und nur zu dieser Anfrage. Keine Antwort bis zur
 *    Frist zählt als Ausfall – aber nur, wenn ein Relay geantwortet hat (sonst
 *    liegt es am eigenen Netz, nicht am Provider).
 * 4. Berichte (38081) signiert veröffentlichen, höchstens alle `berichtSek`.
 *
 * Fragen, Antworten und Sitzungsschlüssel liegen nur im Speicher, bis die Frage
 * ausgewertet ist; ins Log nur Zahlen. Ohne Budget (P3c, MENSCH) nur Angebote,
 * die gerade gratis sind – das entscheidet schon `PrueferPlan`.
 */
import {
  KIND_PROVIDER_CAPABILITIES, PRUEF_ARTEN, baueMessbericht, getTag, neuePruefFrage, openPrivateJobResponse,
  parseCapabilities, sichererZufall, signEvent,
  type Keypair, type LocalSigner, type NostrEvent, type PruefFrage, type RelayFilter,
} from "@freedomstack/protocol";
import { PrueferBuch, PrueferPlan, bauePruefAuftrag, werteAntwortAus, type PruefPunkt, type PruefZiel } from "./pruefer-rolle.js";

export const PRUEFER_NETZ = Object.freeze({
  /** So oft eine Runde – bestimmt auch, wie genau die Antwortzeit gemessen wird. */
  rundeMs: 5_000,
  /** Angebote höchstens so oft neu lesen. */
  angeboteSek: 900,
  /** Ältere Angebote zählen nicht (der Knoten erneuert sie alle 30 min, die App nimmt 24 h). */
  angebotAlterSek: 86_400,
  /** So lange wartet der Prüfer auf eine Antwort – wie die App beim Rückfall. */
  fristSek: 120,
  /** Berichte höchstens so oft veröffentlichen (sie laufen nach zwei Stunden ab). */
  berichtSek: 1_800,
  /** Höchstens so viele neue Fragen je Runde … */
  jeRunde: 5,
  /** … und höchstens so viele zugleich unterwegs. */
  offenMax: 50,
  /** Mehr Rechenarbeit (Bits) verlangt → nicht geprüft. */
  powMax: 16,
  /** Uhren gehen auseinander – so viel früher abholen als gesendet. */
  uhrSek: 600,
});

/** Was der Dienst vom Netz braucht – `OutboxPool` erfüllt das. */
export interface PrueferNetz {
  queryMitBericht(filter: RelayFilter): Promise<{ events: NostrEvent[]; antworten: string[] }>;
  publish(ev: NostrEvent): Promise<{ accepted: string[] }>;
}

interface Offen { ziel: PruefZiel; frage: PruefFrage; sitzung: LocalSigner; gesendetMs: number }

export interface RundenErgebnis { gesendet: number; ausgewertet: number; berichte: number }

export class PrueferDienst {
  readonly plan = new PrueferPlan();
  readonly buch = new PrueferBuch();
  private offen = new Map<string, Offen>();
  private pow = new Map<string, number>();
  private angeboteAm = -Infinity;
  private berichtAm = -Infinity;
  private laeuft = false;
  private readonly jetztMs: () => number;
  private readonly zufall: () => number;

  constructor(private o: { netz: PrueferNetz; schluessel: Keypair; jetztMs?: () => number; zufall?: () => number }) {
    this.jetztMs = o.jetztMs ?? (() => Date.now());
    this.zufall = o.zufall ?? sichererZufall;
  }

  get unterwegs(): number { return this.offen.size; }

  /** Eine Runde – nie zwei zugleich (die nächste fällt dann aus). */
  async runde(): Promise<RundenErgebnis | null> {
    if (this.laeuft) return null;
    this.laeuft = true;
    try {
      const jetzt = Math.floor(this.jetztMs() / 1000);
      if (jetzt - this.angeboteAm >= PRUEFER_NETZ.angeboteSek) await this.leseAngebote(jetzt);
      const ausgewertet = await this.holeAntworten();
      const gesendet = await this.sendeFaellige(jetzt);
      // Der erste Bericht nach einem Abstand – vorher gibt es kaum Zahlen
      if (this.berichtAm === -Infinity) this.berichtAm = jetzt;
      const berichte = jetzt - this.berichtAm >= PRUEFER_NETZ.berichtSek ? await this.veroeffentliche(jetzt) : 0;
      return { gesendet, ausgewertet, berichte };
    } finally {
      this.laeuft = false;
    }
  }

  private async leseAngebote(jetzt: number): Promise<void> {
    const { events, antworten } = await this.o.netz.queryMitBericht({ kinds: [KIND_PROVIDER_CAPABILITIES], since: jetzt - PRUEFER_NETZ.angebotAlterSek, limit: 500 });
    // Antwortet kein Relay, bleibt der bisherige Plan – sonst fiele jeder Provider weg
    if (antworten.length === 0) return;
    this.angeboteAm = jetzt;
    const neueste = new Map<string, NostrEvent>();
    for (const ev of events) {
      if (ev.created_at > jetzt + PRUEFER_NETZ.uhrSek) continue;
      const bisher = neueste.get(ev.pubkey);
      if (!bisher || ev.created_at > bisher.created_at) neueste.set(ev.pubkey, ev);
    }
    const angebote = [];
    this.pow.clear();
    for (const ev of neueste.values()) {
      let caps: ReturnType<typeof parseCapabilities>;
      try { caps = parseCapabilities(ev); } catch { continue; }
      const bits = caps.powBits ?? 0;
      if (bits > PRUEFER_NETZ.powMax) continue;
      this.pow.set(caps.pubkey, bits);
      angebote.push(caps);
    }
    this.plan.aktualisiere(angebote, jetzt, this.o.schluessel.pk);
  }

  private async sendeFaellige(jetzt: number): Promise<number> {
    const platz = Math.min(PRUEFER_NETZ.jeRunde, PRUEFER_NETZ.offenMax - this.offen.size);
    if (platz <= 0) return 0;
    let gesendet = 0;
    for (const ziel of this.plan.faellige(jetzt, platz)) {
      const art = PRUEF_ARTEN[Math.min(PRUEF_ARTEN.length - 1, Math.floor(this.zufall() * PRUEF_ARTEN.length))]!;
      const frage = neuePruefFrage(art, this.zufall);
      // Auch wenn das Senden scheitert, gilt das Ziel als gefragt – sonst versuchte es jede Runde neu
      this.plan.gefragt(ziel, jetzt, this.zufall);
      try {
        const { wrap, requestId, sitzung } = await bauePruefAuftrag({ ziel, frage, powBits: this.pow.get(ziel.provider) ?? 0, jetzt });
        const gesendetMs = this.jetztMs();
        // Nirgends angekommen → zählt nicht (die Frage hat den Provider nie erreicht)
        if ((await this.o.netz.publish(wrap)).accepted.length === 0) continue;
        this.offen.set(requestId, { ziel, frage, sitzung, gesendetMs });
        gesendet++;
      } catch {
        /* Rechenarbeit nicht gefunden o. Ä. – nächstes Mal neu */
      }
    }
    return gesendet;
  }

  private async holeAntworten(): Promise<number> {
    if (this.offen.size === 0) return 0;
    const offen = [...this.offen.entries()];
    const seit = Math.floor(Math.min(...offen.map(([, o]) => o.gesendetMs)) / 1000) - PRUEFER_NETZ.uhrSek;
    const { events, antworten } = await this.o.netz.queryMitBericht({ kinds: [1059], "#p": offen.map(([, o]) => o.sitzung.publicKey()), since: seit });
    const jetztMs = this.jetztMs();
    let ausgewertet = 0;
    for (const [requestId, o] of offen) {
      const sitzungPk = o.sitzung.publicKey();
      let punkt: PruefPunkt | null = null;
      for (const wrap of events.filter((w) => getTag(w, "p") === sitzungPk)) {
        const g = await openPrivateJobResponse(wrap, o.sitzung);
        // Nur vom gefragten Provider und nur zu dieser Anfrage
        if (!g.ok || g.providerPk !== o.ziel.provider || getTag(g.response, "e") !== requestId) continue;
        const p = werteAntwortAus(o.frage, g.response, o.gesendetMs, jetztMs);
        if (p && (!punkt || (p.ok && !punkt.ok))) punkt = p;
      }
      // Frist verpasst – nur, wenn überhaupt ein Relay geantwortet hat
      if (!punkt && antworten.length > 0 && jetztMs - o.gesendetMs > PRUEFER_NETZ.fristSek * 1000) {
        punkt = werteAntwortAus(o.frage, undefined, o.gesendetMs, jetztMs);
      }
      if (!punkt) continue;
      this.buch.merke(o.ziel, punkt);
      this.offen.delete(requestId);
      ausgewertet++;
    }
    return ausgewertet;
  }

  private async veroeffentliche(jetzt: number): Promise<number> {
    this.berichtAm = jetzt;
    let n = 0;
    for (const ziel of this.buch.ziele(jetzt)) {
      const b = this.buch.bericht(ziel, jetzt);
      if (!b) continue;
      try {
        if ((await this.o.netz.publish(signEvent(baueMessbericht(b, this.o.schluessel.pk, jetzt), this.o.schluessel.sk))).accepted.length > 0) n++;
      } catch {
        /* nächster Bericht */
      }
    }
    return n;
  }
}

/** Ob der Knoten prüft – mit einem Satz fürs Log (ohne Budget nur Gratis-Angebote). */
export function prueferAusUmgebung(env: { PRUEFER?: string; PRUEFER_BUDGET_MSAT?: string }): { an: boolean; text: string } {
  if (env.PRUEFER !== "1") return { an: false, text: "aus (PRUEFER=1 schaltet die Prüfer-Rolle an)" };
  return {
    an: true,
    text: env.PRUEFER_BUDGET_MSAT?.trim()
      ? "an – PRUEFER_BUDGET_MSAT wird noch nicht genutzt (erst nach Entscheidung, P3c): nur Angebote, die gerade gratis sind"
      : "an – nur Angebote, die gerade gratis sind (ohne Budget)",
  };
}
