/**
 * TMA-Server: Mini-App + Stars + TON auf einem Port (FREEDOM_TMA=1).
 *
 * Routen:
 *   GET  /                       freedom.html (der TMA-Build der App)
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
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
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
  /** Adresse, an die TON-Zahlungen gehen (Node/Depot). */
  tonDepot: string;
  /** toncenter API-Key (optional, höheres Limit). */
  tonApiKey?: string;
  /** testnet (Standard) oder mainnet. */
  tonTestnet?: boolean;
  /** Port (Standard 3601). */
  port?: number;
  /** Host (Standard 0.0.0.0). */
  host?: string;
  /** Wurzelverzeichnis mit freedom.html + tma/tonconnect-manifest.json. */
  statisch: string;
  /** Persistenz: verbrauchte tx + Stars-Guthaben (JSON-Dateien). */
  daten: string;
  /** Manifest-URL (Default: aus dem Request-Host gebaut). */
  manifestUrl?: string;
}

interface Guthaben { [userId: string]: { stars: number; zahlliste: StarsGutschrift[] } }

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

  async speichereDaten(): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(this.cfg.daten, { recursive: true });
    await writeFile(join(this.cfg.daten, "tma-stars.json"), JSON.stringify(this.guthaben));
    await writeFile(join(this.cfg.daten, "tma-ton.json"), JSON.stringify([...this.tonVerbraucht]));
  }

  start(): void {
    this.server = http.createServer((req, res) => this.route(req, res).catch((e) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }));
    this.server.listen(this.cfg.port ?? 3601, this.cfg.host ?? "0.0.0.0", () => {
      console.log(`[tma] Mini-App aktiv: http://${this.cfg.host ?? "0.0.0.0"}:${this.cfg.port ?? 3601}/`);
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
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    // ── Statisch: freedom.html + Manifest
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return this.sendeDatei(res, "freedom.html", "text/html; charset=utf-8");
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
    if (!user) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "nicht autorisiert" })); return; }

    // ── Stars
    if (url.pathname === "/tma/stars/invoice" && req.method === "POST") return this.starsInvoice(req, res, user);
    if (url.pathname === "/tma/stars/status" && req.method === "GET") return this.starsStatus(res, user);

    // ── TON
    if (url.pathname === "/tma/ton/invoice" && req.method === "POST") return this.tonInvoice(req, res, user);
    if (url.pathname.startsWith("/tma/ton/status/") && req.method === "GET") return this.tonStatus(res, user, url.pathname.slice("/tma/ton/status/".length));

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "nicht gefunden" }));
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
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `${name} nicht gefunden — baue die App mit FREEDOM_TMA=1` }));
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
    if (!auftrag) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "auftrag fehlt" })); return; }
    // Preis VOR dem Bot-Aufruf prüfen — sonst wird aus einem unbekannten
    // Auftrag ein 500 (Bot-API-Fehler), fachlich gehört das ein 400.
    if (starsPreis(auftrag) === undefined) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `kein Preis für ${auftrag}` }));
      return;
    }
    try {
      const { link, stars } = await erstelleStarsRechnung(this.cfg.botToken, auftrag, user.userId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ link, stars, payload: `${auftrag}:${user.userId}` }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  }

  private starsStatus(res: http.ServerResponse, user: TmaInitData): void {
    const g = this.guthaben[String(user.userId)] ?? { stars: 0, zahlliste: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      balance: g.stars,
      recent: g.zahlliste.slice(-20).map((z) => ({ chargeId: z.chargeId, stars: z.stars, payload: z.payload, at: z.at })),
    }));
  }

  /** Long-Polling der Bot-Updates. */
  private async pollStars(): Promise<void> {
    while (!this.stopPolling) {
      try {
        const { updates, nextOffset } = await holeUpdates(this.cfg.botToken, this.updateOffset, 30);
        this.updateOffset = nextOffset;
        for (const u of updates as { pre_checkout_query?: Record<string, unknown>; message?: Record<string, unknown> }[]) {
          if (u.pre_checkout_query) {
            const pcq = u.pre_checkout_query as { id: string; invoice_payload?: string; total_amount?: number };
            // Preise prüfen (nur bekannte Aufträge)
            const auftrag = (pcq.invoice_payload ?? "").split(":")[0];
            const ok = auftrag.length > 0 && !auftrag.includes("/");
            await antwortePreCheckout(this.cfg.botToken, pcq.id, ok, ok ? undefined : "Unbekannter Auftrag");
          }
          if (u.message) {
            const g = erfolgreicheZahlung(u.message);
            if (g && g.chargeId) {
              const eintrag = this.guthaben[String(g.userId)] ?? { stars: 0, zahlliste: [] };
              eintrag.stars += g.stars;
              eintrag.zahlliste.push(g);
              this.guthaben[String(g.userId)] = eintrag;
              console.log(`[tma] Stars gutgeschrieben: user=${g.userId} stars=${g.stars} charge=${g.chargeId}`);
              await this.speichereDaten();
            }
          }
        }
      } catch (e) {
        console.warn(`[tma] Stars-Polling: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  // ─────────────────────────────────────────── TON
  private async tonInvoice(req: http.IncomingMessage, res: http.ServerResponse, user: TmaInitData): Promise<void> {
    const body = await this.leseJson(req);
    const auftrag = String(body.auftrag ?? "");
    const nano = String(body.nano ?? "");      // Client sendet nanoTON-String
    if (!auftrag || !/^\d+$/.test(nano)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "auftrag/nano fehlt" })); return; }
    const kommentar = auftragsKommentar(auftrag);
    this.tonOffen.set(kommentar, { nano, kommentar, at: Date.now() });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ an: this.cfg.tonDepot, nano, kommentar }));
  }

  private async tonStatus(res: http.ServerResponse, user: TmaInitData, kommentarRaw: string): Promise<void> {
    const kommentar = decodeURIComponent(kommentarRaw);
    const offen = this.tonOffen.get(kommentar);
    if (!offen) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Auftrag unbekannt" })); return; }
    let beleg: TonBeleg | undefined;
    try {
      beleg = await this.verifier.pruefe(this.cfg.tonDepot, offen);
    } catch (e) {
      // Netz/RPC-Fehler: NICHT als bezahlt melden — der Hintergrund-Polling-
      // Loop prüft weiter. Lieber „unbekannt/ausstehend" als fälschlich grün.
      console.warn(`[tma] TON-Status: ${(e as Error).message}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ bezahlt: false, fehler: "pruefung nicht möglich" }));
      return;
    }
    if (!beleg) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ bezahlt: false })); return; }
    this.verifier.verbrauche(beleg);
    this.tonOffen.delete(kommentar);
    await this.speichereDaten();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ bezahlt: true, hash: beleg.hash }));
  }

  private async pollTon(): Promise<void> {
    while (!this.stopPolling) {
      try {
        for (const [k, v] of this.tonOffen) {
          const beleg = await this.verifier.pruefe(this.cfg.tonDepot, v);
          if (beleg) {
            this.verifier.verbrauche(beleg);
            this.tonOffen.delete(k);
            console.log(`[tma] TON bezahlt: kommentar=${k} hash=${beleg.hash.slice(0, 12)}…`);
            await this.speichereDaten();
          }
        }
      } catch (e) {
        console.warn(`[tma] TON-Polling: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  private async leseJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {}); }
        catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  }
}
