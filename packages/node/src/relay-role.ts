/**
 * Relay-Rolle: minimaler NIP-01-Relay (WebSocket) im Node-Prozess.
 *
 * Warum: Freedom soll nicht von oeffentlichen Relays abhaengen. Ein Node mit
 * RELAY_ENABLED=1 bietet Zensur-resistente Infrastruktur — compute + storage
 * + relay in einem Prozess. Der eigene Relay wird automatisch in den Caps
 * publiziert; Clients verbinden sich direkt.
 *
 * Implementierung bewusst minimal:
 * - Event entgegennnehmen (["EVENT", ev]) -> Signatur pruefen -> speichern
 * - REQ/subscribe -> gespeicherte Events nach Filter liefern
 * - Kein Persistenz-Limit-Konzept: Events aelter als RETENTION_DAYS fallen
 *   beim Start raus (einfach, reicht fuer mesh/bootstrap).
 */
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { verifyEvent, NostrEvent } from "@freedomstack/protocol";

export interface RelayConfig {
  port: number;
  retentionDays: number;
  maxEventBytes: number;
}

export class RelayRole {
  private events = new Map<string, NostrEvent>();
  /** subscription-id -> { ws, filters } */
  private subs = new Map<string, { ws: WebSocket; filters: Record<string, unknown>[] }>();
  private wss?: WebSocketServer;

  constructor(private cfg: RelayConfig) {}

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.cfg.port });
    this.wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
      ws.on("message", (raw: unknown) => this.handleMessage(ws, String(raw)));
      ws.on("close", () => {
        for (const [id, sub] of this.subs) if (sub.ws === ws) this.subs.delete(id);
      });
    });
    console.log(`Relay-Rolle aktiv: ws://0.0.0.0:${this.cfg.port} (retention ${this.cfg.retentionDays}d)`);
  }

  stop(): void {
    this.wss?.close();
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: unknown[];
    try { msg = JSON.parse(raw); } catch { return this.notice(ws, "parse error"); }
    if (!Array.isArray(msg)) return this.notice(ws, "invalid message");
    const [type] = msg as [string];

    if (type === "EVENT") {
      const ev = msg[1] as NostrEvent;
      try {
        const json = JSON.stringify(ev);
        if (json.length > this.cfg.maxEventBytes) return this.reply(ws, ["OK", ev.id, false, "too large"]);
        if (!verifyEvent(ev)) return this.reply(ws, ["OK", ev.id, false, "invalid signature"]);
        // duplikate still erlauben (idempotent ok)
        this.events.set(ev.id, ev);
        this.reply(ws, ["OK", ev.id, true, ""]);
        // an alle passenden subscriber verteilen
        for (const [subId, sub] of this.subs) {
          if (sub.ws.readyState !== WebSocket.OPEN) continue;
          if (this.matchesAny(sub.filters, ev)) this.reply(sub.ws, ["EVENT", subId, ev]);
        }
      } catch (e) {
        this.reply(ws, ["OK", ev?.id ?? "?", false, `error: ${(e as Error).message}`]);
      }
      return;
    }

    if (type === "REQ") {
      const [, subId, ...filters] = msg as [string, string, ...Record<string, unknown>[]];
      this.subs.set(subId, { ws, filters });
      // bestehende events liefern
      let count = 0;
      for (const ev of this.events.values()) {
        if (this.matchesAny(filters, ev)) {
          this.reply(ws, ["EVENT", subId, ev]);
          count++;
          if (count >= 5000) break; // schutz vor flooding
        }
      }
      this.reply(ws, ["EOSE", subId]);
      return;
    }

    if (type === "CLOSE") {
      const [, subId] = msg as [string, string];
      this.subs.delete(subId);
      return;
    }

    this.notice(ws, `unknown type: ${String(type)}`);
  }

  private matchesAny(filters: Record<string, unknown>[], ev: NostrEvent): boolean {
    return filters.some((f) => this.matches(f, ev));
  }

  private matches(f: Record<string, unknown>, ev: NostrEvent): boolean {
    if (f.ids && !(f.ids as string[]).includes(ev.id)) return false;
    if (f.authors && !(f.authors as string[]).includes(ev.pubkey)) return false;
    if (f.kinds && !(f.kinds as number[]).includes(ev.kind)) return false;
    const since = f.since as number | undefined;
    if (since && ev.created_at < since) return false;
    const until = f.until as number | undefined;
    if (until && ev.created_at > until) return false;
    // tag-filter (#e, #p, #d, #blob ...)
    for (const [key, vals] of Object.entries(f)) {
      if (!key.startsWith("#")) continue;
      const tagName = key.slice(1);
      const wanted = vals as string[];
      const evVals = ev.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
      if (!wanted.some((w) => evVals.includes(w))) return false;
    }
    return true;
  }

  private reply(ws: WebSocket, msg: unknown[]): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  private notice(ws: WebSocket, msg: string): void {
    this.reply(ws, ["NOTICE", msg]);
  }

  stats(): { events: number; subscriptions: number } {
    return { events: this.events.size, subscriptions: this.subs.size };
  }
}
