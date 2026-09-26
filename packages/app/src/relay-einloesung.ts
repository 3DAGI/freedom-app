/**
 * Einloesen ueber einen Relayer (Schritt 4.6f) – ohne DOM.
 *
 * Wer per Lightning SOL kauft und noch kein SOL hat, kann die Gebuehr der
 * Einloesung nicht zahlen. Ein Relayer zahlt sie als Gebuehrenzahler; die
 * Wallet signiert die Einloesung weiterhin selbst, dazu eine Erstattung an
 * den Relayer aus den eingeloesten SOL (dieselbe Transaktion, atomar).
 *
 * Nie den LP selbst als Relayer: Er bekaeme das Preimage vor der Einloesung
 * und koennte sie zurueckhalten, die Lightning-Zahlung abrechnen und nach
 * Ablauf die SOL zurueckholen.
 */
import {
  type RelayerAngebot,
  MAX_ERSTATTUNG_LAMPORTS, pruefeRelayAuftrag,
} from "@freedomstack/protocol";
import { buildClaimInstruction } from "./swap-client.js";
import { HTLC_PROGRAM_ID, type WalletSigner } from "./sol-htlc.js";

/** Unter diesem Guthaben (Lamports) reicht es nicht fuer die Gebuehr – dann ueber einen Relayer. */
export const GEBUEHR_PUFFER_LAMPORTS = 10_000;

export function brauchtRelayer(guthabenLamports: number): boolean {
  return guthabenLamports < GEBUEHR_PUFFER_LAMPORTS;
}

export interface RelayerKandidat {
  pubkey: string;
  solAdresse: string;
  erstattungLamports: number;
}

/**
 * Passende Relayer, guenstigster zuerst: gleiche Kette, Erstattung im Rahmen,
 * nicht der LP dieses Swaps (weder sein Nostr-Schluessel noch sein SOL-Konto).
 * Je Nostr-Schluessel nur das neueste Angebot.
 */
export function waehleRelayer(
  angebote: Array<{ pubkey: string; created_at: number; angebot: RelayerAngebot }>,
  p: { kette: string; lpPubkey?: string; lpSol: string },
): RelayerKandidat[] {
  const neueste = new Map<string, { created_at: number; angebot: RelayerAngebot }>();
  for (const a of angebote) {
    const bisher = neueste.get(a.pubkey);
    if (!bisher || a.created_at > bisher.created_at) neueste.set(a.pubkey, a);
  }
  return [...neueste.entries()]
    .filter(([pk, { angebot: a }]) => a.kette === p.kette && pk !== p.lpPubkey && a.solAdresse !== p.lpSol && a.erstattungLamports <= MAX_ERSTATTUNG_LAMPORTS)
    .map(([pubkey, { angebot: a }]) => ({ pubkey, solAdresse: a.solAdresse, erstattungLamports: a.erstattungLamports }))
    .sort((x, y) => x.erstattungLamports - y.erstattungLamports);
}

/**
 * Baut die Einloesung fuer den Relayer und laesst die Wallet als Empfaenger
 * signieren. Vor der Rueckgabe prueft sie sich selbst mit derselben Regel wie
 * der Relayer – ein Auftrag, den er ablehnen muesste, legt das Preimage
 * umsonst offen.
 */
export async function baueRelayEinloesung(p: {
  connection: Pick<import("@solana/web3.js").Connection, "getLatestBlockhash">;
  wallet: WalletSigner;
  swapId: string;
  preimage: Uint8Array;
  initiator: string;
  relayer: RelayerKandidat;
}): Promise<Uint8Array> {
  const { PublicKey, SystemProgram, Transaction } = await import("@solana/web3.js");
  const empfaenger = p.wallet.publicKey.toBase58();
  const tx = new Transaction().add(
    await buildClaimInstruction(p.swapId, p.preimage, empfaenger, p.initiator),
    SystemProgram.transfer({ fromPubkey: new PublicKey(empfaenger), toPubkey: new PublicKey(p.relayer.solAdresse), lamports: p.relayer.erstattungLamports }),
  );
  tx.feePayer = new PublicKey(p.relayer.solAdresse);
  tx.recentBlockhash = (await p.connection.getLatestBlockhash("confirmed")).blockhash;
  const signiert = (await p.wallet.signTransaction(tx)) as import("@solana/web3.js").Transaction;
  const roh = Uint8Array.from(signiert.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const selbst = pruefeRelayAuftrag(roh, { relayer: p.relayer.solAdresse, programmId: HTLC_PROGRAM_ID, erstattungMin: p.relayer.erstattungLamports });
  if (!selbst.ok) throw new Error(`Einlösung für den Relayer unvollständig: ${selbst.grund}`);
  return roh;
}
