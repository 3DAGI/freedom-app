/**
 * Tab Agent: KI-Aufträge (NIP-90) stellen, Antworten und Belege anzeigen,
 * Modellwahl, lokaler Verlauf, Modelle im Netz und Repositories.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import {
  KIND_DVM_TEXT_GENERATION,
  KIND_GIFT_WRAP,
  type NostrEvent,
  buildEvent,
  buildJobRequest,
  buildPrivateJobRequest,
  PROVIDER_PPM,
  parseJobResult,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText, hatFehlerText, reklamationsFrist } from "../../protokoll-texte.js";
import { icon } from "../../icons.js";
import { DEFAULT_MAX_MODE, ScoredProvider, matchRaceProviders } from "../../matchmaking.js";
import { type AntwortCache, oeffneAntworten } from "../../ki-antworten.js";
import { kontextPraefix } from "../../ki-kontext.js";
import { SessionClient } from "../../session-client.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { ausMsat, solText } from "../../preis-anzeige.js";
import { werkzeugPreise, werkzeugPreisText } from "../../werkzeug-preise.js";
import type { ToolPrice } from "@freedomstack/protocol";
import { merkeGratisAbgelehnt, switchTab, zeigeOnboarding } from "../app.js";
import {
  ensurePool,
  ensureSessionClient,
  findProviders,
  kiSitzungen,
  powJeProvider,
  signiere,
  state,
} from "../state.js";
import { aktualisiereKurs, aktuellerKurs } from "../marktkurs.js";
import { geheim } from "../tresor.js";
import { beiFunkAntwort, sendeKiUeberFunk } from "../ki-ueber-funk.js";
import { quittungNachKanal, quittungNachZahlung } from "../quittungen.js";
import { deklaration, empfaengerFuer, kanalAntwort, kanalGutschrift, merkeAnfrage, perKanal, providerZahlung, rechneAntwortAb, zahleAnteile } from "../ki-zahlung.js";
import { hoechstMsat } from "../../anteile-kasse.js";
import {
  $,
  activateCodeBlocks,
  ganzeZahl,
  markSvgCheck,
  quotaExhausted,
  refreshQuota,
  renderMarkdown,
  toast,
  updateSidebarBalances,
} from "../ui.js";
import { haltevorModell, katalogRangJetzt, kuendigeModellAn, zeigeModelle } from "./agent-netz.js";
import { PRUEFER_ART, type Pruefer } from "../../streitfall.js";
import { merkeReklamation, netzPruefer, stelleZu } from "../streitfall-ui.js";
import { zeigeMitwirkende } from "./earn.js";
import { vergebeAbzeichen } from "./profil.js";
import { funkGeraetVerbunden, richteNachfolgeEin, sendeUeberFunk, zeigeNachfolge } from "./settings.js";

/** Modell des zuletzt genutzten Providers (fuer die anzeige). */
let lastProviderModel: string | null = null;

// ------------------------------------------------------------- Modell-Dropdown

/** Fuellt das Modell-Dropdown mit den Modellen der besten Provider des Tiers. */
export async function refreshModelDropdown(): Promise<void> {
  const sel = $("#ai-model") as HTMLInputElement | null;
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  if (!sel || !btn) return;
  const current = sel.value;
  try {
    const [providers] = await Promise.all([findProviders(($("#ai-tier") as HTMLSelectElement).value), aktualisiereKurs()]);
    // modelle + preise der top-provider sammeln (dedupe, haeufigkeit)
    const counts = new Map<string, { count: number; priceMsat: number; tools: Set<string> }>();
    for (const p of providers.slice(0, 5)) {
      for (const m of p.caps.models ?? []) {
        const cur = counts.get(m) ?? { count: 0, priceMsat: p.caps.textRatePerKTokenMsat ?? 1500, tools: new Set((p.caps.tools ?? []).map((t: any) => t.name ?? String(t))) };
        cur.count += 1;
        counts.set(m, cur);
      }
    }
    // Reihenfolge (5.7): erst, was in abonnierten Katalogen steht, dann nach
    // Zahl der Provider – keine feste Vorliebe des Projekts.
    const rang = katalogRangJetzt();
    const inKatalogen = (m: string) => rang.get(m.toLowerCase()) ?? 0;
    const entries = [...counts.entries()].sort((a, b) => inKatalogen(b[0]) - inKatalogen(a[0]) || b[1].count - a[1].count);
    (window as unknown as { __modelCatalog?: unknown }).__modelCatalog = entries;
    // Kosten je Werkzeug (8.7): guenstigstes Angebot, in sats und SOL
    zeigeWerkzeugPreise(providers.map((p) => p.caps));

    // Popover-Inhalt: Karten mit Name, Speed-Klasse, Preis/1k tokens, Provider-Count
    const pop = $("#model-popover");
    if (pop) {
      const speedOf = (m: string): { label: string; cls: string } => {
        if (m.includes("nemotron")) return { label: t("agent.schnell"), cls: "fast" };
        if (/(\d+)b/.test(m)) {
          const size = Number(RegExp.$1);
          if (size <= 8) return { label: t("agent.schnell"), cls: "fast" };
          if (size <= 15) return { label: t("agent.mittel"), cls: "mid" };
          return { label: t("agent.tief"), cls: "deep" };
        }
        return { label: t("agent.mittel"), cls: "mid" };
      };
      pop.innerHTML = `
        <button type="button" class="model-card ${current === "" ? "selected" : ""}" data-model="">
          <div class="mc-head"><b>${escapeHtml(t("agent.auto"))}</b><span class="mc-speed fast">${escapeHtml(t("agent.schnellste"))}</span></div>
          <div class="mc-sub">${escapeHtml(t("agent.autoSub"))}</div>
        </button>
        ${entries.map(([m, info]) => {
          const sp = speedOf(m);
          const short = m.split(":")[0];
          // Beide Einheiten aus dem Marktkurs (4.4b) – vorher fest 150.000 sats/SOL.
          const preis = ausMsat(info.priceMsat, aktuellerKurs());
          return `<button type="button" class="model-card ${current === m ? "selected" : ""}" data-model="${escapeHtml(m)}">
            <div class="mc-head"><b>${escapeHtml(short)}</b><span class="mc-speed ${sp.cls}">${escapeHtml(sp.label)}</span></div>
            <div class="mc-sub">${escapeHtml(t("agent.mcSub", { preis, n: info.count }))}${escapeHtml(katalogHinweis(inKatalogen(m)))}${info.tools.size ? " · " + icon("wrench", 11) : ""}</div>
          </button>`;
        }).join("")}`;
    }
    // button-label aktualisieren
    updateModelBtnLabel();
  } catch { /* dropdown bleibt bei auto */ }
}

/** „ · in 2 Katalogen“ – leer, wenn kein abonnierter Katalog das Modell nennt. */
function katalogHinweis(n: number): string {
  return n > 0 ? ` · ${t(n === 1 ? "agent.inKatalog" : "agent.inKatalogen", { n })}` : "";
}

/** Button-Label aus aktueller Modell-Wahl. */
function updateModelBtnLabel(): void {
  const sel = $("#ai-model") as HTMLInputElement | null;
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  if (!sel || !btn) return;
  const v = sel.value;
  btn.innerHTML = v
    ? `${icon("bot", 14)} ${escapeHtml(v.split(":")[0])}`
    : `${icon("bot", 14)} ${escapeHtml(t("agent.autoSchnellste"))}`;
}

/** Modell-Popover öffnen/schliessen. */
export function setupModelPicker(): void {
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  const pop = $("#model-popover");
  if (!btn || !pop) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.toggle("hidden");
  });
  // Karten-Klicks (delegiert, da Inhalt dynamisch)
  pop.addEventListener("click", async (e) => {
    const card = (e.target as HTMLElement).closest(".model-card") as HTMLElement | null;
    if (!card) return;
    const sel = $("#ai-model") as HTMLInputElement;
    sel.value = card.dataset.model ?? "";
    updateModelBtnLabel();
    pop.classList.add("hidden");
    toast(sel.value ? t("agent.modellGewaehlt", { modell: sel.value.split(":")[0] ?? "" }) : t("agent.modellAuto"));
  });
  // klick außerhalb schließt
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".model-picker-wrap")) pop.classList.add("hidden");
  });
}

// -------------------------------------------------- Agent: lokaler Verlauf

interface AgentVerlauf {
  id: string;
  title: string;
  at: number;
  messages: { role: "user" | "ai"; text: string; meta?: string; model?: string }[];
}

let aktuellerVerlauf: AgentVerlauf | null = null;
let verlaufWiederherstellen = false;

function ladeVerlaeufe(): AgentVerlauf[] {
  try {
    return JSON.parse(geheim.getItem("freedom.agentHistory") ?? "[]") as AgentVerlauf[];
  } catch {
    return [];
  }
}

function speichereVerlaeufe(v: AgentVerlauf[]): void {
  // Obergrenze: Ein unbegrenzter Verlauf fuellt den Speicher, und der ist im
  // Browser knapp — bei Ueberlauf verliert die App ganz andere Daten.
  geheim.setItem("freedom.agentHistory", JSON.stringify(v.slice(0, 40)))
    .catch(() => { /* Speicher voll oder gesperrt — Verlauf ist verzichtbar */ });
}

