/**
 * Gemeinsamer Zustand der App-Shell: Konstanten, Identitaets- und
 * Verbindungszustand, Relay- und RPC-Pool, Session-Client, Provider-Suche.
 *
 * wireRpcSetting steht hier, weil es rpcPool zuruecksetzt – eine importierte Variable
 * kann ein anderes Modul nicht neu zuweisen.
 *
 * Aus app.ts verschoben (Schritt 1.0) – woertlich, ohne Logikaenderung.
 */
import { LocalSigner, type NostrEvent, OutboxPool, type Signer, type UnsignedEvent, WebSocketRelay } from "@freedomstack/protocol";
import { ScoredProvider, discoverProviders, matchProviders } from "../matchmaking.js";
import { KiSitzungen } from "../ki-sitzung.js";
import { SessionClient } from "../session-client.js";
import { escapeHtml } from "../shell-logic.js";
import { $, toast } from "./ui.js";

// ------------------------------------------------------------- Konstanten

export const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

export const LS_KEY = "freedom.nsec";
/** Bunker-Sitzung (Schritt 1.3f): Signer, Relays, Client-Schluessel – ein Geheimnis. */
export const LS_BUNKER = "freedom.bunker";

// ------------------------------------------------------------- State

interface AppState {
  /**
   * Oeffentlicher Schluessel der Identitaet. Der private steckt seit Schritt
   * 1.3e nur noch im Signer – siehe `mitRohemSchluessel()`.
   */
  keypair: { pk: string } | null;
  /** Signiert und ver-/entschluesselt fuer die Identitaet (Schritt 1.3). */
  signer: Signer | null;
  pool: OutboxPool | null;
  lud16: string;
  sessionClient: SessionClient | null;
  /** Zuletzt verwendeter Provider (fuer Session-Wiederverwendung). */
  lastProvider: string | null;
  /**
   * SOL-Adresse des zuletzt genutzten Providers.
   *
   * Kommt aus dem Job-Result (Tag "sol_address"), nicht aus einer Eingabe:
   * eine vom Nutzer abgetippte Empfaengeradresse waere die naheliegendste
   * Stelle, um Geld an den Falschen zu sperren.
   */
  lastProviderSolAddress: string | null;
}

export const state: AppState = { keypair: null, signer: null, pool: null, lud16: "", sessionClient: null, lastProvider: null, lastProviderSolAddress: null };

/**
 * Event signieren – ueber den Signer der Identitaet, nie mit dem rohen
 * Schluessel (Schritt 1.3). So funktioniert derselbe Pfad spaeter auch mit
 * einem entfernten Signer (NIP-46).
 */
export async function signiere(ev: UnsignedEvent): Promise<NostrEvent> {
  if (!state.signer) throw new Error("Keine Identität – nichts zu signieren");
  return state.signer.signEvent(ev);
}

/** Identitaet setzen: der Schluessel geht in den Signer, im Zustand bleibt nur der Pubkey. */
export function setzeIdentitaet(sk: Uint8Array): void {
  const signer = new LocalSigner(sk);
  state.signer = signer;
  state.keypair = { pk: signer.publicKey() };
}

/** Identitaet ueber einen entfernten Signer (Bunker, Schritt 1.3f): in der App nur der Pubkey. */
export function setzeSigner(signer: Signer): void {
  state.signer = signer;
  state.keypair = { pk: signer.publicKey() };
}

/** true, wenn ein entfernter Signer (Bunker) die Identitaet haelt – dann gibt es keinen rohen Schluessel. */
export function mitBunker(): boolean {
  return state.signer !== null && !(state.signer instanceof LocalSigner);
}

/**
 * Den rohen Schluessel fuer eine Rechnung leihen, die ohne ihn nicht geht
 * (Sicherung, Nachfolge, Swap-Adressen, Export). Nur mit dem Schluessel auf
 * diesem Geraet – ein entfernter Signer (Bunker) gibt ihn nie heraus.
 */
export function mitRohemSchluessel<T>(wofuer: string, fn: (sk: Uint8Array) => T): T {
  if (!(state.signer instanceof LocalSigner)) {
    throw new Error(`${wofuer} geht nur mit dem Schlüssel auf diesem Gerät, nicht über einen Bunker`);
  }
  return state.signer.mitSchluessel(fn);
}

/** Provider-Kandidaten-Cache (Matchmaking). */
let providerCache: ScoredProvider[] | null = null;
let providerCacheAt = 0;

/** Alle bekannten Provider mit Reputation (5 min Cache). */
async function bekannteProvider(): Promise<ScoredProvider[]> {
  const pool = await ensurePool();
  const now = Date.now();
  if (!providerCache || now - providerCacheAt > 300_000) {
    providerCache = await discoverProviders(pool);
    providerCacheAt = now;
  }
  return providerCache;
}

