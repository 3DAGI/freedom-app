/**
 * Tab Agent: KI-Aufträge (NIP-90) stellen, Antworten und Belege anzeigen,
 * Modellwahl, lokaler Verlauf, Modelle im Netz und Repositories.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import {
  type ClientFee,
  DEFAULT_CLIENT_FEE_PERCENT,
  KIND_DVM_TEXT_GENERATION,
  MAX_CLIENT_FEE_PERCENT,
  PROTOCOL_FEE_PPM,
  PROTOCOL_POOL_SHARE_PERCENT,
  buildEvent,
  buildJobRequest,
  clientFeePpm,
  clientFeeTag,
  computeFeeSplit,
  parseJobResult,
  signEvent,
} from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { icon } from "../../icons.js";
import { DEFAULT_MAX_MODE, ScoredProvider, matchRaceProviders, maxModeSplit } from "../../matchmaking.js";
import { SessionClient } from "../../session-client.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import {
  richteNachfolgeEin,
  switchTab,
  vergebeAbzeichen,
  zeigeMitwirkende,
  zeigeNachfolge,
  zeigeOnboarding,
} from "../app.js";
import { KIND_DVM_RESULT, ensurePool, ensureSessionClient, findProviders, state } from "../state.js";
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
import { haltevorModell, kuendigeModellAn, zeigeModelle } from "./agent-netz.js";

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
    const providers = await findProviders(($("#ai-tier") as HTMLSelectElement).value);
    // modelle + preise der top-provider sammeln (dedupe, haeufigkeit)
    const counts = new Map<string, { count: number; priceMsat: number; tools: Set<string> }>();
    for (const p of providers.slice(0, 5)) {
      for (const m of p.caps.models ?? []) {
        const cur = counts.get(m) ?? { count: 0, priceMsat: p.caps.textRatePerKTokenMsat ?? 1500, tools: new Set((p.caps.tools ?? []).map((t: any) => t.name ?? String(t))) };
        cur.count += 1;
        counts.set(m, cur);
      }
    }
    const entries = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
    // nemotron zuerst (schnellster, standard)
    entries.sort((a, b) => {
      const na = a[0].includes("nemotron") ? 0 : 1;
      const nb = b[0].includes("nemotron") ? 0 : 1;
      return na - nb || b[1].count - a[1].count;
    });
    (window as unknown as { __modelCatalog?: unknown }).__modelCatalog = entries;

    // Popover-Inhalt: Karten mit Name, Speed-Klasse, Preis/1k tokens, Provider-Count
    const pop = $("#model-popover");
    if (pop) {
      const speedOf = (m: string): { label: string; cls: string } => {
        if (m.includes("nemotron")) return { label: "⚡⚡ schnell", cls: "fast" };
        if (/(\d+)b/.test(m)) {
          const size = Number(RegExp.$1);
          if (size <= 8) return { label: "⚡⚡ schnell", cls: "fast" };
          if (size <= 15) return { label: "⚡ mittel", cls: "mid" };
          return { label: "🐢 tiefgründig", cls: "deep" };
        }
        return { label: "⚡ mittel", cls: "mid" };
      };
      pop.innerHTML = `
        <button type="button" class="model-card ${current === "" ? "selected" : ""}" data-model="">
          <div class="mc-head"><b>Auto</b><span class="mc-speed fast">schnellste</span></div>
          <div class="mc-sub">netz wählt das beste verfügbare modell</div>
        </button>
        ${entries.map(([m, info]) => {
          const sp = speedOf(m);
          const short = m.split(":")[0];
          const satsPer1k = Math.ceil(info.priceMsat / 1000);
          // SOL-preis: SOL_PRICE_SATS env (provider-seite) oder default 150000 sats/SOL
          const solPriceSats = Number((window as unknown as { FREEDOM_SOL_PRICE_SATS?: number }).FREEDOM_SOL_PRICE_SATS ?? 150_000);
          const solPer1k = (satsPer1k / solPriceSats).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
          return `<button type="button" class="model-card ${current === m ? "selected" : ""}" data-model="${escapeHtml(m)}">
            <div class="mc-head"><b>${escapeHtml(short)}</b><span class="mc-speed ${sp.cls}">${sp.label}</span></div>
            <div class="mc-sub">~${satsPer1k} sats ≈ ${solPer1k} SOL /1k tokens · ${info.count} provider${info.tools.size ? " · " + icon("wrench", 11) : ""}</div>
          </button>`;
        }).join("")}`;
    }
    // button-label aktualisieren
    updateModelBtnLabel();
  } catch { /* dropdown bleibt bei auto */ }
}

