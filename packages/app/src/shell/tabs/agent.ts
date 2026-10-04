/**
 * Tab Agent: Frage stellen (`askAi()`), Auftrag bauen, auf die Antwort
 * warten und sie abrechnen, KI über Funk. Modellwahl, Verlauf, Wege, Anzeige und
 * Eingabe stehen seit C-5d in eigenen Modulen (`modellwahl.ts`, `agent-verlauf.ts`,
 * `agent-wege.ts`, `agent-anzeige.ts`, `agent-eingabe.ts`).
 */
import { KIND_DVM_TEXT_GENERATION, type NostrEvent, buildEvent, buildJobRequest, buildPrivateJobRequest, mitBesitzerNachweis, parseJobResult } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { ScoredProvider } from "../../matchmaking.js";
import { type AntwortCache } from "../../ki-antworten.js";
import { kontextPraefix } from "../../ki-kontext.js";
import { frageLokal, lokaleAdresse, lokalesModellAus } from "../../ki-lokal.js";
import { SessionClient } from "../../session-client.js";
import { pkShort } from "../../shell-logic.js";
import { solText } from "../../preis-anzeige.js";
import { switchTab, zeigeOnboarding } from "../app.js";
import { angebotVon, ensurePool, ensureSessionClient, findProviders, kiSitzungen, powJeProvider, state } from "../state.js";
import { beiFunkAntwort, sendeKiUeberFunk } from "../ki-ueber-funk.js";
import { quittungNachKanal, quittungNachZahlung } from "../quittungen.js";
import { deklaration, empfaengerFuer, kanalAntwort, kanalGutschrift, merkeAnfrage, perKanal, providerZahlung, pruefeKiZahlweg, rechneAntwortAb, zahleAnteile } from "../ki-zahlung.js";
import { kopplungFuer, meineKopplung } from "../mein-knoten.js";
import { type KnotenWeg, wegZumKnoten } from "../knoten-weg-ui.js";
import { knotenModellAus } from "../../knoten-wahl.js";
import { hoechstMsat } from "../../anteile-kasse.js";
import { $, quotaExhausted, refreshQuota, toast, el } from "../ui.js";
import { zeigeModelle } from "./agent-netz.js";
import { type Pruefer } from "../../streitfall.js";
import { zeigeMitwirkende } from "./earn.js";
import { zeigeNachfolge } from "./settings.js";
import { funkGeraetVerbunden, sendeUeberFunk } from "./mesh.js";
import { lokal } from "./modellwahl.js";
import { aktuellerVerlauf } from "./agent-verlauf.js";
import { askSwarm, askWithFailover, generateVideo, isPaymentNoise, privateAntworten } from "./agent-wege.js";
import { addAiMessage, addAiMessageStreaming, addUsageBubble, advanceJobPipeline, EigeneMeldung, hideTyping, setTypingLabel, setTypingStatus, showAiError, showTyping, stickToBottom, toolLabel, updateBudgetBar } from "./agent-anzeige.js";
import { attachment, hideEmptyState, selectedTools } from "./agent-eingabe.js";

/** Modell des zuletzt genutzten Providers (fuer die anzeige). */
let lastProviderModel: string | null = null;

/**
 * Frage an meinen Knoten: nur an ihn – kein anderer Provider, kein Ausweichen,
 * kein Kontingent. Die Anfrage trägt den Nachweis (`buildJobEvent()` mit
 * `kopplungFuer()`) und zahlt nichts; lehnt der Knoten ab oder schweigt er,
 * steht das im Verlauf.
 */
async function frageMeinenKnoten(prompt: string, modell: string, btn: HTMLButtonElement): Promise<void> {
  const k = meineKopplung();
  if (!k) {
    toast(t("agent.knotenNichtGekoppelt"), true);
    resetSendBtn(btn);
    return;
  }
  jobAbort = new AbortController();
  let weg: KnotenWeg | null = null;
  maybeInsertModelSwitchSummary(t("agent.knotenKurz"));
  addAiMessage("user", prompt, "");
  ($("#ai-prompt") as HTMLTextAreaElement).value = "";
  hideEmptyState();
  showTyping("connecting");
  try {
    // Rechenarbeit aus dem Angebot des Knotens – ohne Angebot keine, dann sagt der Knoten, was fehlt
    const angebot = await angebotVon(k.knoten).catch(() => undefined);
    if (angebot?.powBits !== undefined && angebot.powBits <= MAX_POW_APP) powJeProvider.set(k.knoten, angebot.powBits);
    // Alles über meinen Knoten (B-9c2): mit Haken nur über sein Relay, dort mit dem Sitzungsschlüssel angemeldet
    weg = await wegZumKnoten(k.knoten, kiSitzungen.fuer(k.knoten));
    if (!weg) {
      hideTyping();
      addAiMessage("ai", t("agent.knotenOhneRelay"), "");
      return;
    }
    const { wrap, requestId } = await buildJobEvent(prompt, 0, "free", k.knoten, ensureSessionClient(), [], modell);
    await weg.publish(wrap);
    setTypingStatus("thinking");
    const antwort = await waitForAnswer(requestId, KNOTEN_ZEIT_MS, k.knoten, { signal: jobAbort.signal, quelle: weg });
    hideTyping();
    if (!antwort) addAiMessage("ai", t("agent.knotenSchweigt", { knoten: pkShort(k.knoten) }), "");
    else if (antwort.aborted) addAiMessage("ai", t("agent.abgebrochen"), "");
    else if ("providerError" in antwort && antwort.providerError) addAiMessage("ai", t("agent.knotenLehntAb", { grund: antwort.providerError.slice(0, 200) }), "");
    else await handleAnswer(antwort.ev, antwort.parsed!, prompt);
  } catch (e) {
    hideTyping();
    addAiMessage("ai", fehlerText(e), "");
  } finally {
    weg?.schliesse();
    jobAbort = null;
    resetSendBtn(btn);
  }
}

