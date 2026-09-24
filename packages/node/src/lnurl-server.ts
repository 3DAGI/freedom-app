/**
 * LNURL-Server für Treasury-Lightning-Fees (in den Node integriert).
 *
 * Zweck: Der Development-Fee-Anteil in Sats fließt an eine Lightning-Adresse
 * (lud16), die dieser Server bedient. KEINE KYC, kein externer Dienst:
 *
 *   GET /.well-known/lnurlp/<name>          → LNURL-pay-Parametern (LUD-06)
 *   GET /lnurlp/callback?amount=<msat>       → BOLT11-Invoice
 *
 * Routing der Invoice: Der Server erstellt selbst KEINE Invoices (das bräuchte
 * einen Lightning-Node mit Kanälen). Stattdessen nutzt er einen konfigurierbaren
 * "Invoice-Backend" — typischerweise eine non-custodial Wallet-API (Blink,
 * Alby-Hub, LNDg) oder ein LND. Die Invoice wird AUF DIE AKTUELLE WOCHEN-WALLET
 * ausgestellt (d.h. das Backend muss die Woche-Adresse als Empfang nutzen können).
 *
 * PRAGMATISCHER ANSATZ v1: Das Backend ist eine Blink-API (blink.sv), die
 * non-custodial Wallets mit Lightning-Addressen anbietet und per API-Key
 * steuerbar ist. Alternativ: LND-REST. Beide via env konfigurierbar.
 *
 * Sicherheit:
 * - Der Server läuft NUR auf dem Treasury-Node (nicht öffentlich im Repo-Default)
 * - API-Keys liegen in env, nie im Code
 * - Pro Invoice wird die aktuelle Wochen-Adresse als Memo/Metadata mitgeführt,
 *   damit der Sweep sie zuordnen kann.
 */

import http from "node:http";

export interface LnurlConfig {
  /** Extern erreichbare Basis-URL, z.B. https://treasury.example.com */
  baseUrl: string;
  /** Anzeigename (domain der lud16). */
  domain: string;
  /** Min/Max in msat pro Invoice. */
  minMsat: number;
  maxMsat: number;
  /** Kommentar-Maximallänge (LUD-12), 0 = aus. */
  commentAllowed: number;
}

export interface InvoiceBackend {
  /** Erstellt eine BOLT11-Invoice. */
  createInvoice(args: { amountMsat: number; memo: string; metadataJson: string }): Promise<{ pr: string }>;
}

/** Blink (blink.sv) Backend: non-custodial, API-Key, keine KYC. */
export class BlinkBackend implements InvoiceBackend {
  constructor(private apiKey: string, private walletId: string) {}

  async createInvoice(args: { amountMsat: number; memo: string; metadataJson: string }): Promise<{ pr: string }> {
    const res = await fetch("https://api.blink.sv/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": this.apiKey },
      body: JSON.stringify({
        query: `mutation LnInvoiceCreate($input: LnInvoiceCreateInput!) {
          lnInvoiceCreate(input: $input) { invoice { paymentRequest } }
        }`,
        variables: {
          input: {
            walletId: this.walletId,
            amount: args.amountMsat,
            memo: args.memo.slice(0, 120),
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`blink http ${res.status}`);
    const data = (await res.json()) as { data?: { lnInvoiceCreate?: { invoice?: { paymentRequest?: string } } }; errors?: unknown[] };
    const pr = data.data?.lnInvoiceCreate?.invoice?.paymentRequest;
    if (!pr) throw new Error("blink: keine invoice erhalten");
    return { pr };
  }
}

/** LND-REST Backend (selbstgehosteter Lightning-Node). */
export class LndBackend implements InvoiceBackend {
  constructor(private restUrl: string, private macaroonHex: string) {}

  async createInvoice(args: { amountMsat: number; memo: string; metadataJson: string }): Promise<{ pr: string }> {
    const res = await fetch(`${this.restUrl}/v2/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Grpc-Metadata-macaroon": this.macaroonHex },
      body: JSON.stringify({
        value_msat: String(args.amountMsat),
        memo: args.memo.slice(0, 120),
      }),
    });
    if (!res.ok) throw new Error(`lnd http ${res.status}`);
    const data = (await res.json()) as { payment_request?: string };
    if (!data.payment_request) throw new Error("lnd: keine invoice");
    return { pr: data.payment_request };
  }
}

/** Startet den LNURL-HTTP-Server. */
export function startLnurlServer(cfg: LnurlConfig, backend: InvoiceBackend): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${cfg.domain}`);
    try {
      // CORS für Wallet-Clients
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json");

      // LUD-06: lnurlp endpoint
      if (url.pathname.startsWith("/.well-known/lnurlp/")) {
        const name = url.pathname.split("/").pop() ?? "";
        const body = {
          status: "OK",
          tag: "payRequest",
          callback: `${cfg.baseUrl}/lnurlp/callback`,
          minSendable: cfg.minMsat,
          maxSendable: cfg.maxMsat,
          metadata: JSON.stringify([
            ["text/identifier", `${name}@${cfg.domain}`],
            ["text/plain", `Freedom Protocol Treasury Fee`],
          ]),
          ...(cfg.commentAllowed > 0 ? { commentAllowed: cfg.commentAllowed } : {}),
        };
        res.end(JSON.stringify(body));
        return;
      }

      // Callback: Invoice erstellen
      if (url.pathname === "/lnurlp/callback") {
        const amount = Number(url.searchParams.get("amount") ?? "0");
        const comment = url.searchParams.get("comment") ?? "";
        if (amount < cfg.minMsat || amount > cfg.maxMsat) {
          res.statusCode = 400;
          res.end(JSON.stringify({ status: "ERROR", reason: `amount out of range (${cfg.minMsat}-${cfg.maxMsat} msat)` }));
          return;
        }
        const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
        const metadata = JSON.stringify([
          ["text/identifier", `treasury@${cfg.domain}`],
          ["text/plain", `Freedom Treasury Fee (week ${week})`],
          ...(comment ? [["text/comment", comment.slice(0, 200)]] : []),
        ]);
        const { pr } = await backend.createInvoice({ amountMsat: amount, memo: `freedom-week-${week}`, metadataJson: metadata });
        res.end(JSON.stringify({ status: "OK", successAction: { tag: "message", message: "Danke! Freedom bleibt frei." }, pr }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ status: "ERROR", reason: "not found" }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: "ERROR", reason: (e as Error).message.slice(0, 120) }));
    }
  });

  server.listen(Number(process.env.LNURL_PORT ?? 3601), () => {
    console.log(`LNURL-Server aktiv: ${cfg.baseUrl}/.well-known/lnurlp/treasury`);
  });
  return server;
}