/** Button-Label aus aktueller Modell-Wahl. */
function updateModelBtnLabel(): void {
  const sel = $("#ai-model") as HTMLInputElement | null;
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  if (!sel || !btn) return;
  const v = sel.value;
  btn.innerHTML = v
    ? `${icon("bot", 14)} ${escapeHtml(v.split(":")[0])}`
    : `${icon("bot", 14)} auto (schnellste)`;
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
    toast(sel.value ? `modell: ${sel.value.split(":")[0]}` : "modell: auto");
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
    return JSON.parse(localStorage.getItem("freedom.agentHistory") ?? "[]") as AgentVerlauf[];
  } catch {
    return [];
  }
}

function speichereVerlaeufe(v: AgentVerlauf[]): void {
  // Obergrenze: Ein unbegrenzter Verlauf fuellt den Speicher, und der ist im
  // Browser knapp — bei Ueberlauf verliert die App ganz andere Daten.
  try {
    localStorage.setItem("freedom.agentHistory", JSON.stringify(v.slice(0, 40)));
  } catch { /* Speicher voll — Verlauf ist verzichtbar */ }
}

/** Wird von addAiMessage aufgerufen. Beim Wiederherstellen nicht erneut speichern. */
function merkeNachricht(role: "user" | "ai", text: string, meta: string, model?: string): void {
  if (verlaufWiederherstellen) return;
  const alle = ladeVerlaeufe();
  if (!aktuellerVerlauf) {
    if (role !== "user") return;
    aktuellerVerlauf = {
      id: String(Date.now()),
      title: text.replace(/\s+/g, " ").trim().slice(0, 60) || "Aufgabe",
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
    box.innerHTML = `<p class="muted mono-sm history-empty">Noch keine Aufgaben.</p>`;
    return;
  }
  const heute = new Date().toDateString();
  let letzteGruppe = "";
  box.innerHTML = alle.map((v) => {
    const d = new Date(v.at * 1000);
    const gruppe = d.toDateString() === heute ? "Heute" : "Früher";
    const kopf = gruppe !== letzteGruppe ? `<div class="history-group">${gruppe}</div>` : "";
    letzteGruppe = gruppe;
    const aktiv = aktuellerVerlauf?.id === v.id ? " active" : "";
    return `${kopf}<button class="history-item${aktiv}" data-hid="${escapeHtml(v.id)}" type="button">
      <span class="history-title">${escapeHtml(v.title)}</span>
      <span class="history-sub">${v.messages.length} Nachrichten</span></button>`;
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
  const t = document.getElementById("agent-tools");
  if (t && tools.length > 0) {
    t.classList.remove("muted");
    t.innerHTML = tools.map((x) => `<div class="panel-row">
      <span class="panel-check">${markSvgCheck()}</span>
      <span class="panel-name">${escapeHtml(x.name)}</span>
      <span class="panel-meta">${Math.floor(x.costMsat / 1000)} sat</span></div>`).join("");
  }
  const c = document.getElementById("agent-cost");
  if (c && sessionTotalMsat !== undefined) {
    c.classList.remove("muted");
    c.innerHTML = `<div class="panel-row"><span class="panel-name">Diese Sitzung</span>
      <span class="panel-meta">${Math.floor(sessionTotalMsat / 1000)} sat</span></div>`;
  }
}

// ------------------------------------------------------------- KI-Tab

export function updateFeePreview(): void {
  const bid = Number(($("#ai-bid") as HTMLInputElement).value);
  const split = computeFeeSplit(bid * 1000, {
    totalFeePpm: PROTOCOL_FEE_PPM,
    poolSharePercent: PROTOCOL_POOL_SHARE_PERCENT,
  });
  const p = Math.floor(split.recipientMsat / 1000);
  const pool = Math.floor(split.poolMsat / 1000);
  const proto = Math.floor(split.protocolMsat / 1000);
  const rest = bid - p - pool - proto;
  // Ehrlich anzeigen: bei kleinen Betraegen rundet 1% auf 0 sats ab.
  // Den Rundungsrest zeigen, damit die Summe immer stimmt (kein "verschwundener sat").
  $("#ai-fee-preview").textContent =
    rest > 0
      ? `${bid} sats → provider ${p} / pool ${pool} / protokoll ${proto} (+${rest} rundung)`
      : `${bid} sats → provider ${p} / pool ${pool} / protokoll ${proto}`;
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
  el.textContent = `~${estTokens} tokens ≈ ${estSats} sats`;
}

// ------------------------------------------------------------- Fehler-UX (Phase 1.2)
/** Mappt technische Fehler auf verstaendliche Ursachen. */
function explainError(e: unknown): string {
  const m = ((e as Error)?.message ?? String(e)).toLowerCase();
  if (m.includes("relay") || m.includes("websocket") || m.includes("eose") || m.includes("pool")) return "relay-verbindung fehlgeschlagen — internet pruefen oder spaeter erneut versuchen";
  if (m.includes("kein provider") || m.includes("provider") && m.includes("antwort")) return "kein provider erreichbar — alle kandidaten haben ein timeout (gx10 offline?)";
  if (m.includes("bid zu niedrig") || m.includes("kein free-tier")) return "gebot zu niedrig und kein free-kontingent mehr — bid erhöhen oder morgen wieder gratis testen";
  if (m.includes("identitaet") || m.includes("keypair") || m.includes("session")) return "identitaet fehlt — bitte neu einloggen";
  if (m.includes("timeout")) return "timeout — provider zu langsam oder offline";
  if (m.includes("comfy")) return "comfyui nicht erreichbar (port 8188) — video/image-gen braucht laufendes comfyui";
  if (m.includes("fetch") || m.includes("network") || m.includes("failed to fetch")) return "netzwerk-fehler — verbindung zum relay/server unterbrochen";
  return (e as Error)?.message ?? String(e);
}

/** Baut eine Fehler-Bubble mit Ursache + Retry-Button. */
function showAiError(e: unknown, retryPrompt: string, retryBid: number, retryTier: "free" | "classic" | "pro", retryMode: { max?: boolean; swarm?: boolean } = {}): void {
  hideTyping();
  const cause = explainError(e);
  const el = document.createElement("div");
  el.className = "bubble ai error";
  el.innerHTML = `<div class="who">⚠️ fehler</div>
    <div class="body">Ursache: <b>${escapeHtml(cause)}</b></div>`;
  const btn = document.createElement("button");
  btn.className = "btn-retry";
  btn.textContent = "↻ erneut versuchen";
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
  btn.dataset.running = "1";
  btn.classList.add("stop-mode");
  btn.textContent = "■ Stop";
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
        toast("gratis-kontingent aufgebraucht — erst guthaben einzahlen", true);
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
  const candidates = await findProviders(tier);

  if (maxMode) {
    return askRace(prompt, bid, tier, candidates);
  }

  const pubkeyList = candidates.map((c) => c.caps.pubkey);
  // Bekannten Session-Provider zuerst (Kontinuitaet), dann beste Matches
  if (state.lastProvider && sc.activeFor(state.lastProvider) && !pubkeyList.includes(state.lastProvider)) {
    pubkeyList.unshift(state.lastProvider);
  }
  // Fallback: ohne Matchmaking ein offener Bid-Job (jeder Provider darf antworten)
  const targets: Array<string | null> = pubkeyList.length > 0 ? pubkeyList.slice(0, 3) : [null];

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
    const ev = buildJobEvent(prompt, bid, tier, target, sc);
    await pool.publish(ev);
    activeJobIds.add(ev.id);

    const answer = await waitForAnswer(ev.id, timeoutMs, target ?? undefined, {
      extraJobIds: activeJobIds,
      onFeedback: (msg) => { lastFeedbackError = msg; },
      signal: jobAbort?.signal,
    });
    if (answer) {
      if ("providerError" in answer && answer.providerError) {
        // Ablehnung durch DIESEN Provider → Failover zum nächsten (die meisten
        // Ablehnungen sind provider-spezifisch: quota, bootstrap, preis).
        lastFeedbackError = answer.providerError;
        toast(`provider lehnt ab (${answer.providerError.slice(0, 50)}) — naechster…`);
        continue; // Failover!
      }
      if (answer.aborted) {
        addAiMessage("ai", "[abgebrochen]", "");
        return;
      }
      await handleAnswer(answer.ev, answer.parsed!);
      return;
    }
    if (i < targets.length - 1) {
      // kein Feedback, nur langsam → Hedge: nächster Provider bekommt ihn JETZT,
      // der aktuelle bleibt aktiv (seine Antwort wird via activeJobIds noch
      // akzeptiert).
      toast(`provider ${pkShort(target ?? "")} langsam — hedging zu naechstem…`);
    }
  }
  // Alle Kandidaten versagt (Timeout oder Ablehnung):
  showAiError(
    new Error(lastFeedbackError || "kein provider im netz geantwortet"),
    prompt, bid, tier,
  );
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
  addAiMessage("ai", `[video] wird generiert (${size.width}×${size.height}, ~${dur}s) — das dauert ~1-2 min`, "");
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
          addAiMessage("ai", `✅ video fertig: <a href="${base}/view?filename=${encodeURIComponent(fname)}" target="_blank">${fname}</a>`, "");
          return;
        }
      }
      if (entry?.status?.status_str === "error") {
        addAiMessage("ai", `(video-fehler: ${entry.status.messages?.find((m: string[]) => m[0] === "execution_error")?.[1]?.exception_message ?? "unbekannt"})`, "");
        return;
      }
    }
    addAiMessage("ai", "(video-timeout — versuch es kuerzer oder spaeter)", "");
  } catch (e) {
    addAiMessage("ai", `(video-fehler: ${(e as Error).message})`, "");
  }
}

