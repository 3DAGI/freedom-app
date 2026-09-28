/**
 * Lightning-Adresse beim eigenen Knoten (Schritt 8.2b): LNURL-pay (LUD-06,
 * LUD-16) mit Rechnungen des eigenen LND – statt einer Adresse bei einem
 * verwahrenden Dienst, dem das Geld bis zur Auszahlung gehört.
 *
 *   GET /.well-known/lnurlp/<name>         → Parameter, nur für den eigenen Namen
 *   GET /lnurlp/<name>/rechnung?amount=<msat> → Rechnung, Beschreibung = Hash der Metadaten
 *
 * - LND nur mit einer Macaroon, die ausschließlich Rechnungen darf
 *   (`pruefeRelayMacaroon()`: invoices:read/write, info:read) – wer den Server
 *   übernimmt, kann nichts auszahlen.
 * - Beträge nur im Bereich; Kommentare nimmt der Server nicht an (nichts zu speichern).
 * - Bremse: höchstens `proMinute` Rechnungen je Minute – jede kostet LND Platz.
 * - Nach außen nur feste Texte, nie Meldungen von LND.
 * - CORS `*`: Die App holt die Rechnung aus dem Browser.
 *
 * Erreichbar wird er hinter einem Reverse-Proxy mit TLS unter der eigenen
 * Domain (`LNURL_BASE_URL`); `NODE_LUD16` ist dann `<name>@<domain>`. Ob das von
 * außen klappt, prüft die Selbstprüfung (`einrichtung.ts`, 8.2a).
 *
 * Bis 8.2b stand hier ein Server für Treasury-Gebühren (Blink oder LND,
 * Wochen-Wallets) – das Gebührenmodell A+ (5.1) kennt keine Treasury mehr.
 */
import { createHash } from "node:crypto";
import http from "node:http";

export interface LnurlKonfig {
  /** Öffentliche Basis, z. B. https://knoten.example.org – nur https. */
  basisUrl: string;
  /** Teil vor dem @ der Lightning-Adresse. */
  name: string;
  /** Domain der Lightning-Adresse (Host der Basis-URL). */
  domain: string;
  minMsat: number;
  maxMsat: number;
  /** Höchstens so viele Rechnungen je Minute. */
  proMinute: number;
}

export interface RechnungsQuelle {
  /** Eine Rechnung über genau `msat`, Beschreibung = `beschreibungsHash`. */
  rechnung(msat: number, beschreibungsHash: Uint8Array): Promise<string>;
}

export interface LnurlAntwort { status: number; body: Record<string, unknown> }

export const LNURL_STANDARD = { minMsat: 1_000, maxMsat: 100_000_000, proMinute: 30 } as const;
const NAME = /^[a-z0-9._-]{1,64}$/;

/** Die Metadaten der Adresse – ihr Hash steht in jeder Rechnung (LUD-06). */
export function lnurlMetadaten(k: Pick<LnurlKonfig, "name" | "domain">): string {
  return JSON.stringify([["text/plain", `FreedomStack-Provider ${k.name}@${k.domain}`], ["text/identifier", `${k.name}@${k.domain}`]]);
}

const fehler = (status: number, reason: string): LnurlAntwort => ({ status, body: { status: "ERROR", reason } });

/** Antwort auf eine Anfrage – ohne HTTP, damit sie sich prüfen lässt. */
export class LnurlDienst {
  private zeiten: number[] = [];
  constructor(
    private readonly k: LnurlKonfig,
    private readonly quelle: RechnungsQuelle,
    private readonly jetzt: () => number = () => Date.now(),
  ) {}

  async antworte(pfad: string, suche: URLSearchParams): Promise<LnurlAntwort> {
    const metadaten = lnurlMetadaten(this.k);
    if (pfad === `/.well-known/lnurlp/${this.k.name}`) {
      return {
        status: 200,
        body: {
          tag: "payRequest", callback: `${this.k.basisUrl}/lnurlp/${this.k.name}/rechnung`,
          minSendable: this.k.minMsat, maxSendable: this.k.maxMsat, metadata: metadaten,
        },
      };
    }
    if (pfad !== `/lnurlp/${this.k.name}/rechnung`) return fehler(404, "Nicht gefunden");
    // Nur Ziffern – Number() läse auch „1.5e3“ oder „0x10“
    const roh = suche.get("amount") ?? "";
    const betrag = /^\d{1,15}$/.test(roh) ? Number(roh) : NaN;
    if (!Number.isSafeInteger(betrag) || betrag < this.k.minMsat || betrag > this.k.maxMsat) {
      return fehler(400, `Betrag außerhalb von ${this.k.minMsat} bis ${this.k.maxMsat} msat`);
    }
    const t = this.jetzt();
    this.zeiten = this.zeiten.filter((z) => t - z < 60_000);
    if (this.zeiten.length >= this.k.proMinute) return fehler(429, "Zu viele Rechnungen – bitte gleich noch einmal");
    this.zeiten.push(t);
    try {
      const pr = await this.quelle.rechnung(betrag, createHash("sha256").update(metadaten).digest());
      return { status: 200, body: { pr, routes: [] } };
    } catch {
      // Nie die Meldung von LND – sie kann Interna tragen
      return fehler(502, "Rechnung gerade nicht möglich");
    }
  }
}

