/**
 * Stars-Checkout im Mini App (FREEDOM_TMA=1).
 *
 * Ablauf (Telegram-Vorgabe für digitale Güter):
 * 1. Client ruft `/tma/stars/invoice` → Server erzeugt über `createInvoiceLink`
 *    einen Link (`t.me/$...`) mit currency=XTR, genau ein LabeledPrice, ganzen
 *    Stars. payload = unsere interne Auftragskennung.
 * 2. Client zeigt den Link als Button — Telegram öffnet das native Sheet.
 * 3. Telegram schickt dem Server `pre_checkout_query` (10 s Antwortfrist) →
 *    Server prüft Betrag/Payload und antwortet `answerPreCheckoutQuery(ok)`.
 * 4. Nach erfolgreicher Zahlung kommt `successful_payment` mit
 *    `telegram_payment_charge_id` — Server hinterlegt das Guthaben und
 *    benachrichtigt den Client per `/tma/stars/status`.
 *
 * Wichtig: Nie vor `successful_payment` liefern — answerPreCheckout allein
 * garantiert keine Zahlung.
 */
import { tmaHaptic, tmaUserHex } from "./tma.js";
import { toast } from "./ui.js";
import { t } from "../i18n.js";

export interface StarsInvoice {
  /** t.me/$... Link, per Telegram.WebApp.openInvoice geöffnet. */
  link: string;
  /** Unsere Auftragskennung (kommt als invoice_payload zurück). */
  payload: string;
  /** Preis in ganzen Stars. */
  stars: number;
}

export interface StarsStatus {
  /** Stars-Guthaben (noch nicht ausgegeben). */
  balance: number;
  /** Zuletzt geladene Transaktionen (charge_id → Auftrag). */
  recent: { chargeId: string; stars: number; payload: string; at: number }[];
}

/** Server-Endpoint — konfigurierbar für lokale Tests. */
function endpoint(path: string): string {
  return `/tma/stars/${path}`;
}

/**
 * Legt eine Rechnung an und öffnet Telegram's natives Stars-Sheet.
 * `auftrag` ist die interne Kennung (Auftrags-ID), `stars` der Preis.
 * Resolved erst nach erfolgreicher Zahlung (via successful_payment-Update am
 * Server); der Link öffnet nur das Sheet.
 */
export async function zahleMitStars(auftrag: string, stars: number): Promise<void> {
  const u = tmaUserHex();
  if (!u) { toast(t("tma.stars.keinNutzer") ?? "Nicht in Telegram", true); return; }
  if (!Number.isInteger(stars) || stars <= 0) { toast(t("tma.stars.betrag"), true); return; }
  let inv: StarsInvoice;
  try {
    const r = await fetch(endpoint("invoice"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auftrag, stars }),
    });
    if (!r.ok) throw new Error(`invoice ${r.status}`);
    inv = await r.json();
  } catch (e) {
    toast(`${t("tma.stars.fehlschlag") ?? "Rechnung fehlgeschlagen"}: ${(e as Error).message}`, true);
    return;
  }
  openStarsInvoice(inv);
}

/**
 * Öffnet das native Sheet. In Telegram gibt es `openInvoice` — im normalen
 * Browser (Test) öffnen wir den t.me-Link in neuem Tab.
 */
export function openStarsInvoice(inv: StarsInvoice): void {
  const wa = (globalThis as unknown as { Telegram?: { WebApp?: { openInvoice?(u: string, cb?: (s: string) => void): void } } }).Telegram?.WebApp;
  if (wa?.openInvoice) {
    wa.openInvoice(inv.link, (status) => {
      if (status === "paid") { tmaHaptic(true); toast(t("tma.stars.bezahlt") ?? "Bezahlt ⭐"); }
      else if (status === "failed") { tmaHaptic(false); toast(t("tma.stars.fehlschlag") ?? "Zahlung fehlgeschlagen", true); }
      else if (status === "pending") toast(t("tma.stars.ausstehend") ?? "Zahlung ausstehend…");
      else toast(t("tma.stars.abgebrochen") ?? "Abgebrochen");
    });
    return;
  }
  window.open(inv.link, "_blank", "noopener");
}

/** Aktuelles Stars-Guthaben + letzte Zahlungen (für die Anzeige). */
export async function starsStatus(): Promise<StarsStatus | undefined> {
  try {
    const r = await fetch(endpoint("status"));
    if (!r.ok) return undefined;
    return await r.json();
  } catch { return undefined; }
}

/** Sterne → EUR-Richtwert (Telegram-Kurs ~0,013 $/Stern; nur Anzeige). */
export function starsNachEur(stars: number, kursUsdProStern = 0.013, usdNachEur = 0.92): number {
  return stars * kursUsdProStern * usdNachEur;
}
