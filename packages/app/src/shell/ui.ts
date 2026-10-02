/**
 * Hilfsfunktionen der Oberflaeche: DOM-Zugriff, Meldungen, Zahlen und Zeiten,
 * Seitenleiste, Logo, Markdown-Darstellung.
 *
 * escapeHtml/pkShort liegen weiter in ../shell-logic.ts (dort getestet), icon in
 * ../icons.ts. Aus app.ts verschoben (Schritt 1.0) – woertlich, ohne Logikaenderung.
 */
import { t } from "../i18n.js";
import { escapeHtml, pkShort } from "../shell-logic.js";
import { ensurePool, state } from "./state.js";
import { offlineHinweis } from "../protokoll-texte.js";

// ------------------------------------------------------------- Helpers

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;



/**
 * Element mit Text und Klasse – Text nur über `textContent` (C-6): für Listen
 * und Zeilen statt `innerHTML`, auch wenn darin Fremddaten stehen.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

export function toast(msg: string, isErr = false): void {
  const box = $("#toast");
  box.textContent = msg;
  box.className = isErr ? "err" : "";
  box.style.display = "block";
  setTimeout(() => (box.style.display = "none"), 4000);
}


export function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function escrowIdent(): string {
  return state.keypair ? pkShort(state.keypair.pk) : t("ein.keineIdentitaetKurz");
}

/**
 * Kopfzeile (seit C.5a): der gekürzte Schlüssel, davor das eigene Bild – wie
 * die Profil-Vorschau ohne Bild der Anfangsbuchstabe des Namens. Ein Bild aus
 * dem Netz lädt die Kopfzeile nie (das nennte dem Server bei jedem Start die IP).
 */
export function zeigeIdent(): void {
  const e = $("#ident");
  if (!e) return;
  e.textContent = escrowIdent();
  let name = "";
  try {
    name = String((JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as { name?: unknown }).name ?? "");
  } catch { /* kaputt: ohne Namen */ }
  e.dataset.initial = state.keypair ? ([...name.trim()][0] ?? "?").toUpperCase() : "";
}

/**
 * Sidebar-Balances (Desktop): sats = session-budget rest, sol = aus localStorage
 * (wird vom wallet-connect gesetzt). Wird bei jedem Balance-Update aufgerufen.
 */
/** True wenn das Gratis-Kontingent des aktuellen Providers aufgebraucht ist. */
export let quotaExhausted = false;

/**
 * Gratis-Kontingent in der Sidebar. Seit Schritt 3.1 gibt es fuer private
 * Anfragen kein Kontingent je Schluessel mehr – die Rechenarbeit ersetzt es.
 * Die Abfrage beim Provider (mit dem eigenen Pubkey in der URL) entfaellt
 * damit; sie verband die Identitaet mit dem Provider.
 */
export async function refreshQuota(): Promise<void> {
  const quotaBox = document.getElementById("nb-quota");
  if (quotaBox) quotaBox.style.display = "none";
  quotaExhausted = false;
  ($("#nb-wallet") as HTMLButtonElement | null)?.classList.remove("cta-pulse");
}

export function updateSidebarBalances(): void {
  const satsEl = document.getElementById("nb-sats");
  const solEl = document.getElementById("nb-sol");
  const identEl = document.getElementById("nb-ident");
  if (!satsEl && !solEl && !identEl) return;
  // ident
  if (identEl) identEl.textContent = escrowIdent();
  // sats: session-budget rest (gleiche quelle wie header-balance)
  if (satsEl) {
    let left: number | null = null;
    try {
      const b = state.sessionClient?.budgetState(state.lastProvider ?? "");
      if (b) left = Math.floor((b.max - b.charged) / 1000);
    } catch { /* keine session */ }
    satsEl.textContent = left === null ? "—" : `${left}`;
    satsEl.className = left !== null && left < 10 ? "nb-val nb-warn" : "nb-val";
    satsEl.title = t("ein.budgetRest");
  }
  // sol: escrow-guthaben (deposited, nutzbar für jobs) — nicht die wallet-balance
  if (solEl) {
    const lamports = Number(localStorage.getItem("freedom.escrow.lamports") ?? "0");
    solEl.textContent = lamports > 0 ? `${(lamports / 1e9).toFixed(4)}` : "—";
    solEl.className = lamports > 0 ? "nb-val" : "nb-val nb-muted";
    solEl.title = t("ein.escrowGuthaben");
  }
}

// -------------------------------------------------- Neuer Aufbau: Hilfslogik

/** Zeichen 09 — Klammer. Eine Quelle fuer Kopf, Seitenleiste und Favicon. */
function markSvg(size: number, color = "var(--accent)"): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M22 10 H12 V54 H22" stroke="${color}" stroke-width="7" stroke-linecap="square"/>
    <path d="M42 10 H52 V54 H42" stroke="${color}" stroke-width="7" stroke-linecap="square"/>
    <rect x="27" y="27" width="10" height="10" fill="${color}"/></svg>`;
}



export function setzeLogo(): void {
  const kopf = document.getElementById("head-mark");
  if (kopf) kopf.innerHTML = markSvg(18);
  const leiste = document.getElementById("nav-mark");
  if (leiste) leiste.innerHTML = markSvg(30);
  // Favicon aus demselben Zeichen, damit Tab und App gleich aussehen.
  const svg = markSvg(64, "#7BC80A").replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" `); // kein UI-Text
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = "data:image/svg+xml," + encodeURIComponent(svg);
}

/** Das Häkchen als Element (seit C-6d). */
export function haekchenEl(): SVGElement {
  const vorlage = document.createElement("template");
  vorlage.innerHTML = markSvgCheck();
  return vorlage.content.firstElementChild as SVGElement;
}