/** So lange wartet die App auf den eigenen Knoten – wie auf den ersten Provider im Netz. */
const KNOTEN_ZEIT_MS = 300_000;

/**
 * Frage an das Modell auf diesem Gerät: kein Relay, kein Provider, keine
 * Zahlung. Antwortet es nicht, steht der Grund im Verlauf – die App fragt
 * nicht still das Netz.
 */
async function frageAufDiesemGeraet(prompt: string, modell: string, btn: HTMLButtonElement): Promise<void> {
  if (selectedTools.length > 0) toast(t("agent.lokalOhneWerkzeuge"));
  jobAbort = new AbortController();
  maybeInsertModelSwitchSummary(t("agent.lokalKurz"));
  const frage = pendingContextSummary ? pendingContextSummary + prompt : prompt;
  addAiMessage("user", prompt, "");
  ($("#ai-prompt") as HTMLTextAreaElement).value = "";
  hideEmptyState();
  showTyping("thinking");
  try {
    const a = await frageLokal({ adresse: lokaleAdresse(localStorage), modell, frage, signal: jobAbort.signal });
    hideTyping();
    addAiMessage("ai", a.text, t("agent.lokalMeta", { tokens: a.promptTokens + a.completionTokens }), a.modell);
  } catch (e) {
    hideTyping();
    addAiMessage("ai", fehlerText(e), "");
  } finally {
    jobAbort = null;
    resetSendBtn(btn);
  }
}

