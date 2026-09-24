/**
 * Nostr Wallet Connect (NIP-47) — Lightning auf JEDEM Gerät.
 *
 * DAS PROBLEM
 * Die App konnte Lightning bisher nur über WebLN, also über eine
 * Browser-Extension wie Alby. Extensions gibt es nur auf dem Desktop. Auf
 * iOS und Android existiert `window.webln` schlicht nicht — dort war der
 * Wallet-Tab tot, und `#ln-balance` zeigte dauerhaft "—". Für ein Projekt,
 * dessen Anspruch "ohne Ausnahme alle Geräte" ist, war das die größte Lücke.
 *
 * DIE LÖSUNG
 * NWC läuft über Nostr-Relays — also über genau die Infrastruktur, die dieses
 * Projekt ohnehin betreibt. Kein Extension-API, kein App-Store, kein
 * Plattform-Gatekeeper: Der Nutzer fügt eine Connect-URI ein (oder scannt sie
 * als QR), und ab da funktioniert Zahlen auf dem Handy exakt wie am Desktop.
 * Das ist auch architektonisch das Richtige — eine Zahlungsanbindung, die von
 * Google oder Apple abgeschaltet werden kann, widerspricht dem ganzen Zweck.
 *
 * NON-CUSTODIAL BLEIBT NON-CUSTODIAL
 * Die Connect-URI enthält ein Secret, das NUR für diese Verbindung gilt und
 * das das Wallet mit Limits versehen kann (Budget pro Monat, erlaubte
 * Methoden). Der Nutzer behält seine Keys; die App bekommt eine widerrufbare
 * Vollmacht, kein Konto.
 *
 * ABLAUF
 *   1. Wallet gibt URI: nostr+walletconnect://<wallet-pk>?relay=...&secret=...
 *   2. App verschlüsselt Kommandos an <wallet-pk> (kind 23194)
 *   3. Wallet antwortet verschlüsselt (kind 23195) mit result oder error
 *   4. Verschlüsselung: NIP-44 wenn das Wallet es ankündigt, sonst NIP-04
 */
import { NostrEvent, buildEvent, signEvent } from "./event.js";
import { fromHex, toHex } from "./htlc.js";
import { OutboxPool } from "./outbox.js";
import { encryptDM, decryptDM } from "./dm.js";
import { nip04Encrypt, nip04Decrypt, isNip04Payload } from "./nip04.js";
import { schnorr } from "@noble/curves/secp256k1.js";

/** NIP-47 Kinds. */
export const KIND_NWC_INFO = 13194;
export const KIND_NWC_REQUEST = 23194;
export const KIND_NWC_RESPONSE = 23195;

export interface NwcConnection {
  /** Pubkey des Wallet-Dienstes (hex). */
  walletPubkey: string;
  /** Relays, über die das Wallet erreichbar ist. */
  relays: string[];
  /** Verbindungs-Secret = der geheime Schlüssel DIESER Verbindung. */
  secretKey: Uint8Array;
  /** Abgeleiteter Pubkey der Verbindung (die "Identität" der App gegenüber dem Wallet). */
  clientPubkey: string;
  /** Optional: Lightning-Adresse des Nutzers, wenn das Wallet sie mitgibt. */
  lud16?: string;
}

/**
 * Parst eine Connect-URI.
 *
 * Format: nostr+walletconnect://<pubkey>?relay=<url>&secret=<hex>&lud16=<addr>
 * Mehrere relay-Parameter sind erlaubt und werden alle übernommen — das ist
 * die Redundanz, auf die das Protokoll sonst auch besteht.
 */
