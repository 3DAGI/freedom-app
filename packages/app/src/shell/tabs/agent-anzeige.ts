/**
 * Agent › Anzeige: Gebühren- und Token-Vorschau, Fehler-Blase, Budget,
 * Blasen der Antworten (über `antwortDom()`), Kosten-Blase mit Reklamation,
 * Schritt-Leiste und Orb.
 *
 * Aus tabs/agent.ts verschoben (C-5d) – wörtlich, ohne Logikänderung.
 */
import { PROVIDER_PPM } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText, hatFehlerText, reklamationsFrist } from "../../protokoll-texte.js";
import { iconEl } from "../../icons.js";
import { lokalesModellAus } from "../../ki-lokal.js";
import { bestaetige, dialog } from "../dialog.js";
import { antwortDom } from "../antwort-ui.js";
import { fliesstext, pkShort } from "../../shell-logic.js";
import { ausMsat } from "../../preis-anzeige.js";
import { merkeGratisAbgelehnt } from "../app.js";
import { ensurePool, kiSitzungen, powJeProvider, state } from "../state.js";
import { aktuellerKurs } from "../marktkurs.js";
import { knotenModellAus } from "../../knoten-wahl.js";
import { $, ganzeZahl, toast, updateSidebarBalances, el, haekchenEl } from "../ui.js";
import { GRUND_TEXT, PRUEFER_ART, type Pruefer } from "../../streitfall.js";
import { merkeReklamation, netzPruefer, stelleZu } from "../streitfall-ui.js";
import { askAi, resetSendBtn } from "./agent.js";
import { aktualisiereAgentPanel, merkeNachricht } from "./agent-verlauf.js";

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
  if (lokalesModellAus(($("#ai-model") as HTMLInputElement | null)?.value)) { el.textContent = t("agent.lokalGratis"); return; }
  if (knotenModellAus(($("#ai-model") as HTMLInputElement | null)?.value) !== null) { el.textContent = t("agent.knotenGratis"); return; }
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
export class EigeneMeldung extends Error {}

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
export function showAiError(e: unknown, retryPrompt: string, retryBid: number, retryTier: "free" | "classic" | "pro", retryMode: { max?: boolean; swarm?: boolean } = {}): void {
  hideTyping();
  const cause = explainError(e);
  // Gratis-Anfrage abgelehnt (8.1a): Die Fuehrung fragt jetzt nach der Wallet
  if (retryTier === "free" && /bid zu niedrig/i.test((e as Error)?.message ?? String(e))) merkeGratisAbgelehnt();
  // Als DOM (C-6d): die Ursache kann Text des Providers tragen – nur als Text
  const blase = el("div", undefined, "bubble");
  blase.classList.add("ai", "error");
  const koerper = el("div", `${t("agent.ursache")} `, "body");
  koerper.append(el("b", cause));
  blase.append(el("div", t("agent.fehler"), "who"), koerper);
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
  blase.appendChild(btn);
  $("#ai-thread").appendChild(blase);
  stickToBottom(() => blase.scrollIntoView({ behavior: "smooth", block: "end" }));
  const sendBtn = $("#ai-send") as HTMLButtonElement;
  resetSendBtn(sendBtn);
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

/**
 * Gerüst einer Blase im Verlauf (seit C-6d2 als DOM). Der Modellname kommt vom
 * Provider (usage.model, Ankündigung) – nur als Text.
 */
function blasenGeruest(role: "user" | "ai", meta: string, model?: string): { blase: HTMLElement; koerper: HTMLElement } {
  const blase = el("div", undefined, "bubble");
  blase.classList.add(role);
  const koerper = el("div", undefined, "body");
  blase.append(el("div", role === "user" ? t("komm.du") : `agent${model ? ` · ${model}` : ""}`, "who"), koerper);
  if (meta) blase.append(el("div", meta, "cost"));
  return { blase, koerper };
}

export function addAiMessage(role: "user" | "ai", text: string, meta: string, model?: string): HTMLElement {
  const { blase, koerper } = blasenGeruest(role, meta, model);
  // AI-Antworten: Markdown nur über antwortDom(). User: reiner Text.
  koerper.append(role === "ai" ? antwortDom(text) : text);
  $("#ai-thread").appendChild(blase);
  stickToBottom(() => blase.scrollIntoView({ behavior: "smooth", block: "end" }));
  merkeNachricht(role, text, meta, model);
  return blase;
}


/** Simuliertes Streaming: zeigt die AI-Antwort buchstabenweise an (typewriter).
 *  Echtes Nostr-Streaming waere komplex (multi-event); so wirkt es lebendig. */
export function addAiMessageStreaming(role: "ai", text: string, meta: string, model?: string, onDone?: () => void): HTMLElement {
  const { blase, koerper: bodyEl } = blasenGeruest(role, meta, model);
  $("#ai-thread").appendChild(blase);
  stickToBottom(() => blase.scrollIntoView({ behavior: "smooth", block: "end" }));

  let i = 0;
  const speed = 12; // ms pro zeichen (schneller: nutzer wollen die antwort)
  const tick = () => {
    if (i < text.length) {
      bodyEl.textContent = text.slice(0, ++i);
      stickToBottom(() => blase.scrollIntoView({ behavior: "smooth", block: "end" }));
      setTimeout(tick, speed);
    } else {
      // fertig: Markdown samt Code-Blöcken (Kopier-Knopf) als DOM
      bodyEl.replaceChildren(antwortDom(text));
      stickToBottom(() => blase.scrollIntoView({ behavior: "smooth", block: "end" }));
      merkeNachricht("ai", text, meta, model);
      onDone?.();
    }
  };
  setTimeout(tick, speed);
  return blase;
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
  jobId: string | undefined, providerPk: string, amountMsat: number, frageAntwort?: { frage: string; antwort: string }, auftragId?: string,
): Promise<void> {
  // Vom Sitzungsschlüssel des Auftrags (D1b), nicht vom aktuellen – sonst passte die Reklamation nicht zum Auftrag
  const sitzung = auftragId ? kiSitzungen.fuerAuftrag(auftragId) : undefined;
  if (!state.keypair || !jobId || !sitzung) {
    toast(t("agent.ohneBezug"), true);
    return;
  }
  const { disputeInfo, buildDispute, buildPrivateDispute, disputeWindowOpen } =
    await import("@freedomstack/protocol");

  // Dialoge statt confirm()/prompt() (C-1f): erst, was das Verfahren leistet – der Satz des Protokolls ist für
  // alert() umbrochen –, dann Grund, Prüfer, Zustimmung und Notiz in einem Dialog
  if (!(await bestaetige({ titel: t("agent.reklamierenTitel"), text: fliesstext(disputeInfo()), ok: t("agent.weiter") }))) return;
  const w = disputeWindowOpen(Math.floor(Date.now() / 1000) - 60);
  if (!w.open) {
    toast(reklamationsFrist(w), true);
    return;
  }
  // Prüfer nur aus dem eigenen Netz (5.6) – Kontakte und eigene Provider, nie aus einer Rangliste des Netzes
  const kandidaten = netzPruefer(providerPk);
  if (kandidaten.length === 0) toast(t("agent.keinPruefer"));
  const arten = ["nichts_geliefert", "unbrauchbar", "falsches_modell", "abgebrochen"] as const;
  const eingabe = await dialog({
    titel: t("agent.reklamierenTitel"), ok: t("agent.reklamieren"),
    felder: [
      { art: "wahl", name: "grund", label: t("agent.problemFrage"), pflicht: true, wert: "unbrauchbar",
        optionen: arten.map((a) => ({ wert: a, text: t(GRUND_TEXT[a]) })) },
      ...(kandidaten.length ? [{ art: "wahl" as const, name: "pruefer", label: t("agent.prueferFrage"), wert: "",
        optionen: [{ wert: "", text: t("agent.nurProvider") }, ...kandidaten.map((c) => ({ wert: c.pk, text: `${c.name} (${t(PRUEFER_ART[c.art])})` }))] }] : []),
      // Frage und Antwort nur mit Zustimmung und nur für den Prüfer (5.6)
      ...(kandidaten.length && frageAntwort ? [{ art: "mehrfach" as const, name: "material", label: t("agent.materialFrage"),
        optionen: [{ wert: "ja", text: t("agent.materialHaken") }] }] : []),
      { art: "textarea", name: "notiz", label: t("agent.beschreibung") },
    ],
  });
  if (!eingabe) return;
  const art = arten.find((a) => a === eingabe.grund) ?? "unbrauchbar";
  const pruefer: Pruefer | null = kandidaten.find((c) => c.pk === eingabe.pruefer) ?? null;
  const zustimmung = Array.isArray(eingabe.material) && eingabe.material.includes("ja");

  try {
    const material = pruefer && frageAntwort && zustimmung ? frageAntwort : undefined;
    // Vom Sitzungsschluessel wie der Auftrag selbst (3.1, D1b oben) – nicht von
    // der Identitaet – und nur versiegelt an Provider und Pruefer (3.4).
    // Die Reklamation nennt den Pruefer (5.6) – nur sein Urteil zaehlt, und der Provider sieht, wer es ist.
    const dispute = buildDispute({
      jobId, customerPubkey: sitzung.publicKey(), providerPubkey: providerPk,
      reason: art, amountMsat, note: String(eingabe.notiz ?? ""),
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
      const sk = kiSitzungen.schluesselHex(sitzung.publicKey());
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


export function addUsageBubble(usage: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  toolCalls?: Array<{ name: string; kind: number; costMsat: number }>;
  sessionTotalMsat?: number;
}, amountMsat: number, providerPk: string, resultEventId?: string, frageAntwort?: { frage: string; antwort: string },
abrechnung?: { providerMsat: number; posten: Array<{ anteil: string; msat: number }>; pruefbudgetMsat?: number }, auftragId?: string): void {
  const blase = el("div", undefined, "usage-bubble");
  aktualisiereAgentPanel(usage.toolCalls ?? [], usage.sessionTotalMsat);
  // Jedes Werkzeug als eigene Zeile mit Haken — im Entwurf war das der Kern:
  // man sieht auf einen Blick, was der Agent getan hat und was es gekostet hat.
  const haken = (): HTMLElement => {
    const h = el("span", undefined, "tool-check");
    h.append(haekchenEl());
    return h;
  };
  // Nur Text – Werkzeug- und Modellnamen kommen vom Provider.
  const zeile = (k: string, v: string): HTMLElement => {
    const z = el("div", undefined, "usage-row");
    z.append(el("span", k), el("span", v));
    return z;
  };

  const toggle = el("button", undefined, "usage-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  const chevron = el("span", "›", "usage-chev");
  chevron.setAttribute("aria-hidden", "true");
  toggle.append(
    haken(),
    el("span", usage.model ?? t("agent.antwort"), "usage-title"),
    el("span", t("agent.tokensMeta", { n: ganzeZahl(usage.completionTokens), sat: Math.floor(amountMsat / 1000) }), "usage-meta"),
    chevron,
  );
  const koerper = el("div", undefined, "usage-body");
  koerper.classList.add("hidden");
  const werkzeuge = (usage.toolCalls ?? []).map((w) => {
    const karte = el("div", undefined, "tool-card");
    karte.append(haken(), el("span", w.name, "tool-name"), el("span", `${Math.floor(w.costMsat / 1000)} sat`, "tool-cost"));
    return karte;
  });
  if (werkzeuge.length) {
    const liste = el("div", undefined, "tool-list");
    liste.append(...werkzeuge);
    koerper.append(liste);
  }
  koerper.append(
    zeile(t("agent.modell"), usage.model ?? "—"),
    zeile(t("agent.provider"), pkShort(providerPk)),
    zeile(t("agent.tokens"), t("agent.reinRaus", { rein: ganzeZahl(usage.promptTokens), raus: ganzeZahl(usage.completionTokens) })),
    zeile(t("agent.dieseAntwort"), `${Math.floor(amountMsat / 1000)} sat`),
  );
  if (usage.sessionTotalMsat !== undefined) {
    const gesamt = zeile(t("agent.sitzungGesamt"), `${Math.floor(usage.sessionTotalMsat / 1000)} sat`);
    gesamt.classList.add("total");
    koerper.append(gesamt);
  }
  if (abrechnung && abrechnung.providerMsat > 0) koerper.append(...aufteilungZeilen(abrechnung, zeile));
  if (amountMsat > 0) {
    const reklamieren = el("button", t("agent.reklamieren"), "file-dispute");
    reklamieren.type = "button";
    reklamieren.classList.add("ghost");
    reklamieren.addEventListener("click", () => {
      void reklamiere(resultEventId, providerPk, amountMsat, frageAntwort, auftragId);
    });
    const aktionen = el("div", undefined, "usage-actions");
    aktionen.append(reklamieren);
    koerper.append(aktionen);
  }
  // Auf- und zuklappen; der Pfeil dreht sich über aria-expanded (app.css)
  toggle.addEventListener("click", () => {
    const zu = koerper.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", String(!zu));
  });
  blase.append(toggle, koerper);
  $("#ai-thread").appendChild(blase);
  stickToBottom(() => blase.scrollIntoView({ behavior: "smooth", block: "end" }));
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
function aufteilungZeilen(a: { providerMsat: number; posten: Array<{ anteil: string; msat: number }>; pruefbudgetMsat?: number }, zeile: (k: string, v: string) => HTMLElement): HTMLElement[] {
  const weitere = a.posten.map((p) => zeile(ANTEIL_NAME[p.anteil] ? t(ANTEIL_NAME[p.anteil]!) : p.anteil, t("agent.gesammelt", { betrag: satText(p.msat) })));
  // Prüfbudget (P5b): bleibt beim Kunden und bezahlt seine Prüfrunden
  if (a.pruefbudgetMsat && a.pruefbudgetMsat > 0) weitere.push(zeile(t("agent.anteilPruefbudget"), t("agent.bleibtBeiDir", { betrag: satText(a.pruefbudgetMsat) })));
  return [zeile(t("agent.anDenProvider"), satText(a.providerMsat)),
    ...(weitere.length ? weitere : [zeile(t("agent.weitereAnteile"), t("agent.keinEmpfaenger"))])];
}

/** Thinking-Orb (wie orbs.jakubantalik.com): animierte Kugel statt Text.
 *  Leichte Canvas-Version (kein npm-Dep). States: working/searching/etc. */
export function showTyping(status: string = "thinking"): HTMLElement {
  const tippt = el("div", undefined, "typing");
  tippt.id = "ai-typing";
  // Replit-Stil: wachsende Icon-Leiste. Jeder Schritt hängt sein Symbol an,
  // das Label zeigt dynamisch was GERADE passiert (auch provider-feedback).
  const leiste = el("div", undefined, "step-rail");
  leiste.id = "step-rail";
  const text = el("span", t(status));
  text.id = "step-label-text";
  const label = el("div", undefined, "step-label");
  label.append(el("span", undefined, "spinner"), text);
  tippt.append(leiste, label);
  $("#ai-thread").appendChild(tippt);
  addStepIcon(status);
  stickToBottom(() => tippt.scrollIntoView({ behavior: "smooth", block: "end" }));
  return tippt;
}

/** Fügt ein Schritt-Icon an die wachsende Leiste an (Replit-Stil).
 *  Klick auf ein Icon zeigt Details zum Schritt (Tooltip + Alert-Label). */
function addStepIcon(stepKey: string): void {
  const rail = document.getElementById("step-rail");
  if (!rail) return;
  const iconFor = (k: string): { symbol: string; title: string } => {
    switch (k) {
      case "connecting": return { symbol: "zap", title: t("agent.schrittVerbinden") };
      case "researching": return { symbol: "search", title: t("agent.schrittRecherche") };
      case "thinking": return { symbol: "bot", title: t("agent.schrittModell") };
      case "creating": return { symbol: "image", title: t("agent.schrittMedien") };
      default: return { symbol: "wrench", title: k };
    }
  };
  const { symbol, title } = iconFor(stepKey);
  const prev = rail.querySelector(".step-ic.active");
  if (prev) { prev.classList.remove("active"); prev.classList.add("done"); }
  const ic = document.createElement("span");
  ic.className = "step-ic active";
  ic.title = title;
  ic.append(iconEl(symbol, 12));
  ic.addEventListener("click", () => {
    // Klick: Schritt-Erklärung kurz im Label zeigen
    setTypingLabel(title);
  });
  rail.appendChild(ic);
}

/** Tool-Name → lesbares Label für die Schritt-Leiste. */
export function toolLabel(tool: string): string {
  if (/web_search/i.test(tool)) return t("agent.suchtWeb");
  if (/browser/i.test(tool)) return t("agent.liestSeiten");
  if (/image/i.test(tool)) return t("agent.erstelltBild");
  if (/video/i.test(tool)) return t("agent.erstelltVideo");
  return `${tool}…`;
}

export function advanceJobPipeline(toStatus: string): void {
  addStepIcon(toStatus);
}

/** Update den typing-status (thinking -> researching -> creating). */
export function setTypingStatus(status: string): void {
  advanceJobPipeline(status);
  setTypingLabel(t(status));
}

/** Label-Text der typing-Zeile (für live provider-feedback). */
export function setTypingLabel(text: string): void {
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
export function stickToBottom(scrollFn?: () => void): boolean {
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
export function hideTyping(): void {
  document.getElementById("ai-typing")?.remove();
}
