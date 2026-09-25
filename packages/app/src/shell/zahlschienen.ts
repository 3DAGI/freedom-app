/**
 * Die Zahlschienen aus dem Zustand der App (Schritt 4.1b): Lightning ueber
 * NWC oder WebLN, Solana ueber die im Wallet-Tab verbundene Wallet. Jede
 * Geldfunktion zahlt mit `zahle(zahlschienen(), …)` – nicht mehr mit einer
 * eigenen Wallet-Suche.
 */
import type { PaymentRail } from "@freedomstack/protocol";
import { LightningRail, SolanaRail } from "../rails.js";
import { buildSolTransfer, solRpcUrl } from "../sol-transfer.js";
import { nwc, verbundeneSolanaWallet } from "./tabs/waehrung.js";

type WebLN = { enable(): Promise<void>; sendPayment(bolt11: string): Promise<{ preimage: string }> };
type Anbieter = {
  signAndSendTransaction?(tx: unknown): Promise<{ signature: string }>;
  signTransaction?(tx: unknown): Promise<unknown>;
};

/**
 * Signieren und senden: Kann die Wallet selbst senden, tut sie es; sonst
 * signiert sie, und die App schickt die Transaktion ueber den RPC-Pool ab.
 */
async function signiereUndSende(anbieter: Anbieter | undefined, tx: unknown): Promise<string> {
  if (anbieter?.signAndSendTransaction) return (await anbieter.signAndSendTransaction(tx)).signature;
  if (!anbieter?.signTransaction) throw new Error("Die Wallet kann keine Transaktion signieren");
  const signiert = (await anbieter.signTransaction(tx)) as { serialize(): Uint8Array };
  const { Connection } = await import("@solana/web3.js");
  return new Connection(await solRpcUrl(), "confirmed").sendRawTransaction(signiert.serialize());
}

export function zahlschienen(): PaymentRail[] {
  return [
    new LightningRail({
      nwc: () => nwc,
      webln: () => (globalThis as { webln?: WebLN }).webln,
    }),
    new SolanaRail({
      wallet: () => {
        const w = verbundeneSolanaWallet();
        return w ? { adresse: w.adresse, signiereUndSende: (tx) => signiereUndSende(w.provider as Anbieter | undefined, tx) } : undefined;
      },
      baueUeberweisung: buildSolTransfer,
    }),
  ];
}
