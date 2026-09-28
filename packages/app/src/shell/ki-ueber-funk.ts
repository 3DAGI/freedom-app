/**
 * KI über ein Funk-Gateway in der App (Schritt 7.4c2) – Zustand und Wege.
 *
 * Das Gateway merkt sich die App, solange sie Netz hat (aus dem Angebot, im
 * Tresor: welches Gateway jemand über Funk nutzt, verrät ungefähr, wo er ist).
 * Ohne Netz baut sie Weiterleitung und Auftrag (`ki-funk.ts`) und reiht beide
 * beim Funkknoten ein; die Antwort öffnet sie, wenn sie über Funk ankommt.
 *
 * Bezahlt wird nur über den Zahlkanal – Gutschrift im versiegelten Kern (4.3),
 * zum Kurs aus dem gemerkten Angebot – oder gar nicht (Gratis-Tarif).
 * Lightning braucht Netz; nie still darauf ausweichen.
 */
import type { NostrEvent, ProviderCapabilities } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { FunkAuftraege, baueFunkAuftrag, funkGatewayAus, leseFunkGateway, type FunkGateway } from "../ki-funk.js";
import { kanalGutschrift, merkeAnfrage } from "./ki-zahlung.js";
import { kiSitzungen } from "./state.js";
import { geheim } from "./tresor.js";

export const LS_FUNK_GATEWAY = "freedom.funk.gateway";

const auftraege = new FunkAuftraege();
let anzeige: ((ev: NostrEvent, frage: string, ergebnis: boolean) => void) | null = null;

/** Das gemerkte Gateway – null, wenn keines gemerkt ist. */
export function funkGateway(): FunkGateway | null {
  return leseFunkGateway(geheim.getItem(LS_FUNK_GATEWAY));
}

/** Gateway aus einem Angebot merken (solange Netz da ist); false, wenn das Angebot keines nennt. */
export async function merkeFunkGateway(caps: ProviderCapabilities): Promise<boolean> {
  const g = funkGatewayAus(caps);
  if (!g) return false;
  await geheim.setItem(LS_FUNK_GATEWAY, JSON.stringify(g));
  return true;
}

export async function vergissFunkGateway(): Promise<void> {
  await geheim.removeItem(LS_FUNK_GATEWAY);
}

/** Wer Antworten aus dem Funk zeigt (der Agent). */
export function beiFunkAntwort(fn: (ev: NostrEvent, frage: string, ergebnis: boolean) => void): void {
  anzeige = fn;
}

/**
 * KI-Anfrage über Funk. `senden` reiht einen Umschlag beim Funkknoten ein
 * (false: kein Funkgerät verbunden). Gibt die Kennung des Auftrags zurück.
 */
export async function sendeKiUeberFunk(prompt: string, bidSats: number, senden: (umschlag: NostrEvent) => Promise<boolean>): Promise<string> {
  const g = funkGateway();
  if (!g) throw new Error(t("agent.funkKeinGateway"));
  const hoechst = Number.isFinite(bidSats) ? Math.max(0, Math.floor(bidSats)) * 1000 : 0;
  if (hoechst > 0 && !g.kurs) throw new Error(t("agent.funkOhneKurs"));
  const kanal = hoechst > 0 ? await kanalGutschrift(g.pubkey, hoechst, g.kurs) : undefined;
  if (hoechst > 0 && !kanal) throw new Error(t("agent.funkNurKanal"));
  const a = await baueFunkAuftrag({ prompt, bidMsat: hoechst, gateway: g, sitzung: kiSitzungen.fuer(g.pubkey), zahlTags: kanal?.tags });
  // Erst merken (Gutschrift, Anfrage), dann senden
  if (kanal) await kanal.merke(a.requestId);
  merkeAnfrage(a.requestId, {}, hoechst, !!kanal);
  auftraege.merke(a.requestId, prompt, a.bis);
  // Die Weiterleitung zuerst – dann wartet das Gateway schon, wenn die Antwort kommt
  if (!(await senden(a.weiterleitung)) || !(await senden(a.auftrag))) {
    auftraege.vergiss(a.requestId);
    throw new Error(t("agent.funkKeinGeraet"));
  }
  return a.requestId;
}

/** Ein Umschlag aus dem Funk: Antwort auf einen Funk-Auftrag? Dann zeigen – true. */
export async function nimmFunkAntwort(ev: NostrEvent): Promise<boolean> {
  const r = await auftraege.oeffne(ev, kiSitzungen);
  if (!r) return false;
  anzeige?.(r.ev, r.frage, r.ergebnis);
  return true;
}
