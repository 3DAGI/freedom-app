/**
 * Offline-Betrieb des Providers.
 *
 * DIE LÜCKE
 * Die App kann ohne Internet arbeiten, der Knoten nicht — er braucht zwingend
 * Relays. Für die Ausfall-Geschichte ist das die entscheidende Schwäche: Wenn
 * das Netz weg ist, gibt es zwar Nachrichten zwischen Menschen, aber keinen
 * einzigen Provider. Die Hälfte des Systems fällt genau dann aus, wenn sie am
 * wichtigsten wäre.
 *
 * WAS HIER PASSIERT
 * Der Knoten legt eingehende und ausgehende Ereignisse zusätzlich in einem
 * Ordner ab. Fällt das Netz aus, arbeitet er aus diesem Ordner weiter; kommt
 * es zurück, wird nachgereicht. Derselbe Ordner lässt sich auf einen Stick
 * kopieren oder über Funk abgleichen — das Datei-Relay macht dabei keinen
 * Unterschied zwischen den Wegen.
 *
 * WAS DAS NICHT LEISTET
 * Live-Inferenz über Funk bleibt unmöglich: Eine Antwort mit 500 Tokens
 * bräuchte Stunden. Was geht, ist der **zeitversetzte** Betrieb — ein Auftrag
 * kommt per Stick an, wird bearbeitet, und die Antwort geht denselben Weg
 * zurück. Für einen Ort ohne Internet ist das der Unterschied zwischen
 * „gar nichts" und „am nächsten Tag".
 */
import {
  OutboxPool, Relay, NostrEvent, RelayFilter,
  FileRelay, fsStorage, buildDigest, planSync,
  type Link,
} from "@freedomstack/protocol";

export interface OfflineConfig {
  /** Ordner, in dem Ereignisse liegen. */
  spoolDir: string;
  /** Wie viele Ereignisse höchstens gehalten werden. */
  maxEvents?: number;
  /** Strecke, über die abgeglichen wird. */
  link?: Link;
}

export interface OfflineStatus {
  online: boolean;
  spooled: number;
  /** Ereignisse, die auf Netz warten. */
  pending: number;
  message: string;
}

/**
 * Relay-Pool, der einen Datei-Ordner als vollwertiges Relay mitführt.
 *
 * Der Ordner ist bewusst ein normales Relay und kein Sonderfall: Für alles
 * darüber verhält er sich identisch, und genau deshalb funktioniert der
 * Knoten offline ohne Sonderbehandlung an dutzend Stellen.
 */
export class OfflineCapablePool {
  private fileRelay: FileRelay;
  private pendingOut: NostrEvent[] = [];
  private lastOnline = 0;

  constructor(
    private netzRelays: Relay[],
    private cfg: OfflineConfig,
  ) {
    this.fileRelay = new FileRelay(fsStorage(cfg.spoolDir), `file://${cfg.spoolDir}`);
  }

  /** Pool aus Netz-Relays plus Ordner. */
  pool(): OutboxPool {
    // minAcks 1: Der Ordner allein genügt. Ohne das würde der Knoten offline
    // bei jedem Publish werfen und damit stehenbleiben.
    return new OutboxPool([...this.netzRelays, this.fileRelay], {
      minAcks: 1,
      throwOnTotalFailure: false,
      onPublishFailure: (r) => {
        if (r.accepted.length === 0) {
          console.warn(`[offline] ${r.eventId.slice(0, 8)} nirgends angenommen`);
        }
      },
    });
  }

  /**
   * Veröffentlichen mit Rückfallebene.
   *
   * Erreicht das Ereignis kein Netz-Relay, bleibt es in der Warteschlange und
   * wird nachgereicht. Ein Job-Ergebnis, das nur im Ordner landet und nie
   * zugestellt wird, wäre für den Kunden dasselbe wie gar keine Antwort.
   */
  async publish(ev: NostrEvent, nowSecs = Math.floor(Date.now() / 1000)): Promise<boolean> {
    // Immer in den Ordner: Er ist der Bestand, aus dem abgeglichen wird.
    await this.fileRelay.publish(ev).catch(() => { /* Platte voll */ });

    const berichte = await Promise.allSettled(this.netzRelays.map((r) => r.publish(ev)));
    const online = berichte.some((b) => b.status === "fulfilled");

    if (online) {
      this.lastOnline = nowSecs;
      await this.flush();
      return true;
    }

    this.pendingOut.push(ev);
    const max = this.cfg.maxEvents ?? 5000;
    if (this.pendingOut.length > max) {
      // Älteste verwerfen: Ein unbegrenzter Puffer füllt die Platte und
      // beendet den Knoten — dann ist gar nichts mehr zugestellt.
      this.pendingOut.splice(0, this.pendingOut.length - max);
    }
    return false;
  }

