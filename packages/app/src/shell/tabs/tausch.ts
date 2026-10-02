/**
 * Tausch sats ↔ SOL (HTLC): Hinrichtung (sats → SOL), Einlösen über Relayer,
 * Rückhol-Wächter und Gegenrichtung (SOL → sats, 4.6c).
 *
 * Aus tabs/waehrung.ts verschoben (C-5a) – wörtlich, ohne Logikänderung.
 */
import {
  LocalSigner,
  type LpOffer,
  generateKeypair,
  generatePreimage,
  hashlock,
  toHex,
  type UnsignedEvent,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { escapeHtml, ganzeSats } from "../../shell-logic.js";
import { anbieterKursWarnung, solText } from "../../preis-anzeige.js";
import type { RueckPlan } from "../../rueck-swap.js";
import { hinAnfrage, rueckAnfrage, swapAntworten, type SwapPost } from "../../swap-umschlag.js";
import { ensurePool, solRpcUrl, state } from "../state.js";
import { bestaetige, dialog } from "../dialog.js";
import { eingebauterHtlcSigner, frischeEmpfangsadresse } from "../eingebaute-wallet.js";
import { aktualisiereKurs } from "../marktkurs.js";
import { geheim, verlangeTresor } from "../tresor.js";
import { $, el, toast, updateSidebarBalances } from "../ui.js";
import { htlcSigner, nwc, solWallet } from "./waehrung.js";


/** swap-client laden und seine Preimage-Ablage auf den Geheimspeicher setzen. */
async function swapClient(): Promise<typeof import("../../swap-client.js")> {
  const m = await import("../../swap-client.js");
  m.setzeSwapSpeicher(geheim);
  return m;
}

export async function startSwap(lpPubkey: string, offerId: string, vorabSats?: number): Promise<void> {
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
export let activeSwap: {
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
export async function startRueckSwap(lpPubkey: string, offer: LpOffer): Promise<void> {
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
