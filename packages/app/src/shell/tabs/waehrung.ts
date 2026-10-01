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
  generateKeypair,
  generatePreimage,
  hashlock,
  parseLpOffer,
  toHex,
  type UnsignedEvent,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { LS_NWC_EIGENES_RELAY, LS_NWC_NUR_PRIVAT, nwcRelayEinstellung } from "../../nwc-relays.js";
import { escapeHtml, ganzeSats, pkShort } from "../../shell-logic.js";
import { anbieterKursWarnung, depositDeckel, solText } from "../../preis-anzeige.js";
import type { RueckPlan } from "../../rueck-swap.js";
import { hinAnfrage, liestUmschlaege, rueckAnfrage, swapAntworten, type SwapPost } from "../../swap-umschlag.js";
import {
  ensurePool,
  angebotVon,
  signiere,
  solRpcUrl,
  state,
} from "../state.js";
import { bestaetige, dialog } from "../dialog.js";
import { eingebauterHtlcSigner, frischeEmpfangsadresse, zeigeEingebauteWallet } from "../eingebaute-wallet.js";
import { aktualisiereKurs, zeigeKurs } from "../marktkurs.js";
import { geheim, verlangeTresor } from "../tresor.js";
import { $, el, toast, updateSidebarBalances } from "../ui.js";
import { updateBudgetBar } from "./agent.js";

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

/** swap-client laden und seine Preimage-Ablage auf den Geheimspeicher setzen. */
async function swapClient(): Promise<typeof import("../../swap-client.js")> {
  const m = await import("../../swap-client.js");
  m.setzeSwapSpeicher(geheim);
  return m;
}

async function startSwap(lpPubkey: string, offerId: string, vorabSats?: number): Promise<void> {
  if (!state.keypair) return;
  const w = await dialog({
    titel: t("waehr.tauschTitel"),
    felder: [{ art: "text", name: "betrag", label: t("waehr.betragSats"), pflicht: true }],
    pruefe: (w) => (ganzeSats(w.betrag) ? null : t("waehr.ungueltigerBetrag")),
    ok: t("waehr.weiter"),
  });
  const amount = w ? ganzeSats(w.betrag) : 0;
  if (!amount) return;
  // Adressverlauf: Die Kette ist der Abfluss, gegen den weder Tor noch
  // Verschluesselung hilft. Deshalb VOR dem Swap pruefen, nicht danach
  // berichten.
  const verlauf = JSON.parse(geheim.getItem("freedom.swapHistory") ?? "[]") as {
    address: string; uses: number; firstUsed: number; lastUsed: number;
  }[];
  const letzter = verlauf.length > 0 ? Math.max(...verlauf.map((v) => v.lastUsed)) : undefined;

  const { tauschPruefung } = await swapClient();

  const pruefung = tauschPruefung({
    usage: verlauf,
    lamports: amount * 1000,
    lastSwapAt: letzter,
  });

  if (!pruefung.ok) {
    const weiter = await bestaetige({
      titel: t("waehr.bevorTitel"),
      text: t("waehr.bevorDuTauschst", {
        befunde: pruefung.befunde.join("\n\n"),
        schritte: pruefung.schritte.map((a) => `  · ${a}`).join("\n"),
      }),
      ok: t("waehr.trotzdemWeiter"),
    });
    if (!weiter) return;
  }

  // Frische Empfangsadresse der eingebauten Wallet (4.9c): nur fuer diesen
  // Tausch, aus den 12 Woertern wiederherstellbar (Phantoms Konten 1, 2, …).
  // Eingeloest wird dann mit ihrem Schluessel, ohne SOL ueber einen Relayer.
  // Bis 4.9c stand hier nur ein Fingerabdruck – die Adresse selbst sah niemand.
  const frisch = await frischeEmpfangsadresse().catch(() => undefined);
  const { isValidSolanaAddress } = await import("../../solana-connect.js");
  const wa = await dialog({
    titel: t("waehr.tauschTitel"),
    text: frisch ? t("waehr.empfangsadresseFrisch") : undefined,
    felder: [{ art: "text", name: "adresse", label: t("waehr.empfangsadresse"), wert: frisch ?? solWallet.pubkey ?? "", pflicht: true, mono: true }],
    pruefe: (w) => (isValidSolanaAddress(String(w.adresse).trim()) ? null : t("waehr.keineSolAdresse")),
    ok: t("waehr.tauschAnfragen"),
  });
  const solAddr = String(wa?.adresse ?? "").trim();
  if (!solAddr) return;
  // Adressverlauf und Preimage sind Geheimnisse – vor dem Speichern der Tresor.
  if (!(await verlangeTresor(t("waehr.fuerTausch")))) return;

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

    // Versiegelt von einem Wegwerf-Schluessel (4.9b): Relays sehen weder den
    // npub noch die Empfangsadresse – nur, dass der LP Post bekommt.
    const post = await hinAnfrage({ lpPk: lpPubkey, offerId, amountSats: amount, hashlockHex: toHex(H), solAdresse: solAddr });
    await pool.publish(post.wrap);
    toast(t("waehr.anfrageGesendet"));
    void pollSwapResponse(post, toHex(H), solAddr, amount, vorabSats);
  } catch (e) {
    toast(t("waehr.fehler", { fehler: fehlerText(e) }), true);
  }
}
// Frueher global exportiert, weil ein inline onclick es brauchte. Der ist weg
// (XSS-Fix in loadWallet), also bleibt startSwap jetzt im Modul-Scope.

