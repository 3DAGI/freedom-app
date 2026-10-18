/**
 * MCP-Client im Knoten (B-31, Entscheidung MC1-Größe B vom 18.10.2026): schlank und ohne Abhängigkeit statt des SDK
 * (29 MB, 95 Pakete). Der Knoten spricht MCP über stdio – JSON-RPC 2.0, eine Nachricht je Zeile – mit Servern, die nur in
 * der Sandbox laufen (`sandboxMotor()`, VKb): `initialize`, `notifications/initialized`, `tools/list`, `tools/call`.
 *
 * - Welche Server, sagt nur der Betreiber: `~/.freedom/mcp.json` (`mcpAusDatei()`). Sie laufen ohne Netz; was sie
 *   brauchen (etwa ZIM-Dateien für Kiwix), kommt nur lesbar hinein – nie die Wurzel, das Home oder ein Ordner darüber.
 * - Das Modell sieht ihre Werkzeuge als `mcp__<server>__<werkzeug>` (`McpWerkzeuge.schemas()`), in den Grenzen jedes
 *   Werkzeugs (`WERKZEUG_GRENZEN`): Eingabe als JSON höchstens `eingabeZeichen`, Zeit `zeitMs`, Ausgabe gekürzt.
 * - Was durchfließt, ist Inhalt einer KI-Anfrage: nie ins Log (Kein Klartext im Knoten). Fehler nach außen nur feste
 *   Texte, ins Log nur Fehlernamen.
 */
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type { Stream } from "@agentclientprotocol/sdk";
import { MCP_FASSUNGEN } from "./freedom-mcp.js";
import { sandboxMotor } from "./sandbox.js";
import { WERKZEUG_GRENZEN } from "./tools.js";

/** Grenzen des Clients. */
export const MCP_CLIENT_GRENZEN = {
  /** Server je Knoten. */
  server: 4,
  /** Werkzeuge je Server (mehr verwirren das Modell und füllen den Kontext). */
  werkzeuge: 32,
  /** Seiten von `tools/list`. */
  seiten: 8,
  /** Zeit für `initialize` und `tools/list`. */
  startMs: 30_000,
  /** Beschreibung eines Werkzeugs, wie das Modell sie sieht. */
  beschreibung: 1000,
  /** Das Eingabe-Schema eines Werkzeugs als JSON. */
  schemaZeichen: 4000,
  /** Name fürs Modell (`mcp__<server>__<werkzeug>`) – OpenAI-kompatible Dienste nehmen höchstens 64 Zeichen. */
  nameZeichen: 64,
} as const;

/** Ein Server aus `mcp.json`. */
export interface McpServerEinstellung {
  name: string;
  /** Programm und Argumente, wie die Sandbox sie sieht (absolut). */
  befehl: string[];
  /** Nur lesbar eingebunden, unter demselben Pfad. */
  nurLesbar: string[];
}

const NAME = /^[a-z][a-z0-9-]{0,19}$/;
/** Werkzeugnamen, wie Ollama und OpenAI-kompatible Dienste sie annehmen. */
const WERKZEUG = /^[A-Za-z0-9_-]{1,40}$/;

/** Die Datei des Betreibers. */
export function mcpDatei(heim = homedir()): string {
  return join(heim, ".freedom", "mcp.json");
}

/**
 * `mcp.json` lesen: `{ "server": { "<name>": { "befehl": ["/abs/programm", "arg"], "nurLesbar": ["/abs/ordner"] } } }`.
 * Keine Datei → keine Server. Eine kaputte oder unzulässige Datei → `ungueltig` (kein Start).
 */