/** MAX MODE: Race — Job an N Provider, schnellster gewinnt. Opt-in (Aufpreis). */
async function askRace(prompt: string, bid: number, tier: "free" | "classic" | "pro", candidates: ScoredProvider[]): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  const racers = matchRaceProviders(candidates, tier, DEFAULT_MAX_MODE);
  if (racers.length === 0) {
    showAiError(new Error("kein provider im tier 'max' erreichbar"), prompt, bid, tier, { max: true });
    return;
  }
  const split = maxModeSplit(bid * 1000);
  toast(`max mode: ${racers.length} provider racen — gewinner ${Math.floor(split.winnerMsat / 1000)} sats, je verlierer ${Math.floor(split.loserMsatEach / 1000)}`);

  // Job an ALLE racer gleichzeitig (race-tag + p-tag pro provider)
  const jobs = racers.map((r) => {
    const ev = buildJobEvent(prompt, bid, tier, r.caps.pubkey, sc);
    ev.tags.push(["race", "1"]);
    // re-sign wegen neuem tag
    return signEvent({ pubkey: ev.pubkey, kind: ev.kind, tags: ev.tags, content: ev.content, created_at: ev.created_at }, state.keypair!.sk);
  });
  for (const j of jobs) await pool.publish(j);

  // Erste Antwort gewinnt
  const ids = new Set(jobs.map((j) => j.id));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const results = await pool.query({ kinds: [KIND_DVM_RESULT], limit: 20 });
    const hit = results.find((ev) => ids.has(ev.tags.find((t) => t[0] === "e")?.[1] ?? ""));
    if (hit) {
      let r: ReturnType<typeof parseJobResult>;
      try {
        r = parseJobResult(hit);
      } catch {
        r = { requestId: hit.id, customerPubkey: "", providerPubkey: hit.pubkey, output: hit.content, amountMsat: 0 } as ReturnType<typeof parseJobResult>;
      }
      const winner = r.providerPubkey;
      toast(`${pkShort(winner)} gewinnt das race`);
      await handleAnswer(hit, r);
      return;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  hideTyping();
  showAiError(new Error("max mode: kein racer geantwortet"), prompt, bid, tier, { max: true });
}

