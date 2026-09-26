/**
 * Adapter-Schnittstellen.
 *
 * Die Swap-Orchestrierung kennt nur diese Interfaces. In Produktion werden sie
 * von echten Clients implementiert (LND/CLN via gRPC fuer Lightning; @solana/web3.js
 * + Anchor-Programm fuer Solana). In Tests/Demo von In-Memory-Mocks.
 * So ist die Atomizitaetslogik unabhaengig von der konkreten Chain testbar.
 */

export interface HoldInvoice {
  /** Payment-Hash H = SHA256(R), zugleich Hashlock der Solana-Seite. */
  paymentHash: Uint8Array;
  /** Bech32-Invoice-String (in Produktion). In Mocks nur ein Kennzeichen. */
  bolt11: string;
  amountSats: number;
  /** CLTV-Delta in Bloecken. */
  cltvDeltaBlocks: number;
}

/** Zustand einer Lightning-Hold-Invoice aus Sicht des Empfaengers (LP). */
export type HoldInvoiceState = "OPEN" | "ACCEPTED" | "SETTLED" | "CANCELED";

export interface LightningAdapter {
  /** LP erstellt eine Hold-Invoice mit gegebenem Payment-Hash H. */
  createHoldInvoice(paymentHash: Uint8Array, amountSats: number, cltvDeltaBlocks: number): Promise<HoldInvoice>;
  /** Nutzer zahlt die Invoice -> HTLC ist "in flight" (ACCEPTED), aber nicht abgerechnet. */
  payHoldInvoice(bolt11: string): Promise<void>;
  /** LP fragt den Zustand ab. */
  getInvoiceState(paymentHash: Uint8Array): Promise<HoldInvoiceState>;
  /** LP rechnet ab, sobald er die Preimage R kennt -> erhaelt die sats. */
  settleHoldInvoice(preimage: Uint8Array): Promise<void>;
  /** LP/Nutzer bricht ab -> Zahlung wird an den Nutzer zurueckerstattet. */
  cancelHoldInvoice(paymentHash: Uint8Array): Promise<void>;
  /**
   * Gegenrichtung (4.6), Kunde: normale Rechnung aus seiner Wallet. Das
   * Preimage bleibt in der Wallet – bekannt wird es erst beim Bezahlen.
   */
  createInvoice?(amountSats: number): Promise<{ bolt11: string; paymentHash: Uint8Array; amountSats: number }>;
  /**
   * Gegenrichtung (4.6), LP: zahlt eine Rechnung, deren HTLC hoechstens
   * `cltvLimitBlocks` Bloecke laeuft; liefert das Preimage. Wirft, wenn die
   * Zahlung scheitert – dann bleiben die sats beim LP.
   */
  payInvoice?(bolt11: string, cltvLimitBlocks: number): Promise<{ preimage: Uint8Array }>;
  /**
   * Gegenrichtung (4.6b), LP: Stand einer eigenen Zahlung – nach einem
   * Neustart, um ein Preimage nicht zu verlieren.
   */
  zahlungsstand?(paymentHash: Uint8Array): Promise<{ status: "erfolgreich" | "gescheitert" | "laeuft" | "unbekannt"; preimage?: Uint8Array }>;
}

export interface SolanaLock {
  swapId: string;
  hashlock: Uint8Array;
  amountLamports: number;
  /** Unix-Sekunden, ab denen Refund moeglich ist. */
  timelockUnix: number;
  recipient: string;
  initiator: string;
  claimed: boolean;
  refunded: boolean;
  /** Wird gesetzt, sobald der Empfaenger mit Preimage eingeloest hat. */
  revealedPreimage?: Uint8Array;
}

export interface SolanaHtlcAdapter {
  /** LP sperrt SOL im HTLC-Programm, gebunden an H + Timelock + Empfaenger (Nutzer). */
  lock(params: {
    swapId: string;
    hashlock: Uint8Array;
    amountLamports: number;
    timelockUnix: number;
    recipient: string;
    initiator: string;
  }): Promise<SolanaLock>;
  /** Nutzer loest ein und legt dabei R offen -> R wird on-chain oeffentlich. */
  /**
   * Loest einen Swap ein.
   *
   * `initiator` ist noetig, seit das Programm den PDA schliesst und die
   * Mietbefreiung an den Zahler zurueckgibt.
   */
  claim(swapId: string, preimage: Uint8Array, initiator: string): Promise<void>;
  /** Nach Ablauf der Timelock: Rueckzahlung an den Initiator (LP). */
  refund(swapId: string): Promise<void>;
  /** LP beobachtet die Chain und liest die offengelegte Preimage. */
  getRevealedPreimage(swapId: string): Promise<Uint8Array | undefined>;
  get(swapId: string): Promise<SolanaLock | undefined>;
}
