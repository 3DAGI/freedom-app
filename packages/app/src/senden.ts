/**
 * Geld senden aus der Wallet (Schritt 12.7a), ohne DOM.
 *
 * Wohin: was Wallets und QR-Codes üblicherweise tragen – eine Rechnung
 * (`lnbc…`, auch mit `lightning:` davor), eine Lightning-Adresse
 * (`name@host`), eine Solana-Adresse oder eine Adresse nach Solana Pay
 * (`solana:<adresse>?amount=…&reference=…`, nur natives SOL). Daraus folgt
 * die Schiene; die App weicht nie auf die andere aus. Eine Rechnung trägt
 * ihren Betrag selbst – eine ohne Betrag nimmt die App nicht, die Schiene
 * prüft den Betrag der Rechnung gegen den gewollten (`LightningRail.pay`).
 */
import { leseBolt11, railFuerZiel, type Betrag, type RailId } from "@freedomstack/protocol";
import { ganzeSats } from "./shell-logic.js";
import { solZuLamports } from "./zahlungs-anforderung.js";

/** Warum ein Ziel nicht taugt – Kennungen, die Texte macht die Oberfläche. */
export type SendeFall = "leer" | "unbekannt" | "rechnung-unlesbar" | "rechnung-ohne-betrag" | "nur-sol" | "referenz" | "betrag";

export interface SendeZiel {
  rail: RailId;
  /** Ziel für die Zahlschiene: Rechnung, Lightning-Adresse oder Solana-Adresse. */
  ziel: string;
  /** Betrag aus dem Ziel selbst (Rechnung, `amount=`) – dann gilt nur er. */
  betrag?: Betrag;
  /** Solana Pay `reference` – geht als Referenz mit der Überweisung, damit der Empfänger sie zuordnet. */
  referenz?: string;
}

/** Ziel aus der Eingabe lesen – oder sagen, warum es nicht geht. */
export function leseSendeZiel(roh: string): SendeZiel | { fall: SendeFall } {
  const text = roh.trim();
  if (!text) return { fall: "leer" };
  const sol = /^solana:([^?\s]+)(?:\?(\S*))?$/i.exec(text);
  if (sol) {
    if (railFuerZiel(sol[1]) !== "solana") return { fall: "unbekannt" };
    const q = new URLSearchParams(sol[2] ?? "");
    if (q.has("spl-token")) return { fall: "nur-sol" };
    const refs = q.getAll("reference");
    if (refs.length > 1 || (refs.length === 1 && railFuerZiel(refs[0]) !== "solana")) return { fall: "referenz" };
    const menge = q.get("amount");
    const lamports = menge === null ? undefined : solZuLamports(menge);
    if (menge !== null && !lamports) return { fall: "betrag" };
    return {
      rail: "solana", ziel: sol[1],
      ...(lamports ? { betrag: { einheit: "lamports" as const, wert: lamports } } : {}),
      ...(refs.length === 1 ? { referenz: refs[0] } : {}),
    };
  }
  const ziel = text.replace(/^lightning:/i, "");
  const rail = railFuerZiel(ziel);
  if (rail === "solana") return { rail, ziel };
  if (rail !== "lightning") return { fall: "unbekannt" };
  if (ziel.includes("@")) return { rail, ziel: ziel.toLowerCase() };
  let msat: number | null;
  try {
    msat = leseBolt11(ziel).betragMsat;
  } catch {
    return { fall: "rechnung-unlesbar" };
  }
  if (!msat || msat <= 0 || !Number.isSafeInteger(msat)) return { fall: "rechnung-ohne-betrag" };
  return { rail, ziel: ziel.toLowerCase(), betrag: { einheit: "msat", wert: msat } };
}

/** Betrag aus dem Eingabefeld in der Einheit der Schiene: ganze sats bzw. SOL (Komma oder Punkt). */
export function sendeBetrag(rail: RailId, eingabe: string): Betrag | undefined {
  if (rail === "lightning") {
    const sats = ganzeSats(eingabe);
    return sats && Number.isSafeInteger(sats * 1000) ? { einheit: "msat", wert: sats * 1000 } : undefined;
  }
  const lamports = solZuLamports(eingabe.trim().replace(",", "."));
  return lamports ? { einheit: "lamports", wert: lamports } : undefined;
}

/**
 * Der Betrag, der gilt: der aus dem Ziel, sonst der eingegebene. Nennt das Ziel
 * einen und die Eingabe einen anderen, gilt keiner – die Oberfläche fragt nach.
 */
export function geltenderBetrag(z: SendeZiel, eingabe: string): Betrag | "widerspruch" | undefined {
  const getippt = eingabe.trim() ? sendeBetrag(z.rail, eingabe) : undefined;
  if (!z.betrag) return getippt;
  if (getippt && getippt.wert !== z.betrag.wert) return "widerspruch";
  return z.betrag;
}

/** Ziel zum Anzeigen: Adressen ganz (zum Vergleichen), Rechnungen gekürzt. */
export function zielAnzeige(z: SendeZiel): string {
  return z.rail === "lightning" && !z.ziel.includes("@") ? `${z.ziel.slice(0, 16)}…${z.ziel.slice(-8)}` : z.ziel;
}
