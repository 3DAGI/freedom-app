/**
 * Hinterlegen (SOL-Deposit, Sitzung beim Provider) und Einzahlung in einen
 * Zahlkanal – solange etwas davon läuft, sperrt der Tresor nicht.
 *
 * Aus tabs/waehrung.ts verschoben (C-5a) – wörtlich, ohne Logikänderung.
 */
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { escapeHtml } from "../../shell-logic.js";
import { anbieterKursWarnung, depositDeckel } from "../../preis-anzeige.js";
import { angebotVon, ensurePool, signiere, solRpcUrl, state } from "../state.js";
import { bestaetige } from "../dialog.js";
import { aktualisiereKurs } from "../marktkurs.js";
import { geheim, verlangeTresor } from "../tresor.js";
import { $, toast, updateSidebarBalances } from "../ui.js";
import { updateBudgetBar } from "./agent-anzeige.js";
import { activeSwap, sperren, starteRueckholWaechter } from "./tausch.js";
import { htlcSigner, solWallet } from "./waehrung.js";


/** Aktive Deposit-Session (RAM). */
let activeDeposit: { sessionId: string; spendSwapId: string; refundSwapId: string } | null = null;

/** Wird gerade ein Zahlkanal eingezahlt (4.3d, `zahlkanal-ui.ts`)? */
let kanalEinzahlung = false;
export function setzeKanalEinzahlung(laeuft: boolean): void {
  kanalEinzahlung = laeuft;
}

/** Laeuft gerade ein Tausch, ein Deposit oder eine Kanal-Einzahlung? Dann sperrt der Tresor nicht (1.2d). */
export function geldVorgangLaeuft(): boolean {
  return activeSwap !== null || activeDeposit !== null || kanalEinzahlung;
}

