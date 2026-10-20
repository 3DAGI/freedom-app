/**
 * Vorschau wie bei Replit (VKg1a, Entscheidung VKg-W1 vom 18.10.2026, `docs/VIBECODEN-ENTWURF.md`):
 * Der Knoten liefert ein Projekt live über einen eigenen Port aus – im Browser des Besitzers echt
 * gerendert, durchklickbar, nach jeder Änderung des Agenten beim Neuladen auf dem neuen Stand.
 *
 * - **Eigener Ursprung:** nie der Port von Relay und App (`RELAY_PORT`) – sonst teilte die Vorschau
 *   den Ursprung mit freedom.html und käme an deren Speicher (Tresor).
 * - **Zugang nur über ein Zeichen:** je Projekt 32 Zufallsbyte, neu bei jedem Start. Die Adresse
 *   bekommt nur der Besitzer, versiegelt über die Code-Aktion `vorschau` (`adresse()`). Der erste
 *   Aufruf `/<zeichen>/` setzt ein Cookie (HttpOnly) und leitet auf `/` – so gehen auch Seiten mit
 *   Pfaden ab `/` (Vite, Godot-Export). Ohne bekanntes Zeichen: 404.
 * - **Nur lesen, nur im Projekt:** kein Name mit Punkt am Anfang (`.git`, `.env`), keine Verweise
 *   (jeder Teil des Pfads mit `lstat`, die Datei mit `O_NOFOLLOW`, unter Linux danach der echte Ort
 *   über `/proc/self/fd`) – der Agent schreibt im Projekt und könnte sonst auf `~/.freedom` zeigen.
 * - Wurzel: `dist/` oder `build/`, wenn dort eine `index.html` liegt, sonst das Projekt selbst. Pfade
 *   ohne Endung, die es nicht gibt, bekommen die `index.html` (Seiten mit eigenem Routing).
 *
 * Hat das Projekt einen Dev-Server (VKg1c, `dev-server.ts`: Skript `dev` in `package.json`), leitet die Vorschau jede
 * Anfrage dorthin weiter, auch WebSocket für Hot Reload – mit Host und Origin wie lokal und ohne das eigene Cookie.
 *
 * Nach außen nur feste Texte, ins Log nur Zahlen – Projektnamen und Pfade sind Inhalt.
 */
import { constants } from "node:fs";
import { lstat, open, readlink, realpath, type FileHandle } from "node:fs/promises";
import { createServer, request as httpAnfrage, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { extname, join, sep } from "node:path";
import { istProjektName, istVorschauAdresse } from "@freedomstack/protocol";
import type { ProjektAblage } from "./projekte.js";
import { DEV_PORT, type DevServer } from "./dev-server.js";

export const VORSCHAU_COOKIE = "freedom_vorschau";
/** Standard-Port der Vorschau – neben LNURL (3601) und Quota-API (3602). */
export const VORSCHAU_PORT = 3603;
const ZEICHEN = /^[0-9a-f]{64}$/;
/** Wurzeln, in dieser Reihenfolge: gebaute Seite vor den Quellen. */
const WURZELN = ["dist", "build", ""] as const;

const TYPEN: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".map": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".wasm": "application/wasm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
};

/** Gilt für jede Antwort: nichts erraten, nichts zwischenspeichern, keinen Verweis weitergeben. */
const KOPF = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

export interface VorschauEinstellung {
  /** Ursprung, unter dem der Besitzer die Vorschau erreicht (`VORSCHAU_URL`): Heimnetz, Domain oder `.onion`. */
  basis: string;
  port: number;
  /** Adresse, an die der Server sich bindet (`VORSCHAU_HOST`, Standard alle). */
  host: string;
}

/**
 * Aus der Umgebung (nur mit `VIBECODEN=1` gefragt): ohne `VORSCHAU_URL` keine Vorschau (null). Ungültig heißt
 * kein Start (`grund`) – wie bei den anderen Rollen. Der Port nie der von Relay und App.
 */
