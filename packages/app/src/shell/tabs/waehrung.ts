/**
 * Tab Währung: Guthaben, Tausch sats ↔ SOL (HTLC), Solana-Wallet, Lightning
 * über NWC, SOL-Deposits, Zaps.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import {
  KIND_LP_OFFER,
  LocalSigner,
  type LpOffer,
  NostrEvent,
  buildEvent,
  generateKeypair,
  generatePreimage,
  hashlock,
  parseLpOffer,
  toHex,
} from "@freedomstack/protocol";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { anbieterKursWarnung, depositDeckel, solText } from "../../preis-anzeige.js";
import type { RueckPlan } from "../../rueck-swap.js";
import {
  ensurePool,
  KIND_SWAP_REQUEST,
  KIND_SWAP_RESPONSE,
  angebotVon,
  mitBunker,
  mitRohemSchluessel,
  signiere,
  solRpcUrl,
  state,
} from "../state.js";
import { zeigeEingebauteWallet } from "../eingebaute-wallet.js";
import { aktualisiereKurs, zeigeKurs } from "../marktkurs.js";
import { geheim, verlangeTresor } from "../tresor.js";
import { $, toast, updateSidebarBalances } from "../ui.js";
import { updateBudgetBar } from "./agent.js";

// ------------------------------------------------------------- Wallet-Tab

export async function loadWallet(): Promise<void> {
  // Geraetegerechter Hinweis statt eines dauerhaften "—": auf dem Handy gibt
  // es keine Extension, dort ist NWC der Weg.
  try {
    const { detectPaymentCapabilities } = await import("@freedomstack/protocol");
    const caps = detectPaymentCapabilities();
    const hintEl = $("#ln-hint");
    if (hintEl) hintEl.textContent = caps.note;
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
      leer.textContent = "keine LP-Angebote gefunden";
      box.appendChild(leer);
    }
    for (const { ev, offer } of valid) {
      const rueck = offer.direction === "buy-sol";
      const zeile = document.createElement("div");
      zeile.className = "stat";
      const text = document.createElement("span");
      text.className = "k";
      // fee_ppm: Millionstel – 3000 ppm sind 0,30 % (bis 4.6c stand hier „30.0%“).
      text.textContent = `${pkShort(ev.pubkey)} · ${rueck ? "SOL → sats" : "sats → SOL"} · ${Number(offer.minSats)}–${Number(offer.maxSats)} sats · ${(Number(offer.feePpm) / 10_000).toFixed(2)} %`;
      const knopf = document.createElement("button");
      knopf.className = "ghost";
      knopf.style.cssText = "width:auto;padding:6px 10px";
      knopf.textContent = "tauschen";
      knopf.addEventListener("click", () => void (rueck ? startRueckSwap(ev.pubkey, offer) : startSwap(ev.pubkey, offer.offerId)));
      const rechts = document.createElement("span");
      rechts.appendChild(knopf);
      zeile.append(text, rechts);
      box.appendChild(zeile);
    }
  } catch (e) {
    toast(`Relay-Fehler: ${(e as Error).message}`, true);
  }
}

/** swap-client laden und seine Preimage-Ablage auf den Geheimspeicher setzen. */
async function swapClient(): Promise<typeof import("../../swap-client.js")> {
  const m = await import("../../swap-client.js");
  m.setzeSwapSpeicher(geheim);
  return m;
}

