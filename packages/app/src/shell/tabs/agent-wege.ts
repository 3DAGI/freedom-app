/**
 * Agent › Wege einer Frage ins Netz: Failover über mehrere Provider, Race
 * (Max), Schwarm, Video; Antworten nur versiegelt.
 *
 * Aus tabs/agent.ts verschoben (C-5d) – wörtlich, ohne Logikänderung.
 */
import { KIND_GIFT_WRAP, parseJobResult } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { DEFAULT_MAX_MODE, ScoredProvider, matchRaceProviders } from "../../matchmaking.js";
import { type AntwortCache, oeffneAntworten } from "../../ki-antworten.js";
import { pkShort } from "../../shell-logic.js";
import { ensurePool, ensureSessionClient, findProviders, kiSitzungen, powJeProvider, state } from "../state.js";
import { type KnotenWeg } from "../knoten-weg-ui.js";
import { $, toast } from "../ui.js";
import { buildJobEvent, handleAnswer, jobAbort, keinPrivaterProvider, privatFaehig, waitForAnswer } from "./agent.js";
import { addAiMessage, EigeneMeldung, hideTyping, showAiError } from "./agent-anzeige.js";

/** Sendet den Job an den besten Provider; bei Timeout automatisch der naechste.
 *  maxMode=true: Race — Job an N Provider, schnellster gewinnt (opt-in, Aufpreis). */
export async function askWithFailover(prompt: string, bid: number, tier: "free" | "classic" | "pro", maxMode = false): Promise<void> {
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
export async function privateAntworten(ids: ReadonlySet<string>, seit: number, cache: AntwortCache, quelle?: Pick<KnotenWeg, "query" | "sitzungPk">) {
  // Über den Weg zu meinem Knoten (B-9c2) nur der Schlüssel des Auftrags – sein Relay liefert nur an Angemeldete
  const pks = quelle ? [quelle.sitzungPk] : kiSitzungen.pubkeys();
  if (pks.length === 0) return { ergebnisse: [], rueckmeldungen: [] };
  const umschlaege = await (quelle ?? await ensurePool()).query({ kinds: [KIND_GIFT_WRAP], "#p": pks, since: seit });
  return oeffneAntworten(umschlaege, kiSitzungen, ids, cache);
}

/** Payment-Feedback von fremden Providern (NWC-timeouts etc.) ist KEIN
 *  Job-Fehler — der Antwortfluss darf dadurch nicht abbrechen. */
export function isPaymentNoise(msg: string): boolean {
  return /payment error|nwc timed out|keysend.*(fail|timeout)|invoice.*timeout/i.test(msg);
}

/** video_gen: direkt an ComfyUI (H3), nicht an das LLM. */
export async function generateVideo(prompt: string): Promise<void> {
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
export async function askSwarm(prompt: string, bid: number, tier: "free" | "classic" | "pro"): Promise<void> {
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
