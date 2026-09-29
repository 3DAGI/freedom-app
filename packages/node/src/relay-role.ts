/**
 * Relay-Rolle: NIP-01-Relay (WebSocket) im Node-Prozess.
 *
 * Warum: Freedom soll nicht von oeffentlichen Relays abhaengen. Ein Node mit
 * RELAY_ENABLED=1 bietet Zensur-resistente Infrastruktur — compute + storage
 * + relay in einem Prozess. Der eigene Relay wird automatisch in den Caps
 * publiziert; Clients verbinden sich direkt.
 *
 * Seit 8.4 (mit 5.4c) taugt er als Posteingang:
 * - NIP-42: jede Verbindung bekommt eine Challenge; wer sich anmeldet, liest
 *   die Umschlaege (Kind 1059) an sich – andere nicht (einstellbar, beschraenkt
 *   immer an).
 * - Zugang: beschraenkt nimmt der Relay nur von Schluesseln mit Zugang an –
 *   oder an sie (`p`-Tag), damit ihr Posteingang erreichbar bleibt. Der Zugang
 *   steht im Zugangsbuch (Datei); bezahlt wird er ab 8.4b.
 * - NIP-01/40: ersetzbare Events nur in der neuesten Fassung, fluechtige nur
 *   weitergereicht, `limit` mit den neuesten zuerst, Abgelaufenes weder
 *   angenommen noch ausgeliefert.
 * - NIP-11: Selbstauskunft auf demselben Port (mit dem Schluessel des
 *   Betreibers – ueber sein Profil die Zahladresse).
 * - Flutschutz (seit B-3, Sammlung Neuordnung): Grenzen je Verbindung
 *   (Events, Abfragen, offene Abos), je Schluessel (gespeicherte Events, mit
 *   Zugang das Zehnfache) und fuer die Zahl der Verbindungen – ueber den
 *   `RateLimiter` aus dem Protokoll, nach aussen nur feste Texte nach NIP-01
 *   (`rate-limited:`, `error:`). Umschlaege (1059) kommen von Wegwerf-
 *   Schluesseln; sie bremst die Grenze je Verbindung.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { KasseFehler, type RelayKasse, type Schiene } from "./relay-kasse.js";
import { WebSocketServer, WebSocket } from "ws";
import {
  ablaufVon, baueRelayInfo, brauchtAnmeldung, relayNimmtAn, darfAusliefern, ersetzSchluessel, hasValidEventShape, istFluechtig,
  istNeuer, pruefeRelayAuth, relayHost, verifyEvent, RateLimiter, type NostrEvent,
} from "@freedomstack/protocol";

export interface RelayConfig {
  port: number;
  retentionDays: number;
  maxEventBytes: number;
  /** Oeffentliche Adresse (NIP-42 prueft den Host); ohne sie nur der Host der Verbindung. */
  oeffentlicheUrl?: string;
  /** Schluessel des Betreibers fuer NIP-11. */
  pubkey?: string;
  /** Nur von und an Schluessel mit Zugang (8.4). */
  beschraenkt?: boolean;
  /** Umschlaege nur an angemeldete Empfaenger; Standard: wenn beschraenkt. */
  umschlaegeSchuetzen?: boolean;
  zugang?: RelayZugang;
  /** Zugang kaufen (8.4b) – ueber `POST /zugang` auf demselben Port. */
  kasse?: RelayKasse;
  /** Events ueberdauern einen Neustart (8.4b): hier abgelegt, jede Minute und beim Beenden. */
  eventDatei?: string;
  /** Hoechstens so viele Events; darueber lehnt der Relay ab statt still zu verdraengen. */
  maxEvents?: number;
  /** Flutschutz (B-3); fehlende Werte aus `FLUTSCHUTZ`. */
  flutschutz?: Partial<Flutschutz>;
  /** Unix-Sekunden (Tests). */
  jetzt?: () => number;
}

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_ANTWORT = 5000;

/**
 * Grenzen des Flutschutzes (B-3), je Minute. Grosszuegig fuer echte Nutzung –
 * ein Anhang oder Git-Bundle geht in Stuecken hinaus, viele Events in kurzer
 * Zeit –, eng genug, dass ein Einzelner den Relay nicht beschaeftigt haelt.
 */
