/**
 * Streaming-Sats: Live-Abrechnung fuer KI-Chat und Agent-Nutzung.
 *
 * Problem: Pro Nachricht eine Lightning-Transaktion ist unbenutzbar
 * (Fee-Overhead, Latenz, UX). On-Chain sowieso.
 *
 * Loesung (Stufe B des Payment-Designs):
 *   - Session-Open (kind 38021): Kunde autorisiert ein Budget + Rate,
 *     OHNE zu zahlen. Signiert, adressierbar (d-Tag = session_id).
 *   - Pro Antwort/Intervall: Zahlungs-Beleg (kind 38022), signiert vom
 *     KUNDEN: seq, kumulierter Betrag, Referenz auf den Job.
 *     Der eigentliche Geldfluss laeuft als Keysend (spontane Lightning-
 *     Zahlung, keine Invoice noetig) — Sub-Satoshi (msat), <1s Latenz,
 *     keine On-Chain-TX, keine Invoice pro Chunk.
 *   - Settlement-Fenster: Kunde streamt kleine Keysends (z. B. alle
 *     100 sats oder alle 30s — was zuerst kommt). Der Beleg referenziert
 *     den Zap/Keysend, damit beide Seiten eine pruefbare Buchhaltung
 *     aus Nostr-Events haben.
 *
 * Betrugsschutz ohne Zentrale:
 *   - Kunde zahlt nicht: Provider stoppt sofort (max. 1 Intervall Verlust,
 *     gedeckelt durch Settlement-Fenster). Session-Open + ausbleibende
 *     Belege sind oeffentlich sichtbar -> WoT-Reputation des Kunden sinkt.
 *   - Provider liefert nicht: Kunde zahlt einfach nicht weiter.
 *     Kein Escrow noetig — das Risiko pro Seite ist ein Intervall.
 *
 * Das ist derselbe Mechanismus wie Podcasting-2.0-Streaming-Sats,
 * formalisiert als pruefbare Event-Kette.
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag } from "./event.js";
import { KIND_SESSION_OPEN, KIND_SESSION_PAYMENT } from "./kinds.js";

// ------------------------------------------------------------ Session-Open

export interface SessionOpenParams {
  customerPubkey: string;
  /** Ziel-Provider (p-Tag). */
  providerPubkey: string;
  /** Eindeutige Session-ID (d-Tag, z. B. zufaellige hex). */
  sessionId: string;
  /** Maximal autorisierte Gesamtsumme in msat. */
  maxTotalMsat: number;
  /** Maximale Rate in msat pro 1k Tokens (Deckel gegen Preistreiberei). */
  maxRatePerKTokenMsat: number;
  /** Settlement-Fenster: spätestens nach so vielen msat wird bezahlt. */
  settleEveryMsat: number;
  /** Gueltigkeitsdauer in Sekunden (ab created_at). */
  ttlSecs: number;
}

export function buildSessionOpen(
  p: SessionOpenParams,
  createdAt = Math.floor(Date.now() / 1000),
): UnsignedEvent {
  return buildEvent(
    p.customerPubkey,
    KIND_SESSION_OPEN,
    [
      ["d", p.sessionId],
      ["p", p.providerPubkey],
      ["max_total_msat", String(p.maxTotalMsat)],
      ["max_rate_per_ktoken_msat", String(p.maxRatePerKTokenMsat)],
      ["settle_every_msat", String(p.settleEveryMsat)],
      ["expiration", String(createdAt + p.ttlSecs)],
    ],
    "",
    createdAt,
  );
}

export interface ParsedSessionOpen {
  sessionId: string;
  customerPubkey: string;
  providerPubkey: string;
  maxTotalMsat: number;
  maxRatePerKTokenMsat: number;
  settleEveryMsat: number;
  expiration: number;
}

