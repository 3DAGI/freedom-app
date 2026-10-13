/**
 * TON Connect im Mini App (FREEDOM_TMA=1).
 *
 * Recycled aus dem swarm-Mini-App-Template (tonconnect-ui.min.js + Manifest).
 * Ersetzt dort die SWARM-Jetton-Logik durch: native Gram-Zahlungen an die
 * Adresse des Freedom-Nodes, verifiziert über toncenter (testnet).
 *
 * Ablauf:
 * 1. Wallet verbinden (TonConnectUI, Manifest wird vom Server ausgeliefert)
 * 2. Server liefert Empfänger + eindeutigen Kommentar (`auftrag:<id>:<nonce>`)
 * 3. Client sendet `tonConnectUI.sendTransaction({ messages: [...] })`
 * 4. Server pollt toncenter getTransactions, prüft Betrag + Kommentar,
 *    markiert die tx als verbraucht (Replay-Schutz)
 *
 * WalletConnect ist in TMAs laut Telegram-Richtlinien ausgeblendet — wir
 * nutzen ausschließlich TON Connect.
 */

interface TonWallet { account: { address: string; chain?: string }; }

interface TonConnectUI {
  connected: boolean;
  account?: TonWallet["account"];
  wallet?: { device?: { appName?: string } };
  setConnectionStatus(cb: (w?: TonWallet) => void): void;
  openModal(): void;
  disconnect(): Promise<void>;
  sendTransaction(tx: { validUntil: number; messages: { address: string; amount: string; payload?: string }[] }): Promise<{ boc: string }>;
  restoreConnection(): Promise<void>;
  onStatusChange(cb: (w?: TonWallet) => void): void;
}

declare global {
  interface Window {
    TON_CONNECT_UI?: { TonConnectUI: new (o: { manifestUrl: string; language?: string; walletsListConfiguration?: Record<string, unknown> }) => TonConnectUI };
  }
}

const MANIFEST_RETRIES = 50; // 5 s

let _ui: TonConnectUI | undefined;
let _addr: string | undefined;
const _cbs = new Set<(a?: string) => void>();

export function tonAdresse(): string | undefined { return _addr; }
export function tonVerbunden(): boolean { return !!_addr; }
export function onTonStatus(cb: (a?: string) => void): () => void {
  _cbs.add(cb);
  return () => _cbs.delete(cb);
}
function emit(): void { for (const cb of _cbs) cb(_addr); }

/**
 * TonConnectUI erzeugen (Singleton). Wartet auf das Script-Tag (das der
 * Server im TMA-Build injiziert) — wie im swarm-Template.
 */
export async function tonConnectInit(manifestUrl?: string): Promise<TonConnectUI> {
  if (_ui) return _ui;
  let tries = 0;
  while (!window.TON_CONNECT_UI && tries < MANIFEST_RETRIES) {
    await new Promise((r) => setTimeout(r, 100));
    tries++;
  }
  if (!window.TON_CONNECT_UI) throw new Error("TON_CONNECT_UI nicht geladen");
  const url = manifestUrl ?? `${location.origin}/tma/tonconnect-manifest.json`;
  _ui = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: url, language: "de" });
  _ui.onStatusChange((w) => {
    _addr = w?.account?.address;
    emit();
  });
  _ui.setConnectionStatus?.((w) => { _addr = w?.account?.address; emit(); });
  await _ui.restoreConnection().catch(() => undefined);
  return _ui;
}

export async function tonVerbinden(): Promise<void> {
  const ui = await tonConnectInit();
  ui.openModal();
}

export async function tonTrennen(): Promise<void> {
  await _ui?.disconnect().catch(() => undefined);
  _addr = undefined;
  emit();
}

export interface TonZahlung {
  /** Ziel-Adresse (Node/Provider). */
  an: string;
  /** Betrag in nanoTON (String, 1 TON = 1e9 nano). */
  nano: string;
  /** Kommentar mit Auftragskennung + Nonce (eindeutig, serverseitig erzeugt). */
  kommentar: string;
}

/**
 * Sendet eine Gram-Zahlung. `validUntil` = jetzt + 5 min.
 * Resolved mit der BOC (signierter external message) — der Server verifiziert
 * anschließend on-chain. Reihenfolge und Prüfung: siehe ton-verify.ts (Node).
 */
export async function zahleMitTon(z: TonZahlung): Promise<{ boc: string }> {
  const ui = _ui ?? await tonConnectInit();
  if (!_addr) throw new Error("Wallet nicht verbunden");
  const tx = {
    validUntil: Math.floor(Date.now() / 1000) + 300,
    messages: [{ address: z.an, amount: z.nano, payload: kommentarBase64(z.kommentar) }],
  };
  return await ui.sendTransaction(tx);
}

/** Kommentar → Base64 (TL-B Text-Kommentar, op 0x00000000). */
export function kommentarBase64(kommentar: string): string {
  const bytes = new TextEncoder().encode(kommentar);
  // Kommentar-Message: 32-bit op=0 + Text
  const buf = new Uint8Array(4 + bytes.length);
  buf[0] = buf[1] = buf[2] = buf[3] = 0;
  buf.set(bytes, 4);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Einen eindeutigen Auftrags-Kommentar erzeugen (clientseitige Nonce). */
export function auftragsKommentar(auftrag: string, nonce = Math.random().toString(36).slice(2, 10)): string {
  return `freedom:${auftrag}:${nonce}`;
}
