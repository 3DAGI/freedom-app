/**
 * Kacheln im Verdienen-Tab (C-54, Oberflächen-Review 15.10.2026) – ohne DOM: heute, 30 Tage, Aufträge aus den
 * Leistungs-Events (38010), die der Knoten selbst meldet. Selbstauskunft: Kunden zählen nur eigene Quittungen
 * (`berechneRuf()`), die Kachel sagt es dazu. Beträge sind Fremddaten – nur ganze msat zählen.
 */
import type { MarktKurs, NostrEvent } from "@freedomstack/protocol";
import { einnahmeText, satsText } from "./preis-anzeige.js";

export interface Summe { lnMsat: number; solMsat: number }
export interface Kacheln { heute: Summe; monat: Summe; auftraege: number }

const TAG = 86_400;
const MONAT = 30 * TAG;

function betrag(ev: NostrEvent): number {
  const v = ev.tags.find((x) => x[0] === "volume_msat")?.[1];
  const n = typeof v === "string" && /^\d{1,18}$/.test(v) ? Number(v) : 0;
  return Number.isSafeInteger(n) ? n : 0;
}

/** Heute (seit Mitternacht, Ortszeit), die letzten 30 Tage und wie viele Aufträge darin. */
export function einnahmenKacheln(events: readonly NostrEvent[], jetzt: Date): Kacheln {
  const nun = Math.floor(jetzt.getTime() / 1000);
  const heuteAb = Math.floor(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()).getTime() / 1000);
  const k: Kacheln = { heute: { lnMsat: 0, solMsat: 0 }, monat: { lnMsat: 0, solMsat: 0 }, auftraege: 0 };
  for (const ev of events) {
    if (ev.created_at > nun || ev.created_at <= nun - MONAT) continue;
    const feld = ev.tags.find((x) => x[0] === "chain")?.[1] === "solana" ? "solMsat" : "lnMsat";
    const b = betrag(ev);
    k.monat[feld] += b;
    k.auftraege++;
    if (ev.created_at >= heuteAb) k.heute[feld] += b;
  }
  return k;
}

/** Eine Summe als Text: sats, SOL nur mit Kurs (sonst wie bisher als sats-Gegenwert), beide mit „·“. */
export function summeText(s: Summe, kurs?: Pick<MarktKurs, "satsProSol">): string {
  const teile = [
    ...(s.lnMsat > 0 || s.solMsat === 0 ? [satsText(s.lnMsat)] : []),
    ...(s.solMsat > 0 ? [einnahmeText(String(s.solMsat), "solana", kurs)] : []),
  ];
  return teile.join(" · ");
}
