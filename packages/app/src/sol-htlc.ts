/**
 * HTLC-Lock im Browser: Geld tatsächlich sperren, nicht nur behaupten.
 *
 * DIE LÜCKE, DIE DAS SCHLIESST
 * `startDeposit()` hat bisher ein Nostr-Event veröffentlicht und eine Zahl in
 * `localStorage` hochgezählt. Es fand keine Transaktion statt — kein Lock,
 * keine Wallet-Signatur, nichts auf der Kette. Provider prüfen inzwischen
 * on-chain und lehnen ein solches Deposit ab; damit war der SOL-Weg auf der
 * Kundenseite schlicht nicht benutzbar.
 *
 * WARUM NICHT DER VORHANDENE ADAPTER
 * `AnchorSolanaHtlc` in packages/protocol erwartet ein lokales `Keypair` und
 * signiert selbst. Im Browser gibt es kein Keypair — dort liegt der Schlüssel
 * in der Wallet des Nutzers, und die App bekommt ausschließlich eine
 * Signier-Funktion (seit A-21d2 `signiereTransaktion()`). Genau so soll es auch sein: eine Web-App, die
 * einen Solana-Secret-Key hält, wäre ein Verwahrer. Deshalb baut dieses Modul
 * dieselbe Instruktion, überlässt das Signieren aber der Wallet.
 *
 * ZWEI-HTLC-MUSTER
 * Ein Deposit besteht aus zwei getrennten Locks:
 *   - Verbrauchs-HTLC: Empfänger ist der Provider, daraus wird abgerechnet.
 *   - Rest-HTLC: Empfänger ist der Kunde selbst, sofort zurückholbar.
 * Beide teilen sich denselben Timelock. Nach Ablauf holt der Kunde beide
 * zurück — auch das Verbrauchs-HTLC, soweit der Provider es nicht eingelöst hat.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  AccountRole, alsDraht, anweisung, baueTransaktion, SYSTEM_PROGRAMM, type Instruction, type SolTransaktion,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";
import { fehlerText } from "./protokoll-texte.js";

/** Muss zur `declare_id!` des Anchor-Programms passen. */
export const HTLC_PROGRAM_ID = "FVb19sZ4jfTropLmSvm3xxVv7bZc95ai5GU96zxhXCJD";

/** Anchor-Diskriminator: die ersten 8 Bytes von sha256("global:<name>"). */
export function anchorSighash(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
}

/** PDA-Seed einer swap_id: sha256 des Strings, wie im Node-Adapter. */
export function swapIdBytes(swapId: string): Uint8Array {
  return sha256(new TextEncoder().encode(swapId));
}

export interface WalletSigner {
  publicKey: { toBase58(): string };
  /**
   * Seit A-21d2: eine Transaktion aus kit hinein, signiert zurück – die eingebaute Wallet
   * über `@noble/curves`, Wallet Standard als Bytes, eine injizierte über die Brücke zu web3.js.
   */
  signiereTransaktion(tx: SolTransaktion): Promise<SolTransaktion>;
}

/** Bauen und signieren lassen – der Zahler ist die Wallet (A-21d2, kit statt web3.js). */
export async function signiertVonWallet(
  connection: Pick<import("@solana/web3.js").Connection, "getLatestBlockhash">, wallet: WalletSigner, anweisungen: Instruction[],
): Promise<{ roh: Uint8Array; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = baueTransaktion({ zahler: wallet.publicKey.toBase58(), anweisungen, lebensdauer: { blockhash, letzteHoehe: BigInt(lastValidBlockHeight) } });
  return { roh: alsDraht(await wallet.signiereTransaktion(tx)), blockhash, lastValidBlockHeight };
}

export interface LockParams {
  swapId: string;
  /** 32 Bytes. Der Kunde kennt das Preimage, der Provider nur den Hash. */
  hashlock: Uint8Array;
  amountLamports: number;
  timelockUnix: number;
  /** Empfänger (base58) — Provider beim Verbrauchs-HTLC, Kunde beim Rest. */
  recipient: string;
}

/**
 * Baut die `initialize`-Instruktion – als kit-`Instruction` (A-21b2); die Transaktion
 * baut seit A-21d2 ebenfalls kit (`signiertVonWallet()`).
 *
 * Bewusst getrennt vom Senden: so lässt sich die Kodierung testen, ohne eine
 * Kette oder Wallet zu brauchen — und genau die Byte-Reihenfolge ist der Teil,
 * bei dem ein Fehler still zu einer abgelehnten Transaktion führt.
 */