/** Wird von addAiMessage aufgerufen. Beim Wiederherstellen nicht erneut speichern. */
function merkeNachricht(role: "user" | "ai", text: string, meta: string, model?: string): void {
  if (verlaufWiederherstellen) return;
  const alle = ladeVerlaeufe();
  if (!aktuellerVerlauf) {
    if (role !== "user") return;
    aktuellerVerlauf = {
      id: String(Date.now()),
      title: text.replace(/\s+/g, " ").trim().slice(0, 60) || t("agent.aufgabe"),
      at: Math.floor(Date.now() / 1000),
      messages: [],
    };
    alle.unshift(aktuellerVerlauf);
  }
  aktuellerVerlauf.messages.push({ role, text: text.slice(0, 20_000), meta, model });
  const i = alle.findIndex((x) => x.id === aktuellerVerlauf!.id);
  if (i >= 0) alle[i] = aktuellerVerlauf;
  speichereVerlaeufe(alle);
  zeigeVerlaeufe();
}

export function zeigeVerlaeufe(): void {
  const box = document.getElementById("agent-history");
  if (!box) return;
  const alle = ladeVerlaeufe();
  if (alle.length === 0) {
    box.innerHTML = `<p class="muted mono-sm history-empty">${escapeHtml(t("agent.keineAufgaben"))}</p>`;
    return;
  }
  const heute = new Date().toDateString();
  let letzteGruppe = "";
  box.innerHTML = alle.map((v) => {
    const d = new Date(v.at * 1000);
    const gruppe = t(d.toDateString() === heute ? "agent.heute" : "agent.frueher");
    const kopf = gruppe !== letzteGruppe ? `<div class="history-group">${escapeHtml(gruppe)}</div>` : "";
    letzteGruppe = gruppe;
    const aktiv = aktuellerVerlauf?.id === v.id ? " active" : "";
    return `${kopf}<button class="history-item${aktiv}" data-hid="${escapeHtml(v.id)}" type="button">
      <span class="history-title">${escapeHtml(v.title)}</span>
      <span class="history-sub">${escapeHtml(t("agent.nachrichten", { n: v.messages.length }))}</span></button>`;
  }).join("");
  box.querySelectorAll<HTMLElement>(".history-item").forEach((b) => {
    b.addEventListener("click", () => oeffneVerlauf(b.dataset.hid!));
  });
}

function oeffneVerlauf(id: string): void {
  const v = ladeVerlaeufe().find((x) => x.id === id);
  if (!v) return;
  aktuellerVerlauf = v;
  const thread = document.getElementById("ai-thread");
  if (thread) thread.innerHTML = "";
  verlaufWiederherstellen = true;
  try {
    for (const m of v.messages) addAiMessage(m.role, m.text, m.meta ?? "", m.model);
  } finally {
    verlaufWiederherstellen = false;
  }
  zeigeVerlaeufe();
}