export async function askAi(): Promise<void> {
  if (!state.keypair) return;
  const promptEl = $("#ai-prompt") as HTMLTextAreaElement;
  const prompt = promptEl.value.trim();
  const bid = Number(($("#ai-bid") as HTMLInputElement).value);
  const btn = $("#ai-send") as HTMLButtonElement;
  // STOP: läuft bereits ein Job → abbrechen statt neuen senden – vor der Prüfung des Prompts,
  // der ist nach dem Senden leer (bis B-9a kehrte askAi deshalb vorher zurück, Stopp wirkte nie)
  if (btn.dataset.running === "1" && jobAbort) {
    jobAbort.abort();
    return;
  }
  if (!prompt) return;

  // KI über Funk (7.4c3): gewählt – die Antwort kommt später über setupFunkAntworten()
  if (($("#ai-funk") as HTMLInputElement | null)?.checked) {
    await frageUeberFunk(prompt, bid);
    return;
  }
  btn.dataset.running = "1";
  btn.classList.add("stop-mode");
  btn.textContent = t("agent.stop");
  // Dieses Gerät (B-1): direkt an das Modell auf dem eigenen Rechner – ohne Netz, Kontingent und Zahlung
  const lokalModell = lokalesModellAus(($("#ai-model") as HTMLInputElement | null)?.value);
  if (lokalModell) {
    await frageAufDiesemGeraet(prompt, lokalModell, btn);
    return;
  }
  // Mein Knoten (B-9a): nur an ihn, gratis mit Nachweis – vor Kontingent und Netz, nie an einen anderen Provider
  const knotenModell = knotenModellAus(($("#ai-model") as HTMLInputElement | null)?.value);
  if (knotenModell !== null) {
    await frageMeinenKnoten(prompt, knotenModell, btn);
    return;
  }
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
    const innen = el("div", `${t("agent.modellGewechselt")} `, "model-switch-inner");
    innen.append(el("b", newTier), ` — ${t("agent.kontextMit", { n: msgs.length })}`);
    note.replaceChildren(innen);
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
export const keinPrivaterProvider = () => new EigeneMeldung(t("agent.keinPrivaterProvider"));

export function privatFaehig(kandidaten: ScoredProvider[]): ScoredProvider[] {
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
export async function buildJobEvent(
  prompt: string,
  bid: number,
  tier: string,
  targetPubkey: string,
  sc: SessionClient,
  zusatzTags: string[][] = [],
  modell?: string,
): Promise<{ wrap: NostrEvent; requestId: string }> {
  if (!state.keypair) throw new Error("no keypair"); // kein UI-Text
  const sitzung = kiSitzungen.fuer(targetPubkey);
  // Kontext des Verlaufs (3.3): reist versiegelt mit dem Prompt, der Knoten merkt sich nichts
  const fullPrompt = pendingContextSummary ? pendingContextSummary + prompt : prompt;
  // Extra-Tags: Anhang (multimodal) + angeforderte Tools + gewuenschtes Modell
  const extraTags: string[][] = [];

  // Eigener Knoten (B-8c): Nachweis im Kern statt Bezahlung – kein Gebot, keine Anteile, kein Kanal, höchstens 0 msat
  const eigen = kopplungFuer(targetPubkey);
  // Gebuehrenmodell A+ (5.1.3): welche Anteile die App selbst zahlt – im Kern,
  // also versiegelt; der Provider stellt nur den Rest in Rechnung. Die
  // App-Gebuehr gibt es nicht mehr, sie geht im Anteil der Entwicklung auf.
  const empfaenger = eigen ? {} : await empfaengerFuer(targetPubkey);
  const hoechst = eigen ? 0 : hoechstMsat(bid, selectedTools);
  // Zahlkanal zu diesem Provider (4.3d): Gutschrift statt Deklaration – im Kanal
  // teilt das Programm auf; deckt er das Gebot nicht, geht nichts hinaus.
  // Zahlweg (12.4a, E3 A): mit SOL nur über den Kanal – ohne Kanal geht nichts hinaus, nie still Lightning
  if (!eigen && hoechst > 0) pruefeKiZahlweg(targetPubkey);
  const kanal = eigen ? undefined : await kanalGutschrift(targetPubkey, hoechst);
  extraTags.push(...(eigen ? [] : kanal ? kanal.tags : deklaration(empfaenger)));
  if (attachment) {
    extraTags.push(["attach", attachment.type, attachment.name, attachment.dataUrl.slice(0, 2000)]);
  }
  for (const tk of selectedTools) {
    extraTags.push(["tool", String(tk.kind), tk.input]);
  }
  // Modell-Wahl: aus Dropdown (leer = provider-default, nemotron bevorzugt); für meinen Knoten (B-9a) ohne „knoten:“
  const gewaehltesModell = modell ?? ($("#ai-model") as HTMLSelectElement | null)?.value ?? "";
  if (gewaehltesModell) {
    extraTags.push(["param", "model", gewaehltesModell]);
  }
  const useSession = !eigen && !kanal && sc.activeFor(targetPubkey);
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
        bidMsat: eigen ? 0 : bid * 1000,
        providerPubkey: targetPubkey,
        params: [["tier", tier]],
        extraTags: [...extraTags, ...zusatzTags],
      });
  const auftrag = await buildPrivateJobRequest({
    request: eigen ? mitBesitzerNachweis(request, eigen) : request, sessionSigner: sitzung, providerPk: targetPubkey, powBits: powJeProvider.get(targetPubkey) ?? 0,
  });
  // Erst merken (letzte Gutschrift, offene Anfrage), dann senden
  if (kanal) await kanal.merke(auftrag.requestId);
  merkeAnfrage(auftrag.requestId, empfaenger, hoechst, !!kanal);
  return auftrag;
}

/** Abbruch-Signal für den laufenden AI-Job (Stop-Button). */
export let jobAbort: AbortController | null = null;

export async function waitForAnswer(
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
    /** Nur hier lesen – das Relay meines Knotens (B-9c2), sonst der Pool. */
    quelle?: Pick<KnotenWeg, "query" | "sitzungPk">;
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  const seit = Math.floor(Date.now() / 1000) - 120;
  const cache: AntwortCache = new Map();
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return { aborted: true as const };
    const ids = opts.extraJobIds ? [...opts.extraJobIds] : [requestId];
    // Private Antworten (3.2) an unsere Sitzungsschluessel – offene gelten weiter.
    const privat = await privateAntworten(new Set(ids), seit, cache, opts.quelle);
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
        // Result ohne e/p/amount (z.B. provider-fehler) — als text-antwort zeigen; die Messung (P2a) zählt es als Fehler
        return { ev: filtered[0], parsed: { requestId, customerPubkey: "", providerPubkey: filtered[0].pubkey, output: filtered[0].content, amountMsat: 0 } as ReturnType<typeof parseJobResult>, kaputt: true };
      }
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return null;
}

export async function handleAnswer(ev: import("@freedomstack/protocol").NostrEvent, r: ReturnType<typeof parseJobResult>, frage?: string): Promise<void> {
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
  // Die Knöpfe für Nachfolge, Modelle und Abzeichen verdrahtet app.ts beim Start – bis C.6b
  // geschah das hier nach jeder Antwort ein zweites Mal (B16)
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
export function resetSendBtn(btn: HTMLButtonElement): void {
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
