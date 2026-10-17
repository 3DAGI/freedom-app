/**
 * Die Zahlschienen aus dem Zustand der App (Schritt 4.1b): Lightning ueber
 * NWC oder WebLN, Solana ueber die im Wallet-Tab verbundene Wallet – oder,
 * wenn keine verbunden ist, ueber die eingebaute (4.2a). Jede Geldfunktion
 * zahlt mit `zahle(zahlschienen(), …)` – nicht mit einer eigenen Wallet-Suche.
 */
import {
  NONCE_KONTO_BYTES, alsDraht, baueNonceKontoAnlegen, baueNonceKontoSchliessen, leseNonceKonto, neuerKontoSchluessel, nonceKontoKosten,
  pruefeOfflineUeberweisung, signiereMit, type PaymentRail, type SolTransaktion,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { offlineGrund } from "../protokoll-texte.js";
import { LightningRail, SolanaRail, type SolanaWalletZugang } from "../rails.js";
import { type NonceAblage, erstelleOfflineZahlung, leseAblage, schreibeAblage } from "../sol-offline-zahlung.js";
import { type EingebauteSolWallet, waehleAbsender } from "../sol-wallet.js";
import type { SolAnbieter } from "../solana-connect.js";
import { buildSolTransfer, solRpcUrl } from "../sol-transfer.js";
import { NWC_VERLAUF_MAX, leseWalletBuchungen, merkeZahlung, type WalletBuchung } from "../zahlungsbuch.js";
import { benutzbareEingebauteWallet, bestaetigeUeberLimit, frischeEmpfangsadresse } from "./eingebaute-wallet.js";
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
/** Eine signierte Transaktion (kit, A-21d2) ueber den RPC-Pool abschicken. */
async function sende(signiert: SolTransaktion): Promise<string> {
  const { Connection } = await import("@solana/web3.js");
  return new Connection(await solRpcUrl(), "confirmed").sendRawTransaction(alsDraht(signiert));
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
      const { fetchSolBalance } = await import("../solana-connect.js");
      const rpc = await solRpcUrl();
      const adressen = e.eigeneAdressen();
      const guthaben = await Promise.all(adressen.map(async (a) => ({ adresse: a, lamports: (await fetchSolBalance(a, rpc)).lamports })));
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
    new SolanaRail({ wallet: solanaWallet, baueUeberweisung: buildSolTransfer, online: () => netzDa() }),
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
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const info = await new Connection(await solRpcUrl(), "confirmed").getAccountInfo(new PublicKey(konto), "confirmed");
  if (!info) throw new Error(t("zahl.nonceNichtGefunden"));
  const ablage: NonceAblage = { konto, stand: leseNonceKonto(new Uint8Array(info.data)), gelesen: Math.floor(Date.now() / 1000), verbraucht: false };
  await schreibeAblage(geheim, ablage);
  return ablage;
}

/**
 * Nonce-Konto der eingebauten Wallet anlegen (mit Netz). Die Kosten zeigt
 * `bestaetige` vorher; ohne Zustimmung wird nichts gesendet.
 */
export async function legeNonceKontoAn(bestaetige: (k: { miete: number; gebuehr: number; gesamt: number }) => Promise<boolean>): Promise<NonceAblage> {
  const e = offlineWallet();
  const { Connection } = await import("@solana/web3.js");
  const c = new Connection(await solRpcUrl(), "confirmed");
  const miete = await c.getMinimumBalanceForRentExemption(NONCE_KONTO_BYTES);
  if (!(await bestaetige(nonceKontoKosten(miete)))) throw new Error(t("zahl.abgebrochenNichtsGesendet"));
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  // Das neue Konto unterschreibt nur hier (A-21d1) – sein Schlüssel ist danach genullt
  const konto = neuerKontoSchluessel();
  let tx: SolTransaktion;
  try {
    tx = signiereMit(baueNonceKontoAnlegen({
      zahler: e.adresse()!, nonceKonto: konto.adresse, mieteLamports: miete, blockhash, letzteHoehe: BigInt(lastValidBlockHeight),
    }), konto.geheim)!;
  } finally {
    konto.geheim.fill(0);
  }
  const signatur = await c.sendRawTransaction(alsDraht(e.signiereTransaktion(tx)));
  await c.confirmTransaction({ signature: signatur, blockhash, lastValidBlockHeight }, "confirmed");
  return legeStandAb(konto.adresse);
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
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const c = new Connection(await solRpcUrl(), "confirmed");
  const guthaben = await c.getBalance(new PublicKey(a.konto), "confirmed");
  if (guthaben > 0) {
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    const tx = baueNonceKontoSchliessen({ autoritaet: e.adresse()!, nonceKonto: a.konto, lamports: guthaben, blockhash, letzteHoehe: BigInt(lastValidBlockHeight) });
    const signatur = await c.sendRawTransaction(alsDraht(e.signiereTransaktion(tx)));
    await c.confirmTransaction({ signature: signatur, blockhash, lastValidBlockHeight }, "confirmed");
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
  const { Connection } = await import("@solana/web3.js");
  return new Connection(await solRpcUrl(), "confirmed").sendRawTransaction(roh);
}