/** Das Angebot (Kind 38025) eines bekannten Providers – Preis und Kurs (4.4b). */
export async function angebotVon(pk: string): Promise<ScoredProvider["caps"] | undefined> {
  return (await bekannteProvider()).find((c) => c.caps.pubkey === pk)?.caps;
}

/** Auto-Matchmaking: beste Provider fuer ein Tier (5min Cache). Kein manuelles pubkey. */
export async function findProviders(tier: string): Promise<ScoredProvider[]> {
  return matchProviders(await bekannteProvider(), tier as "free" | "classic" | "pro", { allowlist: getAllowlist() });
}

/**
 * Pruefer fuer eine Reklamation (Schritt 3.4): andere Provider als der
 * beschuldigte, die meisten erledigten Auftraege zuerst.
 */
export async function prueferKandidaten(beschuldigt: string): Promise<ScoredProvider[]> {
  return (await bekannteProvider())
    .filter((c) => c.caps.pubkey !== beschuldigt)
    .sort((x, y) => y.score - x.score);
}


/** Allowlist: eigene/vertraute provider (pubkeys), die immer prioritaet haben.
 *  Der user kann eigene provider hinzufuegen (z.B. der eigene gx10). */
function getAllowlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem("freedom.allowlist") ?? "[]");
  } catch { return []; }
}

/** Setzt den eigenen Provider als einzigen erlaubten (Test-Modus). */
export function setOwnProvider(pubkey: string): void {
  localStorage.setItem("freedom.allowlist", JSON.stringify([pubkey]));
  providerCache = null; // Cache invalidieren
  providerCacheAt = 0;
}

/** Gibt den eigenen Provider-Key aus der URL oder null. */
export function getOwnProviderFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("provider") || params.get("pk");
}

// ------------------------------------------------------------- Relay-Pool

/**
 * Solana-Endpunkt bestimmen — ueber einen Pool mit Ausweichmoeglichkeit.
 *
 * Vorher stand `api.mainnet-beta.solana.com` an fuenf Stellen fest im Code:
 * der Endpunkt eines einzelnen Unternehmens, mit Ratenbegrenzung und
 * Sperrmoeglichkeit. Faellt er aus, funktionieren Deposits, Swaps und die
 * Deposit-Pruefung nicht mehr.
 *
 * Der Pool merkt sich Ausfaelle und ueberspringt tote Endpunkte, statt bei
 * jeder Anfrage erneut auf ein Timeout zu laufen. Eigene Knoten des Nutzers
 * kommen zuerst.
 */
let rpcPool: import("@freedomstack/protocol").RpcPool | null = null;



async function ensureRpcPool(): Promise<import("@freedomstack/protocol").RpcPool> {
  if (rpcPool) return rpcPool;
  const { RpcPool, parseUserEndpoints, DEFAULT_MAINNET_RPCS } = await import("@freedomstack/protocol");
  const eigene = parseUserEndpoints(localStorage.getItem("freedom.sol.rpcs"));
  const konfiguriert = (window as unknown as { FREEDOM_SOL_RPC?: string }).FREEDOM_SOL_RPC;
  rpcPool = new RpcPool(DEFAULT_MAINNET_RPCS, {
    userEndpoints: [...(konfiguriert ? [konfiguriert] : []), ...eigene],
  });
  return rpcPool;
}

/** Eigene RPC-Endpunkte eintragen und pruefen. */
export async function wireRpcSetting(): Promise<void> {
  const input = $("#sol-rpcs") as HTMLInputElement | null;
  const save = $("#sol-rpcs-save");
  const check = $("#sol-rpcs-check");
  const status = $("#sol-rpcs-status");
  if (!input || !save || !check || !status) return;

  input.value = localStorage.getItem("freedom.sol.rpcs") ?? "";

  save.onclick = () => {
    localStorage.setItem("freedom.sol.rpcs", input.value.trim());
    rpcPool = null; // beim naechsten Zugriff neu aufbauen
    toast("Endpunkte gespeichert");
  };

  check.onclick = async () => {
    status.textContent = "prüfe …";
    try {
      rpcPool = null;
      const pool = await ensureRpcPool();
      const st = await pool.healthCheck();
      status.innerHTML = st.map((s) => {
        const name = escapeHtml(s.label ?? new URL(s.url).hostname);
        return s.available
          ? `<span class="ok">${name} · ${s.lastLatencyMs ?? "?"} ms</span>`
          : `<span class="err">${name} · ${escapeHtml(s.lastError ?? "keine Antwort")}</span>`;
      }).join("<br>");
    } catch (e) {
      status.textContent = (e as Error).message;
      status.className = "mono-sm err";
    }
  };
}

/** Transaktion ueber den RPC-Pool laden (Pruefung von Belegen, Schritt 4.7b). */
export async function solTransaktion(signatur: string): Promise<unknown> {
  return (await ensureRpcPool()).getTransaction(signatur);
}

