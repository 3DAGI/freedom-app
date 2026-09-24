/**
 * Die Mechanismen, die der Knoten tatsächlich veröffentlichen muss.
 *
 * WAS HIER SCHIEFGELAUFEN WAR
 * Neun Protokoll-Bausteine waren gebaut, getestet — und wurden nirgends
 * aufgerufen. Sie existierten nur in ihren eigenen Tests. Die Folgen sind
 * nicht kosmetisch:
 *
 *   · **Zeitzeugen** wurden nie veröffentlicht. Damit lief die gesamte
 *     Zeitstempel-Absicherung ins Leere, und der Aufgaben-Angriff
 *     (dreißig „Tage" in einer Minute) war weiterhin offen.
 *   · **Relay-Nachweise** wurden nie veröffentlicht. Damit bekam kein Relay
 *     je Geld, obwohl die Verteilung gebaut war.
 *   · **Swap-Attestierungen** wurden nie veröffentlicht. Damit hatte der
 *     Vertrauensgraph keine einzige Kante — jeder Vertrauenswert war null.
 *   · **Kurse** wurden nie veröffentlicht. Damit hatte der Liquiditätsgeber
 *     keine Wechselkursquelle.
 *
 * Das Muster ist dasselbe wie beim Mesh-Abgleich und bei den fehlenden
 * Oberflächen: Protokollcode lässt sich testen, Verdrahtung nicht — und der
 * Weg des messbaren Fortschritts führt an ihr vorbei.
 *
 * WAS DIESES MODUL TUT
 * Es bündelt die periodischen Veröffentlichungen eines Knotens an einer
 * Stelle, damit beim nächsten neuen Mechanismus auffällt, wenn er fehlt.
 */
import {
  OutboxPool, NostrEvent, signEvent,
  buildTimeWitness, buildRelayProof, buildSwapAttestation, buildPriceTicker,
  KIND_TIME_WITNESS,
} from "@freedomstack/protocol";

export interface PublisherConfig {
  keypair: { pk: string; sk: Uint8Array };
  /** Öffentliche Relay-Adresse, falls dieser Knoten ein Relay betreibt. */
  relayUrl?: string;
  /** Wie oft Zeugen und Nachweise veröffentlicht werden. */
  intervalSecs?: number;
}

export interface PublishCycle {
  witnesses: number;
  relayProofs: number;
  attestations: number;
  tickers: number;
  errors: string[];
}

/**
 * Periodische Veröffentlichungen eines Knotens.
 *
 * Bewusst ohne eigenen Timer: Der Aufrufer bestimmt den Takt, und was sich
 * von außen takten lässt, lässt sich auch ohne Wartezeit testen.
 */
export class NodePublisher {
  private gesehen = new Set<string>();
  private letzterZeuge = 0;
  private letzterRelayNachweis = 0;

  constructor(
    private pool: OutboxPool,
    private cfg: PublisherConfig,
  ) {}

  /** Ereignis für den nächsten Zeugen vormerken. */
  observe(eventId: string): void {
    this.gesehen.add(eventId);
    // Begrenzen: Ein Zeuge über hunderttausend Kennungen wäre so groß, dass
    // ihn niemand mehr abruft.
    if (this.gesehen.size > 50_000) {
      const behalten = [...this.gesehen].slice(-25_000);
      this.gesehen = new Set(behalten);
    }
  }

  /**
   * Zeitzeuge veröffentlichen.
   *
   * Der Kern der Zeitstempel-Absicherung: Wer später ein Ereignis mit einem
   * Zeitstempel aus diesem Zeitraum vorlegt, das hier nicht vorkommt, hat es
   * nachträglich erzeugt.
   */
  async publishWitness(nowSecs = Math.floor(Date.now() / 1000)): Promise<boolean> {
    if (this.gesehen.size === 0) return false;
    const von = this.letzterZeuge || nowSecs - (this.cfg.intervalSecs ?? 3600);

    const ev = signEvent(
      buildTimeWitness(this.cfg.keypair.pk, [...this.gesehen], von, nowSecs, nowSecs),
      this.cfg.keypair.sk,
    );
    await this.pool.publish(ev);

    this.letzterZeuge = nowSecs;
    this.gesehen.clear();
    return true;
  }

  /**
   * Relay-Nachweis veröffentlichen.
   *
   * Ohne ihn bekommt ein Relay nichts aus dem Reward-Pool, obwohl die
   * Verteilung gebaut ist. Nur Knoten mit öffentlicher Adresse melden —
   * ein Nachweis ohne erreichbare Adresse wird bei der Verteilung ohnehin
   * verworfen.
   */
  async publishRelayProof(
    delivered: number,
    uniqueClients: number,
    nowSecs = Math.floor(Date.now() / 1000),
  ): Promise<boolean> {
    if (!this.cfg.relayUrl) return false;
    if (uniqueClients === 0) return false;

    const von = this.letzterRelayNachweis || nowSecs - 604_800;
    const ev = signEvent(
      buildRelayProof({
        relayPubkey: this.cfg.keypair.pk,
        fromUnix: von, untilUnix: nowSecs,
        delivered, uniqueClients, url: this.cfg.relayUrl,
      }, nowSecs),
      this.cfg.keypair.sk,
    );
    await this.pool.publish(ev);
    this.letzterRelayNachweis = nowSecs;
    return true;
  }

