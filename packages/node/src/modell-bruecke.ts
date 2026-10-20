/**
 * Brücke zum Modell für den Motor in der Sandbox (VKc3, `docs/VIBECODEN-ENTWURF.md`, „Seit VKb“): Die Sandbox hat
 * kein Netz. Der Knoten öffnet einen Unix-Socket in einem eigenen Ordner (0700), den die Sandbox nur lesbar
 * einbindet (`/bruecke`); dahinter liegt nur das Modell des Knotens – `GET /v1/models` und
 * `POST /v1/chat/completions` an den KI-Antrieb (`ki-antrieb.ts`), nie eine andere Adresse, nie ein anderer Pfad.
 * Wie die Proxy-Brücke von Codex – nie, indem die Sandbox das Netz des Rechners teilt. Seit VKd beantwortet sie dazu
 * `POST /mcp` im Knoten selbst (Freedom-MCP, `freedom-mcp.ts`) – Werkzeuge des Knotens, nie ein weiterer Weg nach draußen.
 * Seit VKd3 dazu `GET /npm/…` und `/pypi/…`: Pakete nur von der festen Liste der Registries (`paket-spiegel.ts`).
 *
 * Der Schlüssel des Antriebs (`KI_SCHLUESSEL`) kommt erst hier dazu; Kopfzeilen aus der Sandbox gehen nicht
 * weiter. Was durchfließt, sind Fragen und Antworten des eigenen Projekts: nie ins Log, Fehler nach außen nur
 * mit festen Texten.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { antriebKopf, type KiAntrieb } from "./ki-antrieb.js";

export const BRUECKE_GRENZEN = {
  /** Größte Anfrage aus der Sandbox (Verlauf eines langen Laufs samt Ausgaben). */
  anfrageBytes: 16 * 1024 * 1024,
  /** Größte Nachricht an Freedom-MCP. */
  mcpBytes: 1024 * 1024,
  /** Eine Antwort des Modells darf so lange dauern – lokale Modelle sind langsam. */
  antwortMs: 15 * 60_000,
} as const;

/** Wo der Socket in der Sandbox liegt und unter welchem Port der Motor ihn dort sieht (`freedom_motor.py`). */
export const BRUECKE_IN_SANDBOX = { ordner: "/bruecke", sockel: "/bruecke/modell.sock", port: 8080 } as const;

export interface ModellBruecke {
  /** Ordner mit dem Socket – nur lesbar in die Sandbox einbinden. */
  ordner: string;
  sockel: string;
  schliesse(): void;
}

/** Ziel einer Anfrage aus der Sandbox – nur zwei Wege, sonst null. */
export function brueckenZiel(antrieb: Pick<KiAntrieb, "art" | "url">, methode: string | undefined, pfad: string | undefined): string | null {
  const basis = antrieb.art === "ollama" ? `${antrieb.url}/v1` : antrieb.url;
  if (methode === "GET" && pfad === "/v1/models") return `${basis}/models`;
  if (methode === "POST" && pfad === "/v1/chat/completions") return `${basis}/chat/completions`;
  return null;
}

function absage(res: ServerResponse, status: number): void {
  if (res.headersSent) return void res.destroy();
  const text = status === 413 ? "zu gross" : status === 404 ? "nicht hier" : status === 405 ? "nur POST" : status === 400 ? "kein JSON" : "Modell nicht erreichbar";
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close", ...(status === 405 ? { allow: "POST" } : {}) }).end(text);
}

/** Freedom-MCP (VKd): eine Nachricht, eine Antwort als JSON – Benachrichtigungen 202, kein Strom vom Server (GET 405). */
async function beantworteMcp(req: IncomingMessage, res: ServerResponse, mcp: (nachricht: unknown) => Promise<object | null>): Promise<void> {
  if (req.method !== "POST") {
    req.resume();
    return absage(res, 405);
  }
  const koerper = await leseKoerper(req, BRUECKE_GRENZEN.mcpBytes);
  if (koerper === null) return absage(res, 413);
  let nachricht: unknown;
  try {
    nachricht = JSON.parse(koerper.toString("utf8"));
  } catch {
    return absage(res, 400);
  }
  const a = await mcp(nachricht);
  if (a === null) return void res.writeHead(202).end();
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(a));
}

/** Anfrage lesen – höchstens `grenze` Byte, sonst null. */
function leseKoerper(req: IncomingMessage, grenze: number = BRUECKE_GRENZEN.anfrageBytes): Promise<Buffer | null> {
  return new Promise((fertig) => {
    const teile: Buffer[] = [];
    let n = 0;
    req.on("data", (b: Buffer) => {
      n += b.length;
      // darüber nichts mehr behalten, den Rest nur ablaufen lassen – die Absage geht sofort hinaus
      if (n > grenze) return void fertig(null);
      teile.push(b);
    });
    req.on("end", () => fertig(Buffer.concat(teile)));
    req.on("error", () => fertig(null));
  });
}

/** Brücke öffnen – ein Socket für alle Läufe des Knotens; `schliesse()` beim Ende des Knotens. */
export async function oeffneModellBruecke(antrieb: KiAntrieb, o: {
  fetchImpl?: typeof fetch; mcp?: (nachricht: unknown) => Promise<object | null>;
  /** Pakete (VKd3): `/npm/…` und `/pypi/…` an den Spiegel – ohne ihn 404 wie jeder andere Weg. */
  spiegel?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} = {}): Promise<ModellBruecke> {
  const holen = o.fetchImpl ?? ((i: string | URL | Request, init?: RequestInit) => fetch(i, init));
  const ordner = mkdtempSync(join(tmpdir(), "freedom-bruecke-"));
  const sockel = join(ordner, "modell.sock");
  const server = createServer(async (req, res) => {
    if (o.mcp && req.url === "/mcp") return beantworteMcp(req, res, o.mcp).catch(() => absage(res, 502));
    if (o.spiegel && /^\/(?:npm|pypi)\//.test(req.url ?? "")) return o.spiegel(req, res).catch(() => absage(res, 502));
    const ziel = brueckenZiel(antrieb, req.method, req.url);
    if (!ziel) {
      req.resume();
      return absage(res, 404);
    }
    const koerper = req.method === "POST" ? await leseKoerper(req) : Buffer.alloc(0);
    if (koerper === null) return absage(res, 413);
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), BRUECKE_GRENZEN.antwortMs);
    res.on("close", () => abbruch.abort());
    try {
      const antwort = await holen(ziel, {
        method: req.method,
        headers: { ...(req.method === "POST" ? { "content-type": "application/json" } : {}), accept: "application/json, text/event-stream", ...antriebKopf(antrieb) },
        ...(req.method === "POST" ? { body: new Uint8Array(koerper) } : {}),
        redirect: "manual",
        signal: abbruch.signal,
      });
      res.writeHead(antwort.status, { "content-type": antwort.headers.get("content-type") ?? "application/json" });
      if (!antwort.body) return void res.end();
      Readable.fromWeb(antwort.body as import("node:stream/web").ReadableStream<Uint8Array>).on("error", () => res.destroy()).pipe(res);
    } catch {
      absage(res, 502);
    } finally {
      clearTimeout(uhr);
    }
  });
  server.requestTimeout = 0;
  await new Promise<void>((fertig, scheitern) => {
    server.once("error", scheitern);
    server.listen(sockel, () => fertig());
  });
  let zu = false;
  return {
    ordner, sockel,
    schliesse: () => {
      if (zu) return;
      zu = true;
      server.closeAllConnections();
      server.close();
      rmSync(ordner, { recursive: true, force: true });
    },
  };
}