export const FLUTSCHUTZ = {
  /** EVENT-Nachrichten je Verbindung. */
  eventsJeVerbindung: 600,
  /** REQ- und AUTH-Nachrichten je Verbindung. */
  abfragenJeVerbindung: 300,
  /** Gespeicherte Events je Schluessel (mit Zugang das Zehnfache). */
  eventsJeSchluessel: 600,
  /** Offene Abos je Verbindung. */
  abosJeVerbindung: 100,
  /** Gleichzeitige Verbindungen. */
  verbindungen: 1000,
} as const;
export type Flutschutz = { -readonly [K in keyof typeof FLUTSCHUTZ]: number };
const FLUT_FENSTER_SECS = 60;
/** Close-Code „Try Again Later“ (RFC 6455, IANA). */
const ZU_VIELE_VERBINDUNGEN = 1013;

/**
 * Wer Zugang hat: dauerhaft (Betreiber, Freunde – `RELAY_ZUGANG`) oder bis zu
 * einem Zeitpunkt (bezahlt, ab 8.4b). Liegt in einer Datei des Betreibers.
 */
export class RelayZugang {
  private bis = new Map<string, number>();
  private schreiben = Promise.resolve();

  constructor(private datei?: string, private dauerhaft: readonly string[] = []) {}

  async laden(): Promise<void> {
    if (!this.datei) return;
    let roh: unknown;
    try {
      roh = JSON.parse(await readFile(this.datei, "utf8"));
    } catch {
      return; // noch keine Datei
    }
    if (typeof roh !== "object" || roh === null) return;
    for (const [pk, bis] of Object.entries(roh)) if (HEX64.test(pk) && Number.isSafeInteger(bis)) this.bis.set(pk, bis as number);
  }

  hat(pubkey: string, jetzt: number): boolean {
    return this.dauerhaft.includes(pubkey) || (this.bis.get(pubkey) ?? 0) > jetzt;
  }

  /** Zugang verlaengern (ab dem Ende des laufenden); Ergebnis: bis wann. */
  async gewaehre(pubkey: string, sekunden: number, jetzt: number): Promise<number> {
    if (!HEX64.test(pubkey) || !Number.isSafeInteger(sekunden) || sekunden <= 0) throw new Error("ungueltiger Zugang");
    const bis = Math.max(jetzt, this.bis.get(pubkey) ?? 0) + sekunden;
    this.bis.set(pubkey, bis);
    const datei = this.datei;
    if (datei) {
      // nacheinander – zwei Zahlungen zugleich schrieben sonst dieselbe tmp-Datei
      this.schreiben = this.schreiben.catch(() => {}).then(async () => {
        await writeFile(`${datei}.tmp`, JSON.stringify(Object.fromEntries(this.bis)), { mode: 0o600 });
        await rename(`${datei}.tmp`, datei);
      });
      await this.schreiben;
    }
    return bis;
  }
}

interface Verbindung {
  /** Zufaellige Kennung – nur fuer den Flutschutz, nie nach aussen. */
  id: string;
  challenge: string;
  hosts: string[];
  angemeldet: Set<string>;
  abos: Map<string, Record<string, unknown>[]>;
}

export class RelayRole {
  private events = new Map<string, { ev: NostrEvent; seit: number }>();
  /** Ersetzbare Events: Schluessel -> Id der neuesten Fassung. */
  private neueste = new Map<string, string>();
  private verbindungen = new Map<WebSocket, Verbindung>();
  private http?: Server;
  private wss?: WebSocketServer;
  private putzer?: NodeJS.Timeout;
  private sicherer?: NodeJS.Timeout;
  private geaendert = false;
  private readonly zugang: RelayZugang;
  private readonly schuetzen: boolean;
  private readonly jetzt: () => number;
  private readonly flut: Flutschutz;
  private readonly eventsJeVerbindung: RateLimiter;
  private readonly abfragenJeVerbindung: RateLimiter;
  private readonly eventsJeSchluessel: RateLimiter;
  private gedrosselt = 0;

  constructor(private cfg: RelayConfig) {
    this.zugang = cfg.zugang ?? new RelayZugang();
    this.schuetzen = cfg.beschraenkt === true || cfg.umschlaegeSchuetzen === true;
    this.jetzt = cfg.jetzt ?? (() => Math.floor(Date.now() / 1000));
    this.flut = { ...FLUTSCHUTZ, ...cfg.flutschutz };
    const grenze = (maxPerWindow: number) => new RateLimiter({ maxPerWindow, windowSecs: FLUT_FENSTER_SECS, paidMultiplier: 10 });
    this.eventsJeVerbindung = grenze(this.flut.eventsJeVerbindung);
    this.abfragenJeVerbindung = grenze(this.flut.abfragenJeVerbindung);
    this.eventsJeSchluessel = grenze(this.flut.eventsJeSchluessel);
  }