export function neueAufgabe(): void {
  aktuellerVerlauf = null;
  const thread = document.getElementById("ai-thread");
  const leer = document.getElementById("ai-empty");
  if (thread) {
    thread.innerHTML = "";
    if (leer) thread.appendChild(leer);
  }
  if (leer) leer.style.display = "";
  zeigeVerlaeufe();
  (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
}

/** Rechte Spalte: was der Agent in dieser Sitzung benutzt hat. Nur echte Daten. */
function aktualisiereAgentPanel(
  tools: { name: string; costMsat: number }[],
  sessionTotalMsat?: number,
): void {
  const box = document.getElementById("agent-tools");
  if (box && tools.length > 0) {
    box.classList.remove("muted");
    box.innerHTML = tools.map((x) => `<div class="panel-row">
      <span class="panel-check">${markSvgCheck()}</span>
      <span class="panel-name">${escapeHtml(x.name)}</span>
      <span class="panel-meta">${Math.floor(x.costMsat / 1000)} sat</span></div>`).join("");
  }
  const c = document.getElementById("agent-cost");
  if (c && sessionTotalMsat !== undefined) {
    c.classList.remove("muted");
    c.innerHTML = `<div class="panel-row"><span class="panel-name">${escapeHtml(t("agent.dieseSitzung"))}</span>
      <span class="panel-meta">${Math.floor(sessionTotalMsat / 1000)} sat</span></div>`;
  }
}

// ------------------------------------------------------------- KI-Tab

export function updateFeePreview(): void {
  const bid = Number(($("#ai-bid") as HTMLInputElement).value);
  // Aufteilung A+ (5.1.3): mindestens 94 % an den Provider, hoechstens 6 % an
  // weitere Empfaenger – welche es gibt, zeigt erst der Auftrag (Angebot,
  // Werbelink, Relays); ohne Empfaenger bekommt den Anteil der Provider.
  const msat = Number.isFinite(bid) && bid > 0 ? Math.floor(bid * 1000) : 0;
  const providerMin = Math.floor((msat * PROVIDER_PPM) / 1_000_000);
  $("#ai-fee-preview").textContent = t("agent.gebuehrVorschau", {
    betrag: ausMsat(msat, aktuellerKurs()), provider: Math.floor(providerMin / 1000), anteile: Math.ceil((msat - providerMin) / 1000),
  });
  updateTokenEstimate();
}

/**
 * C7: Live-Kosten-Schätzung beim Tippen.
 * Schätzt Output-Tokens aus Prompt-Länge (~4 Zeichen/Token), multipliziert mit
 * dem Rate des gewählten Modells (oder Default) und zeigt „~X sats" im Budget-Feld.
 */
export function updateTokenEstimate(): void {
  const el = $("#ai-budget");
  if (!el) return;
  const promptLen = ($("#ai-prompt") as HTMLTextAreaElement).value.length;
  if (promptLen < 10) { el.textContent = ""; return; }
  const estTokens = Math.ceil(promptLen / 4) + 300; // +300 für Antwort-Puffer
  // Rate: aus Modell-Katalog (falls geladen) oder Default 1500 msat/1k
  let rate = 1500;
  try {
    const catalog = (window as unknown as { __modelCatalog?: Array<[string, { priceMsat: number }]> }).__modelCatalog;
    const sel = ($("#ai-model") as HTMLInputElement).value;
    const hit = catalog?.find(([m]) => m === sel);
    if (hit) rate = hit[1].priceMsat;
  } catch { /* default */ }
  const estSats = Math.max(1, Math.ceil((estTokens / 1000) * rate / 1000));
  el.textContent = t("agent.schaetzung", { tokens: estTokens, preis: ausMsat(estSats * 1000, aktuellerKurs()) });
}

// ------------------------------------------------------------- Fehler-UX (Phase 1.2)
/** Eine Meldung der App selbst, schon in der Sprache der Oberfläche (8.16d1). */
class EigeneMeldung extends Error {}

/** Mappt technische Fehler auf verstaendliche Ursachen. */
function explainError(e: unknown): string {
  const m = ((e as Error)?.message ?? String(e)).toLowerCase();
  // Eigene, schon übersetzte Meldungen (3.1, 8.16d1) nicht umdeuten – Fehler des Protokolls mit Kennung (8.16i) auch nicht.
  if (e instanceof EigeneMeldung) return e.message;
  if (hatFehlerText(e)) return fehlerText(e);
  // Muster auf technische Meldungen (Relay, Knoten, Browser) – Regexe, keine Texte der Oberfläche
  if (/relay|websocket|eose|pool/.test(m)) return t("agent.fehlerRelay");
  if (/kein provider|provider.*antwort/.test(m)) return t("agent.fehlerKeinProvider");
  if (/bid zu niedrig|kein free-tier/.test(m)) return t("agent.fehlerGebot");
  if (/identitaet|keypair|session/.test(m)) return t("agent.fehlerIdentitaet");
  if (/timeout/.test(m)) return t("agent.fehlerTimeout");
  if (/comfy/.test(m)) return t("agent.fehlerComfy");
  if (/fetch|network/.test(m)) return t("agent.fehlerNetz");
  return fehlerText(e);
}

/** Baut eine Fehler-Bubble mit Ursache + Retry-Button. */
function showAiError(e: unknown, retryPrompt: string, retryBid: number, retryTier: "free" | "classic" | "pro", retryMode: { max?: boolean; swarm?: boolean } = {}): void {
  hideTyping();
  const cause = explainError(e);
  // Gratis-Anfrage abgelehnt (8.1a): Die Fuehrung fragt jetzt nach der Wallet
  if (retryTier === "free" && /bid zu niedrig/i.test((e as Error)?.message ?? String(e))) merkeGratisAbgelehnt();
  const el = document.createElement("div");
  el.className = "bubble ai error";
  el.innerHTML = `<div class="who">${escapeHtml(t("agent.fehler"))}</div>
    <div class="body">${escapeHtml(t("agent.ursache"))} <b>${escapeHtml(cause)}</b></div>`;
  const btn = document.createElement("button");
  btn.className = "btn-retry";
  btn.textContent = t("agent.erneut");
  btn.onclick = () => {
    btn.remove();
    ($("#ai-prompt") as HTMLTextAreaElement).value = retryPrompt;
    ($("#ai-bid") as HTMLInputElement).value = String(retryBid);
    ($("#ai-tier") as HTMLSelectElement).value = retryMode.max ? "max" : retryMode.swarm ? "swarm" : retryTier;
    void askAi();
  };
  el.appendChild(btn);
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
  const sendBtn = $("#ai-send") as HTMLButtonElement;
  resetSendBtn(sendBtn);
}

export async function askAi(): Promise<void> {
  if (!state.keypair) return;
  const promptEl = $("#ai-prompt") as HTMLTextAreaElement;
  const prompt = promptEl.value.trim();
  const bid = Number(($("#ai-bid") as HTMLInputElement).value);
  if (!prompt) return;

  const btn = $("#ai-send") as HTMLButtonElement;
  // STOP: läuft bereits ein Job → abbrechen statt neuen senden
  if (btn.dataset.running === "1" && jobAbort) {
    jobAbort.abort();
    return;
  }
  // KI über Funk (7.4c3): gewählt – die Antwort kommt später über setupFunkAntworten()
  if (($("#ai-funk") as HTMLInputElement | null)?.checked) {
    await frageUeberFunk(prompt, bid);
    return;
  }
  btn.dataset.running = "1";
  btn.classList.add("stop-mode");
  btn.textContent = t("agent.stop");
  // Retry-Kontext ausserhalb des try-Blocks (catch braucht ihn)
  const selTier = ($("#ai-tier") as HTMLSelectElement).value;
  const maxMode = selTier === "max";
  const swarmMode = selTier === "swarm";
  const tier = (maxMode || swarmMode ? "pro" : selTier) as "free" | "classic" | "pro";
  try {
    // Kontingent erschöpft + kein Guthaben? → zum Wallet-Tab lenken statt
    // einen Job zu schicken, den niemand bezahlen kann.
    if (quotaExhausted) {
      const hasFunds = Number(localStorage.getItem("freedom.escrow.lamports") ?? "0") > 0;
      if (!hasFunds) {
        toast(t("agent.kontingentAufgebraucht"), true);
        switchTab("wallet");
        resetSendBtn(btn);
        return;
      }
    }
    // free tier = bid 0 (gratis-job, kein escrow) — sonst lehnt der bootstrap-provider ab
    const effectiveBid = tier === "free" ? 0 : bid;
    // Modellwechsel: wenn das Tier wechselt und schon Verlauf da ist, Summary einfuegen
    maybeInsertModelSwitchSummary(selTier);
    // Tool-Input = Prompt (die Query, die das Tool ausfuehrt)
    for (const t of selectedTools) t.input = prompt;
    addAiMessage("user", prompt, "");
    promptEl.value = "";
    hideEmptyState();
    showTyping("connecting");
    // video_gen geht DIREKT an ComfyUI (nicht an das LLM — das kann kein video)
    const wantsVideo = selectedTools.some((t) => t.name === "video_gen");
    if (wantsVideo) {
      setTypingStatus("creating");
      await generateVideo(prompt);
      resetSendBtn(btn);
      return;
    }
    // Auto-Research: wenn web-tool aktiv ODER das modell es nicht weiss, erst recherchieren
    const wantsWeb = selectedTools.some((t) => t.name === "web_search" || t.name === "browser_use");
    if (wantsWeb) setTypingStatus("researching");
    else setTypingStatus("thinking"); // job ist unterwegs → chip "denkt" sofort aktiv
    // Auto-Matchmaking + Failover (default), Race (max), oder Swarm+Judge (swarm)
    if (swarmMode) {
      await askSwarm(prompt, effectiveBid, tier);
    } else {
      await askWithFailover(prompt, effectiveBid, tier, maxMode);
    }
    // Pipeline: nach Empfang der Antwort alle Chips auf done
    document.querySelectorAll("#ai-typing .job-chip").forEach((c) => {
      c.classList.add("done"); c.classList.remove("active");
    });
  } catch (e) {
    showAiError(e, prompt, bid, tier, { max: maxMode, swarm: swarmMode });
  }
}

/** Sendet den Job an den besten Provider; bei Timeout automatisch der naechste.
 *  maxMode=true: Race — Job an N Provider, schnellster gewinnt (opt-in, Aufpreis). */
async function askWithFailover(prompt: string, bid: number, tier: "free" | "classic" | "pro", maxMode = false): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  const candidates = privatFaehig(await findProviders(tier));

  if (maxMode) {
    return askRace(prompt, bid, tier, candidates);
  }

  const pubkeyList = candidates.map((c) => c.caps.pubkey);
  // Bekannten Session-Provider zuerst (Kontinuitaet), dann beste Matches
  if (state.lastProvider && sc.activeFor(state.lastProvider) && powJeProvider.has(state.lastProvider)
    && !pubkeyList.includes(state.lastProvider)) {
    pubkeyList.unshift(state.lastProvider);
  }
  // Private Anfragen brauchen einen Empfaenger – einen offenen Bid-Job an
  // alle gibt es seit 3.1 nicht mehr (er stand im Klartext auf den Relays).
  if (pubkeyList.length === 0) {
    showAiError(keinPrivaterProvider(), prompt, bid, tier);
    return;
  }
  const targets = pubkeyList.slice(0, 3);

  // HEDGING: Nach HEDGE_AFTER_MS ohne Antwort wird derselbe Job ZUSÄTZLICH an
  // den nächsten Provider geschickt (der erste läuft weiter). Wer zuerst
  // antwortet, gewinnt — Wartezeit max. Hedge-Intervall statt Provider-Timeout.
  const HEDGE_AFTER_MS = Number(localStorage.getItem("freedom.hedgeMs") ?? 20_000);
  /** Alle aktiven Job-Ids dieses Laufs (Results aus allen akzeptieren). */
  const activeJobIds = new Set<string>();
  let lastFeedbackError = "";

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    // erster Kandidat: hedge-fenster + restlaufzeit (browser-suche braucht zeit)
    const timeoutMs = i === 0 ? HEDGE_AFTER_MS + Math.min(280_000, 300_000 - HEDGE_AFTER_MS) : 120_000;
    const { wrap, requestId } = await buildJobEvent(prompt, bid, tier, target, sc);
    await pool.publish(wrap);
    activeJobIds.add(requestId);

    const answer = await waitForAnswer(requestId, timeoutMs, target, {
      extraJobIds: activeJobIds,
      onFeedback: (msg) => { lastFeedbackError = msg; },
      signal: jobAbort?.signal,
    });
    if (answer) {
      if ("providerError" in answer && answer.providerError) {
        // Ablehnung durch DIESEN Provider → Failover zum nächsten (die meisten
        // Ablehnungen sind provider-spezifisch: quota, bootstrap, preis).
        lastFeedbackError = answer.providerError;
        toast(t("agent.providerLehntAb", { grund: answer.providerError.slice(0, 50) }));
        continue; // Failover!
      }
      if (answer.aborted) {
        addAiMessage("ai", t("agent.abgebrochen"), "");
        return;
      }
      await handleAnswer(answer.ev, answer.parsed!, prompt);
      return;
    }
    if (i < targets.length - 1) {
      // kein Feedback, nur langsam → Hedge: nächster Provider bekommt ihn JETZT,
      // der aktuelle bleibt aktiv (seine Antwort wird via activeJobIds noch
      // akzeptiert).
      toast(t("agent.providerLangsam", { pk: pkShort(target) }));
    }
  }
  // Alle Kandidaten versagt (Timeout oder Ablehnung):
  showAiError(
    lastFeedbackError ? new Error(lastFeedbackError) : new EigeneMeldung(t("agent.keinProviderAntwort")),
    prompt, bid, tier,
  );
}

/**
 * Private Antworten (Schritt 3.2): Umschlaege an die Sitzungsschluessel dieser
 * Seite abfragen und oeffnen – Ergebnisse und Rueckmeldungen zu den gesuchten
 * Anfragen, wie offene Events.
 */
async function privateAntworten(ids: ReadonlySet<string>, seit: number, cache: AntwortCache) {
  const pks = kiSitzungen.pubkeys();
  if (pks.length === 0) return { ergebnisse: [], rueckmeldungen: [] };
  const umschlaege = await (await ensurePool()).query({ kinds: [KIND_GIFT_WRAP], "#p": pks, since: seit });
  return oeffneAntworten(umschlaege, kiSitzungen, ids, cache);
}

/** Payment-Feedback von fremden Providern (NWC-timeouts etc.) ist KEIN
 *  Job-Fehler — der Antwortfluss darf dadurch nicht abbrechen. */
function isPaymentNoise(msg: string): boolean {
  return /payment error|nwc timed out|keysend.*(fail|timeout)|invoice.*timeout/i.test(msg);
}

