/**
 * TMA-Server: Mini-App + Stars + TON auf einem Port (FREEDOM_TMA=1).
 *
 * Routen:
 *   GET  /                       tma/index.html (der Mini-App-Build der App, FREEDOM_TMA=1)
 *   GET  /tma/tonconnect-manifest.json
 *   POST /tma/stars/invoice      → { link, stars }      (XTR via Bot API)
 *   GET  /tma/stars/status       → { balance, recent[] }
 *   POST /tma/ton/invoice        → { an, nano, kommentar }
 *   GET  /tma/ton/status/:beleg  → { bezahlt: boolean }
 *
 * Auth: Jeder Request braucht `Authorization: tma <initData>` — der Server
 * verifiziert die HMAC-Signatur (tma-auth.ts). Ohne gültige Signatur: 401.
 * Nie initDataUnsafe.user.id vertrauen.
 *
 * Stars-Updates (pre_checkout_query, successful_payment) laufen über
 * Long-Polling (getUpdates) im Hintergrund — der Node hat kein öffentliches
 * HTTPS für Webhooks. TON läuft über Polling von toncenter.
 *
 * Seit TMA-2: nach außen nur feste Texte, ins Log keine Telegram-IDs, Zahlungs- oder
 * Transaktionskennungen (nur Zahlen und Fehlernamen), Dateien 0600, Anfragen höchstens
 * `TMA_GRENZEN.koerperBytes`, TON nur mit eigener `TON_DEPOT_ADDRESS`.
 */
import http from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, extname, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Verzeichnis dieser Datei — für die mitgelieferten dist-tma-Assets. */
const dirnameSafe = (): string => pathDirname(fileURLToPath(import.meta.url));
import { initDataAusHeader, pruefeInitData, type TmaInitData } from "./tma-auth.js";
import {
  antwortePreCheckout, erfolgreicheZahlung, erstelleStarsRechnung, holeUpdates, starsPreis,
  type StarsGutschrift,
} from "./stars-server.js";
import { ladeVerbraucht, tonVerifier, type TonBeleg, type TonZahlung } from "./ton-verify.js";
import { auftragsKommentar } from "./tma-kommentar.js";

export interface TmaConfig {
  /** Bot-Token aus BotFather (EIGENER Bot, nicht der Hermes-Bot). */
  botToken: string;
  /** Adresse, an die TON-Zahlungen gehen – leer: TON aus. */
  tonDepot: string;
  /** toncenter API-Key (optional, höheres Limit). */
  tonApiKey?: string;
  /** testnet (Standard) oder mainnet. */
  tonTestnet?: boolean;
  /** Port (Standard 3601). */
  port?: number;
  /** Host (Standard 127.0.0.1 – nach außen über einen Tunnel, seit TMA-2). */
  host?: string;
  /** App-Dist mit tma/index.html (Mini-App-Build; seit TMA-1 nicht mehr freedom.html). */
  statisch: string;
  /** Persistenz: verbrauchte tx + Stars-Guthaben (JSON-Dateien). */
  daten: string;
  /** Manifest-URL (Default: aus dem Request-Host gebaut). */
  manifestUrl?: string;
}

interface Guthaben { [userId: string]: { stars: number; zahlliste: StarsGutschrift[] } }

export const TMA_GRENZEN = {
  /** Höchstens so viele Bytes je Anfrage (JSON mit Auftrag und Betrag). */
  koerperBytes: 4096,
} as const;

/** Bot-Token aus BotFather: `<Zahl>:<mindestens 30 Zeichen>`. */
const BOT_TOKEN_FORM = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
/** TON-Adresse: benutzerfreundlich (48 Zeichen base64url) oder roh (`<workchain>:<64 Hex>`). */
const TON_ADRESSE = /^(?:[A-Za-z0-9_-]{48}|-?\d+:[0-9a-fA-F]{64})$/;

/**
 * Mini-App aus der Umgebung (TMA-2, wie die übrigen Rollen): ohne `FREEDOM_TMA=1` keine,
 * ungültig → `grund` (kein Start). TON nur mit `TON_DEPOT_ADDRESS` – bis TMA-2 fiel der
 * Knoten auf `NODE_SOL_ADDRESS` zurück, eine Solana-Adresse als Ziel für TON.
 */
