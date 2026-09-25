/**
 * Hilfsfunktionen der Oberflaeche: DOM-Zugriff, Meldungen, Zahlen und Zeiten,
 * Seitenleiste, Logo, Markdown-Darstellung.
 *
 * escapeHtml/pkShort liegen weiter in ../shell-logic.ts (dort getestet), icon in
 * ../icons.ts. Aus app.ts verschoben (Schritt 1.0) – woertlich, ohne Logikaenderung.
 */
import { escapeHtml, pkShort } from "../shell-logic.js";
import { ensurePool, state } from "./state.js";

// ------------------------------------------------------------- Helpers

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;



export function toast(msg: string, isErr = false): void {
  const t = $("#toast");
  t.textContent = msg;
  t.className = isErr ? "err" : "";
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 4000);
}


export function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function escrowIdent(): string {
  return state.keypair ? pkShort(state.keypair.pk) : "nicht verbunden";
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
    satsEl.title = "session-budget rest (non-custodial proxy)";
  }
  // sol: escrow-guthaben (deposited, nutzbar für jobs) — nicht die wallet-balance
  if (solEl) {
    const lamports = Number(localStorage.getItem("freedom.escrow.lamports") ?? "0");
    solEl.textContent = lamports > 0 ? `${(lamports / 1e9).toFixed(4)}` : "—";
    solEl.className = lamports > 0 ? "nb-val" : "nb-val nb-muted";
    solEl.title = "escrow-guthaben (eingezahlt, für jobs nutzbar)";
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
  const svg = markSvg(64, "#7BC80A").replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" `);
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = "data:image/svg+xml," + encodeURIComponent(svg);
}

export function markSvgCheck(): string {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
    stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12l5 5L20 7"/></svg>`;
}

/** Relay-Stand unten in der Seitenleiste. */
export async function aktualisiereNavStatus(): Promise<void> {
  const punkt = document.getElementById("nav-status-dot");
  const text = document.getElementById("nav-status-text");
  if (!punkt || !text) return;
  try {
    const pool = await ensurePool();
    const r = (pool as unknown as { relays?: { url: string }[] }).relays;
    const n = Array.isArray(r) ? r.length : 0;
    text.textContent = n > 0 ? String(n) : "—";
    punkt.classList.toggle("on", n > 0);
  } catch {
    text.textContent = "offline";
    punkt.classList.remove("on");
  }
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
    return `<div class="codeblock"><div class="cb-head"><span>code</span><button class="cb-copy" data-code-id="${id}">⧉ copy</button></div><pre><code id="${id}">${highlightCode(trimmed)}</code></pre></div>`;
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
        el.textContent = "✓ kopiert";
        setTimeout(() => { el.textContent = "⧉ copy"; }, 1500);
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