/** video_gen: direkt an ComfyUI (H3), nicht an das LLM. */
async function generateVideo(prompt: string): Promise<void> {
  hideTyping();
  // qualitaet/laenge aus den selects
  const dur = Number((document.getElementById("video-duration") as HTMLSelectElement | null)?.value ?? "3");
  const qual = (document.getElementById("video-quality") as HTMLSelectElement | null)?.value ?? "std";
  const size = qual === "hd" ? { width: 1280, height: 720 } : qual === "low" ? { width: 480, height: 270 } : { width: 768, height: 432 };
  const length = Math.max(17, Math.min(121, dur * 24 + 5)); // 17k+5 grid
  addAiMessage("ai", t("agent.videoWird", { breite: size.width, hoehe: size.height, dauer: dur }), "");
  try {
    // ueber den gate-proxy (/comfy) auf gleicher origin
    const base = `${location.origin}/comfy`;
    const wf = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors", weight_dtype: "default" } },
      "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax" } },
      "3": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
      "5": { class_type: "MiniMaxH3ImageToVideo", inputs: { clip: ["2", 0], vae: ["3", 0], prompt, width: size.width, height: size.height, length } },
      "6": { class_type: "EmptyMiniMaxH3LatentAV", inputs: { width: size.width, height: size.height, length, batch_size: 1 } },
      "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["5", 0], negative: ["5", 0], latent_image: ["6", 0], seed: Math.floor(Math.random() * 2 ** 32), steps: 20, cfg: 5.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0 } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
      "9": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 24 } },
      "10": { class_type: "SaveVideo", inputs: { video: ["9", 0], filename_prefix: "freedom_h3", format: "mp4", codec: "h264" } },
    };
    const r = await fetch(`${base}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: wf }) });
    if (!r.ok) throw new Error(`comfy ${r.status}`);
    const { prompt_id } = await r.json();
    // poll bis fertig (max 10 min — H3 dauert)
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 5000));
      const h = await fetch(`${base}/history/${prompt_id}`);
      if (!h.ok) continue;
      const hd = await h.json();
      const entry = hd[prompt_id];
      if (entry?.status?.completed) {
        const files = Object.values(entry.outputs ?? {}).flatMap((o: unknown) => (o as { images?: Array<{ filename: string }> }).images ?? []);
        if (files.length > 0) {
          const fname = (files[0] as { filename: string }).filename;
          addAiMessage("ai", `${t("agent.videoFertig")} <a href="${base}/view?filename=${encodeURIComponent(fname)}" target="_blank">${fname}</a>`, "");
          return;
        }
      }
      if (entry?.status?.status_str === "error") {
        addAiMessage("ai", t("agent.videoFehler", { grund: entry.status.messages?.find((m: string[]) => m[0] === "execution_error")?.[1]?.exception_message ?? t("agent.unbekannt") }), "");
        return;
      }
    }
    addAiMessage("ai", t("agent.videoTimeout"), "");
  } catch (e) {
    addAiMessage("ai", t("agent.videoFehler", { grund: fehlerText(e) }), "");
  }
}

/** MAX MODE: Race — Job an N Provider, schnellster gewinnt. Opt-in (Aufpreis). */
async function askRace(prompt: string, bid: number, tier: "free" | "classic" | "pro", candidates: ScoredProvider[]): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  const racers = matchRaceProviders(candidates, tier, DEFAULT_MAX_MODE);
  if (racers.length === 0) {
    showAiError(new EigeneMeldung(t("agent.maxKeinProvider")), prompt, bid, tier, { max: true });
    return;
  }
  // Bezahlt wird nur die Antwort, die die App annimmt (5.1.3) – die übrigen nicht
  toast(t("agent.maxStart", { n: racers.length }));

  // Job an ALLE racer gleichzeitig (race-tag im versiegelten Kern, je ein Umschlag)
  const jobs = await Promise.all(racers.map((r) => buildJobEvent(prompt, bid, tier, r.caps.pubkey, sc, [["race", "1"]])));
  for (const j of jobs) await pool.publish(j.wrap);

  // Erste Antwort gewinnt
  const ids = new Set(jobs.map((j) => j.requestId));
  const deadline = Date.now() + 45_000;
  const seit = Math.floor(Date.now() / 1000) - 120;
  const cache: AntwortCache = new Map();
  while (Date.now() < deadline) {
    const results = (await privateAntworten(ids, seit, cache)).ergebnisse;
    const hit = results.find((ev) => ids.has(ev.tags.find((t) => t[0] === "e")?.[1] ?? ""));
    if (hit) {
      let r: ReturnType<typeof parseJobResult>;
      try {
        r = parseJobResult(hit);
      } catch {
        r = { requestId: hit.id, customerPubkey: "", providerPubkey: hit.pubkey, output: hit.content, amountMsat: 0 } as ReturnType<typeof parseJobResult>;
      }
      const winner = r.providerPubkey;
      toast(t("agent.maxGewinner", { pk: pkShort(winner) }));
      await handleAnswer(hit, r, prompt);
      return;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  hideTyping();
  showAiError(new EigeneMeldung(t("agent.maxKeiner")), prompt, bid, tier, { max: true });
}

/** SWARM: N Responder antworten, Judge waehlt/synthetisiert die beste. */
async function askSwarm(prompt: string, bid: number, tier: "free" | "classic" | "pro"): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  // Swarm = lokaler Provider mit beiden Modellen (nemotron + qwen3.8:27b)
  // Wir senden einen Job mit ["swarm", "1"] tag — der Provider erkennt das und nutzt beide Modelle
  const candidates = privatFaehig(await findProviders(tier));
  const target = candidates[0]?.caps.pubkey ?? null; // Erster Provider (lokaler GX10)
  const btn = $("#ai-send") as HTMLButtonElement;
  if (!target) {
    showAiError(new EigeneMeldung(t("agent.swarmKeinProvider")), prompt, bid, tier, { swarm: true });
    return;
  }

  toast(t("agent.swarmStart"));
  // Tag fuer swarm-modus im provider – im versiegelten Kern. Frueher kam er nach
  // der Signatur dazu, die Anfrage war dadurch ungueltig signiert.
  const { wrap, requestId } = await buildJobEvent(prompt, bid, tier, target, sc, [["swarm", "1"]]);
  await pool.publish(wrap);
  const answer = await waitForAnswer(requestId, 120_000, target);
  if (answer) {
    if ("providerError" in answer && answer.providerError) {
      showAiError(new Error(answer.providerError), prompt, bid, tier, { swarm: true });
      return;
    }
    if (answer.aborted) { addAiMessage("ai", t("agent.abgebrochen"), ""); return; }
    await handleAnswer(answer.ev, answer.parsed!, prompt);
    return;
  }

  hideTyping();
  showAiError(new EigeneMeldung(t("agent.swarmTimeout")), prompt, bid, tier, { swarm: true });
}

/** Kontext fuer den naechsten Job (Schritt 3.3): Der Knoten merkt sich keinen
 *  Verlauf mehr, also gehen die letzten Nachrichten des aktuellen Verlaufs
 *  versiegelt mit jeder Anfrage mit (`kontextPraefix`). Beim Tier-Wechsel
 *  zeigt ein Hinweis, dass der Kontext mitgeht. */
let lastTier: string | null = null;
let pendingContextSummary = "";
function maybeInsertModelSwitchSummary(newTier: string): void {
  const thread = $("#ai-thread");
  const msgs = aktuellerVerlauf?.messages ?? [];
  pendingContextSummary = kontextPraefix(msgs);
  if (lastTier && lastTier !== newTier && pendingContextSummary) {
    const note = document.createElement("div");
    note.className = "model-switch";
    note.innerHTML = `<div class="model-switch-inner">${escapeHtml(t("agent.modellGewechselt"))} <b>${escapeHtml(newTier)}</b> — ${escapeHtml(t("agent.kontextMit", { n: msgs.length }))}</div>`;
    thread.appendChild(note);
    stickToBottom(() => note.scrollIntoView({ behavior: "smooth", block: "end" }));
  }
  lastTier = newTier;
}

/**
 * Private Anfragen (Schritt 3.1): nur an Provider, deren Angebot die verlangte
 * Rechenarbeit nennt – aeltere Knoten lesen keine Umschlaege. Mehr als
 * MAX_POW_APP Bits rechnet ein Handy zu lange; solche Angebote bleiben aussen vor.
 */
const MAX_POW_APP = 16;
const keinPrivaterProvider = () => new EigeneMeldung(t("agent.keinPrivaterProvider"));

function privatFaehig(kandidaten: ScoredProvider[]): ScoredProvider[] {
  const ok = kandidaten.filter((c) => c.caps.powBits !== undefined && c.caps.powBits <= MAX_POW_APP);
  for (const c of ok) powJeProvider.set(c.caps.pubkey, c.caps.powBits!);
  return ok;
}

/**
 * Die Anfrage bauen und versiegeln (Schritt 3.1): Autor ist der
 * Sitzungsschluessel fuer diesen Provider, nicht die Identitaet; sie reist als
 * Kern im Umschlag mit der Rechenarbeit aus dem Angebot. Zusatz-Tags (race,
 * swarm) gehoeren in den Kern, bevor versiegelt wird.
 */
async function buildJobEvent(
  prompt: string,
  bid: number,
  tier: string,
  targetPubkey: string,
  sc: SessionClient,
  zusatzTags: string[][] = [],
): Promise<{ wrap: NostrEvent; requestId: string }> {
  if (!state.keypair) throw new Error("no keypair"); // kein UI-Text
  const sitzung = kiSitzungen.fuer(targetPubkey);
  // Kontext des Verlaufs (3.3): reist versiegelt mit dem Prompt, der Knoten merkt sich nichts
  const fullPrompt = pendingContextSummary ? pendingContextSummary + prompt : prompt;
  // Extra-Tags: Anhang (multimodal) + angeforderte Tools + gewuenschtes Modell
  const extraTags: string[][] = [];

  // Gebuehrenmodell A+ (5.1.3): welche Anteile die App selbst zahlt – im Kern,
  // also versiegelt; der Provider stellt nur den Rest in Rechnung. Die
  // App-Gebuehr gibt es nicht mehr, sie geht im Anteil der Entwicklung auf.
  const empfaenger = await empfaengerFuer(targetPubkey);
  const hoechst = hoechstMsat(bid, selectedTools);
  // Zahlkanal zu diesem Provider (4.3d): Gutschrift statt Deklaration – im Kanal
  // teilt das Programm auf; deckt er das Gebot nicht, geht nichts hinaus.
  const kanal = await kanalGutschrift(targetPubkey, hoechst);
  extraTags.push(...(kanal ? kanal.tags : deklaration(empfaenger)));
  if (attachment) {
    extraTags.push(["attach", attachment.type, attachment.name, attachment.dataUrl.slice(0, 2000)]);
  }
  for (const tk of selectedTools) {
    extraTags.push(["tool", String(tk.kind), tk.input]);
  }
  // Modell-Wahl: aus Dropdown (leer = provider-default, nemotron bevorzugt)
  const modelSel = $("#ai-model") as HTMLSelectElement | null;
  if (modelSel && modelSel.value) {
    extraTags.push(["param", "model", modelSel.value]);
  }
  const useSession = !kanal && sc.activeFor(targetPubkey);
  const request = useSession
    ? buildEvent(sitzung.publicKey(), KIND_DVM_TEXT_GENERATION, [
        ["i", fullPrompt, "text"],
        ...sc.jobTags(targetPubkey, bid * 1000),
        ["tier", tier],
        ["p", targetPubkey],
        ...extraTags,
        ...zusatzTags,
      ], "")
    : buildJobRequest({
        customerPubkey: sitzung.publicKey(),
        input: fullPrompt,
        bidMsat: bid * 1000,
        providerPubkey: targetPubkey,
        params: [["tier", tier]],
        extraTags: [...extraTags, ...zusatzTags],
      });
  const auftrag = await buildPrivateJobRequest({
    request, sessionSigner: sitzung, providerPk: targetPubkey, powBits: powJeProvider.get(targetPubkey) ?? 0,
  });
  // Erst merken (letzte Gutschrift, offene Anfrage), dann senden
  if (kanal) await kanal.merke(auftrag.requestId);
  merkeAnfrage(auftrag.requestId, empfaenger, hoechst, !!kanal);
  return auftrag;
}

/** Abbruch-Signal für den laufenden AI-Job (Stop-Button). */
let jobAbort: AbortController | null = null;

async function waitForAnswer(
  requestId: string,
  timeoutMs: number,
  expectedProvider?: string,
  opts: {
    /** Results aus ALLEN diesen Job-Ids akzeptieren (Hedging). */
    extraJobIds?: Set<string>;
    /** Callback für kind-7000-Ablehnungen (für Failover-Logik). */
    onFeedback?: (message: string) => void;
    /** AbortController des Stop-Buttons. */
    signal?: AbortSignal;
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  const seit = Math.floor(Date.now() / 1000) - 120;
  const cache: AntwortCache = new Map();
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return { aborted: true as const };
    const ids = opts.extraJobIds ? [...opts.extraJobIds] : [requestId];
    // Private Antworten (3.2) an unsere Sitzungsschluessel – offene gelten weiter.
    const privat = await privateAntworten(new Set(ids), seit, cache);
    // Feedback-Events (kind 7000): Ablehnung -> Failover. ABER: status=progress
    // ist KEINE Ablehnung (provider arbeitet noch) — weiter warten.
    // Seit 3.2e nur noch versiegelte: Auf eine private Anfrage antwortet ein
    // Knoten ab 3.2c nie offen – eine offene „Antwort“ waere untergeschoben.
    const feedback = privat.rueckmeldungen.filter((e) => e.tags.some((t) => t[0] === "e" && t[1] === requestId));
    if (feedback.length > 0) {
      const statusTag = feedback[0].tags.find((t) => t[0] === "status")?.[1] ?? "";
      const fbMsg = feedback[0].content.replace(/^error:\s*/i, "");
      if (statusTag === "progress") {
        // Progress vom Provider: "tool:web_search" → research-chip + label
        if (fbMsg.startsWith("tool:")) {
          const tool = fbMsg.slice(5);
          const stepKey = /search|browser/i.test(tool) ? "researching"
            : /image|paint/i.test(tool) ? "creating"
            : "thinking";
          advanceJobPipeline(stepKey);
          setTypingLabel(toolLabel(tool));
        } else {
          advanceJobPipeline("thinking");
          setTypingLabel(fbMsg);
        }
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      if (/thinking|processing|working/i.test(fbMsg) && !/^error/i.test(fbMsg)) {
        // Alte Provider ohne status-tag aber klar progressivem Text
        setTypingLabel(t("thinking"));
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      if (isPaymentNoise(fbMsg)) {
        // Payment-Noise von fremden Providern: ignorieren, weiter auf Result warten.
        // (Ein NWC-timeout bei DEM Provider betrifft nicht unseren Job-Flow —
        // wir zahlen per Session/Beleg, nicht via NWC.)
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      opts.onFeedback?.(fbMsg);
      return { ev: feedback[0], parsed: null, providerError: fbMsg };
    }
    // Results aus allen aktiven Jobs (Hedge) akzeptieren:
    const results = privat.ergebnisse;
    if (results.length > 0) {
      // NEU: Nur Antworten vom erwarteten Provider akzeptieren (wenn angegeben).
      // Beim Hedging entfällt dieser Filter — erster Result gewinnt.
      const filtered = expectedProvider && !opts.extraJobIds
        ? results.filter((ev) => ev.pubkey === expectedProvider || ev.pubkey.startsWith(expectedProvider))
        : results;
      if (filtered.length === 0) {
        // Keine Antwort vom erwarteten Provider — weiter warten
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      try {
        return { ev: filtered[0], parsed: parseJobResult(filtered[0]) };
      } catch {
        // Result ohne e/p/amount (z.B. provider-fehler) — als text-antwort zeigen
        return { ev: filtered[0], parsed: { requestId, customerPubkey: "", providerPubkey: filtered[0].pubkey, output: filtered[0].content, amountMsat: 0 } as ReturnType<typeof parseJobResult> };
      }
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return null;
}

async function handleAnswer(ev: import("@freedomstack/protocol").NostrEvent, r: ReturnType<typeof parseJobResult>, frage?: string): Promise<void> {
  hideTyping();
  // Modell-name: aus usage (provider setzt es), sonst aus den provider-caps
  const model = r.usage?.model ?? lastProviderModel ?? undefined;
  // DEBUG: zeige die provider-pubkey, damit wir wissen WER antwortet
  const who = model ? `${model} · ${r.providerPubkey.slice(0, 12)}…` : t("agent.providerKurz", { pk: r.providerPubkey.slice(0, 12) });
  // Abrechnung nach A+ (5.1.3) mit den beim Senden deklarierten Empfaengern –
  // hoechstens das Gebot; die uebrigen Anteile gehen in die Kasse. Ueber den
  // Zahlkanal (4.3d) ist schon bezahlt: dort teilt das Programm auf.
  const kanal = perKanal(r.requestId);
  const abrechnung = kanal ? undefined : await rechneAntwortAb(r.requestId, r.amountMsat);
  // Streaming-Anzeige: buchstabenweise statt ganzer block
  addAiMessageStreaming("ai", r.output, "", who, () => {
    // Frage und Antwort nur im Speicher – fuer den Pruefer, wenn der Nutzer reklamiert und zustimmt (5.6).
    addUsageBubble(r.usage ?? {}, r.amountMsat, r.providerPubkey, ev.id, frage !== undefined ? { frage, antwort: r.output } : undefined, abrechnung);
    // KEIN Zap-Button unter jeder Antwort — das wuerde die UX kaputt machen.
    // Zaps sind nur fuer besondere Antworten (manuell vom Nutzer gewaehlt).
  });
  // Erste Nutzung vermerken: Erst danach fragt die Fuehrung nach Sicherung
  // und Wallet. Vorher haette der Nutzer nichts zu verlieren und keinen Grund.
  localStorage.setItem("freedom.usedOnce", "1");
  void zeigeOnboarding();
  const succSetup = $("#succ-setup");
  if (succSetup) succSetup.onclick = () => void richteNachfolgeEin();
  const succBeat = $("#succ-heartbeat");
  if (succBeat) succBeat.onclick = async () => {
    if (!state.keypair) return;
    const { buildHeartbeat } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildHeartbeat(state.keypair.pk)));
    toast(t("agent.lebenszeichen"));
    void zeigeNachfolge();
  };
  const modelsRefresh = $("#models-refresh");
  if (modelsRefresh) modelsRefresh.onclick = () => void zeigeModelle();
  const modelsSeed = $("#models-seed");
  if (modelsSeed) modelsSeed.onclick = () => void haltevorModell();
  const modelsPub = $("#models-publish");
  if (modelsPub) modelsPub.onclick = () => void kuendigeModellAn();
  const badgeCreate = $("#badge-create");
  if (badgeCreate) badgeCreate.onclick = () => void vergebeAbzeichen();
  void zeigeNachfolge();
  void zeigeModelle();
  void zeigeMitwirkende();
  state.lastProvider = r.providerPubkey;
  // Der Provider teilt seine SOL-Adresse im Ergebnis mit. Nur so bekommt der
  // Kunde eine Empfaengeradresse, die er nicht selbst abtippen muss.
  if (r.solanaAddress) state.lastProviderSolAddress = r.solanaAddress;
  if (r.usage?.model) lastProviderModel = r.usage.model;
  if (kanal || !abrechnung) {
    // Zahlkanal: nur den Preis verbuchen – Lightning zahlt hier nichts
    await kanalAntwort(r.requestId, r.amountLamports);
    // Quittung (5.5b): angekündigt, bis die Kette die Auszahlung zeigt
    void quittungNachKanal(r.providerPubkey, r.requestId, r.amountLamports);
    if (r.amountLamports) toast(t("zahl.kanalBezahlt", { betrag: solText(r.amountLamports) }));
    void refreshQuota();
    resetSendBtn($("#ai-send") as HTMLButtonElement);
    return;
  }
  const sc = ensureSessionClient();
  // Den Anteil des Providers zahlt die Sitzung an seine Lightning-Adresse (5.1.3)
  const { zahlung, grund } = await providerZahlung(r.providerPubkey);
  const charge = await sc.chargeForResult(r.providerPubkey, abrechnung.providerMsat, ev.id, zahlung);
  // Quittung (5.5b): erst mit bezahlter Rechnung und Preimage – über alle Antworten seit der letzten Zahlung
  void quittungNachZahlung(r.providerPubkey, abrechnung.providerMsat, charge);
  updateBudgetBar();
  if (abrechnung.gekappt) toast(t("agent.providerVerlangte", { sats: Math.ceil(r.amountMsat / 1000) }), true);
  if (abrechnung.providerMsat === 0) {
    // Gratis-Job (free-tier/bootstrap) — nichts zu zahlen
  } else if (charge.settled) {
    toast(t("agent.bezahlt", { sats: Math.floor((charge.gezahltMsat ?? 0) / 1000) }));
  } else if (charge.unklar) {
    toast(t("agent.zahlungUnklar"), true);
  } else {
    // Beleg-only: Schuld dokumentiert und versiegelt beim Provider
    toast(zahlung ? t("agent.belegGesammelt", { sats: Math.floor(charge.faelligAbMsat / 1000) }) : t("agent.belegNichtBezahlt", { grund: grund ?? "" }));
  }
  // Gesammelte Anteile zahlen, wo 100 sats je Empfaenger erreicht sind
  void zahleAnteile().then((a) => {
    if (a.unklarMsat > 0) toast(t("agent.anteilUnklar"), true);
  }).catch(() => { /* beim naechsten Mal */ });
  void refreshQuota();
  resetSendBtn($("#ai-send") as HTMLButtonElement);
}

/** Send-Button nach Job-Ende zurücksetzen (Stop-Modus aus). */
function resetSendBtn(btn: HTMLButtonElement): void {
  btn.dataset.running = "";
  btn.classList.remove("stop-mode");
  btn.disabled = false;
  btn.textContent = t("send");
}

async function pollAiAnswer(requestId: string): Promise<void> {
  // Legacy-Pfad (nicht mehr im Hauptflow; askWithFailover ersetzt es)
  const answer = await waitForAnswer(requestId, 120_000);
  if (answer && !("providerError" in answer && answer.providerError) && !("aborted" in answer && answer.aborted)) {
    await handleAnswer(answer.ev, answer.parsed!);
  }
}

export function updateBudgetBar(): void {
  const el = $("#ai-budget");
  const bal = $("#balance");
  if (!state.lastProvider || !state.sessionClient) {
    el.textContent = t("agent.keineSitzung");
    el.className = "mono-sm";
    if (bal) bal.textContent = "— sats";
    return;
  }
  const b = state.sessionClient.budgetState(state.lastProvider);
  if (!b) {
    el.textContent = t("agent.keineSitzung");
    el.className = "mono-sm";
    if (bal) bal.textContent = "— sats";
    return;
  }
  el.textContent = t("agent.sitzung", { bezahlt: Math.floor(b.charged / 1000), max: Math.floor(b.max / 1000), pct: b.pct });
  el.className = b.pct >= 80 ? "mono-sm warn" : "mono-sm";
  // Header-Guthaben: verbleibendes Session-Budget (non-custodial proxy)
  if (bal) {
    const left = Math.floor((b.max - b.charged) / 1000);
    bal.textContent = `${left} sats`;
    bal.className = left < 10 ? "balance warn" : "balance";
  }
  updateSidebarBalances();
}

function addAiMessage(role: "user" | "ai", text: string, meta: string, model?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  // AI-Antworten: Markdown rendern. User: plain (escaped).
  const body = role === "ai" ? renderMarkdown(escapeHtml(text)) : escapeHtml(text);
  // Der Modellname kommt vom Provider (usage.model, Ankuendigung) – nie roh ins HTML.
  const whoLabel = role === "user" ? escapeHtml(t("komm.du")) : `agent${model ? ` · ${escapeHtml(model)}` : ""}`;
  el.innerHTML = `<div class="who">${whoLabel}</div>
    <div class="body">${body}</div>${meta ? `<div class="cost">${escapeHtml(meta)}</div>` : ""}`;
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
  merkeNachricht(role, text, meta, model);
  return el;
}

/**
 * KI über Funk (7.4c3): Auftrag und Weiterleitung ans gemerkte Gateway, über
 * das verbundene Funkgerät. Nur die Frage reist mit – kein Verlauf als Kontext,
 * jedes Byte kostet Sendezeit. Gratis-Tarif heißt Gebot 0.
 */
async function frageUeberFunk(prompt: string, bid: number): Promise<void> {
  const gebot = ($("#ai-tier") as HTMLSelectElement).value === "free" ? 0 : bid;
  hideEmptyState();
  addAiMessage("user", prompt, "");
  ($("#ai-prompt") as HTMLTextAreaElement).value = "";
  try {
    // Erst das Gerät prüfen – sonst wäre eine Gutschrift gemerkt, die nie hinausgeht
    if (!funkGeraetVerbunden()) throw new EigeneMeldung(t("agent.funkKeinGeraet"));
    const { MeshKind, MeshPriority } = await import("@freedomstack/protocol");
    const { eventToMesh } = await import("../../mesh-radio.js");
    await sendeKiUeberFunk(prompt, gebot, (w) => sendeUeberFunk(eventToMesh(w), MeshKind.NostrEvent, t("agent.funkLabel"), MeshPriority.Nachricht));
    addAiMessage("ai", t("agent.funkUnterwegs"), "");
  } catch (e) {
    addAiMessage("ai", fehlerText(e), "");
  }
}

/**
 * Antworten, die über Funk kommen (7.4c2) – oft Minuten später. Über den
 * Zahlkanal nur den Preis verbuchen; Lightning zahlt hier nie (ohne Netz).
 * Eine Rückmeldung (etwa eine Ablehnung) zeigt der Agent als Hinweis.
 */
export function setupFunkAntworten(): void {
  beiFunkAntwort((ev, frage, ergebnis) => void zeigeFunkAntwort(ev, frage, ergebnis));
}

async function zeigeFunkAntwort(ev: NostrEvent, frage: string, ergebnis: boolean): Promise<void> {
  hideEmptyState();
  const meta = t("agent.funkMeta", { frage: [...frage].length > 40 ? [...frage].slice(0, 39).join("") + "…" : frage });
  if (!ergebnis) {
    addAiMessage("ai", t("agent.funkRueckmeldung", { grund: ev.content.replace(/^error:\s*/i, "").slice(0, 200) }), meta);
    return;
  }
  const r = parseJobResult(ev);
  if (perKanal(r.requestId)) await kanalAntwort(r.requestId, r.amountLamports);
  addAiMessage("ai", r.output, meta, r.usage?.model);
}

/** Simuliertes Streaming: zeigt die AI-Antwort buchstabenweise an (typewriter).
 *  Echtes Nostr-Streaming waere komplex (multi-event); so wirkt es lebendig. */
function addAiMessageStreaming(role: "ai", text: string, meta: string, model?: string, onDone?: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  const whoLabel = `agent${model ? ` · ${escapeHtml(model)}` : ""}`;
  el.innerHTML = `<div class="who">${whoLabel}</div><div class="body"></div>${meta ? `<div class="cost">${escapeHtml(meta)}</div>` : ""}`;
  const bodyEl = el.querySelector(".body") as HTMLElement;
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));

  let i = 0;
  const speed = 12; // ms pro zeichen (schneller: nutzer wollen die antwort)
  const tick = () => {
    if (i < text.length) {
      bodyEl.textContent = text.slice(0, ++i);
      stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
      setTimeout(tick, speed);
    } else {
      // fertig: markdown rendern + code-block-copy-buttons aktivieren
      bodyEl.innerHTML = renderMarkdown(escapeHtml(text));
      activateCodeBlocks(bodyEl);
      stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
      merkeNachricht("ai", text, meta, model);
      onDone?.();
    }
  };
  setTimeout(tick, speed);
  return el;
}

/** Claude-Stil ausklappbare Kosten-/Usage-Bubble unter einer AI-Antwort. */
/**
 * Pruefer fuer eine Reklamation waehlen (Schritt 5.6): aus dem eigenen Netz –
 * Kontakte und eigene Provider –, nie aus einer Rangliste des Netzes.
 * null = keiner, undefined = abgebrochen.
 */
async function waehlePruefer(beschuldigt: string): Promise<Pruefer | null | undefined> {
  const kandidaten = netzPruefer(beschuldigt);
  if (kandidaten.length === 0) {
    toast(t("agent.keinPruefer"));
    return null;
  }
  const liste = kandidaten.map((c, i) => `  ${i + 1} = ${c.name} (${t(PRUEFER_ART[c.art])})`).join("\n");
  const wahl = prompt(t("agent.werPrueft", { liste }), "1");
  if (wahl === null) return undefined;
  return kandidaten[Number(wahl) - 1] ?? null;
}

/**
 * Auftrag reklamieren.
 *
 * Bei Swaps liegt das Geld in einem HTLC mit Frist; bei Rechenauftraegen gab
 * es keinen Rueckweg. Die Reklamation schliesst diese Asymmetrie — aber nur,
 * wenn sie dort erreichbar ist, wo der Kunde die schlechte Antwort sieht.
 */
async function reklamiere(
  jobId: string | undefined, providerPk: string, amountMsat: number, frageAntwort?: { frage: string; antwort: string },
): Promise<void> {
  if (!state.keypair || !jobId) {
    toast(t("agent.ohneBezug"), true);
    return;
  }
  const { disputeInfo, buildDispute, buildPrivateDispute, disputeWindowOpen } =
    await import("@freedomstack/protocol");

  if (!confirm(disputeInfo())) return;

  const grund = prompt(t("agent.problem"), "2");
  if (!grund) return;
  const arten = ["nichts_geliefert", "unbrauchbar", "falsches_modell", "abgebrochen"] as const;
  const art = arten[Number(grund) - 1] ?? "unbrauchbar";

  try {
    const w = disputeWindowOpen(Math.floor(Date.now() / 1000) - 60);
    if (!w.open) {
      toast(reklamationsFrist(w), true);
      return;
    }
    const pruefer = await waehlePruefer(providerPk);
    if (pruefer === undefined) return;
    // Frage und Antwort nur mit Zustimmung und nur fuer den Pruefer (5.6).
    const material = pruefer && frageAntwort && confirm(t("agent.materialMitschicken", { name: pruefer.name })) ? frageAntwort : undefined;
    // Vom Sitzungsschluessel wie der Auftrag selbst (3.1) – nicht von der
    // Identitaet – und nur versiegelt an Provider und Pruefer (3.4).
    const sitzung = kiSitzungen.fuer(providerPk);
    // Die Reklamation nennt den Pruefer (5.6) – nur sein Urteil zaehlt, und der Provider sieht, wer es ist.
    const dispute = buildDispute({
      jobId, customerPubkey: sitzung.publicKey(), providerPubkey: providerPk,
      reason: art, amountMsat, note: prompt(t("agent.beschreibung")) ?? "",
      pruefer: pruefer ? [pruefer.pk] : [],
    });
    const empfaenger = [
      { pk: providerPk, powBits: powJeProvider.get(providerPk) ?? 0 },
      ...(pruefer ? [{ pk: pruefer.pk, powBits: pruefer.art === "provider" ? powJeProvider.get(pruefer.pk) ?? 0 : 0 }] : []),
    ];
    const { wraps } = await buildPrivateDispute({ dispute, sessionSigner: sitzung, empfaenger, materialFuerPruefer: material });
    await (await ensurePool()).publish(wraps[0]!);
    if (pruefer) {
      await stelleZu(wraps[1]!, pruefer);
      // Das Urteil kommt an den Sitzungsschluessel – ihn fuer diese Reklamation im Tresor merken.
      const sk = kiSitzungen.schluesselHex(providerPk);
      if (sk) {
        await merkeReklamation({
          jobId, providerPk, pruefer: pruefer.pk, prueferName: pruefer.name, sitzungSk: sk,
          grund: art, betragMsat: amountMsat, at: Math.floor(Date.now() / 1000),
        });
      }
    }
    toast(pruefer ? t("agent.reklamiertMit", { name: pruefer.name, info: reklamationsFrist(w) }) : t("agent.reklamiert", { info: reklamationsFrist(w) }));
  } catch (e) {
    toast(fehlerText(e), true);
  }
}


function addUsageBubble(usage: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  toolCalls?: Array<{ name: string; kind: number; costMsat: number }>;
  sessionTotalMsat?: number;
}, amountMsat: number, providerPk: string, resultEventId?: string, frageAntwort?: { frage: string; antwort: string },
abrechnung?: { providerMsat: number; posten: Array<{ anteil: string; msat: number }> }): void {
  const el = document.createElement("div");
  el.className = "usage-bubble";
  aktualisiereAgentPanel(usage.toolCalls ?? [], usage.sessionTotalMsat);
  // Jedes Werkzeug als eigene Zeile mit Haken — im Entwurf war das der Kern:
  // man sieht auf einen Blick, was der Agent getan hat und was es gekostet hat.
  const haken = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
    stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>`;
  const toolRows = (usage.toolCalls ?? [])
    .map((w) => `<div class="tool-card">
      <span class="tool-check">${haken}</span>
      <span class="tool-name">${escapeHtml(w.name)}</span>
      <span class="tool-cost">${Math.floor(w.costMsat / 1000)} sat</span></div>`)
    .join("");

  // Nimmt Klartext und maskiert selbst – so kann kein Aufrufer es vergessen.
  const zeile = (k: string, v: string): string =>
    `<div class="usage-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`;

  const werkzeugTeil = toolRows
    ? `<div class="tool-list">${toolRows}</div>`
    : "";

  el.innerHTML = `
    <button class="usage-toggle" type="button" aria-expanded="false">
      <span class="tool-check">${haken}</span>
      <span class="usage-title">${escapeHtml(usage.model ?? t("agent.antwort"))}</span>
      <span class="usage-meta">${escapeHtml(t("agent.tokensMeta", { n: ganzeZahl(usage.completionTokens), sat: Math.floor(amountMsat / 1000) }))}</span>
      <span class="usage-chev" aria-hidden="true">›</span>
    </button>
    <div class="usage-body hidden">
      ${werkzeugTeil}
      ${zeile(t("agent.modell"), usage.model ?? "—")}
      ${zeile(t("agent.provider"), pkShort(providerPk))}
      ${zeile(t("agent.tokens"), t("agent.reinRaus", { rein: ganzeZahl(usage.promptTokens), raus: ganzeZahl(usage.completionTokens) }))}
      ${zeile(t("agent.dieseAntwort"), `${Math.floor(amountMsat / 1000)} sat`)}
      ${usage.sessionTotalMsat !== undefined
        ? `<div class="usage-row total"><span>${escapeHtml(t("agent.sitzungGesamt"))}</span><span>${Math.floor(usage.sessionTotalMsat / 1000)} sat</span></div>`
        : ""}
      ${abrechnung && abrechnung.providerMsat > 0 ? aufteilungZeilen(abrechnung, zeile) : ""}
      ${amountMsat > 0 ? `<div class="usage-actions">
        <button class="ghost file-dispute" type="button">${escapeHtml(t("agent.reklamieren"))}</button></div>` : ""}
    </div>`;
  const toggle = el.querySelector<HTMLElement>(".usage-toggle");
  toggle?.addEventListener("click", () => {
    const offen = el.querySelector(".usage-body")?.classList.contains("hidden") === false;
    toggle.setAttribute("aria-expanded", String(offen));
  });
  el.querySelector(".file-dispute")?.addEventListener("click", () => {
    void reklamiere(resultEventId, providerPk, amountMsat, frageAntwort);
  });

  el.querySelector(".usage-toggle")!.addEventListener("click", () => {
    const body = el.querySelector(".usage-body")!;
    const tog = el.querySelector(".usage-toggle")!;
    const open = body.classList.toggle("hidden");
    tog.textContent = t("agent.details", { pfeil: open ? "▸" : "▾", sats: Math.floor(amountMsat / 1000) });
  });
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
}

