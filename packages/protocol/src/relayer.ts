/**
 * Relayer fuer Einloesungen ohne eigenes SOL (Schritt 4.6e).
 *
 * Wer per Lightning SOL kauft, hat oft noch keins – und kann die Gebuehr der
 * Einloesung nicht zahlen. Ein Relayer zahlt sie: Er ist `feePayer`, der
 * Empfaenger signiert die Einloesung weiterhin selbst. Die Signatur deckt alle
 * Anweisungen – der Relayer kann nichts umleiten, nur ablehnen. Seine Auslagen
 * bekommt er in derselben Transaktion zurueck (Ueberweisung vom Empfaenger an
 * ihn, nach der Einloesung, atomar).
 *
 *   Angebot  Kind 38032, ersetzbar (d = "relayer"): ["sol_address", …],
 *            ["erstattung_lamports", N], ["kette", "solana:mainnet"|"solana:devnet"]
 *   Auftrag  versiegelt (NIP-59) an den Relayer, innen Kind 25010, Inhalt die
 *            teilsignierte Transaktion (base64). Das Preimage darin darf vor
 *            der Einloesung niemand sonst sehen.
 *   Antwort  versiegelt, innen Kind 25011: ["status", "GESENDET"|"ABGELEHNT"],
 *            ["signatur", …] bzw. Grund im Inhalt.
 *
 * Risiko, offen benannt: Der Relayer kennt das Preimage, bevor die Einloesung
 * auf der Kette ist. Haelt er sie zurueck und gibt R dem LP, koennte der LP die
 * Lightning-Zahlung abrechnen und nach Ablauf die SOL zurueckholen. Deshalb
 * waehlt die App einen Relayer, der nicht der LP ist, und versucht bei
 * ausbleibender Einloesung rechtzeitig den naechsten.
 */
import { createHash } from "node:crypto";
import { SystemProgram, Transaction } from "@solana/web3.js";
import { computeEventId, type NostrEvent, type UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

export const KIND_RELAYER_ANGEBOT = 38032;
export const KIND_RELAY_AUFTRAG = 25010;
export const KIND_RELAY_ANTWORT = 25011;

/** Obergrenze der Erstattung, die eine App akzeptiert: Gebuehr plus Aufschlag, keine Einnahmequelle. */
export const MAX_ERSTATTUNG_LAMPORTS = 50_000;

export interface RelayerAngebot {
  solAdresse: string;
  erstattungLamports: number;
  kette: string;
}

export function buildRelayerAngebot(a: RelayerAngebot, pubkey: string, jetzt = Math.floor(Date.now() / 1000)): UnsignedEvent {
  return {
    pubkey, kind: KIND_RELAYER_ANGEBOT, created_at: jetzt, content: "",
    tags: [["d", "relayer"], ["sol_address", a.solAdresse], ["erstattung_lamports", String(a.erstattungLamports)], ["kette", a.kette]],
  };
}

export function parseRelayerAngebot(ev: { kind: number; tags: string[][] }): RelayerAngebot {
  if (ev.kind !== KIND_RELAYER_ANGEBOT) throw new Error("kein Relayer-Angebot");
  const tag = (n: string) => ev.tags.find((t) => t[0] === n)?.[1];
  const solAdresse = tag("sol_address") ?? "";
  const erstattungLamports = Number(tag("erstattung_lamports"));
  const kette = tag("kette") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solAdresse)) throw new Error("ungueltige sol_address");
  if (!Number.isSafeInteger(erstattungLamports) || erstattungLamports < 0) throw new Error("ungueltige erstattung_lamports");
  if (!/^solana:(mainnet|devnet|testnet)$/.test(kette)) throw new Error("ungueltige kette");
  return { solAdresse, erstattungLamports, kette };
}

