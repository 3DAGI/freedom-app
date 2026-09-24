/**
 * User2User Zaps (NIP-57) im Chat.
 *
 * Zap-Dialog neben dem Eingabefeld:
 * - Empfaenger: aktiver Chat-Partner
 * - Betrag: custom input (1-1000 sats/SOL)
 * - Wallet: Lightning (WebLN) oder Solana (Phantom/Seeker)
 * - Offline-Queue: falls Relay ausfaellt
 */

export interface ZapDialogState {
  recipientPubkey: string;
  recipientName: string;
  amount: number;
  unit: "sats" | "sol";
  walletType: "lightning" | "solana";
  status: "idle" | "connecting" | "sending" | "sent" | "error";
  error?: string;
}

/** Zap-Dialog oeffnen (neben Eingabefeld). */
export function openZapDialog(recipientPubkey: string, recipientName: string): void {
  const existing = document.getElementById("zap-dialog");
  if (existing) existing.remove();

  const state: ZapDialogState = {
    recipientPubkey,
    recipientName,
    amount: 10,
    unit: "sats",
    walletType: "lightning",
    status: "idle",
  };

  const el = document.createElement("div");
  el.id = "zap-dialog";
  el.className = "zap-dialog";
  el.innerHTML = `
    <div class="zap-dialog-card">
      <div class="zap-dialog-header">
        <span>⚡ Zap senden</span>
        <button class="ghost" id="zap-close">×</button>
      </div>
      <div class="zap-dialog-body">
        <div class="zap-field">
          <label>Empfaenger</label>
          <div class="zap-recipient">${recipientName}</div>
        </div>
        <div class="zap-field">
          <label>Betrag</label>
          <input type="number" id="zap-amount" value="10" min="1" max="1000" />
          <select id="zap-unit">
            <option value="sats">sats</option>
            <option value="sol">SOL</option>
          </select>
        </div>
        <div class="zap-field">
          <label>Wallet</label>
          <select id="zap-wallet">
            <option value="lightning">Lightning (WebLN)</option>
            <option value="solana">Solana (Phantom/Seeker)</option>
          </select>
        </div>
        <div class="zap-status hidden" id="zap-status"></div>
      </div>
      <div class="zap-dialog-actions">
        <button class="ghost" id="zap-cancel">Abbrechen</button>
        <button class="cta" id="zap-send">Senden</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  // Event-Listener
  document.getElementById("zap-close")!.onclick = () => el.remove();
  document.getElementById("zap-cancel")!.onclick = () => el.remove();
  document.getElementById("zap-send")!.onclick = async () => {
    state.amount = Number((document.getElementById("zap-amount") as HTMLInputElement).value);
    state.unit = (document.getElementById("zap-unit") as HTMLSelectElement).value as "sats" | "sol";
    state.walletType = (document.getElementById("zap-wallet") as HTMLSelectElement).value as "lightning" | "solana";
    await sendZap(state, el);
  };
}

/** Zap senden (NIP-57). */
async function sendZap(state: ZapDialogState, el: HTMLElement): Promise<void> {
  const statusEl = document.getElementById("zap-status")!;
  const sendBtn = document.getElementById("zap-send") as HTMLButtonElement;
  try {
    state.status = "connecting";
    statusEl.textContent = "verbinde wallet…";
    statusEl.classList.remove("hidden");
    sendBtn.disabled = true;

    // Wallet verbinden
    if (state.walletType === "lightning") {
      const { detectWallet } = await import("./lightning-wallet.js");
      const wallet = await detectWallet();
      if (!wallet) {
        throw new Error("keine lightning-wallet im browser — auf dem iphone nutze bitte den solana-weg (deposit) oder die desktop-variante mit alby");
      }
      await wallet.connect();

      // NIP-57 Zap-Request bauen
      const { buildZapRequest, signEvent } = await import("@freedomstack/protocol");
      const amountMsat = state.unit === "sats" ? state.amount * 1000 : state.amount * 1_000_000_000; // SOL -> lamports
      const zapReq = buildZapRequest({
        senderPubkey: (window as unknown as { state: { keypair: { pk: string } } }).state.keypair.pk,
        recipientPubkey: state.recipientPubkey,
        amountMsat,
        relays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
      });

      // LNURL-Pay vom Empfaenger holen
      const { parseProfile } = await import("@freedomstack/protocol");
      const pool = (window as unknown as { ensurePool: () => Promise<unknown> }).ensurePool;
      const profiles = await (pool as unknown as { query: (args: unknown) => Promise<unknown[]> }).query({ kinds: [0], authors: [state.recipientPubkey], limit: 1 });
      let lud16 = "";
      if (profiles.length > 0) {
        try {
          const p = parseProfile(profiles[0] as never);
          lud16 = p.lud16 ?? "";
        } catch { /* ignore */ }
      }
      if (!lud16) {
        throw new Error("empfaenger hat keine lightning-adresse (lud16)");
      }

      // LNURL-Pay: fetch -> get invoice -> pay
      const lnurlRes = await fetch(`https://${lud16.split("@")[1]}/.well-known/lnurlp/${lud16.split("@")[0]}`);
      const lnurlData = await lnurlRes.json();
      if (!lnurlData.callback) throw new Error("kein callback in LNURL");
      const cb = new URL(lnurlData.callback);
      cb.searchParams.set("amount", String(amountMsat));
      cb.searchParams.set("nostr", JSON.stringify(zapReq));
      const cbRes = await fetch(cb.toString());
      const cbData = await cbRes.json();
      if (!cbData.pr) throw new Error("keine invoice in callback");

      // Bezahlen mit Wallet
      const { preimage } = await wallet.sendPayment(cbData.pr);
      statusEl.textContent = `⚡ gezappt! ${state.amount} ${state.unit}`;

      // Zap-Receipt publizieren (NIP-57)
      const { buildZapReceipt } = await import("@freedomstack/protocol");
      const receipt = buildZapReceipt({
        zapperPubkey: (window as unknown as { state: { keypair: { pk: string } } }).state.keypair.pk,
        recipientPubkey: state.recipientPubkey,
        zapRequestJson: JSON.stringify(zapReq),
        bolt11: cbData.pr,
        preimageHex: preimage,
      });
      await (pool as unknown as { publish: (ev: unknown) => Promise<void> }).publish(signEvent(receipt, (window as unknown as { state: { keypair: { sk: Uint8Array } } }).state.keypair.sk));

      // Offline-Queue: falls Relay ausfaellt
      const { queueOfflineZap } = await import("./offline-queue.js");
      queueOfflineZap(receipt);

    } else if (state.walletType === "solana") {
      // Solana: SOL direkt an den Partner senden (Phantom/Seeker signieren).
      // Empfaenger-Adresse: aus dem partner-profil (lud00-Convention: SOL-Adresse
      // im kind-0 content als "sol") oder der user gibt sie beim ersten mal an.
      const w = window as unknown as {
        state: { keypair: { pk: string } };
        solWallet?: { connected: boolean; pubkey: string | null };
      };
      const solWallet = w.solWallet;
      if (!solWallet?.connected || !solWallet.pubkey) {
        throw new Error("solana-wallet nicht verbunden");
      }
      // Empfaenger-SOL-Adresse ermitteln: profil laden
      const { parseProfile } = await import("@freedomstack/protocol");
      const pool = (window as unknown as {
        freedomPool?: { query: (f: unknown) => Promise<Array<{ content: string }>> };
      }).freedomPool;
      const profiles = pool ? await pool.query({ kinds: [0], authors: [state.recipientPubkey], limit: 1 }) : [];
      let solAddr = "";
      if (profiles.length > 0) {
        try {
          const meta = JSON.parse((profiles[0] as { content: string }).content || "{}");
          solAddr = meta.sol ?? "";
        } catch { /* ignore */ }
      }
      if (!solAddr) {
        solAddr = prompt(`SOL-adresse von ${state.recipientName}:`) ?? "";
        if (!solAddr) throw new Error("abgebrochen — keine empfaenger-adresse");
      }
      if (state.unit !== "sol") {
        throw new Error("wallet=_solana_ braucht einheit SOL");
      }
      statusEl.textContent = "warte auf wallet-signatur…";
      // Transfer via injiziertem Wallet-Provider (phantom.signAndSendTransaction)
      const provider = ((window as unknown as Record<string, unknown>).phantom as { solana: { signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }> } })?.solana;
      if (!provider?.signAndSendTransaction) {
        throw new Error("wallet kann keine transaktionen senden (signAndSendTransaction fehlt)");
      }
      // Transaktion bauen braucht @solana/web3.js — lazy geladen, via helper:
      const { buildSolTransfer } = await import("./sol-transfer.js");
      const tx = await buildSolTransfer(solWallet.pubkey!, solAddr, String(state.amount));
      const res = await provider.signAndSendTransaction(tx);
      statusEl.textContent = `◎ gesendet! sig: ${res.signature.slice(0, 12)}…`;
    }

    state.status = "sent";
    setTimeout(() => el.remove(), 2000);
  } catch (e) {
    state.status = "error";
    state.error = (e as Error).message;
    statusEl.textContent = `fehler: ${(e as Error).message}`;
    sendBtn.disabled = false;
  }
}