export function parseNwcUri(uri: string): NwcConnection {
  const trimmed = uri.trim();
  const prefix = ["nostr+walletconnect://", "nostr+walletconnect:"];
  const match = prefix.find((p) => trimmed.toLowerCase().startsWith(p));
  if (!match) {
    throw new Error("Keine NWC-Verbindung: erwartet wird nostr+walletconnect://…");
  }

  const rest = trimmed.slice(match.length);
  const qIdx = rest.indexOf("?");
  const walletPubkey = (qIdx === -1 ? rest : rest.slice(0, qIdx)).replace(/^\/+/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(walletPubkey)) {
    throw new Error("NWC-URI: Wallet-Pubkey ist kein gültiger 64-stelliger Hex-Wert.");
  }

  const params = new URLSearchParams(qIdx === -1 ? "" : rest.slice(qIdx + 1));
  const relays = params.getAll("relay").filter(Boolean);
  if (relays.length === 0) throw new Error("NWC-URI: kein relay angegeben.");

  const secretHex = (params.get("secret") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(secretHex)) {
    throw new Error("NWC-URI: secret fehlt oder ist kein 64-stelliger Hex-Wert.");
  }

  const secretKey = fromHex(secretHex);
  return {
    walletPubkey,
    relays,
    secretKey,
    clientPubkey: toHex(schnorr.getPublicKey(secretKey)),
    lud16: params.get("lud16") ?? undefined,
  };
}

/** Baut eine URI zurück (für Tests und zum Anzeigen ohne Secret). */
export function formatNwcUri(c: NwcConnection, includeSecret = true): string {
  const params = new URLSearchParams();
  for (const r of c.relays) params.append("relay", r);
  if (includeSecret) params.set("secret", toHex(c.secretKey));
  if (c.lud16) params.set("lud16", c.lud16);
  return `nostr+walletconnect://${c.walletPubkey}?${params.toString()}`;
}

/** Für die UI: URI ohne Secret, damit man sie gefahrlos anzeigen kann. */
export function redactNwcUri(uri: string): string {
  return uri.replace(/secret=[0-9a-fA-F]{64}/, "secret=…");
}

export type NwcEncryption = "nip44_v2" | "nip04";

/**
 * Liest das Info-Event (13194) des Wallets: unterstützte Methoden und
 * Verschlüsselung. Ohne Info-Event fallen wir auf NIP-04 zurück, weil das der
 * Stand ist, den ältere Wallets sicher können.
 */
export async function fetchWalletInfo(
  pool: OutboxPool,
  walletPubkey: string,
): Promise<{ methods: string[]; encryption: NwcEncryption }> {
  const events = await pool.query({ kinds: [KIND_NWC_INFO], authors: [walletPubkey], limit: 1 });
  if (events.length === 0) return { methods: [], encryption: "nip04" };

  const ev = events[0];
  const methods = ev.content.split(/\s+/).filter(Boolean);
  const encTag = ev.tags.find((t) => t[0] === "encryption")?.[1] ?? "";
  const encryption: NwcEncryption = encTag.includes("nip44_v2") ? "nip44_v2" : "nip04";
  return { methods, encryption };
}

async function encryptFor(
  payload: string,
  sk: Uint8Array,
  pk: string,
  enc: NwcEncryption,
): Promise<string> {
  return enc === "nip44_v2" ? encryptDM(payload, sk, pk) : nip04Encrypt(payload, sk, pk);
}

async function decryptFrom(content: string, sk: Uint8Array, pk: string): Promise<string> {
  // Am Payload erkennbar, welches Verfahren das Wallet genutzt hat — robuster
  // als sich auf die Ankündigung zu verlassen.
  return isNip04Payload(content) ? nip04Decrypt(content, sk, pk) : decryptDM(content, sk, pk);
}

export interface NwcRequest {
  method: string;
  params: Record<string, unknown>;
}

export interface NwcError {
  code: string;
  message: string;
}

