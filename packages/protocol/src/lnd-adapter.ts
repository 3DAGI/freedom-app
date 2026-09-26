/**
 * LndLightningAdapter: LightningAdapter gegen eine echte LND-Node via REST.
 *
 * Hold-Invoices sind der kritische Baustein des Swaps: Ohne sie kann die
 * Lightning-Seite nicht "schweben" (akzeptiert, aber nicht abgerechnet),
 * und der Atomic Swap funktioniert nicht.
 *
 * LND-Endpoints (invoicesrpc, v2, laut invoices.swagger.json):
 *   POST /v2/invoices/hodl                — LP erstellt Hold-Invoice zu H
 *   GET  /v2/invoices/lookup?payment_hash — Zustand abfragen
 *   POST /v2/invoices/settle              — LP rechnet mit Preimage R ab
 *   POST /v2/invoices/cancel              — LP bricht ab -> Refund an Zahler
 *   POST /v2/router/send                  — Zahler zahlt die Invoice (Payment)
 *
 * Auth: Macaroon (hex) im Header "Grpc-Metadata-macaroon".
 * TLS: selbstsigniertes Zertifikat der Node; fuer Regtest/Test abschaltbar,
 *      fuer Mainnet tls.cert-Pfad angeben.
 */
import {
  LightningAdapter,
  HoldInvoice,
  HoldInvoiceState,
} from "./adapters.js";
import { toHex, fromHex, generatePreimage, sha256 } from "./htlc.js";

export interface LndConfig {
  /** z. B. https://127.0.0.1:8080 */
  restUrl: string;
  /**
   * Macaroon als Hex-String. Fuer den LP genuegen `invoices:read/write` und
   * `offchain:read/write` (settle ist `invoices:write`) – nie admin.macaroon;
   * `pruefeLpMacaroon()` prueft das beim Start (8.3, docs/SWAPS.md).
   */
  macaroonHex: string;
  /** HTTPS-Agent mit tls.cert; undefined = Zertifikatspruefung aus (NUR Regtest!). */
  allowInsecureTls?: boolean;
}

export class LndLightningAdapter implements LightningAdapter {
  private agent: unknown;

  constructor(private cfg: LndConfig) {
    if (cfg.allowInsecureTls) {
      // FRÜHER STAND HIER: process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0".
      //
      // Das schaltet die Zertifikatsprüfung fuer den GESAMTEN Prozess ab —
      // auch fuer Solana-RPC, Relays, Modell-Downloads und jede andere
      // Verbindung. Wer ein selbstsigniertes Zertifikat fuer seine eigene
      // LND-Instanz akzeptieren will, macht damit versehentlich sein ganzes
      // System angreifbar, und zwar dauerhaft und unsichtbar.
      //
      // Jetzt gilt die Ausnahme nur fuer Verbindungen zu DIESER Adresse.
      this.agent = undefined; // wird beim ersten Aufruf gesetzt
      if (!/^https:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(cfg.restUrl)) {
        throw new Error(
          "allowInsecureTls ist nur fuer lokale LND-Instanzen erlaubt " +
          `(127.0.0.1 oder localhost), nicht fuer ${cfg.restUrl}. ` +
          "Ein selbstsigniertes Zertifikat auf einer fremden Adresse ist " +
          "nicht zu unterscheiden von einem Angriff.",
        );
      }
    }
  }

