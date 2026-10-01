/**
 * freedomstack-node: Provider-Knoten Daemon.
 *
 * Start:
 *   NODE_SECRET_KEY=<hex64> NODE_LUD16=you@wallet.cash \
 *     node --import tsx src/main.ts
 *
 * Verhalten:
 *   - verbindet sich mit mehreren Nostr-Relays (RELAYS env, Komma-getrennt)
 *   - lauscht auf DVM-Jobs (kind 5050)
 *   - rechnet lokal via Ollama
 *   - publiziert Results + Leistungs-Events
 *   - verwahrt NICHTS (non-custodial by design)
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  generateKeypair,
  OutboxPool,
  WebSocketRelay,
  MemoryRelay,
  fromHex,
  startUrls,
  toHex,
} from "@freedomstack/protocol";
import { DvmProvider, DEFAULT_PROVIDER_CONFIG } from "./dvm-provider.js";
import { kanalKasseAusUmgebung, kanalOrte } from "./kanal-kasse.js";
import { befundeText, holeJson, kettenBlick, pruefeEinrichtung } from "./einrichtung.js";
import { kopplungsDatei, leseKopplung } from "./kopplung-datei.js";
import { torAusUmgebung, torWebSocket } from "./tor.js";
import { OllamaBackend } from "./inference.js";
import http from "node:http";

/** Ohne RELAYS: die ganze Startliste (5.4) – so teilt jede App-Sitzung Relays mit dem Knoten. */
const RELAYS_DEFAULT = startUrls().join(",");

function loadKeypair() {
  const skHex = process.env.NODE_SECRET_KEY;
  if (!skHex) {
    const kp = generateKeypair();
    console.log("==========================================================");
    console.log("Kein NODE_SECRET_KEY gesetzt -> neuer Key generiert.");
    console.log("Sichere ihn und setze ihn beim naechsten Start:");
    console.log(`  NODE_SECRET_KEY=${Buffer.from(kp.sk).toString("hex")}`);
    console.log(`  pubkey=${kp.pk}`);
    console.log("==========================================================");
    return kp;
  }
  const sk = fromHex(skHex);
  return { sk, pk: toHex(schnorr.getPublicKey(sk)) };
}

/**
 * Zeitpunkt der ersten Provider-Registrierung, persistent.
 *
 * Steuert das Ende der 24h-Bootstrap-Gratisphase. Liegt in einer Datei, damit
 * ein Neustart die Phase nicht zurueckdreht. PROVIDER_SINCE (env) hat Vorrang,
 * z.B. um eine Migration von einem alten Node zu uebernehmen.
 */
function loadProviderSince(): number {
  if (process.env.PROVIDER_SINCE) return Number(process.env.PROVIDER_SINCE);

  const dir = join(process.env.HOME ?? ".", ".freedom");
  const file = join(dir, "provider-since");
  try {
    const saved = Number(readFileSync(file, "utf8").trim());
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch { /* erster Start */ }

  const now = Math.floor(Date.now() / 1000);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, String(now), { mode: 0o600 });
    console.log(`Erste Registrierung vermerkt (${file}) — Bootstrap-Phase laeuft 24h ab jetzt.`);
  } catch (e) {
    console.warn(
      `[bootstrap] konnte ${file} nicht schreiben (${(e as Error).message}) — ` +
      `die Gratisphase startet bei jedem Neustart neu. PROVIDER_SINCE setzen!`,
    );
  }
  return now;
}

/**
 * Lightning-Adressen der Provider aus ihren Faehigkeiten-Events (38025).
 *
 * Ohne Adresse kann der Pool niemanden bezahlen. Der Betrag bleibt dann im
 * Topf und wandert in die naechste Epoche — er faellt nicht dem Betreiber zu.
 */
