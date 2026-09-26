/**
 * SOL ohne Internet in der App (Schritt 7.2b): Ablage des Nonce-Kontos der
 * eingebauten Wallet und die Offline-Zahlung – ohne Netz, mit Tageslimit wie
 * jede Zahlung. Anlegen, Auffrischen und Einreichen brauchen Netz und stehen
 * in shell/zahlschienen.ts.
 *
 * Ein Nonce-Wert zahlt genau einmal: Nach einer Offline-Zahlung gilt er als
 * verbraucht, bis die App ihn mit Netz neu liest. Die Ablage liegt ueber
 * `geheim` (Praefix freedom.solWallet) – sie verbindet Nonce-Konto und Adresse.
 */
import { baueOfflineUeberweisung, pruefeOfflineUeberweisung, railFuerZiel, type NonceStand } from "@freedomstack/protocol";
import type { Nachfrage, SignierbareTx, WalletSpeicher } from "./sol-wallet.js";

export const LS_SOL_NONCE = "freedom.solWallet.nonce";

export interface NonceAblage {
  /** Adresse des Nonce-Kontos. */
  konto: string;
  stand: NonceStand;
  /** Wann der Wert von der Kette gelesen wurde (Unix-Sekunden). */
  gelesen: number;
  /** Schon fuer eine Offline-Zahlung benutzt. */
  verbraucht: boolean;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Ablage lesen – streng; alles Unerwartete gilt als keine Ablage. */
export function leseAblage(s: Pick<WalletSpeicher, "getItem">): NonceAblage | null {
  try {
    const a = JSON.parse(s.getItem(LS_SOL_NONCE) ?? "null") as Partial<NonceAblage> | null;
    const st = a?.stand as Partial<NonceStand> | undefined;
    if (!a || typeof a.konto !== "string" || !BASE58.test(a.konto) || !st) return null;
    if (typeof st.autoritaet !== "string" || !BASE58.test(st.autoritaet) || typeof st.nonce !== "string" || !BASE58.test(st.nonce)) return null;
    if (!Number.isSafeInteger(st.lamportsJeSignatur) || !Number.isSafeInteger(a.gelesen) || typeof a.verbraucht !== "boolean") return null;
    return { konto: a.konto, stand: { autoritaet: st.autoritaet, nonce: st.nonce, lamportsJeSignatur: st.lamportsJeSignatur! }, gelesen: a.gelesen!, verbraucht: a.verbraucht };
  } catch {
    return null;
  }
}

export async function schreibeAblage(s: WalletSpeicher, a: NonceAblage | null): Promise<void> {
  if (a) await s.setItem(LS_SOL_NONCE, JSON.stringify(a));
  else await s.removeItem(LS_SOL_NONCE);
}

/** Was die Offline-Zahlung von der eingebauten Wallet braucht. */
export interface OfflineWallet {
  adresse(): string | undefined;
  freigabe(lamports: number, ziel: string, bestaetige: (n: Nachfrage) => Promise<boolean>): Promise<boolean>;
  signiere(tx: SignierbareTx): void;
}

/**
 * Offline zahlen: Ueberweisung mit dem abgelegten Nonce bauen, freigeben
 * (Tageslimit, darueber Dialog), signieren, pruefen – und den Wert als
 * verbraucht merken, bevor die Transaktion das Geraet verlaesst.
 */
export async function erstelleOfflineZahlung(
  w: OfflineWallet,
  s: WalletSpeicher,
  p: { an: string; lamports: number },
  bestaetige: (n: Nachfrage) => Promise<boolean>,
): Promise<Uint8Array> {
  const a = leseAblage(s);
  if (!a) throw new Error("Kein Nonce-Konto – erst mit Netz anlegen (Wallet-Tab).");
  if (a.verbraucht) throw new Error("Der Nonce-Wert ist schon verbraucht – mit Netz auffrischen.");
  const von = w.adresse();
  if (!von) throw new Error("Keine eingebaute Wallet eingerichtet");
  if (railFuerZiel(p.an) !== "solana") throw new Error("Das ist keine Solana-Adresse");
  // Erst bauen: Unfug (an sich selbst, fremdes Nonce-Konto) zaehlt nicht zum Tageslimit.
  const tx = baueOfflineUeberweisung({ von, an: p.an, lamports: p.lamports, nonceKonto: a.konto, stand: a.stand });
  if (!(await w.freigabe(p.lamports, p.an, bestaetige))) throw new Error("Zahlung nicht freigegeben – nichts erstellt.");
  w.signiere(tx as unknown as SignierbareTx);
  const roh = new Uint8Array(tx.serialize());
  const pruefung = pruefeOfflineUeberweisung(roh);
  if (!pruefung.ok) throw new Error(pruefung.grund);
  await schreibeAblage(s, { ...a, verbraucht: true });
  return roh;
}