export function mcpAusDatei(datei = mcpDatei(), heim = homedir()): { server: McpServerEinstellung[] } | { ungueltig: string } {
  if (!existsSync(datei)) return { server: [] };
  let roh: unknown;
  try {
    roh = JSON.parse(readFileSync(datei, "utf8"));
  } catch {
    return { ungueltig: "mcp.json ist kein JSON" };
  }
  const server = (roh as { server?: unknown })?.server;
  if (typeof server !== "object" || server === null || Array.isArray(server)) return { ungueltig: "mcp.json braucht ein Objekt „server“" };
  const eintraege = Object.entries(server as Record<string, unknown>);
  if (eintraege.length > MCP_CLIENT_GRENZEN.server) return { ungueltig: `mcp.json: höchstens ${MCP_CLIENT_GRENZEN.server} Server` };
  const aus: McpServerEinstellung[] = [];
  for (const [name, e] of eintraege) {
    if (!NAME.test(name)) return { ungueltig: "mcp.json: Servernamen nur aus a–z, 0–9 und -, höchstens 20 Zeichen" };
    const befehl = (e as { befehl?: unknown })?.befehl;
    const nurLesbar = (e as { nurLesbar?: unknown })?.nurLesbar ?? [];
    if (!Array.isArray(befehl) || befehl.length === 0 || befehl.length > 32 || befehl.some((t) => typeof t !== "string" || t === "" || t.includes("\0"))) {
      return { ungueltig: `mcp.json: „${name}“ braucht „befehl“ als Liste von Texten` };
    }
    if (!absolut(befehl[0])) return { ungueltig: `mcp.json: „${name}“ – das Programm muss ein absoluter Pfad sein` };
    if (!Array.isArray(nurLesbar) || nurLesbar.length > 8 || nurLesbar.some((p) => typeof p !== "string" || !absolut(p))) {
      return { ungueltig: `mcp.json: „${name}“ – „nurLesbar“ nur absolute Pfade` };
    }
    // eingebunden werden die Ordner aus nurLesbar und der des Programms (außerhalb von /usr)
    const ordner = [...(nurLesbar as string[]), ...((befehl[0] as string).startsWith("/usr/") ? [] : [dirname(befehl[0] as string)])];
    if (ordner.some((p) => zuWeit(p, heim) || zuWeitEcht(p, heim))) return { ungueltig: `mcp.json: „${name}“ – nie die Wurzel, das Home oder ~/.freedom einbinden` };
    aus.push({ name, befehl: befehl as string[], nurLesbar: nurLesbar as string[] });
  }
  return { server: aus };
}

/** Die Wurzel, das Home, ein Ordner darüber oder ~/.freedom (samt Inhalt) – darin läge der Schlüssel des Knotens. */
function zuWeit(p: string, heim: string): boolean {
  const freedom = join(heim, ".freedom");
  return p === "/" || p === heim || heim.startsWith(`${p}/`) || p === freedom || p.startsWith(`${freedom}/`);
}

/** Dasselbe nach Auflösen der Verweise – `/opt/zim` als Verweis auf `~/.freedom` bände sonst den Schlüssel ein. */
function zuWeitEcht(p: string, heim: string): boolean {
  if (!existsSync(p)) return false;
  let echtesHeim = heim;
  try { echtesHeim = realpathSync(heim); } catch { /* Home gibt es nicht – bleibt beim Namen */ }
  return zuWeit(realpathSync(p), echtesHeim);
}

function absolut(p: string): boolean {
  return isAbsolute(p) && normalize(p) === p && !p.includes("\0");
}

/** Ein Werkzeug eines Servers, wie es der Client gelesen hat. */
export interface McpWerkzeug {
  name: string;
  beschreibung: string;
  schema: Record<string, unknown>;
}

type Offen = { fertig: (v: unknown) => void; fehler: (e: Error) => void; uhr: ReturnType<typeof setTimeout> };

/** Eine Verbindung zu einem Server über einen Strom von JSON-Nachrichten (aus `sandboxMotor()`). */
export class McpVerbindung {
  private nr = 0;
  private offen = new Map<number, Offen>();
  private schreiber: WritableStreamDefaultWriter<unknown>;
  private zu = false;

  constructor(strom: Stream, private ende: () => void) {
    this.schreiber = strom.writable.getWriter() as WritableStreamDefaultWriter<unknown>;
    void this.lies(strom.readable.getReader() as ReadableStreamDefaultReader<unknown>);
  }

  get lebt(): boolean { return !this.zu; }

