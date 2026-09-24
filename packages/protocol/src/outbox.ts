/**
 * Outbox-Modell: Multi-Relay-Publikation.
 *
 * DIES SCHLIESST LUECKE #1 DES INTEGRATIONSPLANS.
 *
 * Buzz laeuft pro Workspace ueber EIN autoritatives Relay ("single source of
 * truth", kein P2P, kein Gossip, keine Replikation). Fuer einen Enterprise-
 * Workspace ist das richtig; fuer Zensurresistenz ist es ein abschaltbarer
 * Punkt.
 *
 * Das Outbox-Modell (Clawstr-Prinzip: lehnt ein Relay ab, publiziere auf ein
 * anderes) macht daraus Redundanz:
 *   - Jedes Event geht an MEHRERE unabhaengige Relays.
 *   - Erfolg = mindestens `minAcks` Relays haben akzeptiert.
 *   - Faellt eines aus oder zensiert, uebernehmen die anderen.
 *   - Weil jedes Event signiert ist, kann kein Relay Inhalte faelschen -
 *     es kann sie nur vorenthalten. Redundanz neutralisiert genau das.
 */
import { NostrEvent, verifyEvent } from "./event.js";

export interface RelayFilter {
  kinds?: number[];
  authors?: string[];
  ids?: string[];
  since?: number;
  until?: number;
  limit?: number;
  /** Tag-Filter, z. B. { "#e": ["<id>"] } */
  [key: `#${string}`]: string[] | undefined;
}

export interface Relay {
  url: string;
  publish(ev: NostrEvent): Promise<void>;
  query(filter: RelayFilter): Promise<NostrEvent[]>;
  /**
   * Optionales Dauer-Abo.
   *
   * Optional, weil MemoryRelay und aeltere Implementierungen es nicht koennen —
   * der Pool faellt dann fuer dieses Relay auf Abfragen zurueck, statt es
   * ganz zu uebergehen.
   */
  subscribe?(
    filter: RelayFilter,
    onEvent: (ev: NostrEvent) => void,
    onEose?: () => void,
  ): Promise<() => void>;
}

export interface PublishReport {
  eventId: string;
  accepted: string[];
  rejected: { url: string; reason: string }[];
  ok: boolean;
}

/**
 * Fehler bei vollstaendig gescheitertem Publish.
 *
 * Traegt den Bericht mit, damit ein Aufrufer entscheiden kann, ob er es erneut
 * versucht oder aufgibt — ohne den Fehlertext parsen zu muessen.
 */
export class PublishError extends Error {
  constructor(message: string, public readonly report: PublishReport) {
    super(message);
    this.name = "PublishError";
  }
}

export interface OutboxOptions {
  /** Mindestzahl an Relays, die akzeptieren muessen. Default 2. */
  minAcks?: number;
  /**
   * Wird gerufen, wenn ein Publish gar nicht oder nur teilweise ankam.
   *
   * Gedacht fuer Logging und UI-Hinweise. Der Aufrufer entscheidet, ob ein
   * duenn verteiltes Event ein Problem ist — das haengt davon ab, was drinsteht.
   */
  onPublishFailure?: (report: PublishReport) => void;
  /**
   * Bei vollstaendigem Fehlschlag werfen. Default true.
   *
   * Auf false setzen nur, wenn der Aufrufer den Bericht SELBST auswertet —
   * sonst ist man wieder beim stillen Verschwinden.
   */
  throwOnTotalFailure?: boolean;
}

export class OutboxPool {
  constructor(private relays: Relay[], private opts: OutboxOptions = {}) {
    if (relays.length === 0) throw new Error("OutboxPool braucht mindestens ein Relay");
  }

  get urls(): string[] {
    return this.relays.map((r) => r.url);
  }

  addRelay(r: Relay): void {
    if (!this.relays.some((x) => x.url === r.url)) this.relays.push(r);
  }

  removeRelay(url: string): void {
    this.relays = this.relays.filter((r) => r.url !== url);
  }

  /**
   * Publiziert auf ALLE Relays parallel. Erfolg, sobald genug akzeptiert haben.
   * Ein einzelnes zensierendes oder ausgefallenes Relay bricht nichts.
   */
  async publish(ev: NostrEvent): Promise<PublishReport> {
    const minAcks = Math.min(this.opts.minAcks ?? 2, this.relays.length);
    const results = await Promise.allSettled(this.relays.map((r) => r.publish(ev)));

    const accepted: string[] = [];
    const rejected: { url: string; reason: string }[] = [];
    results.forEach((res, i) => {
      const url = this.relays[i].url;
      if (res.status === "fulfilled") accepted.push(url);
      else rejected.push({ url, reason: String(res.reason?.message ?? res.reason) });
    });

    const report = { eventId: ev.id, accepted, rejected, ok: accepted.length >= minAcks };

    // Ein vollstaendig fehlgeschlagener Publish war bisher STILL: publish()
    // gab ein ok:false zurueck, das kein einziger Aufrufer geprueft hat. Ein
    // Job-Ergebnis, ein Fee-Beweis oder eine Zahlungsankuendigung verschwand
    // damit spurlos, und der Nutzer wartete auf etwas, das nie ankam.
    if (accepted.length === 0) {
      this.opts.onPublishFailure?.(report);
      if (this.opts.throwOnTotalFailure !== false) {
        throw new PublishError(
          `Kein Relay hat das Event angenommen (${rejected.map((r) => r.url).join(", ") || "keine Relays"}). ` +
            `Gruende: ${rejected.map((r) => r.reason).join(" | ") || "unbekannt"}`,
          report,
        );
      }
    } else if (!report.ok) {
      // Teilerfolg: das Event ist draussen, aber duenner verteilt als gewollt.
      // Kein Abbruch — aber auch nicht verschweigen.
      this.opts.onPublishFailure?.(report);
    }

    return report;
  }

