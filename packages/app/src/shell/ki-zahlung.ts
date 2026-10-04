/**
 * KI-Aufträge bezahlen (Schritt 5.1.3, Modell A+).
 *
 * Beim Senden hält die App die Empfänger der Anteile fest und deklariert im
 * versiegelten Auftrag, welche sie selbst zahlt (`aufteilungTag`). Bei der
 * Antwort teilt sie mit denselben Empfängern auf (`rechneAb`): Den Anteil des
 * Providers zahlt die Sitzung an seine Lightning-Adresse aus dem Angebot, die
 * übrigen sammelt die Kasse und zahlt sie ab 100 sats je Empfänger. Gezahlt
 * wird nur über die Zahlschienen, erst die Rechnung, dann das Geld.
 *
 * Mit Zahlkanal zum Provider (4.3d) trägt die Anfrage statt der Deklaration
 * eine Gutschrift – im Kanal teilt das Programm auf, und nach der Antwort zahlt
 * Lightning nichts; die App verbucht nur den Preis.
 */
import { ENTWICKLUNG, aufteilungTag, zahlbareAnteile, zahle, type Empfaenger, type Posten } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { AnteilsKasse, rechneAb } from "../anteile-kasse.js";
import { bolt11BetragMsat, rechnungVonAdresse } from "../rails.js";
import { RelayZahlziele } from "../relay-zahlziel.js";
import type { ProviderZahlung } from "../session-client.js";
import { werberZahlziel } from "../werbung.js";
import { KanalBuch, bedarfLamports } from "../zahlkanal.js";
import { kiZahlweg, kiZiele } from "../ki-zahlweg.js";
import { standardSchiene } from "../standard-schiene.js";
import { angebotVon, ensurePool, frageBeiAutoren, state } from "./state.js";
import { solText } from "../preis-anzeige.js";
import { toast } from "./ui.js";
import { hostingZahlziel } from "./hosting.js";
import { geheim } from "./tresor.js";
import { zahlschienen } from "./zahlschienen.js";

export const kasse = new AnteilsKasse({ speicher: geheim });

/** Zahladressen der Relays (NIP-11 → Profil des Betreibers), im Hintergrund gelernt. */
const relayZiele = new RelayZahlziele({
  profile: (autoren) => frageBeiAutoren({ kinds: [0], authors: autoren, limit: autoren.length * 2 }),
  speicher: localStorage,
});

/** Je Anfrage: Empfänger der Anteile, was die App höchstens zahlt, und ob der Zahlkanal zahlt. */
const anfragen = new Map<string, { empfaenger: Empfaenger; hoechstMsat: number; kanal?: boolean }>();

/** Zahlkanäle (4.3d) – mit ihrem Sitzungsschlüssel im Tresor. */
export const kanalBuch = new KanalBuch(geheim);

/**
 * Die Empfänger eines Auftrags – was fehlt, bleibt beim Provider: Werber des
 * Providers aus dem Angebot, der eigene Werber aus dem Werbelink (5.1.3b), die
 * Relays des Pools – über sie geht der Auftrag –, soweit ihre Zahladresse schon
 * bekannt ist; Hosting aus der Spiegel-Datei neben freedom.html (5.3).
 */