const ANTEIL_NAME: Record<string, string> = {
  entwicklung: "agent.anteilEntwicklung", relays: "agent.anteilRelays", "werber-kunde": "agent.anteilWerberKunde", "werber-provider": "agent.anteilWerberProvider", hosting: "agent.anteilHosting",
};

/** sats mit bis zu drei Nachkommastellen – Anteile sind oft Bruchteile. */
const satText = (msat: number): string => `${(msat / 1000).toLocaleString(gebietsschema(), { maximumFractionDigits: 3 })} sat`;

/**
 * Wohin diese Antwort geht (A+, 5.1.3): der Anteil des Providers, dann jeder
 * weitere Anteil – gesammelt bis 100 sats je Empfaenger. Ohne Empfaenger
 * bleibt ein Anteil beim Provider. Seit 5.1.2 gibt es keinen Fee-Beweis des
 * Knotens mehr; die App zahlt selbst.
 */
function aufteilungZeilen(a: { providerMsat: number; posten: Array<{ anteil: string; msat: number }> }, zeile: (k: string, v: string) => string): string {
  const weitere = a.posten.map((p) => zeile(ANTEIL_NAME[p.anteil] ? t(ANTEIL_NAME[p.anteil]!) : p.anteil, t("agent.gesammelt", { betrag: satText(p.msat) }))).join("");
  return zeile(t("agent.anDenProvider"), satText(a.providerMsat)) +
    (weitere || zeile(t("agent.weitereAnteile"), t("agent.keinEmpfaenger")));
}