  /**
   * Dauer-Abo ueber ALLE Relays, die es koennen.
   *
   * Dedupliziert, prueft Signaturen und meldet jedes Event genau einmal — auch
   * wenn es auf mehreren Relays liegt, was der Normalfall ist. Ersetzt das
   * Polling: ein Job kommt an, sobald er veroeffentlicht ist, statt beim
   * naechsten Abfrageintervall.
   */
  async subscribe(
    filter: RelayFilter,
    onEvent: (ev: NostrEvent) => void,
  ): Promise<() => void> {
    const seen = new Set<string>();
    const stops: (() => void)[] = [];

    const handle = (ev: NostrEvent): void => {
      if (seen.has(ev.id)) return;
      // Dieselbe Pruefung wie bei query(): ein boesartiges Relay darf auch
      // ueber ein Abo nichts unterschieben.
      if (!verifyEvent(ev)) return;
      seen.add(ev.id);
      if (seen.size > 20_000) {
        const drop = seen.size - 16_000;
        let i = 0;
        for (const id of seen) { seen.delete(id); if (++i >= drop) break; }
      }
      onEvent(ev);
    };

    for (const r of this.relays) {
      if (!r.subscribe) continue;
      try {
        stops.push(await r.subscribe(filter, handle));
      } catch (e) {
        // Ein Relay, das nicht mitmacht, darf die anderen nicht blockieren.
        console.warn(`[outbox] Abo bei ${r.url} fehlgeschlagen: ${(e as Error).message}`);
      }
    }

    if (stops.length === 0) {
      throw new Error("Kein Relay unterstuetzt Dauer-Abos — Abfrage-Betrieb noetig.");
    }
    return () => { for (const stop of stops) stop(); };
  }

  /**
   * Fragt ALLE Relays ab, dedupliziert nach Event-ID und verwirft Events mit
   * ungueltiger Signatur. Ein boesartiges Relay kann so nichts unterschieben.
   */
  async query(filter: RelayFilter): Promise<NostrEvent[]> {
    const results = await Promise.allSettled(this.relays.map((r) => r.query(filter)));
    const byId = new Map<string, NostrEvent>();
    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      for (const ev of res.value) {
        if (byId.has(ev.id)) continue;
        if (!verifyEvent(ev)) continue; // gefaelschte/manipulierte Events raus
        byId.set(ev.id, ev);
      }
    }
    return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
  }

  /**
   * Zensur-Diagnose: welche Relays kennen ein bestimmtes Event nicht?
   * Macht Vorenthalten sichtbar, statt es stillschweigend hinzunehmen.
   */
  async auditAvailability(eventId: string): Promise<{ has: string[]; missing: string[] }> {
    const has: string[] = [];
    const missing: string[] = [];
    await Promise.all(
      this.relays.map(async (r) => {
        try {
          const found = await r.query({ ids: [eventId], limit: 1 });
          if (found.some((e) => e.id === eventId)) has.push(r.url);
          else missing.push(r.url);
        } catch {
          missing.push(r.url);
        }
      }),
    );
    return { has, missing };
  }
}

/** In-Memory-Relay fuer Tests/Demo. `censorKinds` simuliert Zensur. */
export class MemoryRelay implements Relay {
  private store: NostrEvent[] = [];
  constructor(
    public url: string,
    private censorKinds: number[] = [],
    private offline = false,
  ) {}

  setOffline(v: boolean): void { this.offline = v; }

  async publish(ev: NostrEvent): Promise<void> {
    if (this.offline) throw new Error(`Relay ${this.url} offline`);
    if (this.censorKinds.includes(ev.kind)) throw new Error(`Relay ${this.url} lehnt kind ${ev.kind} ab`);
    if (!verifyEvent(ev)) throw new Error("ungueltige Signatur");
    if (!this.store.some((e) => e.id === ev.id)) this.store.push(ev);
  }

  async query(filter: RelayFilter): Promise<NostrEvent[]> {
    if (this.offline) throw new Error(`Relay ${this.url} offline`);
    const matched = this.store.filter((e) => {
      if (filter.ids && !filter.ids.includes(e.id)) return false;
      if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
      if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
      if (filter.since && e.created_at < filter.since) return false;
      if (filter.until && e.created_at > filter.until) return false;
      for (const [k, v] of Object.entries(filter)) {
        if (!k.startsWith("#") || !v) continue;
        const tagName = k.slice(1);
        const vals = e.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
        if (!(v as string[]).some((x) => vals.includes(x))) return false;
      }
      return true;
    });

    // `limit` wurde bisher ignoriert. Damit verhielt sich MemoryRelay anders
    // als jedes echte Relay — Tests konnten gruen sein, obwohl derselbe Code
    // im Netz eine gekuerzte Antwort bekommen haette.
    const sorted = matched.sort((a, b) => b.created_at - a.created_at);
    return filter.limit && filter.limit > 0 ? sorted.slice(0, filter.limit) : sorted;
  }
}
