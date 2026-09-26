/**
 * Die Zahlschienen aus dem Zustand der App (Schritt 4.1b): Lightning ueber
 * NWC oder WebLN, Solana ueber die im Wallet-Tab verbundene Wallet – oder,
 * wenn keine verbunden ist, ueber die eingebaute (4.2a). Jede Geldfunktion
 * zahlt mit `zahle(zahlschienen(), …)` – nicht mit einer eigenen Wallet-Suche.
 */
import type { PaymentRail } from "@freedomstack/protocol";
import { LightningRail, SolanaRail, type SolanaWalletZugang } from "../rails.js";
import { type SignierbareTx, waehleAbsender } from "../sol-wallet.js";
import { buildSolTransfer, solRpcUrl } from "../sol-transfer.js";
import { benutzbareEingebauteWallet, bestaetigeUeberLimit } from "./eingebaute-wallet.js";
import { netzDa } from "./ui.js";
import { nwc, verbundeneSolanaWallet } from "./tabs/waehrung.js";

type WebLN = { enable(): Promise<void>; sendPayment(bolt11: string): Promise<{ preimage: string }> };
type Anbieter = {
  signAndSendTransaction?(tx: unknown): Promise<{ signature: string }>;
  signTransaction?(tx: unknown): Promise<unknown>;
};

/** Eine signierte Transaktion ueber den RPC-Pool abschicken. */
async function sende(signiert: unknown): Promise<string> {
  const { Connection } = await import("@solana/web3.js");
  return new Connection(await solRpcUrl(), "confirmed").sendRawTransaction((signiert as { serialize(): Uint8Array }).serialize());
}

/**
 * Signieren und senden: Kann die Wallet selbst senden, tut sie es; sonst
 * signiert sie, und die App schickt die Transaktion ueber den RPC-Pool ab.
 */
async function signiereUndSende(anbieter: Anbieter | undefined, tx: unknown): Promise<string> {
  if (anbieter?.signAndSendTransaction) return (await anbieter.signAndSendTransaction(tx)).signature;
  if (!anbieter?.signTransaction) throw new Error("Die Wallet kann keine Transaktion signieren");
  return sende(await anbieter.signTransaction(tx));
}

/** Verbundene Wallet vor eingebauter: Wer eine verbindet, will sie benutzen. */
function solanaWallet(): SolanaWalletZugang | undefined {
  const w = verbundeneSolanaWallet();
  if (w) return { adresse: w.adresse, signiereUndSende: (tx) => signiereUndSende(w.provider as Anbieter | undefined, tx) };
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
    signiereUndSende: async (tx) => {
      e.signiere(tx as SignierbareTx);
      return sende(tx);
    },
  };
}

export function zahlschienen(): PaymentRail[] {
  return [
    new LightningRail({
      nwc: () => nwc,
      webln: () => (globalThis as { webln?: WebLN }).webln,
      online: () => netzDa(),
    }),
    new SolanaRail({ wallet: solanaWallet, baueUeberweisung: buildSolTransfer, online: () => netzDa() }),
  ];
}
