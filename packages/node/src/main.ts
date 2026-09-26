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
import { settleJobFees, FeeAccumulator, LnurlPayer, Payer, SettlementTargets } from "./settlement.js";
import {
  generateKeypair,
  OutboxPool,
  WebSocketRelay,
  MemoryRelay,
  fromHex,
  toHex,
} from "@freedomstack/protocol";
import { DvmProvider, DEFAULT_PROVIDER_CONFIG } from "./dvm-provider.js";
import { OllamaBackend } from "./inference.js";
import http from "node:http";

const RELAYS_DEFAULT = "wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band";

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

async function collectProviderAddresses(
  pool: import("@freedomstack/protocol").OutboxPool,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const caps = await pool.query({ kinds: [38025], limit: 2000 });
    for (const ev of caps) {
      const lud16 = ev.tags.find((t) => t[0] === "lud16")?.[1];
      if (lud16 && lud16.includes("@")) out.set(ev.pubkey, lud16);
    }
  } catch (e) {
    console.warn(`[pool] Adressen nicht abrufbar: ${(e as Error).message}`);
  }
  return out;
}

async function main(): Promise<void> {
  const lud16 = process.env.NODE_LUD16;
  if (!lud16) {
    console.error("NODE_LUD16 (eigene Lightning-Adresse fuer Zap-Empfang) fehlt.");
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
  const relays = useMemory
    ? [new MemoryRelay("mem://local")]
    : relayUrls.map((url) => new WebSocketRelay(url));
  const pool = new OutboxPool(relays, { minAcks: useMemory ? 1 : Math.min(2, relays.length) });

  // Rechenarbeit fuer private Anfragen (3.1) – steht im Angebot. Ueber 24 rechnet
  // ein Handy Minuten; die App wiese solche Angebote ab.
  const privatePowBits = Math.min(24, Math.max(0, Math.floor(Number(process.env.PRIVATE_POW_BITS ?? DEFAULT_PROVIDER_CONFIG.privatePowBits))));
  // Schritt 3.3: Anfragen und Antworten stehen standardmaessig in keinem Log.
  const klartextProtokoll = process.env.LOG_KLARTEXT === "1";
  if (klartextProtokoll) {
    console.warn("[datenschutz] LOG_KLARTEXT=1 – Antworten erscheinen im Log. Nur zur Fehlersuche, danach wieder ausschalten.");
  }
  const provider = new DvmProvider(
    {
      keypair,
      lud16,
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
      solanaRpcUrl: process.env.SOLANA_RPC_URL ?? defaultSolanaRpc(),
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
    const { RelayRole } = await import("./relay-role.js");
    relayRole = new RelayRole({
      port: Number(process.env.RELAY_PORT ?? 7777),
      retentionDays: Number(process.env.RELAY_RETENTION_DAYS ?? 30),
      maxEventBytes: Number(process.env.RELAY_MAX_EVENT_BYTES ?? 262144),
    });
    await relayRole.start();
  }

  // Treasury-Sweep (optional): Wochen-Wallets automatisch zur Haupt-Wallet.
  // SWEEP_TARGET_WALLET=<base58> + TREASURY_MASTER_SECRET_HEX (nur Treasury-Node!)
  // Läuft alle 6h; verpasste Wochen (bis 12 zurück) werden nachgeholt —
  // idempotent, Ausfälle sind kein Problem.
  const sweepTarget = process.env.SWEEP_TARGET_WALLET;
  const sweepSecret = process.env.TREASURY_MASTER_SECRET_HEX;
  if (sweepTarget && sweepSecret) {
    const runSweep = async () => {
      try {
        const { runSweepOnce } = await import("@freedomstack/protocol");
        const summary = await runSweepOnce({
          masterSecretHex: sweepSecret,
          targetWalletBase58: sweepTarget,
          rpcUrl: process.env.SOLANA_RPC,
          lookbackWeeks: Number(process.env.SWEEP_LOOKBACK_WEEKS ?? 12),
        });
        console.log(summary);
      } catch (e) {
        console.error(`[treasury-sweep] Fehler: ${(e as Error).message.slice(0, 100)} — nächster Versuch in 6h`);
      }
    };
    await runSweep(); // einmal beim Start
    setInterval(runSweep, 6 * 3600 * 1000);
  } else if (sweepTarget || sweepSecret) {
    console.warn("[treasury-sweep] SWEEP_TARGET_WALLET und TREASURY_MASTER_SECRET_HEX müssen BEIDE gesetzt sein");
  }

  // Treasury-Arweave-Mirror (optional): Payout-Announcements dauerhaft spiegeln.
  // Ausfallsicherheit: Wenn der Node lange offline ist, lesen Clients die letzte
  // gültige Wochen-Adresse von AR.IO-Gateways statt nur vom Relay.
  // ARWEAVE_MIRROR=1 + ARWEAVE_JWK_PATH=<pfad zur jwk>
  if (process.env.ARWEAVE_MIRROR === "1") {
    const mirrorRun = async () => {
      try {
        const { buildPayoutAnnouncement, deriveWeekRecipient, mirrorAnnouncement } =
          await import("@freedomstack/protocol");
        const master = process.env.TREASURY_MASTER_SECRET_HEX ?? "";
        const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
        const recipient = deriveWeekRecipient(master, week);
        const { signEvent, buildEvent, toHex } = await import("@freedomstack/protocol");
        // nostr-key des treasuries aus separater datei
        const nostrSkPath = `${process.env.HOME}/.freedom/treasury/nostr-secret.hex`;
        const fsMod = await import("node:fs/promises");
        const nostrSkHex = (await fsMod.readFile(nostrSkPath, "utf8")).trim();
        const nostrPk = toHex((await import("@noble/curves/secp256k1.js")).schnorr.getPublicKey(fromHex(nostrSkHex)));
        const ann = buildPayoutAnnouncement(
          { week, recipientAddressHex: recipient.pubkeyHex },
          nostrPk,
        );
        const signed = signEvent(buildEvent(ann.pubkey, ann.kind, ann.tags, ann.content), fromHex(nostrSkHex));
        await pool.publish(signed);
        const res = await mirrorAnnouncement({ ...ann, id: signed.id });
        console.log(`[treasury-mirror] woche ${week} gespiegelt: https://ar.io/${res.txId} (${res.sizeBytes}b)`);
      } catch (e) {
        console.error(`[treasury-mirror] Fehler: ${(e as Error).message.slice(0, 100)} — nächster Versuch in 24h`);
      }
    };
    await mirrorRun();
    setInterval(mirrorRun, 7 * 24 * 3600 * 1000); // wöchentlich
  }
  // LNURL-Server (optional): Lightning-Fee-Empfang ohne KYC.
  // LNURL_ENABLED=1 LNURL_BASE_URL=https://... LNURL_BACKEND=blink|lnd
  // BLINK_API_KEY=... BLINK_WALLET_ID=...  (oder LND_REST + LND_MACAROON)
  const lnurlEnabled = process.env.LNURL_ENABLED === "1";
  if (lnurlEnabled) {
    const { startLnurlServer, BlinkBackend, LndBackend } = await import("./lnurl-server.js");
    const backendType = process.env.LNURL_BACKEND ?? "blink";
    const backend =
      backendType === "lnd"
        ? new LndBackend(
            process.env.LND_REST ?? "https://127.0.0.1:8080",
            process.env.LND_MACAROON ?? "",
          )
        : new BlinkBackend(
            process.env.BLINK_API_KEY ?? "",
            process.env.BLINK_WALLET_ID ?? "",
          );
    startLnurlServer(
      {
        baseUrl: process.env.LNURL_BASE_URL ?? `http://localhost:${process.env.LNURL_PORT ?? 3601}`,
        domain: process.env.LNURL_DOMAIN ?? new URL(process.env.LNURL_BASE_URL ?? "http://x").hostname,
        minMsat: Number(process.env.LNURL_MIN_MSAT ?? 1000),
        maxMsat: Number(process.env.LNURL_MAX_MSAT ?? 10_000_000),
        commentAllowed: Number(process.env.LNURL_COMMENT ?? 200),
      },
      backend,
    );
  }

  // 1-Klick-Einstieg: Capabilities publizieren (Tier aus Modell, Default-Preise).
  // MoA: PROVIDER_MODELS = kommaseparierte liste (z.B. "nemotron-3.5-lightning,qwen3.5:27b").
  // Der provider bietet ALLE an — der user waehlt, oder der provider routet.
  // Beim Start und beim Erneuern gleich gebaut: frueher fehlten beim Erneuern
  // Speicherangabe und (seit 3.1) die Rechenarbeit fuer private Anfragen.
  const baueAngebot = async () => {
    const { buildCapabilities, defaultPriceFor, DEFAULT_TOOL_PRICES, signEvent } = await import("@freedomstack/protocol");
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
        const chunks = await pool.query({ kinds: [KIND_BLOB_CHUNK], limit: 200 });
        for (const ev of chunks) {
          if (seenChunks.has(ev.id)) continue;
          seenChunks.add(ev.id);
          if (seenChunks.size > 5000) seenChunks.clear(); // ring-buffer
          const getTag = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "";
          const blobId = getTag("blob");
          const idx = Number(getTag("index"));
          // hex -> bytes
          const hex = ev.content;
          const bytes = new Uint8Array(hex.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
          await storage!.put(blobId, idx, bytes);
        }
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
    const { LpDaemon, FixedRate, rueckSpeicher } = await import("./lp-daemon.js");
    const { LndLightningAdapter, loadMacaroonHex, MockSolana } = await import("@freedomstack/protocol");
    const lndRest = process.env.LND_REST ?? "https://127.0.0.1:18080";
    const macPath = process.env.LND_MACAROON;
    if (!macPath) {
      console.error("LP_ENABLED=1 braucht LND_MACAROON (Pfad zum admin.macaroon)");
      process.exit(1);
    }
    const ln = new LndLightningAdapter({
      restUrl: lndRest,
      macaroonHex: await loadMacaroonHex(macPath),
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
          },
          offerTtlSecs: Number(process.env.LP_OFFER_TTL ?? 7200),
          maxLamportsPerSwap: Number(process.env.LP_MAX_LAMPORTS ?? 500_000_000),
          solAdresse: lpSolAdresse,
          maxOffeneZahlungen: Number(process.env.LP_MAX_OFFENE_ZAHLUNGEN ?? 3),
          // Gegenrichtung: Sitzungen samt Preimage ueberdauern einen Neustart (nur fuer den Nutzer lesbar).
          speicher: direction === "buy-sol" ? rueckSpeicher(join(process.env.HOME ?? ".", ".freedom", "lp-rueck.json")) : undefined,
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

  // ------------------------------------------------- Fee-Auszahlung vorbereiten
  const settlementTargets: SettlementTargets = {
    pool: { lud16: process.env.FEE_POOL_LUD16 ?? "" },
    referral: { lud16: process.env.FEE_REFERRAL_LUD16 ?? "" },
    dev: process.env.FEE_DEV_LUD16 ? { lud16: process.env.FEE_DEV_LUD16 } : undefined,
  };
  const feeAccumulator = new FeeAccumulator(join(process.env.HOME ?? ".", ".freedom", "pending-fees.json"));
  await feeAccumulator.load();
  if (feeAccumulator.totalPending() > 0) {
    console.log(`[fee] ${feeAccumulator.totalPending()} msat aus frueheren Jobs noch offen`);
  }

  // Ohne LND kann der Knoten nichts ueberweisen. Dann wird weiterhin gerechnet
  // und offengelegt, aber ehrlich als "angekuendigt" statt als "bezahlt".
  let feePayer: Payer | undefined;
  const lndUrl = process.env.LND_REST_URL;
  if (lndUrl && process.env.LND_MACAROON_HEX) {
    const { LndLightningAdapter } = await import("@freedomstack/protocol");
    const lnd = new LndLightningAdapter({
      restUrl: lndUrl,
      macaroonHex: process.env.LND_MACAROON_HEX,
      allowInsecureTls: process.env.LND_ALLOW_SELF_SIGNED === "1",
    });
    feePayer = new LnurlPayer(async (bolt11: string) => {
      const preimage = await lnd.payInvoiceAndGetPreimage(bolt11);
      return { preimage };
    });
    console.log("[fee] Auszahlung ueber LND aktiv");
  } else {
    console.warn(
      "[fee] Kein LND konfiguriert — Fee-Anteile werden gerechnet und im Beweis " +
      "offengelegt, aber nicht ueberwiesen. LND_REST_URL + LND_MACAROON_HEX setzen.",
    );
  }

  // ------------------------------------------------- Reward-Pool-Verteiler
  //
  // Ausdrueckliches opt-in: Nur der Knoten, der die Pool-Wallet haelt, darf
  // verteilen. Wuerde jeder Provider verteilen, gaebe es fuer dieselbe Epoche
  // mehrere widerspruechliche Berichte — und im schlimmsten Fall mehrfache
  // Auszahlungen aus einem Topf, der nur einmal gefuellt ist.
  let distributor: import("./pool-distributor.js").PoolDistributor | undefined;
  if (process.env.POOL_DISTRIBUTOR === "1") {
    const { PoolDistributor } = await import("./pool-distributor.js");
    distributor = new PoolDistributor(
      {
        keypair,
        epochSeconds: process.env.POOL_EPOCH_SECONDS ? Number(process.env.POOL_EPOCH_SECONDS) : undefined,
        statePath: join(process.env.HOME ?? ".", ".freedom", "pool-distributor.json"),
        minPoolMsat: process.env.POOL_MIN_MSAT ? Number(process.env.POOL_MIN_MSAT) : undefined,
      },
      pool,
      feePayer,
    );
    await distributor.load();
    console.log(
      `[pool] Verteiler aktiv (bisher ${distributor.currentState.totalDistributedMsat} msat verteilt, ` +
      `${distributor.currentState.carryOverMsat} msat Uebertrag)`,
    );
    if (!feePayer) {
      console.warn("[pool] Kein LND — der Verteiler rechnet und berichtet, zahlt aber nicht aus.");
    }
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

  /** Ein fertiger Job: protokollieren und die Fee abfuehren. */
  const finishJob = async (j: Awaited<ReturnType<typeof provider.pollOnce>>[number]): Promise<void> => {
        console.log(
          `[dvm] ${j.requestId.slice(0, 8)} -> ${j.amountMsat} msat ` +
            `(provider ${j.feeSplit.recipientMsat} / pool ${j.feeSplit.poolMsat} / protocol ${j.feeSplit.protocolMsat}) ` +
            `${j.durationMs}ms${j.outputPreview ? ` :: ${j.outputPreview.replace(/\n/g, " ")}` : ""}`,
        );

        // Fee tatsaechlich abfuehren und den Beweis veroeffentlichen.
        // Frueher endete es bei der Logzeile darueber — gerechnet, nie gezahlt.
        if (j.amountMsat > 0) {
          try {
            const res = await settleJobFees({
              totalMsat: j.amountMsat,
              // Client-Gebuehr kommt aus dem Job-Event, nicht aus dem Protokoll.
              clientFeeMsat: j.clientFeeMsat,
              clientFeeRecipient: j.clientFeeRecipient,
              resultEventId: j.resultEventId,
              providerKeypair: keypair,
              providerLud16: lud16,
              customerPubkey: j.customerPubkey,
              targets: settlementTargets,
              payer: feePayer,
              pool,
              accumulator: feeAccumulator,
            });
            const offen = res.unsettledMsat > 0 ? ` | ${res.unsettledMsat} msat offen` : "";
            console.log(
              `[fee] ${res.legs.filter((l) => l.paid).length}/${res.legs.length} Teilzahlungen ` +
                `ausgefuehrt${offen}${res.proofEventId ? ` | Beweis ${res.proofEventId.slice(0, 8)}` : ""}`,
            );
          } catch (e) {
            // Ein Fee-Problem darf den Job-Loop nie anhalten — der Kunde hat
            // seine Antwort bereits, die Fee ist eine Sache des Providers.
            console.warn(`[fee] Settlement fehlgeschlagen: ${(e as Error).message}`);
          }
        }
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
      }
      // Verteilung steht nur einmal je Epoche an; die Pruefung ist billig.
      if (distributor?.isDue()) {
        try {
          const balance = Number(process.env.POOL_BALANCE_MSAT ?? "0");
          if (balance <= 0) {
            console.warn(
              "[pool] Verteilung faellig, aber POOL_BALANCE_MSAT ist 0 — der " +
              "verfuegbare Betrag wird NICHT geschaetzt, sonst entstuenden " +
              "Forderungen, die niemand einloesen kann.",
            );
          } else {
            const lud16Of = await collectProviderAddresses(pool);
            const res = await distributor.distribute({ poolMsat: balance, lud16Of });
            if (res.skipped) {
              console.log(`[pool] ${res.skipped}`);
            } else {
              console.log(
                `[pool] Epoche ${res.epoch}: ${res.distributedMsat} msat an ` +
                `${res.payouts.filter((p) => p.paid).length} Provider, ` +
                `${res.carryOverMsat} msat Uebertrag` +
                (res.reportEventId ? ` | Bericht ${res.reportEventId.slice(0, 8)}` : ""),
              );
            }
          }
        } catch (e) {
          console.error(`[pool] Verteilung fehlgeschlagen: ${(e as Error).message}`);
        }
      }
    } catch (err) {
      console.error("[poll] Fehler:", err);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Abo sauber abmelden, sonst bleibt beim Relay eine tote Subscription liegen.
  stopSubscription?.();
  console.log("freedomstack-node beendet.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
