/**
 * AnchorSolanaHtlcAdapter: SolanaHtlcAdapter gegen das echte Anchor-HTLC-
 * Programm (deployed: Devnet B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk).
 *
 * Kein Anchor-Client: rohe @solana/web3.js-Transaktionen mit manueller
 * Borsh-(De)Serialisierung. Das haelt den Adapter klein und IDL-unabhaengig.
 *
 * Account-Layout (Swap, 8-Byte-Diskriminator + Felder):
 *   swap_id    [u8;32]
 *   initiator  pubkey (32)
 *   recipient  pubkey (32)
 *   hashlock   [u8;32]
 *   timelock   i64
 *   amount     u64
 *   claimed    bool
 *   refunded   bool
 *   bump       u8
 *
 * Instructions (8-Byte-Sighash + Args):
 *   initialize(swap_id, hashlock, timelock:i64, amount:u64)
 *   claim(preimage: bytes)
 *   refund()
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { SolanaHtlcAdapter, SolanaLock } from "./adapters.js";

/** Anchor-Sighash: SHA256("global:<name>")[0..8] */
function sighash(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

const PROGRAM_ID = new PublicKey(
  process.env.HTLC_PROGRAM_ID ?? "B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk",
);
/** Die Programm-ID, mit der dieser Adapter arbeitet (fuer den Relayer, 4.6e). */
export const HTLC_PROGRAMM_ID = PROGRAM_ID.toBase58();

export interface AnchorAdapterConfig {
  rpcUrl: string;
  /** Signer des Adapters (LP beim lock/refund, Nutzer beim claim). */
  keypair: Keypair;
  commitment?: "processed" | "confirmed" | "finalized";
}

export class AnchorSolanaHtlc implements SolanaHtlcAdapter {
  private conn: Connection;
  private kp: Keypair;

  constructor(cfg: AnchorAdapterConfig) {
    this.conn = new Connection(cfg.rpcUrl, cfg.commitment ?? "confirmed");
    this.kp = cfg.keypair;
  }

  /**
   * Nur-Lese-Zugriff auf die Kette, ohne Keypair.
   *
   * Ein Provider, der ein fremdes Deposit PRUEFT, braucht keinen Schluessel —
   * ihn einen erzeugen zu lassen, nur um get() aufrufen zu koennen, waere ein
   * unnoetiges Stueck Schluesselmaterial auf der Platte.
   */
  static reader(conn: Connection): AnchorSolanaHtlc {
    const inst = Object.create(AnchorSolanaHtlc.prototype) as AnchorSolanaHtlc;
    (inst as unknown as { conn: Connection }).conn = conn;
    return inst;
  }

  /** PDA-Ableitung: seeds ["swap", swap_id]. swapId ist ein hex/utf8-String;
   *  fuer die Seeds wird SHA256(swapId) als 32-Byte-ID verwendet. */
  static deriveSwapPda(swapId: string): { pda: PublicKey; swapIdBytes: Buffer; bump: number } {
    const swapIdBytes = createHash("sha256").update(swapId).digest();
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("swap"), swapIdBytes],
      PROGRAM_ID,
    );
    return { pda, swapIdBytes, bump };
  }

  async lock(params: {
    swapId: string;
    hashlock: Uint8Array;
    amountLamports: number;
    timelockUnix: number;
    recipient: string;
    initiator: string;
  }): Promise<SolanaLock> {
    const { pda, swapIdBytes } = AnchorSolanaHtlc.deriveSwapPda(params.swapId);

    // Args: swap_id[32] + hashlock[32] + timelock i64le + amount u64le
    const args = Buffer.alloc(32 + 32 + 8 + 8);
    swapIdBytes.copy(args, 0);
    Buffer.from(params.hashlock).copy(args, 32);
    args.writeBigInt64LE(BigInt(params.timelockUnix), 64);
    args.writeBigUInt64LE(BigInt(params.amountLamports), 72);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.kp.publicKey, isSigner: true, isWritable: true }, // initiator
        { pubkey: new PublicKey(params.recipient), isSigner: false, isWritable: false },
        { pubkey: pda, isSigner: false, isWritable: true }, // swap
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([sighash("initialize"), args]),
    });

    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(this.conn, tx, [this.kp]);

    return {
      swapId: params.swapId,
      hashlock: params.hashlock,
      amountLamports: params.amountLamports,
      timelockUnix: params.timelockUnix,
      recipient: params.recipient,
      initiator: params.initiator,
      claimed: false,
      refunded: false,
    };
  }

  /**
   * Loest einen Swap ein.
   *
   * `initiator` ist noetig, seit das Programm den Swap-PDA nach dem Einloesen
   * schliesst und die Mietbefreiung an den zurueckgibt, der sie gezahlt hat.
   * Vorher blieb sie dauerhaft gebunden (~0,0016 SOL je Swap).
   *
   * Das Preimage geht als festes [u8; 32] hinein — Borsh kodiert das OHNE
   * Laengenpraefix. Frueher stand hier ein Vec<u8> MIT vier Byte Laenge davor;
   * beide Seiten muessen zusammen geaendert werden, sonst wird die
   * Transaktion ohne verwertbare Meldung abgelehnt.
   */
  async claim(swapId: string, preimage: Uint8Array, initiator: string): Promise<void> {
    if (preimage.length !== 32) {
      throw new Error(`Preimage muss 32 Bytes haben, hat ${preimage.length}`);
    }
    const { pda } = AnchorSolanaHtlc.deriveSwapPda(swapId);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.kp.publicKey, isSigner: true, isWritable: true }, // recipient
        { pubkey: new PublicKey(initiator), isSigner: false, isWritable: true },
        { pubkey: pda, isSigner: false, isWritable: true }, // swap
      ],
      data: Buffer.concat([sighash("claim"), Buffer.from(preimage)]),
    });
    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(this.conn, tx, [this.kp]);
  }

  async refund(swapId: string): Promise<void> {
    const { pda } = AnchorSolanaHtlc.deriveSwapPda(swapId);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.kp.publicKey, isSigner: true, isWritable: true }, // initiator
        { pubkey: pda, isSigner: false, isWritable: true }, // swap
      ],
      data: sighash("refund"),
    });
    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(this.conn, tx, [this.kp]);
  }

  async get(swapId: string): Promise<SolanaLock | undefined> {
    const { pda } = AnchorSolanaHtlc.deriveSwapPda(swapId);
    const info = await this.conn.getAccountInfo(pda);
    if (!info) return undefined;
    const d = Buffer.from(info.data);
    if (d.length < 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1) return undefined;

    // 8-Byte-Diskriminator ueberspringen
    let off = 8;
    const swapIdBytes = d.subarray(off, off + 32); off += 32;
    const initiator = new PublicKey(d.subarray(off, off + 32)).toBase58(); off += 32;
    const recipient = new PublicKey(d.subarray(off, off + 32)).toBase58(); off += 32;
    const hashlock = new Uint8Array(d.subarray(off, off + 32)); off += 32;
    // DataView statt d.readBigInt64LE: Das Buffer-Polyfill im Browser kennt
    // die BigInt-Methoden nicht – bis 4.6c scheiterte dort jede Pruefung einer
    // Sperre („d.readBigInt64LE is not a function“).
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const timelockUnix = Number(dv.getBigInt64(off, true)); off += 8;
    const amountLamports = Number(dv.getBigUint64(off, true)); off += 8;
    const claimed = d[off] === 1; off += 1;
    const refunded = d[off] === 1; off += 1;

    // Preimage-Rekonstruktion: nicht im Account gespeichert (siehe
    // getRevealedPreimage — die kommt aus der Claim-Transaktion).
    return {
      swapId,
      hashlock,
      amountLamports,
      timelockUnix,
      recipient,
      initiator,
      claimed,
      refunded,
      revealedPreimage: undefined,
    };
  }

  /**
   * Liest die offengelegte Preimage. Das Program speichert sie nicht im
   * Account — sie steht im Instruction-Data der Claim-Transaktion.
   * Wir suchen die letzte Claim-TX des Swap-PDAs und extrahieren sie.
   */
  async getRevealedPreimage(swapId: string): Promise<Uint8Array | undefined> {
    const { pda } = AnchorSolanaHtlc.deriveSwapPda(swapId);
    const sigs = await this.conn.getSignaturesForAddress(pda, { limit: 10 });
    const claimHash = sighash("claim");
    for (const sig of sigs) {
      const tx = await this.conn.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) continue;
      const msg = tx.transaction.message;
      const ixs = (msg as { instructions?: unknown[]; compiledInstructions?: unknown[] })
        .compiledInstructions ??
        ((msg as { instructions?: unknown[] }).instructions ?? []);
      for (const ix of ixs as Array<{ data?: string | Uint8Array }>) {
        const raw =
          typeof ix.data === "string"
            ? Buffer.from(ix.data as string, "base64")
            : Buffer.from(ix.data as Uint8Array);
        if (raw.subarray(0, 8).equals(claimHash)) {
          // Args: u32le Laenge + preimage bytes
          const len = raw.readUInt32LE(8);
          const pre = raw.subarray(12, 12 + len);
          if (pre.length === 32) return new Uint8Array(pre);
        }
      }
    }
    return undefined;
  }
}

/** Laedt ein Solana-Keypair aus einer JSON-Datei (solana-keygen Format). */
export async function loadSolanaKeypair(path: string): Promise<Keypair> {
  const { readFile } = await import("node:fs/promises");
  const secret = JSON.parse(await readFile(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