/** Thinking-Orb (wie orbs.jakubantalik.com): animierte Kugel statt Text.
 *  Leichte Canvas-Version (kein npm-Dep). States: working/searching/etc. */
function showTyping(status: string = "thinking"): HTMLElement {
  const el = document.createElement("div");
  el.className = "typing";
  el.id = "ai-typing";
  // Replit-Stil: wachsende Icon-Leiste. Jeder Schritt hängt sein Symbol an,
  // das Label zeigt dynamisch was GERADE passiert (auch provider-feedback).
  el.innerHTML = `
    <div class="step-rail" id="step-rail"></div>
    <div class="step-label"><span class="spinner"></span><span id="step-label-text">${escapeHtml(t(status))}</span></div>`;
  $("#ai-thread").appendChild(el);
  addStepIcon(status);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
  return el;
}

/** Fügt ein Schritt-Icon an die wachsende Leiste an (Replit-Stil).
 *  Klick auf ein Icon zeigt Details zum Schritt (Tooltip + Alert-Label). */
function addStepIcon(stepKey: string): void {
  const rail = document.getElementById("step-rail");
  if (!rail) return;
  const iconFor = (k: string): { svg: string; title: string } => {
    switch (k) {
      case "connecting": return { svg: icon("zap", 12), title: t("agent.schrittVerbinden") };
      case "researching": return { svg: icon("search", 12), title: t("agent.schrittRecherche") };
      case "thinking": return { svg: icon("bot", 12), title: t("agent.schrittModell") };
      case "creating": return { svg: icon("image", 12), title: t("agent.schrittMedien") };
      default: return { svg: icon("wrench", 12), title: k };
    }
  };
  const { svg, title } = iconFor(stepKey);
  const prev = rail.querySelector(".step-ic.active");
  if (prev) { prev.classList.remove("active"); prev.classList.add("done"); }
  const ic = document.createElement("span");
  ic.className = "step-ic active";
  ic.title = title;
  ic.innerHTML = svg;
  ic.addEventListener("click", () => {
    // Klick: Schritt-Erklärung kurz im Label zeigen
    setTypingLabel(title);
  });
  rail.appendChild(ic);
}

