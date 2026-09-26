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
import { ausLamports, ausMsat } from "./preis-anzeige.js";
import { standardSchiene } from "./standard-schiene.js";
import { aktualisiereKurs, aktuellerKurs } from "./shell/marktkurs.js";
// App-Zustand unter eigenem Namen: `state` ist hier der Zustand des Dialogs.
// Vorher stand hier `window.state` – das gab es nie, der Zap brach ab.
import { ensurePool, signiere, solRpcUrl, state as appState } from "./shell/state.js";

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
          <div class="mono-sm" id="zap-umrechnung"></div>
        </div>
        <div class="zap-field">
          <label>Wallet</label>
          <select id="zap-wallet">
            <option value="lightning"${state.walletType === "lightning" ? " selected" : ""}>Lightning (sats)</option>
            <option value="solana"${state.walletType === "solana" ? " selected" : ""}>Solana (SOL)</option>
          </select>
        </div>
        <div class="zap-field${state.walletType === "solana" ? "" : " hidden"}" id="zap-oeffentlich-feld">
          <label class="mono-sm"><input type="checkbox" id="zap-oeffentlich" /> Beleg öffentlich – verknüpft deine Identität für alle sichtbar mit Betrag, Adresse und Transaktion</label>
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
  // Beide Einheiten (4.4b): der Betrag in der anderen Waehrung, aus dem Marktkurs.
  const umrechnung = () => {
    const wert = Number((document.getElementById("zap-amount") as HTMLInputElement).value);
    const einheit = (document.getElementById("zap-unit") as HTMLSelectElement).value;
    document.getElementById("zap-umrechnung")!.textContent = !Number.isFinite(wert) || wert <= 0 ? ""
      : einheit === "sol" ? ausLamports(wert * 1e9, aktuellerKurs()) : ausMsat(wert * 1000, aktuellerKurs());
  };
  walletSel.onchange = () => {
    (document.getElementById("zap-unit") as HTMLSelectElement).value = walletSel.value === "solana" ? "sol" : "sats";
    // Beleg (4.7) gibt es nur fuer SOL: dort die Wahl „oeffentlich“ anbieten.
    document.getElementById("zap-oeffentlich-feld")!.classList.toggle("hidden", walletSel.value !== "solana");
    umrechnung();
  };
  (document.getElementById("zap-amount") as HTMLInputElement).oninput = umrechnung;
  (document.getElementById("zap-unit") as HTMLSelectElement).onchange = umrechnung;
  umrechnung();
  void aktualisiereKurs().then(umrechnung);
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
      // Adresse versiegelt beim Empfaenger anfragen (4.9d) – er gibt jedem
      // Kontakt eine eigene. Die oeffentliche aus dem Profil nur mit Warnung.
      const [{ solAdresseAusProfil }, { frageAdresseAn, gemerkteAdresse }, { ketteAusRpc }, { geheim }] = await Promise.all([
        import("./zap-zahlung.js"), import("./trinkgeld-adresse.js"), import("./wallet-standard.js"), import("./shell/tresor.js"),
      ]);
      const kette = ketteAusRpc(await solRpcUrl());
      let ziel = gemerkteAdresse(geheim, state.recipientPubkey, kette) ?? "";
      if (!ziel) {
        statusEl.textContent = "frage die Adresse versiegelt beim Empfänger an … (bis 75 s)";
        ziel = await frageAdresseAn({ pool, speicher: geheim, signer: appState.signer!, empfaenger: state.recipientPubkey, kette }) ?? "";
      }
      const offen = profile[0] ? solAdresseAusProfil(profile[0].content) : "";
      if (!ziel && offen && confirm(
        `${state.recipientName} hat nicht geantwortet. In seinem Profil steht eine öffentliche SOL-Adresse – ein Trinkgeld dorthin ist für jeden sichtbar mit ihm verknüpft, und alle Trinkgelder landen auf derselben Adresse. Trotzdem dorthin?`,
      )) ziel = offen;
      if (!ziel) {
        ziel = (prompt(`SOL-Adresse von ${state.recipientName}:`) ?? "").trim();
        if (!ziel) throw new Error("abgebrochen — keine Empfänger-Adresse");
      }
      statusEl.textContent = "warte auf wallet-signatur…";
      const lamports = Math.round(state.amount * 1e9);
      const beleg = await zahle(zahlschienen(), { ziel, betrag: { einheit: "lamports", wert: lamports }, zweck: "trinkgeld" });
      statusEl.textContent = `◎ gesendet! sig: ${beleg.ref.slice(0, 12)}…`;
      // Beleg an den Empfaenger (4.7): versiegelt, oeffentlich nur auf Wunsch.
      // Scheitert er, ist das Geld trotzdem unterwegs – das sagt die Meldung.
      try {
        const { ketteAusRpc } = await import("./wallet-standard.js");
        const { sendeTrinkgeldBeleg } = await import("./trinkgeld-beleg.js");
        const oeffentlich = (document.getElementById("zap-oeffentlich") as HTMLInputElement | null)?.checked === true;
        await sendeTrinkgeldBeleg(pool, appState.signer!, {
          empfaenger: state.recipientPubkey, signatur: beleg.ref, lamports, an: ziel, kette: ketteAusRpc(await solRpcUrl()),
        }, oeffentlich);
        statusEl.textContent += oeffentlich ? " · Beleg öffentlich" : " · Beleg an den Empfänger";
      } catch (e) {
        statusEl.textContent += ` · Beleg nicht gesendet (${(e as Error).message})`;
      }
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
