/**
 * Lightning-Wallet Integration (WebLN + LNURL).
 *
 * Unterstuetzt:
 * - WebLN (Alby, etc.) — Browser-Extension
 * - LNURL-Pay — QR-Code / Link
 * - Keysend — direkte Zahlung an Node-Pubkey
 *
 * Non-custodial: Der Nutzer behaelt immer seine Keys.
 */

export interface LightningWallet {
  name: string;
  type: "webln" | "lnurl" | "keysend";
  available(): Promise<boolean>;
  connect(): Promise<void>;
  sendPayment(invoice: string): Promise<{ preimage: string }>;
  sendKeysend(pubkey: string, amountMsat: number): Promise<{ preimage: string }>;
  getBalance(): Promise<number>;
}

/** WebLN-Wallet (Alby, etc.). */
export class WebLNWallet implements LightningWallet {
  name = "WebLN";
  type = "webln" as const;
  private webln: unknown = null;

  async available(): Promise<boolean> {
    return typeof (window as unknown as { webln?: unknown }).webln !== "undefined";
  }

  async connect(): Promise<void> {
    const w = (window as unknown as { webln?: { enable?: () => Promise<void> } }).webln;
    if (!w?.enable) throw new Error("WebLN nicht verfuegbar");
    await w.enable();
    this.webln = w;
  }

  async sendPayment(invoice: string): Promise<{ preimage: string }> {
    if (!this.webln) throw new Error("nicht verbunden");
    const w = this.webln as { sendPayment?: (inv: string) => Promise<{ preimage: string }> };
    if (!w.sendPayment) throw new Error("sendPayment nicht unterstuetzt");
    return w.sendPayment(invoice);
  }

  async sendKeysend(pubkey: string, amountMsat: number): Promise<{ preimage: string }> {
    if (!this.webln) throw new Error("nicht verbunden");
    const w = this.webln as { keysend?: (args: { destination: string; amount: number }) => Promise<{ preimage: string }> };
    if (!w.keysend) throw new Error("keysend nicht unterstuetzt");
    return w.keysend({ destination: pubkey, amount: Math.floor(amountMsat / 1000) });
  }

  async getBalance(): Promise<number> {
    if (!this.webln) return 0;
    const w = this.webln as { getBalance?: () => Promise<number> };
    if (!w.getBalance) return 0;
    return w.getBalance();
  }
}

/** LNURL-Pay Wallet (QR-Code / Link). */
export class LNURLWallet implements LightningWallet {
  name = "LNURL";
  type = "lnurl" as const;
  private lnurl: string | null = null;

  async available(): Promise<boolean> {
    return true; // LNURL ist immer verfuegbar (QR-Code)
  }

  async connect(): Promise<void> {
    // LNURL braucht keine Verbindung — nur eine Adresse
  }

  setLNURL(lnurl: string): void {
    this.lnurl = lnurl;
  }

  async sendPayment(invoice: string): Promise<{ preimage: string }> {
    if (!this.lnurl) throw new Error("keine LNURL gesetzt");
    // LNURL-Pay: fetch callback -> get invoice -> pay
    const url = new URL(this.lnurl);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!data.callback) throw new Error("kein callback in LNURL");
    const cb = new URL(data.callback);
    cb.searchParams.set("amount", String(1000)); // 1 sat
    const cbRes = await fetch(cb.toString());
    const cbData = await cbRes.json();
    if (!cbData.pr) throw new Error("keine invoice in callback");
    // Nutzer muss invoice bezahlen (QR-Code zeigen)
    throw new Error(`Bitte bezahle invoice: ${cbData.pr}`);
  }

  async sendKeysend(pubkey: string, amountMsat: number): Promise<{ preimage: string }> {
    throw new Error("keysend nicht unterstuetzt in LNURL");
  }

  async getBalance(): Promise<number> {
    return 0; // LNURL hat keine Balance
  }
}

/** Keysend-Wallet (direkte Zahlung an Node-Pubkey). */
export class KeysendWallet implements LightningWallet {
  name = "Keysend";
  type = "keysend" as const;
  private nodeUrl: string | null = null;

  async available(): Promise<boolean> {
    return true; // Keysend ist immer verfuegbar
  }

  async connect(): Promise<void> {
    // Keysend braucht keine Verbindung — nur Node-URL
  }

  setNodeUrl(url: string): void {
    this.nodeUrl = url;
  }

  async sendPayment(invoice: string): Promise<{ preimage: string }> {
    throw new Error("sendPayment nicht unterstuetzt in Keysend");
  }

  async sendKeysend(pubkey: string, amountMsat: number): Promise<{ preimage: string }> {
    if (!this.nodeUrl) throw new Error("keine node-url gesetzt");
    // Keysend via LND/CLN REST
    const res = await fetch(`${this.nodeUrl}/v1/keysend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        destination: pubkey,
        amount_msat: amountMsat,
      }),
    });
    if (!res.ok) throw new Error(`keysend HTTP ${res.status}`);
    const data = await res.json();
    return { preimage: data.preimage ?? "" };
  }

  async getBalance(): Promise<number> {
    if (!this.nodeUrl) return 0;
    const res = await fetch(`${this.nodeUrl}/v1/balance`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.balance ?? 0;
  }
}

/** Auto-detect verfuegbare Wallet. */
export async function detectWallet(): Promise<LightningWallet | null> {
  const webln = new WebLNWallet();
  if (await webln.available()) return webln;
  const lnurl = new LNURLWallet();
  if (await lnurl.available()) return lnurl;
  return null;
}
