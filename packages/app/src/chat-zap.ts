/**
 * User2User Zaps (NIP-57) im Chat.
 *
 * Zap-Dialog neben dem Eingabefeld:
 * - Empfaenger: aktiver Chat-Partner
 * - Betrag: custom input (1-1000 sats/SOL)
 * - Wallet: Lightning (NWC oder WebLN) oder Solana (verbundene Wallet) –
 *   gezahlt wird ueber die Zahlschienen (Schritt 4.1b)
 */

import { t } from "./i18n.js";
import { fehlerText } from "./protokoll-texte.js";
import { escapeHtml } from "./shell-logic.js";
import { ausLamports, ausMsat } from "./preis-anzeige.js";
import { standardSchiene } from "./standard-schiene.js";
import { aktualisiereKurs, aktuellerKurs } from "./shell/marktkurs.js";
// App-Zustand unter eigenem Namen: `state` ist hier der Zustand des Dialogs.
// Vorher stand hier `window.state` – das gab es nie, der Zap brach ab.
import { ensurePool, frageBeiAutoren, solRpcUrl, state as appState } from "./shell/state.js";

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
        <span>⚡ ${escapeHtml(t("zahl.zapSenden"))}</span>
        <button class="ghost" id="zap-close">×</button>
      </div>
      <div class="zap-dialog-body">
        <div class="zap-field">
          <label>${escapeHtml(t("zahl.empfaenger"))}</label>
          <div class="zap-recipient">${escapeHtml(recipientName)}</div>
        </div>
        <div class="zap-field">
          <label>${escapeHtml(t("zahl.betrag"))}</label>
          <input type="number" id="zap-amount" value="${state.amount}" min="0" step="any" />
          <select id="zap-unit">
            <option value="sats"${state.unit === "sats" ? " selected" : ""}>${escapeHtml(t("zahl.einheitSats"))}</option>
            <option value="sol"${state.unit === "sol" ? " selected" : ""}>${escapeHtml(t("zahl.einheitSol"))}</option>
          </select>
          <div class="mono-sm" id="zap-umrechnung"></div>
        </div>
        <div class="zap-field">
          <label>${escapeHtml(t("zahl.wallet"))}</label>
          <select id="zap-wallet">
            <option value="lightning"${state.walletType === "lightning" ? " selected" : ""}>${escapeHtml(t("zahl.optLightning"))}</option>
            <option value="solana"${state.walletType === "solana" ? " selected" : ""}>${escapeHtml(t("zahl.optSolana"))}</option>
          </select>
        </div>
        <div class="zap-field mono-sm muted${state.walletType === "solana" ? " hidden" : ""}" id="zap-anonym-hinweis">${escapeHtml(t("zahl.zapAnonym"))}</div>
        <div class="zap-field${state.walletType === "solana" ? "" : " hidden"}" id="zap-oeffentlich-feld">
          <label class="mono-sm"><input type="checkbox" id="zap-oeffentlich" /> ${escapeHtml(t("zahl.belegOeffentlichWahl"))}</label>
          <label class="mono-sm"><input type="checkbox" id="zap-rauschen" checked /> ${escapeHtml(t("zahl.rauschenWahl"))}</label>
        </div>
        <div class="zap-status hidden" id="zap-status"></div>
      </div>
      <div class="zap-dialog-actions">
        <button class="ghost" id="zap-cancel">${escapeHtml(t("zahl.abbrechen"))}</button>
        <button class="ghost" id="zap-anfordern">${escapeHtml(t("anf.anfordern"))}</button>
        <button class="cta" id="zap-send">${escapeHtml(t("send"))}</button>
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
    document.getElementById("zap-anonym-hinweis")!.classList.toggle("hidden", walletSel.value === "solana");
    umrechnung();
  };
  (document.getElementById("zap-amount") as HTMLInputElement).oninput = umrechnung;
  (document.getElementById("zap-unit") as HTMLSelectElement).onchange = umrechnung;
  umrechnung();
  void aktualisiereKurs().then(umrechnung);
  document.getElementById("zap-close")!.onclick = () => el.remove();
  document.getElementById("zap-cancel")!.onclick = () => el.remove();
  // Umgekehrt (A-5): eine Zahlung vom Gegenüber anfordern – mit Betrag und Einheit von hier
  document.getElementById("zap-anfordern")!.onclick = async () => {
    const wert = Number((document.getElementById("zap-amount") as HTMLInputElement).value);
    const einheit = (document.getElementById("zap-unit") as HTMLSelectElement).value === "sol" ? "sol" : "sats";
    el.remove();
    const { fordereAn } = await import("./shell/anforderung-ui.js");
    await fordereAn(recipientPubkey, recipientName, { wert: Number.isFinite(wert) ? wert : 0, einheit });
  };
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
    statusEl.textContent = t("zahl.holeZiel");
    statusEl.classList.remove("hidden");
    sendBtn.disabled = true;
    if (!Number.isFinite(state.amount) || state.amount <= 0) throw new Error(t("zahl.betragFehlt"));
    const { zahle, parseProfileSafe } = await import("@freedomstack/protocol");
    const { zahlschienen } = await import("./shell/zahlschienen.js");
    const pool = await ensurePool();
    // Profil auch an den Schreib-Relays des Empfängers (5.4b); das neueste gilt
    const profile = (await frageBeiAutoren({ kinds: [0], authors: [state.recipientPubkey], limit: 1 })).sort((a, b) => b.created_at - a.created_at);

    if (state.walletType === "lightning") {
      if (state.unit !== "sats") throw new Error(t("zahl.lightningInSats"));
      const betragMsat = Math.round(state.amount * 1000);
      const lud16 = profile[0] ? parseProfileSafe(profile[0]).lud16 ?? "" : "";
      let rechnung: string;
      if (lud16) {
        // Anonym (6.3): Die Quittung veröffentlicht der Server des Empfängers –
        // mit der Anfrage darin. Von der Identität signiert, stünde dort, wer zahlt.
        const { baueZapAnfrage, holeZapRechnung } = await import("./zap-zahlung.js");
        const zapRequest = baueZapAnfrage({
          empfaenger: state.recipientPubkey,
          betragMsat,
          relays: pool.urls.slice(0, 5), // eigener Satz vorn (5.4) – dort liest die App die Quittung
        });
        rechnung = await holeZapRechnung({ lud16, betragMsat, zapRequest });
      } else {
        // Ohne öffentliche Adresse (6.3b): Rechnung versiegelt beim Empfänger erfragen –
        // seine App stellt sie mit seiner Wallet aus und antwortet ebenso versiegelt.
        if (betragMsat % 1000 !== 0) throw new Error(t("zahl.nurGanzeSats"));
        statusEl.textContent = t("zahl.frageRechnung", { name: state.recipientName });
        const [{ frageRechnungAn }, { veroeffentlicheDm }] = await Promise.all([import("./ln-rechnung-anfrage.js"), import("./shell/tabs/kommunikation.js")]);
        rechnung = await frageRechnungAn({ pool, signer: appState.signer!, empfaenger: state.recipientPubkey, betragMsat, sende: veroeffentlicheDm }) ?? "";
        if (!rechnung) throw new Error(t("zahl.keineRechnungVersiegelt", { name: state.recipientName }));
      }
      statusEl.textContent = t("zahl.warteAufWallet");
      await zahle(zahlschienen(), { ziel: rechnung, betrag: { einheit: "msat", wert: betragMsat }, zweck: "zap" });
      statusEl.textContent = `⚡ ${t("zahl.gezappt", { sats: state.amount })}`;
    } else {
      if (state.unit !== "sol") throw new Error(t("zahl.solanaInSol"));
      // Adresse versiegelt beim Empfaenger anfragen (4.9d) – er gibt jedem
      // Kontakt eine eigene. Die oeffentliche aus dem Profil nur mit Warnung.
      const [{ solAdresseAusProfil }, { frageAdresseAn, gemerkteAdresse }, { ketteAusRpc }, { geheim }] = await Promise.all([
        import("./zap-zahlung.js"), import("./trinkgeld-adresse.js"), import("./wallet-standard.js"), import("./shell/tresor.js"),
      ]);
      const kette = ketteAusRpc(await solRpcUrl());
      let ziel = gemerkteAdresse(geheim, state.recipientPubkey, kette) ?? "";
      if (!ziel) {
        statusEl.textContent = t("zahl.frageAdresse");
        const { veroeffentlicheDm } = await import("./shell/tabs/kommunikation.js");
        ziel = await frageAdresseAn({ pool, speicher: geheim, signer: appState.signer!, empfaenger: state.recipientPubkey, kette, sende: veroeffentlicheDm }) ?? "";
      }
      const offen = profile[0] ? solAdresseAusProfil(profile[0].content) : "";
      if (!ziel && offen && confirm(t("zahl.oeffentlicheAdresseFrage", { name: state.recipientName }))) ziel = offen;
      if (!ziel) {
        ziel = (prompt(t("zahl.solAdresseVon", { name: state.recipientName })) ?? "").trim();
        if (!ziel) throw new Error(t("zahl.ohneEmpfaengerAdresse"));
      }
      statusEl.textContent = t("zahl.warteAufSignatur");
      let lamports = Math.round(state.amount * 1e9);
      // Betragsrauschen (4.9): Wer mehrfach denselben runden Betrag sendet,
      // verbindet damit seine Adressen wieder. Nur nach oben, hoechstens 0,3 %.
      if ((document.getElementById("zap-rauschen") as HTMLInputElement | null)?.checked !== false) {
        const { checkAmount } = await import("@freedomstack/protocol");
        const r = checkAmount(lamports);
        if (r.suspicious && r.suggested) lamports = r.suggested;
      }
      const beleg = await zahle(zahlschienen(), { ziel, betrag: { einheit: "lamports", wert: lamports }, zweck: "trinkgeld" });
      statusEl.textContent = `◎ ${t("zahl.gesendetSig", { sig: beleg.ref.slice(0, 12) })}`;
      // Beleg an den Empfaenger (4.7): versiegelt, oeffentlich nur auf Wunsch.
      // Scheitert er, ist das Geld trotzdem unterwegs – das sagt die Meldung.
      try {
        const { ketteAusRpc } = await import("./wallet-standard.js");
        const { sendeTrinkgeldBeleg } = await import("./trinkgeld-beleg.js");
        const oeffentlich = (document.getElementById("zap-oeffentlich") as HTMLInputElement | null)?.checked === true;
        await sendeTrinkgeldBeleg(pool, appState.signer!, {
          empfaenger: state.recipientPubkey, signatur: beleg.ref, lamports, an: ziel, kette: ketteAusRpc(await solRpcUrl()),
        }, oeffentlich);
        statusEl.textContent += ` · ${t(oeffentlich ? "zahl.belegOeffentlich" : "zahl.belegAnEmpfaenger")}`;
      } catch (e) {
        statusEl.textContent += ` · ${t("zahl.belegNichtGesendet", { fehler: fehlerText(e) })}`;
      }
    }

    state.status = "sent";
    setTimeout(() => el.remove(), 2000);
  } catch (e) {
    state.status = "error";
    state.error = fehlerText(e);
    statusEl.textContent = t("zahl.fehler", { fehler: fehlerText(e) });
    sendBtn.disabled = false;
  }
}