/** HTTP-Hülle: nur GET, CORS `*`, JSON. */
export function starteLnurlServer(dienst: LnurlDienst, port: number, host = "127.0.0.1"): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    const antwort = req.method === "GET"
      ? dienst.antworte(new URL(req.url ?? "/", "http://x").pathname, new URL(req.url ?? "/", "http://x").searchParams)
      : Promise.resolve(fehler(405, "Nur GET"));
    void antwort
      .catch(() => fehler(500, "Interner Fehler"))
      .then((a) => { res.statusCode = a.status; res.end(JSON.stringify(a.body)); });
  });
  server.listen(port, host);
  return server;
}

export interface LnurlUmgebung {
  LNURL_BASE_URL?: string;
  LNURL_NAME?: string;
  LNURL_MIN_MSAT?: string;
  LNURL_MAX_MSAT?: string;
  LNURL_PRO_MINUTE?: string;
  LNURL_LND_MACAROON?: string;
  LND_REST?: string;
  LND_INSECURE_TLS?: string;
  LNURL_BACKEND?: string;
}

/**
 * Konfiguration und LND aus der Umgebung – oder ein Grund, warum nicht. Die
 * Macaroon muss sich auf Rechnungen beschränken; `blink` gibt es nicht mehr.
 */
export async function lnurlAusUmgebung(
  env: LnurlUmgebung,
  lade: (pfad: string) => Promise<string>,
): Promise<{ konfig: LnurlKonfig; quelle: RechnungsQuelle } | { grund: string }> {
  if (env.LNURL_BACKEND && env.LNURL_BACKEND !== "lnd") {
    return { grund: `LNURL_BACKEND=${env.LNURL_BACKEND} gibt es nicht mehr – nur der eigene LND (Blink verwahrt das Geld)` };
  }
  let basis: URL;
  try {
    basis = new URL(env.LNURL_BASE_URL ?? "");
  } catch {
    return { grund: "LNURL_BASE_URL fehlt (öffentliche https-Adresse des Knotens)" };
  }
  if (basis.protocol !== "https:" || basis.pathname !== "/" || basis.search) {
    return { grund: "LNURL_BASE_URL muss https://<domain> sein – Wallets und die App verlangen https" };
  }
  const name = (env.LNURL_NAME || "provider").toLowerCase();
  if (!NAME.test(name)) return { grund: "LNURL_NAME: nur a–z, 0–9, Punkt, Strich, Unterstrich" };
  const zahl = (w: string | undefined, standard: number) => (w && /^\d{1,15}$/.test(w) ? Number(w) : standard);
  const konfig: LnurlKonfig = {
    basisUrl: basis.origin, name, domain: basis.hostname,
    minMsat: zahl(env.LNURL_MIN_MSAT, LNURL_STANDARD.minMsat),
    maxMsat: zahl(env.LNURL_MAX_MSAT, LNURL_STANDARD.maxMsat),
    proMinute: zahl(env.LNURL_PRO_MINUTE, LNURL_STANDARD.proMinute),
  };
  if (konfig.minMsat < 1 || konfig.maxMsat < konfig.minMsat || konfig.proMinute < 1) {
    return { grund: "LNURL_MIN_MSAT, LNURL_MAX_MSAT oder LNURL_PRO_MINUTE ungültig" };
  }
  if (!env.LNURL_LND_MACAROON) return { grund: "LNURL_LND_MACAROON fehlt (lncli bakemacaroon invoices:read invoices:write)" };
  const { LndLightningAdapter, pruefeRelayMacaroon } = await import("@freedomstack/protocol");
  let hex: string;
  try {
    hex = await lade(env.LNURL_LND_MACAROON);
  } catch (e) {
    return { grund: `LNURL_LND_MACAROON nicht lesbar (${(e as Error).name})` };
  }
  const ok = pruefeRelayMacaroon(hex);
  if (!ok.ok) return { grund: `LNURL_LND_MACAROON: ${ok.grund} – nur Rechnungen (lncli bakemacaroon invoices:read invoices:write)` };
  let lnd: InstanceType<typeof LndLightningAdapter>;
  try {
    lnd = new LndLightningAdapter({ restUrl: env.LND_REST || "https://127.0.0.1:8080", macaroonHex: hex, allowInsecureTls: env.LND_INSECURE_TLS === "1" });
  } catch (e) {
    return { grund: `LND_REST: ${(e as Error).message}` };
  }
  return { konfig, quelle: { rechnung: async (msat, h) => (await lnd.createLnurlInvoice(msat, h)).bolt11 } };
}