export async function startDeposit(): Promise<void> {
  if (!state.keypair) return;
  const statusEl = $("#dep-status");
  if (!solWallet.connected || !solWallet.pubkey) {
    statusEl.textContent = t("waehr.erstSolanaVerbinden");
    statusEl.className = "mono-sm warn";
    return;
  }
  const amountSol = Number(($("#dep-amount") as HTMLInputElement).value);
  if (!amountSol || amountSol <= 0) {
    statusEl.textContent = t("waehr.ungueltigerBetrag");
    statusEl.className = "mono-sm err";
    return;
  }
  const providerPk =
    ($("#dep-provider") as HTMLInputElement).value.trim() || state.lastProvider;
  if (!providerPk) {
    statusEl.textContent = t("waehr.keinProvider");
    statusEl.className = "mono-sm warn";
    return;
  }
  // Deckel je 1k Tokens aus dem Preis des Anbieters und dem Marktkurs (4.4b) –
  // vorher fest 1000 Lamports, mit richtiger Umrechnung weit unter jedem Preis.
  const [markt, angebot] = await Promise.all([aktualisiereKurs(), angebotVon(providerPk)]);
  if (!markt || !angebot) {
    statusEl.textContent = t(!markt ? "waehr.keinMarktkurs" : "waehr.keinAngebotProvider");
    statusEl.className = "mono-sm warn";
    return;
  }
  const kursWarnung = anbieterKursWarnung(angebot.kurs, markt);
  if (kursWarnung && !(await bestaetige({ titel: t("waehr.solHinterlegen"), text: t("waehr.trotzdemHinterlegen", { warnung: kursWarnung }), ok: t("waehr.hinterlegenTrotzdem") }))) return;
  const maxLamportsPerKToken = depositDeckel(angebot.textRatePerKTokenMsat, markt);
  // Das Preimage des Deposits ist ein Geld-Geheimnis – vor dem Sperren der Tresor.
  if (!(await verlangeTresor(t("waehr.fuerDeposit")))) return;

  const totalLamports = Math.floor(amountSol * 1e9);
  // Zwei-HTLC-Muster: 40% Verbrauch (Provider), 60% Rest (User, refundbar)
  const spendLamports = Math.floor(totalLamports * 0.4);
  const refundLamports = totalLamports - spendLamports;
  const sessionId = `sol-dep-${state.keypair.pk.slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;
  const spendSwapId = `${sessionId}-spend`;
  const refundSwapId = `${sessionId}-refund`;

  try {
    // REIHENFOLGE IST WICHTIG: erst sperren, dann ankuendigen.
    //
    // Vorher wurde nur das Event veroeffentlicht und eine Zahl in localStorage
    // hochgezaehlt — es fand nie eine Transaktion statt. Provider pruefen
    // inzwischen on-chain und lehnen ein ungedecktes Deposit ab. Wuerde das
    // Event zuerst kommen, stuende eine Ankuendigung auf den Relays, der nichts
    // entspricht; scheitert die Signatur, gaebe es keinen Weg, sie
    // zurueckzunehmen.
    const signer = htlcSigner();
    if (!signer) {
      statusEl.textContent = t("waehr.kannNichtSignieren");
      statusEl.className = "mono-sm err";
      return;
    }

    const providerSol = ($("#dep-provider-sol") as HTMLInputElement | null)?.value.trim()
      || state.lastProviderSolAddress;
    if (!providerSol) {
      statusEl.textContent = t("waehr.providerSolUnbekannt");
      statusEl.className = "mono-sm warn";
      return;
    }

    const { Connection } = await import("@solana/web3.js");
    const rpcUrl = await solRpcUrl();
    const conn = new Connection(rpcUrl, "confirmed");

    const { lockDeposit } = await import("../../sol-htlc.js");
    statusEl.className = "mono-sm";
    // Fuer den Rueckhol-Waechter merken, BEVOR gesperrt wird (4.6c) – bis
    // dahin versprach die App ein automatisches Zurueckholen, das nie lief.
    const { rememberLock } = await sperren();
    await rememberLock({
      kind: "deposit", reference: sessionId, swapIds: [refundSwapId, spendSwapId],
      timelockUnix: Math.floor(Date.now() / 1000) + 7200, amountLamports: totalLamports, createdAt: Math.floor(Date.now() / 1000),
    });
    void starteRueckholWaechter();
    const lock = await lockDeposit({
      connection: conn,
      wallet: signer,
      providerSolAddress: providerSol,
      spendSwapId,
      refundSwapId,
      spendLamports,
      refundLamports,
      timelockUnix: Math.floor(Date.now() / 1000) + 7200,
      onProgress: (step) => { statusEl.textContent = step; },
    });

    // Das Preimage ist der einzige Weg, vor Ablauf des Timelocks an das Geld zu
    // kommen. Frueher lag es in sessionStorage und war beim Schliessen des Tabs
    // weg. localStorage ueberlebt wenigstens einen Neustart — dauerhaft sicher
    // ist nur eine Sicherung durch den Nutzer, deshalb wird sie eingefordert.
    await geheim.setItem(`freedom.htlc.${sessionId}`, JSON.stringify({
      preimageHex: lock.preimageHex,
      hashlockHex: lock.hashlockHex,
      spendSwapId, refundSwapId, timelockUnix: Math.floor(Date.now() / 1000) + 7200,
    }));

    // Erst JETZT ankuendigen — das Geld liegt bereits auf der Kette.
    const pool = await ensurePool();
    const { buildSolDepositOpen } = await import("@freedomstack/protocol");
    const ev = await signiere(buildSolDepositOpen({
        customerPubkey: state.keypair.pk,
        providerPubkey: providerPk,
        sessionId,
        totalLamports,
        spendSwapId,
        refundSwapId,
        spendLamports,
        refundLamports,
        timelockUnix: Math.floor(Date.now() / 1000) + 7200,
        maxLamportsPerKToken,
      }));
    await pool.publish(ev);

    activeDeposit = { sessionId, spendSwapId, refundSwapId };
    statusEl.innerHTML =
      `<strong>${escapeHtml(t("waehr.depositGedeckt"))}</strong> ${escapeHtml(t("waehr.depositGesperrt", { sol: amountSol.toLocaleString(gebietsschema(), { maximumFractionDigits: 9 }) }))}<br>`
      + `<span class="mono-sm">tx ${escapeHtml(lock.signature.slice(0, 16))}…</span><br>`
      + escapeHtml(t("waehr.rueckholbarAb", { zeit: new Date((Math.floor(Date.now() / 1000) + 7200) * 1000).toLocaleTimeString(gebietsschema()) }));
    statusEl.className = "mono-sm ok";
    ($("#dep-refund") as HTMLButtonElement).classList.remove("hidden");
    toast(t("waehr.depositAngekuendigt"));
    updateBudgetBar();
    updateSidebarBalances()
  } catch (e) {
    statusEl.textContent = t("waehr.fehler", { fehler: fehlerText(e) });
    statusEl.className = "mono-sm err";
  }
}

export async function refundDeposit(): Promise<void> {
  const statusEl = $("#dep-status");
  if (!activeDeposit) {
    statusEl.textContent = t("waehr.keinDeposit");
    return;
  }
  const signer = htlcSigner();
  if (!signer) {
    statusEl.textContent = t("waehr.walletZumZurueckholen");
    statusEl.className = "mono-sm warn";
    return;
  }

  // Erwartungshaltung geradeziehen, BEVOR die Wallet aufgeht: Was der Provider
  // bereits eingeloest hat, ist bezahlter Verbrauch und kommt nicht zurueck.
  const stored = geheim.getItem(`freedom.htlc.${activeDeposit.sessionId}`);
  const meta = stored ? (JSON.parse(stored) as { timelockUnix: number }) : null;
  const now = Math.floor(Date.now() / 1000);
  if (meta && now < meta.timelockUnix) {
    const restMin = Math.ceil((meta.timelockUnix - now) / 60);
    statusEl.textContent = t("waehr.timelockLaeuft", { min: restMin });
    statusEl.className = "mono-sm warn";
    return;
  }

  try {
    const { Connection } = await import("@solana/web3.js");
    const rpcUrl = await solRpcUrl();
    const { refundDepositOnChain } = await import("../../sol-htlc.js");

    statusEl.className = "mono-sm";
    const res = await refundDepositOnChain({
      connection: new Connection(rpcUrl, "confirmed"),
      wallet: signer,
      swapIds: [activeDeposit.refundSwapId, activeDeposit.spendSwapId],
      onProgress: (step) => { statusEl.textContent = step; },
    });

    if (res.refunded.length > 0) {
      statusEl.innerHTML =
        `<strong>${escapeHtml(t("waehr.zurueckgeholt"))}</strong> ${escapeHtml(t("waehr.htlcFrei", { n: res.refunded.length }))}<br>`
        + `<span class="mono-sm">tx ${escapeHtml((res.signature ?? "").slice(0, 16))}…</span>`;
      statusEl.className = "mono-sm ok";
      await geheim.removeItem(`freedom.htlc.${activeDeposit.sessionId}`).catch(() => undefined);
      activeDeposit = null;
      ($("#dep-refund") as HTMLButtonElement).classList.add("hidden");
    } else {
      statusEl.textContent = res.failed[0]?.reason ?? t("waehr.rueckholungUnmoeglich");
      statusEl.className = "mono-sm err";
    }
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = fehlerText(e);
    statusEl.className = "mono-sm err";
  }
}