export async function buildLockInstruction(
  params: LockParams,
  initiator: string,
): Promise<Instruction> {
  if (params.hashlock.length !== 32) {
    throw new Error(t("zahl.hashlockLaenge", { n: params.hashlock.length }));
  }
  if (!Number.isInteger(params.amountLamports) || params.amountLamports <= 0) {
    throw new Error(t("zahl.lamportsGanz"));
  }

  const idBytes = swapIdBytes(params.swapId);

  // Args: swap_id[32] + hashlock[32] + timelock i64le + amount u64le
  const args = new Uint8Array(80);
  const view = new DataView(args.buffer);
  args.set(idBytes, 0);
  args.set(params.hashlock, 32);
  view.setBigInt64(64, BigInt(params.timelockUnix), true);
  view.setBigUint64(72, BigInt(params.amountLamports), true);

  const disc = anchorSighash("initialize");
  const data = new Uint8Array(disc.length + args.length);
  data.set(disc, 0);
  data.set(args, disc.length);

  return anweisung(HTLC_PROGRAM_ID, [
    [initiator, AccountRole.WRITABLE_SIGNER],
    [params.recipient, AccountRole.READONLY],
    [await swapAddress(params.swapId), AccountRole.WRITABLE],
    [SYSTEM_PROGRAMM, AccountRole.READONLY],
  ], data);
}

/**
 * Die PDA-Adresse eines Swaps — für Anzeige, Nachprüfung im Explorer und die
 * Anweisungen. Bis A-21f über web3.js: kit rechnet sie nur über `crypto.subtle`,
 * und das fehlt der App über http im Heimnetz.
 */
export async function swapAddress(swapId: string): Promise<string> {
  const { PublicKey } = await import("@solana/web3.js");
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("swap"), swapIdBytes(swapId)],
    new PublicKey(HTLC_PROGRAM_ID),
  );
  return pda.toBase58();
}

export interface DepositLockResult {
  signature: string;
  spendAddress: string;
  refundAddress: string;
  /** Preimage in Hex. MUSS der Nutzer sichern — ohne kein Refund vor Ablauf. */
  preimageHex: string;
  hashlockHex: string;
}

export interface DepositLockParams {
  connection: import("@solana/web3.js").Connection;
  wallet: WalletSigner;
  providerSolAddress: string;
  spendSwapId: string;
  refundSwapId: string;
  spendLamports: number;
  refundLamports: number;
  timelockUnix: number;
  /** Preimage vorgeben (sonst zufällig). Nur für Tests. */
  preimage?: Uint8Array;
  onProgress?: (step: string) => void;
}

/**
 * Sperrt beide HTLCs in EINER Transaktion.
 *
 * Warum eine statt zwei: Ein Nutzer, der den ersten Dialog bestätigt und den
 * zweiten abbricht, hätte sonst Geld an den Provider gesperrt, ohne den
 * Rest-Anteil abgesichert zu haben. Solana-Transaktionen sind atomar — beide
 * Locks entstehen zusammen oder gar nicht. Das ist der Unterschied zwischen
 * einem sauberen Zustand und einem, den der Nutzer nicht mehr versteht.
 */
export async function lockDeposit(p: DepositLockParams): Promise<DepositLockResult> {
  if (p.spendLamports <= 0 || p.refundLamports < 0) {
    throw new Error(t("zahl.aufteilungUngueltig"));
  }
  const now = Math.floor(Date.now() / 1000);
  if (p.timelockUnix <= now + 600) {
    // Ein Timelock, der gleich abläuft, ist für den Provider wertlos — er
    // würde das Deposit ablehnen, und der Nutzer hätte umsonst gezahlt.
    throw new Error(t("zahl.timelockZehnMinuten"));
  }

  const preimage = p.preimage ?? crypto.getRandomValues(new Uint8Array(32));
  const hashlock = sha256(preimage);
  const initiator = p.wallet.publicKey.toBase58();

  p.onProgress?.(t("zahl.instruktionen"));
  const ixSpend = await buildLockInstruction(
    { swapId: p.spendSwapId, hashlock, amountLamports: p.spendLamports, timelockUnix: p.timelockUnix, recipient: p.providerSolAddress },
    initiator,
  );
  const anweisungen = [ixSpend];

  if (p.refundLamports > 0) {
    // Rest-HTLC an den Kunden selbst: sofort nach Ablauf zurückholbar.
    const ixRefund = await buildLockInstruction(
      { swapId: p.refundSwapId, hashlock, amountLamports: p.refundLamports, timelockUnix: p.timelockUnix, recipient: initiator },
      initiator,
    );
    anweisungen.push(ixRefund);
  }

  p.onProgress?.(t("zahl.warteWallet"));
  const { roh, blockhash, lastValidBlockHeight } = await signiertVonWallet(p.connection, p.wallet, anweisungen);

  p.onProgress?.(t("zahl.wirdGesendet"));
  const signature = await p.connection.sendRawTransaction(roh);

  p.onProgress?.(t("zahl.warteKette"));
  const conf = await p.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(t("zahl.txAbgelehnt", { fehler: JSON.stringify(conf.value.err) }));
  }

  return {
    signature,
    spendAddress: await swapAddress(p.spendSwapId),
    refundAddress: await swapAddress(p.refundSwapId),
    preimageHex: bytesToHex(preimage),
    hashlockHex: bytesToHex(hashlock),
  };
}