async function startSwap(lpPubkey: string, offerId: string): Promise<void> {
  if (!state.keypair) return;
  const amountStr = prompt("Betrag in sats:");
  const amount = Number(amountStr);
  if (!amount || amount <= 0) return;
  // Adressverlauf: Die Kette ist der Abfluss, gegen den weder Tor noch
  // Verschluesselung hilft. Deshalb VOR dem Swap pruefen, nicht danach
  // berichten.
  const verlauf = JSON.parse(geheim.getItem("freedom.swapHistory") ?? "[]") as {
    address: string; uses: number; firstUsed: number; lastUsed: number;
  }[];
  const letzter = verlauf.length > 0 ? Math.max(...verlauf.map((v) => v.lastUsed)) : undefined;

  const { swapPrivacyCheck, deriveSwapAddress, addressFingerprint } =
    await import("@freedomstack/protocol");

  const pruefung = swapPrivacyCheck({
    usage: verlauf,
    lamports: amount * 1000,
    lastSwapAt: letzter,
  });

  if (!pruefung.ok) {
    const weiter = confirm(
      `Bevor du das machst:\n\n${pruefung.findings.join("\n\n")}\n\n` +
      `Empfohlen:\n${pruefung.actions.map((a) => `  · ${a}`).join("\n")}\n\n` +
      `Trotzdem fortfahren?`,
    );
    if (!weiter) return;
  }

  // Frische Adresse vorschlagen — abgeleitet, also ohne zusaetzliche Sicherung
  // wiederherstellbar. Mit Bunker gibt es keinen Schluessel zum Ableiten:
  // dann ohne Vorschlag.
  const frisch = mitBunker()
    ? null
    : mitRohemSchluessel("Eine frische Swap-Adresse", (sk) => deriveSwapAddress(sk, verlauf.length));
  const solAddr = prompt(
    `Deine Solana-Empfangsadresse:` + (frisch
      ? `\n\nVorschlag: eine frische Adresse Nummer ${verlauf.length} ` +
        `(${addressFingerprint(frisch)}…). Deine Merkphrase bringt sie zurueck.`
      : ""),
  );
  if (!solAddr) return;
  // Adressverlauf und Preimage sind Geheimnisse – vor dem Speichern der Tresor.
  if (!(await verlangeTresor("den Tausch"))) return;

  // Benutzung mitschreiben, damit die naechste Pruefung etwas weiss.
  const vorhanden = verlauf.find((v) => v.address === solAddr);
  const jetzt = Math.floor(Date.now() / 1000);
  if (vorhanden) {
    vorhanden.uses++;
    vorhanden.lastUsed = jetzt;
  } else {
    verlauf.push({ address: solAddr, uses: 1, firstUsed: jetzt, lastUsed: jetzt });
  }
  await geheim.setItem("freedom.swapHistory", JSON.stringify(verlauf));

  try {
    const pool = await ensurePool();
    const preimage = generatePreimage();
    const H = hashlock(preimage);
    // Frueher sessionStorage: beim Schliessen des Tabs weg — und mit dem
    // Preimage der Zugriff auf das Geld. Jetzt dauerhaft, mit Exportmoeglichkeit.
    const { saveSwapSecret } = await swapClient();
    await saveSwapSecret({
      hashlockHex: toHex(H),
      preimageHex: toHex(preimage),
      solAddress: solAddr,
      amountSats: amount,
      createdAt: Math.floor(Date.now() / 1000),
    });

    const ev = await signiere(buildEvent(
        state.keypair.pk,
        KIND_SWAP_REQUEST,
        [
          ["p", lpPubkey],
          ["offer", offerId],
          ["amount_sats", String(amount)],
          ["hashlock", toHex(H)],
          ["solana_address", solAddr],
        ],
        "",
      ));
    await pool.publish(ev);
    toast("Swap-Request gesendet — warte auf Invoice…");
    void pollSwapResponse(ev.id, toHex(H), solAddr, amount);
  } catch (e) {
    toast(`Fehler: ${(e as Error).message}`, true);
  }
}
// Frueher global exportiert, weil ein inline onclick es brauchte. Der ist weg
// (XSS-Fix in loadWallet), also bleibt startSwap jetzt im Modul-Scope.

