/**
 * Telegram Stars (XTR) — serverseitiger Zahlungsablauf.
 *
 * Telegram-Vorgabe für digitale Güter:
 *   1. createInvoiceLink(currency=XTR, provider_token="", ein LabeledPrice,
 *      amount = ganze Sterne) → Link `t.me/$...`
 *   2. Update `pre_checkout_query` → answerPreCheckoutQuery(ok) binnen 10 s
 *   3. Update `successful_payment` → Gutschrift buchen, charge_id speichern
 *      (für spätere Rückerstattung: refundStarPayment)
 *
 * Wir empfangen Updates über Long-Polling (getUpdates) statt Webhook — der
 * Node hat keinen öffentlichen HTTPS-Endpunkt. Konflikt mit dem Hermes-Bot
 * entsteht nicht, weil wir einen EIGENEN Bot verwenden.
 */
import { createHmac, randomUUID } from "node:crypto";

const API = "https://api.telegram.org";

/** Bot-API-Basis — per TELEGRAM_API_BASE umbiegbar (Tests, Proxies). */
const apiBase = (): string => process.env.TELEGRAM_API_BASE ?? API;

export interface StarsRechnung {
  auftrag: string;
  stars: number;
  userId: number;
}

export interface StarsGutschrift {
  chargeId: string;
  userId: number;
  stars: number;
  payload: string;
  at: number;
}

interface BotApi {
  (methode: string, params: Record<string, unknown>): Promise<unknown>;
}

function botApi(token: string): BotApi {
  return async (methode, params) => {
    const r = await fetch(`${apiBase()}/bot${token}/${methode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const j = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!j.ok) throw new Error(`${methode}: ${j.description ?? r.status}`);
    return j.result;
  };
}

/** Preis je Auftrag — feste Tabelle, nie aus dem Request übernehmen. */
const PREISE: Record<string, number> = {
  "ki-basis": 25,      // eine KI-Anfrage
  "ki-stunden": 200,   // Stundenpaket
  "ki-tag": 1500,      // Tagespaket
};
export function starsPreis(auftrag: string): number | undefined {
  return PREISE[auftrag];
}

/**
 * Legt eine Rechnung an. `payload` ist unsere interne Kennung (max 128 Byte).
 * Preis kommt aus PREISE — der Request-Preis wird ignoriert (Verhindert
 * Manipulation: 1 Stern für alles).
 */
export async function erstelleStarsRechnung(token: string, auftrag: string, userId: number): Promise<{ link: string; stars: number; payload: string }> {
  const stars = starsPreis(auftrag);
  if (stars === undefined) throw new Error(`kein Preis für ${auftrag}`);
  const payload = `${auftrag}:${randomUUID().slice(0, 8)}`;
  const api = botApi(token);
  const link = (await api("createInvoiceLink", {
    title: `FREEDOM — ${auftrag}`,
    description: `${stars} Telegram Sterne`,
    payload,
    currency: "XTR",
    provider_token: "",           // digital goods: kein Provider
    prices: [{ label: auftrag, amount: stars }], // amount in GANZEN Sternen
  })) as string;
  return { link, stars, payload };
}

/** Long-Polling: Updates einsammeln. */
export async function holeUpdates(token: string, offset: number, timeoutSek = 30): Promise<{ updates: unknown[]; nextOffset: number }> {
  const api = botApi(token);
  const updates = (await api("getUpdates", {
    offset,
    timeout: timeoutSek,
    allowed_updates: ["pre_checkout_query", "message"],
  })) as { update_id: number; pre_checkout_query?: Record<string, unknown>; message?: Record<string, unknown> }[];
  let next = offset;
  for (const u of updates) if (u.update_id >= next) next = u.update_id + 1;
  return { updates, nextOffset: next };
}

export async function antwortePreCheckout(token: string, queryId: string, ok: boolean, fehler?: string): Promise<void> {
  const api = botApi(token);
  await api("answerPreCheckoutQuery", {
    pre_checkout_query_id: queryId,
    ok,
    ...(ok ? {} : { error_message: fehler ?? "Zahlung nicht möglich" }),
  });
}

/** Guthaben aus einem successful_payment-Update buchen. */
export function erfolgreicheZahlung(msg: Record<string, unknown>): StarsGutschrift | undefined {
  const sp = msg.successful_payment as Record<string, unknown> | undefined;
  if (!sp) return undefined;
  const from = msg.from as { id?: number } | undefined;
  return {
    chargeId: String(sp.telegram_payment_charge_id ?? ""),
    userId: Number(from?.id ?? 0),
    stars: Number(sp.total_amount ?? 0),
    payload: String(sp.invoice_payload ?? ""),
    at: Math.floor(Number(sp.at ?? Date.now()) / 1000),
  };
}

/** Rückerstattung gegen die gespeicherte charge_id. */
export async function erstatteStars(token: string, userId: number, chargeId: string): Promise<boolean> {
  const api = botApi(token);
  try {
    return (await api("refundStarPayment", { user_id: userId, telegram_payment_charge_id: chargeId })) === true;
  } catch { return false; }
}

/** Signierter Session-Header (tma) — siehe tma-auth.ts. Hier nur der Helfer. */
export function sessionId(userId: number): string {
  // Stabil je Nutzer: hex der ID, Nostr-kompatibel aufgefüllt.
  return userId.toString(16).padStart(64, "0");
}

export { createHmac };