/** Tool-Name → lesbares Label für die Schritt-Leiste. */
function toolLabel(tool: string): string {
  if (/web_search/i.test(tool)) return t("agent.suchtWeb");
  if (/browser/i.test(tool)) return t("agent.liestSeiten");
  if (/image/i.test(tool)) return t("agent.erstelltBild");
  if (/video/i.test(tool)) return t("agent.erstelltVideo");
  return `${tool}…`;
}

function advanceJobPipeline(toStatus: string): void {
  addStepIcon(toStatus);
}

/** Update den typing-status (thinking -> researching -> creating). */
function setTypingStatus(status: string): void {
  advanceJobPipeline(status);
  setTypingLabel(t(status));
}

/** Label-Text der typing-Zeile (für live provider-feedback). */
function setTypingLabel(text: string): void {
  const el = document.getElementById("step-label-text");
  if (!el) return;
  // Provider-Namen/Artefakte aus Feedback-Texten säubern: "jeletor is
  // thinking" → "denkt nach…" — der Nutzer will wissen WAS passiert,
  // nicht WER denkt.
  let t2 = text.trim();
  t2 = t2.replace(/^\S+\s+is\s+thinking\s*\.?$/i, t("thinking"));
  t2 = t2.replace(/^[a-z0-9]{6,}\s+is\s+/i, "").replace(/\s*\.?$/, "…");
  if (t2.length > 60) t2 = t2.slice(0, 57) + "…";
  el.textContent = t2;
}