  /**
   * Swap-Attestierung nach einem abgeschlossenen Tausch.
   *
   * Die einzige Eingabe des Vertrauensgraphen. Ohne sie hat er keine Kante,
   * und jeder Vertrauenswert im ganzen System ist null — inklusive der
   * Prüferzulassung beim Streitfall und der Provider-Stufen.
   */
  async attestSwap(
    swapId: string,
    counterparty: string,
    success: boolean,
    nowSecs = Math.floor(Date.now() / 1000),
  ): Promise<void> {
    const ev = signEvent(
      buildSwapAttestation(
        { swapId, counterpartyPubkey: counterparty, success },
        this.cfg.keypair.pk,
        nowSecs,
      ),
      this.cfg.keypair.sk,
    );
    await this.pool.publish(ev);
  }

  /** Kurs veröffentlichen — die Quelle für den Medianpreis. */
  async publishTicker(
    pair: string,
    satsPerUnit: number,
    nowSecs = Math.floor(Date.now() / 1000),
  ): Promise<void> {
    const ev = signEvent(
      buildPriceTicker({ pair, satsPerUnit, publishedAt: nowSecs }, this.cfg.keypair.pk),
      this.cfg.keypair.sk,
    );
    await this.pool.publish(ev);
  }

  /**
   * Einen vollständigen Takt ausführen.
   *
   * Sammelt Fehler, statt beim ersten abzubrechen: Ein Knoten, der wegen
   * eines nicht erreichbaren Relays keine Zeugen mehr veröffentlicht, fällt
   * still aus dem Verfahren.
   */
  async cycle(input: {
    delivered?: number;
    uniqueClients?: number;
    rates?: { pair: string; satsPerUnit: number }[];
    nowSecs?: number;
  }): Promise<PublishCycle> {
    const now = input.nowSecs ?? Math.floor(Date.now() / 1000);
    const r: PublishCycle = { witnesses: 0, relayProofs: 0, attestations: 0, tickers: 0, errors: [] };

    try {
      if (await this.publishWitness(now)) r.witnesses = 1;
    } catch (e) {
      r.errors.push(`Zeuge: ${(e as Error).message}`);
    }

    try {
      if (await this.publishRelayProof(input.delivered ?? 0, input.uniqueClients ?? 0, now)) {
        r.relayProofs = 1;
      }
    } catch (e) {
      r.errors.push(`Relay-Nachweis: ${(e as Error).message}`);
    }

    for (const k of input.rates ?? []) {
      try {
        await this.publishTicker(k.pair, k.satsPerUnit, now);
        r.tickers++;
      } catch (e) {
        r.errors.push(`Kurs ${k.pair}: ${(e as Error).message}`);
      }
    }

    return r;
  }

  get pendingWitnessCount(): number {
    return this.gesehen.size;
  }
}

/**
 * Prüft, ob ein Knoten die Mechanismen tatsächlich bedient.
 *
 * Gedacht für den Start: Ein Betreiber soll sehen, was sein Knoten beiträgt
 * und was nicht — statt zu glauben, er trage bei, weil die Software die
 * Funktion enthält.
 */
export function publisherSelfCheck(cfg: PublisherConfig, hasLp: boolean): {
  active: string[];
  inactive: string[];
  message: string;
} {
  const aktiv = ["Zeitzeugen (sichert die Aufgaben gegen Rückdatierung)"];
  const inaktiv: string[] = [];

  if (cfg.relayUrl) aktiv.push("Relay-Nachweise (Anteil am Reward-Pool)");
  else inaktiv.push("Relay-Nachweise — kein RELAY_PUBLIC_URL gesetzt, also keine Vergütung");

  if (hasLp) aktiv.push("Kurse und Swap-Attestierungen");
  else inaktiv.push("Kurse — kein Liquiditätsgeber auf diesem Knoten");

  return {
    active: aktiv,
    inactive: inaktiv,
    message:
      `${aktiv.length} Mechanismus/Mechanismen aktiv, ${inaktiv.length} nicht. ` +
      (inaktiv.length > 0
        ? "Die inaktiven kosten dich Einnahmen, schaden dem Netz aber nicht."
        : "Dieser Knoten trägt alles bei, was er kann."),
  };
}

/** Ereignisse für den Zeugen aus einem Relay-Betrieb einsammeln. */
export function observeAll(publisher: NodePublisher, events: NostrEvent[]): number {
  for (const ev of events) publisher.observe(ev.id);
  void KIND_TIME_WITNESS;
  return publisher.pendingWitnessCount;
}
