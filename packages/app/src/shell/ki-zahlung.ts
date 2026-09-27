/**
 * KI-Aufträge bezahlen (Schritt 5.1.3, Modell A+).
 *
 * Beim Senden hält die App die Empfänger der Anteile fest und deklariert im
 * versiegelten Auftrag, welche sie selbst zahlt (`aufteilungTag`). Bei der
 * Antwort teilt sie mit denselben Empfängern auf (`rechneAb`): Den Anteil des
 * Providers zahlt die Sitzung an seine Lightning-Adresse aus dem Angebot, die
 * übrigen sammelt die Kasse und zahlt sie ab 100 sats je Empfänger. Gezahlt
 * wird nur über die Zahlschienen, erst die Rechnung, dann das Geld.
 */
import { ENTWICKLUNG, aufteilungTag, zahlbareAnteile, zahle, type Empfaenger, type Posten } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { AnteilsKasse, rechneAb } from "../anteile-kasse.js";
import { bolt11BetragMsat, rechnungVonAdresse } from "../rails.js";
import { RelayZahlziele } from "../relay-zahlziel.js";
import type { ProviderZahlung } from "../session-client.js";
import { werberZahlziel } from "../werbung.js";
import { angebotVon, ensurePool, frageBeiAutoren, state } from "./state.js";
import { hostingZahlziel } from "./hosting.js";
import { geheim } from "./tresor.js";
import { zahlschienen } from "./zahlschienen.js";

export const kasse = new AnteilsKasse({ speicher: geheim });

/** Zahladressen der Relays (NIP-11 → Profil des Betreibers), im Hintergrund gelernt. */
const relayZiele = new RelayZahlziele({
  profile: (autoren) => frageBeiAutoren({ kinds: [0], authors: autoren, limit: autoren.length * 2 }),
  speicher: localStorage,
});

/** Je Anfrage: Empfänger der Anteile und was die App höchstens zahlt. */
const anfragen = new Map<string, { empfaenger: Empfaenger; hoechstMsat: number }>();

/**
 * Die Empfänger eines Auftrags – was fehlt, bleibt beim Provider: Werber des
 * Providers aus dem Angebot, der eigene Werber aus dem Werbelink (5.1.3b), die
 * Relays des Pools – über sie geht der Auftrag –, soweit ihre Zahladresse schon
 * bekannt ist; Hosting aus der Spiegel-Datei neben freedom.html (5.3).
 */
export async function empfaengerFuer(providerPk: string): Promise<Empfaenger> {
  const werber = (await angebotVon(providerPk).catch(() => undefined))?.werber;
  const kundenWerber = werberZahlziel(localStorage, state.keypair?.pk);
  const urls = (await ensurePool()).urls;
  void relayZiele.lerne(urls).catch(() => { /* beim nächsten Auftrag */ });
  const relays = relayZiele.bekannte(urls);
  const hosting = await hostingZahlziel();
  return {
    entwicklung: ENTWICKLUNG,
    ...(werber ? { "werber-provider": { lud16: werber } } : {}),
    ...(kundenWerber ? { "werber-kunde": kundenWerber } : {}),
    ...(relays.length > 0 ? { relays } : {}),
    ...(hosting ? { hosting } : {}),
  };
}

/** Tag für den Kern des Auftrags – keiner, wenn die App nichts selbst zahlt. */
export function deklaration(e: Empfaenger): string[][] {
  const anteile = zahlbareAnteile(e, "lightning");
  return anteile.length > 0 ? [aufteilungTag(anteile)] : [];
}

export function merkeAnfrage(requestId: string, empfaenger: Empfaenger, hoechst: number): void {
  anfragen.set(requestId, { empfaenger, hoechstMsat: hoechst });
  // Nur die letzten – Antworten kommen gleich, nicht nach Tagen
  if (anfragen.size > 200) anfragen.delete(anfragen.keys().next().value!);
}

/** Eine Antwort abrechnen; die Posten der übrigen Anteile gehen in die Kasse. */
export async function rechneAntwortAb(requestId: string, amountMsat: number): Promise<{ providerMsat: number; posten: Posten[]; gekappt: boolean }> {
  const r = rechneAb(amountMsat, anfragen.get(requestId));
  await kasse.verbuche(r.posten).catch(() => { /* Tresor gesperrt – der Anteil bleibt beim Kunden */ });
  return r;
}

/**
 * Rechnung über genau diesen Betrag (4.8: vor dem Zahlen prüfen). Stimmt er
 * nicht, gilt: nichts gezahlt – nicht „unklar“, denn die Wallet sah sie nie.
 */
async function rechnungUeber(lud16: string, msat: number): Promise<string> {
  const rechnung = await rechnungVonAdresse(lud16, msat);
  if (bolt11BetragMsat(rechnung) !== msat) throw new Error(t("zahl.andererBetrag"));
  return rechnung;
}

async function lightningDa(): Promise<boolean> {
  return (await zahlschienen().find((r) => r.id === "lightning")?.verfuegbar()) ?? false;
}

/** Zahlung an den Provider – nur mit Lightning-Wallet und seiner Adresse im Angebot. */
export async function providerZahlung(providerPk: string): Promise<{ zahlung?: ProviderZahlung; grund?: string }> {
  const lud16 = (await angebotVon(providerPk).catch(() => undefined))?.lud16;
  if (!lud16) return { grund: t("zahl.providerOhneAdresse") };
  if (!(await lightningDa())) return { grund: t("zahl.keineLightningWallet") };
  return {
    zahlung: {
      rechnung: (msat) => rechnungUeber(lud16, msat),
      zahle: async (rechnung, msat) => (await zahle(zahlschienen(), { ziel: rechnung, betrag: { einheit: "msat", wert: msat }, zweck: "job" })).ref,
    },
  };
}

/** Gesammelte Anteile zahlen, wo 100 sats erreicht sind. */
export async function zahleAnteile(): Promise<{ gezahltMsat: number; unklarMsat: number }> {
  if (!(await lightningDa())) return { gezahltMsat: 0, unklarMsat: 0 };
  return kasse.zahleFaellige({
    rechnung: (ziel, msat) => rechnungUeber(ziel, msat),
    zahle: (rechnung, msat) => zahle(zahlschienen(), { ziel: rechnung, betrag: { einheit: "msat", wert: msat }, zweck: "gebuehr" }),
  });
}
