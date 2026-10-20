/**
 * AnchorSolanaHtlcAdapter: SolanaHtlcAdapter gegen das echte Anchor-HTLC-
 * Programm (deployed: Devnet FVb19sZ4jfTropLmSvm3xxVv7bZc95ai5GU96zxhXCJD).
 *
 * Kein Anchor-Client: rohe @solana/web3.js-Transaktionen mit manueller
 * Borsh-(De)Serialisierung. Das haelt den Adapter klein und IDL-unabhaengig.
 * Gelesen wird seit A-21c ueber @solana/kit auf dem RpcPool (`kit-rpc.ts`),
 * geschrieben noch ueber web3.js (bis A-21e).
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
import { address, getBase58Encoder } from "@solana/kit";
import { createHash } from "node:crypto";
import { SolanaHtlcAdapter, SolanaLock } from "./adapters.js";
import { leseKonto, poolRpc, type SolRpc } from "./kit-rpc.js";
import { solSchluesselAus } from "./kit-transaktion.js";
import { RpcPool } from "./rpc-pool.js";

/** Anchor-Sighash: SHA256("global:<name>")[0..8] */
function sighash(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

const PROGRAM_ID = new PublicKey(
  process.env.HTLC_PROGRAM_ID ?? "FVb19sZ4jfTropLmSvm3xxVv7bZc95ai5GU96zxhXCJD",
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
  /** Lesen ueber kit auf dem Pool (A-21c) – immer „confirmed“. */
  private rpc: SolRpc;

  constructor(cfg: AnchorAdapterConfig) {
    this.conn = new Connection(cfg.rpcUrl, cfg.commitment ?? "confirmed");
    this.rpc = poolRpc(new RpcPool([{ url: cfg.rpcUrl }]));
    this.kp = cfg.keypair;
  }

  /**
   * Nur-Lese-Zugriff auf die Kette, ohne Keypair.
   *
   * Ein Provider, der ein fremdes Deposit PRUEFT, braucht keinen Schluessel —
   * ihn einen erzeugen zu lassen, nur um get() aufrufen zu koennen, waere ein
   * unnoetiges Stueck Schluesselmaterial auf der Platte.
   */
  static reader(rpc: SolRpc): AnchorSolanaHtlc {
    const inst = Object.create(AnchorSolanaHtlc.prototype) as AnchorSolanaHtlc;
    (inst as unknown as { rpc: SolRpc }).rpc = rpc;
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
    const konto = await leseKonto(this.rpc, pda.toBase58());
    // Eine Sperre ist nur ein Konto des Programms – an der PDA kann sonst hoechstens ein leeres liegen.
    if (!konto || konto.eigentuemer !== HTLC_PROGRAMM_ID) return undefined;
    const d = Buffer.from(konto.daten);
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
   * Wir suchen die letzten Transaktionen des Swap-PDAs nach einer Einloesung ab.
   */
  async getRevealedPreimage(swapId: string): Promise<Uint8Array | undefined> {
    const { pda } = AnchorSolanaHtlc.deriveSwapPda(swapId);
    const sigs = await this.rpc.getSignaturesForAddress(address(pda.toBase58()), { limit: 10, commitment: "confirmed" }).send();
    for (const sig of sigs) {
      const tx = await this.rpc.getTransaction(sig.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }).send();
      const preimage = tx ? claimPreimage(tx.transaction.message) : undefined;
      if (preimage) return preimage;
    }
    return undefined;
  }
}

/**
 * Das Preimage aus einer Einloesung dieses Programms. `claim` nimmt ein festes [u8; 32] – Borsh
 * ohne Laengenpraefix, die Daten sind genau Sighash (8) + Preimage (32). Bis A-21c las der Adapter
 * hier vier Byte Laenge, die das Programm nie schrieb, und fand das Preimage nie: Der LP haette die
 * Hold-Invoice nicht abgerechnet, nach ihrem Ablauf haette der Kunde SOL und sats gehabt.
 */
function claimPreimage(msg: {
  accountKeys: readonly string[];
  instructions: readonly { programIdIndex: number | bigint; data: string }[];
}): Uint8Array | undefined {
  const claim = sighash("claim");
  for (const ix of msg.instructions) {
    if (msg.accountKeys[Number(ix.programIdIndex)] !== HTLC_PROGRAMM_ID) continue;
    const daten = Buffer.from(getBase58Encoder().encode(ix.data));
    if (daten.length === 8 + 32 && daten.subarray(0, 8).equals(claim)) return new Uint8Array(daten.subarray(8));
  }
  return undefined;
}

/**
 * Laedt einen Solana-Schluessel aus einer JSON-Datei (solana-keygen Format) – seit A-21e1 ohne web3.js:
 * geheimer Teil (32 Byte) und Adresse, geprueft ueber `solSchluesselAus()`.
 */
export async function ladeSolanaSchluessel(path: string): Promise<{ geheim: Uint8Array; adresse: string }> {
  const { readFile } = await import("node:fs/promises");
  const zahlen = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!Array.isArray(zahlen) || !zahlen.every((z) => Number.isInteger(z) && z >= 0 && z <= 255)) throw new Error("Solana-Schlüsseldatei unlesbar");
  const bytes = Uint8Array.from(zahlen as number[]);
  try {
    return solSchluesselAus(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** Laedt ein Solana-Keypair aus einer JSON-Datei (solana-keygen Format). */
export async function loadSolanaKeypair(path: string): Promise<Keypair> {
  const { readFile } = await import("node:fs/promises");
  const secret = JSON.parse(await readFile(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
