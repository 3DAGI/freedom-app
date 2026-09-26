/**
 * Solana-Wallet-Anbindung für Desktop UND Mobile.
 *
 * DAS PROBLEM
 * Der bisherige Code prüfte nur `window.solana`. Das gibt es ausschließlich,
 * wenn eine Browser-Extension injiziert (Desktop) oder wenn die Seite im
 * In-App-Browser einer Wallet läuft. In Safari auf dem iPhone oder Chrome auf
 * Android ist `window.solana` undefined — der Nutzer bekam nur die Meldung
 * "kein Solana-Wallet gefunden" und war fertig. Auf dem Seeker-Phone, also
 * ausgerechnet dem Zielgerät, ebenfalls.
 *
 * DIE DREI WEGE
 *   1. Injizierter Provider  — Desktop-Extension oder Wallet-In-App-Browser.
 *   2. Mobile Wallet Adapter — Android/Seeker, wenn die Bridge verfügbar ist.
 *   3. Universal Link        — iOS und jedes andere Mobilgerät: die Seite
 *      öffnet die Wallet-App, die sie in ihrem eigenen Browser zurücklädt.
 *      Dort greift dann Weg 1.
 *
 * Weg 3 ist kein eleganter, aber der einzige, der auf iOS ohne App-Store-
 * Abhängigkeit funktioniert — und "funktioniert überall" schlägt "elegant".
 */

import { alsAnbieter, solanaWallets } from "./wallet-standard.js";

export type SolanaConnectMethod = "standard" | "injected" | "mwa" | "deeplink" | "none";

export interface SolanaProvider {
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?(): Promise<void>;
  signTransaction?(tx: unknown): Promise<unknown>;
  signMessage?(msg: Uint8Array, enc?: string): Promise<{ signature: Uint8Array }>;
  isPhantom?: boolean;
  isSolflare?: boolean;
}

export interface SolanaEnvironment {
  isMobile: boolean;
  isIos: boolean;
  isAndroid: boolean;
  /** Läuft die Seite bereits im In-App-Browser einer Wallet? */
  inWalletBrowser: boolean;
  hasInjected: boolean;
  hasMwa: boolean;
  method: SolanaConnectMethod;
  /** Was der Nutzer tun soll — im Klartext, nicht als Fehlercode. */
  hint: string;
}

/** Erkennt, welcher Weg auf DIESEM Gerät gangbar ist. */
export function detectSolanaEnvironment(userAgentOverride?: string): SolanaEnvironment {
  const w = globalThis as unknown as {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
    navigator?: { userAgent?: string };
  };
  const ua = userAgentOverride ?? w.navigator?.userAgent ?? "";
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIos || isAndroid || /Mobile/i.test(ua);

  const injected = w.solana ?? w.phantom?.solana ?? w.solflare;
  const hasInjected = typeof injected?.connect === "function";
  const inWalletBrowser = hasInjected && isMobile;
  // Der Mobile Wallet Adapter meldet sich über ein Android-Intent-Schema; im
  // Browser ist er nur indirekt erkennbar.
  const hasMwa = isAndroid && typeof (w as { navigator?: unknown }).navigator !== "undefined";

  // Wallet Standard (4.2c): so melden sich die meisten Browser-Wallets heute an.
  const standard = typeof (globalThis as { dispatchEvent?: unknown }).dispatchEvent === "function" ? solanaWallets().map((x) => x.name) : [];

  let method: SolanaConnectMethod;
  let hint: string;
  if (standard.length) {
    method = "standard";
    hint = `Wallet erkannt: ${standard.join(", ")}.`;
  } else if (hasInjected) {
    method = "injected";
    hint = inWalletBrowser
      ? "Wallet-Browser erkannt — Verbinden funktioniert direkt."
      : "Browser-Wallet erkannt (Phantom/Solflare).";
  } else if (isAndroid) {
    method = "mwa";
    hint = "Android erkannt — die Wallet-App wird zum Bestätigen geöffnet.";
  } else if (isMobile) {
    method = "deeplink";
    hint = "Auf dem Handy öffnet sich deine Wallet-App. Danach geht es hier weiter.";
  } else {
    method = "none";
    hint =
      "Keine Solana-Wallet gefunden. Auf dem Desktop hilft eine Extension " +
      "(Phantom oder Solflare), oder du nutzt die App auf dem Handy.";
  }

  return { isMobile, isIos, isAndroid, inWalletBrowser, hasInjected, hasMwa, method, hint };
}

/**
 * Universal Link, der die Wallet-App öffnet und unsere Seite dort lädt.
 *
 * Bewusst ohne das verschlüsselte Phantom-Session-Protokoll: das braucht ein
 * eigenes Keypair und Callback-Handling und bringt hier nichts, weil die Seite
 * im Wallet-Browser ohnehin einen injizierten Provider bekommt. Weniger
 * bewegliche Teile heißt weniger, das kaputtgehen kann.
 */
export function buildWalletDeeplink(
  wallet: "phantom" | "solflare",
  appUrl: string = typeof location !== "undefined" ? location.href : "",
): string {
  const target = encodeURIComponent(appUrl);
  if (wallet === "solflare") return `https://solflare.com/ul/v1/browse/${target}?ref=${target}`;
  return `https://phantom.app/ul/browse/${target}?ref=${target}`;
}

