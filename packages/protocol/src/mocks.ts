/**
 * In-Memory-Mocks der Adapter. Sie simulieren das Verhalten echter
 * Lightning-/Solana-Clients, damit die Atomizitaetslogik ohne echte Chains
 * getestet und demonstriert werden kann.
 *
 * Wichtige simulierte Invarianten:
 *  - Solana `claim` verlangt eine korrekte Preimage und macht sie oeffentlich.
 *  - Solana `refund` ist erst nach Ablauf der Timelock moeglich.
 *  - Lightning `settle` verlangt die korrekte Preimage.
 */
import {
  LightningAdapter,
  SolanaHtlcAdapter,
  HoldInvoice,
  HoldInvoiceState,
  SolanaLock,
} from "./adapters.js";
import { verifyPreimage, toHex } from "./htlc.js";

export class MockLightning implements LightningAdapter {
  private invoices = new Map<string, { inv: HoldInvoice; state: HoldInvoiceState }>();
  /** Kontostaende zur Verlust-Pruefung. */
  public userSats = 0;
  public lpSats = 0;

  constructor(userStartSats: number) {
    this.userSats = userStartSats;
  }

  async createHoldInvoice(paymentHash: Uint8Array, amountSats: number, cltvDeltaBlocks: number): Promise<HoldInvoice> {
    const key = toHex(paymentHash);
    const inv: HoldInvoice = { paymentHash, bolt11: `lnmock:${key}`, amountSats, cltvDeltaBlocks };
    this.invoices.set(key, { inv, state: "OPEN" });
    return inv;
  }

  async payHoldInvoice(bolt11: string): Promise<void> {
    const key = bolt11.replace("lnmock:", "");
    const rec = this.invoices.get(key);
    if (!rec) throw new Error("unbekannte Invoice");
    if (this.userSats < rec.inv.amountSats) throw new Error("Nutzer hat zu wenig sats");
    // sats werden "in flight" gehalten (dem Nutzer entzogen, aber noch nicht dem LP gutgeschrieben).
    this.userSats -= rec.inv.amountSats;
    rec.state = "ACCEPTED";
  }

  async getInvoiceState(paymentHash: Uint8Array): Promise<HoldInvoiceState> {
    return this.invoices.get(toHex(paymentHash))?.state ?? "OPEN";
  }

  async settleHoldInvoice(preimage: Uint8Array): Promise<void> {
    // Der LP kann nur mit korrekter Preimage abrechnen.
    for (const rec of this.invoices.values()) {
      if (verifyPreimage(preimage, rec.inv.paymentHash) && rec.state === "ACCEPTED") {
        rec.state = "SETTLED";
        this.lpSats += rec.inv.amountSats;
        return;
      }
    }
    throw new Error("keine passende ACCEPTED-Invoice fuer diese Preimage");
  }

  async cancelHoldInvoice(paymentHash: Uint8Array): Promise<void> {
    const rec = this.invoices.get(toHex(paymentHash));
    if (!rec) return;
    if (rec.state === "ACCEPTED") {
      // in-flight-sats zurueck an den Nutzer
      this.userSats += rec.inv.amountSats;
    }
    rec.state = "CANCELED";
  }
}

export class MockSolana implements SolanaHtlcAdapter {
  private locks = new Map<string, SolanaLock>();
  public lpLamports: number;
  public userLamports = 0;

  /** injizierbare Uhr fuer deterministische Timelock-Tests. */
  constructor(lpStartLamports: number, private clock: () => number = () => Math.floor(Date.now() / 1000)) {
    this.lpLamports = lpStartLamports;
  }

  async lock(params: {
    swapId: string;
    hashlock: Uint8Array;
    amountLamports: number;
    timelockUnix: number;
    recipient: string;
    initiator: string;
  }): Promise<SolanaLock> {
    if (this.lpLamports < params.amountLamports) throw new Error("LP hat zu wenig lamports");
    this.lpLamports -= params.amountLamports; // in den Vault gesperrt
    const lock: SolanaLock = {
      swapId: params.swapId,
      hashlock: params.hashlock,
      amountLamports: params.amountLamports,
      timelockUnix: params.timelockUnix,
      recipient: params.recipient,
      initiator: params.initiator,
      claimed: false,
      refunded: false,
    };
    this.locks.set(params.swapId, lock);
    return lock;
  }

  async claim(swapId: string, preimage: Uint8Array): Promise<void> {
    const l = this.locks.get(swapId);
    if (!l) throw new Error("unbekannter Swap");
    if (l.claimed || l.refunded) throw new Error("bereits abgeschlossen");
    if (!verifyPreimage(preimage, l.hashlock)) throw new Error("falsche Preimage");
    l.claimed = true;
    l.revealedPreimage = preimage; // wird on-chain oeffentlich
    this.userLamports += l.amountLamports;
  }

  async refund(swapId: string): Promise<void> {
    const l = this.locks.get(swapId);
    if (!l) throw new Error("unbekannter Swap");
    if (l.claimed || l.refunded) throw new Error("bereits abgeschlossen");
    if (this.clock() < l.timelockUnix) throw new Error("Timelock noch nicht abgelaufen");
    l.refunded = true;
    this.lpLamports += l.amountLamports; // zurueck an den Initiator (LP)
  }

  async getRevealedPreimage(swapId: string): Promise<Uint8Array | undefined> {
    return this.locks.get(swapId)?.revealedPreimage;
  }

  async get(swapId: string): Promise<SolanaLock | undefined> {
    return this.locks.get(swapId);
  }
}