export async function empfaengerFuer(providerPk: string): Promise<Empfaenger> {
  const angebot = await angebotVon(providerPk).catch(() => undefined);
  // Werber des Providers (5.1) – mit SOL-Adresse auch per Zahlkanal (12.3)
  const werber = angebot?.werber || angebot?.werberSol ? { ...(angebot.werber ? { lud16: angebot.werber } : {}), ...(angebot.werberSol ? { sol: angebot.werberSol } : {}) } : undefined;
  const kundenWerber = werberZahlziel(localStorage, state.keypair?.pk);
  const urls = (await ensurePool()).urls;
  void relayZiele.lerne(urls).catch(() => { /* beim nächsten Auftrag */ });
  const relays = relayZiele.bekannte(urls);
  const hosting = await hostingZahlziel();
  return {
    entwicklung: ENTWICKLUNG,
    ...(werber ? { "werber-provider": werber } : {}),
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

export function merkeAnfrage(requestId: string, empfaenger: Empfaenger, hoechst: number, kanal = false): void {
  anfragen.set(requestId, { empfaenger, hoechstMsat: hoechst, ...(kanal ? { kanal } : {}) });
  // Nur die letzten – Antworten kommen gleich, nicht nach Tagen
  if (anfragen.size > 200) anfragen.delete(anfragen.keys().next().value!);
}

/**
 * Zahlkanal zu diesem Provider (4.3d)? Dann Gutschrift-Tags für den Kern der
 * Anfrage – zum Kurs aus seinem Angebot – und `merke()`, sobald die Anfrage
 * steht (vor dem Senden). Kein Kanal oder Gratis-Auftrag: undefined. Deckt der
 * Kanal das Gebot nicht (mehr) oder fehlt der Kurs: Fehler – nie still über
 * Lightning zahlen, wenn der Nutzer einen Kanal für diesen Provider hat.
 */
const knappGemeldet = new Set<string>();

export async function kanalGutschrift(
  providerPk: string, hoechst: number,
  /** Kurs aus einem gemerkten Angebot – ohne Netz gibt es keine Angebote (7.4c2). */
  gemerkterKurs?: { satsProSol: number },
): Promise<{ tags: string[][]; merke(requestId: string): Promise<void> } | undefined> {
  const jetzt = Math.floor(Date.now() / 1000);
  if (hoechst <= 0 || !kanalBuch.fuerProvider(providerPk, jetzt)) return undefined;
  const kurs = gemerkterKurs ?? (await angebotVon(providerPk).catch(() => undefined))?.kurs;
  if (!kurs) throw new Error(t("zahl.kanalOhneKurs"));
  const wahl = kanalBuch.gutschriftFuer({ provider: providerPk, bedarf: bedarfLamports(hoechst, kurs.satsProSol), jetzt });
  if (wahl.art === "erschoepft") throw new Error(t("zahl.kanalErschoepft"));
  if (wahl.art !== "kanal") return undefined;
  // Fast leer (E8): einmal je Kanal und Sitzung sagen – lange Sessions sollen nicht still abbrechen
  if (wahl.knapp && !knappGemeldet.has(wahl.eintrag.kanal)) {
    knappGemeldet.add(wahl.eintrag.kanal);
    toast(t("zahl.kanalKnapp", { frei: solText(Number(BigInt(wahl.eintrag.eingezahlt) - wahl.betrag)) }), true);
  }
  return { tags: wahl.tags, merke: (requestId) => kanalBuch.gesendet(wahl.eintrag.kanal, wahl.betrag, requestId) };
}

const kanalDa = (pk: string): boolean => !!kanalBuch.fuerProvider(pk, Math.floor(Date.now() / 1000));

/** Zahlweg prüfen (12.4a, E3 A): mit SOL als Standard-Schiene und ohne Kanal zu diesem Provider geht nichts hinaus. */
export function pruefeKiZahlweg(providerPk: string): void {
  if (kiZahlweg(standardSchiene(), kanalDa(providerPk)) === "kanal-noetig") throw new Error(t("zahl.kanalNoetig"));
}

/** Ziele eines bezahlten Laufs nach der Standard-Schiene (12.4a): mit SOL nur Provider mit Kanal; keiner → Fehler, nichts gesendet. */
export function zieleNachSchiene(liste: readonly string[], zahlt: boolean): string[] {
  if (!zahlt) return [...liste];
  const ziele = kiZiele(liste, standardSchiene(), kanalDa);
  if (liste.length > 0 && ziele.length === 0) throw new Error(t("zahl.kanalNoetig"));
  return ziele;
}

/** Zahlt für diese Anfrage der Zahlkanal? (Aus dem Speicher dieser Sitzung – gilt auch bei gesperrtem Tresor.) */
export function perKanal(requestId: string): boolean {
  return anfragen.get(requestId)?.kanal === true;
}

/** Antwort über den Zahlkanal: den Preis verbuchen. Gesperrter Tresor → bleibt offen, die nächste Gutschrift rechnet vorsichtig. */
export async function kanalAntwort(requestId: string, preisLamports: number | undefined): Promise<void> {
  await kanalBuch.beantwortet(requestId, preisLamports).catch(() => { /* bleibt offen */ });
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
