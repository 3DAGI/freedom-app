/**
 * Outbox beim Lesen (Schritt 5.4b), ohne DOM.
 *
 * Was Kontakte schreiben (Profil, Schlüsselwechsel, Geräte-Vollmachten),
 * liest die App zusätzlich dort, wo sie es laut ihrer NIP-65-Liste
 * hinschreiben – nicht nur im eigenen Pool. Sonst sähe man einen Kontakt nur,
 * wenn er zufällig dieselben Relays nutzt.
 *
 * - Die Listen der Autoren kommen aus dem Pool und bleiben zehn Minuten im
 *   Speicher; `outboxPlan()` (Protokoll) prüft sie und bündelt je Relay.
 * - Relays, die schon im Pool sind, fragt der Pool; nur die übrigen einzeln. Seit A-24 kennt der Plan
 *   den Pool (zählt mit, belegt keinen Platz), seit A-26 lässt er Relays aus, die gerade scheiterten.
 * - Von fremden Relays zählt nur, was gültig signiert ist und von einem der
 *   gefragten Autoren stammt.
 */
import { KIND_RELAY_LIST, normalizeRelayUrl, outboxPlan, verifyEvent, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";

export const LISTEN_FRISCH_MS = 10 * 60_000;

interface Pool {
  readonly urls: readonly string[];
  query(filter: RelayFilter): Promise<NostrEvent[]>;
}

export class OutboxLeser {
  private readonly listen = new Map<string, { at: number; ev?: NostrEvent }>();

  constructor(private readonly p: {
    pool: () => Promise<Pool>;
    /** Nur an diesen Relays fragen (kurze eigene Verbindungen). */
    frageAn: (filter: RelayFilter, urls: readonly string[]) => Promise<NostrEvent[]>;
    /** Fremde Relays, die gerade nicht zu erreichen waren (A-26) – nicht einplanen. */
    ausgesetzt?: () => Iterable<string>;
    /** Läuft die Seite über Tor (.onion)? Dann auch `ws://…onion` (A-25). */
    onion?: () => boolean;
    jetzt?: () => number;
  }) {}

  /** Events dieser Autoren: aus dem Pool und von ihren Schreib-Relays. */
  async frage(filter: RelayFilter & { authors: string[] }): Promise<NostrEvent[]> {
    const pool = await this.p.pool();
    const [ausPool, listen] = await Promise.all([pool.query(filter), this.listenVon(filter.authors, pool)]);
    const imPool = new Set(pool.urls.map(normalizeRelayUrl));
    const plan = [...outboxPlan(listen, filter.authors, { imPool: pool.urls, onion: this.p.onion?.(), aussetzen: this.p.ausgesetzt?.() })]
      .filter(([url]) => !imPool.has(url));
    const weitere = await Promise.all(plan.map(([url, authors]) => this.p.frageAn({ ...filter, authors }, [url]).catch(() => [])));
    const gesucht = new Set(filter.authors);
    const alle = new Map(ausPool.map((ev) => [ev.id, ev]));
    for (const ev of weitere.flat()) if (!alle.has(ev.id) && gesucht.has(ev.pubkey) && verifyEvent(ev)) alle.set(ev.id, ev);
    return [...alle.values()];
  }

  /** NIP-65-Listen der Autoren – je Autor höchstens alle zehn Minuten neu. */
  private async listenVon(autoren: readonly string[], pool: Pool): Promise<NostrEvent[]> {
    const jetzt = (this.p.jetzt ?? Date.now)();
    const fehlen = autoren.filter((a) => { const l = this.listen.get(a); return !l || jetzt - l.at >= LISTEN_FRISCH_MS; });
    if (fehlen.length > 0) {
      const evs = await pool.query({ kinds: [KIND_RELAY_LIST], authors: fehlen, limit: fehlen.length * 3 }).catch(() => null);
      // Offline: nichts merken – beim nächsten Mal wieder
      if (evs) {
        for (const a of fehlen) {
          // Nur gültige – eine gefälschte neuere Liste verdrängte sonst die echte
          const ev = evs.filter((e) => e.pubkey === a && e.kind === KIND_RELAY_LIST && verifyEvent(e)).sort((x, y) => y.created_at - x.created_at)[0];
          this.listen.set(a, { at: jetzt, ev });
        }
      }
    }
    return autoren.map((a) => this.listen.get(a)?.ev).filter((e): e is NostrEvent => !!e);
  }
}