/** Baut ein verschlüsseltes Kommando-Event (23194). */
export async function buildNwcRequest(
  conn: NwcConnection,
  req: NwcRequest,
  enc: NwcEncryption = "nip04",
  expirationSecs?: number,
): Promise<NostrEvent> {
  const content = await encryptFor(JSON.stringify(req), conn.secretKey, conn.walletPubkey, enc);
  const tags: string[][] = [["p", conn.walletPubkey]];
  if (enc === "nip44_v2") tags.push(["encryption", "nip44_v2"]);
  if (expirationSecs) {
    // Verhindert, dass ein liegengebliebenes Kommando Tage später ausgeführt
    // wird — bei Zahlungsbefehlen ist das keine Feinheit.
    tags.push(["expiration", String(Math.floor(Date.now() / 1000) + expirationSecs)]);
  }
  return signEvent(buildEvent(conn.clientPubkey, KIND_NWC_REQUEST, tags, content), conn.secretKey);
}

/** Entschlüsselt und parst eine Wallet-Antwort (23195). */
export async function parseNwcResponse(
  ev: NostrEvent,
  conn: NwcConnection,
): Promise<{ resultType: string; result?: Record<string, unknown>; error?: NwcError }> {
  const json = await decryptFrom(ev.content, conn.secretKey, conn.walletPubkey);
  const parsed = JSON.parse(json) as {
    result_type?: string;
    result?: Record<string, unknown>;
    error?: NwcError;
  };
  return { resultType: parsed.result_type ?? "", result: parsed.result, error: parsed.error };
}

/** Fehlercodes aus NIP-47 in verständliche Sätze übersetzen. */
export function explainNwcError(err: NwcError): string {
  switch (err.code) {
    case "INSUFFICIENT_BALANCE":
      return "Das Wallet hat nicht genug Guthaben für diese Zahlung.";
    case "QUOTA_EXCEEDED":
      return "Das für diese Verbindung gesetzte Budget ist aufgebraucht. Im Wallet erhöhen.";
    case "RESTRICTED":
      return "Diese Verbindung darf die angeforderte Aktion nicht ausführen.";
    case "UNAUTHORIZED":
      return "Die Verbindung wurde im Wallet widerrufen. Bitte neu verbinden.";
    case "NOT_IMPLEMENTED":
      return "Dieses Wallet unterstützt die angeforderte Funktion nicht.";
    case "PAYMENT_FAILED":
      return "Die Zahlung ist fehlgeschlagen — meist fehlt eine Route zum Empfänger.";
    case "RATE_LIMITED":
      return "Zu viele Anfragen an das Wallet. Kurz warten.";
    default:
      return err.message || `Wallet-Fehler: ${err.code}`;
  }
}

/**
 * NWC-Client: läuft im Browser wie im Node-Prozess, auf Mobile wie am Desktop.
 *
 * Bewusst über denselben OutboxPool wie alles andere — damit gilt auch hier
 * Multi-Relay statt Single-Relay.
 */
export class NwcClient {
  private encryption: NwcEncryption = "nip04";
  private methods: string[] = [];
  private ready = false;

  constructor(
    private conn: NwcConnection,
    private pool: OutboxPool,
    private timeoutMs = 30_000,
  ) {}

  get connection(): NwcConnection {
    return this.conn;
  }

  /** Fähigkeiten des Wallets holen. Fehlschlag ist kein Abbruch (NIP-04-Fallback). */
  async init(): Promise<{ methods: string[]; encryption: NwcEncryption }> {
    try {
      const info = await fetchWalletInfo(this.pool, this.conn.walletPubkey);
      this.encryption = info.encryption;
      this.methods = info.methods;
    } catch {
      this.encryption = "nip04";
      this.methods = [];
    }
    this.ready = true;
    return { methods: this.methods, encryption: this.encryption };
  }

  supports(method: string): boolean {
    // Kennen wir die Liste nicht, nicht vorschnell "nein" sagen — probieren
    // und den echten Fehler des Wallets zeigen ist ehrlicher als raten.
    return this.methods.length === 0 || this.methods.includes(method);
  }

  /** Ein Kommando senden und auf die Antwort warten. */
  async call(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.ready) await this.init();
    if (!this.supports(method)) {
      throw new Error(`Dieses Wallet unterstützt "${method}" nicht.`);
    }

