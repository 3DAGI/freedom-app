/**
 * WebSocketRelay: echtes Nostr-Relay ueber WebSocket (NIP-01 wire format).
 *
 * Implementiert dasselbe Relay-Interface wie MemoryRelay (outbox.ts):
 *   publish(ev)  -> ["OK", id, true, ""]
 *   query(filter)-> ["EVENT", subId, ev]* + ["EOSE", subId]
 *
 * Danach laeuft der komplette getestete Kern gegen echte Relays, ohne dass
 * eine andere Zeile geaendert werden muss.
 *
 * Kein Framework: rohes WebSocket-API (Node 22+ hat es eingebaut).
 */
import { NostrEvent } from "./event.js";
import { Relay, RelayFilter } from "./outbox.js";

interface WireMsg extends Array<unknown> {}

export interface WebSocketRelayOptions {
  /** Timeout fuer Publish-Ack und Query-EOSE (ms). */
  timeoutMs?: number;
  /** Automatischer Reconnect mit Backoff. */
  autoReconnect?: boolean;
  /**
   * NIP-42 (8.4c): Verlangt der Relay eine Anmeldung (`auth-required:`), holt
   * die Verbindung hier ein signiertes Anmelde-Event – null heisst: nicht
   * anmelden. Nie von selbst: Eine Anmeldung sagt dem Relay, wer diese
   * Verbindung ist.
   */
  anmelden?: (relayUrl: string, challenge: string) => Promise<NostrEvent | null>;
  /**
   * Eigene Verbindung statt des eingebauten WebSocket (8.2c) – der Knoten
   * geht so über Tor (`torWebSocket()` in `packages/node/src/tor.ts`).
   */
  verbinde?: (url: string) => WebSocket;
}

