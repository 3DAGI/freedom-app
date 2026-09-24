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

/**
 * Aufzeichnungs-RPC fuer Solana: genug von `Connection`, damit die App eine
 * Transaktion baut, signieren laesst und sendet. Festgehalten wird jede
 * gesendete Transaktion samt Gebuehrenzahler – ohne Netz, ohne Geld.
 */
export async function aufzeichnungsRpc(): Promise<{ connection: unknown; gesendet: { feePayer: string; konten: string[] }[] }> {
  const { Transaction } = await import("@solana/web3.js");
  const gesendet: { feePayer: string; konten: string[] }[] = [];
  const connection = {
    async getLatestBlockhash() {
      return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 };
    },
    async sendRawTransaction(roh: Uint8Array) {
      const tx = Transaction.from(roh);
      gesendet.push({
        feePayer: tx.feePayer?.toBase58() ?? "",
        konten: tx.instructions.flatMap((i) => i.keys.map((k) => k.pubkey.toBase58())),
      });
      return `aufgezeichnet${gesendet.length}`;
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
  };
  return { connection, gesendet };
}