export function parseSessionOpen(ev: UnsignedEvent): ParsedSessionOpen {
  if (ev.kind !== KIND_SESSION_OPEN) throw new Error(`kein Session-Open-Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  return {
    sessionId: req("d"),
    customerPubkey: ev.pubkey,
    providerPubkey: req("p"),
    maxTotalMsat: Number(req("max_total_msat")),
    maxRatePerKTokenMsat: Number(req("max_rate_per_ktoken_msat")),
    settleEveryMsat: Number(req("settle_every_msat")),
    expiration: Number(req("expiration")),
  };
}

// --------------------------------------------------------- Zahlungs-Beleg

export interface SessionPaymentParams {
  customerPubkey: string;
  sessionId: string;
  /** Laufende Nummer (1, 2, 3...) — Luecken = Betrugsverdacht. */
  seq: number;
  /** Kumulierter bezahlter Betrag in msat (monoton steigend). */
  cumulativeMsat: number;
  /** Verbrauchte Einheiten seit letztem Beleg (z. B. Tokens). */
  unitsSinceLast: number;
  /** Referenz auf den DVM-Job/Result, der abgerechnet wird. */
  refEventId?: string;
  /** Zap-/Keysend-Beleg (NIP-57 receipt id oder Payment-Hash). */
  paymentRef?: string;
}

export function buildSessionPayment(
  p: SessionPaymentParams,
  createdAt = Math.floor(Date.now() / 1000),
): UnsignedEvent {
  const tags: string[][] = [
    ["d", p.sessionId],
    ["seq", String(p.seq)],
    ["cumulative_msat", String(p.cumulativeMsat)],
    ["units", String(p.unitsSinceLast)],
  ];
  if (p.refEventId) tags.push(["e", p.refEventId]);
  if (p.paymentRef) tags.push(["payment", p.paymentRef]);
  return buildEvent(p.customerPubkey, KIND_SESSION_PAYMENT, tags, "", createdAt);
}

export interface ParsedSessionPayment {
  sessionId: string;
  customerPubkey: string;
  seq: number;
  cumulativeMsat: number;
  unitsSinceLast: number;
  refEventId?: string;
  paymentRef?: string;
}

export function parseSessionPayment(ev: UnsignedEvent): ParsedSessionPayment {
  if (ev.kind !== KIND_SESSION_PAYMENT) throw new Error(`kein Session-Payment-Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  return {
    sessionId: req("d"),
    customerPubkey: ev.pubkey,
    seq: Number(req("seq")),
    cumulativeMsat: Number(req("cumulative_msat")),
    unitsSinceLast: Number(req("units")),
    refEventId: getTag(ev, "e"),
    paymentRef: getTag(ev, "payment"),
  };
}

// --------------------------------------------------------- Buchhaltung

export interface SessionLedger {
  open: ParsedSessionOpen;
  payments: ParsedSessionPayment[];
}

export interface LedgerCheck {
  ok: boolean;
  /** Summe aller Belege (letzter kumulierter Wert). */
  totalPaidMsat: number;
  /** Erkannte Probleme (Luecken in seq, Budget-Ueberschreitung, ...). */
  problems: string[];
}

/**
 * Prueft eine Session-Buchhaltung: seq ohne Luecken, monotoner Betrag,
 * Budget eingehalten, Session nicht abgelaufen. Beide Seiten (Kunde,
 * Provider, und jeder Auditor) rechnen dieselbe Pruefung.
 */
export function checkSessionLedger(
  ledger: SessionLedger,
  now = Math.floor(Date.now() / 1000),
): LedgerCheck {
  const problems: string[] = [];
  const { open, payments } = ledger;

  if (now > open.expiration) problems.push("Session abgelaufen");

  const sorted = [...payments].sort((a, b) => a.seq - b.seq);
  let lastCum = 0;
  let expectedSeq = 1;
  for (const p of sorted) {
    if (p.customerPubkey !== open.customerPubkey) {
      problems.push(`Beleg seq=${p.seq} von fremdem Kunden`);
      continue;
    }
    if (p.seq !== expectedSeq) {
      problems.push(`seq-Luecke: erwartet ${expectedSeq}, gefunden ${p.seq}`);
      expectedSeq = p.seq;
    }
    if (p.cumulativeMsat <= lastCum && p.seq > 1) {
      problems.push(`kumulierter Betrag nicht monoton bei seq=${p.seq}`);
    }
    lastCum = Math.max(lastCum, p.cumulativeMsat);
    expectedSeq++;
  }
  if (lastCum > open.maxTotalMsat) {
    problems.push(`Budget ueberschritten: ${lastCum} > ${open.maxTotalMsat} msat`);
  }
  return { ok: problems.length === 0, totalPaidMsat: lastCum, problems };
}

/**
 * Faellt ein neuer Beleg an: wie viel ist jetzt faellig (Delta zum
 * letzten kumulierten Stand)?
 */
export function amountDue(payments: ParsedSessionPayment[]): number {
  if (payments.length === 0) return 0;
  const sorted = [...payments].sort((a, b) => a.seq - b.seq);
  return sorted[sorted.length - 1].cumulativeMsat - (sorted.length > 1 ? sorted[sorted.length - 2].cumulativeMsat : 0);
}
