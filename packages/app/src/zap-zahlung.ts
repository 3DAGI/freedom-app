/**
 * Zap-Rechnung holen (NIP-57, Schritt 4.1b) – ohne DOM und ohne Wallet.
 *
 * Bisher steckte das in zwei Kopien (Chat-Zap und ein nie angezeigter
 * Zap-Knopf im Wallet-Tab), beide mit eigener Wallet-Suche. Jetzt holt dieser
 * Baustein nur die Rechnung; bezahlt wird ueber die Zahlschiene, die den
 * Betrag der Rechnung prueft.
 */
import { t } from "./i18n.js";

export interface ZapRechnungEingabe {
  /** Lightning-Adresse des Empfaengers (lud16 aus seinem Profil). */
  lud16: string;
  betragMsat: number;
  /** Signierter Zap-Request (Kind 9734) als Event-Objekt. */
  zapRequest: unknown;
  holen?: typeof fetch;
}

const LUD16 = /^([a-z0-9._+-]{1,64})@([a-z0-9.-]{1,253}\.[a-z]{2,})$/i;

/** LNURL-pay mit Zap-Request: liefert die bolt11-Rechnung. */
export async function holeZapRechnung(e: ZapRechnungEingabe): Promise<string> {
  const m = LUD16.exec(e.lud16.trim());
  if (!m) throw new Error(t("zahl.empfaengerOhneAdresse"));
  const holen = e.holen ?? fetch;
  const r = await holen(`https://${m[2]}/.well-known/lnurlp/${encodeURIComponent(m[1])}`);
  if (!r.ok) throw new Error(t("zahl.adresseNichtErreichbar", { status: r.status }));
  const d = (await r.json()) as { callback?: string; allowsNostr?: boolean; minSendable?: number; maxSendable?: number };
  if (typeof d.callback !== "string" || !d.callback.startsWith("https://")) throw new Error(t("zahl.adresseOhneCallback"));
  if (!d.allowsNostr) throw new Error(t("zahl.keineZaps"));
  if ((d.minSendable !== undefined && e.betragMsat < d.minSendable) || (d.maxSendable !== undefined && e.betragMsat > d.maxSendable)) {
    throw new Error(t("zahl.betragAusserhalb", { min: d.minSendable ?? 0, max: d.maxSendable ?? "∞" }));
  }
  const cb = new URL(d.callback);
  cb.searchParams.set("amount", String(e.betragMsat));
  cb.searchParams.set("nostr", JSON.stringify(e.zapRequest));
  const rr = await holen(cb.toString());
  const dd = (await rr.json()) as { pr?: string };
  if (typeof dd.pr !== "string") throw new Error(t("zahl.keineRechnungEmpfaenger"));
  return dd.pr;
}

/** SOL-Adresse aus einem Profil (Konvention: Feld `sol` im Inhalt von Kind 0). */
export function solAdresseAusProfil(content: string): string {
  try {
    const sol = (JSON.parse(content || "{}") as { sol?: unknown }).sol;
    return typeof sol === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sol) ? sol : "";
  } catch {
    return "";
  }
}