  /** TLS-Ausnahme nur fuer diese eine Verbindung, nicht prozessweit. */
  private async dispatcher(): Promise<unknown> {
    if (!this.cfg.allowInsecureTls) return undefined;
    if (this.agent) return this.agent;
    try {
      // Der Modulname wird zur Laufzeit gebildet, damit der Browser-Build ihn
      // nicht mitzieht: undici ist ein Node-Modul mit Dutzenden
      // Node-Abhaengigkeiten, und die App importiert dieses Paket ueber den
      // gemeinsamen Index mit.
      const name = ["un", "dici"].join("");
      const undici = (await import(/* @vite-ignore */ name)) as {
        Agent: new (o: unknown) => unknown;
      };
      this.agent = new undici.Agent({ connect: { rejectUnauthorized: false } });
    } catch {
      // Ohne undici bleibt nur die ehrliche Absage — lieber keine
      // Verbindung als eine, die den ganzen Prozess oeffnet.
      throw new Error(
        "Selbstsigniertes TLS braucht undici. Alternativ das LND-Zertifikat " +
        "im System hinterlegen.",
      );
    }
    return this.agent;
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const res = await fetch(`${this.cfg.restUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "Grpc-Metadata-macaroon": this.cfg.macaroonHex,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher: await this.dispatcher(),
    } as RequestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LND ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async createHoldInvoice(
    paymentHash: Uint8Array,
    amountSats: number,
    cltvDeltaBlocks: number,
  ): Promise<HoldInvoice> {
    const r = (await this.call("POST", "/v2/invoices/hodl", {
      hash: Buffer.from(paymentHash).toString("base64"),
      value: String(amountSats),
      cltv_expiry: String(cltvDeltaBlocks),
    })) as { payment_request: string };
    return {
      paymentHash,
      bolt11: r.payment_request,
      amountSats,
      cltvDeltaBlocks,
    };
  }

  /**
   * Normale Rechnung des LP (4.6d: Vorab-Gebuehr). Gueltig 10 Minuten – so
   * lange wartet der LP auf die Zahlung, bevor er die Anfrage verwirft.
   */
  async createInvoice(amountSats: number): Promise<{ bolt11: string; paymentHash: Uint8Array; amountSats: number }> {
    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error("Betrag muss eine positive ganze Zahl sein");
    const r = (await this.call("POST", "/v1/invoices", {
      value: String(amountSats), memo: "FreedomStack: Vorab-Gebühr für einen Tausch", expiry: "600",
    })) as { r_hash?: string; payment_request?: string };
    const paymentHash = Uint8Array.from(Buffer.from(r.r_hash ?? "", "base64"));
    if (paymentHash.length !== 32 || !r.payment_request) throw new Error("LND lieferte keine vollständige Rechnung");
    return { bolt11: r.payment_request, paymentHash, amountSats };
  }

  async payHoldInvoice(bolt11: string): Promise<void> {
    // SendPaymentV2 ist ein STREAMING-Endpunkt: LND sendet Status-Updates,
    // bis der Payment final ist. Bei einer Hold-Invoice bleibt der Payment
    // per Design IN_FLIGHT (der LP settlet erst spaeter mit der Preimage) —
    // der Stream wuerde also nie enden. Deshalb: nur die erste Nachricht
    // lesen (bestaetigt, dass die Zahlung unterwegs ist), dann abbrechen.
    const res = await fetch(`${this.cfg.restUrl}/v2/router/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Grpc-Metadata-macaroon": this.cfg.macaroonHex,
      },
      body: JSON.stringify({
        payment_request: bolt11,
        timeout_seconds: 3600,
        // WICHTIG: false — sonst schickt der Stream KEINE erste Nachricht,
        // solange die Hold-Invoice in flight ist (LND-Verhalten).
        no_inflight_updates: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LND payHoldInvoice: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    // Erstes JSON-Objekt des Streams lesen (Streaming = newline-delimited JSON)
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel().catch(() => {});
    const first = new TextDecoder().decode(value).split("\n").find((l) => l.trim());
    if (!first) throw new Error("LND payHoldInvoice: leere Stream-Antwort");
    const update = JSON.parse(first) as { result?: { status?: string }; error?: unknown };
    const status = update.result?.status;
    if (update.error) throw new Error(`LND payHoldInvoice: ${JSON.stringify(update.error)}`);
    if (status === "FAILED") throw new Error("Lightning-Zahlung fehlgeschlagen");
    // IN_FLIGHT / SUCCEEDED = ok. Bei Hold-Invoice ist IN_FLIGHT das Ziel.
  }

  /**
   * Bezahlt eine NORMALE Rechnung und wartet bis zum Abschluss.
   *
   * Unterschied zu payHoldInvoice(): dort ist IN_FLIGHT das Ziel, weil eine
   * Hold-Invoice per Design offen bleibt. Hier wird der Stream bis SUCCEEDED
   * gelesen, weil das Preimage erst dann existiert — und ohne Preimage gäbe es
   * keinen prüfbaren Zahlungsbeweis für den Fee-Split.
   */
  async payInvoiceAndGetPreimage(bolt11: string, timeoutMs = 60_000): Promise<string> {
    return this.zahleUndWarte({ payment_request: bolt11, timeout_seconds: Math.ceil(timeoutMs / 1000) }, timeoutMs);
  }

  /**
   * Gegenrichtung (4.6b): zahlt die Rechnung des Kunden mit `cltv_limit` und
   * wartet auf das Ergebnis. Haelt der Kunde das Preimage zurueck, bleibt die
   * Zahlung bis zum cltv_limit in der Schwebe – deshalb die lange Wartezeit.
   */
  async payInvoice(bolt11: string, cltvLimitBlocks: number, timeoutMs = cltvLimitBlocks * 1200_000 + 600_000): Promise<{ preimage: Uint8Array }> {
    if (!Number.isSafeInteger(cltvLimitBlocks) || cltvLimitBlocks <= 0) throw new Error("cltv_limit muss positiv sein");
    const hex = await this.zahleUndWarte({ payment_request: bolt11, cltv_limit: cltvLimitBlocks, timeout_seconds: 120 }, timeoutMs);
    return { preimage: fromHex(hex) };
  }

  /**
   * Stand einer Zahlung (4.6b) – nach einem Neustart des Daemons: War sie
   * erfolgreich, liefert LND das Preimage, und der LP kann noch einloesen.
   */
  async zahlungsstand(paymentHash: Uint8Array): Promise<{ status: "erfolgreich" | "gescheitert" | "laeuft" | "unbekannt"; preimage?: Uint8Array }> {
    const b64url = Buffer.from(paymentHash).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await fetch(`${this.cfg.restUrl}/v2/router/track/${b64url}`, {
      method: "GET",
      headers: { "Grpc-Metadata-macaroon": this.cfg.macaroonHex },
      signal: AbortSignal.timeout(30_000),
      dispatcher: await this.dispatcher(),
    } as RequestInit);
    // Nie angekommen: 404 oder „payment isn't initiated“ (je nach Version als HTTP-Fehler oder im Strom).
    const nieAngekommen = (text: string) => /isn't initiated|not initiated|not found/i.test(text);
    if (res.status === 404) return { status: "unbekannt" };
    if (!res.ok) {
      const text = await res.text();
      if (nieAngekommen(text)) return { status: "unbekannt" };
      throw new Error(`LND trackpayment: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    // Der erste Eintrag des Stroms ist der aktuelle Stand.
    const erster = await this.ersterEintrag(res);
    if (erster?.error) {
      const text = erster.error.message ?? JSON.stringify(erster.error);
      if (nieAngekommen(text)) return { status: "unbekannt" };
      throw new Error(`LND trackpayment: ${text.slice(0, 200)}`);
    }
    const r = erster?.result;
    if (r?.status === "SUCCEEDED" && r.payment_preimage) return { status: "erfolgreich", preimage: preimageAusLnd(r.payment_preimage) };
    if (r?.status === "FAILED") return { status: "gescheitert" };
    if (r?.status === "IN_FLIGHT" || r?.status === "INITIATED") return { status: "laeuft" };
    return { status: "unbekannt" };
  }

  private async ersterEintrag(res: Response): Promise<{ result?: { status?: string; payment_preimage?: string }; error?: { message?: string } } | undefined> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        // Nur vollstaendige Zeilen – am Ende des Stroms auch die letzte.
        const teile = buffer.split("\n");
        const zeile = (done ? teile : teile.slice(0, -1)).find((z) => z.trim());
        if (zeile) return JSON.parse(zeile);
        if (done) return undefined;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  /** Zahlung ueber /v2/router/send; liest den Strom bis zum Endergebnis, liefert das Preimage (hex). */
  private async zahleUndWarte(body: Record<string, unknown>, timeoutMs: number): Promise<string> {
    const res = await fetch(`${this.cfg.restUrl}/v2/router/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Grpc-Metadata-macaroon": this.cfg.macaroonHex,
      },
      body: JSON.stringify({ ...body, no_inflight_updates: true }), // uns interessiert nur das Endergebnis
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: await this.dispatcher(),
    } as RequestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LND payInvoice: HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const update = JSON.parse(line) as {
            result?: { status?: string; payment_preimage?: string; failure_reason?: string };
            error?: { message?: string };
          };
          if (update.error) throw new Error(`LND: ${update.error.message ?? JSON.stringify(update.error)}`);
          const r = update.result;
          if (r?.status === "FAILED") {
            throw new Error(`Zahlung fehlgeschlagen: ${r.failure_reason ?? "Grund unbekannt"}`);
          }
          if (r?.status === "SUCCEEDED" && r.payment_preimage) {
            // Der Beweis braucht Hex.
            return toHex(preimageAusLnd(r.payment_preimage));
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    throw new Error("LND lieferte kein Ergebnis zur Zahlung");
  }

  async getInvoiceState(paymentHash: Uint8Array): Promise<HoldInvoiceState> {
    // Base64 muss URL-encodiert werden (+ / =), sonst HTTP 400.
    const b64 = encodeURIComponent(Buffer.from(paymentHash).toString("base64"));
    const r = (await this.call(
      "GET",
      `/v2/invoices/lookup?payment_hash=${b64}`,
    )) as { state?: string };
    switch (r.state) {
      case "OPEN": return "OPEN";
      case "ACCEPTED": return "ACCEPTED";
      case "SETTLED": return "SETTLED";
      case "CANCELED": return "CANCELED";
      default: return "OPEN";
    }
  }

  async settleHoldInvoice(preimage: Uint8Array): Promise<void> {
    await this.call("POST", "/v2/invoices/settle", {
      preimage: Buffer.from(preimage).toString("base64"),
    });
  }

  async cancelHoldInvoice(paymentHash: Uint8Array): Promise<void> {
    await this.call("POST", "/v2/invoices/cancel", {
      payment_hash: Buffer.from(paymentHash).toString("base64"),
    });
  }

  /**
   * Keysend: spontane Zahlung ohne Invoice an einen Node-Pubkey.
   * Transport fuer Streaming-Sats (stream.ts): Sub-Satoshi-Betraege,
   * keine Invoice pro Micropayment noetig.
   * Gibt den Payment-Hash zurueck (Beleg-Referenz).
   */
  async keysend(destPubkeyHex: string, amountMsat: number): Promise<string> {
    const preimage = generatePreimage();
    const paymentHashBytes = sha256(preimage);
    const dest = Buffer.from(destPubkeyHex, "hex");
    const res = await fetch(`${this.cfg.restUrl}/v2/router/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Grpc-Metadata-macaroon": this.cfg.macaroonHex,
      },
      body: JSON.stringify({
        dest: dest.toString("base64"),
        amt_msat: String(amountMsat),
        // Keysend: Preimage wird dem Empfaenger in den finalen HTLC-TLV-
        // Records mitgegeben (Record 5482373484 = Keysend-Preimage).
        dest_custom_records: { "5482373484": Buffer.from(preimage).toString("base64") },
        payment_hash: Buffer.from(paymentHashBytes).toString("base64"),
        timeout_seconds: 60,
        no_inflight_updates: false,
      }),
      signal: AbortSignal.timeout(70_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LND keysend: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let paymentHash = "";
    // Stream lesen bis SUCCEEDED/FAILED (Keysend ist schnell final)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split("\n")) {
        if (!line.trim()) continue;
        try {
          const u = JSON.parse(line) as { result?: { status?: string; payment_hash?: string } };
          if (u.result?.payment_hash) paymentHash = u.result.payment_hash;
          if (u.result?.status === "FAILED") throw new Error("Keysend fehlgeschlagen");
          if (u.result?.status === "SUCCEEDED") {
            await reader.cancel().catch(() => {});
            return paymentHash;
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    return paymentHash;
  }
}

/** Hilfsfunktion: Macaroon-Datei laden und als Hex liefern. */
export async function loadMacaroonHex(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  return buf.toString("hex");
}

export { toHex, fromHex };

/**
 * Preimage aus einer LND-Antwort: `lnrpc.Payment` nennt es als Hex-Text,
 * andere Antworten als base64-Bytes. Beides wird angenommen – aber nur mit
 * genau 32 Byte; alles andere waere ein Beleg, den niemand pruefen kann.
 */
export function preimageAusLnd(wert: string): Uint8Array {
  const bytes = /^[0-9a-f]{64}$/i.test(wert) ? fromHex(wert) : Uint8Array.from(Buffer.from(wert, "base64"));
  if (bytes.length !== 32) throw new Error("LND lieferte ein Preimage mit falscher Laenge");
  return bytes;
}