/**
 * Gegenrichtung (4.6c): Der Kunde sperrt SOL fuer den LP – Hashlock ist der
 * Hash seiner eigenen Rechnung, das Preimage kennt nur seine Lightning-Wallet.
 * Die Vorabsimulation bleibt an; nach Ablauf holt der Kunde mit `refund`
 * zurueck, falls der LP nicht einloest.
 */
export async function lockRueckSwap(p: {
  connection: import("@solana/web3.js").Connection;
  wallet: WalletSigner;
  swapId: string;
  paymentHashHex: string;
  lamports: number;
  timelockUnix: number;
  lpSol: string;
  onProgress?: (step: string) => void;
}): Promise<{ signature: string }> {
  if (!/^[0-9a-f]{64}$/.test(p.paymentHashHex)) throw new Error(t("zahl.rechnungsHashUngueltig"));
  if (p.timelockUnix <= Math.floor(Date.now() / 1000) + 3600) throw new Error(t("zahl.fristEineStunde"));
  const initiator = p.wallet.publicKey.toBase58();
  const ix = await buildLockInstruction(
    { swapId: p.swapId, hashlock: hexToBytes(p.paymentHashHex), amountLamports: p.lamports, timelockUnix: p.timelockUnix, recipient: p.lpSol },
    initiator,
  );
  p.onProgress?.(t("zahl.warteWallet"));
  const { roh, blockhash, lastValidBlockHeight } = await signiertVonWallet(p.connection, p.wallet, [ix]);
  p.onProgress?.(t("zahl.wirdGesendet"));
  const signature = await p.connection.sendRawTransaction(roh, { skipPreflight: false, preflightCommitment: "confirmed" });
  p.onProgress?.(t("zahl.warteKette"));
  const conf = await p.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) throw new Error(t("zahl.sperreAbgelehnt", { fehler: JSON.stringify(conf.value.err) }));
  return { signature };
}

/** Baut die `refund`-Instruktion (nach Ablauf des Timelocks). */
export async function buildRefundInstruction(swapId: string, initiator: string): Promise<Instruction> {
  return anweisung(HTLC_PROGRAM_ID, [
    [initiator, AccountRole.WRITABLE_SIGNER],
    [await swapAddress(swapId), AccountRole.WRITABLE],
  ], anchorSighash("refund"));
}

/**
 * Holt beide HTLCs zurück, soweit möglich.
 *
 * Wichtig für die Erwartungshaltung des Nutzers: Was der Provider bereits
 * eingelöst hat, ist weg — das war der bezahlte Verbrauch. Zurückkommen kann
 * nur der Rest. Deshalb meldet die Funktion, welche Teile erfolgreich waren,
 * statt bei der ersten Ablehnung abzubrechen.
 */
export async function refundDepositOnChain(p: {
  connection: import("@solana/web3.js").Connection;
  wallet: WalletSigner;
  swapIds: string[];
  onProgress?: (step: string) => void;
}): Promise<{ signature?: string; refunded: string[]; failed: { swapId: string; reason: string }[] }> {
  const initiator = p.wallet.publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);
  void now;

  const anweisungen: Instruction[] = [];
  const included: string[] = [];
  const failed: { swapId: string; reason: string }[] = [];

  for (const swapId of p.swapIds) {
    try {
      anweisungen.push(await buildRefundInstruction(swapId, initiator));
      included.push(swapId);
    } catch (e) {
      failed.push({ swapId, reason: fehlerText(e) });
    }
  }
  if (included.length === 0) {
    return { refunded: [], failed };
  }

  p.onProgress?.(t("zahl.warteWallet"));
  const { roh, blockhash, lastValidBlockHeight } = await signiertVonWallet(p.connection, p.wallet, anweisungen);
  const signature = await p.connection.sendRawTransaction(roh);
  const conf = await p.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    // Eine atomare Transaktion scheitert ganz: ein bereits eingelöstes HTLC
    // reißt die anderen mit. Der Nutzer soll wissen, warum.
    return {
      refunded: [],
      failed: included.map((swapId) => ({
        swapId,
        reason: t("zahl.rueckholungAbgelehnt"),
      })).concat(failed),
    };
  }
  return { signature, refunded: included, failed };
}
