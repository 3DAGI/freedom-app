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
import type { Kopplung, NostrEvent, ProviderCapabilities } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { FunkAuftraege, baueFunkAuftrag, funkGatewayAus, leseFunkGateway, leseFunkKnoten, type FunkGateway } from "../ki-funk.js";
import { LS_RETICULUM_KNOTEN } from "../reticulum-funk.js";
import { meineKopplung } from "./mein-knoten.js";
import { kanalGutschrift, merkeAnfrage } from "./ki-zahlung.js";
import { maskiere, merkeErsetzt } from "./ki-platzhalter.js";
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

/**
 * Der eigene Knoten als Gateway über Reticulum (B-32d3b) – nur, wenn die Kopplung zu dem Knoten passt, dessen Status die
 * Adresse nannte. Zurück Gateway, Kopplung (für den Nachweis) und die LXMF-Adresse; sonst null.
 */
export function funkKnotenGateway(): { gateway: FunkGateway; kopplung: Kopplung; lxmf: string } | null {
  const f = leseFunkKnoten(geheim.getItem(LS_RETICULUM_KNOTEN));
  const kopplung = meineKopplung();
  if (!f || !kopplung || kopplung.knoten !== f.knoten) return null;
  return { gateway: { pubkey: f.knoten, powBits: f.powBits, seit: 0 }, kopplung, lxmf: f.lxmf };
}

/** Wer Antworten aus dem Funk zeigt (der Agent). */
export function beiFunkAntwort(fn: (ev: NostrEvent, frage: string, ergebnis: boolean) => void): void {
  anzeige = fn;
}

/**
 * KI-Anfrage über Funk. `senden` reiht einen Umschlag beim Funkknoten ein
 * (false: kein Funkgerät verbunden). Gibt die Kennung des Auftrags zurück.
 * Mit `eigen` (B-32d3b) an den eigenen Knoten – mit Besitzer-Nachweis, ohne Gebot: Er rechnet den Besitzer gratis.
 */
export async function sendeKiUeberFunk(
  prompt: string, bidSats: number, senden: (umschlag: NostrEvent) => Promise<boolean>, eigen?: { gateway: FunkGateway; kopplung: Kopplung },
): Promise<string> {
  const g = eigen?.gateway ?? funkGateway();
  if (!g) throw new Error(t("agent.funkKeinGateway"));
  const hoechst = !eigen && Number.isFinite(bidSats) ? Math.max(0, Math.floor(bidSats)) * 1000 : 0;
  if (hoechst > 0 && !g.kurs) throw new Error(t("agent.funkOhneKurs"));
  const kanal = hoechst > 0 ? await kanalGutschrift(g.pubkey, hoechst, g.kurs) : undefined;
  if (hoechst > 0 && !kanal) throw new Error(t("agent.funkNurKanal"));
  // Platzhalter (D1a): auch über Funk lesen Gateway und Provider nur die ersetzte Frage
  const maske = maskiere(prompt);
  const a = await baueFunkAuftrag({ prompt: maske.text, bidMsat: hoechst, gateway: g, sitzung: kiSitzungen.fuer(g.pubkey),
    zahlTags: kanal?.tags, kopplung: eigen?.kopplung,
  });
  // Erst merken (Gutschrift, Anfrage), dann senden
  if (kanal) await kanal.merke(a.requestId);
  merkeAnfrage(a.requestId, {}, hoechst, !!kanal);
  auftraege.merke(a.requestId, prompt, a.bis);
  merkeErsetzt(a.requestId, maske.ersetzt);
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