  /** Wartende Ereignisse nachreichen. */
  async flush(): Promise<number> {
    if (this.pendingOut.length === 0) return 0;
    const warten = [...this.pendingOut];
    this.pendingOut = [];
    let zugestellt = 0;

    for (const ev of warten) {
      const b = await Promise.allSettled(this.netzRelays.map((r) => r.publish(ev)));
      if (b.some((x) => x.status === "fulfilled")) zugestellt++;
      else this.pendingOut.push(ev);
    }
    if (zugestellt > 0) console.log(`[offline] ${zugestellt} Ereignisse nachgereicht`);
    return zugestellt;
  }

  /** Abfrage über Netz UND Ordner. */
  async query(filter: RelayFilter): Promise<NostrEvent[]> {
    const alle = await Promise.allSettled([
      ...this.netzRelays.map((r) => r.query(filter)),
      this.fileRelay.query(filter),
    ]);
    const gesehen = new Set<string>();
    const out: NostrEvent[] = [];
    for (const r of alle) {
      if (r.status !== "fulfilled") continue;
      for (const ev of r.value) {
        if (gesehen.has(ev.id)) continue;
        gesehen.add(ev.id);
        out.push(ev);
      }
    }
    return out;
  }

  async status(nowSecs = Math.floor(Date.now() / 1000)): Promise<OfflineStatus> {
    const bestand = await this.fileRelay.query({ limit: 10_000 }).catch(() => []);
    const online = await this.probeOnline();

    return {
      online,
      spooled: bestand.length,
      pending: this.pendingOut.length,
      message: online
        ? this.pendingOut.length > 0
          ? `Online. ${this.pendingOut.length} Ereignisse werden nachgereicht.`
          : `Online. ${bestand.length} Ereignisse im Ordner.`
        : `Offline seit ${Math.floor((nowSecs - this.lastOnline) / 60)} Minuten. ` +
          `${this.pendingOut.length} warten auf Zustellung, ${bestand.length} im Ordner — ` +
          `der Ordner lässt sich per Stick oder Funk weitergeben.`,
    };
  }

  private async probeOnline(): Promise<boolean> {
    const r = await Promise.allSettled(
      this.netzRelays.map((x) => x.query({ kinds: [1], limit: 1 })),
    );
    return r.some((x) => x.status === "fulfilled");
  }

  /**
   * Bestand für einen Abgleich anbieten.
   *
   * Dieselbe Rechnung wie in der App: kompakter Filter statt Volltext-Liste,
   * dann die Differenz nach Dringlichkeit.
   */
  async syncPlanFor(fremdBits: Uint8Array, fremdCount: number): Promise<{
    events: NostrEvent[];
    seconds: number;
    note: string;
  }> {
    const eigene = await this.fileRelay.query({ limit: 10_000 }).catch(() => []);
    const plan = planSync(eigene, { bits: fremdBits, count: fremdCount, since: 0 }, {
      link: this.cfg.link ?? "datei",
    });
    return { events: plan.send, seconds: plan.estimatedSeconds, note: plan.note };
  }

  /** Eigener Bestand als kompakte Zusammenfassung. */
  async digest(): Promise<{ bits: Uint8Array; count: number }> {
    const eigene = await this.fileRelay.query({ limit: 10_000 }).catch(() => []);
    const d = buildDigest(eigene);
    return { bits: d.bits, count: d.count };
  }

  /** Ereignisse von einem Stick oder aus einem Funk-Abgleich einspielen. */
  async ingest(events: NostrEvent[]): Promise<number> {
    let neu = 0;
    for (const ev of events) {
      try {
        await this.fileRelay.publish(ev);
        neu++;
      } catch { /* unbrauchbar */ }
    }
    return neu;
  }
}
