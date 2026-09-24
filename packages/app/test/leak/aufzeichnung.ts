/**
 * Aufzeichnungs-Relay fuer die Leak-Tests (Schritt 1.5): dieselbe Schnittstelle
 * wie der Relay-Pool der App (`publish`, `query`, `subscribe`) – jedes
 * gesendete Event wird festgehalten, auch ein ungueltiges.
 */
import { MemoryRelay, OutboxPool, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";

export class AufzeichnungsRelay extends MemoryRelay {
  readonly gesendet: NostrEvent[] = [];
  #abos: { filter: RelayFilter; onEvent: (ev: NostrEvent) => void }[] = [];

  constructor() {
    super("wss://aufzeichnung.test");
  }

  override async publish(ev: NostrEvent): Promise<void> {
    this.gesendet.push(ev);
    await super.publish(ev);
    for (const a of this.#abos) {
      if ((await super.query({ ...a.filter, ids: [ev.id] })).length > 0) a.onEvent(ev);
    }
  }

  async subscribe(filter: RelayFilter, onEvent: (ev: NostrEvent) => void, onEose?: () => void): Promise<() => void> {
    for (const ev of await super.query(filter)) onEvent(ev);
    onEose?.();
    const abo = { filter, onEvent };
    this.#abos.push(abo);
    return () => { this.#abos = this.#abos.filter((a) => a !== abo); };
  }
}

/** Pool wie in der App, aber mit nur dem Aufzeichnungs-Relay. */
export function aufzeichnung(): { pool: OutboxPool; relay: AufzeichnungsRelay } {
  const relay = new AufzeichnungsRelay();
  return { relay, pool: new OutboxPool([relay], { minAcks: 1 }) };
}
