/**
 * Feste Eingaben für die Solana-Vektoren der App (A-21a, `docs/KIT-PLAN.md`): dieselben
 * Schlüssel, derselbe Blockhash wie im Protokoll (`protocol/test/sol-vektoren-faelle.ts`).
 * Verbindung und Wallet sind Attrappen: Die Verbindung nennt den festen Blockhash und
 * merkt, was gesendet wird; die Wallet signiert mit einem festen Schlüssel.
 */
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { kanalAdresse, oeffneKanalIx, stockeKanalAufIx } from "@freedomstack/protocol";
import { lockDeposit, lockRueckSwap, refundDepositOnChain, type WalletSigner } from "../src/sol-htlc.js";
import { claimSwap } from "../src/swap-client.js";
import { baueRelayEinloesung } from "../src/relay-einloesung.js";
import { sendeMitWallet } from "../src/zahlkanal.js";
import { buildSolTransfer } from "../src/sol-transfer.js";

const schluessel = (n: number): Keypair => Keypair.fromSeed(new Uint8Array(32).fill(n));
const adresse = (n: number): string => schluessel(n).publicKey.toBase58();
const BLOCKHASH = adresse(99);
const FRIST = 4_000_000_000;
const alsText = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const KUNDE = adresse(1), PROVIDER = adresse(2);

/** Nachricht einer gesendeten Transaktion (die Signaturen ergeben sich aus ihr). */
const nachrichtVon = (roh: Uint8Array): string => alsText(VersionedTransaction.deserialize(roh).message.serialize());

function attrappe(): { connection: never; gesendet: Uint8Array[] } {
  const gesendet: Uint8Array[] = [];
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 }),
    sendRawTransaction: async (roh: Uint8Array) => { gesendet.push(Uint8Array.from(roh)); return "signatur"; },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  return { connection: connection as never, gesendet };
}

const wallet = (n: number): WalletSigner => ({
  publicKey: schluessel(n).publicKey,
  signTransaction: async (tx) => { (tx as Transaction).partialSign(schluessel(n)); return tx; },
});

/** Genau eine gesendete Transaktion → ihre Nachricht. */
async function gesendet(fn: (a: ReturnType<typeof attrappe>) => Promise<unknown>): Promise<string> {
  const a = attrappe();
  await fn(a);
  if (a.gesendet.length !== 1) throw new Error(`erwartet eine Transaktion, ${a.gesendet.length}`);
  return nachrichtVon(a.gesendet[0]!);
}

/** Alle Fälle der App: Name → Nachricht (base64). Die Kanal-Fälle tragen die Namen des Protokolls – dieselben Bytes. */
export async function appFaelle(): Promise<Record<string, string>> {
  const preimage = new Uint8Array(32).fill(5);
  const kanal = kanalAdresse(KUNDE, PROVIDER, 7n).adresse;
  const sitzung = adresse(8);
  const empfaenger = [{ adresse: adresse(3), ppm: 20_000 }, { adresse: adresse(4), ppm: 5_000 }];
  return {
    "htlc-deposit": await gesendet(({ connection }) => lockDeposit({
      connection, wallet: wallet(1), providerSolAddress: PROVIDER, spendSwapId: "einsatz-1", refundSwapId: "rest-1",
      spendLamports: 30_000_000, refundLamports: 20_000_000, timelockUnix: FRIST, preimage,
    })),
    "htlc-rueckswap": await gesendet(({ connection }) => lockRueckSwap({
      connection, wallet: wallet(1), swapId: "rueck-1", paymentHashHex: "ab".repeat(32), lamports: 15_000_000, timelockUnix: FRIST, lpSol: PROVIDER,
    })),
    "htlc-einloesen": await gesendet(({ connection }) => claimSwap({
      connection, wallet: wallet(2), swapId: "einsatz-1", preimage, initiator: KUNDE, timelockUnix: FRIST,
    })),
    "htlc-zurueck": await gesendet(({ connection }) => refundDepositOnChain({ connection, wallet: wallet(1), swapIds: ["einsatz-1", "rest-1"] })),
    "relay-einloesung": nachrichtVon(await baueRelayEinloesung({
      connection: attrappe().connection, wallet: wallet(1), swapId: "rueck-2", preimage, initiator: PROVIDER,
      relayer: { pubkey: "cd".repeat(32), solAdresse: adresse(6), erstattungLamports: 10_000 },
    })),
    "kanal-oeffnen": await gesendet(({ connection }) => sendeMitWallet(connection, wallet(1), [oeffneKanalIx({
      kunde: KUNDE, provider: PROVIDER, nonce: 7n, betrag: 50_000_000n, ablauf: 1_800_000_000n, sitzungsSchluessel: sitzung, empfaenger,
    })])),
    "kanal-aufstocken": await gesendet(({ connection }) => sendeMitWallet(connection, wallet(1), [stockeKanalAufIx({ kunde: KUNDE, kanal, betrag: 10_000_000n })])),
    "ueberweisung": alsText((await buildSolTransfer(KUNDE, adresse(11), 2_500_000, undefined, attrappe().connection) as Transaction).serializeMessage()),
    "ueberweisung-referenz": alsText((await buildSolTransfer(KUNDE, adresse(11), 2_500_000, adresse(12), attrappe().connection) as Transaction).serializeMessage()),
  };
}