function sighash(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

export type RelayPruefung =
  | { ok: true; empfaenger: string; erstattung: number }
  | { ok: false; grund: string };

/**
 * Was der Relayer vor dem Mitsignieren prueft: genau eine Einloesung beim
 * HTLC-Programm, danach genau eine Erstattung vom Empfaenger an ihn, er selbst
 * ist nur Gebuehrenzahler, und der Empfaenger hat schon gueltig signiert.
 * Alles andere lehnt er ab – sonst koennte ein Auftrag sein Guthaben anders
 * verwenden als fuer die Gebuehr.
 */
export function pruefeRelayAuftrag(
  roh: Uint8Array,
  erwartet: { relayer: string; programmId: string; erstattungMin: number },
): RelayPruefung {
  let tx: Transaction;
  try {
    tx = Transaction.from(roh);
  } catch {
    return { ok: false, grund: "keine lesbare Transaktion" };
  }
  if (tx.feePayer?.toBase58() !== erwartet.relayer) return { ok: false, grund: "Relayer ist nicht Gebuehrenzahler" };
  if (tx.instructions.length !== 2) return { ok: false, grund: "erwartet: Einloesung und Erstattung, sonst nichts" };
  const [einl, erst] = tx.instructions;
  if (einl.programId.toBase58() !== erwartet.programmId) return { ok: false, grund: "erste Anweisung ist keine Einloesung beim HTLC-Programm" };
  if (einl.data.length !== 40 || !Buffer.from(einl.data.subarray(0, 8)).equals(sighash("claim"))) return { ok: false, grund: "erste Anweisung ist keine Einloesung" };
  const empfaenger = einl.keys[0]?.pubkey;
  if (!empfaenger || !einl.keys[0].isSigner) return { ok: false, grund: "Einloesung ohne signierenden Empfaenger" };
  if (einl.keys.some((k) => k.pubkey.toBase58() === erwartet.relayer)) return { ok: false, grund: "Relayer-Konto in der Einloesung" };
  // DataView statt Buffer-Methoden: Die App prueft ihren Auftrag im Browser selbst,
  // und dem Buffer-Polyfill dort fehlen die BigInt-Methoden.
  const daten = new DataView(erst.data.buffer, erst.data.byteOffset, erst.data.byteLength);
  if (!erst.programId.equals(SystemProgram.programId) || erst.data.length !== 12 || daten.getUint32(0, true) !== 2) {
    return { ok: false, grund: "zweite Anweisung ist keine Ueberweisung" };
  }
  const [von, an] = erst.keys;
  if (!von?.pubkey.equals(empfaenger) || !an || an.pubkey.toBase58() !== erwartet.relayer) return { ok: false, grund: "Erstattung nicht vom Empfaenger an den Relayer" };
  const erstattung = Number(daten.getBigUint64(4, true));
  if (erstattung < erwartet.erstattungMin) return { ok: false, grund: `Erstattung ${erstattung} unter ${erwartet.erstattungMin} Lamports` };
  const sig = tx.signatures.find((s) => s.publicKey.equals(empfaenger))?.signature;
  if (!sig) return { ok: false, grund: "Empfaenger hat nicht signiert" };
  if (!tx.verifySignatures(false)) return { ok: false, grund: "Signatur des Empfaengers ungueltig" };
  return { ok: true, empfaenger: empfaenger.toBase58(), erstattung };
}

/** Mindestmiete eines leeren Kontos (0 Byte Daten) – darunter scheitert eine Einzahlung auf ein neues Konto. */
export const MIETE_LEERES_KONTO = 890_880;

/**
 * Bleibt dem Empfaenger nach Einloesung und Erstattung genug? Ein neues Konto
 * muss danach mindestens die Mindestmiete halten, sonst lehnt die Kette die
 * ganze Transaktion ab.
 */
export function mieteReicht(p: { guthabenVorher: number; eingeloest: number; erstattung: number }): boolean {
  return p.guthabenVorher + p.eingeloest - p.erstattung >= MIETE_LEERES_KONTO;
}

// ------------------------------------------------ Auftrag und Antwort (versiegelt)

const HEX64 = /^[0-9a-f]{64}$/;

/** Auftrag an den Relayer – versiegelt, sofort sichtbar (kein Zeitversatz: er soll gleich einloesen). */
export async function buildRelayAuftrag(p: { tx: Uint8Array; kunde: Signer; relayerPk: string; nowSecs?: number }): Promise<{ wrap: NostrEvent; auftragId: string }> {
  if (!HEX64.test(p.relayerPk)) throw new Error("Relayer-Pubkey ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.kunde.publicKey(), kind: KIND_RELAY_AUFTRAG, created_at: now,
    tags: [["p", p.relayerPk]], content: Buffer.from(p.tx).toString("base64"),
  };
  const wrap = await giftWrapMitSigner(kern, p.kunde, p.relayerPk, { fixedJitter: 0, nowSecs: now });
  return { wrap, auftragId: computeEventId(kern) };
}

/** Oeffnet einen Umschlag als Relayer; null, wenn es kein Auftrag ist. */
export async function oeffneRelayAuftrag(wrap: NostrEvent, relayer: Signer): Promise<{ kunde: string; auftragId: string; tx: Uint8Array } | null> {
  const r = await giftUnwrapMitSigner(wrap, relayer);
  if (!r.ok || !r.inner || r.inner.kind !== KIND_RELAY_AUFTRAG || r.inner.pubkey !== r.senderPubkey) return null;
  if (!/^[A-Za-z0-9+/=]{1,4000}$/.test(r.inner.content)) return null;
  return { kunde: r.inner.pubkey, auftragId: computeEventId(r.inner), tx: Uint8Array.from(Buffer.from(r.inner.content, "base64")) };
}

export type RelayStatus = "GESENDET" | "ABGELEHNT";

export async function buildRelayAntwort(p: {
  relayer: Signer; kundePk: string; auftragId: string; status: RelayStatus; signatur?: string; grund?: string; nowSecs?: number;
}): Promise<NostrEvent> {
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: p.relayer.publicKey(), kind: KIND_RELAY_ANTWORT, created_at: now,
    tags: [["p", p.kundePk], ["e", p.auftragId], ["status", p.status], ...(p.signatur ? [["signatur", p.signatur]] : [])],
    content: (p.grund ?? "").slice(0, 200),
  };
  return giftWrapMitSigner(kern, p.relayer, p.kundePk, { fixedJitter: 0, nowSecs: now });
}

/** Antwort oeffnen (als Kunde); nur vom erwarteten Relayer und zum eigenen Auftrag. */
export async function oeffneRelayAntwort(
  wrap: NostrEvent, kunde: Signer, erwartet: { relayerPk: string; auftragId: string },
): Promise<{ status: RelayStatus; signatur?: string; grund: string } | null> {
  const r = await giftUnwrapMitSigner(wrap, kunde);
  if (!r.ok || !r.inner || r.inner.kind !== KIND_RELAY_ANTWORT || r.inner.pubkey !== r.senderPubkey) return null;
  if (r.inner.pubkey !== erwartet.relayerPk) return null;
  const tag = (n: string) => r.inner!.tags.find((t) => t[0] === n)?.[1];
  if (tag("e") !== erwartet.auftragId) return null;
  const status = tag("status");
  if (status !== "GESENDET" && status !== "ABGELEHNT") return null;
  const signatur = tag("signatur");
  return { status, ...(signatur && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signatur) ? { signatur } : {}), grund: r.inner.content.slice(0, 200) };
}
