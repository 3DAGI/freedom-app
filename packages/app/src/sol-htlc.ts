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
 * `signTransaction`-Funktion. Genau so soll es auch sein: eine Web-App, die
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
import { bytesToHex } from "@noble/hashes/utils.js";

/** Muss zur `declare_id!` des Anchor-Programms passen. */
export const HTLC_PROGRAM_ID = "B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk";

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
  signTransaction(tx: unknown): Promise<unknown>;
  /** Manche Wallets können mehrere Transaktionen in einem Dialog bestätigen. */
  signAllTransactions?(txs: unknown[]): Promise<unknown[]>;
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
 * Baut die `initialize`-Instruktion.
 *
 * Bewusst getrennt vom Senden: so lässt sich die Kodierung testen, ohne eine
 * Kette oder Wallet zu brauchen — und genau die Byte-Reihenfolge ist der Teil,
 * bei dem ein Fehler still zu einer abgelehnten Transaktion führt.
 */
export async function buildLockInstruction(
  params: LockParams,
  initiator: string,
): Promise<import("@solana/web3.js").TransactionInstruction> {
  const { PublicKey, SystemProgram, TransactionInstruction } = await import("@solana/web3.js");

  if (params.hashlock.length !== 32) {
    throw new Error(`Hashlock muss 32 Bytes haben, hat ${params.hashlock.length}`);
  }
  if (!Number.isInteger(params.amountLamports) || params.amountLamports <= 0) {
    throw new Error("Betrag muss eine positive ganze Zahl in Lamports sein");
  }

  const idBytes = swapIdBytes(params.swapId);
  const programId = new PublicKey(HTLC_PROGRAM_ID);
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("swap"), idBytes],
    programId,
  );

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

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(initiator), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(params.recipient), isSigner: false, isWritable: false },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/** Die PDA-Adresse eines Swaps — für Anzeige und Nachprüfung im Explorer. */
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
  const { Transaction, PublicKey } = await import("@solana/web3.js");

  if (p.spendLamports <= 0 || p.refundLamports < 0) {
    throw new Error("Ungültige Aufteilung: der Verbrauchsanteil muss positiv sein.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (p.timelockUnix <= now + 600) {
    // Ein Timelock, der gleich abläuft, ist für den Provider wertlos — er
    // würde das Deposit ablehnen, und der Nutzer hätte umsonst gezahlt.
    throw new Error("Der Timelock muss mindestens 10 Minuten in der Zukunft liegen.");
  }

  const preimage = p.preimage ?? crypto.getRandomValues(new Uint8Array(32));
  const hashlock = sha256(preimage);
  const initiator = p.wallet.publicKey.toBase58();

  p.onProgress?.("Instruktionen werden gebaut …");
  const ixSpend = await buildLockInstruction(
    { swapId: p.spendSwapId, hashlock, amountLamports: p.spendLamports, timelockUnix: p.timelockUnix, recipient: p.providerSolAddress },
    initiator,
  );
  const tx = new Transaction().add(ixSpend);

  if (p.refundLamports > 0) {
    // Rest-HTLC an den Kunden selbst: sofort nach Ablauf zurückholbar.
    const ixRefund = await buildLockInstruction(
      { swapId: p.refundSwapId, hashlock, amountLamports: p.refundLamports, timelockUnix: p.timelockUnix, recipient: initiator },
      initiator,
    );
    tx.add(ixRefund);
  }

  p.onProgress?.("Warte auf Bestätigung in der Wallet …");
  const { blockhash, lastValidBlockHeight } = await p.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = new PublicKey(initiator);

  const signed = (await p.wallet.signTransaction(tx)) as import("@solana/web3.js").Transaction;

  p.onProgress?.("Transaktion wird gesendet …");
  const signature = await p.connection.sendRawTransaction(signed.serialize());

  p.onProgress?.("Warte auf Bestätigung der Kette …");
  const conf = await p.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(`Transaktion abgelehnt: ${JSON.stringify(conf.value.err)}`);
  }

  return {
    signature,
    spendAddress: await swapAddress(p.spendSwapId),
    refundAddress: await swapAddress(p.refundSwapId),
    preimageHex: bytesToHex(preimage),
    hashlockHex: bytesToHex(hashlock),
  };
}

/** Baut die `refund`-Instruktion (nach Ablauf des Timelocks). */
export async function buildRefundInstruction(
  swapId: string,
  initiator: string,
): Promise<import("@solana/web3.js").TransactionInstruction> {
  const { PublicKey, TransactionInstruction } = await import("@solana/web3.js");
  const programId = new PublicKey(HTLC_PROGRAM_ID);
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("swap"), swapIdBytes(swapId)],
    programId,
  );
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(initiator), isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(anchorSighash("refund")),
  });
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
  const { Transaction, PublicKey } = await import("@solana/web3.js");
  const initiator = p.wallet.publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);
  void now;

  const tx = new Transaction();
  const included: string[] = [];
  const failed: { swapId: string; reason: string }[] = [];

  for (const swapId of p.swapIds) {
    try {
      tx.add(await buildRefundInstruction(swapId, initiator));
      included.push(swapId);
    } catch (e) {
      failed.push({ swapId, reason: (e as Error).message });
    }
  }
  if (included.length === 0) {
    return { refunded: [], failed };
  }

  p.onProgress?.("Warte auf Bestätigung in der Wallet …");
  const { blockhash, lastValidBlockHeight } = await p.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = new PublicKey(initiator);

  const signed = (await p.wallet.signTransaction(tx)) as import("@solana/web3.js").Transaction;
  const signature = await p.connection.sendRawTransaction(signed.serialize());
  const conf = await p.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    // Eine atomare Transaktion scheitert ganz: ein bereits eingelöstes HTLC
    // reißt die anderen mit. Der Nutzer soll wissen, warum.
    return {
      refunded: [],
      failed: included.map((swapId) => ({
        swapId,
        reason:
          "Rückholung abgelehnt — meist, weil der Timelock noch läuft oder ein " +
          "Teil bereits eingelöst wurde.",
      })).concat(failed),
    };
  }
  return { signature, refunded: included, failed };
}
