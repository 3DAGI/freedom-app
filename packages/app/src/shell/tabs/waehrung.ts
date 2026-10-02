/**
 * Tab Währung: Guthaben, Angebote zum Tausch, Solana-Wallet, Lightning über
 * NWC. Der Tausch selbst steht seit C-5a in `tausch.ts`, das Hinterlegen in
 * `hinterlegen.ts`.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import {
  KIND_LP_OFFER,
  NostrEvent,
  parseLpOffer,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { LS_NWC_EIGENES_RELAY, LS_NWC_NUR_PRIVAT, nwcRelayEinstellung } from "../../nwc-relays.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { liestUmschlaege } from "../../swap-umschlag.js";
import {
  ensurePool,
  solRpcUrl,
} from "../state.js";
import { zeigeEingebauteWallet } from "../eingebaute-wallet.js";
import { aktualisiereKurs, zeigeKurs } from "../marktkurs.js";
import { geheim, verlangeTresor } from "../tresor.js";
import { $, toast, updateSidebarBalances } from "../ui.js";
import { startRueckSwap, startSwap, starteRueckholWaechter } from "./tausch.js";

// ------------------------------------------------------------- Wallet-Tab

export async function loadWallet(): Promise<void> {
  // Geraetegerechter Hinweis statt eines dauerhaften "—": auf dem Handy gibt
  // es keine Extension, dort ist NWC der Weg.
  try {
    const { detectPaymentCapabilities } = await import("@freedomstack/protocol");
    const caps = detectPaymentCapabilities();
    const hintEl = $("#ln-hint");
    // Aus den Feldern – der fertige Hinweis des Protokolls ist Deutsch (8.16e)
    if (hintEl) hintEl.textContent = t(caps.isMobile ? "waehr.lnHinweisHandy" : caps.webln ? "waehr.lnHinweisBrowser" : "waehr.lnHinweisNwc");
  } catch { /* Hinweis ist optional */ }

  if (!nwc && geheim.getItem(NWC_KEY)) {
    // Gespeicherte Verbindung still wiederherstellen — der Nutzer soll die URI
    // nicht bei jedem Laden neu einfuegen muessen.
    void connectNwc(undefined, true);
  } else if (!nwc) {
    $("#ln-balance").innerHTML = `— <small>sats</small>`;
  }

  // Solana still wiederverbinden, wenn die Seite schon einmal erlaubt wurde.
  if (!solWallet.connected) void connectSolana(true);
  zeigeEingebauteWallet();
  zeigeKurs();
  void aktualisiereKurs().then(() => zeigeEingebauteWallet());

  try {
    const pool = await ensurePool();
    const offers = await pool.query({ kinds: [KIND_LP_OFFER], limit: 20 });
    const now = Math.floor(Date.now() / 1000);
    const valid = offers
      .map((ev) => {
        try {
          return { ev, offer: parseLpOffer(ev) };
        } catch {
          return null;
        }
      })
      .filter((x): x is { ev: NostrEvent; offer: ReturnType<typeof parseLpOffer> } => x !== null)
      .filter(({ offer }) => offer.expiry > now);

    const box = $("#lp-offers");
    // SICHERHEIT: offerId/pubkey kommen aus FREMDEN Relay-Events. Frueher
    // wurden sie in ein inline onclick="startSwap('...')" interpoliert — ein
    // boesartiger LP konnte damit beliebiges JS im App-Kontext ausfuehren.
    // Seit 4.6c: Zeilen per DOM und textContent, das Angebot bleibt ein Objekt.
    box.replaceChildren();
    if (!valid.length) {
      const leer = document.createElement("div");
      leer.className = "mono-sm";
      leer.textContent = t("waehr.keineAngebote");
      box.appendChild(leer);
    }
    for (const { ev, offer } of valid) {
      const rueck = offer.direction === "buy-sol";
      const zeile = document.createElement("div");
      zeile.className = "stat";
      const text = document.createElement("span");
      text.className = "k";
      // fee_ppm: Millionstel – 3000 ppm sind 0,30 % (bis 4.6c stand hier „30.0%“).
      text.textContent = `${pkShort(ev.pubkey)} · ${rueck ? "SOL → sats" : "sats → SOL"} · ${Number(offer.minSats)}–${Number(offer.maxSats)} sats · ${(Number(offer.feePpm) / 10_000).toLocaleString(gebietsschema(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
      const knopf = document.createElement("button");
      knopf.className = "ghost";
      knopf.style.cssText = "width:auto;padding:6px 10px";
      knopf.textContent = t("waehr.tauschen");
      if (!liestUmschlaege(offer)) {
        // Seit 4.9b nur versiegelt: Einem LP, der keine Umschlaege liest, ginge die Anfrage offen zu.
        knopf.textContent = t("waehr.veraltet");
        knopf.disabled = true;
        knopf.title = t("waehr.veraltetTitel");
      }
      knopf.addEventListener("click", () => void (rueck ? startRueckSwap(ev.pubkey, offer) : startSwap(ev.pubkey, offer.offerId, offer.vorabSats)));
      const rechts = document.createElement("span");
      rechts.appendChild(knopf);
      zeile.append(text, rechts);
      box.appendChild(zeile);
    }
  } catch (e) {
    toast(t("waehr.relayFehler", { fehler: fehlerText(e) }), true);
  }
}


// ------------------------------------------------------------- Solana-Tab

/** Solana-Wallet-State (MWA / Phantom / Solflare Detection). */
interface SolanaWalletState {
  connected: boolean;
  pubkey: string | null;
  /** Sign-Funktion des Wallets (MWA oder Browser-Extension). */
  signTransaction?: (tx: unknown) => Promise<unknown>;
  /** Der Provider selbst — noetig, um Transaktionen signieren zu lassen. */
  provider?: { publicKey: { toBase58(): string }; signTransaction?: (tx: unknown) => Promise<unknown> };
}
export const solWallet: SolanaWalletState = { connected: false, pubkey: null };

/** Verbundene Solana-Wallet fuer die Zahlschiene (4.1b) – undefined, solange keine verbunden ist. */
export function verbundeneSolanaWallet(): { adresse: string; provider: SolanaWalletState["provider"] } | undefined {
  return solWallet.connected && solWallet.pubkey ? { adresse: solWallet.pubkey, provider: solWallet.provider } : undefined;
}

/**
 * Signierer fuer HTLC-Transaktionen (Sperren, Einloesen, Zurueckholen) aus der
 * verbundenen Wallet. Wallets nach dem Wallet Standard (4.2c) haben kein
 * `publicKey`-Feld – die Adresse kommt aus der Verbindung. Bis 4.6c brachen
 * Einloesen, Deposit und Rueckholen mit solchen Wallets ab („reading 'toBase58'“).
 */
export function htlcSigner(): import("../../sol-htlc.js").WalletSigner | undefined {
  const provider = solWallet.provider;
  const adresse = solWallet.pubkey;
  if (!solWallet.connected || !adresse || !provider?.signTransaction) return undefined;
  return { publicKey: { toBase58: () => adresse }, signTransaction: (tx) => provider.signTransaction!(tx) };
}

/** Name der zuletzt verbundenen Wallet (Wallet Standard) – kein Geheimnis. */
const LS_SOL_WALLET_NAME = "freedom.sol.walletName";

/** Mehrere Wallets angemeldet: als Knoepfe anbieten (Namen per textContent). */
function waehleWallet(statusEl: HTMLElement, namen: string[]): Promise<number | null> {
  statusEl.className = "mono-sm";
  statusEl.textContent = t("waehr.welcheWallet");
  const zeile = document.createElement("div");
  zeile.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px";
  statusEl.appendChild(zeile);
  return new Promise((resolve) => {
    namen.forEach((name, i) => {
      const b = document.createElement("button");
      b.className = "ghost";
      b.style.cssText = "width:auto;padding:6px 10px";
      b.textContent = name;
      b.addEventListener("click", () => { statusEl.textContent = ""; resolve(i); });
      zeile.appendChild(b);
    });
  });
}

export async function connectSolana(silent = false): Promise<void> {
  const statusEl = $("#sol-status");
  const { connectSolanaWallet, fetchSolBalance, detectSolanaEnvironment } =
    await import("../../solana-connect.js");
  try {
    // Frueher wurde hier nur window.solana geprueft. Auf jedem Handy ohne
    // Wallet-In-App-Browser war damit Schluss ("kein Wallet gefunden") — auch
    // auf dem Seeker. Jetzt: injizierter Provider, sonst Deeplink in die App.
    const { ketteAusRpc } = await import("../../wallet-standard.js");
    const conn = await connectSolanaWallet({
      silent,
      gemerkt: localStorage.getItem(LS_SOL_WALLET_NAME),
      kette: async () => ketteAusRpc(await solRpcUrl()),
      waehle: (namen) => waehleWallet(statusEl, namen),
      onNeedsDeeplink: (links, hint) => {
        statusEl.className = "mono-sm";
        statusEl.innerHTML =
          `${escapeHtml(hint)}<div style="display:flex;gap:6px;margin-top:6px">` +
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.phantom)}">${escapeHtml(t("waehr.phantomOeffnen"))}</a>` +
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.solflare)}">${escapeHtml(t("waehr.solflareOeffnen"))}</a></div>`;
      },
    });

    if (!conn) {
      if (!silent && !statusEl.textContent) {
        statusEl.textContent = detectSolanaEnvironment().hint;
        statusEl.className = "mono-sm warn";
      }
      return;
    }

    if (conn.name) localStorage.setItem(LS_SOL_WALLET_NAME, conn.name);
    solWallet.connected = true;
    solWallet.pubkey = conn.pubkey;
    solWallet.signTransaction = conn.provider?.signTransaction?.bind(conn.provider);
    solWallet.provider = conn.provider as SolanaWalletState["provider"];

    statusEl.textContent = t("waehr.verbunden");
    statusEl.className = "mono-sm ok";
    void starteRueckholWaechter();
    $("#sol-pubkey").classList.add("hidden");
    const addrEl = $("#sol-addr");
    addrEl.textContent = conn.pubkey;
    (addrEl as HTMLInputElement).value = conn.pubkey;
    addrEl.classList.remove("hidden");
    const btn = $("#sol-connect") as HTMLButtonElement;
    btn.dataset.i18n = "waehr.knopfVerbunden";
    btn.textContent = t("waehr.knopfVerbunden");
    btn.disabled = true;

    try {
      const rpcUrl = await solRpcUrl();
      const bal = await fetchSolBalance(conn.pubkey, rpcUrl);
      localStorage.setItem("freedom.sol.balance", bal.sol.toFixed(4));
      localStorage.setItem("freedom.sol.pubkey", conn.pubkey);
    } catch { /* RPC nicht erreichbar — Sidebar bleibt bei "—" */ }
    updateSidebarBalances();
  } catch (e) {
    if (silent) return;
    statusEl.textContent = fehlerText(e);
    statusEl.className = "mono-sm err";
  }
}