/** SWARM: N Responder antworten, Judge waehlt/synthetisiert die beste. */
async function askSwarm(prompt: string, bid: number, tier: "free" | "classic" | "pro"): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  // Swarm = lokaler Provider mit beiden Modellen (nemotron + qwen3.8:27b)
  // Wir senden einen Job mit ["swarm", "1"] tag — der Provider erkennt das und nutzt beide Modelle
  const candidates = await findProviders(tier);
  const target = candidates[0]?.caps.pubkey ?? null; // Erster Provider (lokaler GX10)
  const btn = $("#ai-send") as HTMLButtonElement;
  if (!target) {
    showAiError(new Error("kein provider fuer swarm — freedomstack-node laeuft nicht"), prompt, bid, tier, { swarm: true });
    return;
  }

  toast(`swarm: beide modelle (nemotron + qwen3.8:27b) denken parallel…`);
  const ev = buildJobEvent(prompt, bid, tier, target, sc);
  ev.tags.push(["swarm", "1"]); // Tag fuer swarm-modus im provider
  await pool.publish(ev);
  const answer = await waitForAnswer(ev.id, 120_000, target);
  if (answer) {
    if ("providerError" in answer && answer.providerError) {
      showAiError(new Error(answer.providerError), prompt, bid, tier, { swarm: true });
      return;
    }
    if (answer.aborted) { addAiMessage("ai", "[abgebrochen]", ""); return; }
    await handleAnswer(answer.ev, answer.parsed!);
    return;
  }

  hideTyping();
  showAiError(new Error("swarm: provider keine antwort — timeout"), prompt, bid, tier, { swarm: true });
}

/** Modellwechsel-Summary: bei Tier-Wechsel mit Verlauf eine kompakte
 *  Zusammenfassung als Kontext einfuegen (wie Claude bei Modellwechsel).
 *  Gibt die Summary zurueck, die als Kontext-Praefix an den Job geht. */
