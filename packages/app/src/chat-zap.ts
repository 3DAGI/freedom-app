/**
 * User2User Zaps (NIP-57) im Chat.
 *
 * Zap-Dialog neben dem Eingabefeld:
 * - Empfaenger: aktiver Chat-Partner
 * - Betrag: custom input (1-1000 sats/SOL)
 * - Wallet: Lightning (NWC oder WebLN) oder Solana (verbundene Wallet) –
 *   gezahlt wird ueber die Zahlschienen (Schritt 4.1b)
 */

import { escapeHtml } from "./shell-logic.js";
import { standardSchiene } from "./standard-schiene.js";
// App-Zustand unter eigenem Namen: `state` ist hier der Zustand des Dialogs.
// Vorher stand hier `window.state` – das gab es nie, der Zap brach ab.
import { ensurePool, signiere, state as appState } from "./shell/state.js";

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

  // Vorgabe aus der Standard-Schiene (4.1c); im Dialog aenderbar.
  const schiene = standardSchiene();
  const state: ZapDialogState = {
    recipientPubkey,
    recipientName,
    amount: schiene === "solana" ? 0.01 : 10,
    unit: schiene === "solana" ? "sol" : "sats",
    walletType: schiene,
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
          <div class="zap-recipient">${escapeHtml(recipientName)}</div>
        </div>
        <div class="zap-field">
          <label>Betrag</label>
          <input type="number" id="zap-amount" value="${state.amount}" min="0" step="any" />
          <select id="zap-unit">
            <option value="sats"${state.unit === "sats" ? " selected" : ""}>sats</option>
            <option value="sol"${state.unit === "sol" ? " selected" : ""}>SOL</option>
          </select>
        </div>
        <div class="zap-field">
          <label>Wallet</label>
          <select id="zap-wallet">
            <option value="lightning"${state.walletType === "lightning" ? " selected" : ""}>Lightning (sats)</option>
            <option value="solana"${state.walletType === "solana" ? " selected" : ""}>Solana (SOL)</option>
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
  // Die Einheit folgt der Schiene: Lightning zahlt in sats, Solana in SOL.
  const walletSel = document.getElementById("zap-wallet") as HTMLSelectElement;
  walletSel.onchange = () => {
    (document.getElementById("zap-unit") as HTMLSelectElement).value = walletSel.value === "solana" ? "sol" : "sats";
  };
  document.getElementById("zap-close")!.onclick = () => el.remove();
  document.getElementById("zap-cancel")!.onclick = () => el.remove();
  document.getElementById("zap-send")!.onclick = async () => {
    state.amount = Number((document.getElementById("zap-amount") as HTMLInputElement).value);
    state.unit = (document.getElementById("zap-unit") as HTMLSelectElement).value as "sats" | "sol";
    state.walletType = (document.getElementById("zap-wallet") as HTMLSelectElement).value as "lightning" | "solana";
    await sendZap(state, el);
  };
}

/**
 * Zap senden (NIP-57) bzw. SOL-Trinkgeld – ueber die Zahlschienen (4.1b).
 *
 * Vorher suchte dieser Dialog seine Wallet selbst und griff auf globale
 * Objekte zu, die es nicht gab (`window.ensurePool`, `window.solWallet`) –
 * beide Wege brachen ab. Der Zap-Request ging unsigniert hinaus, und die App
 * veroeffentlichte selbst eine „Quittung“ mit Rechnung und Preimage unter der
 * eigenen Identitaet. Die Quittung (Kind 9735) schreibt nach NIP-57 der
 * Server des Empfaengers; hier entfaellt sie.
 */
async function sendZap(state: ZapDialogState, el: HTMLElement): Promise<void> {
  const statusEl = document.getElementById("zap-status")!;
  const sendBtn = document.getElementById("zap-send") as HTMLButtonElement;
  try {
    state.status = "connecting";
    statusEl.textContent = "hole zahlungsziel…";
    statusEl.classList.remove("hidden");
    sendBtn.disabled = true;
    if (!Number.isFinite(state.amount) || state.amount <= 0) throw new Error("Betrag fehlt");
    const { zahle, parseProfileSafe, buildZapRequest } = await import("@freedomstack/protocol");
    const { zahlschienen } = await import("./shell/zahlschienen.js");
    const pool = await ensurePool();
    const profile = await pool.query({ kinds: [0], authors: [state.recipientPubkey], limit: 1 });

    if (state.walletType === "lightning") {
      if (state.unit !== "sats") throw new Error("Lightning zahlt in sats");
      const betragMsat = Math.round(state.amount * 1000);
      const lud16 = profile[0] ? parseProfileSafe(profile[0]).lud16 ?? "" : "";
      if (!lud16) throw new Error("Empfänger hat keine Lightning-Adresse (lud16)");
      const zapRequest = await signiere(buildZapRequest({
        senderPubkey: appState.keypair!.pk,
        recipientPubkey: state.recipientPubkey,
        amountMsat: betragMsat,
        relays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
      }));
      const { holeZapRechnung } = await import("./zap-zahlung.js");
      const rechnung = await holeZapRechnung({ lud16, betragMsat, zapRequest });
      statusEl.textContent = "warte auf wallet…";
      await zahle(zahlschienen(), { ziel: rechnung, betrag: { einheit: "msat", wert: betragMsat }, zweck: "zap" });
      statusEl.textContent = `⚡ gezappt! ${state.amount} sats`;
    } else {
      if (state.unit !== "sol") throw new Error("Solana zahlt in SOL");
      const { solAdresseAusProfil } = await import("./zap-zahlung.js");
      let ziel = profile[0] ? solAdresseAusProfil(profile[0].content) : "";
      if (!ziel) {
        ziel = (prompt(`SOL-Adresse von ${state.recipientName}:`) ?? "").trim();
        if (!ziel) throw new Error("abgebrochen — keine Empfänger-Adresse");
      }
      statusEl.textContent = "warte auf wallet-signatur…";
      const beleg = await zahle(zahlschienen(), {
        ziel, betrag: { einheit: "lamports", wert: Math.round(state.amount * 1e9) }, zweck: "trinkgeld",
      });
      statusEl.textContent = `◎ gesendet! sig: ${beleg.ref.slice(0, 12)}…`;
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