async function pollSwapResponse(
  post: SwapPost,
  hashlockHex: string,
  solAddress: string,
  amountSats: number,
  vorabSats?: number,
): Promise<void> {
  const pool = await ensurePool();
  const lpPubkey = post.lpPk;
  const statusEl = $("#swap-status");
  let deadline = Date.now() + 90_000;
  let vorabGefragt = false;

  while (Date.now() < deadline) {
    // Nur versiegelte Antworten des LP selbst zu dieser Anfrage – eine fremde
    // „Vorab-Rechnung“ darf nie bezahlt werden (4.6d, seit 4.9b im Umschlag).
    const alle = await swapAntworten(pool, post);
    const status = (r: UnsignedEvent) => r.tags.find((t) => t[0] === "status")?.[1];
    const resps = alle.filter((r) => !status(r));
    const abgelehnt = alle.find((r) => status(r) === "ABGELEHNT");
    const vorab = alle.find((r) => status(r) === "VORAB");
    if (!resps.length && abgelehnt) {
      statusEl.textContent = t("waehr.lpAbgelehnt", { grund: abgelehnt.content.slice(0, 200) });
      statusEl.className = "mono-sm err";
      return;
    }
    if (!resps.length && vorab && !vorabGefragt) {
      vorabGefragt = true;
      if (!(await zahleVorab(vorab, vorabSats))) return;
      deadline = Date.now() + 120_000; // der LP sieht die Zahlung beim naechsten Durchlauf
    }
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
      statusEl.textContent = t("waehr.rechnungErhalten");
      statusEl.className = "mono-sm warn";

      if (!swapId) {
        statusEl.textContent = t("waehr.ohneSwapId");
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
          // Befunde der Prüfung als Text, je einer in einer Zeile (C-6)
          statusEl.replaceChildren(el("strong", t("waehr.nichtZahlen")), ...verdict.problems.flatMap((p) => [document.createElement("br"), document.createTextNode(p)]));
          statusEl.className = "mono-sm err";
          return;
        }

        // Erst jetzt freigeben.
        payLink.href = `lightning:${bolt11}`;
        payLink.classList.remove("disabled");
        // Den Initiator merken: das Programm gibt ihm beim Einloesen die
        // Mietbefreiung zurueck, deshalb muss er in der Claim-Instruktion stehen.
        activeSwap = {
          swapId, hashlockHex, solAddress, amountSats, initiator: chainLock!.initiator, timelockUnix: chainLock!.timelockUnix,
          lpPubkey, lamports: chainLock!.amountLamports,
        };
        $("#swap-claim").classList.remove("hidden");
        statusEl.innerHTML =
          `<strong>${escapeHtml(t("waehr.geprueft"))}</strong> ${escapeHtml(verdict.summary)}<br>`
          + escapeHtml(t("waehr.nachDemBezahlen"));
        statusEl.className = "mono-sm ok";
        toast(t("waehr.gegenleistungGeprueft"));
      } catch (e) {
        statusEl.textContent = t("waehr.pruefungUnmoeglich", { fehler: fehlerText(e) });
        statusEl.className = "mono-sm err";
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  toast(t("waehr.keineLpAntwort"), true);
}

/**
 * Vorab-Gebuehr (4.6d): Der LP verlangt sie, bevor er SOL sperrt. Gezahlt
 * wird nur nach Pruefung (`pruefeVorab`) und Zustimmung – ueber die Zahlschiene.
 */
async function zahleVorab(antwort: UnsignedEvent, angekuendigt: number | undefined): Promise<boolean> {
  const statusEl = $("#swap-status");
  const { pruefeVorab } = await swapClient();
  const p = pruefeVorab(antwort, angekuendigt);
  if (!p.ok) {
    statusEl.textContent = t("waehr.nichtGezahlt", { grund: p.grund });
    statusEl.className = "mono-sm err";
    return false;
  }
  if (!(await bestaetige({ titel: t("waehr.vorabTitel"), text: t("waehr.vorabFrage", { sats: p.sats }), ok: t("waehr.zahlen") }))) {
    statusEl.textContent = t("waehr.vorabAbgelehnt");
    statusEl.className = "mono-sm warn";
    return false;
  }
  try {
    // dynamisch: zahlschienen.ts importiert selbst aus diesem Modul
    const [{ zahle }, { zahlschienen }] = await Promise.all([import("@freedomstack/protocol"), import("../zahlschienen.js")]);
    await zahle(zahlschienen(), { ziel: p.bolt11, betrag: { einheit: "msat", wert: p.sats * 1000 }, zweck: "swap" });
  } catch (e) {
    statusEl.textContent = t("waehr.vorabFehler", { fehler: fehlerText(e) });
    statusEl.className = "mono-sm err";
    return false;
  }
  statusEl.textContent = t("waehr.vorabBezahlt");
  statusEl.className = "mono-sm";
  return true;
}

/** Laufender Swap, fuer den das Einloesen noch aussteht. */
let activeSwap: {
  swapId: string; hashlockHex: string; solAddress: string; amountSats: number;
  /** Wer den Swap angelegt hat (der LP) — bekommt die Mietbefreiung zurueck. */
  initiator: string;
  /** Frist des SOL-HTLC – Einloesen nur mit Sicherheitsabstand davor. */
  timelockUnix: number;
  /** Der LP dieses Swaps – nie zugleich Relayer (4.6f). */
  lpPubkey: string;
  /** Gesperrter Betrag – fuer die Mindestmiete beim Einloesen ueber einen Relayer. */
  lamports: number;
} | null = null;

/** Loest den SOL-HTLC ein und legt dabei das Preimage offen. */
export async function claimActiveSwap(): Promise<void> {
  const statusEl = $("#swap-status");
  if (!activeSwap) return;
  // Einloesen kann nur, wer die Empfangsadresse haelt: die verbundene Wallet
  // oder die eingebaute (Hauptadresse oder frische Adresse, 4.9c).
  const verbunden = htlcSigner();
  const signer = verbunden?.publicKey.toBase58() === activeSwap.solAddress ? verbunden : eingebauterHtlcSigner(activeSwap.solAddress);
  if (!signer) {
    statusEl.textContent = t("waehr.adresseOhneWallet");
    statusEl.className = "mono-sm warn";
    return;
  }
  try {
    const { loadSwapSecret, claimSwap, preimageFits, forgetSwapSecret } =
      await swapClient();
    const secret = loadSwapSecret(activeSwap.hashlockHex);
    if (!secret || !preimageFits(secret.preimageHex, activeSwap.hashlockHex)) {
      statusEl.textContent = t("waehr.preimageFehlt");
      statusEl.className = "mono-sm err";
      return;
    }

    const { Connection, PublicKey } = await import("@solana/web3.js");
    const { fromHex: fh } = await import("@freedomstack/protocol");
    const rpcUrl = await solRpcUrl();
    const connection = new Connection(rpcUrl, "confirmed");

    // Kein SOL fuer die Gebuehr? Dann ueber einen Relayer (4.6f).
    const { brauchtRelayer } = await import("../../relay-einloesung.js");
    const guthaben = await connection.getBalance(new PublicKey(signer.publicKey.toBase58()));
    const r = brauchtRelayer(guthaben)
      ? await einloesenUeberRelayer({ connection, rpcUrl, signer, guthaben, preimage: fh(secret.preimageHex), swap: activeSwap, statusEl })
      : await claimSwap({
        connection,
        wallet: signer,
        swapId: activeSwap.swapId,
        preimage: fh(secret.preimageHex),
        initiator: activeSwap.initiator,
        timelockUnix: activeSwap.timelockUnix,
        onProgress: (step) => { statusEl.textContent = step; },
      });
    if (!r) return;

    statusEl.innerHTML =
      `<strong>${escapeHtml(t("waehr.eingeloest"))}</strong> ${escapeHtml(t("waehr.solAufAdresse"))}<br>`
      + `<span class="mono-sm">tx ${escapeHtml(r.signature.slice(0, 16))}…</span>`;
    statusEl.className = "mono-sm ok";
    // Aufraeumen darf ein gelungenes Einloesen nicht als Fehler melden.
    await forgetSwapSecret(activeSwap.hashlockHex).catch(() => undefined);
    activeSwap = null;
    $("#swap-claim").classList.add("hidden");
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = fehlerText(e);
    statusEl.className = "mono-sm err";
  }
}

/**
 * Einloesen ueber einen Relayer (4.6f): Er zahlt die Gebuehr, die Wallet
 * signiert die Einloesung und eine Erstattung an ihn. Nie der LP selbst; bleibt
 * die Einloesung aus, rechtzeitig der naechste.
 */
async function einloesenUeberRelayer(p: {
  connection: import("@solana/web3.js").Connection; rpcUrl: string; signer: import("../../sol-htlc.js").WalletSigner;
  guthaben: number; preimage: Uint8Array; swap: NonNullable<typeof activeSwap>; statusEl: HTMLElement;
}): Promise<{ signature: string } | undefined> {
  const {
    KIND_GIFT_WRAP, KIND_RELAYER_ANGEBOT, buildRelayAuftrag, mieteReicht, oeffneRelayAntwort, parseRelayerAngebot,
  } = await import("@freedomstack/protocol");
  const [{ waehleRelayer, baueRelayEinloesung }, { claimAllowed }, { ketteAusRpc }] = await Promise.all([
    import("../../relay-einloesung.js"), swapClient(), import("../../wallet-standard.js"),
  ]);
  const pool = await ensurePool();
  const angebote = (await pool.query({ kinds: [KIND_RELAYER_ANGEBOT], limit: 50 })).flatMap((ev) => {
    try { return [{ pubkey: ev.pubkey, created_at: ev.created_at, angebot: parseRelayerAngebot(ev) }]; } catch { return []; }
  });
  const kandidaten = waehleRelayer(angebote, { kette: ketteAusRpc(p.rpcUrl), lpPubkey: p.swap.lpPubkey, lpSol: p.swap.initiator });
  if (!kandidaten.length) throw new Error(t("waehr.keinRelayer"));
  const teuerster = kandidaten[kandidaten.length - 1].erstattungLamports;
  if (!mieteReicht({ guthabenVorher: p.guthaben, eingeloest: p.swap.lamports, erstattung: teuerster })) {
    throw new Error(t("waehr.mieteReichtNicht"));
  }
  if (!(await bestaetige({ titel: t("waehr.relayerTitel"), text: t("waehr.relayerFrage", { betrag: solText(teuerster) }), ok: t("waehr.einloesen") }))) return undefined;

  for (const k of kandidaten) {
    // Genug Zeit fuer Relayer und Kette – sonst lieber gar nicht (die Lightning-Zahlung laeuft dann zurueck).
    const erlaubt = claimAllowed(p.swap.timelockUnix - 300);
    if (!erlaubt.ok) throw new Error(erlaubt.reason);
    p.statusEl.textContent = t("zahl.warteWallet");
    const roh = await baueRelayEinloesung({ connection: p.connection, wallet: p.signer, swapId: p.swap.swapId, preimage: p.preimage, initiator: p.swap.initiator, relayer: k });
    const einmal = new LocalSigner(generateKeypair().sk);
    const { wrap, auftragId } = await buildRelayAuftrag({ tx: roh, kunde: einmal, relayerPk: k.pubkey });
    await pool.publish(wrap);
    p.statusEl.textContent = t("waehr.relayerLoestEin");
    const ende = Date.now() + 90_000;
    let abgelehnt = false;
    while (Date.now() < ende && !abgelehnt) {
      for (const w of await pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [einmal.publicKey()] })) {
        const a = await oeffneRelayAntwort(w, einmal, { relayerPk: k.pubkey, auftragId });
        if (a?.status === "GESENDET" && a.signatur) {
          const st = await p.connection.getSignatureStatuses([a.signatur]).catch(() => undefined);
          const s0 = st?.value[0];
          if (s0 && !s0.err && (s0.confirmationStatus === "confirmed" || s0.confirmationStatus === "finalized")) return { signature: a.signatur };
        }
        if (a?.status === "ABGELEHNT") {
          p.statusEl.textContent = t("waehr.relayerLehntAb", { grund: a.grund });
          abgelehnt = true;
        }
      }
      if (!abgelehnt) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw new Error(t("waehr.keinRelayerEingeloest"));
}

/** Sicherung aller offenen Preimages herunterladen. */
// ------------------------------------------------ Gegenrichtung (4.6c)

/** Rueckhol-Waechter laden; seine Ablage liegt im Tresor-Speicher. */
export async function sperren(): Promise<typeof import("../../refund-watcher.js")> {
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
export async function starteRueckholWaechter(): Promise<void> {
  const signer = htlcSigner();
  if (waechterStop || !signer) return;
  const [{ startRefundWatcher, walletRefundRunner }, { Connection }] = await Promise.all([sperren(), import("@solana/web3.js")]);
  const conn = new Connection(await solRpcUrl(), "confirmed");
  waechterStop = startRefundWatcher(walletRefundRunner(conn, signer), (r) => {
    if (!r.zurueckgeholt) return;
    toast(t("waehr.sperrenZurueck", { n: r.zurueckgeholt, betrag: solText(r.lamports) }));
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
  const { istRueckAngebot, planeRueckSwap, rueckText } = await import("../../rueck-swap.js");
  if (!istRueckAngebot(offer)) return melde(t("waehr.angebotOhneKonto"), "err");
  const signer = htlcSigner();
  if (!signer) return melde(t("waehr.erstSolanaWallet"), "warn");
  const ws = await dialog({
    titel: t("waehr.rueckTitel"),
    felder: [{ art: "text", name: "sats", label: t("waehr.wievieleSats", { min: offer.minSats, max: offer.maxSats }), pflicht: true }],
    pruefe: (w) => {
      const n = ganzeSats(w.sats);
      if (!n) return t("waehr.ungueltigerBetrag");
      return n < offer.minSats || n > offer.maxSats ? t("waehr.betragBereich", { min: offer.minSats, max: offer.maxSats }) : null;
    },
    ok: t("waehr.weiter"),
  });
  const sats = ws ? ganzeSats(ws.sats) : 0;
  if (!sats) return;
  let bolt11: string;
  try {
    bolt11 = nwc
      ? (await nwc.makeInvoice(sats * 1000, "FreedomStack: Tausch SOL → sats")).invoice // kein UI-Text
      : String((await dialog({
        titel: t("waehr.rueckTitel"),
        felder: [{ art: "textarea", name: "rechnung", label: t("waehr.rechnungFrage", { sats }), pflicht: true, mono: true }],
        ok: t("waehr.weiter"),
      }))?.rechnung ?? "").trim();
  } catch (e) {
    return melde(t("waehr.rechnungNichtErstellt", { fehler: fehlerText(e) }), "err");
  }
  if (!bolt11) return;
  let plan: RueckPlan;
  try {
    plan = planeRueckSwap(offer, bolt11, sats, Math.floor(Date.now() / 1000));
  } catch (e) {
    return melde(fehlerText(e), "err");
  }
  const markt = await aktualisiereKurs();
  const warnung = markt ? anbieterKursWarnung({ satsProSol: Math.round(1e9 / offer.lamportsPerSat) }, markt) : undefined;
  if (!(await bestaetige({
    titel: t("waehr.rueckTitel"),
    text: (warnung ? `${warnung}\n\n` : "") + t("waehr.sperrenFrage", {
      betrag: solText(plan.lamports),
      gebuehr: (offer.feePpm / 10_000).toLocaleString(gebietsschema(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      sats,
      ab: new Date(plan.timelockUnix * 1000).toLocaleString(gebietsschema()),
    }),
    ok: t("waehr.sperren"),
  }))) return;

  // Erst merken, dann sperren: Bricht die App dazwischen ab, holt der Waechter
  // trotzdem zurueck (eine nie angelegte Sperre schliesst er ohne Transaktion ab).
  const { rememberLock } = await sperren();
  await rememberLock({ kind: "swap", reference: plan.swapId, swapIds: [plan.swapId], timelockUnix: plan.timelockUnix, amountLamports: plan.lamports, createdAt: Math.floor(Date.now() / 1000) });
  try {
    const [{ Connection }, { lockRueckSwap }] = await Promise.all([import("@solana/web3.js"), import("../../sol-htlc.js")]);
    await lockRueckSwap({ connection: new Connection(await solRpcUrl(), "confirmed"), wallet: signer, ...plan, onProgress: (x) => melde(x) });
  } catch (e) {
    return melde(t("waehr.sperreNichtAngelegt", { fehler: fehlerText(e) }), "err");
  }
  void starteRueckholWaechter();

  // Erst jetzt die Anfrage – versiegelt von einem Wegwerf-Schluessel (4.9b):
  // Relays sehen weder npub noch Rechnung.
  const post = await rueckAnfrage({ lpPk: lpPubkey, offerId: offer.offerId, bolt11 });
  await (await ensurePool()).publish(post.wrap);
  melde(rueckText(undefined, plan));
  void warteAufRueckAntwort(post, plan);
}

/** Antwort des LP abwarten (er prueft bis zu 10 Minuten nach der Anfrage). */
async function warteAufRueckAntwort(post: SwapPost, plan: RueckPlan): Promise<void> {
  const { leseRueckAntwort, rueckText } = await import("../../rueck-swap.js");
  const pool = await ensurePool();
  const statusEl = $("#swap-status");
  const ende = Date.now() + 12 * 60_000;
  while (Date.now() < ende) {
    const antwort = (await swapAntworten(pool, post)).map(leseRueckAntwort).find((x) => x !== undefined);
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
  statusEl.textContent = t("waehr.keineAntwortLp", { text: rueckText(undefined, plan) });
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
  toast(t("waehr.sicherungGeladen"));
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