// ------------------------------------------------------- Lightning via NWC

/** Aktive NWC-Verbindung (Lightning auf jedem Geraet). */
export let nwc: import("@freedomstack/protocol").NwcClient | null = null;
const NWC_KEY = "freedom.nwc.uri";

export async function connectNwc(uri?: string, silent = false): Promise<void> {
  const statusEl = $("#nwc-status");
  const input = $("#nwc-uri") as HTMLInputElement | null;
  const gespeichert = geheim.getItem(NWC_KEY);
  const raw = (uri ?? input?.value ?? "").trim() || gespeichert || "";
  if (!raw) {
    if (!silent) {
      statusEl.textContent = t("waehr.nwcEinfuegen");
      statusEl.className = "mono-sm warn";
    }
    return;
  }

  try {
    const { parseNwcUri, NwcClient, redactNwcUri, WebSocketRelay, OutboxPool, waehleNwcRelays, bolt12Methoden } =
      await import("@freedomstack/protocol");
    const conn = parseNwcUri(raw);
    // Relays der Wallet (6.3): mit Einstellung nur das eigene oder .onion – nie still ein fremdes
    const wahl = waehleNwcRelays(conn.relays, nwcRelayEinstellung(localStorage));
    if ("fehler" in wahl) {
      statusEl.textContent = t("waehr.nwcKeinPrivatesRelay");
      statusEl.className = "mono-sm warn";
      return;
    }

    // Eine NEUE Wallet-Verbindung ist ein Geld-Geheimnis – erst der Tresor.
    if (raw !== gespeichert && !(await verlangeTresor(t("waehr.fuerNwc")))) {
      statusEl.textContent = t("waehr.nurImTresor");
      statusEl.className = "mono-sm warn";
      return;
    }

    // Eigener Pool auf den Relays DER WALLET — die muessen nicht dieselben
    // sein wie die des Protokolls, sonst findet das Wallet uns nicht.
    const walletPool = new OutboxPool(
      wahl.relays.map((u) => new WebSocketRelay(u)),
      { minAcks: 1 },
    );
    const client = new NwcClient(conn, walletPool, 30_000);

    statusEl.textContent = t("waehr.verbinde");
    statusEl.className = "mono-sm";
    const info = await client.init();
    const balance = await client.getBalance();

    nwc = client;
    // Das Secret liegt lokal wie der Nostr-Key auch. Es ist eine im Wallet
    // widerrufbare, budgetierbare Vollmacht — kein Kontozugang.
    await geheim.setItem(NWC_KEY, raw);
    if (input) input.value = redactNwcUri(raw);

    $("#ln-balance").innerHTML = `${Math.floor(balance / 1000).toLocaleString(gebietsschema())} <small>sats</small>`;
    // BOLT12 nur erkennen (6.3): NIP-47 legt die Methoden noch nicht fest – Rechnungen gehen versiegelt (6.3b1)
    const bolt12 = bolt12Methoden(info.methods);
    statusEl.textContent = [
      t("waehr.nwcVerbunden", { verschluesselung: info.encryption, n: info.methods.length || "?" }),
      t(wahl.fremd ? "waehr.nwcRelayFremd" : "waehr.nwcRelayPrivat"),
      bolt12.length ? t("waehr.bolt12Ja", { methoden: bolt12.join(", ") }) : t("waehr.bolt12Nein"),
    ].join(" · ");
    statusEl.className = wahl.fremd ? "mono-sm" : "mono-sm ok";
    $("#nwc-disconnect").classList.remove("hidden");
    updateSidebarBalances();
  } catch (e) {
    if (silent) return;
    statusEl.textContent = fehlerText(e);
    statusEl.className = "mono-sm err";
  }
}