export function vorschauAusUmgebung(env: { VORSCHAU_URL?: string; VORSCHAU_PORT?: string; VORSCHAU_HOST?: string; RELAY_PORT?: string }):
  { einstellung?: VorschauEinstellung; grund?: string } | null {
  const roh = (env.VORSCHAU_URL ?? "").trim();
  if (roh === "") return null;
  let basis: string;
  try {
    const u = new URL(roh);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error();
    basis = u.origin;
  } catch {
    return { grund: "VORSCHAU_URL ist keine Adresse wie http://192.168.1.20:3603 (http oder https, ohne Pfad)" };
  }
  if (!istVorschauAdresse(`${basis}/${"0".repeat(64)}/`)) return { grund: "VORSCHAU_URL ist zu lang" };
  const portRoh = (env.VORSCHAU_PORT ?? "").trim();
  const port = portRoh === "" ? VORSCHAU_PORT : Number(portRoh);
  if (!/^\d{0,5}$/.test(portRoh) || !Number.isSafeInteger(port) || port < 1 || port > 65535) return { grund: "VORSCHAU_PORT ist kein Port" };
  if (port === Number(env.RELAY_PORT ?? 7777)) return { grund: "VORSCHAU_PORT ist der Port von Relay und App – die Vorschau braucht einen eigenen" };
  const host = (env.VORSCHAU_HOST ?? "").trim() || "0.0.0.0";
  return { einstellung: { basis, port, host } };
}

/**
 * Kopfzeilen für den Dev-Server (VKg1c): Host und Origin wie auf dem Rechner selbst – Vite lässt sonst nichts durch
 * (`allowedHosts`, Herkunft des WebSockets) –, ohne Referer und ohne das Cookie der Vorschau; andere Cookies der Seite bleiben.
 */
export function devKopf(kopf: IncomingHttpHeaders): Record<string, string | string[]> {
  const aus: Record<string, string | string[]> = {};
  for (const [k, w] of Object.entries(kopf)) {
    if (w === undefined || k === "host" || k === "origin" || k === "referer") continue;
    if (k === "cookie") {
      const rest = String(w).split(";").map((c) => c.trim()).filter((c) => c && !c.startsWith(`${VORSCHAU_COOKIE}=`)).join("; ");
      if (rest) aus.cookie = rest;
      continue;
    }
    aus[k] = w;
  }
  aus.host = `localhost:${DEV_PORT}`;
  if (kopf.origin) aus.origin = `http://localhost:${DEV_PORT}`;
  return aus;
}

/** Kurzer fester Text als Antwort – nie Pfade oder Meldungen des Systems. */
function text(res: ServerResponse, status: number, inhalt: string, kopf: Record<string, string> = {}): void {
  res.writeHead(status, { ...KOPF, "Content-Type": "text/plain; charset=utf-8", ...kopf });
  res.end(inhalt);
}

export class VorschauServer {
  private readonly zeichenJeProjekt = new Map<string, string>();
  private readonly projektJeZeichen = new Map<string, string>();
  private server?: Server;
  private dev?: Pick<DevServer, "sockel">;

  constructor(private readonly ablage: Pick<ProjektAblage, "ort">, readonly einstellung: VorschauEinstellung) {}

  /** Dev-Server nutzen (VKg1c) – nur, wenn die Sandbox geht; `main.ts` entscheidet. */
  nutzeDev(dev: Pick<DevServer, "sockel">): void {
    this.dev = dev;
  }

  /** Adresse der Vorschau eines Projekts – das Zeichen bleibt bis zum Neustart gleich. */
  adresse(projekt: string): string {
    if (!istProjektName(projekt)) throw new Error("Projektname ungültig");
    let z = this.zeichenJeProjekt.get(projekt);
    if (!z) {
      z = randomBytes(32).toString("hex");
      this.zeichenJeProjekt.set(projekt, z);
      this.projektJeZeichen.set(z, projekt);
    }
    return `${this.einstellung.basis}/${z}/`;
  }