let lastTier: string | null = null;
let pendingContextSummary = "";
function maybeInsertModelSwitchSummary(newTier: string): void {
  const thread = $("#ai-thread");
  const hasHistory = thread.querySelectorAll(".bubble").length > 0;
  pendingContextSummary = "";
  if (lastTier && lastTier !== newTier && hasHistory) {
    // Sammle bisherige Nachrichten als kompakten Kontext
    const msgs = Array.from(thread.querySelectorAll(".bubble .txt")).map((el) => el.textContent ?? "").filter(Boolean);
    const summary = msgs.slice(-8).join("\n").slice(0, 800);
    pendingContextSummary = `[Bisheriger Verlauf, kompakt]:\n${summary}\n\n[Neue Nachricht]:\n`;
    const note = document.createElement("div");
    note.className = "model-switch";
    note.innerHTML = `<div class="model-switch-inner">⇄ modell gewechselt zu <b>${escapeHtml(newTier)}</b> — kontext wird mitgegeben (${msgs.length} nachrichten)</div>`;
    thread.appendChild(note);
    stickToBottom(() => note.scrollIntoView({ behavior: "smooth", block: "end" }));
  }
  lastTier = newTier;
}

/** Einmal pro Sitzung: KI-Anfragen sind derzeit oeffentlich lesbar (Schritt 3.1 behebt das). */
function hinweisKiOeffentlich(): void {
  try {
    if (sessionStorage.getItem("freedom.hinweis.kiOeffentlich")) return;
    sessionStorage.setItem("freedom.hinweis.kiOeffentlich", "1");
    toast("Hinweis: KI-Anfragen sind derzeit öffentlich lesbar – bitte keine vertraulichen Daten senden.");
  } catch {
    // Ohne sessionStorage (z. B. im Test) kein Hinweis – die Anfrage selbst laeuft weiter.
  }
}

function buildJobEvent(
  prompt: string,
  bid: number,
  tier: string,
  targetPubkey: string | null,
  sc: SessionClient,
): import("@freedomstack/protocol").NostrEvent {
  hinweisKiOeffentlich();
  if (!state.keypair) throw new Error("no keypair");
  // Modellwechsel: Verlauf-Summary als Kontext-Praefix (KV-cache-Ersatz)
  const fullPrompt = pendingContextSummary ? pendingContextSummary + prompt : prompt;
  // Extra-Tags: Anhang (multimodal) + angeforderte Tools + gewuenschtes Modell
  const extraTags: string[][] = [];

  // CLIENT-GEBUEHR — offen deklariert, nicht im Protokoll versteckt.
  //
  // Der Entwickler-Anteil lag frueher im Protokoll: Jeder Provider fuehrte an
  // eine feste Adresse ab, die er nicht aendern konnte. Damit gab es einen
  // Betreiber, egal was die README sagte. Jetzt deklariert dieser Client seine
  // Gebuehr selbst — sichtbar, gedeckelt, und von einem Fork entfernbar. Genau
  // diese Entfernbarkeit ist der Beweis, dass niemand das Protokoll kontrolliert.
  const clientFee = aktiveClientGebuehr();
  if (clientFee) extraTags.push(clientFeeTag(clientFee));
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
  const useSession = targetPubkey && sc.activeFor(targetPubkey);
  if (useSession) {
    return signEvent(
      buildEvent(state.keypair.pk, KIND_DVM_TEXT_GENERATION, [
        ["i", fullPrompt, "text"],
        ...sc.jobTags(targetPubkey, bid * 1000),
        ["tier", tier],
        ["p", targetPubkey],
        ...extraTags,
      ], ""),
      state.keypair.sk,
    );
  }
  return signEvent(
    buildJobRequest({
      customerPubkey: state.keypair.pk,
      input: fullPrompt,
      bidMsat: bid * 1000,
      providerPubkey: targetPubkey ?? undefined,
      params: [["tier", tier]],
      extraTags,
    }),
    state.keypair.sk,
  );
}

/**
 * Die Gebuehr dieses Clients.
 *
 * Der Nutzer kann sie in den Einstellungen auf 0 setzen. Das ist kein Fehler
 * im Design, sondern der Punkt: Eine Gebuehr, die man nicht abschalten kann,
 * ist eine Steuer — und wer eine Steuer erhebt, ist ein Betreiber.
 */