export class WebSocketRelay implements Relay {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  /**
   * Laufende Dauer-Abos.
   *
   * Bisher gab es nur query(): ein REQ, warten auf EOSE, CLOSE. Der Provider
   * musste deshalb pollen — alle 15 Sekunden neu fragen, mit entsprechender
   * Latenz und einer Verbindung, die staendig auf- und abgebaut wurde. Mit
   * einem stehenden Abo kommt ein Job an, sobald er veroeffentlicht ist.
   */
  private subscriptions = new Map<string, {
    filter: RelayFilter;
    onEvent: (ev: NostrEvent) => void;
    onEose?: () => void;
    seen: Set<string>;
  }>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private subCounter = 0;
  private pending = new Map<
    string,
    { events: NostrEvent[]; resolve: (evs: NostrEvent[]) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private okWaiters = new Map<
    string,
    { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private timeoutMs: number;

  private readonly autoReconnect: boolean;
  private readonly anmelden?: WebSocketRelayOptions["anmelden"];
  private readonly verbinde?: WebSocketRelayOptions["verbinde"];
  /** Je Verbindung: letzte Challenge, laufende Anmeldung, schon nach Anmeldung Wiederholtes. */
  private challenge: string | null = null;
  private anmeldung: Promise<boolean> | null = null;
  private wiederholt = new Set<string>();

  constructor(
    public url: string,
    opts: WebSocketRelayOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    // Default an: ein abgerissenes Abo, das niemand wiederherstellt, sieht aus
    // wie "es kommen keine Jobs".
    this.autoReconnect = opts.autoReconnect ?? true;
    this.anmelden = opts.anmelden;
    this.verbinde = opts.verbinde;
  }

  /**
   * Ob die Leitung gerade offen ist – nur lesend, für die Anzeige (C-16). Die
   * Verbindung entsteht erst beim ersten Gebrauch; „nicht verbunden“ heißt also
   * auch „noch nicht gebraucht“.
   */
  get verbunden(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = this.verbinde ? this.verbinde(this.url) : new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`Connect-Timeout: ${this.url}`)), this.timeoutMs);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = (ev) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket-Fehler ${this.url}`));
      };
      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        this.challenge = null;
        this.anmeldung = null;
        this.wiederholt.clear();
        // Ein abgerissenes Abo, das niemand wiederherstellt, sieht aus wie
        // "es kommen keine Jobs" — der schlimmste Fehlerzustand, weil er
        // wie Normalbetrieb aussieht.
        if (!this.closedByUser && this.subscriptions.size > 0) this.scheduleReconnect();
      };
      ws.onmessage = (msg) => this.handleMessage(msg);
    });
    return this.connectPromise;
  }

  private handleMessage(msg: MessageEvent): void {
    let data: WireMsg;
    try {
      data = JSON.parse(String(msg.data)) as WireMsg;
    } catch {
      return;
    }
    const [type, ...rest] = data;
    if (type === "EVENT") {
      const [subId, ev] = rest as [string, NostrEvent];
      const p = this.pending.get(subId);
      if (p) p.events.push(ev);
      // Dauer-Abo: Events sofort durchreichen, statt auf EOSE zu warten.
      const live = this.subscriptions.get(subId);
      if (live) {
        if (live.seen.has(ev.id)) return; // Relay kann doppelt liefern
        live.seen.add(ev.id);
        if (live.seen.size > 5000) {
          // Nicht unbegrenzt wachsen lassen; ein Abo kann tagelang laufen.
          const drop = live.seen.size - 4000;
          let i = 0;
          for (const id of live.seen) { live.seen.delete(id); if (++i >= drop) break; }
        }
        try {
          live.onEvent(ev);
        } catch (e) {
          console.warn(`[relay] Handler warf: ${(e as Error).message}`);
        }
      }
    } else if (type === "EOSE") {
      const [subId] = rest as [string];
      const p = this.pending.get(subId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(subId);
        p.resolve(p.events);
      }
      this.subscriptions.get(subId)?.onEose?.();
    } else if (type === "AUTH") {
      if (typeof rest[0] === "string") this.challenge = rest[0];
    } else if (type === "OK") {
      const [id, ok, meldung] = rest as [string, boolean, string?];
      if (!ok && this.nachAnmeldung(`e:${id}`, meldung, () => this.pendingEvents.get(id))) return;
      const w = this.okWaiters.get(id);
      if (w) {
        clearTimeout(w.timer);
        this.okWaiters.delete(id);
        w.resolve(ok);
      }
    } else if (type === "CLOSED") {
      const [subId, meldung] = rest as [string, string?];
      const req = this.pending.has(subId) || this.subscriptions.has(subId) ? this.reqs.get(subId) : undefined;
      if (this.nachAnmeldung(`r:${subId}`, meldung, () => req)) return;
      const p = this.pending.get(subId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(subId);
        p.resolve(p.events);
      }
    }
  }

  /** Gesendete, noch nicht bestaetigte Nachrichten – fuer die eine Wiederholung nach der Anmeldung. */
  private pendingEvents = new Map<string, string>();
  private reqs = new Map<string, string>();

  /**
   * Lehnte der Relay mit `auth-required:` ab, einmal anmelden und die Nachricht
   * erneut senden. true: wird erledigt (Antwort kommt spaeter); false: wie
   * bisher behandeln.
   */
  private nachAnmeldung(schluessel: string, meldung: string | undefined, nachricht: () => string | undefined): boolean {
    const n = nachricht();
    if (!n || !meldung?.startsWith("auth-required:") || !this.anmelden || this.wiederholt.has(schluessel)) return false;
    this.wiederholt.add(schluessel);
    void this.melde().then((ok) => {
      if (!ok) return this.gibAuf(schluessel);
      try {
        this.ws?.send(n);
      } catch { /* Verbindung zu – die Wartenden laufen in ihre Zeitgrenze */ }
    });
    return true;
  }

  /** Anmeldung gescheitert: Wartende sofort beenden statt in die Zeitgrenze laufen lassen. */
  private gibAuf(schluessel: string): void {
    const id = schluessel.slice(2);
    if (schluessel.startsWith("e:")) {
      const w = this.okWaiters.get(id);
      if (w) { clearTimeout(w.timer); this.okWaiters.delete(id); w.resolve(false); }
    } else {
      const p = this.pending.get(id);
      if (p) { clearTimeout(p.timer); this.pending.delete(id); p.resolve(p.events); }
    }
  }

  /** Einmal je Verbindung anmelden – nur mit Challenge und nur, wenn `anmelden` ein Event liefert. */
  private melde(): Promise<boolean> {
    if (this.anmeldung) return this.anmeldung;
    const challenge = this.challenge;
    const ws = this.ws;
    if (!this.anmelden || !challenge || !ws) return Promise.resolve(false);
    this.anmeldung = (async () => {
      const ev = await this.anmelden!(this.url, challenge).catch(() => null);
      if (!ev || this.ws !== ws) return false;
      const ok = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { this.okWaiters.delete(ev.id); resolve(false); }, this.timeoutMs);
        this.okWaiters.set(ev.id, { resolve, timer });
      });
      ws.send(JSON.stringify(["AUTH", ev]));
      return ok;
    })();
    return this.anmeldung;
  }

  async publish(ev: NostrEvent): Promise<void> {
    await this.connect();
    const ws = this.ws!;
    const ack = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.okWaiters.delete(ev.id);
        resolve(false);
      }, this.timeoutMs);
      this.okWaiters.set(ev.id, { resolve, timer });
    });
    this.pendingEvents.set(ev.id, JSON.stringify(["EVENT", ev]));
    ws.send(this.pendingEvents.get(ev.id)!);
    const ok = await ack;
    this.pendingEvents.delete(ev.id);
    if (!ok) throw new Error(`Relay ${this.url} lehnte Event ${ev.id.slice(0, 8)} ab oder Timeout`);
  }

  async query(filter: RelayFilter): Promise<NostrEvent[]> {
    await this.connect();
    const ws = this.ws!;
    const subId = `q${++this.subCounter}`;
    const result = new Promise<NostrEvent[]>((resolve) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(subId);
        this.pending.delete(subId);
        resolve(p?.events ?? []);
      }, this.timeoutMs);
      this.pending.set(subId, { events: [], resolve, timer });
    });
    this.reqs.set(subId, JSON.stringify(["REQ", subId, filter]));
    ws.send(this.reqs.get(subId)!);
    const events = await result;
    this.reqs.delete(subId);
    try {
      ws.send(JSON.stringify(["CLOSE", subId]));
    } catch {
      /* Verbindung evtl. schon zu */
    }
    return events;
  }

  /**
   * Dauer-Abo: liefert Events, sobald sie eintreffen.
   *
   * Ersetzt das Polling. Gibt eine Funktion zum Beenden zurueck — wer sie
   * nicht ruft, haelt die Verbindung offen, und genau das ist hier gewollt.
   */
  async subscribe(
    filter: RelayFilter,
    onEvent: (ev: NostrEvent) => void,
    onEose?: () => void,
  ): Promise<() => void> {
    await this.connect();
    const subId = `s${++this.subCounter}`;
    this.subscriptions.set(subId, { filter, onEvent, onEose, seen: new Set() });
    this.reqs.set(subId, JSON.stringify(["REQ", subId, filter]));
    this.ws!.send(this.reqs.get(subId)!);

    return () => {
      this.subscriptions.delete(subId);
      this.reqs.delete(subId);
      try {
        this.ws?.send(JSON.stringify(["CLOSE", subId]));
      } catch { /* Verbindung evtl. schon zu */ }
    };
  }

  /**
   * Wiederverbinden mit wachsendem Abstand.
   *
   * `autoReconnect` war als Option deklariert und nirgends implementiert —
   * ein totes Versprechen in der Schnittstelle. Der Abstand waechst, damit ein
   * dauerhaft ausgefallenes Relay nicht im Sekundentakt angeklopft wird.
   */
  private scheduleReconnect(): void {
    if (!this.autoReconnect) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 60_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect()
        .then(() => {
          this.reconnectAttempts = 0;
          // Alle Abos neu anmelden. Ohne das waere die Verbindung zwar wieder
          // da, es kaeme aber nichts mehr an.
          for (const [subId, sub] of this.subscriptions) {
            try {
              this.ws?.send(JSON.stringify(["REQ", subId, sub.filter]));
            } catch { /* naechster Versuch */ }
          }
          console.log(`[relay] ${this.url} wieder verbunden, ${this.subscriptions.size} Abo(s) erneuert`);
        })
        .catch(() => this.scheduleReconnect());
    }, delay);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.subscriptions.clear();
    for (const [, p] of this.pending) clearTimeout(p.timer);
    for (const [, w] of this.okWaiters) clearTimeout(w.timer);
    this.pending.clear();
    this.okWaiters.clear();
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
  }
}
