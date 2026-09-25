/**
 * SOL-Trinkgeld mit Beleg (Schritt 4.7) – Entwurf in docs/NIP-SOL-TIP.md.
 *
 * Lightning-Zaps haben NIP-57; fuer SOL gab es nichts: Die App ueberwies und
 * zeigte „gesendet“, der Empfaenger erfuhr nichts. Jetzt geht ein Beleg mit
 * Transaktionssignatur, Betrag, Empfaengeradresse und Bezug an den Empfaenger –
 * versiegelt im Gift-Wrap (Kind 1059), oeffentlich nur auf Wunsch. Der Beleg
 * selbst beweist nichts; belegt ist das Trinkgeld erst, wenn die Transaktion
 * auf der Kette genau diesen Empfaenger und mindestens diesen Betrag zeigt
 * (`pruefeSolUeberweisung`).
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import { KIND_SOL_TRINKGELD } from "./kinds.js";
import type { Signer } from "./signer.js";

const HEX64 = /^[0-9a-f]{64}$/;
const B58_ADRESSE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const B58_SIGNATUR = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
export const SOL_KETTEN = ["solana:mainnet", "solana:devnet", "solana:testnet"] as const;
export type SolKette = (typeof SOL_KETTEN)[number];
const MAX_NOTIZ = 280;

export interface SolTrinkgeld {
  /** Nostr-Pubkey des Empfaengers. */
  empfaenger: string;
  /** Transaktionssignatur (base58). */
  signatur: string;
  lamports: number;
  /** SOL-Adresse, an die ueberwiesen wurde. */
  an: string;
  kette: SolKette;
  /** Event, fuer das es das Trinkgeld gab (optional). */
  bezug?: string;
  notiz?: string;
}

function pruefe(t: SolTrinkgeld): void {
  if (!HEX64.test(t.empfaenger)) throw new Error("Empfänger muss ein Pubkey (64 Hex) sein");
  if (!B58_SIGNATUR.test(t.signatur)) throw new Error("keine gültige Transaktionssignatur");
  if (!Number.isSafeInteger(t.lamports) || t.lamports <= 0) throw new Error("Betrag muss eine positive ganze Zahl (Lamports) sein");
  if (!B58_ADRESSE.test(t.an)) throw new Error("keine gültige SOL-Adresse");
  if (!SOL_KETTEN.includes(t.kette)) throw new Error("unbekannte Kette");
  if (t.bezug !== undefined && !HEX64.test(t.bezug)) throw new Error("Bezug muss eine Event-ID sein");
  if (t.notiz !== undefined && t.notiz.length > MAX_NOTIZ) throw new Error(`Notiz höchstens ${MAX_NOTIZ} Zeichen`);
}

/** Das Beleg-Event (Kind 9736) – unsigniert; offen oder als Kern eines Umschlags. */
export function buildSolTrinkgeld(absender: string, t: SolTrinkgeld, createdAt = Math.floor(Date.now() / 1000)): UnsignedEvent {
  pruefe(t);
  const tags: string[][] = [
    ["p", t.empfaenger],
    ["sol_tx", t.signatur],
    ["lamports", String(t.lamports)],
    ["sol_to", t.an],
    ["chain", t.kette],
  ];
  if (t.bezug) tags.push(["e", t.bezug]);
  return buildEvent(absender, KIND_SOL_TRINKGELD, tags, t.notiz ?? "", createdAt);
}

/** Liest ein Beleg-Event; wirft bei jeder unpassenden Angabe. */
export function parseSolTrinkgeld(ev: UnsignedEvent): SolTrinkgeld & { absender: string } {
  if (ev.kind !== KIND_SOL_TRINKGELD) throw new Error(`kein Trinkgeld-Beleg: Kind ${ev.kind}`);
  const lam = getTag(ev, "lamports") ?? "";
  const t: SolTrinkgeld = {
    empfaenger: getTag(ev, "p") ?? "",
    signatur: getTag(ev, "sol_tx") ?? "",
    lamports: /^\d{1,16}$/.test(lam) ? Number(lam) : NaN,
    an: getTag(ev, "sol_to") ?? "",
    kette: (getTag(ev, "chain") ?? "") as SolKette,
    ...(getTag(ev, "e") !== undefined ? { bezug: getTag(ev, "e") } : {}),
    ...(ev.content ? { notiz: ev.content } : {}),
  };
  pruefe(t);
  if (!HEX64.test(ev.pubkey)) throw new Error("Absender fehlt");
  return { ...t, absender: ev.pubkey };
}

/**
 * Privat: je ein Umschlag an den Empfaenger und an den Absender selbst (eigene
 * Kopie, wie bei NIP-17). Auf den Relays steht nur Kind 1059.
 */
export async function buildPrivateSolTrinkgeld(t: SolTrinkgeld, signer: Signer, nowSecs = Math.floor(Date.now() / 1000)): Promise<NostrEvent[]> {
  const kern = buildSolTrinkgeld(signer.publicKey(), t, nowSecs);
  const ziele = [...new Set([t.empfaenger, signer.publicKey()])];
  return Promise.all(ziele.map((pk) => giftWrapMitSigner(kern, signer, pk, { nowSecs })));
}

/** Oeffnet einen Umschlag mit Trinkgeld-Beleg; null, wenn es keiner ist oder er mich nicht betrifft. */
export async function oeffnePrivatesSolTrinkgeld(wrap: NostrEvent, signer: Signer): Promise<(SolTrinkgeld & { absender: string }) | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !r.inner || r.inner.kind !== KIND_SOL_TRINKGELD) return null;
  if (r.inner.pubkey !== r.senderPubkey) return null; // Absender aus dem Siegel
  try {
    const t = parseSolTrinkgeld(r.inner);
    const ich = signer.publicKey();
    return t.empfaenger === ich || t.absender === ich ? t : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ Pruefung auf der Kette

export type SolPruefung = { status: "belegt" } | { status: "unbestaetigt"; grund: string } | { status: "falsch"; grund: string };

type Anweisung = { program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } } };

/**
 * Prueft eine Transaktion (Antwort von `getTransaction` mit `jsonParsed`):
 * erfolgreich, und die System-Ueberweisungen an `an` (von `von`, falls
 * angegeben) ergeben mindestens `lamports`.
 */
export function pruefeSolUeberweisung(tx: unknown, erwartet: { an: string; lamports: number; von?: string }): SolPruefung {
  if (tx === null || tx === undefined) return { status: "unbestaetigt", grund: "Transaktion (noch) nicht gefunden" };
  const t = tx as { meta?: { err?: unknown }; transaction?: { message?: { instructions?: Anweisung[] } } };
  if (!t.meta) return { status: "unbestaetigt", grund: "Transaktion ohne Ergebnis" };
  if (t.meta.err !== null && t.meta.err !== undefined) return { status: "falsch", grund: "Transaktion ist gescheitert" };
  let summe = 0;
  for (const a of t.transaction?.message?.instructions ?? []) {
    const info = a.parsed?.info;
    if (a.program !== "system" || a.parsed?.type !== "transfer" || !info) continue;
    if (info.destination !== erwartet.an) continue;
    if (erwartet.von && info.source !== erwartet.von) continue;
    if (Number.isSafeInteger(info.lamports)) summe += info.lamports!;
  }
  if (summe === 0) return { status: "falsch", grund: "keine Überweisung an diesen Empfänger" };
  if (summe < erwartet.lamports) return { status: "falsch", grund: `nur ${summe} statt ${erwartet.lamports} Lamports` };
  return { status: "belegt" };
}