export function tmaAusUmgebung(env: NodeJS.ProcessEnv, opts: { statisch: string; daten: string }): { cfg?: TmaConfig; grund?: string } | null {
  if (env.FREEDOM_TMA !== "1") return null;
  const botToken = env.TELEGRAM_BOT_TOKEN ?? "";
  if (!BOT_TOKEN_FORM.test(botToken)) return { grund: "FREEDOM_TMA=1 braucht TELEGRAM_BOT_TOKEN (eigener Bot, Form <Zahl>:<Geheimnis>)" };
  const tonDepot = (env.TON_DEPOT_ADDRESS ?? "").trim();
  if (tonDepot && !TON_ADRESSE.test(tonDepot)) return { grund: "TON_DEPOT_ADDRESS ist keine TON-Adresse" };
  const port = Number(env.TMA_PORT || 3601);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { grund: "TMA_PORT ungültig" };
  const api = env.TELEGRAM_API_BASE;
  if (api !== undefined && !/^https:\/\/[^/]+$|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) {
    return { grund: "TELEGRAM_API_BASE nur https oder dieser Rechner (der Bot-Token steht in jeder Adresse)" };
  }
  return {
    cfg: {
      botToken, tonDepot, tonApiKey: env.TONCENTER_API_KEY || undefined, tonTestnet: env.TON_TESTNET !== "0",
      port, host: env.TMA_HOST || "127.0.0.1", statisch: env.TMA_STATISCH || opts.statisch, daten: opts.daten,
    },
  };
}

/** Feste Antwort – nie Text aus Fehlern, Bot-API oder Anfrage. */
function antworte(res: http.ServerResponse, status: number, inhalt: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(inhalt));
}

/** Fehlername fürs Log – nie die Meldung (sie kann Adressen oder Antworten Dritter tragen). */
const fehlerName = (e: unknown): string => (e instanceof Error ? e.name : "Fehler");

export class TmaServer {
  private server?: http.Server;
  private guthaben: Guthaben = {};
  private tonVerbraucht = new Set<string>();
  private tonOffen = new Map<string, { nano: string; kommentar: string; at: number }>();
  private verifier: ReturnType<typeof tonVerifier>;
  private updateOffset = 0;
  private stopPolling = false;

  constructor(private cfg: TmaConfig) {
    this.verifier = tonVerifier({ testnet: cfg.tonTestnet !== false, apiKey: cfg.tonApiKey, verbraucht: this.tonVerbraucht });
    void this.ladeDaten();
  }

  private async ladeDaten(): Promise<void> {
    try { this.guthaben = JSON.parse(await readFile(join(this.cfg.daten, "tma-stars.json"), "utf8")) as Guthaben; } catch { /* neu */ }
    this.tonVerbraucht = ladeVerbraucht(undefined);
    try {
      const r = await readFile(join(this.cfg.daten, "tma-ton.json"), "utf8");
      this.tonVerbraucht = ladeVerbraucht(r);
    } catch { /* neu */ }
  }

  /** Telegram-IDs und Zahlungskennungen – nur für den Betreiber lesbar (0700/0600). */
  async speichereDaten(): Promise<void> {
    await mkdir(this.cfg.daten, { recursive: true, mode: 0o700 });
    for (const [name, inhalt] of [["tma-stars.json", this.guthaben], ["tma-ton.json", [...this.tonVerbraucht]]] as const) {
      const datei = join(this.cfg.daten, name);
      await writeFile(datei, JSON.stringify(inhalt), { mode: 0o600 });
      await chmod(datei, 0o600);
    }
  }

  start(): void {
    this.server = http.createServer((req, res) => this.route(req, res).catch((e) => {
      if (e instanceof ZuGross) return antworte(res, 413, { error: "zu gross" });
      if (e instanceof SyntaxError) return antworte(res, 400, { error: "kein JSON" });
      console.warn(`[tma] Anfrage: ${fehlerName(e)}`);
      antworte(res, 500, { error: "interner Fehler" });
    }));
    this.server.listen(this.cfg.port ?? 3601, this.cfg.host ?? "127.0.0.1", () => {
      console.log(`[tma] Mini-App aktiv: http://${this.cfg.host ?? "127.0.0.1"}:${this.cfg.port ?? 3601}/ (TON ${this.cfg.tonDepot ? "an" : "aus"})`);
    });
    // Stars-Long-Polling starten
    void this.pollStars();
    // TON-Polling starten
    void this.pollTon();
  }

  async stop(): Promise<void> {
    this.stopPolling = true;
    await this.speichereDaten();
    await new Promise<void>((r) => this.server?.close(() => r()) ?? r());
  }