    const req = await buildNwcRequest(
      this.conn,
      { method, params },
      this.encryption,
      Math.ceil(this.timeoutMs / 1000) + 60,
    );
    const report = await this.pool.publish(req);
    if (report.accepted.length === 0) {
      throw new Error("Kein Relay hat das Wallet-Kommando angenommen — Netzwerkproblem.");
    }

    const deadline = Date.now() + this.timeoutMs;
    let pollMs = 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      pollMs = Math.min(pollMs * 1.5, 4000); // sanftes Backoff statt Dauerfeuer
      const responses = await this.pool.query({
        kinds: [KIND_NWC_RESPONSE],
        authors: [this.conn.walletPubkey],
        "#e": [req.id],
        limit: 1,
      });
      if (responses.length === 0) continue;

      const res = await parseNwcResponse(responses[0], this.conn);
      if (res.error) throw new Error(explainNwcError(res.error));
      return res.result ?? {};
    }
    throw new Error(
      `Das Wallet hat in ${Math.round(this.timeoutMs / 1000)}s nicht geantwortet. ` +
        `Ist es online und mit denselben Relays verbunden?`,
    );
  }

  /** Guthaben in msat. */
  async getBalance(): Promise<number> {
    const r = await this.call("get_balance");
    return Number(r.balance ?? 0);
  }

  /** Rechnung bezahlen. Gibt das Preimage zurück — den Zahlungsbeweis. */
  async payInvoice(bolt11: string, amountMsat?: number): Promise<{ preimage: string; feesPaidMsat: number }> {
    const params: Record<string, unknown> = { invoice: bolt11 };
    if (amountMsat) params.amount = amountMsat;
    const r = await this.call("pay_invoice", params);
    return {
      preimage: String(r.preimage ?? ""),
      feesPaidMsat: Number(r.fees_paid ?? 0),
    };
  }

  /** Keysend: direkt an einen Node-Pubkey, ohne Rechnung. */
  async payKeysend(destination: string, amountMsat: number): Promise<{ preimage: string }> {
    const r = await this.call("pay_keysend", { pubkey: destination, amount: amountMsat });
    return { preimage: String(r.preimage ?? "") };
  }

  /** Rechnung erzeugen (zum Empfangen). */
  async makeInvoice(amountMsat: number, description = ""): Promise<{ invoice: string; paymentHash: string }> {
    const r = await this.call("make_invoice", { amount: amountMsat, description });
    return { invoice: String(r.invoice ?? ""), paymentHash: String(r.payment_hash ?? "") };
  }

  async getInfo(): Promise<Record<string, unknown>> {
    return this.call("get_info");
  }
}

/**
 * Erkennt, wie auf DIESEM Gerät bezahlt werden kann.
 *
 * Reihenfolge nach Zuverlässigkeit, nicht nach Bequemlichkeit: NWC läuft
 * überall gleich, WebLN nur auf Desktop-Browsern mit Extension.
 */
export function detectPaymentCapabilities(userAgentOverride?: string): {
  webln: boolean;
  isMobile: boolean;
  recommendation: "nwc" | "webln";
  note: string;
} {
  const w = globalThis as unknown as { webln?: unknown; navigator?: { userAgent?: string } };
  const ua = userAgentOverride ?? w.navigator?.userAgent ?? "";
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const webln = typeof w.webln !== "undefined";

  if (isMobile) {
    return {
      webln,
      isMobile,
      recommendation: "nwc",
      note: "Verbinde deine Wallet über einen NWC-Link oder QR-Code aus deiner Wallet-App.",
    };
  }
  return {
    webln,
    isMobile,
    recommendation: webln ? "webln" : "nwc",
    note: webln
      ? "Browser-Wallet erkannt. Ein NWC-Link funktioniert zusätzlich auf allen Geräten."
      : "Verbinde deine Wallet über einen NWC-Link aus deiner Wallet-App.",
  };
}