function aktiveClientGebuehr(): ClientFee | null {
  const gespeichert = localStorage.getItem("freedom.clientfee.percent");
  const percent = gespeichert !== null ? Number(gespeichert) : DEFAULT_CLIENT_FEE_PERCENT;
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return {
    recipient: CLIENT_FEE_RECIPIENT,
    ppm: clientFeePpm(Math.min(percent, MAX_CLIENT_FEE_PERCENT)),
    clientName: "FreedomStack App",
  };
}

/** Empfaenger der Client-Gebuehr dieser App. */
const CLIENT_FEE_RECIPIENT =
  (window as unknown as { FREEDOM_CLIENT_FEE_LUD16?: string }).FREEDOM_CLIENT_FEE_LUD16
  ?? "freedomstack@walletofsatoshi.com";

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
  const pool = await ensurePool();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return { aborted: true as const };
    // Feedback-Events (kind 7000): Ablehnung -> Failover. ABER: status=progress
    // ist KEINE Ablehnung (provider arbeitet noch) — weiter warten.
    const feedback = await pool.query({ kinds: [7000], "#e": [requestId], limit: 5 });
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
        setTypingLabel("denkt nach…");
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
    const ids = opts.extraJobIds ? [...opts.extraJobIds] : [requestId];
    const results = await pool.query({ kinds: [KIND_DVM_RESULT], "#e": ids });
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

