/**
 * Die Zahlschienen aus dem Zustand der App (Schritt 4.1b): Lightning ueber
 * NWC oder WebLN, Solana ueber die im Wallet-Tab verbundene Wallet – oder,
 * wenn keine verbunden ist, ueber die eingebaute (4.2a). Jede Geldfunktion
 * zahlt mit `zahle(zahlschienen(), …)` – nicht mit einer eigenen Wallet-Suche.
 */
import {
  KASSEN_RECHT, MIETE_LEERES_KONTO, NONCE_KONTO_BYTES, abschliessenAnweisung, abstimmenAnweisung, alsDraht, auszahlungKontoGroessen,
  auszahlungVorschlagenAnweisungen, ausfuehrenAnweisung, baueKasseAnlegen, baueNonceKontoAnlegen, baueNonceKontoSchliessen, baueTransaktion,
  behaeltArt, kassenAenderungen, kassenArt, kassenKontoGroesse, kassenKontoGroesseNach, kassenStandNach, kassenTresor, konfigurationAbschliessenAnweisung,
  konfigurationAusfuehrenAnweisung, konfigurationKontoGroessen, konfigurationVorschlagenAnweisungen, leseGuthaben, leseKasse, leseKonto, leseNonceKonto,
  leseProgrammEinstellungenVonKette, leseVorgang, neuerKontoSchluessel, neuesterBlockhash, nonceKontoKosten, pruefeOfflineUeberweisung,
  sendeTransaktion, signiereMit, txFehlerText, ueberweisungAnweisung, vorschlagsSchritte, warteAufBestaetigung, type Auszahlung, type Instruction,
  type KassenAenderung, type KassenArt, type KassenSchritt, type PaymentRail, type SolRpc, type SolTransaktion,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { solText } from "../preis-anzeige.js";
import { kassenUnterschreiber } from "../kasse-anzeige.js";
import { offlineGrund } from "../protokoll-texte.js";
import { LightningRail, SolanaRail, type SolanaWalletZugang } from "../rails.js";
import { type NonceAblage, erstelleOfflineZahlung, leseAblage, schreibeAblage } from "../sol-offline-zahlung.js";
import { type EingebauteSolWallet, UEBERWEISUNG_GEBUEHR, waehleAbsender } from "../sol-wallet.js";
import type { SolAnbieter } from "../solana-connect.js";
import { buildSolTransfer } from "../sol-transfer.js";
import { NWC_VERLAUF_MAX, leseWalletBuchungen, merkeZahlung, type WalletBuchung } from "../zahlungsbuch.js";
import { benutzbareEingebauteWallet, bestaetigeUeberLimit, frischeEmpfangsadresse } from "./eingebaute-wallet.js";
import { devnetRpc, solRpc } from "./state.js";
import { geheim } from "./tresor.js";
import { netzDa } from "./ui.js";
import { nwc, verbundeneSolanaWallet } from "./tabs/waehrung.js";

/**
 * Rechnung der eigenen Lightning-Wallet über NWC – zum Empfangen (6.3b), statt
 * über einen LNURL-Dienst. undefined ohne NWC; die Beschreibung bleibt leer.
 */
export async function eigeneRechnung(betragMsat: number): Promise<string | undefined> {
  return nwc ? (await nwc.makeInvoice(betragMsat, "")).invoice : undefined;
}

/**
 * Eigene SOL-Adresse zum Empfangen (12.7b): aus der eingebauten Wallet eine
 * frische aus dem Vorrat (nie die Hauptadresse, 4.9c), sonst die Adresse der
 * verbundenen Wallet – die nennt die Oberfläche ausdrücklich, denn an ihr
 * hängt alles, was diese Wallet je empfing. Ohne beides: warum nicht.
 */
export async function eigeneSolAdresse(): Promise<{ adresse: string; art: "frisch" | "verbunden" } | { fehlt: "vorrat" | "wallet" }> {
  const e = benutzbareEingebauteWallet();
  if (e) {
    const adresse = await frischeEmpfangsadresse();
    return adresse ? { adresse, art: "frisch" } : { fehlt: "vorrat" };
  }
  const v = verbundeneSolanaWallet();
  return v ? { adresse: v.adresse, art: "verbunden" } : { fehlt: "wallet" };
}

type WebLN = { enable(): Promise<void>; sendPayment(bolt11: string): Promise<{ preimage: string }> };
/** Eine signierte Transaktion (kit, A-21d2) ueber den RPC-Pool abschicken – mit Vorabsimulation (A-21d3a). */
async function sende(signiert: SolTransaktion): Promise<string> {
  return sendeTransaktion(await solRpc(), alsDraht(signiert));
}

/**
 * Senden und warten, bis die Kette bestaetigt; lehnt sie ab, mit ihrem Fehler (Nonce-Konto anlegen, schliessen).
 * `rpc` aus `solRpc({ einVorgang: true })` – die Nachfragen gehen an denselben Anbieter wie das Senden.
 */
async function sendeUndBestaetige(rpc: SolRpc, signiert: SolTransaktion, letzteHoehe: bigint): Promise<void> {
  const fehler = await warteAufBestaetigung(rpc, await sendeTransaktion(rpc, alsDraht(signiert)), letzteHoehe);
  if (fehler) throw new Error(t("zahl.txAbgelehnt", { fehler: txFehlerText(fehler) }));
}

/**
 * Signieren und senden: Kann die Wallet selbst senden, tut sie es; sonst
 * signiert sie, und die App schickt die Transaktion ueber den RPC-Pool ab.
 * Die Ueberweisung baut `buildSolTransfer()` seit A-21d2 mit kit.
 */
async function signiereUndSende(anbieter: SolAnbieter | undefined, tx: SolTransaktion): Promise<string> {
  if (anbieter?.signiereUndSendeTransaktion) return (await anbieter.signiereUndSendeTransaktion(tx)).signature;
  if (!anbieter?.signiereTransaktion) throw new Error(t("zahl.walletKannNichtSignieren"));
  return sende(await anbieter.signiereTransaktion(tx));
}

/** Verbundene Wallet vor eingebauter: Wer eine verbindet, will sie benutzen. */
function solanaWallet(): SolanaWalletZugang | undefined {
  const w = verbundeneSolanaWallet();
  if (w) return { adresse: w.adresse, signiereUndSende: (tx) => signiereUndSende(w.provider, tx as SolTransaktion) };
  const e = benutzbareEingebauteWallet();
  const adresse = e?.adresse();
  if (!e || !adresse) return undefined;
  return {
    adresse,
    // Frische Empfangsadressen (4.9c): gezahlt wird von einer, die allein reicht.
    absender: async (lamports) => {
      const rpc = await solRpc();
      const adressen = e.eigeneAdressen();
      const guthaben = await Promise.all(adressen.map(async (a) => ({ adresse: a, lamports: Number(await leseGuthaben(rpc, a)) })));
      return waehleAbsender(guthaben, lamports);
    },
    freigabe: (lamports, ziel) => e.freigabe(lamports, ziel, bestaetigeUeberLimit),
    signiereUndSende: async (tx) => sende(e.signiereTransaktion(tx as SolTransaktion)),
  };
}

/** Ist eine Schiene verbunden, die zahlen kann (A-14b2)? Sonst fragt der Tarif „Automatisch“ gar nicht erst. */
export async function eineSchieneDa(): Promise<boolean> {
  const da = await Promise.all(zahlschienen().map((r) => r.verfuegbar().catch(() => false)));
  return da.some(Boolean);
}

export function zahlschienen(): PaymentRail[] {
  return [
    new LightningRail({
      nwc: () => nwc,
      webln: () => (globalThis as { webln?: WebLN }).webln,
      online: () => netzDa(),
    }),
    new SolanaRail({
      wallet: solanaWallet,
      baueUeberweisung: async (von, an, lamports, referenz) => buildSolTransfer(von, an, lamports, referenz, await solRpc()),
      online: () => netzDa(),
    }),
  ].map(mitBuch);
}

/**
 * Nach dem Zahlen ins Zahlungsbuch (12.7c). Scheitert das Merken (Tresor
 * gesperrt), gilt die Zahlung trotzdem – sie fehlt dann nur im Verlauf.
 */
function mitBuch(r: PaymentRail): PaymentRail {
  const zahlen = r.pay.bind(r);
  r.pay = async (a) => {
    const beleg = await zahlen(a);
    try {
      await merkeZahlung(geheim, a.zweck, beleg);
    } catch { /* nur der Verlauf fehlt */ }
    return beleg;
  };
  return r;
}

/** Verlauf der eigenen Lightning-Wallet (12.7c, NIP-47 `list_transactions`) – undefined ohne NWC. */
export async function lightningVerlauf(): Promise<WalletBuchung[] | undefined> {
  return nwc ? leseWalletBuchungen(await nwc.call("list_transactions", { limit: NWC_VERLAUF_MAX })) : undefined;
}

// ------------------------------------------------ SOL ohne Internet (7.2b)

/** Die eingebaute Wallet – nur sie signiert offline sicher (externe Wallets brauchen oft Netz). */
function offlineWallet(): EingebauteSolWallet {
  const e = benutzbareEingebauteWallet();
  if (!e?.adresse()) throw new Error(t("zahl.offlineNurEingebaut"));
  return e;
}

/** Den aktuellen Wert eines Nonce-Kontos von der Kette lesen und ablegen (mit Netz). */
async function legeStandAb(konto: string): Promise<NonceAblage> {
  const info = await leseKonto(await solRpc(), konto);
  if (!info) throw new Error(t("zahl.nonceNichtGefunden"));
  const ablage: NonceAblage = { konto, stand: leseNonceKonto(info.daten), gelesen: Math.floor(Date.now() / 1000), verbraucht: false };
  await schreibeAblage(geheim, ablage);
  return ablage;
}

/**
 * Nonce-Konto der eingebauten Wallet anlegen (mit Netz). Die Kosten zeigt
 * `bestaetige` vorher; ohne Zustimmung wird nichts gesendet.
 */
export async function legeNonceKontoAn(bestaetige: (k: { miete: number; gebuehr: number; gesamt: number }) => Promise<boolean>): Promise<NonceAblage> {
  const e = offlineWallet();
  const rpc = await solRpc({ einVorgang: true });
  const miete = Number(await rpc.getMinimumBalanceForRentExemption(BigInt(NONCE_KONTO_BYTES), { commitment: "confirmed" }).send());
  if (!(await bestaetige(nonceKontoKosten(miete)))) throw new Error(t("zahl.abgebrochenNichtsGesendet"));
  const { blockhash, letzteHoehe } = await neuesterBlockhash(rpc);
  // Das neue Konto unterschreibt nur hier (A-21d1) – sein Schlüssel ist danach genullt
  const konto = neuerKontoSchluessel();
  let tx: SolTransaktion;
  try {
    tx = signiereMit(baueNonceKontoAnlegen({
      zahler: e.adresse()!, nonceKonto: konto.adresse, mieteLamports: miete, blockhash, letzteHoehe,
    }), konto.geheim)!;
  } finally {
    konto.geheim.fill(0);
  }
  await sendeUndBestaetige(rpc, e.signiereTransaktion(tx), letzteHoehe);
  return legeStandAb(konto.adresse);
}

// ------------------------------------------------ Kasse über Squads (A-12b2b)

/**
 * Eine Kasse anlegen – nur mit der eingebauten Wallet und nur auf Devnet (V7, bis M-8): über `devnetRpc()`, nie über
 * den gemeinsamen Pool. `gruender` ist die eigene Adresse für die Kasse (A-12b2a); zahlen kann jede eigene, die allein
 * reicht – sie steht als Ersteller auf der Kette. Kosten und Zahler zeigt `bestaetige` vorher; ohne Zustimmung geht nichts hinaus.
 */
export async function legeKasseAn(
  p: { art: KassenArt; gruender: string; weitere: readonly string[]; zeitschlossSek: number },
  bestaetige: (k: { miete: number; gebuehr: number; gesamt: number; zahler: string }) => Promise<boolean>,
): Promise<string> {
  const e = benutzbareEingebauteWallet();
  if (!e?.adresse()) throw new Error(t("kasse.ohneWallet"));
  const eigene = e.eigeneAdressen();
  if (!eigene.includes(p.gruender)) throw new Error(t("zahl.nichtEigeneAdresse"));
  const rpc = await devnetRpc();
  if (!rpc) throw new Error(t("kasse.nurDevnet"));
  const einstellungen = await leseProgrammEinstellungenVonKette(rpc);
  if (!einstellungen) throw new Error(t("kasse.ohneSquads"));
  const miete = Number(await rpc.getMinimumBalanceForRentExemption(BigInt(kassenKontoGroesse(1 + p.weitere.length)), { commitment: "confirmed" }).send());
  const gebuehr = Number(einstellungen.gebuehr);
  // Zwei Unterschriften (Zahler und Create-Key); `waehleAbsender()` rechnet eine Netzgebühr selbst dazu
  const zahler = await kassenZahler(rpc, e, miete + gebuehr + UEBERWEISUNG_GEBUEHR, p.gruender);
  if (!(await bestaetige({ miete, gebuehr, gesamt: miete + gebuehr + 2 * UEBERWEISUNG_GEBUEHR, zahler }))) throw new Error(t("zahl.abgebrochenNichtsGesendet"));
  const lebensdauer = await neuesterBlockhash(rpc);
  const { tx, kasse } = baueKasseAnlegen({ ...p, ersteller: zahler, schatzamt: einstellungen.schatzamt, lebensdauer });
  await sendeUndBestaetige(rpc, e.signiereTransaktion(tx), lebensdauer.letzteHoehe);
  return kasse;
}

/** Wer zahlt: am liebsten die Adresse für die Kasse selbst – jede andere ist danach auf der Kette mit ihr verbunden (V4). */
async function kassenZahler(rpc: SolRpc, e: EingebauteSolWallet, betrag: number, bevorzugt: string | undefined): Promise<string> {
  const guthaben = await Promise.all(e.eigeneAdressen().map(async (a) => ({ adresse: a, lamports: Number(await leseGuthaben(rpc, a)) })));
  try {
    return waehleAbsender(guthaben.filter((g) => g.adresse === bevorzugt), betrag);
  } catch {
    return waehleAbsender(guthaben, betrag);
  }
}

/**
 * In die Kasse einzahlen (A-12b2c): an ihren Tresor, nur mit der eingebauten Wallet, nur auf Devnet (`devnetRpc()`) und
 * nur in eine Kasse, die die App so anlegen würde (`kassenArt()`, ohne Verwalter). Zahler wie beim Anlegen; `bestaetige`
 * zeigt ihn vorher, danach gilt das Tageslimit (`freigabe()`). Gibt den Tresor zurück.
 */
export async function zahleInKasse(
  p: { kasse: string; lamports: number; bevorzugt?: string },
  bestaetige: (k: { zahler: string; tresor: string }) => Promise<boolean>,
): Promise<string> {
  const e = benutzbareEingebauteWallet();
  if (!e?.adresse()) throw new Error(t("kasse.ohneWallet"));
  if (!Number.isSafeInteger(p.lamports) || p.lamports <= 0) throw new Error(t("zahl.ungueltigerBetrag"));
  const rpc = await devnetRpc();
  if (!rpc) throw new Error(t("kasse.nurDevnet"));
  const stand = await leseKasse(rpc, p.kasse);
  if (!stand || !kassenArt(stand)) throw new Error(t("kasse.nichtEinzahlen"));
  const tresor = kassenTresor(p.kasse);
  // Der Tresor ist ein gewöhnliches Konto: unter der Miete lehnt die Kette die erste Einzahlung ab
  const vorher = Number(await leseGuthaben(rpc, tresor));
  if (vorher + p.lamports < MIETE_LEERES_KONTO) throw new Error(t("kasse.zuWenig", { betrag: solText(MIETE_LEERES_KONTO - vorher) }));
  const zahler = await kassenZahler(rpc, e, p.lamports, p.bevorzugt);
  if (!(await bestaetige({ zahler, tresor })) || !(await e.freigabe(p.lamports, tresor, bestaetigeUeberLimit))) {
    throw new Error(t("zahl.abgebrochenNichtsGesendet"));
  }
  const lebensdauer = await neuesterBlockhash(rpc);
  const tx = baueTransaktion({ zahler, anweisungen: [ueberweisungAnweisung({ von: zahler, an: tresor, lamports: BigInt(p.lamports) })], lebensdauer });
  await sendeUndBestaetige(rpc, e.signiereTransaktion(tx), lebensdauer.letzteHoehe);
  return tresor;
}

/**
 * Ein Schritt einer Auszahlung aus der Kasse (A-12c1): vorschlagen, dafür/dagegen stimmen, ausführen (abgeschlossen im
 * selben Zug, die Miete geht in den Tresor) oder abschließen – nur mit der eingebauten Wallet, nur auf Devnet und nur in
 * Kassen der App. Ob der Schritt geht, sagt `vorschlagsSchritte()` aus dem Stand auf der Kette; Empfänger und Betrag einer
 * Stimme oder Ausführung kommen von der Kette (V6), nie aus dem Raum. `mitglied` ist die eigene Adresse für die Kasse – sie
 * unterschreibt; Gebühr und Miete zahlt wie beim Anlegen am liebsten sie selbst (`kassenZahler()`). `bestaetige` zeigt
 * vorher Zahler, Miete und Auszahlung; ohne Zustimmung geht nichts hinaus. Gibt die Nummer des Vorschlags zurück.
 * Seit A-12d1 ebenso Änderungen der Kasse: „aendern“ stellt sie mit `kassenAenderungen()` aus dem Stand auf der Kette zusammen
 * (die Art bleibt), dafür stimmen und ausführen nur, wenn die Kasse ihre Art behält (`behaeltArt()`); wer ausführt, zahlt
 * die Miete, wenn das Konto der Kasse wächst.
 * Seit A-12c3 unterschreibt auch eine verbundene Wallet, wenn ihre Adresse die für die Kasse ist (`kassenUnterschreiber()`, die
 * eingebaute geht vor): Sie zahlt Gebühr und Miete selbst und signiert nur – gesendet wird über `devnetRpc()`, nie über die
 * Wallet (sie schickte an ihr eigenes Netz).
 */
export async function kassenSchritt(
  a: { kasse: string; mitglied?: string } & (
    | { schritt: "vorschlagen"; auszahlung: Auszahlung }
    | { schritt: "aendern"; dazu?: readonly string[]; weg?: readonly string[]; zeitschlossSek?: number }
    | { schritt: KassenSchritt; index: bigint }),
  bestaetige: (k: { zahler: string; miete: number; auszahlung: Auszahlung | null; konfiguration?: KassenAenderung[]; verbunden?: boolean }) => Promise<boolean>,
): Promise<bigint> {
  const e = benutzbareEingebauteWallet();
  const v = verbundeneSolanaWallet();
  const u = kassenUnterschreiber(a.mitglied, e?.adresse() ? e.eigeneAdressen() : undefined, v && { adresse: v.adresse, signiert: !!v.provider?.signiereTransaktion });
  if (!u) throw new Error(t("kasse.nurEingebaut"));
  const eigen = u.mitglied;
  // Abschließen braucht keine Unterschrift eines Mitglieds, alles andere die eigene Adresse für die Kasse
  if (!eigen && a.schritt !== "abschliessen") throw new Error(t("kasse.nurEingebaut"));
  const rpc = await devnetRpc();
  if (!rpc) throw new Error(t("kasse.nurDevnet"));
  const stand = await leseKasse(rpc, a.kasse);
  if (!stand || !kassenArt(stand)) throw new Error(t("kasse.nichtAuszahlen"));
  const mieteFuer = async (bytes: number) => Number(await rpc.getMinimumBalanceForRentExemption(BigInt(bytes), { commitment: "confirmed" }).send());
  let miete = 0, index: bigint;
  let auszahlung: Auszahlung | null = null, konfiguration: KassenAenderung[] | null | undefined;
  let baue: (zahler: string) => Instruction[];
  if (a.schritt === "vorschlagen" || a.schritt === "aendern") {
    if (!((stand.mitglieder.find((m) => m.adresse === eigen)?.rechte ?? 0) & KASSEN_RECHT.vorschlagen)) throw new Error(t("kasse.schrittNicht"));
    const p = { kasse: a.kasse, index: stand.transaktionsIndex + 1n, vorschlagender: eigen! };
    index = p.index;
    let groesse: { transaktion: number; vorschlag: number };
    if (a.schritt === "aendern") {
      // Aus dem frisch gelesenen Stand: ändert sich nichts mehr oder hielte die Art nicht, hat sich die Kette geändert
      let aenderungen: KassenAenderung[];
      try {
        aenderungen = kassenAenderungen(stand, a);
      } catch {
        throw new Error(t("kasse.schrittNicht"));
      }
      konfiguration = aenderungen;
      groesse = konfigurationKontoGroessen(aenderungen, stand.mitglieder.length);
      baue = (zahler) => konfigurationVorschlagenAnweisungen({ ...p, mietZahler: zahler, aenderungen });
    } else {
      // Danach muss der Tresor leer oder mietfrei sein – sonst lehnt die Kette die Ausführung ab
      const rest = Number(await leseGuthaben(rpc, kassenTresor(a.kasse))) - Number(a.auszahlung.lamports);
      if (rest !== 0 && rest < MIETE_LEERES_KONTO) throw new Error(t("kasse.zuViel"));
      auszahlung = a.auszahlung;
      groesse = auszahlungKontoGroessen(stand.mitglieder.length);
      baue = (zahler) => auszahlungVorschlagenAnweisungen({ ...p, mietZahler: zahler, ...a.auszahlung });
    }
    for (const b of [groesse.transaktion, groesse.vorschlag]) miete += await mieteFuer(b);
  } else {
    const { schritt } = a;
    index = a.index;
    const vg = await leseVorgang(rpc, a.kasse, index);
    auszahlung = vg?.auszahlung ?? null;
    konfiguration = vg?.konfiguration;
    const jetztSek = Math.floor(Date.now() / 1000);
    if (!vg || !vorschlagsSchritte({ stand, vorschlag: vg.vorschlag, auszahlung, konfiguration, mitglied: eigen, jetztSek }).includes(schritt)) throw new Error(t("kasse.schrittNicht"));
    // Für eine Änderung, nach der die Kasse eine andere Art hätte, stimmt die App nicht und führt sie nicht aus
    if (konfiguration && (schritt === "dafuer" || schritt === "ausfuehren") && !behaeltArt(stand, konfiguration)) throw new Error(t("kasse.schrittNicht"));
    const geht = { kasse: a.kasse, index };
    const abschliessen = !stand.mieteAn ? []
      : [konfiguration !== undefined ? konfigurationAbschliessenAnweisung({ ...geht, mieteAn: stand.mieteAn }) : abschliessenAnweisung({ ...geht, mieteAn: stand.mieteAn })];
    if (konfiguration && schritt === "ausfuehren") {
      // Kommt ein Mitglied dazu, wächst das Konto der Kasse um zehn Plätze – die Miete dafür zahlt, wer ausführt
      const konto = await leseKonto(rpc, a.kasse);
      if (!konto) throw new Error(t("kasse.nichtAuszahlen"));
      const neu = kassenKontoGroesseNach(konto.daten.length, kassenStandNach(stand, konfiguration).mitglieder.length);
      if (neu > konto.daten.length) miete = Math.max(0, (await mieteFuer(neu)) - Number(konto.lamports));
    }
    baue = (zahler) => schritt === "abschliessen" ? abschliessen
      : schritt === "ausfuehren" && konfiguration ? [konfigurationAusfuehrenAnweisung({ ...geht, mitglied: eigen!, mietZahler: zahler }), ...abschliessen]
      : schritt === "ausfuehren" ? [ausfuehrenAnweisung({ ...geht, mitglied: eigen!, auszahlung: auszahlung! }), ...abschliessen]
      : [abstimmenAnweisung({ ...geht, mitglied: eigen!, dafuer: schritt === "dafuer" })];
  }
  // Die verbundene Wallet zahlt selbst – reicht ihr Guthaben nicht, sagt es `waehleAbsender()` wie bei der eingebauten
  const zahler = u.wer === "eingebaut" ? await kassenZahler(rpc, e!, miete, eigen)
    : waehleAbsender([{ adresse: v!.adresse, lamports: Number(await leseGuthaben(rpc, v!.adresse)) }], miete);
  const verbunden = u.wer === "verbunden" ? { verbunden: true } : {};
  if (!(await bestaetige({ zahler, miete, auszahlung, ...(konfiguration ? { konfiguration } : {}), ...verbunden }))) throw new Error(t("zahl.abgebrochenNichtsGesendet"));
  const lebensdauer = await neuesterBlockhash(rpc);
  const tx = baueTransaktion({ zahler, anweisungen: baue(zahler), lebensdauer });
  const signiert = u.wer === "eingebaut" ? e!.signiereTransaktion(tx) : await v!.provider!.signiereTransaktion!(tx);
  await sendeUndBestaetige(rpc, signiert, lebensdauer.letzteHoehe);
  return index;
}

/** Den Wert neu lesen (mit Netz) – danach ist wieder eine Offline-Zahlung moeglich. */
export async function frischeNonceAuf(): Promise<NonceAblage> {
  const a = leseAblage(geheim);
  if (!a) throw new Error(t("zahl.keinNonceAngelegt"));
  return legeStandAb(a.konto);
}

/** Nonce-Konto schliessen (mit Netz): die Miete zurueck an die eingebaute Wallet, die Ablage weg. */
export async function schliesseNonceKonto(): Promise<number> {
  const e = offlineWallet();
  const a = leseAblage(geheim);
  if (!a) throw new Error(t("zahl.keinNonceAngelegt"));
  const rpc = await solRpc({ einVorgang: true });
  const guthaben = Number(await leseGuthaben(rpc, a.konto));
  if (guthaben > 0) {
    const { blockhash, letzteHoehe } = await neuesterBlockhash(rpc);
    const tx = baueNonceKontoSchliessen({ autoritaet: e.adresse()!, nonceKonto: a.konto, lamports: guthaben, blockhash, letzteHoehe });
    await sendeUndBestaetige(rpc, e.signiereTransaktion(tx), letzteHoehe);
  }
  await schreibeAblage(geheim, null);
  return guthaben;
}

/** Offline zahlen – ohne Netz; Tageslimit wie bei jeder Zahlung der eingebauten Wallet. */
export async function zahleSolOffline(an: string, lamports: number): Promise<Uint8Array> {
  return erstelleOfflineZahlung(offlineWallet(), geheim, { an, lamports }, bestaetigeUeberLimit);
}

/**
 * Empfangene Offline-Ueberweisung pruefen und einreichen – das Geraet mit Netz
 * ist das Gateway. Mit Vorabsimulation: Ist der Wert schon verbraucht, lehnt
 * der RPC ab, bevor etwas auf die Kette geht.
 */
export async function reicheSolOfflineEin(roh: Uint8Array): Promise<string> {
  const p = pruefeOfflineUeberweisung(roh);
  if (!p.ok) throw new Error(offlineGrund(p));
  return sendeTransaktion(await solRpc(), roh);
}
