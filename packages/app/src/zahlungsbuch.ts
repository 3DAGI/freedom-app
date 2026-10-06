/**
 * Verlauf der eigenen Zahlungen (Schritt 12.7c), ohne DOM.
 *
 * Was die App über ihre Zahlschienen schickt, merkt sie nach dem Zahlen:
 * Zeit, Schiene, Zweck, Betrag, Ziel und Beleg (Preimage bzw. Signatur) –
 * nur im Tresor (`freedom.zahlungen`), denn die Liste verrät, wen man wann
 * bezahlt hat; nie in der Sicherung auf Relays, wohl aber im Datenexport.
 * Die neuesten `ZAHLUNGEN_MAX`. Gelesen wird streng: was nicht passt, fällt weg.
 *
 * Dazu der Verlauf der eigenen Lightning-Wallet über NWC (`list_transactions`,
 * NIP-47) – auch Eingänge. Was die Wallet schickt, sind Fremddaten: nur
 * Zahlen und kurzer Text, gezeigt nur als Text.
 */
import type { Beleg, RailId, Zweck } from "@freedomstack/protocol";

export const LS_ZAHLUNGEN = "freedom.zahlungen";
export const ZAHLUNGEN_MAX = 500;
/** So viele Buchungen fragt die App bei der Wallet an. */
export const NWC_VERLAUF_MAX = 50;
const ZWECKE: readonly Zweck[] = ["zap", "job", "sitzung", "deposit", "trinkgeld", "gebuehr", "swap", "relay", "anforderung", "senden"];

export interface Zahlung {
  /** Unix-Sekunden. */
  zeit: number;
  rail: RailId;
  zweck: Zweck;
  einheit: "msat" | "lamports";
  wert: number;
  /** Rechnung, Lightning-Adresse oder Solana-Adresse. */
  ziel: string;
  /** Preimage (Lightning) bzw. Transaktions-Signatur (Solana). */
  ref: string;
}

type Lesen = { getItem(k: string): string | null };
type Schreiben = Lesen & { setItem(k: string, v: string): unknown };

const zahl = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const text = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max;

function gueltig(x: unknown): x is Zahlung {
  if (!x || typeof x !== "object") return false;
  const z = x as Record<string, unknown>;
  return zahl(z.zeit) && (z.rail === "lightning" || z.rail === "solana") && ZWECKE.includes(z.zweck as Zweck)
    && (z.einheit === (z.rail === "lightning" ? "msat" : "lamports")) && zahl(z.wert) && (z.wert as number) > 0
    && text(z.ziel, 2000) && text(z.ref, 200);
}

/** Alle gemerkten Zahlungen, neueste zuerst. */
export function leseZahlungen(s: Lesen): Zahlung[] {
  let roh: unknown;
  try {
    roh = JSON.parse(s.getItem(LS_ZAHLUNGEN) ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(roh) ? roh.filter(gueltig).sort((a, b) => b.zeit - a.zeit) : [];
}

/** Eine Zahlung nach dem Zahlen merken – vorn anfügen, die ältesten fallen weg. */
export async function merkeZahlung(s: Schreiben, zweck: Zweck, b: Beleg): Promise<void> {
  const neu: Zahlung = { zeit: b.zeit, rail: b.rail, zweck, einheit: b.betrag.einheit, wert: b.betrag.wert, ziel: b.ziel, ref: b.ref };
  if (!gueltig(neu)) return;
  await s.setItem(LS_ZAHLUNGEN, JSON.stringify([neu, ...leseZahlungen(s)].slice(0, ZAHLUNGEN_MAX)));
}

/** Eine Buchung der Lightning-Wallet (NWC). */
export interface WalletBuchung {
  richtung: "ein" | "aus";
  msat: number;
  /** Unix-Sekunden – bezahlt, sonst angelegt. */
  zeit: number;
  /** Beschreibung der Rechnung – Fremdtext, gekürzt. */
  notiz: string;
}

/** Antwort von `list_transactions` lesen – nur, was passt; neueste zuerst. */
export function leseWalletBuchungen(antwort: unknown): WalletBuchung[] {
  const liste = (antwort as { transactions?: unknown } | null)?.transactions;
  if (!Array.isArray(liste)) return [];
  const out: WalletBuchung[] = [];
  for (const x of liste.slice(0, NWC_VERLAUF_MAX)) {
    const b = (x ?? {}) as Record<string, unknown>;
    if (b.type !== "incoming" && b.type !== "outgoing") continue;
    if (!zahl(b.amount) || b.amount === 0) continue;
    const zeit = zahl(b.settled_at) ? b.settled_at : zahl(b.created_at) ? b.created_at : undefined;
    if (zeit === undefined) continue;
    const notiz = typeof b.description === "string" ? b.description.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    out.push({ richtung: b.type === "incoming" ? "ein" : "aus", msat: b.amount, zeit, notiz });
  }
  return out.sort((a, b) => b.zeit - a.zeit);
}