async function handleAnswer(ev: import("@freedomstack/protocol").NostrEvent, r: ReturnType<typeof parseJobResult>): Promise<void> {
  hideTyping();
  // Modell-name: aus usage (provider setzt es), sonst aus den provider-caps
  const model = r.usage?.model ?? lastProviderModel ?? undefined;
  // DEBUG: zeige die provider-pubkey, damit wir wissen WER antwortet
  const who = model ? `${model} · ${r.providerPubkey.slice(0, 12)}…` : `provider ${r.providerPubkey.slice(0, 12)}…`;
  // Streaming-Anzeige: buchstabenweise statt ganzer block
  addAiMessageStreaming("ai", r.output, "", who, () => {
    addUsageBubble(r.usage ?? {}, r.amountMsat, r.providerPubkey, ev.id);
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
    const { buildHeartbeat, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildHeartbeat(state.keypair.pk), state.keypair.sk));
    toast("Lebenszeichen gesendet — laufende Vorgänge sind abgebrochen");
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
  const sc = ensureSessionClient();
  const charge = await sc.chargeForResult(r.providerPubkey, r.amountMsat, ev.id);
  updateBudgetBar();
  if (r.amountMsat === 0) {
    // Gratis-Job (free-tier/bootstrap) — kein settlement nötig
  } else if (charge.settled) {
    toast(`settled: ${Math.floor(r.amountMsat / 1000)} sats via keysend`);
  } else {
    // Beleg-only: Schuld dokumentiert, Zahlung gebündelt sobald wallet verbunden
    const due = Math.floor(charge.remainingMsat / 1000);
    toast(`beleg gespeichert — zahlung gebündelt später (wallet optional)`);
    console.log(`[session] unsettled debt: ${due} sats remaining`);
  }
  void refreshQuota();
  resetSendBtn($("#ai-send") as HTMLButtonElement);
}

/** Send-Button nach Job-Ende zurücksetzen (Stop-Modus aus). */
function resetSendBtn(btn: HTMLButtonElement): void {
  btn.dataset.running = "";
  btn.classList.remove("stop-mode");
  btn.disabled = false;
  btn.textContent = "Anfragen";
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
    el.textContent = "Noch keine Sitzung. Die erste Anfrage startet eine.";
    el.className = "mono-sm";
    if (bal) bal.textContent = "— sats";
    return;
  }
  const b = state.sessionClient.budgetState(state.lastProvider);
  if (!b) {
    el.textContent = "Noch keine Sitzung. Die erste Anfrage startet eine.";
    el.className = "mono-sm";
    if (bal) bal.textContent = "— sats";
    return;
  }
  el.textContent = `session: ${Math.floor(b.charged / 1000)}/${Math.floor(b.max / 1000)} sats (${b.pct}%)`;
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
  const whoLabel = role === "user" ? "du" : `agent${model ? ` · ${escapeHtml(model)}` : ""}`;
  el.innerHTML = `<div class="who">${whoLabel}</div>
    <div class="body">${body}</div>${meta ? `<div class="cost">${escapeHtml(meta)}</div>` : ""}`;
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
  merkeNachricht(role, text, meta, model);
  return el;
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
 * Auftrag reklamieren.
 *
 * Bei Swaps liegt das Geld in einem HTLC mit Frist; bei Rechenauftraegen gab
 * es keinen Rueckweg. Die Reklamation schliesst diese Asymmetrie — aber nur,
 * wenn sie dort erreichbar ist, wo der Kunde die schlechte Antwort sieht.
 */
async function reklamiere(
  jobId: string | undefined, providerPk: string, amountMsat: number,
): Promise<void> {
  if (!state.keypair || !jobId) {
    toast("Ohne Bezug zur Antwort nicht reklamierbar", true);
    return;
  }
  const { disputeInfo, buildDispute, disputeWindowOpen, signEvent: se } =
    await import("@freedomstack/protocol");

  if (!confirm(disputeInfo())) return;

  const grund = prompt(
    "Was war das Problem?\n" +
    "  1 = gar keine Antwort\n" +
    "  2 = Antwort unbrauchbar\n" +
    "  3 = anderes Modell als vereinbart\n" +
    "  4 = mittendrin abgebrochen",
    "2",
  );
  if (!grund) return;
  const arten = ["nichts_geliefert", "unbrauchbar", "falsches_modell", "abgebrochen"] as const;
  const art = arten[Number(grund) - 1] ?? "unbrauchbar";

  try {
    const w = disputeWindowOpen(Math.floor(Date.now() / 1000) - 60);
    if (!w.open) {
      toast(w.message, true);
      return;
    }
    await (await ensurePool()).publish(se(buildDispute({
      jobId, customerPubkey: state.keypair.pk, providerPubkey: providerPk,
      reason: art, amountMsat, note: prompt("Kurze Beschreibung (öffentlich):") ?? "",
    }), state.keypair.sk));
    toast(`Reklamiert. ${w.message}`);
  } catch (e) {
    toast((e as Error).message, true);
  }
}


function addUsageBubble(usage: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  toolCalls?: Array<{ name: string; kind: number; costMsat: number }>;
  sessionTotalMsat?: number;
}, amountMsat: number, providerPk: string, resultEventId?: string): void {
  const el = document.createElement("div");
  el.className = "usage-bubble";
  aktualisiereAgentPanel(usage.toolCalls ?? [], usage.sessionTotalMsat);
  // Jedes Werkzeug als eigene Zeile mit Haken — im Entwurf war das der Kern:
  // man sieht auf einen Blick, was der Agent getan hat und was es gekostet hat.
  const haken = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
    stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>`;
  const toolRows = (usage.toolCalls ?? [])
    .map((t) => `<div class="tool-card">
      <span class="tool-check">${haken}</span>
      <span class="tool-name">${escapeHtml(t.name)}</span>
      <span class="tool-cost">${Math.floor(t.costMsat / 1000)} sat</span></div>`)
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
      <span class="usage-title">${escapeHtml(usage.model ?? "Antwort")}</span>
      <span class="usage-meta">${ganzeZahl(usage.completionTokens)} Tokens · ${Math.floor(amountMsat / 1000)} sat</span>
      <span class="usage-chev" aria-hidden="true">›</span>
    </button>
    <div class="usage-body hidden">
      ${werkzeugTeil}
      ${zeile("Modell", usage.model ?? "—")}
      ${zeile("Provider", pkShort(providerPk))}
      ${zeile("Tokens", `${ganzeZahl(usage.promptTokens)} rein, ${ganzeZahl(usage.completionTokens)} raus`)}
      ${zeile("Diese Antwort", `${Math.floor(amountMsat / 1000)} sat`)}
      ${usage.sessionTotalMsat !== undefined
        ? `<div class="usage-row total"><span>Sitzung gesamt</span><span>${Math.floor(usage.sessionTotalMsat / 1000)} sat</span></div>`
        : ""}
      ${amountMsat > 0 ? `<div class="usage-actions">
        <button class="ghost verify-fee" type="button">Zahlung prüfen</button>
        <button class="ghost file-dispute" type="button">Reklamieren</button></div>
      <div class="fee-verdict mono-sm"></div>` : ""}
    </div>`;
  // Der Fee-Beweis war gebaut, aber unsichtbar. Er ist das einzige Merkmal,
  // das ein zentraler Anbieter prinzipiell nicht bieten kann — und lag brach.
  const toggle = el.querySelector<HTMLElement>(".usage-toggle");
  toggle?.addEventListener("click", () => {
    const offen = el.querySelector(".usage-body")?.classList.contains("hidden") === false;
    toggle.setAttribute("aria-expanded", String(offen));
  });
  el.querySelector(".verify-fee")?.addEventListener("click", () => {
    void pruefeZahlung(el, resultEventId, amountMsat);
  });
  el.querySelector(".file-dispute")?.addEventListener("click", () => {
    void reklamiere(resultEventId, providerPk, amountMsat);
  });

  el.querySelector(".usage-toggle")!.addEventListener("click", () => {
    const body = el.querySelector(".usage-body")!;
    const tog = el.querySelector(".usage-toggle")!;
    const open = body.classList.toggle("hidden");
    tog.textContent = `${open ? "▸" : "▾"} details · ${Math.floor(amountMsat / 1000)} sats`;
  });
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
}

