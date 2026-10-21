/**
 * Feste Eingaben für die Solana-Vektoren (A-21a, `docs/KIT-PLAN.md`): Schlüssel aus
 * festen Seeds, ein fester Blockhash, feste Beträge und Fristen. Daraus entstehen
 * Nachrichten, deren Bytes `fixtures/solana-vektoren.json` festhält – erzeugt mit
 * web3.js v1. Jeder Schritt bis A-21f muss dieselben Bytes liefern.
 */
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import {
  alsWeb3, AnchorSolanaHtlc, ausDraht, baueNonceKontoAnlegen, baueNonceKontoSchliessen, baueOfflineUeberweisung, erstatteKanalAnweisung,
  kanalAdresse, oeffneKanalAnweisung, poolRpc, rechneKanalAbIxs, RpcPool, signiereGutschrift, solSchluesselAus, stockeKanalAufAnweisung,
  type KanalEmpfaenger, type SolRpc,
} from "../src/index.js";

export const schluessel = (n: number): Keypair => Keypair.fromSeed(new Uint8Array(32).fill(n));
export const adresse = (n: number): string => schluessel(n).publicKey.toBase58();
/** Fester Blockhash (32 Byte, base58) – kein echter, nur für die Bytes. */
export const BLOCKHASH = adresse(99);
/** Frist weit in der Zukunft – Prüfungen gegen die Uhr bestehen sie immer. */
export const FRIST = 4_000_000_000;

export const KUNDE = adresse(1), PROVIDER = adresse(2), SITZUNG_GEHEIM = new Uint8Array(32).fill(8);
export const SITZUNG = adresse(8);
export const EMPFAENGER: KanalEmpfaenger[] = [{ adresse: adresse(3), ppm: 20_000 }, { adresse: adresse(4), ppm: 5_000 }];
export const KANAL = kanalAdresse(KUNDE, PROVIDER, 7n).adresse;

export const alsText = (b: ArrayLike<number>): string => Buffer.from(Uint8Array.from(b)).toString("base64");

/** Nachricht so zusammengesetzt, wie App (`sendeMitWallet()`) und Knoten (`KanalKasse`) es tun: Zahler, Blockhash, Anweisungen. */
export const nachricht = (zahler: string, ixs: TransactionInstruction[]): string => {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = new PublicKey(zahler);
  tx.recentBlockhash = BLOCKHASH;
  return alsText(tx.serializeMessage());
};

/**
 * Die Kette als JSON-RPC-Attrappe hinter einem echten Pool (seit A-21e2 sendet der Adapter über kit): nennt den festen
 * Blockhash, merkt die Nachricht jeder gesendeten Transaktion und bestätigt sie.
 */
function attrappe(): { rpc: SolRpc; nachrichten: string[] } {
  const nachrichten: string[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { id, method, params } = JSON.parse(String(init!.body)) as { id: number; method: string; params: unknown[] };
    const wert = (value: unknown) => ({ context: { slot: 1 }, value });
    let result: unknown = 10;
    if (method === "getLatestBlockhash") result = wert({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 });
    else if (method === "sendTransaction") {
      const roh = new Uint8Array(Buffer.from(String(params[0]), "base64"));
      nachrichten.push(alsText(ausDraht(roh).messageBytes));
      result = getBase58Decoder().decode(roh.subarray(1, 65));
    } else if (method === "getSignatureStatuses") result = wert([{ slot: 2, confirmations: 1, err: null, confirmationStatus: "confirmed" }]);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }) as typeof fetch;
  return { rpc: poolRpc(new RpcPool([{ url: "https://rpc.test" }], { fetchImpl })), nachrichten };
}

/** Der LP-Adapter des Knotens (HTLC) mit der Attrappe statt einer Kette. */
async function lp(fn: (a: AnchorSolanaHtlc) => Promise<unknown>): Promise<string> {
  if (process.env.HTLC_PROGRAM_ID) throw new Error("HTLC_PROGRAM_ID ist gesetzt – die Vektoren gelten für das Programm aus dem Code");
  const a = new AnchorSolanaHtlc({ rpcUrl: "http://127.0.0.1:1", schluessel: solSchluesselAus(schluessel(2).secretKey) });
  const { rpc, nachrichten } = attrappe();
  (a as unknown as { rpc: SolRpc }).rpc = rpc;
  await fn(a);
  if (nachrichten.length !== 1) throw new Error(`erwartet eine Nachricht, ${nachrichten.length}`);
  return nachrichten[0]!;
}

/** Alle Fälle des Protokolls und des Knotens: Name → Nachricht (base64). */
export async function protokollFaelle(): Promise<Record<string, string>> {
  const gutschrift = signiereGutschrift(SITZUNG_GEHEIM, KANAL, 12_345_678n, 1_800_000_000n);
  const stand = { autoritaet: KUNDE, nonce: adresse(98), lamportsJeSignatur: 5000 };
  return {
    "kanal-oeffnen": nachricht(KUNDE, [alsWeb3(oeffneKanalAnweisung({
      kunde: KUNDE, provider: PROVIDER, nonce: 7n, betrag: 50_000_000n, ablauf: 1_800_000_000n, sitzungsSchluessel: SITZUNG, empfaenger: EMPFAENGER,
    }))]),
    "kanal-aufstocken": nachricht(KUNDE, [alsWeb3(stockeKanalAufAnweisung({ kunde: KUNDE, kanal: KANAL, betrag: 10_000_000n }))]),
    "kanal-einloesen": nachricht(PROVIDER, rechneKanalAbIxs({ provider: PROVIDER, gutschrift, sitzungsSchluessel: SITZUNG, empfaenger: EMPFAENGER })),
    "kanal-erstatten": nachricht(adresse(5), [alsWeb3(erstatteKanalAnweisung({ kunde: KUNDE, kanal: KANAL }))]),
    // Seit A-21d1 baut kit diese drei – die Nachricht steht in `messageBytes`
    "nonce-anlegen": alsText(baueNonceKontoAnlegen({ zahler: KUNDE, nonceKonto: adresse(10), mieteLamports: 1_447_680, blockhash: BLOCKHASH, letzteHoehe: 1_000n }).messageBytes),
    "nonce-schliessen": alsText(baueNonceKontoSchliessen({ autoritaet: KUNDE, nonceKonto: adresse(10), lamports: 1_447_680, blockhash: BLOCKHASH, letzteHoehe: 1_000n }).messageBytes),
    "offline-ueberweisung": alsText(baueOfflineUeberweisung({ von: KUNDE, an: adresse(11), lamports: 2_500_000, nonceKonto: adresse(10), stand }).messageBytes),
    "lp-sperren": await lp((a) => a.lock({
      swapId: "lp-1", hashlock: new Uint8Array(32).fill(0xab), amountLamports: 40_000_000, timelockUnix: FRIST, recipient: KUNDE, initiator: PROVIDER,
    })),
    "lp-einloesen": await lp((a) => a.claim("lp-2", new Uint8Array(32).fill(5), KUNDE)),
    "lp-zurueck": await lp((a) => a.refund("lp-1")),
  };
}
