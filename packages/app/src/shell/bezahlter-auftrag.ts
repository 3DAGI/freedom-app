/**
 * Ein versiegelter, bezahlter Auftrag an genau einen Provider – für Fragen an
 * Agenten auf dem Knoten (11.3d1b2, „wer fragt, zahlt“). Derselbe Weg wie in
 * `frageUndZahle()` (`agenten-lauschen.ts`, 11.3c, Spur A); dort steht er mit
 * dem Budget des Erstellers verflochten und bleibt vorerst, wie er ist.
 *
 * - Versiegelt vom Sitzungsschlüssel aus `sitzungen` (je Agent und Raum bzw. je
 *   Frage), Tags nur im Kern (`extraTags`, z. B. der Verweis auf die Erwähnung).
 * - Bezahlt über `ki-zahlung.ts`: Lightning mit Deklaration nach A+, abgerechnet
 *   höchstens das Gebot – oder eine Gutschrift im Zahlkanal (`kanal`). Ohne
 *   deckenden Kanal geht nichts hinaus.
 * - Wartet höchstens `WARTEN_MS` – nur auf diesen Sitzungsschlüssel und Auftrag.
 *   Eine Ablehnung liefert ihre Kennung (`fall`), nie den Text des Providers.
 */
import { KIND_GIFT_WRAP, buildJobRequest, buildPrivateJobRequest, getTag, parseJobResult, type NostrEvent } from "@freedomstack/protocol";
import type { KiSitzungen } from "../ki-sitzung.js";
import { type AntwortCache, oeffneAntworten } from "../ki-antworten.js";
import {
  deklaration, empfaengerFuer, kanalAntwort, kanalGutschrift, merkeAnfrage, providerZahlung, rechneAntwortAb, zahleAnteile,
} from "./ki-zahlung.js";
import { ensurePool, ensureSessionClient, powJeProvider } from "./state.js";

/** So lange wartet ein Auftrag auf den Provider. */
const WARTEN_MS = 180_000;

export type AuftragsAusgang =
  | { art: "antwort"; output: string; amountMsat: number; amountLamports?: number }
  | { art: "abgelehnt"; fall?: string }
  | null;

export async function bezahlterAuftrag(p: {
  provider: string;
  sitzungen: KiSitzungen;
  input: string;
  /** Gebot in msat – mehr zahlt die App nie. */
  hoechstMsat: number;
  /** Über den Zahlkanal statt Lightning. */
  kanal: boolean;
  /** Weitere Tags für den versiegelten Kern (Verweis, Modell). */
  extraTags?: string[][];
}): Promise<AuftragsAusgang> {
  const pool = await ensurePool();
  const sitzung = p.sitzungen.fuer(p.provider);
  const empfaenger = await empfaengerFuer(p.provider);
  const kanal = p.kanal ? await kanalGutschrift(p.provider, p.hoechstMsat) : undefined;
  if (p.kanal && !kanal) return null;
  const request = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: p.input, bidMsat: p.hoechstMsat, providerPubkey: p.provider,
    params: [["tier", "classic"]],
    extraTags: [...(kanal ? kanal.tags : deklaration(empfaenger)), ...(p.extraTags ?? [])],
  });
  const auftrag = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: p.provider, powBits: powJeProvider.get(p.provider) ?? 0 });
  if (kanal) await kanal.merke(auftrag.requestId);
  p.sitzungen.merkeAuftrag(auftrag.requestId, sitzung);
  merkeAnfrage(auftrag.requestId, empfaenger, p.hoechstMsat, !!kanal);
  const seit = Math.floor(Date.now() / 1000) - 120;
  await pool.publish(auftrag.wrap);

  // Antwort abwarten – nur an diesen Sitzungsschlüssel, nur zu diesem Auftrag
  const cache: AntwortCache = new Map();
  const ende = Date.now() + WARTEN_MS;
  let antwort: NostrEvent | undefined;
  while (!antwort && Date.now() < ende) {
    await new Promise((r) => setTimeout(r, 3000));
    const umschlaege = await pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [sitzung.publicKey()], since: seit }).catch(() => []);
    const r = await oeffneAntworten(umschlaege, p.sitzungen, new Set([auftrag.requestId]), cache);
    antwort = r.ergebnisse.find((x) => x.pubkey === p.provider);
    const abgelehnt = r.rueckmeldungen.find((x) => x.pubkey === p.provider && !["progress", "processing"].includes(getTag(x, "status") ?? ""));
    const fall = abgelehnt ? getTag(abgelehnt, "fall") : undefined;
    if (!antwort && abgelehnt) return { art: "abgelehnt", ...(fall ? { fall } : {}) };
  }
  if (!antwort) return null;
  const ergebnis = parseJobResult(antwort);

  // Bezahlen – nie mehr als das Gebot
  if (kanal) {
    await kanalAntwort(auftrag.requestId, ergebnis.amountLamports);
  } else {
    const abrechnung = await rechneAntwortAb(auftrag.requestId, ergebnis.amountMsat);
    const { zahlung } = await providerZahlung(p.provider);
    await ensureSessionClient().chargeForResult(p.provider, abrechnung.providerMsat, antwort.id, zahlung, sitzung);
    void zahleAnteile().catch(() => { /* beim nächsten Mal */ });
  }
  return { art: "antwort", output: ergebnis.output, amountMsat: ergebnis.amountMsat, ...(ergebnis.amountLamports !== undefined ? { amountLamports: ergebnis.amountLamports } : {}) };
}
