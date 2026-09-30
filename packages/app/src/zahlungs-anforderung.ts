/**
 * Zahlung im Chat anfordern (Sammlung A-5), ohne DOM.
 *
 * Eine Anforderung ist eine gewöhnliche Direktnachricht – versiegelt wie jede
 * (NIP-17 bzw. MLS) – mit Adressen, die auch andere Apps verstehen:
 * `lightning:<bolt11>` (Rechnung der eigenen Wallet, der Betrag steht darin)
 * und `solana:<adresse>?amount=<SOL>` (Solana Pay; die eigene Adresse für
 * genau diesen Kontakt, 4.9d). Kein neues Event-Format.
 *
 * Die App des Empfängers erkennt sie mit `leseAnforderung()` und bietet
 * „Bezahlen“ an – nur mit Betrag, nur mit lesbarer Rechnung bzw. Adresse,
 * nur natives SOL (kein `spl-token`).
 */
import { leseBolt11 } from "@freedomstack/protocol";

export interface Anforderung {
  lightning?: { rechnung: string; msat: number };
  solana?: { adresse: string; lamports: number };
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LAMPORTS_JE_SOL = 1_000_000_000n;

/** SOL als Text → Lamports, ohne Gleitkomma; höchstens 9 Nachkommastellen, größer als 0, als sichere Ganzzahl. */
export function solZuLamports(s: string): number | undefined {
  const m = /^(\d{1,9})(?:\.(\d{1,9}))?$/.exec(s.trim());
  if (!m) return undefined;
  const l = BigInt(m[1]) * LAMPORTS_JE_SOL + BigInt((m[2] ?? "").padEnd(9, "0"));
  return l > 0n && l <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(l) : undefined;
}

/** Lamports → SOL als Text, ohne Gleitkomma und ohne überflüssige Nullen. */
export function lamportsZuSol(lamports: number): string {
  const l = BigInt(lamports);
  const rest = (l % LAMPORTS_JE_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return rest ? `${l / LAMPORTS_JE_SOL}.${rest}` : `${l / LAMPORTS_JE_SOL}`;
}

/** Text der Anforderung: Notiz (falls da), dann je Währung eine Zeile. */
export function baueAnforderung(p: { rechnung?: string; solana?: { adresse: string; lamports: number }; notiz?: string }): string {
  const zeilen: string[] = [];
  const notiz = p.notiz?.trim();
  if (notiz) zeilen.push(notiz);
  if (p.rechnung) zeilen.push(`lightning:${p.rechnung}`);
  if (p.solana) zeilen.push(`solana:${p.solana.adresse}?amount=${lamportsZuSol(p.solana.lamports)}`);
  return zeilen.join("\n");
}

/** Anforderung in einer Nachricht – null, wenn keine zahlbare darin steht. */
export function leseAnforderung(text: string): Anforderung | null {
  const a: Anforderung = {};
  const ln = /(?:^|\s)(?:lightning:)?(ln(?:bcrt|bc|tbs|tb)[0-9a-z]{20,1800})(?=\s|$)/i.exec(text);
  if (ln) {
    try {
      const b = leseBolt11(ln[1]);
      if (b.betragMsat && b.betragMsat > 0) a.lightning = { rechnung: ln[1].toLowerCase(), msat: b.betragMsat };
    } catch { /* keine lesbare Rechnung */ }
  }
  const sol = /(?:^|\s)solana:([1-9A-HJ-NP-Za-km-z]{32,44})\?(\S+)/.exec(text);
  if (sol && BASE58.test(sol[1])) {
    const q = new URLSearchParams(sol[2]);
    const lamports = q.has("spl-token") ? undefined : solZuLamports(q.get("amount") ?? "");
    if (lamports) a.solana = { adresse: sol[1], lamports };
  }
  return a.lightning || a.solana ? a : null;
}