/** Beste erreichbare RPC-URL fuer Bibliotheken, die eine feste Adresse wollen. */
export async function solRpcUrl(): Promise<string> {
  return (await ensureRpcPool()).bestUrl();
}


export async function ensurePool(): Promise<OutboxPool> {
  if (state.pool) {
    (window as unknown as { freedomPool?: OutboxPool }).freedomPool = state.pool;
    return state.pool;
  }
  // Gemerkte Funde aus der letzten Sitzung sofort mitnehmen: Wer beim Start
  // erst entdecken muesste, haengt beim ersten Job an denselben vier fremden
  // Servern wie vorher.
  const gemerkt = ladeGemerkteRelays();
  const urls = [...new Set([...RELAYS, ...gemerkt])];
  const relays = urls.map((url) => new WebSocketRelay(url, { timeoutMs: 8000 }));
  state.pool = new OutboxPool(relays, { minAcks: 1 });

  // Entdeckung im Hintergrund — sie darf den ersten Job nicht verzoegern.
  void entdeckeRelays();
  return state.pool;
}

const LS_RELAYS = "freedom.relays";

function ladeGemerkteRelays(): string[] {
  try {
    const raw = localStorage.getItem(LS_RELAYS);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 8) : [];
  } catch {
    return [];
  }
}

/**
 * Entdeckt Relays des Netzes und merkt sich die brauchbaren.
 *
 * Der Client hing an vier fest verdrahteten Adressen fremder Betreiber.
 * Filtern die eure Job-Kinds, ist das Netz tot — nicht beschaedigt, tot.
 * Ab jetzt sind sie ein STARTPUNKT: ueber sie werden die Relays der Provider
 * gefunden, und die bleiben erhalten.
 */
async function entdeckeRelays(): Promise<void> {
  try {
    const pool = state.pool!;
    const {
      discoverRelays, buildRelaySet, KIND_RELAY_LIST, KIND_PERFORMANCE,
    } = await import("@freedomstack/protocol");

    const [listen, arbeit] = await Promise.all([
      pool.query({ kinds: [KIND_RELAY_LIST], limit: 500 }),
      pool.query({
        kinds: [KIND_PERFORMANCE],
        since: Math.floor(Date.now() / 1000) - 7 * 24 * 3600,
        limit: 500,
      }),
    ]);

    // Wer nachweislich gearbeitet hat, dessen Relay-Angabe wiegt schwerer.
    // Eine blosse Anzahl liesse sich mit Wegwerf-Schluesseln erzeugen.
    const arbeiter = new Set(arbeit.map((e) => e.pubkey));
    const { relays } = discoverRelays(listen, { trustedPubkeys: arbeiter, known: RELAYS });
    if (relays.length === 0) return;

    const set = await buildRelaySet({
      seedUrls: RELAYS,
      discovered: relays,
      makeRelay: (u) => new WebSocketRelay(u, { timeoutMs: 6000 }),
      maxTotal: 8,
    });

    const neu = set.urls.filter((u) => !RELAYS.includes(u));
    if (neu.length > 0) {
      localStorage.setItem(LS_RELAYS, JSON.stringify(neu));
      console.log(`[relay] ${neu.length} Relay(s) des Netzes gefunden — beim naechsten Start aktiv`);
    }
  } catch (e) {
    // Entdeckung ist eine Verbesserung, kein Muss: Ohne sie laeuft alles
    // weiter wie bisher.
    console.warn(`[relay] Entdeckung fehlgeschlagen: ${(e as Error).message}`);
  }
}

/** Sitzungsschluessel je Provider fuer KI-Auftraege (Schritt 3.1) – nur im Speicher. */
export const kiSitzungen = new KiSitzungen();

/** Rechenarbeit laut Angebot je Provider (Schritt 3.1) – fuer Anfragen, Sitzung und Belege. */
export const powJeProvider = new Map<string, number>();

export function ensureSessionClient(): SessionClient {
  if (state.sessionClient) return state.sessionClient;
  if (!state.pool) throw new Error("Pool fehlt");
  state.sessionClient = new SessionClient({
    signerFuer: (providerPk) => kiSitzungen.fuer(providerPk),
    powFuer: (providerPk) => powJeProvider.get(providerPk) ?? 0,
    pool: state.pool,
    defaultBudgetSats: 100,
    settleEverySats: 20,
    ttlSecs: 3600,
  });
  return state.sessionClient;
}

// ------------------------------------------------------------- Tabs

// --------------------------------------------------- Anhaenge (Chat/Community)
//
// Frueher haing das am oeffentlichen Feed. Der ist entfernt (unmoderierter
// globaler Stream), die Upload-Kette ueber das Chunk-Netz bleibt aber und
// bedient jetzt den Chat-Composer — Communities koennen damit Medien teilen.