async function pollSwapResponse(
  requestId: string,
  hashlockHex: string,
  solAddress: string,
  amountSats: number,
): Promise<void> {
  const pool = await ensurePool();
  const statusEl = $("#swap-status");
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const resps = await pool.query({ kinds: [KIND_SWAP_RESPONSE], "#e": [requestId] });
    if (resps.length > 0) {
      const resp = resps[0];
      const bolt11 = resp.content;
      const swapId = resp.tags.find((t) => t[0] === "swap_id")?.[1];
      const lamports = Number(resp.tags.find((t) => t[0] === "amount_lamports")?.[1] ?? "0");
      const lnExpiry = Number(resp.tags.find((t) => t[0] === "ln_expiry")?.[1] ?? "0");

      $("#swap-invoice").classList.remove("hidden");
      $("#swap-bolt11").textContent = bolt11;

      // ---------------------------------------------------------------
      // HIER stand frueher nur "Invoice erhalten — bitte zahlen". Genau das
      // ist der Moment, in dem ein Kunde ohne Pruefung Geld verliert: er
      // zahlt fuer SOL, die niemand gesperrt hat. Der Zahl-Link bleibt daher
      // gesperrt, bis die Gegenleistung auf der Kette bestaetigt ist.
      // ---------------------------------------------------------------
      const payLink = $("#swap-pay-link") as HTMLAnchorElement;
      payLink.removeAttribute("href");
      payLink.classList.add("disabled");
      statusEl.textContent = "Rechnung erhalten. Pruefe die Sperre auf der Kette — noch nicht zahlen.";
      statusEl.className = "mono-sm warn";

      if (!swapId) {
        statusEl.textContent =
          "Der LP hat keine swap_id mitgeschickt — die Gegenleistung ist nicht pruefbar. Nicht zahlen.";
        statusEl.className = "mono-sm err";
        return;
      }

      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const { AnchorSolanaHtlc, fromHex: fh } = await import("@freedomstack/protocol");
        const { verifyCounterpartyLock } = await import("../../swap-client.js");
        const rpcUrl = await solRpcUrl();
        void PublicKey;

        const reader = AnchorSolanaHtlc.reader(new Connection(rpcUrl, "confirmed"));
        const chainLock = await reader.get(swapId);

        const verdict = verifyCounterpartyLock({
          lock: chainLock
            ? {
                amountLamports: chainLock.amountLamports,
                timelockUnix: chainLock.timelockUnix,
                recipient: chainLock.recipient,
                hashlock: chainLock.hashlock,
                claimed: chainLock.claimed,
                refunded: chainLock.refunded,
              }
            : undefined,
          expectedHashlock: fh(hashlockHex),
          expectedRecipient: solAddress,
          expectedLamports: lamports,
          lightningExpiryUnix: lnExpiry || Math.floor(Date.now() / 1000) + 7200,
        });

        if (!verdict.ok) {
          statusEl.innerHTML =
            `<strong>Nicht zahlen.</strong><br>`
            + verdict.problems.map((p) => escapeHtml(p)).join("<br>");
          statusEl.className = "mono-sm err";
          return;
        }

        // Erst jetzt freigeben.
        payLink.href = `lightning:${bolt11}`;
        payLink.classList.remove("disabled");
        // Den Initiator merken: das Programm gibt ihm beim Einloesen die
        // Mietbefreiung zurueck, deshalb muss er in der Claim-Instruktion stehen.
        activeSwap = { swapId, hashlockHex, solAddress, amountSats, initiator: chainLock!.initiator, timelockUnix: chainLock!.timelockUnix };
        $("#swap-claim").classList.remove("hidden");
        statusEl.innerHTML =
          `<strong>Geprueft.</strong> ${escapeHtml(verdict.summary)}<br>`
          + `Nach dem Bezahlen unten einloesen — sonst laeuft der Tausch zurueck.`;
        statusEl.className = "mono-sm ok";
        toast("Gegenleistung geprueft — Rechnung kann bezahlt werden");
      } catch (e) {
        statusEl.textContent =
          `Pruefung nicht moeglich (${(e as Error).message}). Im Zweifel nicht zahlen.`;
        statusEl.className = "mono-sm err";
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  toast("keine LP-Antwort in 90s", true);
}

/** Laufender Swap, fuer den das Einloesen noch aussteht. */
let activeSwap: {
  swapId: string; hashlockHex: string; solAddress: string; amountSats: number;
  /** Wer den Swap angelegt hat (der LP) — bekommt die Mietbefreiung zurueck. */
  initiator: string;
  /** Frist des SOL-HTLC – Einloesen nur mit Sicherheitsabstand davor. */
  timelockUnix: number;
} | null = null;

/** Loest den SOL-HTLC ein und legt dabei das Preimage offen. */
export async function claimActiveSwap(): Promise<void> {
  const statusEl = $("#swap-status");
  if (!activeSwap) return;
  const signer = htlcSigner();
  if (!signer) {
    statusEl.textContent = "Solana-Wallet verbinden, um einzuloesen.";
    statusEl.className = "mono-sm warn";
    return;
  }
  try {
    const { loadSwapSecret, claimSwap, preimageFits, forgetSwapSecret } =
      await swapClient();
    const secret = loadSwapSecret(activeSwap.hashlockHex);
    if (!secret || !preimageFits(secret.preimageHex, activeSwap.hashlockHex)) {
      statusEl.textContent =
        "Preimage nicht gefunden oder unpassend — ohne es ist kein Einloesen moeglich.";
      statusEl.className = "mono-sm err";
      return;
    }

    const { Connection } = await import("@solana/web3.js");
    const { fromHex: fh } = await import("@freedomstack/protocol");
    const rpcUrl = await solRpcUrl();

    const r = await claimSwap({
      connection: new Connection(rpcUrl, "confirmed"),
      wallet: signer,
      swapId: activeSwap.swapId,
      preimage: fh(secret.preimageHex),
      initiator: activeSwap.initiator,
      timelockUnix: activeSwap.timelockUnix,
      onProgress: (step) => { statusEl.textContent = step; },
    });

    statusEl.innerHTML =
      `<strong>Eingeloest.</strong> Die SOL sind auf deiner Adresse.<br>`
      + `<span class="mono-sm">tx ${escapeHtml(r.signature.slice(0, 16))}…</span>`;
    statusEl.className = "mono-sm ok";
    // Aufraeumen darf ein gelungenes Einloesen nicht als Fehler melden.
    await forgetSwapSecret(activeSwap.hashlockHex).catch(() => undefined);
    activeSwap = null;
    $("#swap-claim").classList.add("hidden");
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

/** Sicherung aller offenen Preimages herunterladen. */
// ------------------------------------------------ Gegenrichtung (4.6c)

/** Rueckhol-Waechter laden; seine Ablage liegt im Tresor-Speicher. */
async function sperren(): Promise<typeof import("../../refund-watcher.js")> {
  const m = await import("../../refund-watcher.js");
  m.setzeSperrSpeicher(geheim);
  return m;
}

let waechterStop: (() => void) | undefined;

/**
 * Holt faellige Sperren (Swaps, Deposits) von selbst zurueck, solange die App
 * offen und eine Wallet verbunden ist. Vorher wird die Kette gefragt – was
 * schon eingeloest ist, braucht keinen Wallet-Dialog.
 */
async function starteRueckholWaechter(): Promise<void> {
  const signer = htlcSigner();
  if (waechterStop || !signer) return;
  const [{ startRefundWatcher, walletRefundRunner }, { Connection }] = await Promise.all([sperren(), import("@solana/web3.js")]);
  const conn = new Connection(await solRpcUrl(), "confirmed");
  waechterStop = startRefundWatcher(walletRefundRunner(conn, signer), (r) => {
    if (!r.zurueckgeholt) return;
    toast(`${r.zurueckgeholt} Sperre(n) zurückgeholt: ${solText(r.lamports)}`);
    updateSidebarBalances();
  });
}

/**
 * SOL geben, sats bekommen. Die Rechnung kommt aus der eigenen
 * Lightning-Wallet – ihr Preimage verlaesst die Wallet nie; die App sperrt nur
 * unter dessen Hash. Zahlt der LP nicht, holt der Waechter nach der Frist zurueck.
 */
async function startRueckSwap(lpPubkey: string, offer: LpOffer): Promise<void> {
  const statusEl = $("#swap-status");
  const melde = (text: string, art = ""): void => { statusEl.textContent = text; statusEl.className = `mono-sm ${art}`; };
  const { istRueckAngebot, planeRueckSwap, baueRueckAnfrage, rueckText } = await import("../../rueck-swap.js");
  if (!istRueckAngebot(offer)) return melde("Dieses Angebot nennt kein SOL-Konto oder keinen Kurs.", "err");
  const signer = htlcSigner();
  if (!signer) return melde("Erst eine Solana-Wallet verbinden – mit ihr werden die SOL gesperrt.", "warn");
  const sats = Number(prompt(`Wie viele sats möchtest du bekommen? (${offer.minSats}–${offer.maxSats})`));
  if (!Number.isSafeInteger(sats) || sats <= 0) return;
  let bolt11: string;
  try {
    bolt11 = nwc
      ? (await nwc.makeInvoice(sats * 1000, "FreedomStack: Tausch SOL → sats")).invoice
      : (prompt(`Rechnung (bolt11) deiner Lightning-Wallet über genau ${sats} sats:`) ?? "").trim();
  } catch (e) {
    return melde(`Rechnung nicht erstellt: ${(e as Error).message}`, "err");
  }
  if (!bolt11) return;
  let plan: RueckPlan;
  try {
    plan = planeRueckSwap(offer, bolt11, sats, Math.floor(Date.now() / 1000));
  } catch (e) {
    return melde((e as Error).message, "err");
  }
  const markt = await aktualisiereKurs();
  const warnung = markt ? anbieterKursWarnung({ satsProSol: Math.round(1e9 / offer.lamportsPerSat) }, markt) : undefined;
  if (!confirm(
    `${warnung ? `${warnung} ` : ""}Du sperrst ${solText(plan.lamports)} (inkl. ${(offer.feePpm / 10_000).toFixed(2)} % Gebühr) für ${sats} sats. ` +
    `Zahlt der LP nicht, bekommst du die SOL ab ${new Date(plan.timelockUnix * 1000).toLocaleString("de-DE")} zurück. Sperren?`,
  )) return;

  // Erst merken, dann sperren: Bricht die App dazwischen ab, holt der Waechter
  // trotzdem zurueck (eine nie angelegte Sperre schliesst er ohne Transaktion ab).
  const { rememberLock } = await sperren();
  await rememberLock({ kind: "swap", reference: plan.swapId, swapIds: [plan.swapId], timelockUnix: plan.timelockUnix, amountLamports: plan.lamports, createdAt: Math.floor(Date.now() / 1000) });
  try {
    const [{ Connection }, { lockRueckSwap }] = await Promise.all([import("@solana/web3.js"), import("../../sol-htlc.js")]);
    await lockRueckSwap({ connection: new Connection(await solRpcUrl(), "confirmed"), wallet: signer, ...plan, onProgress: (x) => melde(x) });
  } catch (e) {
    return melde(`Sperre nicht angelegt: ${(e as Error).message}`, "err");
  }
  void starteRueckholWaechter();

  // Erst jetzt die Anfrage – von einem Wegwerf-Schluessel, nicht vom eigenen npub.
  const einmal = new LocalSigner(generateKeypair().sk);
  const anfrage = await einmal.signEvent(baueRueckAnfrage(einmal.publicKey(), lpPubkey, offer.offerId, bolt11, Math.floor(Date.now() / 1000)));
  await (await ensurePool()).publish(anfrage);
  melde(rueckText(undefined, plan));
  void warteAufRueckAntwort(anfrage.id, lpPubkey, plan);
}

/** Antwort des LP abwarten (er prueft bis zu 10 Minuten nach der Anfrage). */
async function warteAufRueckAntwort(requestId: string, lpPubkey: string, plan: RueckPlan): Promise<void> {
  const { leseRueckAntwort, rueckText } = await import("../../rueck-swap.js");
  const pool = await ensurePool();
  const statusEl = $("#swap-status");
  const ende = Date.now() + 12 * 60_000;
  while (Date.now() < ende) {
    const antwort = (await pool.query({ kinds: [KIND_SWAP_RESPONSE], "#e": [requestId], authors: [lpPubkey] }))
      .map(leseRueckAntwort).find((x) => x !== undefined);
    if (antwort) {
      // Die Sperre bleibt gemerkt, auch bei EINGELOEST: Ob der LP wirklich
      // eingeloest hat, sagt die Kette – der Waechter schliesst sie dann ab.
      statusEl.textContent = rueckText(antwort, plan);
      statusEl.className = `mono-sm ${antwort.status === "EINGELOEST" ? "ok" : "warn"}`;
      if (antwort.status === "EINGELOEST") updateSidebarBalances();
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  statusEl.textContent = `Keine Antwort des LP. ${rueckText(undefined, plan)}`;
  statusEl.className = "mono-sm warn";
}

export async function exportSwapBackup(): Promise<void> {
  const { exportSwapSecrets } = await swapClient();
  const blob = new Blob([exportSwapSecrets()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freedom-swap-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Sicherung heruntergeladen — sicher aufbewahren");
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
const solWallet: SolanaWalletState = { connected: false, pubkey: null };

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
function htlcSigner(): import("../../sol-htlc.js").WalletSigner | undefined {
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
  statusEl.textContent = "Welche Wallet?";
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
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.phantom)}">Phantom öffnen</a>` +
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.solflare)}">Solflare öffnen</a></div>`;
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

    statusEl.textContent = "verbunden";
    statusEl.className = "mono-sm ok";
    void starteRueckholWaechter();
    const addrEl = $("#sol-addr");
    addrEl.textContent = conn.pubkey;
    (addrEl as HTMLInputElement).value = conn.pubkey;
    addrEl.classList.remove("hidden");
    const btn = $("#sol-connect") as HTMLButtonElement;
    btn.textContent = "Verbunden";
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
    statusEl.textContent = (e as Error).message;
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
      statusEl.textContent = "Verbindungs-URI aus der Wallet einfuegen (Alby Hub, Coinos, Mutiny …).";
      statusEl.className = "mono-sm warn";
    }
    return;
  }

  try {
    const { parseNwcUri, NwcClient, redactNwcUri, WebSocketRelay, OutboxPool } =
      await import("@freedomstack/protocol");
    const conn = parseNwcUri(raw);

    // Eine NEUE Wallet-Verbindung ist ein Geld-Geheimnis – erst der Tresor.
    if (raw !== gespeichert && !(await verlangeTresor("die Wallet-Verbindung (NWC)"))) {
      statusEl.textContent = "Nicht verbunden: Die Verbindung wird nur im Tresor gespeichert.";
      statusEl.className = "mono-sm warn";
      return;
    }

    // Eigener Pool auf den Relays DER WALLET — die muessen nicht dieselben
    // sein wie die des Protokolls, sonst findet das Wallet uns nicht.
    const walletPool = new OutboxPool(
      conn.relays.map((u) => new WebSocketRelay(u)),
      { minAcks: 1 },
    );
    const client = new NwcClient(conn, walletPool, 30_000);

    statusEl.textContent = "verbinde …";
    statusEl.className = "mono-sm";
    const info = await client.init();
    const balance = await client.getBalance();

    nwc = client;
    // Das Secret liegt lokal wie der Nostr-Key auch. Es ist eine im Wallet
    // widerrufbare, budgetierbare Vollmacht — kein Kontozugang.
    await geheim.setItem(NWC_KEY, raw);
    if (input) input.value = redactNwcUri(raw);

    $("#ln-balance").innerHTML = `${Math.floor(balance / 1000).toLocaleString()} <small>sats</small>`;
    statusEl.textContent = `verbunden (${info.encryption}, ${info.methods.length || "?"} Methoden)`;
    statusEl.className = "mono-sm ok";
    $("#nwc-disconnect").classList.remove("hidden");
    updateSidebarBalances();
  } catch (e) {
    if (silent) return;
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

export function disconnectNwc(): void {
  nwc = null;
  void geheim.removeItem(NWC_KEY).catch((e) => toast(`nicht gelöscht: ${(e as Error).message}`, true));
  const input = $("#nwc-uri") as HTMLInputElement | null;
  if (input) input.value = "";
  $("#ln-balance").innerHTML = `— <small>sats</small>`;
  $("#nwc-status").textContent = "getrennt";
  $("#nwc-status").className = "mono-sm";
  $("#nwc-disconnect").classList.add("hidden");
  updateSidebarBalances();
}


/** Aktive Deposit-Session (RAM). */
let activeDeposit: { sessionId: string; spendSwapId: string; refundSwapId: string } | null = null;

/** Laeuft gerade ein Tausch oder ein Deposit? Dann sperrt der Tresor nicht (1.2d). */
export function geldVorgangLaeuft(): boolean {
  return activeSwap !== null || activeDeposit !== null;
}

export async function startDeposit(): Promise<void> {
  if (!state.keypair) return;
  const statusEl = $("#dep-status");
  if (!solWallet.connected || !solWallet.pubkey) {
    statusEl.textContent = "erst Solana-Wallet verbinden";
    statusEl.className = "mono-sm warn";
    return;
  }
  const amountSol = Number(($("#dep-amount") as HTMLInputElement).value);
  if (!amountSol || amountSol <= 0) {
    statusEl.textContent = "ungueltiger Betrag";
    statusEl.className = "mono-sm err";
    return;
  }
  const providerPk =
    ($("#dep-provider") as HTMLInputElement).value.trim() || state.lastProvider;
  if (!providerPk) {
    statusEl.textContent = "kein Provider — erst eine KI-Anfrage stellen oder pubkey angeben";
    statusEl.className = "mono-sm warn";
    return;
  }
  // Deckel je 1k Tokens aus dem Preis des Anbieters und dem Marktkurs (4.4b) –
  // vorher fest 1000 Lamports, mit richtiger Umrechnung weit unter jedem Preis.
  const [markt, angebot] = await Promise.all([aktualisiereKurs(), angebotVon(providerPk)]);
  if (!markt || !angebot) {
    statusEl.textContent = !markt
      ? "Kein Marktkurs SOL/sats gefunden – ohne ihn wäre der Preis in SOL geraten."
      : "Angebot des Providers nicht gefunden – sein Preis ist unbekannt.";
    statusEl.className = "mono-sm warn";
    return;
  }
  const kursWarnung = anbieterKursWarnung(angebot.kurs, markt);
  if (kursWarnung && !confirm(`${kursWarnung} Trotzdem hinterlegen?`)) return;
  const maxLamportsPerKToken = depositDeckel(angebot.textRatePerKTokenMsat, markt);
  // Das Preimage des Deposits ist ein Geld-Geheimnis – vor dem Sperren der Tresor.
  if (!(await verlangeTresor("das Deposit"))) return;

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
      statusEl.textContent = "Diese Wallet kann keine Transaktionen signieren.";
      statusEl.className = "mono-sm err";
      return;
    }

    const providerSol = ($("#dep-provider-sol") as HTMLInputElement | null)?.value.trim()
      || state.lastProviderSolAddress;
    if (!providerSol) {
      statusEl.textContent =
        "SOL-Adresse des Providers unbekannt — erst eine KI-Anfrage stellen, "
        + "damit der Provider sie mitteilt.";
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
      `<strong>Deposit gedeckt.</strong> ${escapeHtml(String(amountSol))} SOL auf der Kette gesperrt.<br>`
      + `<span class="mono-sm">tx ${escapeHtml(lock.signature.slice(0, 16))}…</span><br>`
      + `Rueckholbar ab ${new Date((Math.floor(Date.now() / 1000) + 7200) * 1000).toLocaleTimeString("de-DE")}.`;
    statusEl.className = "mono-sm ok";
    ($("#dep-refund") as HTMLButtonElement).classList.remove("hidden");
    toast("Deposit gesperrt und angekuendigt");
    updateBudgetBar();
    updateSidebarBalances()
  } catch (e) {
    statusEl.textContent = `Fehler: ${(e as Error).message}`;
    statusEl.className = "mono-sm err";
  }
}

export async function refundDeposit(): Promise<void> {
  const statusEl = $("#dep-status");
  if (!activeDeposit) {
    statusEl.textContent = "keine aktive Deposit-Session";
    return;
  }
  const signer = htlcSigner();
  if (!signer) {
    statusEl.textContent = "Wallet verbinden, um zurueckzuholen.";
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
    statusEl.innerHTML =
      `Der Timelock laeuft noch ${restMin} Minuten. Vorher kann die Kette nichts `
      + `freigeben — das ist die Absicherung, die den Provider ohne Vertrauen `
      + `arbeiten laesst. Danach hier erneut klicken.`;
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
        `<strong>Zurueckgeholt.</strong> ${res.refunded.length} HTLC(s) freigegeben.<br>`
        + `<span class="mono-sm">tx ${escapeHtml((res.signature ?? "").slice(0, 16))}…</span>`;
      statusEl.className = "mono-sm ok";
      await geheim.removeItem(`freedom.htlc.${activeDeposit.sessionId}`).catch(() => undefined);
      activeDeposit = null;
      ($("#dep-refund") as HTMLButtonElement).classList.add("hidden");
    } else {
      statusEl.textContent = res.failed[0]?.reason ?? "Rueckholung nicht moeglich.";
      statusEl.className = "mono-sm err";
    }
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