/** Erreichbarer Solana-Endpunkt aus dem Pool. */
function defaultSolanaRpc(): string {
  try {
    // Synchron, weil die Provider-Konfiguration synchron gebaut wird.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RpcPool, DEFAULT_MAINNET_RPCS } = require("@freedomstack/protocol") as
      typeof import("@freedomstack/protocol");
    return new RpcPool(DEFAULT_MAINNET_RPCS).bestUrl();
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const lud16 = process.env.NODE_LUD16;
  if (!lud16) {
    console.error("NODE_LUD16 (eigene Lightning-Adresse fuer Zap-Empfang) fehlt.");
    process.exit(1);
  }
  const { adresseFuer } = await import("@freedomstack/protocol");
  if (!adresseFuer({ lud16 }, "lightning")) {
    console.error("NODE_LUD16 ist keine Lightning-Adresse (name@domain) – dorthin zahlt die App den Anteil des Providers.");
    process.exit(1);
  }
  // Werber dieses Providers (5.1): bekommt 0,5 % jedes Auftrags direkt von der App des Kunden
  const werber = process.env.PROVIDER_WERBER_LUD16 ? adresseFuer({ lud16: process.env.PROVIDER_WERBER_LUD16 }, "lightning") : undefined;
  if (process.env.PROVIDER_WERBER_LUD16 && !werber) {
    console.error("PROVIDER_WERBER_LUD16 ist keine Lightning-Adresse (name@domain).");
    process.exit(1);
  }
  const storageEnabled = process.env.STORAGE_ENABLED === "1";

  const keypair = loadKeypair();
  const backend = new OllamaBackend();

  const ollamaOk = await backend.available();
  if (!ollamaOk) {
    console.error(`Ollama nicht erreichbar (${backend.name()}). Daemon beendet.`);
    process.exit(1);
  }
  console.log(`Inference-Backend bereit: ${backend.name()}`);

  // Relays: aus env, sonst oeffentliche Defaults. Offline-Relays werden beim
  // ersten Publish sichtbar; OutboxPool toleriert Teilausfaelle (minAcks).
  const relayUrls = (process.env.RELAYS ?? RELAYS_DEFAULT).split(",").map((s) => s.trim());
  const useMemory = process.env.MEMORY_RELAY === "1";
  // Tor (8.2c): mit TOR_SOCKS gehen alle Relay-Verbindungen durch Tor. Ungültig → kein Start,
  // sonst ginge der Knoten still ohne Tor ins Netz
  const { proxy: torProxy, grund: torGrund } = torAusUmgebung(process.env);
  if (torGrund) {
    console.error(`[tor] ${torGrund} – der Knoten startet nicht ohne Tor, wenn Tor verlangt ist`);
    process.exit(1);
  }
  if (torProxy) console.log(`[tor] Relays über Tor (SOCKS ${torProxy.host}:${torProxy.port}) – Solana-RPC, LND und Ollama nicht`);
  const verbinde = torProxy ? torWebSocket(torProxy) : undefined;
  const relays = useMemory
    ? [new MemoryRelay("mem://local")]
    : relayUrls.map((url) => new WebSocketRelay(url, { verbinde }));
  const pool = new OutboxPool(relays, { minAcks: useMemory ? 1 : Math.min(2, relays.length) });

  // Rechenarbeit fuer private Anfragen (3.1) – steht im Angebot. Ueber 24 rechnet
  // ein Handy Minuten; die App wiese solche Angebote ab.
  const privatePowBits = Math.min(24, Math.max(0, Math.floor(Number(process.env.PRIVATE_POW_BITS ?? DEFAULT_PROVIDER_CONFIG.privatePowBits))));
  // Schritt 3.3: Anfragen und Antworten stehen standardmaessig in keinem Log.
  const klartextProtokoll = process.env.LOG_KLARTEXT === "1";
  if (klartextProtokoll) {
    console.warn("[datenschutz] LOG_KLARTEXT=1 – Antworten erscheinen im Log. Nur zur Fehlersuche, danach wieder ausschalten.");
  }
  // Zahlkanal (4.3c): nur mit ZAHLKANAL=1 und passendem Solana-Schlüssel
  const solRpc = process.env.SOLANA_RPC_URL || defaultSolanaRpc();
  const { kasse: kanalKasse, grund: kanalGrund, auszahlung, auszahlungGrund } = await kanalKasseAusUmgebung(process.env, {
    rpcUrl: solRpc,
    ...kanalOrte(),
  });
  console.log(kanalKasse ? `[kanal] Zahlkanal an (Provider ${process.env.NODE_SOL_ADDRESS})` : `[kanal] Zahlkanal ${kanalGrund}`);
  if (kanalKasse) console.log(auszahlung ? `[kanal] Auszahlung an ${process.env.NODE_SOL_PAYOUT}` : `[kanal] Auszahlung ${auszahlungGrund}`);
  // Selbstprüfung (8.2a): verdient der Knoten in beiden Schienen? Nur ins Log, blockiert den Start nicht
  void kettenBlick(solRpc).catch(() => undefined)
    .then((kette) => pruefeEinrichtung(process.env, {
      holen: (u) => holeJson(u), kanal: { kasse: kanalKasse, grund: kanalGrund, auszahlung, auszahlungGrund }, kette,
    }))
    .then((befunde) => console.log(befundeText(befunde).replace(/^/gm, "[einrichtung] ")))
    .catch((e) => console.warn(`[einrichtung] Prüfung nicht möglich (${(e as Error).name})`));
  // Kopplung mit dem Besitzer (B-8b): je Anfrage frisch gelesen – ein neues Geheimnis (npm run koppeln -- --neu) gilt sofort
  const kopplungOrt = kopplungsDatei();
  console.log(leseKopplung(kopplungOrt, keypair.pk) ? "[kopplung] mit dem Besitzer gekoppelt" : "[kopplung] nicht gekoppelt – npm run koppeln");
  const provider = new DvmProvider(
    {
      keypair,
      lud16,
      werber,
      besitzer: () => { const k = leseKopplung(kopplungOrt, keypair.pk); return k ? [k.geheimnis] : []; },
      pricePerKTokenMsat: Number(process.env.PRICE_PER_K_TOKEN_MSAT ?? DEFAULT_PROVIDER_CONFIG.pricePerKTokenMsat),
      minBidMsat: Number(process.env.MIN_BID_MSAT ?? DEFAULT_PROVIDER_CONFIG.minBidMsat),
      powDifficulty: Number(process.env.POW_DIFFICULTY ?? DEFAULT_PROVIDER_CONFIG.powDifficulty),
      privatePowBits,
      klartextProtokoll,
      seasonId: process.env.SEASON_ID ?? DEFAULT_PROVIDER_CONFIG.seasonId,
      // Ohne beides werden SOL-Deposits abgelehnt — ungeprueft akzeptieren
      // hiesse, dem Kunden die Pruefung seiner eigenen Zahlung zu ueberlassen.
      region: process.env.REGION,
      // Ohne eigene Angabe waehlt der Pool einen erreichbaren oeffentlichen
      // Endpunkt — ein fest verdrahteter Anbieter waere ein einzelner
      // Ausfallpunkt fuer die gesamte Deposit-Pruefung.
      solanaRpcUrl: process.env.SOLANA_RPC_URL || defaultSolanaRpc(),
      depositMinRemainingSeconds: process.env.DEPOSIT_MIN_REMAINING_SECONDS
        ? Number(process.env.DEPOSIT_MIN_REMAINING_SECONDS)
        : undefined,
      // Bootstrap-Phase: der Zeitpunkt der ERSTEN Registrierung muss einen
      // Neustart ueberleben. Vorher wurde hier bei jedem Start `Date.now()`
      // gesetzt — ein Provider, der taeglich neu startet, blieb damit dauerhaft
      // in der 24h-Gratisphase und hat nie etwas verdient.
      providerSince: loadProviderSince(),
      // Protokoll v1: Free-Tier standardmäßig AN (2000 tokens/Tag/Pubkey) —
      // ohne Gratis-Antworten testet niemand das Netz. Provider kann es via
      // FREE_TOKENS_PER_DAY=0 bewusst abstellen.
      freeTokensPerPubkeyPerDay: Number(process.env.FREE_TOKENS_PER_DAY ?? 2000),
      // SOL-Preis (alle Preise in SOL verfuegbar): SOL_PRICE_SATS=150000 (1 SOL ~ 150k sats)
      solPriceSats: process.env.SOL_PRICE_SATS ? Number(process.env.SOL_PRICE_SATS) : undefined,
      solanaAddress: process.env.NODE_SOL_ADDRESS || undefined,
      kanalKasse,
    },
    pool,
    backend,
    undefined, // toolRegistry (default)
    // Storage-Rolle (wenn STORAGE_ENABLED=1): aktiviert Blob-Fetch-Jobs (5075)
    process.env.STORAGE_ENABLED === "1"
      ? new (await import("./storage-role.js")).StorageRole({
          dir: process.env.STORAGE_DIR ?? join(process.env.HOME ?? ".", "freedom-data", "storage"),
          quotaBytes: Number(process.env.STORAGE_QUOTA_MB ?? 10240) * 1024 * 1024,
          bootstrapSeeder: process.env.BOOTSTRAP_SEEDER === "1",
        })
      : undefined,
  );
  // storage init frueh (vor dem poll-loop)
  if (provider.storage) await provider.storage.init();

  // Quota-API: GET /api/quota?pk=<hex> → Free-Kontingent-Status des Kunden.
  // Die App zeigt daraus "noch X gratis tokens heute" + Wallet-CTA bei 0.
  const quotaPort = Number(process.env.QUOTA_API_PORT ?? 3602);
  // NIP-98: Die Nostr-Identitaet IST der Zugang. Ohne sie koennte jeder den
  // Speicher eines fremden Knotens fuellen — die Rolle hatte bisher gar keine
  // Authentifizierung.
  const { checkHttpAuth } = await import("@freedomstack/protocol");

  const quotaServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${quotaPort}`);

      // Schreibende Zugriffe brauchen einen Ausweis. Lesende nicht — die
      // Quota-Auskunft ist oeffentlich und verraet nichts.
      if (req.method && req.method !== "GET") {
        const auth = checkHttpAuth(
          req.headers.authorization, url.toString(), req.method,
        );
        if (!auth.ok) {
          // Grund ins Log, nicht in die Antwort: Einem Angreifer zu sagen,
          // WARUM sein Ausweis nicht passt, hilft ihm beim naechsten Versuch.
          console.warn(`[api] abgelehnt: ${auth.reason}`);
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "nicht berechtigt" }));
          return;
        }
      }
      if (url.pathname === "/api/quota") {
        const pk = url.searchParams.get("pk") ?? "";
        if (!/^[0-9a-f]{64}$/.test(pk)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "pk query-param (hex64) required" }));
          return;
        }
        res.end(JSON.stringify(provider.freeQuotaFor(pk)));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: (e as Error).message.slice(0, 120) }));
    }
  });
  quotaServer.listen(quotaPort, () => {
    console.log(`Quota-API aktiv: http://0.0.0.0:${quotaPort}/api/quota?pk=<hex>`);
  });

  // Relay-Rolle (optional): eigener NIP-01-Relay im selben Prozess.
  // RELAY_ENABLED=1 RELAY_PORT=7777 — zensur-resistente eigene Infrastruktur.
  const relayEnabled = process.env.RELAY_ENABLED === "1";
  let relayRole: import("./relay-role.js").RelayRole | undefined;
  if (relayEnabled) {
    const { RelayRole, RelayZugang } = await import("./relay-role.js");
    // Zugang (8.4): RELAY_BESCHRAENKT=1 nimmt nur von und an Schluessel mit Zugang an;
    // dauerhaft in RELAY_ZUGANG (kommagetrennt, hex), sonst aus der Datei.
    const dauerhaft = [keypair.pk, ...(process.env.RELAY_ZUGANG ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f]{64}$/.test(s))];
    const zugang = new RelayZugang(join(process.env.HOME ?? ".", ".freedom", "relay-zugang.json"), dauerhaft);
    await zugang.laden();
    // Zugang kaufen (8.4b): RELAY_PREIS_SATS je RELAY_ZUGANG_TAGE ueber eine Rechnung des eigenen LND
    // (RELAY_LND_MACAROON: nur invoices-Rechte), RELAY_PREIS_LAMPORTS an RELAY_SOL_ADRESSE, geprueft auf der Kette.
    const { RelayKasse } = await import("./relay-kasse.js");
    const { LndLightningAdapter: Lnd, RpcPool, fromHex, loadMacaroonHex, pruefeRelayMacaroon, toHex } = await import("@freedomstack/protocol");
    const preisSats = Number(process.env.RELAY_PREIS_SATS ?? 0);
    const preisLamports = Number(process.env.RELAY_PREIS_LAMPORTS ?? 0);
    let rechnungen: import("./relay-kasse.js").Rechnungen | undefined;
    if (Number.isSafeInteger(preisSats) && preisSats > 0 && process.env.RELAY_LND_MACAROON) {
      const hex = await loadMacaroonHex(process.env.RELAY_LND_MACAROON);
      const ok = pruefeRelayMacaroon(hex);
      if (!ok.ok) {
        console.error(`[relay] RELAY_LND_MACAROON: ${ok.grund} – keine Sats (lncli bakemacaroon invoices:read invoices:write)`);
      } else {
        const ln = new Lnd({ restUrl: process.env.LND_REST ?? "https://127.0.0.1:8080", macaroonHex: hex, allowInsecureTls: process.env.LND_INSECURE_TLS === "1" });
        rechnungen = {
          rechnung: async (sats, notiz, gueltigSek) => {
            const r = await ln.createInvoice(sats, { notiz, gueltigSek });
            return { bolt11: r.bolt11, hash: toHex(r.paymentHash) };
          },
          bezahlt: async (hash) => (await ln.getInvoiceState(fromHex(hash))) === "SETTLED",
        };
      }
    }
    const solAdresse = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(process.env.RELAY_SOL_ADRESSE ?? "") ? process.env.RELAY_SOL_ADRESSE : undefined;
    // Ein eigener Endpunkt allein – sonst mischte der Pool Mainnet dazu (Devnet-Tests)
    const rpc = process.env.SOLANA_RPC_URL ? new RpcPool([{ url: process.env.SOLANA_RPC_URL }]) : new RpcPool();
    const kasse = new RelayKasse({
      tage: Number.isSafeInteger(Number(process.env.RELAY_ZUGANG_TAGE)) && Number(process.env.RELAY_ZUGANG_TAGE) > 0 ? Number(process.env.RELAY_ZUGANG_TAGE) : 30,
      sats: Number.isSafeInteger(preisSats) && preisSats > 0 ? preisSats : undefined,
      lamports: Number.isSafeInteger(preisLamports) && preisLamports > 0 ? preisLamports : undefined,
      solAdresse,
      rechnungen,
      ladeTransaktion: solAdresse ? (sig) => rpc.getTransaction(sig) : undefined,
      zugang,
      datei: join(process.env.HOME ?? ".", ".freedom", "relay-angebote.json"),
      jetzt: () => Math.floor(Date.now() / 1000),
    });
    await kasse.laden();
    if (kasse.schienen().length > 0) console.log(`[relay] Zugang zu kaufen: ${kasse.schienen().join(", ")}`);
    relayRole = new RelayRole({
      port: Number(process.env.RELAY_PORT ?? 7777),
      retentionDays: Number(process.env.RELAY_RETENTION_DAYS ?? 30),
      maxEventBytes: Number(process.env.RELAY_MAX_EVENT_BYTES ?? 262144),
      oeffentlicheUrl: process.env.RELAY_PUBLIC_URL,
      pubkey: keypair.pk,
      beschraenkt: process.env.RELAY_BESCHRAENKT === "1",
      // Seit 8.4c meldet sich die App an – Umschlaege nur an den angemeldeten Empfaenger; =0 schaltet ab.
      umschlaegeSchuetzen: process.env.RELAY_UMSCHLAEGE_NUR_ANGEMELDET !== "0",
      zugang,
      kasse,
      eventDatei: join(process.env.HOME ?? ".", ".freedom", "relay-events.json"),
      maxEvents: Number(process.env.RELAY_MAX_EVENTS ?? 100_000),
    });
    await relayRole.start();
  }

  // Funk-Gateway (optional, 7.4b2): FUNK_GATEWAY=host:port – TCP-Brücke zum
  // Funkgerät (z. B. ser2net). Reicht versiegelte KI-Aufträge aus dem Funk ins
  // Netz und funkt die Antworten gemerkter Sitzungen in der Sendezeit zurück.
  let funkGateway: import("./gateway-role.js").GatewayRolle | undefined;
  if (process.env.FUNK_GATEWAY) {
    const { GatewayRolle, funkBruecke } = await import("./gateway-role.js");
    const { LocalSigner } = await import("@freedomstack/protocol");
    // Fehler nie unbehandelt: Ein kaputtes Paket darf den Knoten nicht beenden (nur der Fehlername ins Log)
    const strecke = funkBruecke(process.env.FUNK_GATEWAY, (f) => void funkGateway?.empfange(f).catch((e) => console.warn(`[funk] ${(e as Error).name}`)));
    funkGateway = new GatewayRolle({ strecke, gateway: new LocalSigner(keypair.sk), netz: pool });
    funkGateway.starte();
    console.log("[funk] Gateway an (TCP-Brücke zum Funkgerät)");
  }

  // Sweep der Wochen-Wallets und ihr Arweave-Spiegel sind seit 5.1.4a entfernt:
  // Nach Gebührenmodell A+ gibt es keine Rücklage mehr, die jemand einsammelt.
  if (process.env.SWEEP_TARGET_WALLET || process.env.ARWEAVE_MIRROR === "1") {
    console.warn("[fee] SWEEP_TARGET_WALLET und ARWEAVE_MIRROR werden nicht mehr gelesen (Gebührenmodell A+, 5.1).");
  }
  // Eigener Lightning-Empfang (8.2b): Lightning-Adresse beim eigenen LND statt bei einem
  // verwahrenden Dienst. Hinter einem Reverse-Proxy mit TLS; NODE_LUD16 = <name>@<domain>.
  if (process.env.LNURL_ENABLED === "1") {
    const { LnurlDienst, lnurlAusUmgebung, starteLnurlServer } = await import("./lnurl-server.js");
    const { loadMacaroonHex } = await import("@freedomstack/protocol");
    const r = await lnurlAusUmgebung(process.env, loadMacaroonHex);
    if ("grund" in r) {
      console.error(`[lnurl] aus – ${r.grund}`);
    } else {
      starteLnurlServer(new LnurlDienst(r.konfig, r.quelle), Number(process.env.LNURL_PORT || 3601));
      const eigene = `${r.konfig.name}@${r.konfig.domain}`;
      console.log(`[lnurl] Lightning-Adresse ${eigene} beim eigenen LND (Port ${process.env.LNURL_PORT || 3601}, hinter dem Reverse-Proxy)`);
      if (lud16.toLowerCase() !== eigene) console.warn(`[lnurl] NODE_LUD16 ist ${lud16} – die App zahlt dorthin, nicht an ${eigene}`);
    }
  }

  // 1-Klick-Einstieg: Capabilities publizieren (Tier aus Modell, Default-Preise).
  // MoA: PROVIDER_MODELS = kommaseparierte liste (z.B. "nemotron-3.5-lightning,qwen3.5:27b").
  // Der provider bietet ALLE an — der user waehlt, oder der provider routet.
  // Beim Start und beim Erneuern gleich gebaut: frueher fehlten beim Erneuern
  // Speicherangabe und (seit 3.1) die Rechenarbeit fuer private Anfragen.
  const baueAngebot = async () => {
    const { buildCapabilities, defaultPriceFor, DEFAULT_TOOL_PRICES, signEvent, KANAL_PROGRAMM_ID } = await import("@freedomstack/protocol");
    const modelsEnv = process.env.PROVIDER_MODELS ?? process.env.OLLAMA_MODEL ?? "nemotron-3.5-lightning:30b-a3b-nvfp4";
    const models = modelsEnv.split(",").map((m) => m.trim()).filter(Boolean);
    const model = models[0]; // primaer
    const mp = defaultPriceFor(model);
    const tier = (process.env.PROVIDER_TIER as "free" | "classic" | "pro") ?? mp?.tier ?? "classic";
    const caps = buildCapabilities({
      pubkey: keypair.pk,
      tier,
      models, // ALLE modelle anbieten (MoA: nemotron + qwen3.5:27b)
      textRatePerKTokenMsat: Number(process.env.PRICE_PER_K_TOKEN_MSAT ?? (mp ? (mp.inputSatsPerK + mp.outputSatsPerK) * 500 : 1500)),
      tools: DEFAULT_TOOL_PRICES.map((t) => ({ kind: t.kind, name: t.name, priceMsat: t.satsPerCall * 1000 })),
      currentlyFree: provider.isCurrentlyFree(),
      storage: storageEnabled ? {
        capacityBytes: Number(process.env.STORAGE_QUOTA_MB ?? 10240) * 1024 * 1024,
        priceMsatPerMB: Number(process.env.STORAGE_PRICE_MSAT_PER_MB ?? 1),
        bootstrap: process.env.BOOTSTRAP_SEEDER === "1",
      } : undefined,
      powBits: privatePowBits,
      // Mit diesem Kurs rechnet der Anbieter SOL-Preise (4.4); ohne Kurs keiner.
      kurs: provider.kurs(),
      // Gebührenmodell A+ (5.1): hierhin zahlt die App den Anteil des Providers,
      // und dem Werber (falls genannt) 0,5 % direkt
      lud16,
      werber,
      // Zahlkanal (4.3c): nur, wenn der Knoten Gutschriften auch einlösen kann
      kanal: kanalKasse && process.env.NODE_SOL_ADDRESS ? { adresse: process.env.NODE_SOL_ADDRESS, programm: KANAL_PROGRAMM_ID } : undefined,
      // Funk-Gateway (7.4b2): die App wählt es, solange sie Netz hat
      funkGateway: funkGateway !== undefined,
    });
    return { ev: signEvent(caps, keypair.sk), tier, models };
  };
  {
    const { ev, tier, models } = await baueAngebot();
    await pool.publish(ev);
    console.log(`Capabilities publiziert: tier=${tier} models=${models.join(",")} free=${provider.isCurrentlyFree()}${storageEnabled ? " storage=an" : ""} pow=${privatePowBits}`);
  }

  // NEU: Capabilities regelmaessig neu publizieren (alle 30min), damit der
  // Provider nicht als "stale" (veraltet) gefiltert wird. Der Client filtert
  // Events aelter als 24h — ohne Refresh verschwindet der Provider.
  const CAPS_REFRESH_MS = 30 * 60 * 1000; // 30 Minuten
  setInterval(async () => {
    try {
      await pool.publish((await baueAngebot()).ev);
      console.log(`[caps-refresh] Capabilities erneuert: ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[caps-refresh] Fehler:", err);
    }
  }, CAPS_REFRESH_MS);

  // Zahlkanal: fällige Gutschriften einlösen (ab Schwelle oder vor Ablauf) –
  // nur Kanal, Betrag und Fehlername ins Log
  if (kanalKasse) {
    // Nie zwei Durchgänge zugleich (ein zweites Einlösen lehnte das Programm ab – kostete aber Gebühren)
    let laeuft = false;
    const einloesen = async () => {
      if (laeuft) return;
      laeuft = true;
      try {
        for (const r of await kanalKasse.loeseFaelligeEin().catch(() => [])) {
          console.log(r.fehler
            ? `[kanal] ${r.kanal.slice(0, 8)}: ${r.fehler} (${r.betrag} Lamports)`
            : `[kanal] ${r.kanal.slice(0, 8)}: ${r.betrag} Lamports eingelöst`);
        }
        // Auszahlung (4.5): Eingelöstes gebündelt an die eigene Adresse – nur Betrag und Fehlername ins Log
        const a = await auszahlung?.pruefe().catch(() => undefined);
        if (a) console.log("fehler" in a ? `[kanal] Auszahlung: ${a.fehler} (${a.betrag} Lamports)` : `[kanal] ${a.betrag} Lamports ausgezahlt`);
      } finally {
        laeuft = false;
      }
    };
    void einloesen();
    setInterval(() => void einloesen(), 5 * 60 * 1000);
  }

  const pollMs = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
  console.log(`freedomstack-node laeuft. pubkey=${keypair.pk.slice(0, 16)}...`);
  console.log(`Relays: ${relayUrls.join(", ")} | Poll alle ${pollMs / 1000}s`);

  // Storage-Rolle (optional): Blobs seeden — torrent-artig ueber Nostr-Events.
  // STORAGE_ENABLED=1 STORAGE_DIR=~/freedom-data/storage STORAGE_QUOTA_MB=10240
  // BOOTSTRAP_SEEDER=1 haelt ALLE Chunks (Netz-Startphase).
  let storage: import("./storage-role.js").StorageRole | undefined;
  if (storageEnabled) {
    const { StorageRole } = await import("./storage-role.js");
    const os = await import("node:os");
    const dir = process.env.STORAGE_DIR ?? join(os.homedir(), "freedom-data", "storage");
    storage = new StorageRole({
      dir,
      quotaBytes: Number(process.env.STORAGE_QUOTA_MB ?? 10240) * 1024 * 1024,
      bootstrapSeeder: process.env.BOOTSTRAP_SEEDER === "1",
    });
    await storage.init();
    console.log(`Storage-Rolle aktiv: ${dir} (${storage.stats().totalBytes} bytes, bootstrap=${process.env.BOOTSTRAP_SEEDER === "1"})`);
  }

  // Blob-Chunk-Subscription: alle BLOB_CHUNK/BLOB_MANIFEST Events sehen und
  // als Seeder halten (bootstrap) bzw. nach Quota (LRU).
  if (storageEnabled && storage) {
    const { KIND_BLOB_CHUNK } = await import("@freedomstack/protocol");
    const seenChunks = new Set<string>();
    setInterval(async () => {
      try {
        // Seit 8.9a nur gekennzeichnete Stuecke, die wie Chiffrat aussehen (nimmAuf)
        const chunks = await pool.query({ kinds: [KIND_BLOB_CHUNK], limit: 200 });
        let abgelehnt = 0;
        for (const ev of chunks) {
          if (seenChunks.has(ev.id)) continue;
          seenChunks.add(ev.id);
          if (seenChunks.size > 5000) seenChunks.clear(); // ring-buffer
          if (!(await storage!.nimmAuf(ev)).ok) abgelehnt++;
        }
        if (abgelehnt > 0) console.log(`Speicher: ${abgelehnt} Stücke abgelehnt (nicht verschlüsselt oder unstimmig)`);
      } catch { /* relay offline */ }
    }, pollMs);
  }

  // Optional: LP-Modus (Swap-Liquiditaet anbieten). Braucht Lightning-Adapter
  // (LND) + Solana-Adapter; ohne beide bleibt der Knoten reiner DVM-Provider.
  const lpEnabled = process.env.LP_ENABLED === "1";
  // Ein Daemon je Richtung: LP_DIRECTION=sell-sol (Standard), buy-sol (4.6b) oder beide.
  const lps: import("./lp-daemon.js").LpDaemon[] = [];
  // Kurs des LP: Er tauscht zu diesem Kurs und veroeffentlicht ihn (Schritt 4.4) –
  // die Kurs-Events der LPs sind die Quelle des Marktkurses.
  let lpKurs: import("./lp-daemon.js").RateProvider | undefined;
  if (lpEnabled) {
    const { LpDaemon, FixedRate, hinSpeicher, rueckSpeicher } = await import("./lp-daemon.js");
    const { LndLightningAdapter, loadMacaroonHex, MockSolana, pruefeLpMacaroon } = await import("@freedomstack/protocol");
    const lndRest = process.env.LND_REST ?? "https://127.0.0.1:18080";
    const macPath = process.env.LND_MACAROON;
    if (!macPath) {
      console.error("LP_ENABLED=1 braucht LND_MACAROON (Pfad zu einer eingeschränkten Macaroon, docs/SWAPS.md)");
      process.exit(1);
    }
    // Nie admin.macaroon (8.3): Wer den Daemon uebernimmt, soll weder On-Chain-Geld
    // bewegen noch Kanaele schliessen noch sich weitere Rechte backen koennen.
    const macaroonHex = await loadMacaroonHex(macPath);
    const macaroonOk = pruefeLpMacaroon(macaroonHex);
    if (!macaroonOk.ok) {
      console.error(`LND_MACAROON: ${macaroonOk.grund} – eine mit „lncli bakemacaroon“ gebackene nehmen (docs/SWAPS.md)`);
      process.exit(1);
    }
    const ln = new LndLightningAdapter({
      restUrl: lndRest,
      macaroonHex,
      allowInsecureTls: process.env.LND_INSECURE_TLS === "1",
    });
    // Echter Solana-Adapter gegen das Devnet-HTLC (deployed in G).
    // Fallback auf Mock nur bei explizitem LP_SOL_MOCK=1 (Offline-Entwicklung).
    let sol: import("@freedomstack/protocol").SolanaHtlcAdapter;
    // Empfaenger der Sperren in der Gegenrichtung: das Konto, mit dem der Adapter einloest.
    let lpSolAdresse = process.env.LP_SOL_ADDRESS;
    if (process.env.LP_SOL_MOCK === "1") {
      const { MockSolana } = await import("@freedomstack/protocol");
      sol = new MockSolana(Number(process.env.LP_SOL_BALANCE ?? 1_000_000_000));
    } else {
      const { AnchorSolanaHtlc, loadSolanaKeypair } = await import("@freedomstack/protocol");
      const solKeypairPath = process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
      const solKp = await loadSolanaKeypair(solKeypairPath);
      lpSolAdresse = solKp.publicKey.toBase58();
      sol = new AnchorSolanaHtlc({
        rpcUrl: process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
        keypair: solKp,
      });
      console.log(`Solana-HTLC: echter Devnet-Adapter (${solKeypairPath})`);
    }
    lpKurs = new FixedRate(Number(process.env.LP_LAMPORTS_PER_SAT ?? 5000));
    const richtung = process.env.LP_DIRECTION ?? "sell-sol";
    if (!["sell-sol", "buy-sol", "beide"].includes(richtung)) {
      console.error(`LP_DIRECTION=${richtung}? Erlaubt: sell-sol, buy-sol, beide`);
      process.exit(1);
    }
    const basisId = process.env.LP_OFFER_ID ?? `lp-${keypair.pk.slice(0, 8)}`;
    const richtungen = richtung === "beide" ? ["sell-sol", "buy-sol"] as const : [richtung as "sell-sol" | "buy-sol"];
    for (const direction of richtungen) {
      lps.push(new LpDaemon(
        {
          keypair,
          offer: {
            offerId: direction === "buy-sol" && richtung === "beide" ? `${basisId}-buy` : basisId,
            pair: "LN-BTC/SOL",
            direction,
            minSats: Number(process.env.LP_MIN_SATS ?? 1000),
            maxSats: Number(process.env.LP_MAX_SATS ?? 500000),
            feePpm: Number(process.env.LP_FEE_PPM ?? 3000),
            tSolSecs: Number(process.env.LP_T_SOL_SECS ?? 3600),
            lnCltvDeltaBlocks: Number(process.env.LP_CLTV_DELTA ?? 144),
            // Gegen Blockaden (4.6d): Vorab-Gebuehr der Hinrichtung, 0 = aus.
            ...(direction === "sell-sol" ? { vorabSats: Number(process.env.LP_VORAB_SATS ?? 10) } : {}),
          },
          offerTtlSecs: Number(process.env.LP_OFFER_TTL ?? 7200),
          maxLamportsPerSwap: Number(process.env.LP_MAX_LAMPORTS ?? 500_000_000),
          solAdresse: lpSolAdresse,
          maxOffeneZahlungen: Number(process.env.LP_MAX_OFFENE_ZAHLUNGEN ?? 3),
          // Gegenrichtung: Sitzungen samt Preimage ueberdauern einen Neustart (nur fuer den Nutzer lesbar).
          speicher: direction === "buy-sol" ? rueckSpeicher(join(process.env.HOME ?? ".", ".freedom", "lp-rueck.json")) : undefined,
          // Hinrichtung (8.3): gesperrte SOL ueberdauern einen Neustart und werden nach der Frist zurueckgeholt.
          hinSpeicher: direction === "sell-sol" ? hinSpeicher(join(process.env.HOME ?? ".", ".freedom", "lp-hin.json")) : undefined,
        },
        pool,
        ln,
        sol,
        lpKurs,
      ));
    }
    for (const lp of lps) {
      const offerEvId = await lp.publishOffer();
      console.log(`LP-Angebot publiziert (${offerEvId.slice(0, 12)}...) fee=${process.env.LP_FEE_PPM ?? 3000}ppm`);
    }
  }

  // Optional: Relayer (4.6e) – zahlt die Gebuehr fuer Einloesungen von Kunden
  // ohne eigenes SOL; der Kunde erstattet sie in derselben Transaktion.
  let relayer: import("./relayer-dienst.js").RelayerDienst | undefined;
  if (process.env.RELAYER_ENABLED === "1") {
    const { RelayerDienst } = await import("./relayer-dienst.js");
    const { loadSolanaKeypair, LocalSigner, HTLC_PROGRAMM_ID } = await import("@freedomstack/protocol");
    const { Connection } = await import("@solana/web3.js");
    const rpc = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
    const conn = new Connection(rpc, "confirmed");
    relayer = new RelayerDienst({
      signer: new LocalSigner(keypair.sk),
      solKeypair: await loadSolanaKeypair(process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`),
      programmId: HTLC_PROGRAMM_ID,
      erstattungLamports: Number(process.env.RELAYER_ERSTATTUNG ?? 10_000),
      kette: /devnet/.test(rpc) ? "solana:devnet" : /testnet/.test(rpc) ? "solana:testnet" : "solana:mainnet",
      maxProStunde: Number(process.env.RELAYER_MAX_PRO_STUNDE ?? 30),
    }, pool, (roh) => conn.sendRawTransaction(roh, { skipPreflight: false, preflightCommitment: "confirmed" }));
    await relayer.veroeffentlicheAngebot();
    console.log(`Relayer aktiv (${relayer.solAdresse.slice(0, 8)}…)`);
  }

  // Gebührenmodell A+ (5.1): Der Knoten zahlt nichts mehr aus. Die App des
  // Kunden zahlt jeden Anteil direkt an seinen Empfänger, der Provider bekommt
  // seinen. Pool-Verteiler, Werbe-Pool und Rücklage gibt es nicht mehr.
  if (process.env.FEE_POOL_LUD16 || process.env.FEE_REFERRAL_LUD16 || process.env.POOL_DISTRIBUTOR === "1") {
    console.warn("[fee] FEE_POOL_LUD16, FEE_REFERRAL_LUD16 und POOL_DISTRIBUTOR werden nicht mehr gelesen (Gebührenmodell A+, 5.1).");
  }

  // Eigenen Relay ANKUENDIGEN. Ein Relay, den niemand findet, traegt nichts
  // zur Zensurresistenz bei — genau das war der Zustand vorher.
  if (relayEnabled) {
    const publicUrl = process.env.RELAY_PUBLIC_URL;
    if (publicUrl) {
      try {
        const { buildRelayList, isPlausibleRelayUrl, signEvent: sign } = await import("@freedomstack/protocol");
        const check = isPlausibleRelayUrl(publicUrl);
        if (!check.ok) {
          console.warn(`[relay] RELAY_PUBLIC_URL unbrauchbar (${check.reason}) — nicht angekuendigt.`);
        } else {
          await pool.publish(sign(buildRelayList(keypair.pk, [{ url: publicUrl }]), keypair.sk));
          console.log(`[relay] angekuendigt: ${publicUrl}`);
        }
      } catch (e) {
        console.warn(`[relay] Ankuendigung fehlgeschlagen: ${(e as Error).message}`);
      }
    } else {
      console.warn(
        "[relay] RELAY_ENABLED=1, aber RELAY_PUBLIC_URL fehlt — der Relay laeuft, " +
        "ist fuer das Netz aber unsichtbar. Oeffentliche wss://-Adresse setzen.",
      );
    }
  }

  // Sauberes Entleeren statt hartem Abschalten. Ein Neustart mitten im Job
  // kostet den Kunden sein Geld oder seine Wartezeit — und einmal reicht,
  // damit er beim naechsten Mal einen anderen Provider nimmt.
  const { DrainController } = await import("./lifecycle.js");
  const drain = new DrainController({
    maxDrainSeconds: Number(process.env.DRAIN_SECONDS ?? "300"),
    onPhase: (st) => console.log(`[lifecycle] ${st.message}`),
  });

  // Die periodischen Veroeffentlichungen. Ohne sie sind Zeitzeugen,
  // Relay-Nachweise und Attestierungen untaetig — und damit die
  // Zeitstempel-Absicherung, die Relay-Verguetung und der Vertrauensgraph.
  const { NodePublisher, publisherSelfCheck } = await import("./node-publisher.js");
  const publisher = new NodePublisher(pool, {
    keypair,
    relayUrl: process.env.RELAY_PUBLIC_URL,
    intervalSecs: Number(process.env.PUBLISH_INTERVAL_SECS ?? "3600"),
  });

  const selbst = publisherSelfCheck(
    { keypair, relayUrl: process.env.RELAY_PUBLIC_URL },
    process.env.LP_ENABLED === "1",
  );
  console.log(`[publish] ${selbst.message}`);
  for (const x of selbst.inactive) console.log(`[publish]   inaktiv: ${x}`);

  let letzteVeroeffentlichung = 0;

  let running = true;
  const beenden = (signal: string): void => {
    if (!running) return;
    console.log(`[lifecycle] ${signal} — entleere, nehme keine neuen Jobs mehr an`);
    if (drain.beginDrain()) running = false;
  };
  process.on("SIGINT", () => beenden("SIGINT"));
  process.on("SIGTERM", () => beenden("SIGTERM"));

  /** Ein fertiger Job: protokollieren. Auszahlen muss der Knoten nichts mehr (5.1). */
  const finishJob = async (j: Awaited<ReturnType<typeof provider.pollOnce>>[number]): Promise<void> => {
        const anteile = j.aufteilung.length > 0 ? ` (App zahlt selbst: ${j.aufteilung.join(", ")})` : "";
        console.log(
          `[dvm] ${j.requestId.slice(0, 8)} -> ${j.amountMsat} msat, davon Provider ${j.providerMsat}${anteile} ` +
            `${j.durationMs}ms${j.outputPreview ? ` :: ${j.outputPreview.replace(/\n/g, " ")}` : ""}`,
        );
  };

  // Bevorzugt ein Dauer-Abo: ein Job kommt an, sobald er veroeffentlicht ist,
  // statt beim naechsten Abfrageintervall (bis zu 15 s spaeter).
  let stopSubscription: (() => void) | null = null;
  try {
    stopSubscription = await provider.subscribeJobs((j) => void finishJob(j));
    console.log("[dvm] Dauer-Abo aktiv — Jobs kommen ohne Verzoegerung an");
  } catch (e) {
    console.warn(
      `[dvm] Kein Relay unterstuetzt Dauer-Abos (${(e as Error).message}) — ` +
      `fahre im Abfrage-Betrieb fort.`,
    );
  }

  while (running) {
    try {
      // Auch mit aktivem Abo weiter abfragen: waehrend eines kurzen
      // Verbindungsabrisses kann das Abo Events verpassen, und ein Job, der
      // niemandem auffaellt, sieht aus wie kein Job. Die Dedupe-Pruefung im
      // Provider verhindert Doppelarbeit.
      // Beim Entleeren keine neuen Jobs mehr holen, die laufenden aber
      // zu Ende bringen.
      if (drain.accepting) {
        for (const j of await provider.pollOnce()) {
          drain.jobStarted(j.requestId);
          try {
            await finishJob(j);
          } finally {
            drain.jobFinished(j.requestId);
          }
        }
      } else if (drain.check().phase === "bereit") {
        running = false;
      }

      // Periodisch veroeffentlichen. Der Takt laeuft mit der Hauptschleife,
      // damit kein zweiter Timer den sauberen Abbau stoert.
      const jetzt = Math.floor(Date.now() / 1000);
      const takt = Number(process.env.PUBLISH_INTERVAL_SECS ?? "3600");
      if (drain.accepting && jetzt - letzteVeroeffentlichung >= takt) {
        letzteVeroeffentlichung = jetzt;
        const r = await publisher.cycle({
          // Zahlen aus der eigenen Relay-Rolle, falls dieser Knoten eine
          // betreibt. Ohne Relay bleiben sie null, und der Nachweis
          // unterbleibt ohnehin.
          delivered: relayRole?.stats().events ?? 0,
          uniqueClients: relayRole?.stats().subscriptions ?? 0,
          rates: lpKurs && lpKurs.lamportsPerSat() > 0
            ? [{ pair: "SOL/BTC", satsPerUnit: Math.round(1e9 / lpKurs.lamportsPerSat()) }]
            : [],
          nowSecs: jetzt,
        });
        if (r.witnesses || r.relayProofs || r.tickers) {
          console.log(`[publish] ${r.witnesses} Zeuge, ${r.relayProofs} Relay-Nachweis, ${r.tickers} Kurs(e)`);
        }
        for (const e of r.errors) console.warn(`[publish] ${e}`);
      }
      for (const lp of lps) {
        if (await lp.erneuereAngebot()) console.log("[lp] Angebot erneuert");
        const swaps = await lp.pollOnce();
        for (const s of swaps) {
          console.log(`[lp] swap ${s.requestId.slice(0, 8)}: ${s.amountSats} sats <-> ${s.amountLamports} lamports (${s.phase})`);
        }
        const settled = await lp.settleSweep();
        for (const id of settled) {
          console.log(`[lp] swap ${id.slice(0, 8)} SETTLED — sats kassiert`);
        }
        for (const s of await lp.nachholen()) {
          console.log(`[lp] swap ${s.requestId.slice(0, 8)}: ${s.phase}`);
        }
        for (const s of await lp.holeAbgelaufeneZurueck()) {
          console.log(`[lp] swap ${s.requestId.slice(0, 8)} nach Ablauf: ${s.phase}`);
        }
      }
      if (relayer) {
        for (const r of await relayer.pollOnce()) console.log(`[relayer] ${r.status}${r.grund ? `: ${r.grund}` : ""}`);
      }
    } catch (err) {
      console.error("[poll] Fehler:", err);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Abo sauber abmelden, sonst bleibt beim Relay eine tote Subscription liegen.
  stopSubscription?.();
  // Relay: Events ablegen (8.4b), sonst waere die Post der letzten Minute weg
  relayRole?.stop();
  console.log("freedomstack-node beendet.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