  async start(): Promise<void> {
    this.ladeEvents();
    // Ein Fehler beim Kaufen (etwa die Platte voll) darf den Knoten nicht beenden
    this.http = createServer((req, res) => this.beantworte(req, res).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }));
    this.wss = new WebSocketServer({ server: this.http, maxPayload: Math.max(2 * this.cfg.maxEventBytes, 65_536) });
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      if (this.verbindungen.size >= this.flut.verbindungen) {
        this.gedrosselt++;
        return ws.close(ZU_VIELE_VERBINDUNGEN, "zu viele Verbindungen");
      }
      const v: Verbindung = {
        id: randomBytes(8).toString("hex"),
        challenge: randomBytes(16).toString("hex"),
        // Mit oeffentlicher Adresse nur sie: Der Host-Kopf kommt vom Client – ein fremder
        // Relay koennte sonst unsere Challenge durchreichen und als Mittelsmann anmelden.
        hosts: [relayHost(this.cfg.oeffentlicheUrl ?? "") ?? relayHost(`ws://${req.headers.host ?? ""}`)].filter((h): h is string => !!h),
        angemeldet: new Set(),
        abos: new Map(),
      };
      this.verbindungen.set(ws, v);
      this.reply(ws, ["AUTH", v.challenge]);
      ws.on("message", (raw: unknown) => this.handleMessage(ws, v, String(raw)));
      ws.on("close", () => this.verbindungen.delete(ws));
    });
    await new Promise<void>((ok) => this.http!.listen(this.cfg.port, ok));
    this.putzer = setInterval(() => this.aufraeumen(), 10 * 60_000);
    this.putzer.unref();
    if (this.cfg.eventDatei) {
      this.sicherer = setInterval(() => this.sichereEvents(), 60_000);
      this.sicherer.unref();
    }
    console.log(
      `Relay-Rolle aktiv: ws://0.0.0.0:${this.cfg.port} (retention ${this.cfg.retentionDays}d` +
      `${this.cfg.beschraenkt ? ", nur mit Zugang" : ""}${this.schuetzen ? ", Umschlaege nur an Angemeldete" : ""})`,
    );
  }

  stop(): void {
    clearInterval(this.putzer);
    clearInterval(this.sicherer);
    this.sichereEvents();
    for (const ws of this.verbindungen.keys()) ws.terminate();
    this.wss?.close();
    this.http?.close();
  }

  /** NIP-11 und Zugang kaufen auf demselben Port; sonst ein kurzer Hinweis. */
  private async beantworte(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const pfad = (req.url ?? "/").split("?")[0];
    if (req.method === "POST" && /^\/zugang(\/[0-9a-f]{32})?$/.test(pfad)) return this.kauf(req, res, pfad.slice("/zugang/".length));
    if (req.method === "GET" && /application\/nostr\+json/.test(req.headers.accept ?? "")) {
      res.setHeader("Content-Type", "application/nostr+json");
      const kasse = this.cfg.kasse && this.cfg.kasse.schienen().length > 0 ? this.cfg.kasse : undefined;
      res.end(JSON.stringify(baueRelayInfo({
        name: "Freedom-Relay",
        beschreibung: "Relay-Rolle eines FreedomStack-Knotens",
        pubkey: this.cfg.pubkey ?? "",
        maxNachricht: this.cfg.maxEventBytes,
        aufbewahrungTage: this.cfg.retentionDays,
        beschraenkt: this.cfg.beschraenkt === true,
        umschlaegeGeschuetzt: this.schuetzen,
        kauf: kasse ? { ...kasse.preise(), url: `${this.httpBasis(req)}/zugang` } : undefined,
      })));
      return;
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Freedom-Relay – mit einem Nostr-Client verbinden.\n");
  }

  /** Oeffentliche HTTP-Adresse dieses Relays (fuer `payments_url`). */
  private httpBasis(req: IncomingMessage): string {
    const u = this.cfg.oeffentlicheUrl;
    if (u && relayHost(u)) return u.replace(/^ws/, "http").replace(/\/+$/, "");
    return `http://${req.headers.host ?? "localhost"}`;
  }

  /**
   * `POST /zugang` {pubkey, schiene} → Angebot; `POST /zugang/<id>` {signatur?}
   * → bezahlt oder nicht. Nur feste Texte, nie Meldungen von LND oder vom RPC.
   */
  private async kauf(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const antworte = (status: number, daten: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(daten));
    };
    const kasse = this.cfg.kasse;
    if (!kasse || kasse.schienen().length === 0) return antworte(404, { fehler: "Dieser Relay verkauft keinen Zugang" });
    const stuecke: Buffer[] = [];
    let laenge = 0;
    for await (const stueck of req) {
      stuecke.push(stueck as Buffer);
      laenge += (stueck as Buffer).length;
      if (laenge > 4096) return antworte(413, { fehler: "Anfrage zu groß" });
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(stuecke).toString("utf8") || "{}") as Record<string, unknown>;
      if (typeof body !== "object" || body === null) throw new Error();
    } catch {
      return antworte(400, { fehler: "Kein JSON" });
    }
    if (!id) {
      if (body.schiene !== "lightning" && body.schiene !== "solana") return antworte(400, { fehler: "Schiene: lightning oder solana" });
      try {
        return antworte(200, await kasse.angebot(String(body.pubkey ?? ""), body.schiene as Schiene));
      } catch (e) {
        return antworte(400, { fehler: e instanceof KasseFehler ? e.message : "Angebot konnte nicht erstellt werden" });
      }
    }
    return antworte(200, await kasse.pruefe(id, typeof body.signatur === "string" ? body.signatur : undefined));
  }

  private ladeEvents(): void {
    if (!this.cfg.eventDatei) return;
    let l: unknown;
    try {
      l = JSON.parse(readFileSync(this.cfg.eventDatei, "utf8"));
    } catch {
      return; // noch keine Datei
    }
    for (const x of Array.isArray(l) ? l : []) {
      const { ev, seit } = (x ?? {}) as { ev?: unknown; seit?: unknown };
      if (!hasValidEventShape(ev) || !Number.isSafeInteger(seit) || !verifyEvent(ev)) continue;
      this.speichere(ev, seit as number);
    }
    this.geaendert = false;
    const weg = this.aufraeumen();
    console.log(`[relay] ${this.events.size} Events geladen${weg ? `, ${weg} abgelaufen` : ""}`);
  }

  private sichereEvents(): void {
    const datei = this.cfg.eventDatei;
    if (!datei || !this.geaendert) return;
    try {
      writeFileSync(`${datei}.tmp`, JSON.stringify([...this.events.values()]), { mode: 0o600 });
      renameSync(`${datei}.tmp`, datei);
      this.geaendert = false;
    } catch (e) {
      console.warn(`[relay] Events nicht gesichert: ${(e as Error).name}`);
    }
  }

  private handleMessage(ws: WebSocket, v: Verbindung, raw: string): void {
    let msg: unknown[];
    try { msg = JSON.parse(raw); } catch { return this.notice(ws, "parse error"); }
    if (!Array.isArray(msg)) return this.notice(ws, "invalid message");
    const [type] = msg as [string];

    if (type === "EVENT") {
      if (!this.darf(this.eventsJeVerbindung, v.id)) return this.reply(ws, ["OK", eventId(msg[1]), false, "rate-limited: zu viele Events – später erneut versuchen"]);
      return this.nimmAn(ws, msg[1]);
    }

    if (type === "AUTH") {
      const ev = msg[1];
      const id = hasValidEventShape(ev) ? ev.id : "";
      if (!this.darf(this.abfragenJeVerbindung, v.id)) return this.reply(ws, ["OK", id, false, "rate-limited: zu viele Anmeldungen – später erneut versuchen"]);
      const r = pruefeRelayAuth(ev, { challenge: v.challenge, hosts: v.hosts, jetzt: this.jetzt() });
      if (!r.ok) return this.reply(ws, ["OK", id, false, `invalid: ${r.grund}`]);
      v.angemeldet.add(r.pubkey);
      return this.reply(ws, ["OK", id, true, ""]);
    }

    if (type === "REQ") {
      const subId = msg[1];
      if (typeof subId !== "string" || subId.length === 0 || subId.length > 64) return this.notice(ws, "invalid: subscription id");
      if (!this.darf(this.abfragenJeVerbindung, v.id)) return this.reply(ws, ["CLOSED", subId, "rate-limited: zu viele Abfragen – später erneut versuchen"]);
      if (!v.abos.has(subId) && v.abos.size >= this.flut.abosJeVerbindung) {
        this.gedrosselt++;
        return this.reply(ws, ["CLOSED", subId, "error: zu viele offene Abos – erst eines schließen"]);
      }
      const filters = msg.slice(2).filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null && !Array.isArray(f));
      if (filters.some((f) => brauchtAnmeldung(f, v.angemeldet, this.schuetzen))) {
        return this.reply(ws, ["CLOSED", subId, "auth-required: Umschläge nur an den angemeldeten Empfänger"]);
      }
      v.abos.set(subId, filters);
      for (const ev of this.gespeichert(filters, v)) this.reply(ws, ["EVENT", subId, ev]);
      this.reply(ws, ["EOSE", subId]);
      return;
    }

    if (type === "CLOSE") {
      v.abos.delete(String(msg[1]));
      return;
    }

    this.notice(ws, `unknown type: ${String(type)}`);
  }

  /** Innerhalb der Grenze? Sonst gezaehlt (fuer `stats()`). */
  private darf(grenze: RateLimiter, schluessel: string, mitZugang = false): boolean {
    if (grenze.check(schluessel, mitZugang, this.jetzt()).allowed) return true;
    this.gedrosselt++;
    return false;
  }

  private nimmAn(ws: WebSocket, ev: unknown): void {
    const id = eventId(ev);
    if (!hasValidEventShape(ev)) return this.reply(ws, ["OK", id, false, "invalid: kein Event nach NIP-01"]);
    if (JSON.stringify(ev).length > this.cfg.maxEventBytes) return this.reply(ws, ["OK", ev.id, false, "too large"]);
    if (!verifyEvent(ev)) return this.reply(ws, ["OK", ev.id, false, "invalid signature"]);
    const jetzt = this.jetzt();
    const zul = relayNimmtAn(ev, { beschraenkt: this.cfg.beschraenkt === true, hatZugang: (pk) => this.zugang.hat(pk, jetzt) });
    if (!zul.ok) return this.reply(ws, ["OK", ev.id, false, zul.grund]);
    const ablauf = ablaufVon(ev);
    if (ablauf !== null && ablauf <= jetzt) return this.reply(ws, ["OK", ev.id, false, "invalid: abgelaufen (NIP-40)"]);
    if (!istFluechtig(ev.kind) && !this.events.has(ev.id) && !this.darf(this.eventsJeSchluessel, ev.pubkey, this.zugang.hat(ev.pubkey, jetzt))) {
      return this.reply(ws, ["OK", ev.id, false, "rate-limited: zu viele Events von diesem Schlüssel – später erneut versuchen"]);
    }
    if (istFluechtig(ev.kind)) {
      this.reply(ws, ["OK", ev.id, true, ""]);
      return this.verteile(ev);
    }
    if (this.events.size >= (this.cfg.maxEvents ?? 100_000) && !this.events.has(ev.id) && !ersetzSchluessel(ev)) {
      return this.reply(ws, ["OK", ev.id, false, "error: Relay voll – später erneut versuchen"]);
    }
    const s = this.speichere(ev, jetzt);
    this.reply(ws, ["OK", ev.id, true, s === "neu" ? "" : s === "doppelt" ? "duplicate: schon vorhanden" : "duplicate: neuere Fassung liegt vor"]);
    if (s === "neu") this.verteile(ev);
  }

  private speichere(ev: NostrEvent, jetzt: number): "neu" | "doppelt" | "veraltet" {
    if (this.events.has(ev.id)) return "doppelt";
    const schluessel = ersetzSchluessel(ev);
    if (schluessel) {
      const altId = this.neueste.get(schluessel);
      const alt = altId ? this.events.get(altId)?.ev : undefined;
      if (alt && !istNeuer(ev, alt)) return "veraltet";
      if (altId) this.events.delete(altId);
      this.neueste.set(schluessel, ev.id);
    }
    this.events.set(ev.id, { ev, seit: jetzt });
    this.geaendert = true;
    return "neu";
  }

  private verteile(ev: NostrEvent): void {
    for (const [ws, v] of this.verbindungen) {
      if (ws.readyState !== WebSocket.OPEN || !darfAusliefern(ev, v.angemeldet, this.schuetzen)) continue;
      for (const [subId, filters] of v.abos) if (this.matchesAny(filters, ev)) this.reply(ws, ["EVENT", subId, ev]);
    }
  }

  /** Gespeicherte Treffer: je Filter die neuesten bis `limit`, zusammen hoechstens 5000. */
  private gespeichert(filters: Record<string, unknown>[], v: Verbindung): NostrEvent[] {
    const jetzt = this.jetzt();
    const alle = [...this.events.values()]
      .map((x) => x.ev)
      .filter((ev) => { const a = ablaufVon(ev); return a === null || a > jetzt; })
      .filter((ev) => darfAusliefern(ev, v.angemeldet, this.schuetzen))
      .sort((a, b) => b.created_at - a.created_at);
    const treffer = new Map<string, NostrEvent>();
    for (const f of filters) {
      const limit = Number.isSafeInteger(f.limit) && (f.limit as number) >= 0 ? Math.min(f.limit as number, MAX_ANTWORT) : MAX_ANTWORT;
      let n = 0;
      for (const ev of alle) {
        if (n >= limit) break;
        if (this.matches(f, ev)) { treffer.set(ev.id, ev); n++; }
      }
    }
    return [...treffer.values()].sort((a, b) => b.created_at - a.created_at).slice(0, MAX_ANTWORT);
  }

  /** Abgelaufenes (NIP-40) und nach der Aufbewahrungszeit Eingegangenes entfernen – ersetzbare in neuester Fassung bleiben. */
  aufraeumen(): number {
    const jetzt = this.jetzt();
    // Flutschutz: abgelaufene Zaehlstaende weg, sonst wachsen die Karten mit jedem Wegwerf-Schluessel
    for (const g of [this.eventsJeVerbindung, this.abfragenJeVerbindung, this.eventsJeSchluessel]) g.prune(jetzt);
    const grenze = jetzt - this.cfg.retentionDays * 86400;
    let weg = 0;
    for (const [id, { ev, seit }] of this.events) {
      const ablauf = ablaufVon(ev);
      const schluessel = ersetzSchluessel(ev);
      if ((ablauf !== null && ablauf <= jetzt) || (!schluessel && seit < grenze)) {
        this.events.delete(id);
        if (schluessel && this.neueste.get(schluessel) === id) this.neueste.delete(schluessel);
        this.geaendert = true;
        weg++;
      }
    }
    return weg;
  }

  private matchesAny(filters: Record<string, unknown>[], ev: NostrEvent): boolean {
    return filters.some((f) => this.matches(f, ev));
  }

  private matches(f: Record<string, unknown>, ev: NostrEvent): boolean {
    if (Array.isArray(f.ids) && !f.ids.includes(ev.id)) return false;
    if (Array.isArray(f.authors) && !f.authors.includes(ev.pubkey)) return false;
    if (Array.isArray(f.kinds) && !f.kinds.includes(ev.kind)) return false;
    if (typeof f.since === "number" && ev.created_at < f.since) return false;
    if (typeof f.until === "number" && ev.created_at > f.until) return false;
    // tag-filter (#e, #p, #d, #blob ...)
    for (const [key, vals] of Object.entries(f)) {
      if (!key.startsWith("#") || !Array.isArray(vals)) continue;
      const tagName = key.slice(1);
      const evVals = ev.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
      if (!vals.some((w) => evVals.includes(w))) return false;
    }
    return true;
  }

  private reply(ws: WebSocket, msg: unknown[]): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  private notice(ws: WebSocket, msg: string): void {
    this.reply(ws, ["NOTICE", msg]);
  }

  stats(): { events: number; subscriptions: number; verbindungen: number; gedrosselt: number } {
    let abos = 0;
    for (const v of this.verbindungen.values()) abos += v.abos.size;
    return { events: this.events.size, subscriptions: abos, verbindungen: this.verbindungen.size, gedrosselt: this.gedrosselt };
  }
}

/** Die Kennung eines (vielleicht kaputten) Events fuer die OK-Antwort. */
function eventId(ev: unknown): string {
  return typeof ev === "object" && ev !== null && typeof (ev as { id?: unknown }).id === "string" ? (ev as { id: string }).id : "?";
}
