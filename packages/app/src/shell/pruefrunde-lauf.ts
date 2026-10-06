/**
 * Prüfrunden im Netz (P5c2, Entscheidung 05./06.10.2026).
 *
 * Etwa jede 400. Antwort geht die echte Anfrage zusätzlich an zwei andere
 * Provider – Pflicht, ohne Schalter, bezahlt aus dem Prüfbudget. Der Nutzer
 * sieht nur die Antwort seines Providers; die zusätzlichen holt die App still
 * ab, bezahlt sie wie jede Antwort (`ki-zahlung.ts`: gemerkte Empfänger,
 * höchstens das Gebot, erst die Rechnung prüfen), vergleicht alle drei
 * (`werteRundeAus()`) und merkt sich Verfügbarkeit und Übereinstimmung in der
 * eigenen Messung. Was vom Bedarf übrig bleibt, geht ins Budget zurück.
 *
 * Nur aus `askWithFailover()`: Gerät, eigener Knoten und Funk laufen nie
 * hierher, und der eigene Knoten wird nie gezählt. Bezahlt wird mit Lightning;
 * Provider mit Zahlkanal fragt die Runde erst ab P5d – mit SOL als
 * Standard-Schiene gibt es bis dahin keine Runde.
 */
import { type Messpunkt, type NostrEvent, type parseJobResult } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { type ScoredProvider } from "../matchmaking.js";
import { PRUEFRUNDE } from "../pruefbudget.js";
import { mitEinig, rueckgabeMsat, waehleZusatz, werteRundeAus } from "../pruefrunde.js";
import { type SessionClient } from "../session-client.js";
import { begleicheWennVerlassen } from "./ki-wechsel.js";
import { kanalDa, providerZahlung, pruefBudget, rechneAntwortAb, zahleAnteile, zieleNachSchiene } from "./ki-zahlung.js";
import { kopplungFuer } from "./mein-knoten.js";
import { merkeMessung } from "./messung.js";
import { quittungNachZahlung } from "./quittungen.js";
import { getAllowlist, kiSitzungen } from "./state.js";
import { toast } from "./ui.js";
import { buildJobEvent, jobAbort, waitForAnswer } from "./tabs/agent.js";

/** So lange wartet die Runde auf die zusätzlichen – wie auf den ersten Provider eines Laufs. */
const ZUSATZ_ZEIT_MS = 300_000;

export interface Pruefrunde {
  /** Am Ende des Laufs, genau einmal: seine Punkte und die Antwort, die der Nutzer sah (kaputt oder keine: null). */
  abschluss(punkte: ReadonlyArray<[string, Messpunkt]>, antwort: { pk: string; output: string } | null): Promise<void>;
}

interface Ausgang { pk: string; punkt?: Messpunkt; output?: string; kostenMsat: number }

/** Eigene Knoten: gekoppelt (B-8c) oder auf der Liste eigener Provider – ausgenommen wie Gerät und Funk. */
const eigen = (pk: string): boolean => !!kopplungFuer(pk) || getAllowlist().includes(pk);

/**
 * Eine Prüfrunde beginnen, wenn sie fällig ist: zwei Provider wählen, Bedarf
 * vom Budget abziehen, die Anfrage versiegelt an beide senden. Nicht fällig,
 * zu wenige passende Provider oder ein eigener Knoten vorn: null – dann
 * versucht es die nächste Antwort wieder.
 */
export async function starteRunde(p: {
  prompt: string; bid: number; tier: string; hoechstMsat: number;
  kandidaten: readonly ScoredProvider[]; ausser: readonly string[]; modell?: string;
  publish: (ev: NostrEvent) => Promise<unknown>; sc: SessionClient;
}): Promise<Pruefrunde | null> {
  const bedarf = PRUEFRUNDE.zusatz * p.hoechstMsat;
  if (eigen(p.ausser[0] ?? "") || !pruefBudget.faellig(bedarf)) return null;
  // Nie die Provider dieses Laufs, nie eigene Knoten, nie über einen Zahlkanal (erst P5d)
  const ausser = new Set(p.ausser);
  const frei = p.kandidaten.filter((k) => !ausser.has(k.caps.pubkey) && !eigen(k.caps.pubkey) && !kanalDa(k.caps.pubkey));
  let erlaubt: Set<string>;
  try {
    erlaubt = new Set(zieleNachSchiene(frei.map((k) => k.caps.pubkey), p.hoechstMsat > 0));
  } catch {
    return null; // mit SOL nur über Kanäle – bis P5d keine Runde
  }
  const wahl = waehleZusatz(frei.filter((k) => erlaubt.has(k.caps.pubkey)).map((k) => ({ pk: k.caps.pubkey, modelle: k.caps.models })), {
    haupt: p.ausser[0] ?? "", eigene: ausser, ...(p.modell ? { modell: p.modell } : {}),
  });
  if (wahl.length < PRUEFRUNDE.zusatz) return null;
  if (!(await pruefBudget.beginneRunde(bedarf).catch(() => false))) return null;
  toast(t("agent.pruefrunde"));
  const ausgaenge = wahl.map((pk) => frage(pk, p));
  return { abschluss: (punkte, antwort) => schliesse(ausgaenge, punkte, antwort, p.hoechstMsat) };
}