  private async lies(leser: ReadableStreamDefaultReader<unknown>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await leser.read();
        if (done) break;
        const m = value as { id?: unknown; method?: unknown; result?: unknown; error?: unknown };
        if (typeof m.method === "string") {
          // Anfragen des Servers (ping, sampling …): Der Client bietet keine Fähigkeiten an – nur ping beantworten
          if (m.id !== undefined) await this.sende({ jsonrpc: "2.0", id: m.id, ...(m.method === "ping" ? { result: {} } : { error: { code: -32601, message: "Method not found" } }) });
          continue;
        }
        if (typeof m.id !== "number") continue;
        const o = this.offen.get(m.id);
        if (!o) continue;
        this.offen.delete(m.id);
        clearTimeout(o.uhr);
        if (m.error !== undefined) o.fehler(Object.assign(new Error("MCP-Fehler"), { name: "McpFehler" }));
        else o.fertig(m.result);
      }
    } catch {
      /* Strom kaputt (zu große Nachricht, kein JSON) – wie Ende behandeln */
    }
    this.schliesse();
  }

  private async sende(m: unknown): Promise<void> {
    if (this.zu) throw Object.assign(new Error("Server beendet"), { name: "McpBeendet" });
    await this.schreiber.write(m);
  }

  /** Eine Anfrage mit Frist – nach `zeitMs` abgelehnt (`McpZeit`). */
  frage(method: string, params: Record<string, unknown>, zeitMs: number): Promise<unknown> {
    const id = ++this.nr;
    return new Promise((fertig, fehler) => {
      const uhr = setTimeout(() => {
        this.offen.delete(id);
        fehler(Object.assign(new Error("Zeit um"), { name: "McpZeit" }));
      }, zeitMs);
      this.offen.set(id, { fertig, fehler, uhr });
      this.sende({ jsonrpc: "2.0", id, method, params }).catch((e: Error) => {
        clearTimeout(uhr);
        this.offen.delete(id);
        fehler(e);
      });
    });
  }

  /** `initialize` und `notifications/initialized` – die Fassung muss eine sein, die auch Freedom-MCP spricht. */
  async starte(): Promise<void> {
    const r = (await this.frage("initialize", {
      protocolVersion: MCP_FASSUNGEN.at(-1), capabilities: {}, clientInfo: { name: "freedom-knoten", version: "1" },
    }, MCP_CLIENT_GRENZEN.startMs)) as { protocolVersion?: unknown } | undefined;
    if (!(MCP_FASSUNGEN as readonly unknown[]).includes(r?.protocolVersion)) throw Object.assign(new Error("Fassung unbekannt"), { name: "McpFassung" });
    await this.sende({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Alle Werkzeuge (`tools/list` mit Seiten), höchstens `werkzeuge`; Unbrauchbares bleibt weg. */
  async werkzeuge(): Promise<McpWerkzeug[]> {
    const aus: McpWerkzeug[] = [];
    let cursor: string | undefined;
    for (let s = 0; s < MCP_CLIENT_GRENZEN.seiten; s++) {
      const r = (await this.frage("tools/list", cursor ? { cursor } : {}, MCP_CLIENT_GRENZEN.startMs)) as { tools?: unknown; nextCursor?: unknown };
      for (const w of Array.isArray(r?.tools) ? r.tools : []) {
        const { name, description, inputSchema } = (w ?? {}) as { name?: unknown; description?: unknown; inputSchema?: unknown };
        if (typeof name !== "string" || !WERKZEUG.test(name)) continue;
        const schema = typeof inputSchema === "object" && inputSchema !== null && !Array.isArray(inputSchema) ? inputSchema as Record<string, unknown> : { type: "object" };
        if (JSON.stringify(schema).length > MCP_CLIENT_GRENZEN.schemaZeichen) continue;
        aus.push({ name, beschreibung: typeof description === "string" ? description.slice(0, MCP_CLIENT_GRENZEN.beschreibung) : "", schema });
        if (aus.length >= MCP_CLIENT_GRENZEN.werkzeuge) return aus;
      }
      if (typeof r?.nextCursor !== "string" || r.nextCursor === "") break;
      cursor = r.nextCursor;
    }
    return aus;
  }

  /** `tools/call` – Text der Teile; Bilder und andere Teile nur als Platzhalter. */
  async rufe(name: string, args: Record<string, unknown>, zeitMs: number): Promise<{ text: string; fehler: boolean }> {
    const r = (await this.frage("tools/call", { name, arguments: args }, zeitMs)) as { content?: unknown; isError?: unknown };
    const teile = Array.isArray(r?.content) ? r.content : [];
    const text = teile.map((t) => {
      const teil = (t ?? {}) as { type?: unknown; text?: unknown };
      return teil.type === "text" && typeof teil.text === "string" ? teil.text : `[${typeof teil.type === "string" ? teil.type.slice(0, 20) : "teil"}]`;
    }).join("\n");
    return { text, fehler: r?.isError === true };
  }

  schliesse(): void {
    if (this.zu) return;
    this.zu = true;
    for (const [, o] of this.offen) {
      clearTimeout(o.uhr);
      o.fehler(Object.assign(new Error("Server beendet"), { name: "McpBeendet" }));
    }
    this.offen.clear();
    this.ende();
  }
}

/** Ein Werkzeug, wie das Modell es bekommt (dieselbe Form wie die eingebauten in `inference.ts`). */
export interface McpSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * Die Werkzeuge aller Server für die Agenten-Schleife: `schemas()` für das Modell, `fuehreAus()` für einen Aufruf –
 * immer in den Grenzen aus `WERKZEUG_GRENZEN`, nach außen nur feste Texte bei Fehlern.
 */
export class McpWerkzeuge {
  private eintraege = new Map<string, { verbindung: McpVerbindung; werkzeug: McpWerkzeug }>();

  constructor(private grenzen: { zeitMs: number } = WERKZEUG_GRENZEN) {}

  /** Die Werkzeuge eines gestarteten Servers aufnehmen. */
  nimm(server: string, verbindung: McpVerbindung, werkzeuge: McpWerkzeug[]): void {
    for (const w of werkzeuge) {
      const name = `mcp__${server}__${w.name}`;
      if (name.length <= MCP_CLIENT_GRENZEN.nameZeichen) this.eintraege.set(name, { verbindung, werkzeug: w });
    }
  }

  get anzahl(): number { return this.eintraege.size; }

  schemas(): McpSchema[] {
    return [...this.eintraege].filter(([, e]) => e.verbindung.lebt).map(([name, e]) => ({
      type: "function", function: { name, description: e.werkzeug.beschreibung, parameters: e.werkzeug.schema },
    }));
  }

  kennt(name: string): boolean { return this.eintraege.has(name); }

  /** Ein Aufruf des Modells. Wirft nie: Fehler kommen als fester Text zurück. */
  async fuehreAus(name: string, args: Record<string, unknown>): Promise<string> {
    const e = this.eintraege.get(name);
    if (!e) return "Werkzeug unbekannt";
    if (JSON.stringify(args).length > WERKZEUG_GRENZEN.eingabeZeichen) return `Eingabe zu lang (höchstens ${WERKZEUG_GRENZEN.eingabeZeichen} Zeichen)`;
    if (!e.verbindung.lebt) return "Werkzeug nicht erreichbar";
    try {
      const r = await e.verbindung.rufe(e.werkzeug.name, args, this.grenzen.zeitMs);
      const text = r.text.slice(0, WERKZEUG_GRENZEN.ausgabeZeichen);
      return r.fehler ? `Fehler des Werkzeugs: ${text}` : text;
    } catch (f) {
      const n = (f as Error).name;
      return n === "McpZeit" ? `Zeitlimit ${Math.round(this.grenzen.zeitMs / 1000)} s überschritten` : "Werkzeug nicht erreichbar";
    }
  }

  schliesse(): void {
    for (const v of new Set([...this.eintraege.values()].map((e) => e.verbindung))) v.schliesse();
  }
}

/**
 * Einen Server in der Sandbox starten: Arbeitsordner leer im tmpfs, eigenes Home, nur lesbar, was `nurLesbar` nennt.
 * Wirft mit Namen (`McpZeit`, `McpFassung`, `McpBeendet`, `SandboxFehlt`), nie mit Text des Servers.
 */
export async function starteMcpServer(e: McpServerEinstellung, o: { bwrap?: string } = {}): Promise<{ verbindung: McpVerbindung; werkzeuge: McpWerkzeug[] }> {
  const arbeit = mkdtempSync(join(tmpdir(), `freedom-mcp-${e.name}-`));
  const start = sandboxMotor(e.befehl, {
    nurLesbar: [
      ...e.nurLesbar.map((p) => ({ quelle: p, ziel: p })),
      // ein Programm außerhalb von /usr sieht die Sandbox sonst nicht
      ...(e.befehl[0]!.startsWith("/usr/") ? [] : [{ quelle: dirname(e.befehl[0]!), ziel: dirname(e.befehl[0]!) }]),
    ].filter((b, i, alle) => alle.findIndex((x) => x.ziel === b.ziel) === i && existsSync(b.quelle) && !lstatSync(b.quelle).isSymbolicLink()),
    ...(o.bwrap ? { bwrap: o.bwrap } : {}),
  });
  const m = start(arbeit);
  const verbindung = new McpVerbindung(m.strom as Stream, () => {
    m.beende();
    rmSync(arbeit, { recursive: true, force: true });
  });
  try {
    await verbindung.starte();
    return { verbindung, werkzeuge: await verbindung.werkzeuge() };
  } catch (f) {
    verbindung.schliesse();
    throw f;
  }
}