/** Einstellung „NWC nur über eigenes oder .onion-Relay“ (6.3) – verbindet danach neu, wenn verbunden. */
export function wireNwcRelays(): void {
  const haken = $("#nwc-privat") as HTMLInputElement | null;
  const feld = $("#nwc-eigenes-relay") as HTMLInputElement | null;
  if (!haken || !feld) return;
  const e = nwcRelayEinstellung(localStorage);
  haken.checked = e.nurPrivat;
  feld.value = e.eigenes ?? "";
  const merke = (): void => {
    localStorage.setItem(LS_NWC_NUR_PRIVAT, haken.checked ? "1" : "0");
    const url = feld.value.trim();
    if (url) localStorage.setItem(LS_NWC_EIGENES_RELAY, url);
    else localStorage.removeItem(LS_NWC_EIGENES_RELAY);
    const uri = geheim.getItem(NWC_KEY);
    if (uri) {
      nwc = null;
      void connectNwc(uri);
    }
  };
  haken.onchange = merke;
  feld.onchange = merke;
}

export function disconnectNwc(): void {
  nwc = null;
  void geheim.removeItem(NWC_KEY).catch((e) => toast(t("waehr.nichtGeloescht", { fehler: fehlerText(e) }), true));
  const input = $("#nwc-uri") as HTMLInputElement | null;
  if (input) input.value = "";
  $("#ln-balance").innerHTML = `— <small>sats</small>`;
  $("#nwc-status").textContent = t("waehr.getrennt");
  $("#nwc-status").className = "mono-sm";
  $("#nwc-disconnect").classList.add("hidden");
  updateSidebarBalances();
}
