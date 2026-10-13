/**
 * Telegram-Mini-App-Brücke (FREEDOM_TMA=1).
 *
 * Erkennt, ob die App in Telegram läuft, liest `initData` (den signierten
 * Query-String mit der User-ID), macht ready()/expand() und hängt den
 * Authorization-Header an jeden ausgehenden fetch.
 *
 * Verifikation passiert ausschließlich serverseitig (tma-auth.ts auf dem
 * Node) — hier im Client wird nur der rohe String weitergereicht, nie
 * `initDataUnsafe.user.id` blind vertraut.
 *
 * Im Nicht-TMA-Build ist `tma` immer `undefined`, der Rest der App merkt
 * nichts davon.
 */
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

const W = (globalThis as unknown as { Telegram?: { WebApp?: TmaWebApp } }).Telegram;

/** true nur im echten Mini-App-WebView. */
export function inTelegram(): boolean {
  return !!(W?.WebApp?.initData || W?.WebApp?.initDataUnsafe?.user);
}

/** Die unterzeichnete Rohzeichenkette (nur serverseitig verifizierbar). */
export function initDataRaw(): string {
  return W?.WebApp?.initData ?? "";
}

/** Anzeigedaten – NUR für Darstellung, nie für Autorisierung. */
export function tmaUser(): TmaUser | undefined {
  return W?.WebApp?.initDataUnsafe?.user;
}

/** 64-Zeichen-Hex des Users (Nostr-kompatible Kennung, stabil). */
export function tmaUserHex(): string | undefined {
  const u = tmaUser();
  if (!u) return undefined;
  return u.id.toString(16).padStart(64, "0");
}

/** Theme (dark/light) aus Telegram übernehmen. */
export function tmaTheme(): "dark" | "light" | undefined {
  const c = W?.WebApp?.themeParams?.bg_color;
  if (!c) return undefined;
  const m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return undefined;
  const lum = (parseInt(m[1], 16) * 299 + parseInt(m[2], 16) * 587 + parseInt(m[3], 16) * 114) / 1000;
  return lum < 128 ? "dark" : "light";
}

let _patched = false;

/**
 * fetch() patchen: Jeder Request an unseren Origin bekommt
 * `Authorization: tma <initData>` (die Signatur) mit — der Server prüft sie
 * pro Request. Ohne diesen Header kennt der Server den Nutzer nicht.
 */
export function patchFetchForTma(): void {
  if (_patched || !inTelegram()) return;
  _patched = true;
  const orig = globalThis.fetch;
  const raw = initDataRaw();
  if (!raw) return;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Nur gleicher Origin — fremde APIs (Relays, TON, Solana-RPC) bekommen nichts.
    let sameOrigin = false;
    try {
      if (typeof input === "string") {
        sameOrigin = input.startsWith("/") || input.startsWith(location.origin);
      } else if (input instanceof URL) {
        sameOrigin = input.origin === location.origin;
      } else if (input instanceof Request) {
        sameOrigin = input.url.startsWith(location.origin) || input.url.startsWith("/");
      }
    } catch { /* relative URL ohne base — sicher behandeln */ }
    if (!sameOrigin) return orig(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("authorization")) headers.set("authorization", `tma ${raw}`);
    return orig(input, { ...init, headers });
  }) as typeof fetch;
}

/** ready() + expand() — erst danach ist die Fläche nutzbar. */
export function tmaReady(): void {
  const wa = W?.WebApp;
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
  W?.WebApp?.HapticFeedback?.notificationOccurred(ok ? "success" : "error");
}

/** "Zurück"-Knopf von Telegram anzeigen (cb feuert beim Druck). */
export function tmaBackButton(cb: () => void): void {
  const b = W?.WebApp?.BackButton;
  if (!b) return;
  b.onClick(cb);
  b.show();
}

export function tmaHideBackButton(): void {
  W?.WebApp?.BackButton?.hide();
}

/**
 * Mini-App-Shell: Zeigt Profil (Name/Username aus initDataUnsafe), ein
 * Theme-Attribut am <html> und den Patched-fetch. Kein DOM-Overlay nötig —
 * die App bringt ihre eigene Oberfläche mit.
 */
export function startTelegramShell(): void {
  if (!inTelegram()) return;
  tmaReady();
  patchFetchForTma();
  const theme = tmaTheme();
  if (theme) document.documentElement.setAttribute("data-tma-theme", theme);
}