  /** Lauscht auf dem Port; gibt den tatsächlichen Port zurück (Tests mit Port 0). */
  starte(): Promise<number> {
    const server = createServer((req, res) => {
      this.beantworte(req, res).catch(() => {
        if (!res.headersSent) text(res, 500, "Fehler");
        else res.destroy();
      });
    });
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, kopf: Buffer) => void this.upgrade(req, socket, kopf).catch(() => socket.destroy()));
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    this.server = server;
    return new Promise((ok, fehler) => {
      server.once("error", fehler);
      server.listen(this.einstellung.port, this.einstellung.host, () => {
        server.off("error", fehler);
        const a = server.address();
        ok(typeof a === "object" && a ? a.port : this.einstellung.port);
      });
    });
  }

  schliesse(): Promise<void> {
    return new Promise((ok) => (this.server ? this.server.close(() => ok()) : ok()));
  }

  private async beantworte(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const roh = req.url ?? "/";
    if (roh.length > 2048 || !roh.startsWith("/")) return text(res, 400, "Adresse ungültig");
    const pfad = roh.split("?")[0]!;
    const teile = pfad.split("/").slice(1);
    // Erster Aufruf über die Adresse aus der App: Cookie setzen, auf den Rest weiterleiten
    if (ZEICHEN.test(teile[0] ?? "") && this.projektJeZeichen.has(teile[0]!)) {
      // nie `//host` oder `/\host` – das läse der Browser als fremde Adresse
      const rest = "/" + teile.slice(1).join("/").replace(/^[/\\]+/, "");
      res.writeHead(303, {
        ...KOPF, Location: rest,
        "Set-Cookie": `${VORSCHAU_COOKIE}=${teile[0]}; Path=/; HttpOnly; SameSite=Lax`,
      });
      return void res.end();
    }
    const projekt = this.projektAusCookie(req.headers.cookie);
    if (!projekt) return text(res, 404, "Keine Vorschau – in der App „Vorschau“ neu öffnen");
    const sockel = this.dev ? await this.dev.sockel(projekt) : null;
    if (sockel) return this.leiteWeiter(req, res, sockel);
    if (req.method !== "GET" && req.method !== "HEAD") return text(res, 405, "Nur lesen", { Allow: "GET, HEAD" });
    let namen: string[];
    try {
      namen = teile.map((t) => decodeURIComponent(t));
    } catch {
      return text(res, 400, "Adresse ungültig");
    }
    const datei = await this.finde(projekt, namen);
    if (!datei) return text(res, 404, "Nicht gefunden");
    try {
      const st = await datei.fh.stat();
      res.writeHead(200, { ...KOPF, "Content-Type": TYPEN[extname(datei.name).toLowerCase()] ?? "application/octet-stream", "Content-Length": String(st.size) });
      if (req.method === "HEAD") return void res.end();
      await new Promise<void>((ok, fehler) => {
        const strom = datei.fh.createReadStream({ autoClose: false });
        strom.on("error", fehler);
        res.on("close", () => {
          strom.destroy();
          ok();
        });
        strom.pipe(res);
      });
    } finally {
      await datei.fh.close().catch(() => {});
    }
  }

  /** An den Dev-Server – jede Methode, Antwort samt Kopfzeilen so, wie er sie gibt. */
  private leiteWeiter(req: IncomingMessage, res: ServerResponse, sockel: string): Promise<void> {
    return new Promise((fertig) => {
      // ohne Agent: keine offenen Verbindungen zum Dev-Server nach der Antwort (ein Pool hielte den Knoten fest)
      const weiter = httpAnfrage({ socketPath: sockel, method: req.method, path: req.url, headers: devKopf(req.headers), agent: false }, (antwort) => {
        res.writeHead(antwort.statusCode ?? 502, antwort.headers);
        antwort.on("error", () => res.destroy());
        antwort.on("close", () => fertig());
        antwort.pipe(res);
      });
      weiter.on("error", () => {
        if (!res.headersSent) text(res, 502, "Dev-Server antwortet nicht");
        else res.destroy();
        fertig();
      });
      req.pipe(weiter);
    });
  }

  /** WebSocket (Hot Reload) nur mit Cookie und nur zum Dev-Server – sonst zu. */
  private async upgrade(req: IncomingMessage, socket: Duplex, kopf: Buffer): Promise<void> {
    socket.on("error", () => socket.destroy());
    const projekt = this.projektAusCookie(req.headers.cookie);
    const sockel = projekt && this.dev ? await this.dev.sockel(projekt) : null;
    if (!sockel || !(req.url ?? "").startsWith("/")) return void socket.destroy();
    const ziel = connect(sockel);
    // Sockets des HTTP-Servers bleiben halb offen – endet eine Seite, enden beide (sonst hielte jeder Tab den Server fest)
    for (const [a, b] of [[ziel, socket], [socket, ziel]] as const) {
      a.on("error", () => b.destroy());
      a.on("end", () => b.destroy());
      a.on("close", () => b.destroy());
    }
    ziel.on("connect", () => {
      const zeilen = Object.entries(devKopf(req.headers)).flatMap(([k, w]) => (Array.isArray(w) ? w : [w]).map((x) => `${k}: ${x}`));
      ziel.write([`${req.method} ${req.url} HTTP/1.1`, ...zeilen, "", ""].join("\r\n"));
      if (kopf.length) ziel.write(kopf);
      ziel.pipe(socket);
      socket.pipe(ziel);
    });
  }

  private projektAusCookie(kopf: string | undefined): string | undefined {
    for (const teil of (kopf ?? "").split(";")) {
      const [name, wert] = teil.trim().split("=");
      if (name === VORSCHAU_COOKIE && wert && ZEICHEN.test(wert)) {
        const p = this.projektJeZeichen.get(wert);
        if (p) return p;
      }
    }
    return undefined;
  }

  /** Die Datei zu einem Pfad – nur echte Dateien im Projekt, sonst null. */
  private async finde(projekt: string, namen: string[]): Promise<{ fh: FileHandle; name: string } | null> {
    if (namen.some((n, i) => (n === "" && i < namen.length - 1) || n.startsWith(".") || n.includes("/") || n.includes("\\") || n.includes("\0"))) return null;
    const ort = this.ablage.ort(projekt);
    const wurzelSt = await lstat(ort).catch(() => null);
    if (!wurzelSt?.isDirectory()) return null;
    const echt = await realpath(ort).catch(() => null);
    if (!echt) return null;
    let basis: string[] | null = null;
    for (const w of WURZELN) {
      const kette = w ? [w, "index.html"] : ["index.html"];
      if (await this.echteDatei(ort, kette)) {
        basis = w ? [w] : [];
        break;
      }
    }
    if (!basis) basis = [];
    const ziel = namen.filter((n) => n !== "");
    let kette = [...basis, ...ziel];
    let art = await this.art(ort, kette);
    if (art === "ordner") {
      kette = [...kette, "index.html"];
      art = await this.art(ort, kette);
    } else if (art === null && ziel.length > 0 && extname(ziel[ziel.length - 1]!) === "") {
      kette = [...basis, "index.html"]; // eigenes Routing der Seite
      art = await this.art(ort, kette);
    }
    if (art !== "datei") return null;
    return this.oeffne(ort, echt, kette);
  }

  private async echteDatei(ort: string, kette: string[]): Promise<boolean> {
    return (await this.art(ort, kette)) === "datei";
  }

  /** Jeder Teil mit `lstat`: ein Verweis irgendwo im Pfad heißt „gibt es nicht“. */
  private async art(ort: string, kette: string[]): Promise<"datei" | "ordner" | null> {
    let p = ort;
    for (let i = 0; i < kette.length; i++) {
      p = join(p, kette[i]!);
      const st = await lstat(p).catch(() => null);
      if (!st || st.isSymbolicLink()) return null;
      if (i < kette.length - 1 && !st.isDirectory()) return null;
      if (i === kette.length - 1) return st.isFile() ? "datei" : st.isDirectory() ? "ordner" : null;
    }
    return "ordner";
  }

  /**
   * Öffnen ohne Verweis am Ende (`O_NOFOLLOW`), dann prüfen, dass es eine Datei ist und – unter Linux – wo sie
   * wirklich liegt: Zwischen `lstat` und `open` könnte der Agent einen Ordner gegen einen Verweis tauschen.
   */
  private async oeffne(ort: string, echt: string, kette: string[]): Promise<{ fh: FileHandle; name: string } | null> {
    const fh = await open(join(ort, ...kette), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
    if (!fh) return null;
    try {
      if (!(await fh.stat()).isFile()) throw new Error("keine Datei");
      if (process.platform === "linux") {
        const wo = await readlink(`/proc/self/fd/${fh.fd}`);
        if (!wo.startsWith(echt + sep)) throw new Error("außerhalb");
      }
      return { fh, name: kette[kette.length - 1]! };
    } catch {
      await fh.close().catch(() => {});
      return null;
    }
  }
}