export function markSvgCheck(): string {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
    stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12l5 5L20 7"/></svg>`;
}

/**
 * Netz da? `navigator.onLine === false` heisst sicher offline; `true` kann
 * luegen (WLAN ohne Internet) – dann scheitert eine Zahlung wie bisher am Netz.
 */
export function netzDa(nav: { onLine?: boolean } | undefined = (globalThis as { navigator?: { onLine?: boolean } }).navigator): boolean {
  return nav?.onLine !== false;
}

/**
 * Offline-Hinweis oben (Schritt 7.3): sagt, was ohne Netz geht – Nachrichten
 * ueber Funk oder per Datei; Sats und SOL erst wieder mit Netz.
 */
export function wireOfflineHinweis(): void {
  const el = document.getElementById("offline-hinweis");
  if (!el) return;
  el.textContent = offlineHinweis();
  const zeige = (): void => { el.hidden = netzDa(); };
  window.addEventListener("online", zeige);
  window.addEventListener("offline", zeige);
  zeige();
  // Der Punkt am Relay-Stand folgt dem Netz (C.1a)
  window.addEventListener("online", () => void aktualisiereNavStatus());
  window.addEventListener("offline", () => void aktualisiereNavStatus());
}

/**
 * Relay-Stand in der Leiste und unter „Mehr“: seit C-16 wie viele Relays des
 * Pools gerade verbunden sind (`WebSocketRelay.verbunden`, nur lesend) – vorher
 * nur, wie viele im Pool stehen (C.1a, E8). Eine Verbindung entsteht erst beim
 * ersten Gebrauch. Der Punkt leuchtet nur mit einer offenen Verbindung und
 * solange der Browser Netz meldet.
 */
export async function aktualisiereNavStatus(): Promise<void> {
  let n = 0;
  let verbunden = 0;
  try {
    const r = (await ensurePool() as unknown as { relays?: unknown[] }).relays;
    n = Array.isArray(r) ? r.length : 0;
    verbunden = Array.isArray(r) ? r.filter((x) => (x as { verbunden?: unknown }).verbunden === true).length : 0;
  } catch { /* kein Pool: 0 */ }
  const satz = t("nav.relaysVerbunden", { verbunden, n });
  const text = document.getElementById("nav-status-text");
  if (text) text.textContent = n > 0 ? `${verbunden}/${n}` : "—";
  text?.parentElement?.setAttribute("title", satz);
  document.getElementById("nav-status-dot")?.classList.toggle("on", verbunden > 0 && netzDa());
  const mehr = document.getElementById("mehr-relays");
  if (mehr) mehr.textContent = satz;
}

/** Zahl aus Fremddaten sicher als Text – nie ein ungepruefter Wert in innerHTML. */
export function ganzeZahl(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : "0";
}

/** Minimales, sicheres Markdown fuer AI-Antworten (nach escapeHtml):
 *  **bold**, *italic*, `code`, ```codeblock```, Listen, Absaetze. */
export function renderMarkdown(escaped: string): string {
  let s = escaped;
  // Codeblocks zuerst (``` ... ```) — mit Copy-Button + minimalem Highlighting
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang: string, code: string) => {
    const trimmed = code.trim();
    const id = "code-" + Math.random().toString(36).slice(2, 8);
    // Queue für nachträgliches Highlighting (nach innerHTML-Insert)
    pendingCodeBlocks.set(id, trimmed);
    return `<div class="codeblock"><div class="cb-head"><span>code</span><button class="cb-copy" data-code-id="${id}">⧉ ${escapeHtml(t("ein.kopieren"))}</button></div><pre><code id="${id}">${highlightCode(trimmed)}</code></pre></div>`;
  });
  // Inline code
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|\s)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // Einfache Listen (- / * am Zeilenanfang)
  s = s.replace(/(?:^|\n)[-*] (.+)(?=\n|$)/g, "\n<li>$1</li>");
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  s = s.replace(/<\/ul>\s*<ul>/g, "");
  // Absaetze: doppelte Newlines -> <p>
  const paras = s.split(/\n{2,}/).map((p) => p.trim());
  s = paras
    .map((p) => (p.startsWith("<pre") || p.startsWith("<div") || p.startsWith("<ul") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
    .join("");
  return s;
}


/** Code-Blöcke die auf Copy-Highlighting warten (id -> code). */
const pendingCodeBlocks = new Map<string, string>();

/** Aktiviert Copy-Buttons der gerenderten Code-Blöcke (nach innerHTML-Insert rufen). */
export function activateCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll(".cb-copy").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    if (el.dataset.wired === "1") return;
    el.dataset.wired = "1";
    el.addEventListener("click", async () => {
      const id = el.dataset.codeId;
      const code = id ? pendingCodeBlocks.get(id) : undefined;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        el.textContent = `✓ ${t("ein.kopiert")}`;
        setTimeout(() => { el.textContent = `⧉ ${t("ein.kopieren")}`; }, 1500);
      } catch { /* clipboard denied */ }
    });
  });
}

/** Minimales Syntax-Highlighting (keywords/strings/comments/kommentare) ohne Library. */
function highlightCode(code: string): string {
  let s = escapeHtml(code);
  // strings zuerst (schützen vor keyword-replace)
  s = s.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|"[^"]*"|'[^']*')/g, '<span class="tok-str">$1</span>');
  // comments
  s = s.replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, '<span class="tok-com">$1</span>');
  // keywords (js/ts/python/rust/solana gemischt — pragmatisch)
  s = s.replace(
    /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|extends|new|async|await|try|catch|throw|typeof|interface|type|public|private|def|self|None|True|False|fn|pub|impl|struct|match|use|mut|null|undefined|true|false)\b/g,
    '<span class="tok-kw">$1</span>',
  );
  // zahlen
  s = s.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  return s;
}