/** Den Lauf messen – mit Runde erst, wenn die zusätzlichen da sind. Gezählt wird jede Antwort aus dem Netz, nie der eigene Knoten. */
export function messeLauf(runde: Promise<Pruefrunde | null>, punkte: ReadonlyArray<[string, Messpunkt]>, antwort: { pk: string; output: string } | null): void {
  if (antwort && !eigen(antwort.pk)) void pruefBudget.zaehleAntwort().catch(() => { /* Tresor gesperrt */ });
  void runde.then((r) => r ? r.abschluss(punkte, antwort) : merkeMessung(punkte)).catch(() => { /* beim nächsten Lauf */ });
}

/** Die Anfrage an einen zusätzlichen Provider – wie jede andere, über `buildJobEvent()` versiegelt – und still abholen. */
async function frage(pk: string, p: { prompt: string; bid: number; tier: string; hoechstMsat: number; publish: (ev: NostrEvent) => Promise<unknown>; sc: SessionClient }): Promise<Ausgang> {
  let requestId: string;
  try {
    const auftrag = await buildJobEvent(p.prompt, p.bid, p.tier, pk, p.sc);
    await p.publish(auftrag.wrap);
    requestId = auftrag.requestId;
  } catch {
    return { pk, kostenMsat: 0 }; // nicht gesendet – zählt nicht, das Budget kommt zurück
  }
  const gesendet = Date.now();
  const a = await waitForAnswer(requestId, ZUSATZ_ZEIT_MS, pk, { ...(jobAbort ? { signal: jobAbort.signal } : {}), still: true }).catch(() => null);
  const zeit = Math.floor(Date.now() / 1000);
  if (!a) return { pk, punkt: { zeit, ok: false }, kostenMsat: 0 }; // Frist verpasst
  if (a.aborted || ("providerError" in a && a.providerError)) return { pk, kostenMsat: 0 }; // Abbruch, Ablehnung: zählen nicht
  if ("kaputt" in a) return { pk, punkt: { zeit, ok: false }, kostenMsat: 0 };
  const kostenMsat = await bezahle(a.ev, a.parsed!, p.sc).catch(() => p.hoechstMsat); // unklar: als verbraucht
  return { pk, punkt: { zeit, ok: true, ms: Math.max(0, Date.now() - gesendet) }, output: a.parsed!.output, kostenMsat };
}

/** Wie `handleAnswer()`, ohne Anzeige: abrechnen (höchstens das Gebot), den Provider über die Sitzung zahlen, Quittung. */
async function bezahle(ev: NostrEvent, r: ReturnType<typeof parseJobResult>, sc: SessionClient): Promise<number> {
  const abrechnung = await rechneAntwortAb(r.requestId, r.amountMsat);
  if (abrechnung.providerMsat > 0) {
    const { zahlung } = await providerZahlung(r.providerPubkey);
    const charge = await sc.chargeForResult(r.providerPubkey, abrechnung.providerMsat, ev.id, zahlung, kiSitzungen.fuerAuftrag(r.requestId));
    void quittungNachZahlung(r.providerPubkey, abrechnung.providerMsat, charge);
    void begleicheWennVerlassen(sc, r.providerPubkey, kiSitzungen.fuerAuftrag(r.requestId)).catch(() => {});
  }
  return r.amountMsat;
}

async function schliesse(ausgaenge: Promise<Ausgang>[], punkte: ReadonlyArray<[string, Messpunkt]>, antwort: { pk: string; output: string } | null, hoechstMsat: number): Promise<void> {
  const aus = await Promise.all(ausgaenge);
  const einig = werteRundeAus([...(antwort ? [antwort] : []), ...aus.flatMap((a) => a.output !== undefined ? [{ pk: a.pk, output: a.output }] : [])]);
  await merkeMessung(mitEinig([...punkte, ...aus.flatMap((a): Array<[string, Messpunkt]> => a.punkt ? [[a.pk, a.punkt]] : [])], einig));
  await pruefBudget.verbuche(rueckgabeMsat(hoechstMsat, aus.map((a) => a.kostenMsat))).catch(() => { /* Tresor gesperrt */ });
  void zahleAnteile().catch(() => { /* beim nächsten Mal */ });
}