/**
 * Prueft den Fee-Beweis zu einer Antwort.
 *
 * Zeigt, wohin das Geld gegangen ist — und was davon BELEGT ist. Der
 * Unterschied ist wichtig: Lightning hat kein oeffentliches Ledger, ohne
 * Preimage ist eine Zahlung angekuendigt, nicht bewiesen. Ein Knopf, der
 * "alles in Ordnung" sagt, obwohl er es nicht wissen kann, waere schlimmer
 * als gar keiner.
 */
async function pruefeZahlung(
  bubble: HTMLElement,
  resultEventId: string | undefined,
  amountMsat: number,
): Promise<void> {
  const out = bubble.querySelector(".fee-verdict") as HTMLElement | null;
  if (!out) return;
  if (!resultEventId) {
    out.textContent = "Kein Bezug zur Antwort — nicht prüfbar.";
    return;
  }

  out.textContent = "suche Beleg …";
  try {
    const { verifyFeeProof, KIND_FEE_PROOF, clientFeePpm } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_FEE_PROOF], "#e": [resultEventId], limit: 5 });

    if (evs.length === 0) {
      out.innerHTML =
        `<span class="warn">Noch kein Beleg veröffentlicht.</span><br>` +
        `<span class="muted">Provider veröffentlichen ihn nach der Abrechnung. ` +
        `Fehlt er dauerhaft, hat der Provider die Fee nicht abgeführt.</span>`;
      return;
    }

    // Die Client-Gebuehr folgt nicht aus dem Protokoll — sie stand in unserem
    // eigenen Job-Event, also kennen wir sie.
    const fee = aktiveClientGebuehr();
    const v = verifyFeeProof(evs[0], {
      clientFeeMsat: fee ? Math.floor((amountMsat * fee.ppm) / 1_000_000) : 0,
    });
    void clientFeePpm;

    const zeilen = v.legs.map((l) => {
      const farbe = l.status === "settled" ? "ok" : l.status === "invalid" ? "err" : "warn";
      const marke = l.status === "settled" ? "belegt" : l.status === "invalid" ? "FEHLER" : "angekündigt";
      return `<div class="usage-row"><span>${escapeHtml(l.leg)}</span>` +
        `<span class="${farbe}">${(l.amountMsat / 1000).toFixed(2)} sats · ${marke}</span></div>`;
    }).join("");

    out.innerHTML =
      `<span class="${v.ok ? "ok" : "err"}">${escapeHtml(v.summary)}</span>${zeilen}` +
      (v.legs.some((l) => l.status === "announced")
        ? `<div class="muted" style="margin-top:4px">„Angekündigt" heißt: rechnerisch korrekt, ` +
          `aber ohne Preimage nicht beweisbar. Lightning hat kein öffentliches Ledger.</div>`
        : "");
  } catch (e) {
    out.textContent = `Prüfung fehlgeschlagen: ${(e as Error).message}`;
  }
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
      case "connecting": return { svg: icon("zap", 12), title: "Verbinde mit dem Provider-Netz" };
      case "researching": return { svg: icon("search", 12), title: "Recherchiert online (web_search / browser)" };
      case "thinking": return { svg: icon("bot", 12), title: "Modell verarbeitet die Anfrage" };
      case "creating": return { svg: icon("image", 12), title: "Erstellt Medien (Bild/Video)" };
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
  if (/web_search/i.test(tool)) return "sucht im web…";
  if (/browser/i.test(tool)) return "liest webseiten…";
  if (/image/i.test(tool)) return "erstellt bild…";
  if (/video/i.test(tool)) return "erstellt video…";
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
  t2 = t2.replace(/^\S+\s+is\s+thinking\s*\.?$/i, "denkt nach…");
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

export function setupToolChips(): void {
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
      const prompt = (b as HTMLElement).dataset.prompt ?? "";
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
      status.textContent = `${f.name} angehängt`;
      status.className = "mono-sm ok";
      if (attachment.type === "image" || attachment.type === "camera") {
        status.innerHTML = `${escapeHtml(f.name)} <img class="attach-thumb" src="${escapeHtml(attachment.dataUrl)}" />`;
      }
    };
    reader.readAsDataURL(f);
    input.value = "";
  });
}
