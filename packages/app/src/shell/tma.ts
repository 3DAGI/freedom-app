/**
 * Telegram-Mini-App-Brücke – nur im Mini-App-Build (`FREEDOM_TMA=1`, eigener Ordner
 * `dist/tma/`, `docs/MINI-APP-TMA.md`).
 *
 * Erkennt, ob die App in Telegram läuft, liest `initData` (den signierten
 * Query-String mit der User-ID) und macht ready()/expand(). Die Signatur geht nur
 * über `tmaFetch()` hinaus, nur an den TMA-Server – bis zur Reparatur (TMA-1) hängte
 * ein globaler fetch-Patch sie an jeden Aufruf derselben Herkunft, auf GitHub Pages
 * also an GitHub.
 *
 * Verifikation passiert ausschließlich serverseitig (tma-auth.ts auf dem
 * Node) — hier im Client wird nur der rohe String weitergereicht, nie
 * `initDataUnsafe.user.id` blind vertraut.
 *
 * Im Web-Build ist `FREEDOM_TMA` nie gesetzt: Die Brücke tut dort nichts, auch wenn
 * ein `Telegram`-Objekt da ist.
 */
declare global {
  /** Nur im Mini-App-Build `true` (esbuild `define` in `build.mjs`). */
  var FREEDOM_TMA: boolean | undefined;
  /** Herkunft des TMA-Servers im Mini-App-Build; leer = dieselbe wie die App (Betrieb A). */
  var FREEDOM_TMA_API: string | undefined;
}

export interface TmaUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

interface TmaWebApp {
  initData: string;
  initDataUnsafe?: { user?: TmaUser; start_param?: string };
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  MainButton?: {
    text: string;
    show(): void;
    hide(): void;
    setParams(p: Record<string, unknown>): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    setText(t: string): void;
    enable(): void;
    disable(): void;
  };
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: string): void };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void };
  themeParams?: Record<string, string>;
}

/** Im Mini-App-Build? Nur dann gibt es eine Brücke (`globalThis.FREEDOM_TMA` ersetzt esbuild). */
export function istTmaBuild(): boolean {
  return globalThis.FREEDOM_TMA === true;
}

/** Basis des TMA-Servers – leer heißt dieselbe Herkunft wie die App. */
export function tmaApiBasis(): string {
  return globalThis.FREEDOM_TMA_API ?? "";
}

/** Das WebApp-Objekt von Telegram – nur im Mini-App-Build und erst beim Aufruf gelesen. */
function webApp(): TmaWebApp | undefined {
  if (!istTmaBuild()) return undefined;
  return (globalThis as unknown as { Telegram?: { WebApp?: TmaWebApp } }).Telegram?.WebApp;
}

/** true nur im echten Mini-App-WebView. */
export function inTelegram(): boolean {
  const wa = webApp();
  return !!(wa?.initData || wa?.initDataUnsafe?.user);
}

/** Die unterzeichnete Rohzeichenkette (nur serverseitig verifizierbar). */
export function initDataRaw(): string {
  return webApp()?.initData ?? "";
}

/** Anzeigedaten – NUR für Darstellung, nie für Autorisierung. */
export function tmaUser(): TmaUser | undefined {
  return webApp()?.initDataUnsafe?.user;
}

/** 64-Zeichen-Hex des Users (Nostr-kompatible Kennung, stabil). */
export function tmaUserHex(): string | undefined {
  const u = tmaUser();
  if (!u) return undefined;
  return u.id.toString(16).padStart(64, "0");
}

/** Theme (dark/light) aus Telegram übernehmen. */
export function tmaTheme(): "dark" | "light" | undefined {
  const c = webApp()?.themeParams?.bg_color;
  if (!c) return undefined;
  const m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return undefined;
  const lum = (parseInt(m[1], 16) * 299 + parseInt(m[2], 16) * 587 + parseInt(m[3], 16) * 114) / 1000;
  return lum < 128 ? "dark" : "light";
}

/**
 * Aufruf an den TMA-Server (`/tma/…`) mit `Authorization: tma <initData>` – der Server
 * prüft die Signatur je Aufruf. Nur dieser Weg trägt sie hinaus; `fetch` bleibt
 * unverändert (kein globaler Patch).
 */
export function tmaFetch(pfad: string, init: RequestInit = {}): Promise<Response> {
  if (!pfad.startsWith("/tma/")) return Promise.reject(new Error("tmaFetch: nur Pfade unter /tma/"));
  const headers = new Headers(init.headers);
  const raw = initDataRaw();
  if (raw) headers.set("authorization", `tma ${raw}`);
  return fetch(`${tmaApiBasis()}${pfad}`, { ...init, headers });
}

/** ready() + expand() — erst danach ist die Fläche nutzbar. */
export function tmaReady(): void {
  const wa = webApp();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
    wa.setHeaderColor?.("#0d0d1a");
    wa.setBackgroundColor?.("#0d0d1a");
  } catch { /* alte Clients ohne diese Methoden */ }
}

/** Kurzer Vibrations-Hinweis bei Erfolg/Fehler. */
export function tmaHaptic(ok: boolean): void {
  webApp()?.HapticFeedback?.notificationOccurred(ok ? "success" : "error");
}

/** "Zurück"-Knopf von Telegram anzeigen (cb feuert beim Druck). */
export function tmaBackButton(cb: () => void): void {
  const b = webApp()?.BackButton;
  if (!b) return;
  b.onClick(cb);
  b.show();
}

export function tmaHideBackButton(): void {
  webApp()?.BackButton?.hide();
}

/**
 * Mini-App-Shell: ready()/expand() und ein Theme-Attribut am <html>. Kein DOM-Overlay
 * nötig — die App bringt ihre eigene Oberfläche mit.
 */
export function startTelegramShell(): void {
  if (!inTelegram()) return;
  tmaReady();
  const theme = tmaTheme();
  if (theme) document.documentElement.setAttribute("data-tma-theme", theme);
}