/**
 * Scrollt nur, wenn der Nutzer bereits ganz unten ist. Sobald er hochscrollt,
 * bleibt die Ansicht stehen (lesen ohne Sprung). Rückgabe: war unten?
 */
function stickToBottom(scrollFn?: () => void): boolean {
  const thread = $("#ai-thread");
  if (!thread) return true;
  // .ai-thread IST selbst der scroll-container (overflow-y:auto)
  const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  if (nearBottom && scrollFn) scrollFn();
  return nearBottom;
}

/** Animiert den Orb (pulsierende Blob-Kugel in accent). */
function startOrb(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const accent = "#7BC80A";
  let raf = 0;
  const start = performance.now();
  const draw = () => {
    if (!document.body.contains(canvas)) return; // stop wenn entfernt
    const tsec = (performance.now() - start) / 1000;
    ctx.clearRect(0, 0, 36, 36);
    const cx = 18, cy = 18;
    // 3 pulsierende blob-punkte (orbiting)
    for (let i = 0; i < 3; i++) {
      const ang = tsec * 2.2 + (i * Math.PI * 2) / 3;
      const rad = 8 + Math.sin(tsec * 3 + i) * 2.5;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      const r = 4.5 + Math.sin(tsec * 4 + i * 1.3) * 1.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
      g.addColorStop(0, accent);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, r * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}
function hideTyping(): void {
  document.getElementById("ai-typing")?.remove();
}

/**
 * Preis an jedem Werkzeug-Knopf (8.7): Richtpreis beim Start, danach der
 * guenstigste angebotene – in sats und SOL, per textContent.
 */
function zeigeWerkzeugPreise(angebote: ReadonlyArray<{ tools?: ToolPrice[] }> = []): void {
  const preise = werkzeugPreise(angebote);
  const kurs = aktuellerKurs();
  document.querySelectorAll<HTMLElement>(".tool-chip").forEach((chip) => {
    const preis = preise.get(Number(chip.dataset.tool));
    chip.title = werkzeugPreisText(preis, kurs);
    let el = chip.querySelector<HTMLElement>(".tool-preis");
    if (!el) {
      el = document.createElement("span");
      el.className = "tool-preis";
      chip.append(el);
    }
    // Beide Einheiten am Knopf (Regel 4.4b), die Erklaerung im Tooltip
    el.textContent = preis ? ausMsat(preis.msat, kurs) : t("agent.preisUnbekannt");
  });
}

export function setupToolChips(): void {
  zeigeWerkzeugPreise();
  document.querySelectorAll(".tool-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const el = chip as HTMLElement;
      const kind = Number(el.dataset.tool);
      const name = el.dataset.name!;
      el.classList.toggle("active");
      if (el.classList.contains("active")) {
        selectedTools.push({ kind, name, input: "" });
      } else {
        selectedTools = selectedTools.filter((t) => t.kind !== kind);
      }
      // video-optionen zeigen wenn video-chip aktiv
      const videoActive = selectedTools.some((t) => t.name === "video_gen");
      const opts = document.getElementById("video-opts");
      if (opts) opts.classList.toggle("hidden", !videoActive);
    });
  });
}

/** Empty-State: Beispiel-Prompts klickbar; Empty ausblenden sobald Verlauf da. */
export function setupEmptyState(): void {
  document.querySelectorAll(".ai-example").forEach((b) => {
    b.addEventListener("click", () => {
      const prompt = t((b as HTMLElement).dataset.promptKey ?? "");
      ($("#ai-prompt") as HTMLTextAreaElement).value = prompt;
      ($("#ai-prompt") as HTMLTextAreaElement).focus();
    });
  });
}
function hideEmptyState(): void {
  const e = document.getElementById("ai-empty");
  if (e) e.style.display = "none";
}


/** Angehaengte Datei (multimodal). */
let attachment: { type: string; name: string; dataUrl: string } | null = null;
/** Angeforderte Tools fuer den naechsten Job. */
let selectedTools: Array<{ kind: number; name: string; input: string }> = [];

export function setupAttach(): void {
  const btn = $("#attach-btn");
  const menu = $("#attach-menu");
  const input = $("#attach-input") as HTMLInputElement;
  const status = $("#attach-status");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menu.classList.add("hidden"));

  menu.querySelectorAll("button[data-attach]").forEach((b) => {
    b.addEventListener("click", () => {
      const type = (b as HTMLElement).dataset.attach!;
      menu.classList.add("hidden");
      const accept =
        type === "image" ? "image/*" :
        type === "audio" ? "audio/*" :
        type === "video" ? "video/*" :
        type === "camera" ? "image/*" : "*/*";
      input.accept = accept;
      if (type === "camera") input.setAttribute("capture", "environment");
      else input.removeAttribute("capture");
      input.dataset.atype = type;
      input.click();
    });
  });

  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      attachment = { type: input.dataset.atype ?? "file", name: f.name, dataUrl: String(reader.result) };
      status.textContent = t("agent.angehaengt", { name: f.name });
      status.className = "mono-sm ok";
      if (attachment.type === "image" || attachment.type === "camera") {
        status.innerHTML = `${escapeHtml(f.name)} <img class="attach-thumb" src="${escapeHtml(attachment.dataUrl)}" />`;
      }
    };
    reader.readAsDataURL(f);
    input.value = "";
  });
}