export interface SolanaConnection {
  pubkey: string;
  method: SolanaConnectMethod;
  provider?: SolanaProvider;
  /** Name der Wallet (Wallet Standard) – zum stillen Wiederverbinden. */
  name?: string;
}

export interface ConnectOptions {
  /** Stiller Wiederverbindungsversuch beim Start (ohne Popup). */
  silent?: boolean;
  /** Wird aufgerufen, wenn nur noch ein Deeplink bleibt. */
  onNeedsDeeplink?: (links: { phantom: string; solflare: string }, hint: string) => void;
  userAgentOverride?: string;
  /** Mehrere Wallets angemeldet: welche? (Index oder null = abbrechen) */
  waehle?: (namen: string[]) => Promise<number | null>;
  /** Zuletzt benutzte Wallet – nur mit ihr wird still wiederverbunden. */
  gemerkt?: string | null;
  /** Kette zum eingestellten RPC (`ketteAusRpc`), Standard Mainnet. */
  kette?: () => Promise<string>;
}

/**
 * Verbindet mit dem jeweils passenden Weg.
 *
 * Wirft nie ohne Erklärung: kann auf diesem Gerät nichts verbunden werden,
 * bekommt der Aufrufer über onNeedsDeeplink die Handy-Alternative.
 */
export async function connectSolanaWallet(opts: ConnectOptions = {}): Promise<SolanaConnection | null> {
  const env = detectSolanaEnvironment(opts.userAgentOverride);
  const w = globalThis as unknown as {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
  };
  const provider = w.solana ?? w.phantom?.solana ?? w.solflare;

  // Wallet Standard zuerst: Wer sich so anmeldet, kann auch Devnet und sagt,
  // was er kann. Still nur mit der zuletzt benutzten Wallet.
  const standard = env.method === "standard" ? solanaWallets() : [];
  if (standard.length) {
    let gewaehlt = opts.silent ? standard.find((x) => x.name === opts.gemerkt) : standard.length === 1 ? standard[0] : undefined;
    if (!opts.silent && !gewaehlt) {
      const i = await opts.waehle?.(standard.map((x) => x.name));
      if (i === null || i === undefined || !standard[i]) return null;
      gewaehlt = standard[i];
    }
    if (gewaehlt) {
      const anbieter = alsAnbieter(gewaehlt, opts.kette ?? (async () => "solana:mainnet"));
      try {
        const resp = await anbieter.connect(opts.silent ? { onlyIfTrusted: true } : undefined);
        return { pubkey: resp.publicKey.toBase58(), method: "standard", provider: anbieter, name: gewaehlt.name };
      } catch (e) {
        if (opts.silent) return null;
        throw new Error(`Wallet hat die Verbindung abgelehnt: ${(e as Error).message}`);
      }
    }
  }

  if (provider && typeof provider.connect === "function") {
    try {
      // onlyIfTrusted: verbindet ohne Popup, wenn der Nutzer die Seite schon
      // einmal erlaubt hat. Für den stillen Start beim Laden der App.
      const resp = await provider.connect(opts.silent ? { onlyIfTrusted: true } : undefined);
      return { pubkey: resp.publicKey.toBase58(), method: "injected", provider };
    } catch (e) {
      if (opts.silent) return null; // kein Vertrauen vorhanden — völlig normal
      throw new Error(`Wallet hat die Verbindung abgelehnt: ${(e as Error).message}`);
    }
  }

  if (opts.silent) return null;

  if (env.isMobile) {
    opts.onNeedsDeeplink?.(
      { phantom: buildWalletDeeplink("phantom"), solflare: buildWalletDeeplink("solflare") },
      env.hint,
    );
    return null;
  }

  throw new Error(env.hint);
}

/**
 * SOL-Guthaben über JSON-RPC. Bewusst ohne @solana/web3.js — ein einzelner
 * fetch spart im Browser-Bundle mehrere hundert Kilobyte, und mehr als
 * getBalance braucht die Anzeige nicht.
 */
export async function fetchSolBalance(
  pubkey: string,
  rpcUrl?: string,
  timeoutMs = 8000,
): Promise<{ lamports: number; sol: number }> {
  // Ueber den Pool statt ueber eine feste Adresse: Ein einzelner Endpunkt, der
  // gerade nicht antwortet, wuerde sonst die gesamte Guthaben-Anzeige lahmlegen.
  const { RpcPool, DEFAULT_MAINNET_RPCS } = await import("@freedomstack/protocol");
  const pool = new RpcPool(DEFAULT_MAINNET_RPCS, {
    userEndpoints: rpcUrl ? [rpcUrl] : [],
    timeoutMs,
    verteilen: true, // 4.9: nicht jede Guthaben-Abfrage an denselben fremden Anbieter
  });
  const lamports = await pool.getBalance(pubkey);
  return { lamports, sol: lamports / 1_000_000_000 };
}

/** Grobe Plausibilitätsprüfung einer Solana-Adresse (base58, 32 Byte). */
export function isValidSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}