  // ─────────────────────────────────────────── HTTP
  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    // InitData im Authorization-Header ist für die API lesbar nötig — bei
    // getrennten Origins (App auf Pages, API auf Node) verlangt der Browser
    // dafür eine erlaubte Origin statt '*'. Wir spiegeln die anfragende
    // Origin zurück (die Signatur schützt, nicht die Origin-Prüfung).
    const origin = req.headers.origin;
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    // ── Statisch: der Mini-App-Build (dist/tma/, nie der Web-Build) + Manifest
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return this.sendeDatei(res, join("tma", "index.html"), "text/html; charset=utf-8");
    }
    if (url.pathname === "/tma/tonconnect-manifest.json") {
      return this.sendeManifest(res, url);
    }
    if (url.pathname === "/tma/tonconnect-ui.js") {
      return this.sendeDatei(res, "tonconnect-ui.min.js", "application/javascript");
    }
    if (url.pathname === "/manifest.json") {
      return this.sendeDatei(res, "manifest.json", "application/manifest+json");
    }
    // Öffentlich (vor der Auth): das Manifest verweist darauf, und Wallet-
    // Picker laden das Icon ohne Signatur.
    if (url.pathname === "/icon.png") {
      return this.sendeDatei(res, "icon.png", "image/png");
    }

    // ── Auth
    const user = this.auth(req);
    if (!user) return antworte(res, 401, { error: "nicht autorisiert" });

    // ── Stars
    if (url.pathname === "/tma/stars/invoice" && req.method === "POST") return this.starsInvoice(req, res, user);
    if (url.pathname === "/tma/stars/status" && req.method === "GET") return this.starsStatus(res, user);

    // ── TON
    if (url.pathname === "/tma/ton/invoice" && req.method === "POST") return this.tonInvoice(req, res, user);
    if (url.pathname.startsWith("/tma/ton/status/") && req.method === "GET") return this.tonStatus(res, user, url.pathname.slice("/tma/ton/status/".length));

    antworte(res, 404, { error: "nicht gefunden" });
  }

  private auth(req: http.IncomingMessage): TmaInitData | undefined {
    const raw = initDataAusHeader(req.headers.authorization);
    if (!raw) return undefined;
    const r = pruefeInitData(raw, this.cfg.botToken);
    return r.ok ? r.data : undefined;
  }

  // ─────────────────────────────────────────── Statisch
  /**
   * Datei aus dem App-Dist, mit Rückfall auf die mitgelieferten TMA-Assets.
   * dist-tma liegt neben src/ im Paket — also ein Ebene höher als diese Datei.
   */
  private async sendeDatei(res: http.ServerResponse, name: string, type: string): Promise<void> {
    const hier = dirnameSafe();               // …/packages/node/src
    const wurzeln = [
      this.cfg.statisch,                      // …/packages/app/dist (TMA-Static)
      join(hier, "dist-tma"),                 // falls mal neben src abgelegt
      join(hier, "..", "dist-tma"),           // …/packages/node/dist-tma (Regel)
    ];
    for (const root of wurzeln) {
      try {
        const buf = await readFile(join(root, name));
        res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
        res.end(buf);
        return;
      } catch { /* nächster Ordner */ }
    }
    antworte(res, 404, { error: "nicht gefunden – die App mit FREEDOM_TMA=1 bauen" });
  }

  private async sendeManifest(res: http.ServerResponse, url: URL): Promise<void> {
    const origin = this.cfg.manifestUrl ?? `https://${url.host}`;
    const manifest = {
      url: `${origin}/`,
      name: "FREEDOM",
      iconUrl: `${origin}/icon.png`,
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(manifest));
  }

  // ─────────────────────────────────────────── Stars
  private async starsInvoice(req: http.IncomingMessage, res: http.ServerResponse, user: TmaInitData): Promise<void> {
    const body = await this.leseJson(req);
    const auftrag = String(body.auftrag ?? "");
    if (!auftrag) return antworte(res, 400, { error: "auftrag fehlt" });
    // Preis VOR dem Bot-Aufruf prüfen — sonst wird aus einem unbekannten
    // Auftrag ein 500 (Bot-API-Fehler), fachlich gehört das ein 400.
    if (starsPreis(auftrag) === undefined) return antworte(res, 400, { error: "kein Preis für diesen Auftrag" });
    try {
      const { link, stars, payload } = await erstelleStarsRechnung(this.cfg.botToken, auftrag, user.userId);
      antworte(res, 200, { link, stars, payload });
    } catch (e) {
      console.warn(`[tma] Stars-Rechnung: ${fehlerName(e)}`);
      antworte(res, 502, { error: "Rechnung nicht möglich" });
    }
  }

  private starsStatus(res: http.ServerResponse, user: TmaInitData): void {
    const g = this.guthaben[String(user.userId)] ?? { stars: 0, zahlliste: [] };
    antworte(res, 200, {
      balance: g.stars,
      recent: g.zahlliste.slice(-20).map((z) => ({ chargeId: z.chargeId, stars: z.stars, payload: z.payload, at: z.at })),
    });
  }

  /** Long-Polling der Bot-Updates. */
  private async pollStars(): Promise<void> {
    while (!this.stopPolling) {
      try {
        const { updates, nextOffset } = await holeUpdates(this.cfg.botToken, this.updateOffset, 30);
        this.updateOffset = nextOffset;
        for (const u of updates as { pre_checkout_query?: Record<string, unknown>; message?: Record<string, unknown> }[]) {
          if (u.pre_checkout_query) {
            const pcq = u.pre_checkout_query as { id: string; currency?: string; invoice_payload?: string; total_amount?: number };
            const ok = preCheckoutPasst(pcq);
            await antwortePreCheckout(this.cfg.botToken, pcq.id, ok, ok ? undefined : "Unbekannter Auftrag");
          }
          if (u.message) {
            const g = erfolgreicheZahlung(u.message);
            if (g && g.chargeId && g.userId > 0) {
              const eintrag = this.guthaben[String(g.userId)] ?? { stars: 0, zahlliste: [] };
              // Jede Zahlung nur einmal – auch wenn Telegram ein Update erneut zustellt
              if (eintrag.zahlliste.some((z) => z.chargeId === g.chargeId)) continue;
              eintrag.stars += g.stars;
              eintrag.zahlliste.push(g);
              this.guthaben[String(g.userId)] = eintrag;
              console.log(`[tma] Stars gutgeschrieben: ${g.stars}`);
              await this.speichereDaten();
            }
          }
        }
      } catch (e) {
        console.warn(`[tma] Stars-Polling: ${fehlerName(e)}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  // ─────────────────────────────────────────── TON
  private async tonInvoice(req: http.IncomingMessage, res: http.ServerResponse, user: TmaInitData): Promise<void> {
    const body = await this.leseJson(req);
    if (!this.cfg.tonDepot) return antworte(res, 503, { error: "TON aus" });
    const auftrag = String(body.auftrag ?? "");
    const nano = String(body.nano ?? "");      // Client sendet nanoTON-String
    if (!/^[a-z0-9-]{1,32}$/.test(auftrag) || !/^[1-9]\d{0,18}$/.test(nano)) return antworte(res, 400, { error: "auftrag/nano ungültig" });
    const kommentar = auftragsKommentar(auftrag);
    this.tonOffen.set(kommentar, { nano, kommentar, at: Date.now() });
    antworte(res, 200, { an: this.cfg.tonDepot, nano, kommentar });
  }

  private async tonStatus(res: http.ServerResponse, user: TmaInitData, kommentarRaw: string): Promise<void> {
    let kommentar: string;
    try { kommentar = decodeURIComponent(kommentarRaw); } catch { return antworte(res, 400, { error: "Auftrag unbekannt" }); }
    const offen = this.tonOffen.get(kommentar);
    if (!offen) return antworte(res, 404, { error: "Auftrag unbekannt" });
    let beleg: TonBeleg | undefined;
    try {
      beleg = await this.verifier.pruefe(this.cfg.tonDepot, offen);
    } catch (e) {
      // Netz/RPC-Fehler: NICHT als bezahlt melden — der Hintergrund-Polling-
      // Loop prüft weiter. Lieber „unbekannt/ausstehend" als fälschlich grün.
      console.warn(`[tma] TON-Status: ${fehlerName(e)}`);
      return antworte(res, 200, { bezahlt: false, fehler: "pruefung nicht möglich" });
    }
    if (!beleg) return antworte(res, 200, { bezahlt: false });
    this.verifier.verbrauche(beleg);
    this.tonOffen.delete(kommentar);
    await this.speichereDaten();
    antworte(res, 200, { bezahlt: true, hash: beleg.hash });
  }

  private async pollTon(): Promise<void> {
    while (!this.stopPolling && this.cfg.tonDepot) {
      try {
        for (const [k, v] of this.tonOffen) {
          const beleg = await this.verifier.pruefe(this.cfg.tonDepot, v);
          if (beleg) {
            this.verifier.verbrauche(beleg);
            this.tonOffen.delete(k);
            console.log("[tma] TON bezahlt");
            await this.speichereDaten();
          }
        }
      } catch (e) {
        console.warn(`[tma] TON-Polling: ${fehlerName(e)}`);
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  private async leseJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let laenge = 0;
      req.on("data", (c: Buffer) => {
        laenge += c.length;
        if (laenge > TMA_GRENZEN.koerperBytes) { reject(new ZuGross()); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {}); }
        catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  }
}

class ZuGross extends Error { override name = "ZuGross"; }

/**
 * Vor dem Bezahlen (`pre_checkout_query`): nur Sterne, nur ein bekannter Auftrag aus
 * unserer Rechnung, genau sein Preis (TMA-2 – vorher genügte ein Auftrag ohne „/“).
 */
export function preCheckoutPasst(pcq: { currency?: string; invoice_payload?: string; total_amount?: number }): boolean {
  const auftrag = (pcq.invoice_payload ?? "").split(":")[0] ?? "";
  const preis = starsPreis(auftrag);
  return pcq.currency === "XTR" && preis !== undefined && pcq.total_amount === preis;
}
