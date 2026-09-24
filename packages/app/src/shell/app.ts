/**
 * freedom App-Shell: Einstiegspunkt der PWA.
 *
 * Laueft komplett im Browser: Identitaet (nsec), Nostr ueber WebSocket-Relays,
 * DVM-Marktplatz, Swap-Orderbook, Chat. Kein Server, keine Custody —
 * die App ist ein dummer Client des Protokolls.
 *
 * Wird per esbuild zu einer einzigen dist/freedom.html gebuendelt.
 */
import {
  generateKeypair,
  signEvent,
  buildEvent,
  verifyEvent,
  OutboxPool,
  WebSocketRelay,
  buildJobRequest,
  clientFeeTag,
  clientFeePpm,
  DEFAULT_CLIENT_FEE_PERCENT,
  MAX_CLIENT_FEE_PERCENT,
  type ClientFee,
  parseJobResult,
  buildLpOffer,
  parseLpOffer,
  offerMatches,
  hashlock,
  generatePreimage,
  toHex,
  fromHex,
  KIND_LP_OFFER,
  KIND_PERFORMANCE,
  KIND_DVM_TEXT_GENERATION,
  computeFeeSplit,
  PROTOCOL_FEE_PPM,
  PROTOCOL_POOL_SHARE_PERCENT,
  NostrEvent,
  Keypair,
} from "@freedomstack/protocol";
import { SessionClient } from "../session-client.js";
import { discoverProviders, matchProviders, ScoredProvider, matchRaceProviders, maxModeSplit, DEFAULT_MAX_MODE, matchSwarmProviders, swarmSplit, DEFAULT_SWARM } from "../matchmaking.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { t, setLang, getLang, detectLang, LANGS, Lang } from "../i18n.js";
import { startHero } from "../hero.js";
import { icon } from "../icons.js";

// ------------------------------------------------------------- Konstanten

const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];
const KIND_SWAP_REQUEST = 25001;
const KIND_SWAP_RESPONSE = 25002;
const KIND_DVM_RESULT = 6050;
const LS_KEY = "freedom.nsec";

// ------------------------------------------------------------- State

interface AppState {
  keypair: Keypair | null;
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

const state: AppState = { keypair: null, pool: null, lud16: "", sessionClient: null, lastProvider: null, lastProviderSolAddress: null };

/** Provider-Kandidaten-Cache (Matchmaking). */
let providerCache: ScoredProvider[] | null = null;
let providerCacheAt = 0;
/** Modell des zuletzt genutzten Providers (fuer die anzeige). */
let lastProviderModel: string | null = null;

/** Auto-Matchmaking: beste Provider fuer ein Tier (5min Cache). Kein manuelles pubkey. */
async function findProviders(tier: string): Promise<ScoredProvider[]> {
  const pool = await ensurePool();
  const now = Date.now();
  if (!providerCache || now - providerCacheAt > 300_000) {
    providerCache = await discoverProviders(pool);
    providerCacheAt = now;
  }
  return matchProviders(providerCache, tier as "free" | "classic" | "pro", { allowlist: getAllowlist() });
}

/** Allowlist: eigene/vertraute provider (pubkeys), die immer prioritaet haben.
 *  Der user kann eigene provider hinzufuegen (z.B. der eigene gx10). */
function getAllowlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem("freedom.allowlist") ?? "[]");
  } catch { return []; }
}

/** Setzt den eigenen Provider als einzigen erlaubten (Test-Modus). */
function setOwnProvider(pubkey: string): void {
  localStorage.setItem("freedom.allowlist", JSON.stringify([pubkey]));
  providerCache = null; // Cache invalidieren
  providerCacheAt = 0;
}

/** Gibt den eigenen Provider-Key aus der URL oder null. */
function getOwnProviderFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("provider") || params.get("pk");
}

// ------------------------------------------------------------- Helpers

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

function toast(msg: string, isErr = false): void {
  const t = $("#toast");
  t.textContent = msg;
  t.className = isErr ? "err" : "";
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 4000);
}


function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function escrowIdent(): string {
  return state.keypair ? pkShort(state.keypair.pk) : "nicht verbunden";
}

/**
 * Sidebar-Balances (Desktop): sats = session-budget rest, sol = aus localStorage
 * (wird vom wallet-connect gesetzt). Wird bei jedem Balance-Update aufgerufen.
 */
/** True wenn das Gratis-Kontingent des aktuellen Providers aufgebraucht ist. */
let quotaExhausted = false;

/**
 * Free-Quota beim aktuellen Provider abfragen und in der Sidebar zeigen.
 * Bei 0 restlichen Tokens: Wallet-Connect-CTA hervorheben.
 */
async function refreshQuota(): Promise<void> {
  const textEl = document.getElementById("nq-text");
  const fill = document.getElementById("nq-fill") as HTMLElement | null;
  const quotaBox = document.getElementById("nb-quota");
  const walletBtn = $("#nb-wallet") as HTMLButtonElement | null;
  if (!textEl || !fill || !quotaBox) return;
  if (!state.lastProvider || !state.keypair) {
    quotaBox.style.display = "none";
    return;
  }
  quotaBox.style.display = "";
  try {
    // Quota-API des Providers (gleicher Host wie der Gate, Port 3602)
    const apiBase = (window as unknown as { FREEDOM_QUOTA_API?: string }).FREEDOM_QUOTA_API
      ?? "http://" + location.hostname + ":3602";
    const res = await fetch(`${apiBase}/api/quota?pk=${state.keypair.pk}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`quota http ${res.status}`);
    const q = await res.json() as { limitTokens: number; usedTokens: number; remainingTokens: number };
    const pct = q.limitTokens > 0 ? Math.min(100, Math.round((q.remainingTokens / q.limitTokens) * 100)) : 0;
    fill.style.width = `${pct}%`;
    fill.className = "nq-fill" + (pct <= 15 ? " low" : "");
    textEl.textContent = `${q.remainingTokens.toLocaleString("de-DE")} / ${q.limitTokens.toLocaleString("de-DE")} gratis tokens heute`;
    // Bei erschöpftem Kontingent: Wallet-CTA pulsieren + beim Senden zum Wallet-Tab lenken
    quotaExhausted = q.remainingTokens === 0;
    if (walletBtn) walletBtn.classList.toggle("cta-pulse", quotaExhausted);
  } catch {
    // API nicht erreichbar (fremder provider) — Anzeige ausblenden
    quotaBox.style.display = "none";
  }
}

function updateSidebarBalances(): void {
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

// ------------------------------------------------------------- Identitaet

function loadOrCreateIdentity(): void {
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    const sk = fromHex(stored);
    state.keypair = { sk, pk: toHex(schnorr.getPublicKey(sk)) };
  } else {
    // Neue Identitaeten bekommen eine Merkphrase. Frueher wurde hier still ein
    // Schluessel erzeugt — wer seine Browserdaten loeschte, verlor Identitaet,
    // Reputation und gesperrte Betraege ohne jede Vorwarnung.
    void erzeugeIdentitaetMitPhrase();
    return;
  }
  $("#ident").textContent = escrowIdent();
  void zeigeBackupWarnung();
}

/** Erzeugt eine Identitaet und fuehrt durch die Sicherung. */
async function erzeugeIdentitaetMitPhrase(): Promise<void> {
  const { createIdentity, markHasMnemonic } = await import("../identity.js");
  const id = createIdentity();
  state.keypair = { sk: id.sk, pk: id.pk };
  localStorage.setItem(LS_KEY, toHex(id.sk));
  markHasMnemonic();
  $("#ident").textContent = escrowIdent();
  await zeigeSicherungsDialog(id.mnemonic!);
}

/**
 * Sicherungsdialog mit Bestaetigung.
 *
 * Der Nutzer tippt drei Woerter nach. Ein Haekchen "ich habe gesichert" wuerde
 * nur belegen, dass er das Haekchen gefunden hat.
 */
async function zeigeSicherungsDialog(mnemonic: string): Promise<void> {
  const { pickChallengePositions, verifyMnemonicChallenge, markBackupConfirmed, buildBackupFile }
    = await import("../identity.js");
  const { createIdentity: _c, importIdentity: _i } = await import("../identity.js");
  void _c; void _i;

  const box = document.createElement("div");
  box.className = "modal-backdrop";
  const woerter = mnemonic.split(" ");
  const positionen = pickChallengePositions(woerter.length, 3);

  box.innerHTML = `
    <div class="modal">
      <h3>Deine Wiederherstellungs-Phrase</h3>
      <p class="mono-sm">Diese zwölf Wörter sind deine Identität. Wer sie hat, ist du.
      Wer sie verliert, verliert Reputation, Nachrichten und gesperrte Beträge —
      es gibt niemanden, der sie zurücksetzen kann.</p>
      <ol class="mnemonic-list">${woerter.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ol>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        <button id="bk-copy" class="ghost" style="width:auto;padding:6px 10px">kopieren</button>
        <button id="bk-file" class="ghost" style="width:auto;padding:6px 10px">als Datei sichern</button>
      </div>
      <p class="mono-sm">Zur Bestätigung: gib diese Wörter ein.</p>
      <div id="bk-challenge" style="display:flex;gap:6px;flex-wrap:wrap">
        ${positionen.map((p) => `<label class="mono-sm">Nr. ${p + 1}
          <input data-pos="${p}" class="mono-sm" style="width:110px" autocomplete="off" /></label>`).join("")}
      </div>
      <div id="bk-error" class="mono-sm err"></div>
      <button id="bk-done" class="send-btn" style="margin-top:8px">bestätigen</button>
    </div>`;
  document.body.appendChild(box);

  return new Promise<void>((resolve) => {
    box.querySelector("#bk-copy")!.addEventListener("click", () => {
      void navigator.clipboard.writeText(mnemonic).then(() => toast("Phrase kopiert"));
    });
    box.querySelector("#bk-file")!.addEventListener("click", async () => {
      const { createIdentity } = await import("../identity.js");
      void createIdentity;
      const { identityFromMnemonic } = await import("../identity.js");
      const blob = new Blob([buildBackupFile(identityFromMnemonic(mnemonic))], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "freedomstack-identity.json";
      a.click();
      URL.revokeObjectURL(url);
    });
    box.querySelector("#bk-done")!.addEventListener("click", () => {
      const inputs = [...box.querySelectorAll("#bk-challenge input")] as HTMLInputElement[];
      const antworten = inputs.map((i) => i.value);
      const r = verifyMnemonicChallenge(mnemonic, positionen, antworten);
      if (!r.ok) {
        // Sagen, WELCHES Wort falsch war — sonst raet der Nutzer.
        box.querySelector("#bk-error")!.textContent =
          `Falsch: Wort ${r.wrong.map((p) => p + 1).join(", ")}. Nochmal vergleichen.`;
        return;
      }
      markBackupConfirmed();
      box.remove();
      toast("Identität gesichert");
      resolve();
    });
  });
}

/** Erinnert dezent, solange die Sicherung fehlt. */
async function zeigeBackupWarnung(): Promise<void> {
  try {
    const { backupStatus } = await import("../identity.js");
    const st = backupStatus();
    const el = $("#backup-warn");
    if (!el) return;
    if (st.warning) {
      el.innerHTML = `⚠ ${escapeHtml(st.warning)} <button id="bk-now" class="ghost" style="width:auto;padding:4px 8px">jetzt sichern</button>`;
      el.classList.remove("hidden");
      el.querySelector("#bk-now")?.addEventListener("click", () => void sichereJetzt());
    } else {
      el.classList.add("hidden");
    }
  } catch { /* Anzeige ist optional */ }
}

/** Nachtraegliche Sicherung — auch fuer Identitaeten ohne Phrase. */
async function sichereJetzt(): Promise<void> {
  if (!state.keypair) return;
  const { identityFromHex, buildBackupFile, markBackupConfirmed } = await import("../identity.js");
  const id = identityFromHex(toHex(state.keypair.sk));
  const blob = new Blob([buildBackupFile(id)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "freedomstack-identity.json";
  a.click();
  URL.revokeObjectURL(url);
  markBackupConfirmed();
  void zeigeBackupWarnung();
  toast("Sicherungsdatei heruntergeladen — sicher aufbewahren");
}

function exportIdentity(): void {
  if (!state.keypair) return;
  const hex = toHex(state.keypair.sk);
  navigator.clipboard?.writeText(hex).then(
    () => toast("nsec (hex) kopiert — sicher aufbewahren!"),
    () => toast(hex),
  );
}

function importIdentity(): void {
  const hex = prompt("Merkphrase, nsec1… oder 64 Zeichen Hex einfuegen:");
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    if (hex !== null) toast("ungueltiger key", true);
    return;
  }
  const sk = fromHex(hex);
  state.keypair = { sk, pk: toHex(schnorr.getPublicKey(sk)) };
  localStorage.setItem(LS_KEY, hex.toLowerCase());
  $("#ident").textContent = escrowIdent();
  toast("Identitaet importiert");
  updateFeePreview();
  loadChatList();
  loadWallet();
  loadEarnings();
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
async function wireRpcSetting(): Promise<void> {
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

// ------------------------------------------------- Nachfolge & Modelle

/** Stand der Nachfolge anzeigen. */
async function zeigeNachfolge(): Promise<void> {
  const box = $("#succession-status");
  if (!box || !state.keypair) return;
  try {
    const { parseSuccessionPlan, evaluateSuccession, KIND_SUCCESSION_PLAN, KIND_HEARTBEAT, KIND_RECOVERY_CLAIM } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_SUCCESSION_PLAN, KIND_HEARTBEAT, KIND_RECOVERY_CLAIM],
      authors: undefined,
      "#p": [state.keypair.pk],
      limit: 200,
    });
    const eigene = await pool.query({
      kinds: [KIND_SUCCESSION_PLAN, KIND_HEARTBEAT],
      authors: [state.keypair.pk],
      limit: 200,
    });
    const planEv = eigene.find((e) => e.kind === KIND_SUCCESSION_PLAN);
    if (!planEv) {
      box.innerHTML = `<span class="muted">Nicht eingerichtet. Ohne Nachfolge ist dein Zugang bei Geräteverlust endgültig weg.</span>`;
      return;
    }
    const plan = parseSuccessionPlan(planEv);
    const st = evaluateSuccession(plan, [...evs, ...eigene]);
    const cls = st.status === "aktiv" ? "ok" : st.status === "freigegeben" ? "err" : "warn";
    box.innerHTML =
      `<span class="${cls}">${escapeHtml(st.message)}</span><br>` +
      `<span class="muted">${ganzeZahl(plan.threshold)} von ${ganzeZahl(plan.guardians.length)} Vertrauten, ` +
      `Frist ${ganzeZahl(plan.inactivityDays)} Tage, Wartezeit ${ganzeZahl(plan.graceDays)} Tage.</span>`;
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

/** Nachfolge einrichten — mit Aufklaerung ueber die Grenze. */
async function richteNachfolgeEin(): Promise<void> {
  if (!state.keypair) return;
  const {
    successionWarning, splitSecret, secretHashOf, buildSuccessionPlan, signEvent: se, toHex: th,
  } = await import("@freedomstack/protocol");

  const eingabe = prompt(
    "Pubkeys der Vertrauten, kommagetrennt (mindestens 3 Personen, die sich NICHT kennen):",
  );
  if (!eingabe) return;
  const guardians = eingabe.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));
  if (guardians.length < 3) {
    toast("Mindestens drei Vertraute — bei weniger ist eine Absprache zu leicht", true);
    return;
  }
  const threshold = Math.max(2, Math.ceil(guardians.length / 2));

  if (!confirm(successionWarning({ guardians: guardians.length, threshold, graceDays: 30 }))) return;

  try {
    // Die Teile werden LOKAL erzeugt und muessen von Hand uebergeben werden.
    // Sie ueber das Netz zu schicken waere bequemer und wuerde den ganzen
    // Zweck aufheben: Wer die Uebertragung mitliest, hat sie alle.
    const teile = splitSecret(state.keypair.sk, guardians.length, threshold);
    const pool = await ensurePool();
    await pool.publish(se(buildSuccessionPlan({
      ownerPubkey: state.keypair.pk,
      guardians,
      threshold,
      inactivityDays: 180,
      graceDays: 30,
      secretHash: secretHashOf(state.keypair.sk),
    }), state.keypair.sk));

    const text = teile.map((t, i) =>
      `Teil ${t.index} — fuer ${guardians[i]}\n${th(t.data)}\n`,
    ).join("\n");
    const url = URL.createObjectURL(new Blob([
      "WICHTIG: Jeden Teil EINZELN und ueber einen SICHEREN Kanal uebergeben.\n" +
      "Wer mehrere Teile in einer Hand hat, braucht die anderen nicht mehr.\n" +
      `Schwelle: ${threshold} von ${guardians.length}.\n\n` + text,
    ], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "freedom-nachfolge-teile.txt";
    a.click();
    URL.revokeObjectURL(url);

    localStorage.setItem("freedom.successionSet", "1");
    void aktualisiereSicherheitsStand();
    toast("Eingerichtet. Übergib die Teile einzeln.");
    const bn = $("#backup-now");
  if (bn) bn.onclick = () => void sichereZustand();
  const br = $("#backup-restore");
  if (br) br.onclick = () => void stelleZustandWieder();
  const rp = $("#rotation-prepare");
  if (rp) rp.onclick = () => void bereiteWechselVor();
  const rr = $("#rotation-revoke");
  if (rr) rr.onclick = () => void widerrufeSchluessel();
  const da = $("#device-add");
  if (da) da.onclick = () => void fuegeGeraetHinzu();
  const sc = $("#succ-claim");
  if (sc) sc.onclick = () => void meldeFuerAnderen();

  void zeigeSicherung();
  void zeigeGeraete();
  void zeigeNachfolge();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Modelle im Netz anzeigen. */
async function zeigeModelle(): Promise<void> {
  const box = $("#models-list");
  if (!box) return;
  try {
    const { buildRegistry, KIND_MODEL_MANIFEST, KIND_MODEL_SEED } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST, KIND_MODEL_SEED], limit: 1000 });
    const r = buildRegistry(evs);
    box.innerHTML = r.models.length === 0
      ? `<span class="muted">Noch keine Modelle angekündigt.</span>`
      : r.models.slice(0, 20).map((m) => {
          const cls = m.availability === "gut" ? "ok" : m.availability === "knapp" ? "warn" : "err";
          return `<div class="usage-row"><span>${escapeHtml(m.manifest.name)}` +
            `${m.manifest.quant ? ` · ${escapeHtml(m.manifest.quant)}` : ""}</span>` +
            `<span class="${cls}">${escapeHtml(m.note)}</span></div>`;
        }).join("");
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

/**
 * Ein Modell ankuendigen.
 *
 * Ohne diesen Weg bleibt der Katalog fuer immer leer — das Protokoll konnte
 * Manifeste lesen, aber niemand konnte eines erzeugen.
 */
async function kuendigeModellAn(): Promise<void> {
  if (!state.keypair) return;
  const id = prompt("Modell-Kennung (z. B. qwen3.5:9b-q4):");
  if (!id?.trim()) return;
  const dateien = prompt(
    "Dateien, je Zeile: name sha256 groesse\n" +
    "Die Pruefsummen sind der ganze Sinn — ohne sie kann niemand pruefen, " +
    "ob die geladene Datei die angekuendigte ist.",
  );
  if (!dateien?.trim()) return;

  const files = dateien.split("\n").map((z) => {
    const [name, sha256, size] = z.trim().split(/\s+/);
    return { name, sha256: (sha256 ?? "").toLowerCase(), sizeBytes: Number(size) };
  }).filter((f) => f.name && /^[0-9a-f]{64}$/.test(f.sha256) && f.sizeBytes > 0);

  if (files.length === 0) {
    toast("Keine Zeile war brauchbar — Format: name sha256 groesse", true);
    return;
  }

  try {
    const { buildModelManifest, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildModelManifest({
      modelId: id.trim(), name: id.trim(), files, publisherPubkey: state.keypair.pk,
    } as never), state.keypair.sk));
    toast(`${files.length} Datei(en) angekündigt`);
    void zeigeModelle();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Melden, dass man ein Modell vorhaelt. */
async function haltevorModell(): Promise<void> {
  if (!state.keypair) return;
  const id = prompt("Welches Modell hältst du vor?");
  if (!id?.trim()) return;
  const dateien = prompt("Welche Dateien? (kommagetrennt, leer = alle)") ?? "";

  try {
    const { buildModelSeed, signEvent: se, buildRegistry, KIND_MODEL_MANIFEST } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();

    // Teilbestaende sind ausdruecklich erlaubt: Wer nur die Haelfte hat,
    // traegt trotzdem bei.
    let liste = dateien.split(",").map((x) => x.trim()).filter(Boolean);
    if (liste.length === 0) {
      const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST], limit: 500 });
      const m = buildRegistry(evs).models.find((x) => x.manifest.modelId === id.trim());
      if (!m) {
        toast("Für dieses Modell gibt es kein Manifest — erst ankündigen", true);
        return;
      }
      liste = m.manifest.files.map((f) => f.name);
    }

    await pool.publish(se(buildModelSeed(
      id.trim(), state.keypair.pk, liste,
      localStorage.getItem("freedom.region") ?? undefined), state.keypair.sk));
    toast(`${liste.length} Datei(en) gemeldet`);
    void zeigeModelle();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Ein Abzeichen definieren und verleihen.
 *
 * Bewusst in einem Schritt: Eine Definition ohne Verleihung ist nutzlos, und
 * zwei getrennte Dialoge waeren zwei Gelegenheiten zum Abbrechen.
 */
async function vergebeAbzeichen(): Promise<void> {
  if (!state.keypair) return;
  const name = prompt("Name des Abzeichens:");
  if (!name?.trim()) return;
  const empfaenger = prompt("An wen? (Pubkeys, kommagetrennt)");
  if (!empfaenger?.trim()) return;

  const pks = empfaenger.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));
  if (pks.length === 0) {
    toast("Keine gültige Pubkey dabei", true);
    return;
  }

  try {
    const { buildBadgeDefinition, buildBadgeAward, signEvent: se } =
      await import("@freedomstack/protocol");
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
    const pool = await ensurePool();

    await pool.publish(se(buildBadgeDefinition({
      id, name: name.trim(),
      description: prompt("Wofür? (erscheint bei jedem Träger)") ?? "",
      issuerPubkey: state.keypair.pk,
    }), state.keypair.sk));
    await pool.publish(se(buildBadgeAward(id, state.keypair.pk, pks), state.keypair.sk));

    // Die ehrliche Einordnung gehoert dazu, sonst ueberschaetzt der Vergeber
    // die Wirkung.
    toast(`An ${pks.length} vergeben — wert so viel wie dein Ruf`);
    void zeigeAbzeichen();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Mitwirkende am Projekt anzeigen. */
async function zeigeMitwirkende(): Promise<void> {
  const box = $("#contrib-list");
  if (!box) return;
  try {
    const { buildRepoOverview, busFactor, KIND_GIT_CONTRIBUTION } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_GIT_CONTRIBUTION], limit: 1000 });
    const repo = (window as unknown as { FREEDOM_REPO_ID?: string }).FREEDOM_REPO_ID ?? "freedomstack";
    const o = buildRepoOverview(repo, evs);
    const bf = busFactor(o.contributors);

    box.innerHTML = o.contributors.length === 0
      ? `<span class="muted">${escapeHtml(o.healthNote)}</span>`
      : `<div class="mono-sm">${escapeHtml(o.healthNote)}</div>` +
        `<div class="mono-sm muted" style="margin-bottom:6px">${escapeHtml(bf.note)}</div>` +
        o.contributors.slice(0, 15).map((c) =>
          `<div class="usage-row"><span>${escapeHtml(pkShort(c.pubkey))}</span>` +
          `<span>${c.activeDays} aktive Tage · ${c.contributions} Beiträge</span></div>`,
        ).join("");
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

// ------------------------------------------------------------- Räume

interface SpaceUiState {
  spaceId: string | null;
  channelId: string | null;
  state: unknown | null;
  messages: unknown[];
  /** Lesestand je Kanal. Bleibt lokal: Er verriete, wann jemand online war. */
  lastRead: Map<string, number>;
}

const spacesUi: SpaceUiState = {
  spaceId: null, channelId: null, state: null, messages: [], lastRead: new Map(),
};

function ladeLesestand(): void {
  try {
    const raw = JSON.parse(localStorage.getItem("freedom.lastRead") ?? "[]") as [string, number][];
    spacesUi.lastRead = new Map(raw);
  } catch { /* erster Start */ }
}

function merkeLesestand(channelId: string): void {
  spacesUi.lastRead.set(channelId, Math.floor(Date.now() / 1000));
  localStorage.setItem("freedom.lastRead", JSON.stringify([...spacesUi.lastRead]));
}

/** Beigetretene Räume. */
function meineRaeume(): string[] {
  try {
    return JSON.parse(localStorage.getItem("freedom.spaces") ?? "[]") as string[];
  } catch {
    return [];
  }
}

function raumBeitreten(id: string): void {
  const alle = new Set(meineRaeume());
  alle.add(id);
  localStorage.setItem("freedom.spaces", JSON.stringify([...alle]));
}

/** Leiste mit den Räumen. */
async function zeigeRaumLeiste(): Promise<void> {
  const rail = $("#space-rail");
  if (!rail) return;
  const ids = meineRaeume();
  if (ids.length === 0) {
    rail.innerHTML = "";
    return;
  }
  rail.innerHTML = ids.map((id) => {
    const kurz = id.slice(0, 2).toUpperCase();
    return `<button class="space-pill" data-space="${escapeHtml(id)}"
      aria-current="${id === spacesUi.spaceId}" title="${escapeHtml(id)}">${escapeHtml(kurz)}</button>`;
  }).join("");
  rail.querySelectorAll(".space-pill").forEach((b) => {
    b.addEventListener("click", () => void oeffneRaum((b as HTMLElement).dataset.space!));
  });
}

/** Einen Raum laden: Definition, Rollen, Zuweisungen, Nachrichten. */
async function oeffneRaum(spaceId: string): Promise<void> {
  spacesUi.spaceId = spaceId;
  const { buildSpaceState, KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_CHANNEL_MESSAGE } =
    await import("@freedomstack/protocol");
  try {
    const pool = await ensurePool();
    const [struktur, nachrichten] = await Promise.all([
      pool.query({ kinds: [KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT], "#space": [spaceId], limit: 500 }),
      pool.query({ kinds: [KIND_CHANNEL_MESSAGE], "#space": [spaceId], limit: 1000 }),
    ]);
    spacesUi.state = buildSpaceState(spaceId, struktur);
    spacesUi.messages = nachrichten;
  } catch (e) {
    $("#space-name").textContent = `nicht erreichbar: ${(e as Error).message}`;
    return;
  }
  void zeigeRaumLeiste();
  await zeigeKanalliste();
}

/** Kanäle mit Ungelesenem. */
async function zeigeKanalliste(): Promise<void> {
  const box = $("#channel-list");
  const st = spacesUi.state as { space?: { name: string; channels: { id: string; name: string; privacy: string }[] } } | null;
  if (!box || !st?.space) {
    if (box) box.innerHTML = `<span class="muted mono-sm">Raum nicht gefunden.</span>`;
    return;
  }
  $("#space-name").textContent = st.space.name;

  const { parseChannelMessage, unreadBadges } = await import("@freedomstack/protocol");
  const geparst = spacesUi.messages.map((e) => {
    try { return parseChannelMessage(e as never); } catch { return null; }
  }).filter((m): m is NonNullable<typeof m> => m !== null);

  const badges = new Map(
    unreadBadges(state.keypair?.pk ?? "", geparst, { lastRead: spacesUi.lastRead })
      .map((b) => [b.channelId, b]),
  );

  box.innerHTML = st.space.channels.map((c) => {
    const b = badges.get(c.id);
    // Erwaehnungen als Zahl, sonstiges Ungelesenes nur als Punkt: Eine Zahl
    // neben jedem Kanal ist Laerm.
    const marke = b?.mentions
      ? `<span class="mention">${b.mentions}</span>`
      : b?.unread ? `<span class="dot"></span>` : "";
    const schloss = c.privacy === "verschluesselt" ? "&#128274;" : "#";
    return `<button class="channel-item" data-ch="${escapeHtml(c.id)}"
      aria-current="${c.id === spacesUi.channelId}">
      <span class="hash">${schloss}</span><span>${escapeHtml(c.name)}</span>${marke}</button>`;
  }).join("");

  box.querySelectorAll(".channel-item").forEach((b) => {
    b.addEventListener("click", () => void oeffneKanal((b as HTMLElement).dataset.ch!));
  });

  if (!spacesUi.channelId && st.space.channels.length > 0) {
    await oeffneKanal(st.space.channels[0].id);
  }
}

/** Kanal anzeigen: Threads, Schreibrecht, Vertraulichkeit. */
async function oeffneKanal(channelId: string): Promise<void> {
  spacesUi.channelId = channelId;
  const st = spacesUi.state as never;
  const { buildThreads, canWriteTo, privacyInfo, can } = await import("@freedomstack/protocol");
  const darfModerieren = state.keypair ? can(state.keypair.pk, "moderieren", st) : false;
  const space = (spacesUi.state as { space?: { channels: never[] } })?.space;
  if (!space) return;

  const kanal = (space.channels as { id: string; name: string; privacy: string }[])
    .find((c) => c.id === channelId);
  if (!kanal) return;

  $("#channel-name").textContent = `#${kanal.name}`;
  const pInfo = $("#channel-privacy");
  if (pInfo) {
    pInfo.textContent = kanal.privacy === "verschluesselt" ? "verschlüsselt" : "offen — jeder kann mitlesen";
    pInfo.className = kanal.privacy === "verschluesselt" ? "mono-sm ok" : "mono-sm muted";
    pInfo.title = privacyInfo(kanal as never);
  }

  const { topLevel, threads } = buildThreads(spacesUi.messages as never[], kanal as never, st);
  const thread = $("#channel-thread");
  if (thread) {
    thread.innerHTML = topLevel.length === 0
      ? `<div class="muted mono-sm">Noch nichts hier. Fang an.</div>`
      : topLevel.map((m) => {
          const t = threads.get(m.id);
          const antworten = t
            ? `<button class="thread-link" data-root="${escapeHtml(m.id)}">
                 ${t.replies.length} Antwort${t.replies.length === 1 ? "" : "en"} ·
                 ${t.participants.length} Beteiligte</button>`
            : "";
          const modKnopf = darfModerieren && m.authorPubkey !== state.keypair?.pk
            ? `<button class="thread-link mod-hide" data-id="${escapeHtml(m.id)}"
                 data-pk="${escapeHtml(m.authorPubkey)}" style="color:#9A6A6A">moderieren</button>`
            : "";
          return `<div class="msg-group">
            <div class="msg-meta">
              <span class="msg-author">${escapeHtml(pkShort(m.authorPubkey))}</span>
              <span class="msg-time">${escapeHtml(new Date(m.createdAt * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }))}</span>
            </div>
            <div class="msg-text">${escapeHtml(m.content)}</div>${antworten}${modKnopf}</div>`;
        }).join("");
    thread.scrollTop = thread.scrollHeight;
    thread.querySelectorAll(".mod-hide").forEach((b) => {
      b.addEventListener("click", () => {
        const el = b as HTMLElement;
        const was = confirm("Nachricht ausblenden? Abbrechen = Absender sperren.");
        void moderiere(was ? "hide" : "ban", was ? el.dataset.id! : el.dataset.pk!);
      });
    });
  }

  // Schreibrecht: Wer nicht darf, bekommt den Grund statt eines toten Feldes.
  const darf = state.keypair ? canWriteTo(state.keypair.pk, kanal as never, st) : false;
  $("#channel-composer").classList.toggle("hidden", !darf);
  const ro = $("#channel-readonly");
  if (ro) {
    ro.classList.toggle("hidden", darf);
    ro.textContent = darf ? "" :
      "Hier dürfen nur bestimmte Rollen schreiben. Lesen kannst du alles.";
  }

  merkeLesestand(channelId);
  void zeigeMitglieder();
  void zeigeKanalliste();
}

/** Mitglieder mit ihren Rollen. */
async function zeigeMitglieder(): Promise<void> {
  const box = $("#member-list");
  const st = spacesUi.state as {
    grants?: Map<string, string[]>; roles?: Map<string, { name: string; color?: string }>;
    ownerPubkey?: string;
  } | null;
  if (!box || !st?.grants) return;

  const zeilen: string[] = [];
  if (st.ownerPubkey) {
    zeilen.push(`<div class="member-row"><span>${escapeHtml(pkShort(st.ownerPubkey))}</span>
      <span class="msg-role" style="color:var(--acc,#C9A227)">Gründer</span></div>`);
  }
  for (const [pk, rollen] of st.grants) {
    if (pk === st.ownerPubkey) continue;
    const namen = rollen.map((r) => st.roles?.get(r)?.name).filter(Boolean);
    zeilen.push(`<div class="member-row"><span>${escapeHtml(pkShort(pk))}</span>
      ${namen.map((n) => `<span class="msg-role">${escapeHtml(n!)}</span>`).join("")}</div>`);
  }
  box.innerHTML = zeilen.length ? zeilen.join("") : `<span class="muted">niemand eingetragen</span>`;
}

/** Nachricht senden. */
async function sendeRaumNachricht(): Promise<void> {
  const input = $("#space-msg") as HTMLInputElement | null;
  if (!input?.value.trim() || !state.keypair || !spacesUi.spaceId || !spacesUi.channelId) return;
  const text = input.value.trim();
  input.value = "";
  try {
    const { buildChannelMessage, signEvent: se } = await import("@freedomstack/protocol");
    const ev = se(buildChannelMessage({
      authorPubkey: state.keypair.pk, spaceId: spacesUi.spaceId,
      channelId: spacesUi.channelId, content: text, mentions: [],
    } as never), state.keypair.sk);
    await (await ensurePool()).publish(ev);
    spacesUi.messages.push(ev);
    await oeffneKanal(spacesUi.channelId);
  } catch (e) {
    toast((e as Error).message, true);
    input.value = text;
  }
}

/**
 * Einen Raum anlegen.
 *
 * Bis hierhin konnte man Raeumen nur BEITRETEN — es gab keinen Weg, einen zu
 * erzeugen. Damit war die gesamte Raum-Funktion unbenutzbar: Protokoll und
 * Oberflaeche waren da, aber niemand konnte den ersten Schritt tun.
 */
async function legeRaumAn(): Promise<void> {
  if (!state.keypair) return;
  const name = prompt("Name des Raums:");
  if (!name?.trim()) return;

  const { buildSpace, buildRoles, signEvent: se } = await import("@freedomstack/protocol");
  const spaceId = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const pool = await ensurePool();
    // Zwei Kanaele als Grundausstattung: einer fuer alle, einer nur fuer
    // Moderatoren. Ein Raum mit einem einzigen Kanal laedt niemanden ein,
    // Struktur zu bauen.
    await pool.publish(se(buildSpace({
      spaceId, name: name.trim(), ownerPubkey: state.keypair.pk,
      channels: [
        { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 },
        { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 1 },
      ],
    } as never), state.keypair.sk));

    await pool.publish(se(buildRoles(spaceId, state.keypair.pk, [
      { id: "mod", name: "Moderator", rank: 50,
        permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben"] },
      { id: "mitglied", name: "Mitglied", rank: 10,
        permissions: ["lesen", "schreiben", "threads"] },
    ] as never), state.keypair.sk));

    raumBeitreten(spaceId);
    await oeffneRaum(spaceId);
    // Die Kennung ist der einzige Weg, wie jemand hereinkommt.
    prompt("Raum angelegt. Diese Kennung weitergeben:", spaceId);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Moderieren: ausblenden, sperren, Rolle vergeben.
 *
 * Die Moderationsschicht war gebaut und getestet — aber es gab keinen Weg,
 * eine Massnahme zu ERZEUGEN. Ein Moderationssystem, in dem niemand
 * moderieren kann, ist keins.
 */
async function moderiere(aktion: "hide" | "ban" | "grant", ziel: string): Promise<void> {
  if (!state.keypair || !spacesUi.spaceId) return;
  const st = spacesUi.state as never;
  const { can, buildHide, buildBan, buildRoleGrant, signEvent: se } =
    await import("@freedomstack/protocol");

  const darf = aktion === "grant"
    ? can(state.keypair.pk, "rollen_vergeben", st)
    : can(state.keypair.pk, "moderieren", st);
  if (!darf) {
    toast("Dafür fehlt dir das Recht in diesem Raum", true);
    return;
  }

  try {
    const pool = await ensurePool();
    if (aktion === "grant") {
      const rolle = prompt("Welche Rolle? (mod / mitglied)", "mitglied");
      if (!rolle) return;
      await pool.publish(se(buildRoleGrant(
        spacesUi.spaceId, state.keypair.pk, ziel, [rolle.trim()]), state.keypair.sk));
      toast("Rolle vergeben");
    } else {
      // Ohne Begruendung wirkt Moderation willkuerlich — und wird es meist auch.
      const grund = prompt("Begründung (wird veröffentlicht):");
      if (!grund?.trim()) {
        toast("Ohne Begründung nicht — sie gehört zur Maßnahme", true);
        return;
      }
      const ev = aktion === "hide"
        ? buildHide(spacesUi.spaceId, state.keypair.pk, ziel, grund.trim())
        : buildBan(spacesUi.spaceId, state.keypair.pk, ziel, grund.trim());
      await pool.publish(se(ev, state.keypair.sk));
      toast(aktion === "hide" ? "Nachricht ausgeblendet" : "Absender gesperrt");
    }
    await oeffneRaum(spacesUi.spaceId);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Moderatoren ernennen.
 *
 * Die Moderationsschicht war vollstaendig gebaut, aber es gab keinen Weg,
 * ueberhaupt jemanden zum Moderator zu MACHEN — nur der Gruender konnte
 * handeln, und auch das nur ueber die Rollenvergabe im Raum.
 */
async function ernenneModeratoren(): Promise<void> {
  if (!state.keypair || !spacesUi.spaceId) return;
  const st = spacesUi.state as { ownerPubkey?: string } | null;
  if (st?.ownerPubkey !== state.keypair.pk) {
    toast("Nur der Gründer kann Moderatoren benennen", true);
    return;
  }

  const eingabe = prompt("Pubkeys der Moderatoren, kommagetrennt:");
  if (eingabe === null) return;
  const mods = eingabe.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));

  const regeln = prompt(
    "Regeln dieses Raums (erscheinen bei jedem Mitglied):\n" +
    "Ohne Regeln wirkt Moderation willkürlich.",
  );

  try {
    const { buildModeratorList, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildModeratorList(
      spacesUi.spaceId, state.keypair.pk, mods, regeln ?? undefined), state.keypair.sk));
    toast(`${mods.length} Moderator(en) benannt`);
    await oeffneRaum(spacesUi.spaceId);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function wireSpacesTab(): Promise<void> {
  ladeLesestand();
  const send = $("#space-send");
  if (send) send.onclick = () => void sendeRaumNachricht();
  const input = $("#space-msg") as HTMLInputElement | null;
  if (input) input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") void sendeRaumNachricht();
  });
  const create = $("#space-create");
  if (create) create.onclick = () => void legeRaumAn();
  const join = $("#space-join");
  if (join) join.onclick = () => {
    const id = prompt("Raum-Kennung:");
    if (!id?.trim()) return;
    raumBeitreten(id.trim());
    void oeffneRaum(id.trim());
  };
  const mods = $("#space-mods");
  if (mods) mods.onclick = () => void ernenneModeratoren();
  const info = $("#space-info");
  if (info) info.onclick = async () => {
    const st = spacesUi.state as { space?: { channels: never[] } } | null;
    const kanal = (st?.space?.channels as { id: string }[] | undefined)
      ?.find((c) => c.id === spacesUi.channelId);
    if (!kanal) return;
    const { privacyInfo } = await import("@freedomstack/protocol");
    alert(privacyInfo(kanal as never));
  };

  const raeume = meineRaeume();
  if (raeume.length > 0) await oeffneRaum(raeume[0]);
  else void zeigeRaumLeiste();
}

// ------------------------------------------------------------- Profil

/** Vorschau aufbauen. Das Aussehen kommt aus einer festen Auswahl. */
async function zeigeProfilVorschau(): Promise<void> {
  const box = $("#profile-preview");
  if (!box || !state.keypair) return;
  const { ACCENT_HEX, normalizeStyle } = await import("@freedomstack/protocol");

  const gespeichert = ladeProfilEntwurf();
  const stil = normalizeStyle(gespeichert.freedom_style);
  const farbe = ACCENT_HEX[stil.accent];

  const bild = gespeichert.picture;
  const avatar = bild && /^https:\/\/|^data:image\/|^freedom-blob:/.test(bild)
    ? `<img class="profile-avatar" src="${escapeHtml(bild)}" alt="" style="color:${farbe}" />`
    : `<div class="profile-avatar-fallback" style="color:${farbe}">${escapeHtml((gespeichert.name ?? "?").slice(0, 1).toUpperCase())}</div>`;

  box.innerHTML = `<div class="profile-head layout-${escapeHtml(stil.layout)}" style="color:${farbe}">
      <div class="pf-bg pattern-${escapeHtml(stil.pattern)}"></div>
      ${avatar}
      <div class="profile-text">
        <h3 style="color:#E8E8E8">${escapeHtml(gespeichert.name || pkShort(state.keypair.pk))}</h3>
        <p>${escapeHtml(gespeichert.about || "Noch keine Beschreibung.")}</p>
        ${gespeichert.lud16 ? `<p style="color:${farbe}">⚡ ${escapeHtml(gespeichert.lud16)}</p>` : ""}
      </div>
    </div>`;
}

interface ProfilEntwurf {
  name?: string; about?: string; picture?: string; lud16?: string;
  freedom_style?: { accent: string; layout: string; pattern: string };
}

function ladeProfilEntwurf(): ProfilEntwurf {
  try {
    return JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as ProfilEntwurf;
  } catch {
    return {};
  }
}

/** Formular verdrahten. */
async function wireProfil(): Promise<void> {
  const { ACCENTS, LAYOUTS, PATTERNS, normalizeStyle, profileDisclosure, inspectAbout } =
    await import("@freedomstack/protocol");

  const fuelle = (id: string, werte: readonly string[], aktiv: string): void => {
    const el = $(id) as HTMLSelectElement | null;
    if (!el) return;
    el.innerHTML = werte.map((w) =>
      `<option value="${escapeHtml(w)}"${w === aktiv ? " selected" : ""}>${escapeHtml(w)}</option>`).join("");
  };

  const e = ladeProfilEntwurf();
  const stil = normalizeStyle(e.freedom_style);
  fuelle("#pf-accent", ACCENTS, stil.accent);
  fuelle("#pf-layout", LAYOUTS, stil.layout);
  fuelle("#pf-pattern", PATTERNS, stil.pattern);

  const felder: Record<string, string | undefined> = {
    "#pf-name": e.name, "#pf-about": e.about, "#pf-picture": e.picture, "#pf-lud16": e.lud16,
  };
  for (const [id, wert] of Object.entries(felder)) {
    const el = $(id) as HTMLInputElement | null;
    if (el) el.value = wert ?? "";
  }

  const sammeln = (): ProfilEntwurf => ({
    name: ($("#pf-name") as HTMLInputElement)?.value.trim() || undefined,
    about: inspectAbout(($("#pf-about") as HTMLTextAreaElement)?.value).clean || undefined,
    picture: ($("#pf-picture") as HTMLInputElement)?.value.trim() || undefined,
    lud16: ($("#pf-lud16") as HTMLInputElement)?.value.trim() || undefined,
    freedom_style: {
      accent: ($("#pf-accent") as HTMLSelectElement)?.value ?? "messing",
      layout: ($("#pf-layout") as HTMLSelectElement)?.value ?? "schlicht",
      pattern: ($("#pf-pattern") as HTMLSelectElement)?.value ?? "keines",
    },
  });

  /**
   * Offenlegung LIVE mitschreiben.
   *
   * Der Nutzer soll sehen, was er preisgibt, waehrend er tippt — nicht
   * nachdem er gespeichert hat.
   */
  const zeigeOffenlegung = (): void => {
    const box = $("#pf-disclosure");
    if (!box) return;
    const zeilen = profileDisclosure(sammeln() as never);
    box.innerHTML = zeilen.map((z) => `<div>${escapeHtml(z)}</div>`).join("");
    box.className = zeilen.some((z) => /IP-Adresse/.test(z)) ? "mono-sm warn" : "mono-sm muted";
  };

  for (const id of ["#pf-name", "#pf-about", "#pf-picture", "#pf-lud16",
                    "#pf-accent", "#pf-layout", "#pf-pattern"]) {
    $(id)?.addEventListener("input", () => {
      localStorage.setItem("freedom.profile", JSON.stringify(sammeln()));
      zeigeOffenlegung();
      void zeigeProfilVorschau();
    });
  }
  zeigeOffenlegung();

  const save = $("#pf-save");
  if (save) save.onclick = async () => {
    if (!state.keypair) return;
    try {
      const { buildProfile, signEvent: se, inspectPicture } = await import("@freedomstack/protocol");
      const entwurf = sammeln();
      const bild = inspectPicture(entwurf.picture);
      if (!bild.ok) {
        toast(bild.warning ?? "Bildadresse nicht verwendbar", true);
        return;
      }
      localStorage.setItem("freedom.profile", JSON.stringify(entwurf));
      await (await ensurePool()).publish(se(buildProfile(state.keypair.pk, entwurf as never), state.keypair.sk));
      toast("Profil gespeichert");
      void zeigeProfilVorschau();
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  void zeigeProfilVorschau();
  void zeigeAbzeichen();
}

/** Abzeichen mit ihrer Herkunft. */
async function zeigeAbzeichen(): Promise<void> {
  const box = $("#badge-list");
  if (!box || !state.keypair) return;
  try {
    const {
      collectBadges, badgeSourceLabel, KIND_BADGE_DEFINITION, KIND_BADGE_AWARD,
      evaluateQuests, KIND_PERFORMANCE, KIND_FEE_PROOF,
    } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const [abz, arbeit, gebuehren] = await Promise.all([
      pool.query({ kinds: [KIND_BADGE_DEFINITION, KIND_BADGE_AWARD], limit: 500 }),
      pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 500 }),
      pool.query({ kinds: [KIND_FEE_PROOF], limit: 500 }),
    ]);

    // Verdiente Abzeichen kommen aus dem Aufgabensystem — nachrechenbar.
    const erledigt = evaluateQuests({
      pubkey: state.keypair.pk, performances: arbeit, feeProofs: gebuehren,
    }).filter((q) => q.done).map((q) => ({
      id: q.quest.id, name: q.quest.title, description: q.quest.description, basis: q.detail,
    }));

    const alle = collectBadges(state.keypair.pk, abz, erledigt);
    box.innerHTML = alle.length === 0
      ? `<span class="muted">Noch keine. Verdiente Abzeichen entstehen aus Arbeit im Netz.</span>`
      : alle.map((b) => `<div class="badge-row">
          <span class="badge-chip ${escapeHtml(b.source)}">${escapeHtml(b.source)}</span>
          <span style="min-width:0">
            <span style="font-weight:600;font-size:12px">${escapeHtml(b.definition.name)}</span><br>
            <span class="muted" style="font-size:11px">${escapeHtml(badgeSourceLabel(b))}</span>
          </span></div>`).join("");
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

// -------------------------------------- Sicherung, Wechsel, Geraete

/** Alles, was lokal liegt und bei Datenverlust verschwinden wuerde. */
function sammleZustand(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    // Schluessel NICHT mitsichern: Die Sicherung liegt oeffentlich auf
    // Relays, und ihre Verschluesselung haengt an demselben Geheimnis.
    if (!k || !k.startsWith("freedom.") || /\.(sk|identity|secret)$/.test(k)) continue;
    out[k] = localStorage.getItem(k);
  }
  return out;
}

async function zeigeSicherung(): Promise<void> {
  const box = $("#backup-status");
  if (!box || !state.keypair) return;
  const at = Number(localStorage.getItem("freedom.backupAt") ?? "0");
  const groesse = Number(localStorage.getItem("freedom.backupSize") ?? "0");
  try {
    const { backupInfo } = await import("@freedomstack/protocol");
    box.textContent = backupInfo(groesse, at || undefined);
    box.className = at ? "mono-sm muted" : "mono-sm warn";
  } catch { /* Anzeige bleibt leer */ }
}

/** Zustand verschluesselt sichern. */
async function sichereZustand(): Promise<void> {
  if (!state.keypair) return;
  try {
    const { deriveBackupKey, buildStateBackup, signEvent: se } =
      await import("@freedomstack/protocol");
    const key = deriveBackupKey(state.keypair.sk);
    const r = await buildStateBackup(state.keypair.pk, key, sammleZustand());
    await (await ensurePool()).publish(se(r.event as never, state.keypair.sk));

    localStorage.setItem("freedom.backupAt", String(Math.floor(Date.now() / 1000)));
    localStorage.setItem("freedom.backupSize", String(r.sizeBytes));
    toast(r.message);
    void zeigeSicherung();
    void aktualisiereSicherheitsStand();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function stelleZustandWieder(): Promise<void> {
  if (!state.keypair) return;
  try {
    const { deriveBackupKey, restoreStateBackup, latestBackup, KIND_STATE_BACKUP } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_STATE_BACKUP], authors: [state.keypair.pk], limit: 10,
    });
    const neueste = latestBackup(evs);
    if (!neueste) {
      toast("Keine Sicherung gefunden", true);
      return;
    }
    const r = await restoreStateBackup(neueste, deriveBackupKey(state.keypair.sk));
    if (!r.ok || !r.data) {
      toast(r.message, true);
      return;
    }
    if (!confirm(`${r.message}\n\nLokale Daten werden damit überschrieben. Fortfahren?`)) return;

    for (const [k, v] of Object.entries(r.data)) {
      if (typeof v === "string") localStorage.setItem(k, v);
    }
    toast("Wiederhergestellt — die Seite wird neu geladen");
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Schluesselwechsel vorbereiten.
 *
 * Der einzige Fall, den man NUR VORHER loesen kann. Nach einem Diebstahl ist
 * nichts mehr zu machen, wenn das Mandat fehlt.
 */
async function bereiteWechselVor(): Promise<void> {
  if (!state.keypair) return;
  const { rotationWarning, buildRotationMandate, signEvent: se, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");

  if (!confirm(rotationWarning())) return;
  try {
    const ersatz = generateKeypair();
    await (await ensurePool()).publish(
      se(buildRotationMandate(state.keypair.pk, ersatz.pk), state.keypair.sk));

    // Der Ersatz darf NICHT auf diesem Geraet bleiben — wer beides hat, ist du.
    const url = URL.createObjectURL(new Blob([
      "ERSATZSCHLUESSEL — GETRENNT VON DEINEM GERAET AUFBEWAHREN\n\n" +
      `privat: ${th(ersatz.sk)}\n` +
      `oeffentlich: ${ersatz.pk}\n\n` +
      "Wer diesen Schluessel UND deinen laufenden hat, ist du.\n" +
      "Ausdrucken oder auf einen Stick, nicht in die Cloud.\n",
    ], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "freedom-ersatzschluessel.txt";
    a.click();
    URL.revokeObjectURL(url);

    localStorage.setItem("freedom.rotationPrepared", "1");
    void aktualisiereSicherheitsStand();
    toast("Vorbereitet. Bewahre den Ersatzschlüssel getrennt auf.");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Gestohlenen Schluessel widerrufen. */
async function widerrufeSchluessel(): Promise<void> {
  const { revocationInstructions, buildRevocation, signEvent: se, fromHex } =
    await import("@freedomstack/protocol");
  if (!confirm(revocationInstructions())) return;

  const alt = prompt("Welcher Schlüssel wurde gestohlen? (öffentlicher Schlüssel)");
  if (!alt?.trim()) return;
  const ersatzHex = prompt("Privater Ersatzschlüssel aus deiner Vorbereitung:");
  if (!ersatzHex?.trim()) return;
  const seit = prompt(
    "Seit wann vermutest du den Diebstahl? (JJJJ-MM-TT)\n" +
    "Lieber zu früh ansetzen — alles danach gilt als unglaubwürdig.",
  );

  try {
    const { schnorr } = await import("@noble/curves/secp256k1.js");
    const sk = fromHex(ersatzHex.trim());
    const pk = Array.from(schnorr.getPublicKey(sk))
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    const seitUnix = seit ? Math.floor(new Date(seit).getTime() / 1000) : undefined;
    await (await ensurePool()).publish(se(buildRevocation({
      oldPubkey: alt.trim(), newPubkey: pk, reason: "gestohlen",
      compromisedSince: Number.isFinite(seitUnix) ? seitUnix : undefined,
      note: "Schlüssel kompromittiert.",
    }), sk));

    toast("Widerrufen — informiere deine Kontakte zusätzlich direkt");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Geraete anzeigen. */
async function zeigeGeraete(): Promise<void> {
  const box = $("#device-list");
  if (!box || !state.keypair) return;
  try {
    const { listDevices, KIND_DEVICE_GRANT, KIND_DEVICE_REVOKE } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_DEVICE_GRANT, KIND_DEVICE_REVOKE],
      authors: [state.keypair.pk], limit: 200,
    });
    const d = listDevices(state.keypair.pk, evs);

    box.innerHTML = d.length === 0
      ? `<span class="muted">Nur dieses Gerät. Ein zweites einzurichten ist sicherer, als den Schlüssel zu kopieren.</span>`
      : d.map((x) => {
          const cls = x.status === "aktiv" ? "ok" : x.status === "abgelaufen" ? "warn" : "muted";
          return `<div class="usage-row"><span>${escapeHtml(x.label)}</span>` +
            `<span class="${cls}">${escapeHtml(x.status)}` +
            (x.status === "aktiv"
              ? ` · <button class="ghost dev-revoke" data-pk="${escapeHtml(x.devicePubkey)}"
                   style="width:auto;padding:1px 6px;font-size:10px">entziehen</button>`
              : "") + `</span></div>`;
        }).join("");

    box.querySelectorAll(".dev-revoke").forEach((b) => {
      b.addEventListener("click", () => void entzieheGeraet((b as HTMLElement).dataset.pk!));
    });
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

async function fuegeGeraetHinzu(): Promise<void> {
  if (!state.keypair) return;
  const { defaultPermissions, deviceWarning, buildDeviceGrant, signEvent: se, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");

  const name = prompt("Wie heißt das Gerät? Zum Beispiel: Handy");
  if (!name?.trim()) return;
  const umfang = prompt("Umfang: nur-chat / lesen-schreiben / vollzugriff", "lesen-schreiben");
  if (!umfang) return;

  const perms = defaultPermissions(umfang.trim() as never);
  const tage = 365;
  if (!confirm(deviceWarning(perms, tage))) return;

  try {
    const geraet = generateKeypair();
    await (await ensurePool()).publish(se(buildDeviceGrant({
      ownerPubkey: state.keypair.pk, devicePubkey: geraet.pk, label: name.trim(),
      permissions: perms, expiresAt: Math.floor(Date.now() / 1000) + tage * 86400,
    }), state.keypair.sk));

    prompt(
      "Diesen Schlüssel auf dem anderen Gerät eingeben.\n" +
      "Er ersetzt NICHT deine Merkphrase — er handelt nur in deinem Namen:",
      th(geraet.sk),
    );
    void zeigeGeraete();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function entzieheGeraet(devicePk: string): Promise<void> {
  if (!state.keypair) return;
  if (!confirm("Vollmacht entziehen?\n\nDer Entzug erreicht nur Clients, die ihn sehen. " +
    "Was das Gerät vorher geschrieben hat, bleibt gültig.")) return;
  try {
    const { buildDeviceRevoke, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(
      se(buildDeviceRevoke(state.keypair.pk, devicePk, "entzogen"), state.keypair.sk));
    toast("Entzogen");
    void zeigeGeraete();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Als Vertrauter fuer jemanden melden, der sich nicht meldet. */
async function meldeFuerAnderen(): Promise<void> {
  if (!state.keypair) return;
  const wen = prompt("Für wen meldest du? (öffentlicher Schlüssel)");
  if (!wen?.trim()) return;
  const grund = prompt("Warum? (wird veröffentlicht)");
  if (!grund?.trim()) return;

  try {
    const { buildRecoveryClaim, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(
      buildRecoveryClaim(state.keypair.pk, wen.trim(), grund.trim()), state.keypair.sk));
    toast("Gemeldet — ein Lebenszeichen der Person bricht den Vorgang ab");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

// ------------------------------------------------------------- Onboarding

/**
 * Zeigt den EINEN naechsten Schritt.
 *
 * Frueher gab es gar keine Fuehrung: Ein neuer Nutzer landete in einer App mit
 * vier Tabs und musste selbst herausfinden, dass die ersten Anfragen gratis
 * sind. Der Free-Tier war eingebaut und unsichtbar.
 *
 * Die Reihenfolge ist die eigentliche Entscheidung — erst benutzen, dann
 * einrichten. Wer zuerst nach einer Wallet fragt, verliert die Leute, die noch
 * nicht wissen, ob das Ding etwas taugt.
 */
async function zeigeOnboarding(): Promise<void> {
  const bar = $("#onboarding-bar");
  if (!bar) return;
  try {
    const { nextStep } = await import("../onboarding.js");
    const { backupStatus } = await import("../identity.js");

    const bu = backupStatus();
    const schritt = nextStep({
      hasIdentity: !!state.keypair,
      backedUp: bu.confirmed,
      hasWallet: !!nwc || !!(window as unknown as { webln?: unknown }).webln,
      hasUsedOnce: localStorage.getItem("freedom.usedOnce") === "1",
      freeTierLeft: Number(localStorage.getItem("freedom.freeLeft") ?? "10"),
    }, (localStorage.getItem("freedom.intent") as never) ?? "unbekannt");

    if (schritt.id === "fertig") {
      bar.classList.add("hidden");
      return;
    }

    bar.className = `mono-sm urgency-${schritt.urgency}`;
    bar.innerHTML =
      `<span class="ob-title">${escapeHtml(schritt.title)}</span>` +
      `<span class="ob-body">${escapeHtml(schritt.body)}</span>` +
      (schritt.action
        ? `<button id="ob-action" class="ghost" style="width:auto;padding:6px 10px">${escapeHtml(schritt.action)}</button>`
        : "") +
      (schritt.skippable
        ? `<button id="ob-skip" class="ghost" style="width:auto;padding:4px 8px;font-size:10px">später</button>`
        : "");

    bar.querySelector("#ob-action")?.addEventListener("click", () => {
      if (schritt.id === "sichern") void sichereJetzt();
      else if (schritt.id === "wallet") document.querySelector<HTMLElement>('[data-tab="wallet"]')?.click();
      else if (schritt.id === "provider-anleitung") document.querySelector<HTMLElement>('[data-tab="earn"]')?.click();
      else document.querySelector<HTMLElement>('[data-tab="ai"]')?.click();
    });
    // "Spaeter" blendet nur diesen Schritt aus, nicht die Fuehrung: Wer
    // dauerhaft wegklickt, verliert bei geloeschten Browserdaten alles.
    bar.querySelector("#ob-skip")?.addEventListener("click", () => bar.classList.add("hidden"));
  } catch { /* Fuehrung ist optional */ }
}

// ------------------------------------------------------------- Mesh-Tab

let meshNode: import("../mesh-radio.js").MeshNode | null = null;

/**
 * Mesh-Knoten aufsetzen.
 *
 * Empfangene Nachrichten werden wie ganz normale Nostr-Events behandelt — die
 * Schicht darueber unterscheidet nicht, ob etwas ueber ein Relay oder ueber
 * Funk kam. Genau das ist der Sinn: Bei einem Netzausfall aendert sich die
 * Zustellung, nicht die Anwendung.
 */
async function ensureMeshNode(): Promise<import("../mesh-radio.js").MeshNode> {
  if (meshNode) return meshNode;
  const { MeshNode, meshToEvent } = await import("../mesh-radio.js");

  meshNode = new MeshNode({
    onMessage: (payload, kind) => {
      void (async () => {
        const { MeshKind } = await import("@freedomstack/protocol");
        if (kind === MeshKind.NostrEvent) {
          try {
            const ev = meshToEvent(payload);
            // Ueber den Pool weiterverteilen, sobald wieder Netz da ist:
            // Eine Nachricht, die nur auf diesem Geraet ankommt, hat den
            // halben Weg umsonst gemacht.
            const pool = await ensurePool();
            await pool.publish(ev as never).catch(() => { /* offline */ });
            toast("Nachricht ueber Funk empfangen");
          } catch { toast("Empfangenes Paket unlesbar", true); }
        } else if (kind === MeshKind.PlainText) {
          toast(`Funk: ${new TextDecoder().decode(payload).slice(0, 80)}`);
        } else {
          toast("Zahlung ueber Funk empfangen — wird beim naechsten Netzkontakt eingereicht");
        }
      })();
    },
    onProgress: (info) => {
      const el = $("#mesh-status");
      if (!el) return;
      el.textContent = info.sending > 0
        ? `${info.sending} Pakete offen, etwa ${info.etaSeconds}s`
        : info.receiving > 0 ? `${info.receiving} Nachricht(en) unvollstaendig` : "bereit";
    },
    onLog: (line) => console.log(`[mesh] ${line}`),
  });
  return meshNode;
}

/**
 * Datenschutzbericht anzeigen.
 *
 * Liest die TATSAECHLICHEN Einstellungen aus, statt eine Musterkonfiguration
 * zu bewerten. Ein Bericht, der nicht die eigene Lage beschreibt, wird nicht
 * gelesen.
 */
async function zeigeDatenschutz(): Promise<void> {
  const box = $("#privacy-report");
  if (!box) return;
  try {
    const { privacyReport, summarizePrivacy, auditPrivacy, DEFAULT_CONFIG } =
      await import("@freedomstack/protocol");

    const netz = (($("#net-mode") as HTMLSelectElement | null)?.value ?? "klar") as
      "klar" | "tor" | "mixnet";
    const profil = JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as
      { picture?: string };

    const cfg = {
      ...DEFAULT_CONFIG,
      // Tor oder ein Mixnetz kann eine Web-App weder herstellen noch pruefen –
      // die Einstellung bevorzugt nur .onion-Relays. Bewertet wird deshalb
      // die direkte Verbindung (Schritt 6.2 im Ausbauplan).
      network: "klar",
      // Erst wahr, wenn der Sendepfad NIP-17 nutzt (Schritt 2.1). Vorher
      // meldete der Bericht einen Wegwerfschluessel, den es nicht gab.
      giftWrap: DMS_GIFT_WRAPPED,
      ownRelay: !!localStorage.getItem("freedom.ownRelay"),
      solanaInProfile: !!localStorage.getItem("freedom.solAddress"),
      usesSwaps: !!localStorage.getItem("freedom.swapHistory"),
      externalAvatar: /^https:\/\//.test(profil.picture ?? ""),
      stateBackup: !!localStorage.getItem("freedom.backupAt"),
      expiringMessages: localStorage.getItem("freedom.expiry") !== null,
    };

    const s = summarizePrivacy(auditPrivacy(cfg as never));
    // Belegte Aussagen und bekannte Luecken kommen aus privacy-facts.ts – dort
    // erzwingen Tests, dass "belegt" nur steht, was ein Leak-Test prueft.
    const { privacyFactsText } = await import("@freedomstack/protocol");
    const hinweise: string[] = [privacyFactsText()];
    if (netz !== "klar") {
      hinweise.push(
        "Tor/Mixnetz: Die Einstellung bevorzugt nur .onion-Relays. Deine IP-Adresse ist nur verborgen, " +
        "wenn du die App selbst im Tor Browser bzw. hinter einem Mixnetz öffnest – das kann die App nicht prüfen.",
      );
    }
    box.textContent = privacyReport(cfg as never) + "\n\n" + hinweise.join("\n");
    box.className = s.critical > 0 ? "mono-sm err" : s.warnings > 0 ? "mono-sm warn" : "mono-sm ok";
  } catch (e) {
    box.textContent = `Bericht nicht erstellbar: ${(e as Error).message}`;
  }
}

async function wireMeshTab(): Promise<void> {
  const { detectTransports } = await import("../mesh-radio.js");
  const info = $("#mesh-transport");
  if (info) {
    const t = detectTransports();
    info.textContent = t.note;
    const btn = $("#mesh-connect") as HTMLButtonElement | null;
    if (btn && t.recommendation === "datei") {
      // Keinen Knopf anbieten, der auf diesem Geraet nichts tun kann.
      btn.disabled = true;
      btn.textContent = "kein Geraetezugriff";
    }
  }

  const connect = $("#mesh-connect");
  if (connect) connect.onclick = async () => {
    try {
      const { connectSerial } = await import("../mesh-radio.js");
      const n = await ensureMeshNode();
      await n.attach(await connectSerial());
      $("#mesh-status").textContent = `verbunden: ${n.transportName}`;
      toast("Funkgeraet verbunden");
    } catch (e) {
      $("#mesh-status").textContent = (e as Error).message;
    }
  };

  const bt = $("#mesh-bt");
  if (bt) bt.onclick = async () => {
    try {
      const { connectBluetooth } = await import("../mesh-radio.js");
      const n = await ensureMeshNode();
      await n.attach(await connectBluetooth((raw) => n.receive(raw)));
      $("#mesh-status").textContent = `verbunden: ${n.transportName}`;
      void zeigeOfflineFaehigkeiten("bluetooth");
      toast("Bluetooth verbunden");
    } catch (e) {
      $("#mesh-status").textContent = (e as Error).message;
    }
  };

  void zeigeOfflineFaehigkeiten("lora");

  const netz = $("#net-mode") as HTMLSelectElement | null;
  if (netz) {
    netz.value = localStorage.getItem("freedom.network") ?? "klar";
    netz.onchange = async () => {
      localStorage.setItem("freedom.network", netz.value);
      // Bei Tor die .onion-Relays nach vorn holen — sonst ist die
      // Einstellung nur eine Beschriftung.
      try {
        const { sortByTorPreference } = await import("@freedomstack/protocol");
        const pool = await ensurePool();
        const bekannt = JSON.parse(
          localStorage.getItem("freedom.relays") ?? "[]",
        ) as string[];
        const r = sortByTorPreference(bekannt, {
          onionOnly: false, preferOnion: netz.value !== "klar",
        });
        // Die Reihenfolge wird gemerkt — beim naechsten Start kommen die
        // Zwiebeladressen zuerst dran.
        localStorage.setItem("freedom.relays", JSON.stringify(r.relays));
        void pool;
        if (netz.value !== "klar") toast(r.message);
      } catch { /* Reihenfolge bleibt */ }
      void zeigeDatenschutz();
    };
  }
  void zeigeDatenschutz();

  const exp = $("#mesh-export");
  if (exp) exp.onclick = async () => {
    const { fileTransport } = await import("../mesh-radio.js");
    const n = await ensureMeshNode();
    const t = fileTransport((data, count) => {
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `freedom-${Date.now()}.meshpkt`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${count} Pakete als Datei ausgegeben`);
    });
    await n.attach(t);
    // Kurz warten, damit die Warteschlange durchlaeuft, dann buendeln.
    setTimeout(() => void t.close(), 500);
  };

  const impBtn = $("#mesh-import");
  const impInput = $("#mesh-import-input") as HTMLInputElement | null;
  if (impBtn && impInput) {
    impBtn.onclick = () => impInput.click();
    impInput.onchange = async () => {
      const f = impInput.files?.[0];
      if (!f) return;
      const n = await ensureMeshNode();
      const anzahl = n.receiveBundle(new Uint8Array(await f.arrayBuffer()));
      toast(`${anzahl} Pakete eingelesen`);
      impInput.value = "";
    };
  }

  const refresh = $("#coverage-refresh");
  if (refresh) refresh.onclick = () => void ladeAbdeckung();
  const join = $("#coverage-join");
  if (join) join.onclick = () => void trageAbdeckungEin();

  void ladeAbdeckung();
  setInterval(() => zeigeWarteschlange(), 2000);
}

/**
 * Was ohne Internet geht — je nach Strecke.
 *
 * Die Auskunft kommt aus dem Protokoll, damit Oberflaeche und Dokumentation
 * dasselbe sagen. Ein Versprechen, das an zwei Stellen verschieden lautet,
 * wird an der schwaecheren geglaubt.
 */
async function zeigeOfflineFaehigkeiten(link: "lora" | "bluetooth" | "datei"): Promise<void> {
  const box = $("#offline-caps");
  if (!box) return;
  const { offlineCapabilities, LINK_LABEL } = await import("@freedomstack/protocol");
  box.innerHTML =
    `<div class="muted" style="margin-bottom:5px">Über ${escapeHtml(LINK_LABEL[link])}:</div>` +
    offlineCapabilities(link).map((f) =>
      `<div class="usage-row"><span>${f.works ? "✓" : "✕"} ${escapeHtml(f.feature)}</span>` +
      `<span class="muted" style="font-size:10px;max-width:58%">${escapeHtml(f.note)}</span></div>`,
    ).join("");
}

function zeigeWarteschlange(): void {
  const el = $("#mesh-queue");
  if (!el || !meshNode) return;
  const p = meshNode.pending;
  el.innerHTML = p.length === 0
    ? "nichts zu senden"
    : p.map((m) => `${escapeHtml(m.label)} — ${m.framesLeft} Pakete offen`).join("<br>");
}

/** Abdeckung anzeigen. */
async function ladeAbdeckung(): Promise<void> {
  const liste = $("#coverage-list");
  const hier = $("#coverage-here");
  try {
    const { buildCoverage, coverageAt, KIND_COVERAGE } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_COVERAGE], limit: 2000 });
    const r = buildCoverage(evs);

    if (liste) {
      const { summarizeLayers, LAYER_LABEL } = await import("@freedomstack/protocol");
      const zusammen = summarizeLayers(r.cells, r.hiddenCells);
      const symbol: Record<string, string> = { online: "🌐", lora: "📡", bluetooth: "🔵" };

      liste.innerHTML =
        // Kopfzeile je Ebene: Was gibt es ueberhaupt, bevor es um Orte geht.
        zusammen.map((z) =>
          `<div class="usage-row"><span>${symbol[z.layer]} ${escapeHtml(z.label)}</span>` +
          `<span class="${z.cells > 0 ? "ok" : "muted"}">${z.cells} Gebiet(e)</span></div>`,
        ).join("") +
        (r.cells.length === 0
          ? `<div class="muted" style="margin-top:8px">Noch keine Eintraege. Eintragen ist freiwillig — es kann trotzdem Abdeckung geben.</div>`
          : `<div style="margin-top:8px">` + r.cells.slice(0, 15).map((c) =>
              `${symbol[c.layer] ?? "•"} ${escapeHtml(c.region || "?")} · ${escapeHtml(c.label)}`,
            ).join("<br>") + `</div>`) +
        (r.hiddenCells > 0
          ? `<div class="muted" style="margin-top:6px">${r.hiddenCells} Gebiet(e) nicht angezeigt: zu wenige Knoten, um niemanden zu verorten.</div>`
          : "");
    }

    // Standort nur auf ausdruecklichen Wunsch — nicht beim Oeffnen des Tabs.
    if (hier) {
      const gemerkt = localStorage.getItem("freedom.coverage.cell");
      hier.textContent = gemerkt
        ? coverageAt(...(JSON.parse(gemerkt) as [number, number]), r.cells).message
        : "Fuer die Anzeige, ob es hier Abdeckung gibt, wird dein Standort gebraucht — nur lokal, nichts wird gesendet.";
    }
  } catch (e) {
    if (liste) liste.textContent = `Abdeckung nicht abrufbar: ${(e as Error).message}`;
  }
}

/** Sich selbst eintragen — mit Aufklaerung vorher. */
async function trageAbdeckungEin(): Promise<void> {
  if (!state.keypair) return;
  const { coverageConsentText, toCell, buildCoverageAnnouncement, signEvent: se } =
    await import("@freedomstack/protocol");

  const art = prompt("Was trägst du ein? (funk / bluetooth)", "funk");
  if (!art) return;
  const layer = art.trim().toLowerCase().startsWith("b") ? "bluetooth" : "lora";
  if (!confirm(coverageConsentText(layer))) return;

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      // Runden passiert LOKAL. Die genauen Koordinaten verlassen das Geraet nie.
      // Runden passiert LOKAL, und die Zellgroesse haengt an der Ebene:
      // Bluetooth reicht nur Meter, also wird GROEBER gerundet, nicht feiner.
      const { LAYER_CELL_DEGREES } = await import("@freedomstack/protocol");
      const cell = toCell(pos.coords.latitude, pos.coords.longitude, LAYER_CELL_DEGREES[layer]);
      localStorage.setItem("freedom.coverage.cell", JSON.stringify([pos.coords.latitude, pos.coords.longitude]));
      const pool = await ensurePool();
      await pool.publish(se(buildCoverageAnnouncement({
        pubkey: state.keypair!.pk, layer, cell, region: "",
      }), state.keypair!.sk));
      toast("Eingetragen — jederzeit widerrufbar");
      void ladeAbdeckung();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }, () => toast("Standort nicht verfuegbar", true));
}

/** Beste erreichbare RPC-URL fuer Bibliotheken, die eine feste Adresse wollen. */
async function solRpcUrl(): Promise<string> {
  return (await ensureRpcPool()).bestUrl();
}

async function ensurePool(): Promise<OutboxPool> {
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

function ensureSessionClient(): SessionClient {
  if (state.sessionClient) return state.sessionClient;
  if (!state.keypair || !state.pool) throw new Error("Identitaet/Pool fehlt");
  state.sessionClient = new SessionClient({
    keypair: state.keypair,
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

/** Anhang: kleine Dateien inline als data-url, grosse ueber das Blob-Netz. */
// Darstellungslogik liegt in shell-logic.ts — dort ohne DOM und deshalb
// tatsaechlich testbar (29 Tests, Schwerpunkt feindliche Relay-Eingaben).
import {
  escapeHtml, pkShort, renderAttachment, parseDmBody, parseImetaTags,
  type ChatAttachment,
} from "../shell-logic.js";
let chatAttachments: ChatAttachment[] = [];
/** Blossom-Server fuer grosse Dateien (BUD-01/02, Nostr-Standard fuer Blobs).
 *  Selbst hostbar — jede Community kann eigenen Storage betreiben. */
const BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://nostr.build",
];

async function uploadToBlossom(file: File): Promise<string> {
  for (const server of BLOSSOM_SERVERS) {
    try {
      const res = await fetch(`${server}/upload`, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.url || data.sha256) return data.url ?? `${server}/${data.sha256}`;
    } catch { /* naechster server */ }
  }
  throw new Error("kein blossom-server erreichbar — datei zu gross fuer inline");
}

async function handleChatFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const listEl = $("#chat-attach-list");
  for (const file of Array.from(files)) {
    try {
      let url: string;
      if (file.size <= 80_000) {
        // klein: inline als data-url (funktioniert offline, kein server)
        url = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
      } else {
        // gross: blob-netz (chunked + erasure, torrent-artig). blossom nur fallback.
        setAttachStatus(listEl, `${file.name}: chunking…`);
        try {
          const { uploadBlob } = await import("../blob-client.js");
          const pool = await ensurePool();
          const res = await uploadBlob(file, pool as never, state.keypair!, signEvent as never);
          url = `freedom-blob:${res.blobId}`;
        } catch {
          setAttachStatus(listEl, `${file.name}: blossom-fallback…`);
          url = await uploadToBlossom(file);
        }
      }
      chatAttachments.push({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, url });
      setAttachStatus(listEl, chatAttachments.map((a) => `${a.name} (${Math.round(a.size / 1024)}kb)`).join(", "));
    } catch (e) {
      toast(`${file.name}: ${(e as Error).message}`, true);
    }
  }
}

function setAttachStatus(el: HTMLElement | null, text: string): void {
  if (el) el.textContent = text;
}


/** Blob-Buttons aktivieren: Chunks aus dem Netz holen und als Download geben. */
function wireBlobButtons(root: HTMLElement): void {
  root.querySelectorAll(".chat-blob-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const el = btn as HTMLElement;
      const oldText = el.textContent ?? "";
      el.textContent = "lade…";
      try {
        const { downloadBlob } = await import("../blob-client.js");
        const pool = await ensurePool();
        const res = await downloadBlob(el.dataset.blob!, pool as never);
        if (!res) throw new Error("nicht genug shards im netz gefunden");
        const url = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = res.name || el.dataset.name || "datei";
        a.click();
        URL.revokeObjectURL(url);
        el.textContent = oldText;
      } catch (e) {
        toast(`blob: ${(e as Error).message}`, true);
        el.textContent = oldText;
      }
    });
  });
  root.querySelectorAll(".zap-msg-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const { openZapDialog } = await import("../chat-zap.js");
      openZapDialog(el.dataset.pk!, el.dataset.name!);
    });
  });
}

// ------------------------------------------------------------- Modell-Dropdown

/** Fuellt das Modell-Dropdown mit den Modellen der besten Provider des Tiers. */
async function refreshModelDropdown(): Promise<void> {
  const sel = $("#ai-model") as HTMLInputElement | null;
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  if (!sel || !btn) return;
  const current = sel.value;
  try {
    const providers = await findProviders(($("#ai-tier") as HTMLSelectElement).value);
    // modelle + preise der top-provider sammeln (dedupe, haeufigkeit)
    const counts = new Map<string, { count: number; priceMsat: number; tools: Set<string> }>();
    for (const p of providers.slice(0, 5)) {
      for (const m of p.caps.models ?? []) {
        const cur = counts.get(m) ?? { count: 0, priceMsat: p.caps.textRatePerKTokenMsat ?? 1500, tools: new Set((p.caps.tools ?? []).map((t: any) => t.name ?? String(t))) };
        cur.count += 1;
        counts.set(m, cur);
      }
    }
    const entries = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
    // nemotron zuerst (schnellster, standard)
    entries.sort((a, b) => {
      const na = a[0].includes("nemotron") ? 0 : 1;
      const nb = b[0].includes("nemotron") ? 0 : 1;
      return na - nb || b[1].count - a[1].count;
    });
    (window as unknown as { __modelCatalog?: unknown }).__modelCatalog = entries;

    // Popover-Inhalt: Karten mit Name, Speed-Klasse, Preis/1k tokens, Provider-Count
    const pop = $("#model-popover");
    if (pop) {
      const speedOf = (m: string): { label: string; cls: string } => {
        if (m.includes("nemotron")) return { label: "⚡⚡ schnell", cls: "fast" };
        if (/(\d+)b/.test(m)) {
          const size = Number(RegExp.$1);
          if (size <= 8) return { label: "⚡⚡ schnell", cls: "fast" };
          if (size <= 15) return { label: "⚡ mittel", cls: "mid" };
          return { label: "🐢 tiefgründig", cls: "deep" };
        }
        return { label: "⚡ mittel", cls: "mid" };
      };
      pop.innerHTML = `
        <button type="button" class="model-card ${current === "" ? "selected" : ""}" data-model="">
          <div class="mc-head"><b>Auto</b><span class="mc-speed fast">schnellste</span></div>
          <div class="mc-sub">netz wählt das beste verfügbare modell</div>
        </button>
        ${entries.map(([m, info]) => {
          const sp = speedOf(m);
          const short = m.split(":")[0];
          const satsPer1k = Math.ceil(info.priceMsat / 1000);
          // SOL-preis: SOL_PRICE_SATS env (provider-seite) oder default 150000 sats/SOL
          const solPriceSats = Number((window as unknown as { FREEDOM_SOL_PRICE_SATS?: number }).FREEDOM_SOL_PRICE_SATS ?? 150_000);
          const solPer1k = (satsPer1k / solPriceSats).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
          return `<button type="button" class="model-card ${current === m ? "selected" : ""}" data-model="${escapeHtml(m)}">
            <div class="mc-head"><b>${escapeHtml(short)}</b><span class="mc-speed ${sp.cls}">${sp.label}</span></div>
            <div class="mc-sub">~${satsPer1k} sats ≈ ${solPer1k} SOL /1k tokens · ${info.count} provider${info.tools.size ? " · " + icon("wrench", 11) : ""}</div>
          </button>`;
        }).join("")}`;
    }
    // button-label aktualisieren
    updateModelBtnLabel();
  } catch { /* dropdown bleibt bei auto */ }
}

/** Button-Label aus aktueller Modell-Wahl. */
function updateModelBtnLabel(): void {
  const sel = $("#ai-model") as HTMLInputElement | null;
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  if (!sel || !btn) return;
  const v = sel.value;
  btn.innerHTML = v
    ? `${icon("bot", 14)} ${escapeHtml(v.split(":")[0])}`
    : `${icon("bot", 14)} auto (schnellste)`;
}

/** Modell-Popover öffnen/schliessen. */
function setupModelPicker(): void {
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  const pop = $("#model-popover");
  if (!btn || !pop) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.toggle("hidden");
  });
  // Karten-Klicks (delegiert, da Inhalt dynamisch)
  pop.addEventListener("click", async (e) => {
    const card = (e.target as HTMLElement).closest(".model-card") as HTMLElement | null;
    if (!card) return;
    const sel = $("#ai-model") as HTMLInputElement;
    sel.value = card.dataset.model ?? "";
    updateModelBtnLabel();
    pop.classList.add("hidden");
    toast(sel.value ? `modell: ${sel.value.split(":")[0]}` : "modell: auto");
  });
  // klick außerhalb schließt
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".model-picker-wrap")) pop.classList.add("hidden");
  });
}

// -------------------------------------------------- Neuer Aufbau: Hilfslogik

/** Zeichen 09 — Klammer. Eine Quelle fuer Kopf, Seitenleiste und Favicon. */
function markSvg(size: number, color = "var(--accent)"): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M22 10 H12 V54 H22" stroke="${color}" stroke-width="7" stroke-linecap="square"/>
    <path d="M42 10 H52 V54 H42" stroke="${color}" stroke-width="7" stroke-linecap="square"/>
    <rect x="27" y="27" width="10" height="10" fill="${color}"/></svg>`;
}

function setzeLogo(): void {
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

/**
 * Unter-Reiter fuer Waehrung, Earn, Agent und Settings.
 *
 * Eine Gruppe haelt ihre Reiter und die zugehoerigen Bereiche ueber den
 * Gruppennamen zusammen — so braucht jede Seite nur Markup, keinen eigenen Code.
 */
function wireSubtabs(): void {
  document.querySelectorAll<HTMLElement>("[data-subtab-group]").forEach((gruppe) => {
    const name = gruppe.dataset.subtabGroup!;
    gruppe.querySelectorAll<HTMLElement>("[data-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        gruppe.querySelectorAll("[data-subtab]").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        document.querySelectorAll<HTMLElement>(`[data-subpane^="${name}:"]`).forEach((p) => {
          p.classList.toggle("active", p.dataset.subpane === `${name}:${btn.dataset.subtab}`);
        });
      });
    });
  });
}

/** Kommunikation: zwischen Direktnachrichten und einem Raum umschalten. */
function setzeKommModus(modus: "dm" | "space"): void {
  const layout = document.querySelector<HTMLElement>(".comm-layout");
  if (layout) layout.dataset.commMode = modus;
  document.getElementById("comm-dm-btn")?.setAttribute("aria-current", String(modus === "dm"));
  layout?.classList.remove("thread-open");
  if (modus === "dm") {
    document.querySelectorAll("#space-rail .space-pill").forEach((p) => p.setAttribute("aria-current", "false"));
    loadChatList();
  }
}

function wireKommunikation(): void {
  document.getElementById("comm-dm-btn")?.addEventListener("click", () => setzeKommModus("dm"));
  // Die Leistenknoepfe loesen die vorhandenen Aktionen aus — keine zweite Logik.
  // Mobil: eine Ebene zur Zeit, wie Discord — Liste, oder nach dem Antippen der Chat.
  const layout = document.querySelector<HTMLElement>(".comm-layout");
  document.getElementById("chat-list")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".chat-item")) layout?.classList.add("thread-open");
  });
  document.getElementById("chat-back")?.addEventListener("click", () =>
    layout?.classList.remove("thread-open"));
  document.getElementById("rail-create")?.addEventListener("click", () =>
    document.getElementById("space-create")?.click());
  document.getElementById("rail-join")?.addEventListener("click", () =>
    document.getElementById("space-join")?.click());
  // Ein Raum aus der Leiste: in den Raum-Modus wechseln. Die Leiste wird neu
  // gezeichnet, deshalb am Container horchen statt an jedem Knopf.
  document.getElementById("space-rail")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".space-pill")) setzeKommModus("space");
  });
}

// -------------------------------------------------- Agent: lokaler Verlauf

interface AgentVerlauf {
  id: string;
  title: string;
  at: number;
  messages: { role: "user" | "ai"; text: string; meta?: string; model?: string }[];
}

let aktuellerVerlauf: AgentVerlauf | null = null;
let verlaufWiederherstellen = false;

function ladeVerlaeufe(): AgentVerlauf[] {
  try {
    return JSON.parse(localStorage.getItem("freedom.agentHistory") ?? "[]") as AgentVerlauf[];
  } catch {
    return [];
  }
}

function speichereVerlaeufe(v: AgentVerlauf[]): void {
  // Obergrenze: Ein unbegrenzter Verlauf fuellt den Speicher, und der ist im
  // Browser knapp — bei Ueberlauf verliert die App ganz andere Daten.
  try {
    localStorage.setItem("freedom.agentHistory", JSON.stringify(v.slice(0, 40)));
  } catch { /* Speicher voll — Verlauf ist verzichtbar */ }
}

/** Wird von addAiMessage aufgerufen. Beim Wiederherstellen nicht erneut speichern. */
function merkeNachricht(role: "user" | "ai", text: string, meta: string, model?: string): void {
  if (verlaufWiederherstellen) return;
  const alle = ladeVerlaeufe();
  if (!aktuellerVerlauf) {
    if (role !== "user") return;
    aktuellerVerlauf = {
      id: String(Date.now()),
      title: text.replace(/\s+/g, " ").trim().slice(0, 60) || "Aufgabe",
      at: Math.floor(Date.now() / 1000),
      messages: [],
    };
    alle.unshift(aktuellerVerlauf);
  }
  aktuellerVerlauf.messages.push({ role, text: text.slice(0, 20_000), meta, model });
  const i = alle.findIndex((x) => x.id === aktuellerVerlauf!.id);
  if (i >= 0) alle[i] = aktuellerVerlauf;
  speichereVerlaeufe(alle);
  zeigeVerlaeufe();
}

function zeigeVerlaeufe(): void {
  const box = document.getElementById("agent-history");
  if (!box) return;
  const alle = ladeVerlaeufe();
  if (alle.length === 0) {
    box.innerHTML = `<p class="muted mono-sm history-empty">Noch keine Aufgaben.</p>`;
    return;
  }
  const heute = new Date().toDateString();
  let letzteGruppe = "";
  box.innerHTML = alle.map((v) => {
    const d = new Date(v.at * 1000);
    const gruppe = d.toDateString() === heute ? "Heute" : "Früher";
    const kopf = gruppe !== letzteGruppe ? `<div class="history-group">${gruppe}</div>` : "";
    letzteGruppe = gruppe;
    const aktiv = aktuellerVerlauf?.id === v.id ? " active" : "";
    return `${kopf}<button class="history-item${aktiv}" data-hid="${escapeHtml(v.id)}" type="button">
      <span class="history-title">${escapeHtml(v.title)}</span>
      <span class="history-sub">${v.messages.length} Nachrichten</span></button>`;
  }).join("");
  box.querySelectorAll<HTMLElement>(".history-item").forEach((b) => {
    b.addEventListener("click", () => oeffneVerlauf(b.dataset.hid!));
  });
}

function oeffneVerlauf(id: string): void {
  const v = ladeVerlaeufe().find((x) => x.id === id);
  if (!v) return;
  aktuellerVerlauf = v;
  const thread = document.getElementById("ai-thread");
  if (thread) thread.innerHTML = "";
  verlaufWiederherstellen = true;
  try {
    for (const m of v.messages) addAiMessage(m.role, m.text, m.meta ?? "", m.model);
  } finally {
    verlaufWiederherstellen = false;
  }
  zeigeVerlaeufe();
}

function neueAufgabe(): void {
  aktuellerVerlauf = null;
  const thread = document.getElementById("ai-thread");
  const leer = document.getElementById("ai-empty");
  if (thread) {
    thread.innerHTML = "";
    if (leer) thread.appendChild(leer);
  }
  if (leer) leer.style.display = "";
  zeigeVerlaeufe();
  (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
}

/** Rechte Spalte: was der Agent in dieser Sitzung benutzt hat. Nur echte Daten. */
function aktualisiereAgentPanel(
  tools: { name: string; costMsat: number }[],
  sessionTotalMsat?: number,
): void {
  const t = document.getElementById("agent-tools");
  if (t && tools.length > 0) {
    t.classList.remove("muted");
    t.innerHTML = tools.map((x) => `<div class="panel-row">
      <span class="panel-check">${markSvgCheck()}</span>
      <span class="panel-name">${escapeHtml(x.name)}</span>
      <span class="panel-meta">${Math.floor(x.costMsat / 1000)} sat</span></div>`).join("");
  }
  const c = document.getElementById("agent-cost");
  if (c && sessionTotalMsat !== undefined) {
    c.classList.remove("muted");
    c.innerHTML = `<div class="panel-row"><span class="panel-name">Diese Sitzung</span>
      <span class="panel-meta">${Math.floor(sessionTotalMsat / 1000)} sat</span></div>`;
  }
}

function markSvgCheck(): string {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
    stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12l5 5L20 7"/></svg>`;
}

/** Stand der Sicherheit: Punktzahl neben dem Settings-Eintrag, solange etwas fehlt. */
async function aktualisiereSicherheitsStand(): Promise<void> {
  const badge = document.getElementById("settings-security-badge");
  if (!badge || !state.keypair) return;
  const { backupStatus } = await import("../identity.js");
  const schritte = [
    backupStatus().confirmed,
    !!localStorage.getItem("freedom.backupAt"),
    localStorage.getItem("freedom.rotationPrepared") === "1",
    localStorage.getItem("freedom.successionSet") === "1",
  ];
  const erledigt = schritte.filter(Boolean).length;
  badge.textContent = erledigt < 4 ? `${erledigt}/4` : "";
  badge.classList.toggle("warn", erledigt < 4);

  // Schrittliste oben in Sicherheit
  schritte.forEach((ok, i) => {
    const el = document.querySelector<HTMLElement>(`[data-sec-step="${i}"]`);
    if (!el) return;
    el.classList.toggle("done", ok);
    const btn = el.querySelector<HTMLElement>(".sec-action");
    if (btn) btn.hidden = ok;
  });
  document.querySelectorAll<HTMLElement>(".sec-progress span").forEach((s, i) => {
    s.classList.toggle("on", i < erledigt);
  });
}

/** Relay-Stand unten in der Seitenleiste. */
async function aktualisiereNavStatus(): Promise<void> {
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

function switchTab(name: string): void {
  document.querySelectorAll(".tab-page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".app-nav button").forEach((b) => b.classList.remove("active"));
  $(`#page-${name}`).classList.add("active");
  const navBtn = document.querySelector(`.app-nav button[data-tab="${name}"]`);
  if (navBtn) navBtn.classList.add("active");
  // Kommunikation vereint die alten Seiten Chat und Raeume.
  if (name === "comm") { loadChatList(); void zeigeRaumLeiste(); }
  if (name === "profile") { loadTrust(); void zeigeAbzeichen(); void zeigeProfilVorschau(); }
  if (name === "settings") { void zeigeSicherung(); void zeigeGeraete(); void zeigeDatenschutz(); void aktualisiereSicherheitsStand(); }
  if (name === "ai") { void refreshModelDropdown(); void refreshQuota(); }
  if (name === "wallet") loadWallet();
  if (name === "earn") { loadEarnings(); loadTrust(); loadLeaderboard(); refreshClaimSummary(); updateReferralLink(); }
  updateSidebarBalances();
}

/** Trust-Level (XP) des eigenen providers — wie ein spiel-level. */
async function loadTrust(): Promise<void> {
  if (!state.keypair) return;
  try {
    const pool = await ensurePool();
    const perf = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const jobs = perf.length;
    // trust = jobs * 2 (einfach; das protokoll hat eine komplexere formel)
    const xp = jobs * 2;
    const tier = xp >= 50 ? "pro" : xp >= 10 ? "classic" : "free";
    const next = xp >= 50 ? 100 : xp >= 10 ? 50 : 10;
    const pct = Math.min(100, Math.round((xp / next) * 100));
    const fill = document.getElementById("trust-fill");
    if (fill) fill.style.width = `${Math.max(pct, 2)}%`; // min 2% damit Track sichtbar
    const xpEl = document.getElementById("trust-xp");
    if (xpEl) xpEl.textContent = `${xp} XP`;
    const jobsEl = document.getElementById("trust-jobs");
    if (jobsEl) jobsEl.textContent = `${jobs} jobs`;
    const tierEl = document.getElementById("trust-tier");
    if (tierEl) tierEl.textContent = tier;
    // Tier-Marker positionieren (10 XP / 50 XP Schwellen relativ zum nächsten Ziel)
    const bar = document.getElementById("trust-bar-track");
    if (bar) {
      const m10 = bar.querySelector<HTMLElement>(".trust-marker.m10");
      const m50 = bar.querySelector<HTMLElement>(".trust-marker.m50");
      // Marker stehen im HTML statisch (10/50 XP); hier nur Aktiv-Status:
      m10?.classList.toggle("reached", xp >= 10);
      m50?.classList.toggle("reached", xp >= 50);
    }
  } catch { /* offline */ }
}

// ------------------------------------------------------------- Chat-Tab (v0.2)
// KEIN oeffentlicher Feed (illegaler Content waere unlosbar + sichtbar fuer alle).
// Stattdessen: 1:1-DMs (verschluesselt, NIP-04-artig) + Communities (opt-in Gruppen,
// Discord-Stil). Beides adressierbar, kein globaler oeffentlicher Stream.

interface ChatConversation {
  id: string;             // dm: pubkey des Partners; community: community-id
  type: "dm" | "community";
  name: string;
  lastTs: number;
}

let conversations: ChatConversation[] = [];
let activeConversation: string | null = null;

function loadConversations(): void {
  try {
    conversations = JSON.parse(localStorage.getItem("freedom.chats") ?? "[]");
  } catch { conversations = []; }
}

function saveConversations(): void {
  localStorage.setItem("freedom.chats", JSON.stringify(conversations));
}

/**
 * Namen aufloesen — mit Herkunft und Verwechslungswarnung.
 *
 * Ein blosser Name ist gefaehrlich: "Max" kann jeder sein. Deshalb traegt die
 * Anzeige die Herkunft mit, und vor einer Verwechslung mit jemandem, den der
 * Nutzer bereits kennt, wird gewarnt — bevor eine Zahlung passiert.
 */
let namenCache: { at: number; events: unknown[] } | null = null;

async function loeseNamenAuf(pubkeys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { resolveName, displayWithSource, checkImpersonation, KIND_PETNAME } =
      await import("@freedomstack/protocol");

    const eigene = new Map<string, string>(
      JSON.parse(localStorage.getItem("freedom.petnames") ?? "[]") as [string, string][],
    );

    const jetzt = Date.now();
    if (!namenCache || jetzt - namenCache.at > 120_000) {
      const pool = await ensurePool();
      namenCache = { at: jetzt, events: await pool.query({ kinds: [KIND_PETNAME], limit: 1000 }) };
    }

    // Nur Namen von eigenen Kontakten zaehlen — sonst koennte jeder eine
    // Namenslawine erzeugen und damit jemanden umbenennen.
    const vertraut = new Set(conversations.filter((c) => c.type === "dm").map((c) => c.id));

    for (const pk of pubkeys) {
      const r = resolveName(pk, namenCache.events as never[], { ownPetnames: eigene, trusted: vertraut });
      const warnung = checkImpersonation(r, eigene);
      out.set(pk, displayWithSource(r) + (warnung ? " \u26A0" : ""));
    }
  } catch { /* ohne Netz bleibt der gekuerzte Schluessel */ }
  return out;
}

/** Einen eigenen Namen vergeben. Gilt nur lokal und ist unentziehbar. */
function setzePetname(pubkey: string, name: string, teilen = false): void {
  const eigene = new Map<string, string>(
    JSON.parse(localStorage.getItem("freedom.petnames") ?? "[]") as [string, string][],
  );
  if (name.trim()) eigene.set(pubkey, name.trim());
  else eigene.delete(pubkey);
  localStorage.setItem("freedom.petnames", JSON.stringify([...eigene]));
  namenCache = null;

  // Teilen ist ausdruecklich freiwillig: Ein veroeffentlichter Name verraet,
  // dass ich diese Person kenne — und wie ich sie nenne. Ohne Teilen nuetzt
  // die Namensschicht aber nur mir selbst.
  if (teilen && name.trim() && state.keypair) {
    void (async () => {
      try {
        const { buildPetname, signEvent: se } = await import("@freedomstack/protocol");
        await (await ensurePool()).publish(se(buildPetname({
          byPubkey: state.keypair!.pk, forPubkey: pubkey, name: name.trim(),
        }), state.keypair!.sk));
      } catch { /* lokal gilt der Name trotzdem */ }
    })();
  }
}

function loadChatList(): void {
  void syncDmInbox();
  loadConversations();
  const list = $("#chat-list");
  if (conversations.length === 0) {
    list.innerHTML = `<div class="mono-sm" style="padding:10px;color:var(--text-muted)">Noch keine Unterhaltungen. Mit + beginnst du eine.</div>`;
    return;
  }
  list.innerHTML = conversations
    .sort((a, b) => b.lastTs - a.lastTs)
    .map(
      (c) => `<div class="chat-item ${c.id === activeConversation ? "active" : ""}" data-cid="${escapeHtml(c.id)}">
        <span class="av">${c.type === "community" ? "🏠" : escapeHtml(c.name.slice(0, 1).toUpperCase())}</span>
        <span class="label">${escapeHtml(c.name)}</span>
      </div>`,
    )
    .join("");
  list.querySelectorAll(".chat-item").forEach((el) => {
    el.addEventListener("click", () => openConversation((el as HTMLElement).dataset.cid!));
    // Rechtsklick vergibt einen eigenen Namen. Er gilt nur lokal und kann
    // niemandem genommen werden — das ist die einzige Namensform, die ohne
    // Namensbehoerde eindeutig ist.
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const cid = (el as HTMLElement).dataset.cid!;
      const c = conversations.find((x) => x.id === cid);
      if (!c || c.type !== "dm") return;
      const name = prompt(`Eigener Name für ${pkShort(cid)}:`, c.name);
      if (name === null) return;
      const teilen = name.trim()
        ? confirm(
            `„${name.trim()}" auch veröffentlichen?\n\n` +
            `Dann sehen andere diesen Namen als Hinweis — und erfahren, dass du ` +
            `diese Person kennst. Abbrechen: gilt nur für dich.`)
        : false;
      setzePetname(cid, name, teilen);
      c.name = name.trim() || pkShort(cid);
      saveConversations();
      loadChatList();
    });
  });

  // Namen im Hintergrund aufloesen und nachtragen — die Liste soll nicht
  // auf das Netz warten.
  void loeseNamenAuf(conversations.filter((c) => c.type === "dm").map((c) => c.id))
    .then((namen: Map<string, string>) => {
      for (const [pk, anzeige] of namen) {
        const el = list.querySelector(`[data-cid="${CSS.escape(pk)}"] .label`);
        if (el) el.textContent = anzeige;
      }
    });
}

function openConversation(cid: string): void {
  activeConversation = cid;
  loadChatList();
  const c = conversations.find((x) => x.id === cid);
  const thread = $("#chat-thread");
  thread.innerHTML = `<div class="empty-state">${c ? escapeHtml(c.name) : ""}<br/>` +
    (c?.type === "dm" ? "1:1 — Ende-zu-Ende verschlüsselt (NIP-17). Relays sehen nicht, wer schreibt – nur, dass du Post bekommst." : "community — opt-in gruppe.") +
    `</div>`;
  loadChatMessages(cid);
}

/**
 * Moderationsstand einer Community laden.
 *
 * Ohne Netz gibt es keine Moderation — dann wird alles gezeigt statt gar
 * nichts. Ein Client, der bei Verbindungsproblemen stumm bleibt, sieht fuer
 * den Nutzer aus wie eine leere Community.
 */
async function ladeModeration(communityId: string): Promise<unknown | null> {
  try {
    const { buildModerationState, KIND_COMMUNITY_MODERATORS, KIND_MODERATION_HIDE, KIND_MODERATION_BAN } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_COMMUNITY_MODERATORS, KIND_MODERATION_HIDE, KIND_MODERATION_BAN],
      "#h": [communityId],
      limit: 500,
    });
    return evs.length > 0 ? buildModerationState(communityId, evs) : null;
  } catch {
    return null;
  }
}

/** Eine DM zur Anzeige: entschluesselt; legacy = altes Kind-4-Format. */
type DmAnzeige = NostrEvent & { legacy?: boolean };

/** Bereits geoeffnete Umschlaege (ID des Umschlags -> Ergebnis), damit nichts doppelt entschluesselt wird. */
const dmCache = new Map<string, { partner: string; ev: DmAnzeige } | null>();

async function oeffneUmschlag(w: NostrEvent): Promise<{ partner: string; ev: DmAnzeige } | null> {
  const bekannt = dmCache.get(w.id);
  if (bekannt !== undefined) return bekannt;
  if (!state.keypair) return null;
  const { openPrivateDm } = await import("@freedomstack/protocol");
  const r = await openPrivateDm(w, state.keypair.sk, state.keypair.pk);
  const e = r.ok
    ? {
        partner: r.dm.partner,
        ev: { id: r.dm.id, pubkey: r.dm.from, created_at: r.dm.createdAt, kind: 14, tags: [], content: r.dm.content, sig: "" },
      }
    : null;
  dmCache.set(w.id, e);
  return e;
}

/**
 * Alle Nachrichten einer 1:1-Unterhaltung: NIP-17-Umschlaege an mich (auch
 * meine eigenen Kopien) plus aeltere Kind-4-Nachrichten, die weiter lesbar
 * bleiben, aber nie mehr gesendet werden.
 */
async function ladeDmNachrichten(partner: string): Promise<DmAnzeige[]> {
  if (!state.keypair) return [];
  const me = state.keypair;
  const pool = await ensurePool();
  const { decryptDM } = await import("@freedomstack/protocol");
  const [umschlaege, alt] = await Promise.all([
    pool.query({ kinds: [1059], "#p": [me.pk], limit: 500 }),
    pool.query({ kinds: [4], authors: [me.pk, partner], limit: 50 }),
  ]);
  const ergebnis = new Map<string, DmAnzeige>();
  for (const w of umschlaege) {
    const e = await oeffneUmschlag(w);
    if (e && e.partner === partner) ergebnis.set(e.ev.id, e.ev);
  }
  for (const ev of alt) {
    // Nur Nachrichten zwischen genau uns beiden – nicht die des Partners an Dritte.
    const pTag = ev.tags.find((t) => t[0] === "p")?.[1];
    const betrifft = (ev.pubkey === me.pk && pTag === partner) || (ev.pubkey === partner && pTag === me.pk);
    if (!betrifft || ergebnis.has(ev.id)) continue;
    let text: string;
    try {
      text = await decryptDM(ev.content, me.sk, ev.pubkey === me.pk ? partner : ev.pubkey);
    } catch {
      text = "[entschluesselung fehlgeschlagen]";
    }
    ergebnis.set(ev.id, { ...ev, content: text, legacy: true });
  }
  return [...ergebnis.values()];
}

/**
 * Umschlag an den Posteingang des Empfaengers (Kind 10050) und an die
 * eigenen Relays. Ohne veroeffentlichte Liste bleiben die gemeinsamen Relays.
 */
async function veroeffentlicheDm(wrap: NostrEvent, empfaenger: string): Promise<void> {
  const pool = await ensurePool();
  const { parseDmRelayList, KIND_DM_RELAYS } = await import("@freedomstack/protocol");
  let ziele: string[] = [];
  try {
    const listen = await pool.query({ kinds: [KIND_DM_RELAYS], authors: [empfaenger], limit: 5 });
    ziele = parseDmRelayList(listen.sort((a, b) => b.created_at - a.created_at)[0]);
  } catch {
    /* ohne Liste: gemeinsame Relays */
  }
  await pool.publish(wrap);
  const zusaetzlich = ziele.filter((u) => !RELAYS.includes(u)).slice(0, 3);
  if (zusaetzlich.length === 0) return;
  const extra = new OutboxPool(zusaetzlich.map((u) => new WebSocketRelay(u, { timeoutMs: 8000 })), { minAcks: 1 });
  try {
    await extra.publish(wrap);
  } catch {
    /* Posteingang nicht erreichbar – die gemeinsamen Relays haben den Umschlag */
  } finally {
    (extra as unknown as { close?: () => void }).close?.();
  }
}

let letzterDmAbgleich = 0;

/**
 * Posteingang abgleichen: Neue Absender erscheinen als „Anfrage“ in der Liste,
 * und die eigenen Posteingangs-Relays werden einmal als Kind 10050
 * veroeffentlicht. Hoechstens einmal pro Minute.
 */
async function syncDmInbox(): Promise<void> {
  if (!state.keypair || Date.now() - letzterDmAbgleich < 60_000) return;
  letzterDmAbgleich = Date.now();
  try {
    const me = state.keypair;
    const pool = await ensurePool();
    const { KIND_DM_RELAYS, buildDmRelayList } = await import("@freedomstack/protocol");
    const eigene = await pool.query({ kinds: [KIND_DM_RELAYS], authors: [me.pk], limit: 1 });
    if (eigene.length === 0) {
      await pool.publish(signEvent(buildDmRelayList(me.pk, RELAYS), me.sk)).catch(() => { /* offline */ });
    }
    const umschlaege = await pool.query({ kinds: [1059], "#p": [me.pk], limit: 200 });
    let neu = 0;
    for (const w of umschlaege) {
      const e = await oeffneUmschlag(w);
      if (!e || e.partner === me.pk) continue;
      const vorhanden = conversations.find((x) => x.id === e.partner);
      if (!vorhanden) {
        conversations.push({ id: e.partner, type: "dm", name: "Anfrage · " + pkShort(e.partner), lastTs: e.ev.created_at });
        neu++;
      } else if (e.ev.created_at > (vorhanden.lastTs ?? 0)) {
        vorhanden.lastTs = e.ev.created_at;
      }
    }
    if (neu > 0) {
      saveConversations();
      loadChatList();
    }
  } catch {
    /* offline */
  }
}

async function loadChatMessages(cid: string): Promise<void> {
  // DMs: kind 4 (NIP-44, p-tag = partner). Communities: kind 42 (channel) mit h-tag.
  const c = conversations.find((x) => x.id === cid);
  if (!c || !state.keypair) return;
  try {
    const pool = await ensurePool();
    let events: NostrEvent[] = [];
    if (c.type === "dm") {
      events = await ladeDmNachrichten(c.id);
    } else {
      events = await pool.query({ kinds: [42], "#h": [c.id], limit: 50 });
    }
    const thread = $("#chat-thread");
    if (events.length === 0) return; // empty-state bleibt
    // DMs kommen bereits entschluesselt aus ladeDmNachrichten(); Communities
    // sind Klartext.
    const decrypted = events;
    // Moderation anwenden — nur fuer Communities, nur wenn der Nutzer sie
    // eingeschaltet laesst. Abschaltbar zu sein ist der Unterschied zwischen
    // einer Hausordnung und einer Zensur.
    const modState = c.type === "community" ? await ladeModeration(c.id) : null;
    const modAn = localStorage.getItem(`freedom.mod.${c.id}`) !== "off";
    const versteckt = new Map<string, { reason: string }>();
    if (modState && modAn) {
      const { applyModeration } = await import("@freedomstack/protocol");
      for (const r of applyModeration(decrypted as never[], modState as never, { enabled: true })) {
        if (r.hidden) versteckt.set(r.event.id, { reason: r.reason ?? "ausgeblendet" });
      }
    }

    thread.innerHTML = decrypted
      .sort((a, b) => a.created_at - b.created_at)
      .map((ev) => {
        const mine = ev.pubkey === state.keypair!.pk;
        // ev.content ist an dieser Stelle bereits entschluesselt (siehe oben).
        let text = ev.content;
        let atts: ChatAttachment[] = [];
        if (c.type === "dm") {
          // DM-Anhaenge stecken im verschluesselten Body (kein Klartext-Tag).
          const parsed = parseDmBody(ev.content);
          text = parsed.text;
          atts = parsed.attachments;
        } else {
          atts = parseImetaTags(ev.tags);
        }
        const media = atts.map((a) => renderAttachment(a)).join("");
        const body = escapeHtml(text);
        // Zap-Button neben jeder Nachricht (nur fuer DMs, nicht eigene)
        const v = versteckt.get(ev.id);
        if (v) {
          // Platzhalter statt spurlosem Entfernen: Eine Luecke, die man sieht,
          // ist Moderation. Eine, die man nicht sieht, ist Manipulation.
          return `<div class="bubble hidden-msg"><div class="txt mono-sm">` +
            `[ausgeblendet: ${escapeHtml(v.reason)}] ` +
            `<button class="ghost show-anyway" data-id="${escapeHtml(ev.id)}" ` +
            `style="width:auto;padding:2px 6px;font-size:10px">trotzdem zeigen</button></div></div>`;
        }
        const zapBtn = !mine && c.type === "dm" ? `<button class="zap-msg-btn" data-pk="${escapeHtml(ev.pubkey)}" data-name="${escapeHtml(pkShort(ev.pubkey))}" title="zap senden">⚡</button>` : "";
        const alt = (ev as DmAnzeige).legacy
          ? ` <span class="mono-sm" title="ältere Verschlüsselung (Kind 4): Relays sehen Absender und Empfänger">· alt</span>`
          : "";
        return `<div class="bubble ${mine ? "user" : "ai"}"><div class="who">${mine ? "du" : escapeHtml(pkShort(ev.pubkey))}${alt}${zapBtn}</div><div class="txt">${body}${media}</div></div>`;
      })
      .join("");
    thread.scrollTop = thread.scrollHeight;
    wireBlobButtons(thread);
    thread.querySelectorAll(".show-anyway").forEach((b) => {
      b.addEventListener("click", () => {
        const id = (b as HTMLElement).dataset.id!;
        const ev = decrypted.find((x) => x.id === id);
        if (ev) alert(ev.content);
      });
    });
  } catch { /* offline */ }
}

async function sendChatMessage(): Promise<void> {
  const input = $("#chat-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  // Ein reiner Anhang ohne Text ist eine gueltige Nachricht.
  if ((!text && chatAttachments.length === 0) || !state.keypair || !activeConversation) return;
  const c = conversations.find((x) => x.id === activeConversation);
  if (!c) return;
  try {
    const pool = await ensurePool();
    // NIP-92 imeta-Tags fuer Community-Posts. Bei DMs duerfen die Anhaenge
    // NICHT in Klartext-Tags landen — dort wandern sie mit in den
    // verschluesselten Body, sonst waere die Metadatenspur oeffentlich.
    const imeta: string[][] = chatAttachments.map((a) => [
      "imeta", `url ${a.url}`, `m ${a.mime}`, `name ${a.name}`,
    ]);
    if (c.type === "dm") {
      // NIP-17: Inhalt (Kind 14) im Siegel (Kind 13) im Umschlag (Kind 1059).
      // Relays sehen weder Inhalt noch Absender. Dazu eine Kopie an sich selbst.
      const { buildPrivateDm } = await import("@freedomstack/protocol");
      const payload = chatAttachments.length > 0
        ? JSON.stringify({ text, attachments: chatAttachments })
        : text;
      const dm = await buildPrivateDm({
        senderSk: state.keypair.sk,
        senderPk: state.keypair.pk,
        recipientPk: c.id,
        content: payload,
      });
      await veroeffentlicheDm(dm.toRecipient, c.id);
      await pool.publish(dm.toSelf);
    } else {
      // Community: kind 42 mit h-tag (channel-id)
      const ev = signEvent(buildEvent(state.keypair.pk, 42, [["h", c.id], ...imeta], text), state.keypair.sk);
      await pool.publish(ev);
    }
    input.value = "";
    chatAttachments = [];
    setAttachStatus($("#chat-attach-list"), "");
    c.lastTs = Math.floor(Date.now() / 1000);
    saveConversations();
    loadChatMessages(activeConversation);
  } catch (e) {
    toast(`Fehler: ${(e as Error).message}`, true);
  }
}

async function newDm(): Promise<void> {
  const eingabe = prompt("Schlüssel des Kontakts (npub oder hex):");
  if (!eingabe) return;
  let id = eingabe.trim();
  if (id.startsWith("npub1")) {
    try {
      const { decodeNpub } = await import("../identity.js");
      id = decodeNpub(id);
    } catch {
      toast("Das ist kein gültiger npub.", true);
      return;
    }
  }
  id = id.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) {
    toast("Bitte einen npub oder einen 64-stelligen Hex-Schlüssel eingeben.", true);
    return;
  }
  if (!conversations.find((c) => c.id === id)) {
    conversations.push({ id, type: "dm", name: id.slice(0, 12) + "…", lastTs: 0 });
    saveConversations();
  }
  loadChatList();
  openConversation(id);
}

function newCommunity(): void {
  const name = prompt("name der community:");
  if (!name) return;
  const id = "comm-" + Math.random().toString(36).slice(2, 10);
  conversations.push({ id, type: "community", name: name.trim(), lastTs: 0 });
  saveConversations();
  loadChatList();
  openConversation(id);
}

// ------------------------------------------------------------- KI-Tab

function updateFeePreview(): void {
  const bid = Number(($("#ai-bid") as HTMLInputElement).value);
  const split = computeFeeSplit(bid * 1000, {
    totalFeePpm: PROTOCOL_FEE_PPM,
    poolSharePercent: PROTOCOL_POOL_SHARE_PERCENT,
  });
  const p = Math.floor(split.recipientMsat / 1000);
  const pool = Math.floor(split.poolMsat / 1000);
  const proto = Math.floor(split.protocolMsat / 1000);
  const rest = bid - p - pool - proto;
  // Ehrlich anzeigen: bei kleinen Betraegen rundet 1% auf 0 sats ab.
  // Den Rundungsrest zeigen, damit die Summe immer stimmt (kein "verschwundener sat").
  $("#ai-fee-preview").textContent =
    rest > 0
      ? `${bid} sats → provider ${p} / pool ${pool} / protokoll ${proto} (+${rest} rundung)`
      : `${bid} sats → provider ${p} / pool ${pool} / protokoll ${proto}`;
  updateTokenEstimate();
}

/**
 * C7: Live-Kosten-Schätzung beim Tippen.
 * Schätzt Output-Tokens aus Prompt-Länge (~4 Zeichen/Token), multipliziert mit
 * dem Rate des gewählten Modells (oder Default) und zeigt „~X sats" im Budget-Feld.
 */
function updateTokenEstimate(): void {
  const el = $("#ai-budget");
  if (!el) return;
  const promptLen = ($("#ai-prompt") as HTMLTextAreaElement).value.length;
  if (promptLen < 10) { el.textContent = ""; return; }
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
  el.textContent = `~${estTokens} tokens ≈ ${estSats} sats`;
}

// ------------------------------------------------------------- Fehler-UX (Phase 1.2)
/** Mappt technische Fehler auf verstaendliche Ursachen. */
function explainError(e: unknown): string {
  const m = ((e as Error)?.message ?? String(e)).toLowerCase();
  if (m.includes("relay") || m.includes("websocket") || m.includes("eose") || m.includes("pool")) return "relay-verbindung fehlgeschlagen — internet pruefen oder spaeter erneut versuchen";
  if (m.includes("kein provider") || m.includes("provider") && m.includes("antwort")) return "kein provider erreichbar — alle kandidaten haben ein timeout (gx10 offline?)";
  if (m.includes("bid zu niedrig") || m.includes("kein free-tier")) return "gebot zu niedrig und kein free-kontingent mehr — bid erhöhen oder morgen wieder gratis testen";
  if (m.includes("identitaet") || m.includes("keypair") || m.includes("session")) return "identitaet fehlt — bitte neu einloggen";
  if (m.includes("timeout")) return "timeout — provider zu langsam oder offline";
  if (m.includes("comfy")) return "comfyui nicht erreichbar (port 8188) — video/image-gen braucht laufendes comfyui";
  if (m.includes("fetch") || m.includes("network") || m.includes("failed to fetch")) return "netzwerk-fehler — verbindung zum relay/server unterbrochen";
  return (e as Error)?.message ?? String(e);
}

/** Baut eine Fehler-Bubble mit Ursache + Retry-Button. */
function showAiError(e: unknown, retryPrompt: string, retryBid: number, retryTier: "free" | "classic" | "pro", retryMode: { max?: boolean; swarm?: boolean } = {}): void {
  hideTyping();
  const cause = explainError(e);
  const el = document.createElement("div");
  el.className = "bubble ai error";
  el.innerHTML = `<div class="who">⚠️ fehler</div>
    <div class="body">Ursache: <b>${escapeHtml(cause)}</b></div>`;
  const btn = document.createElement("button");
  btn.className = "btn-retry";
  btn.textContent = "↻ erneut versuchen";
  btn.onclick = () => {
    btn.remove();
    ($("#ai-prompt") as HTMLTextAreaElement).value = retryPrompt;
    ($("#ai-bid") as HTMLInputElement).value = String(retryBid);
    ($("#ai-tier") as HTMLSelectElement).value = retryMode.max ? "max" : retryMode.swarm ? "swarm" : retryTier;
    void askAi();
  };
  el.appendChild(btn);
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
  const sendBtn = $("#ai-send") as HTMLButtonElement;
  resetSendBtn(sendBtn);
}

async function askAi(): Promise<void> {
  if (!state.keypair) return;
  const promptEl = $("#ai-prompt") as HTMLTextAreaElement;
  const prompt = promptEl.value.trim();
  const bid = Number(($("#ai-bid") as HTMLInputElement).value);
  if (!prompt) return;

  const btn = $("#ai-send") as HTMLButtonElement;
  // STOP: läuft bereits ein Job → abbrechen statt neuen senden
  if (btn.dataset.running === "1" && jobAbort) {
    jobAbort.abort();
    return;
  }
  btn.dataset.running = "1";
  btn.classList.add("stop-mode");
  btn.textContent = "■ Stop";
  // Retry-Kontext ausserhalb des try-Blocks (catch braucht ihn)
  const selTier = ($("#ai-tier") as HTMLSelectElement).value;
  const maxMode = selTier === "max";
  const swarmMode = selTier === "swarm";
  const tier = (maxMode || swarmMode ? "pro" : selTier) as "free" | "classic" | "pro";
  try {
    // Kontingent erschöpft + kein Guthaben? → zum Wallet-Tab lenken statt
    // einen Job zu schicken, den niemand bezahlen kann.
    if (quotaExhausted) {
      const hasFunds = Number(localStorage.getItem("freedom.escrow.lamports") ?? "0") > 0;
      if (!hasFunds) {
        toast("gratis-kontingent aufgebraucht — erst guthaben einzahlen", true);
        switchTab("wallet");
        resetSendBtn(btn);
        return;
      }
    }
    // free tier = bid 0 (gratis-job, kein escrow) — sonst lehnt der bootstrap-provider ab
    const effectiveBid = tier === "free" ? 0 : bid;
    // Modellwechsel: wenn das Tier wechselt und schon Verlauf da ist, Summary einfuegen
    maybeInsertModelSwitchSummary(selTier);
    // Tool-Input = Prompt (die Query, die das Tool ausfuehrt)
    for (const t of selectedTools) t.input = prompt;
    addAiMessage("user", prompt, "");
    promptEl.value = "";
    hideEmptyState();
    showTyping("connecting");
    // video_gen geht DIREKT an ComfyUI (nicht an das LLM — das kann kein video)
    const wantsVideo = selectedTools.some((t) => t.name === "video_gen");
    if (wantsVideo) {
      setTypingStatus("creating");
      await generateVideo(prompt);
      resetSendBtn(btn);
      return;
    }
    // Auto-Research: wenn web-tool aktiv ODER das modell es nicht weiss, erst recherchieren
    const wantsWeb = selectedTools.some((t) => t.name === "web_search" || t.name === "browser_use");
    if (wantsWeb) setTypingStatus("researching");
    else setTypingStatus("thinking"); // job ist unterwegs → chip "denkt" sofort aktiv
    // Auto-Matchmaking + Failover (default), Race (max), oder Swarm+Judge (swarm)
    if (swarmMode) {
      await askSwarm(prompt, effectiveBid, tier);
    } else {
      await askWithFailover(prompt, effectiveBid, tier, maxMode);
    }
    // Pipeline: nach Empfang der Antwort alle Chips auf done
    document.querySelectorAll("#ai-typing .job-chip").forEach((c) => {
      c.classList.add("done"); c.classList.remove("active");
    });
  } catch (e) {
    showAiError(e, prompt, bid, tier, { max: maxMode, swarm: swarmMode });
  }
}

/** Sendet den Job an den besten Provider; bei Timeout automatisch der naechste.
 *  maxMode=true: Race — Job an N Provider, schnellster gewinnt (opt-in, Aufpreis). */
async function askWithFailover(prompt: string, bid: number, tier: "free" | "classic" | "pro", maxMode = false): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  const candidates = await findProviders(tier);

  if (maxMode) {
    return askRace(prompt, bid, tier, candidates);
  }

  const pubkeyList = candidates.map((c) => c.caps.pubkey);
  // Bekannten Session-Provider zuerst (Kontinuitaet), dann beste Matches
  if (state.lastProvider && sc.activeFor(state.lastProvider) && !pubkeyList.includes(state.lastProvider)) {
    pubkeyList.unshift(state.lastProvider);
  }
  // Fallback: ohne Matchmaking ein offener Bid-Job (jeder Provider darf antworten)
  const targets: Array<string | null> = pubkeyList.length > 0 ? pubkeyList.slice(0, 3) : [null];

  // HEDGING: Nach HEDGE_AFTER_MS ohne Antwort wird derselbe Job ZUSÄTZLICH an
  // den nächsten Provider geschickt (der erste läuft weiter). Wer zuerst
  // antwortet, gewinnt — Wartezeit max. Hedge-Intervall statt Provider-Timeout.
  const HEDGE_AFTER_MS = Number(localStorage.getItem("freedom.hedgeMs") ?? 20_000);
  /** Alle aktiven Job-Ids dieses Laufs (Results aus allen akzeptieren). */
  const activeJobIds = new Set<string>();
  let lastFeedbackError = "";

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    // erster Kandidat: hedge-fenster + restlaufzeit (browser-suche braucht zeit)
    const timeoutMs = i === 0 ? HEDGE_AFTER_MS + Math.min(280_000, 300_000 - HEDGE_AFTER_MS) : 120_000;
    const ev = buildJobEvent(prompt, bid, tier, target, sc);
    await pool.publish(ev);
    activeJobIds.add(ev.id);

    const answer = await waitForAnswer(ev.id, timeoutMs, target ?? undefined, {
      extraJobIds: activeJobIds,
      onFeedback: (msg) => { lastFeedbackError = msg; },
      signal: jobAbort?.signal,
    });
    if (answer) {
      if ("providerError" in answer && answer.providerError) {
        // Ablehnung durch DIESEN Provider → Failover zum nächsten (die meisten
        // Ablehnungen sind provider-spezifisch: quota, bootstrap, preis).
        lastFeedbackError = answer.providerError;
        toast(`provider lehnt ab (${answer.providerError.slice(0, 50)}) — naechster…`);
        continue; // Failover!
      }
      if (answer.aborted) {
        addAiMessage("ai", "[abgebrochen]", "");
        return;
      }
      await handleAnswer(answer.ev, answer.parsed!);
      return;
    }
    if (i < targets.length - 1) {
      // kein Feedback, nur langsam → Hedge: nächster Provider bekommt ihn JETZT,
      // der aktuelle bleibt aktiv (seine Antwort wird via activeJobIds noch
      // akzeptiert).
      toast(`provider ${pkShort(target ?? "")} langsam — hedging zu naechstem…`);
    }
  }
  // Alle Kandidaten versagt (Timeout oder Ablehnung):
  showAiError(
    new Error(lastFeedbackError || "kein provider im netz geantwortet"),
    prompt, bid, tier,
  );
}

/** Payment-Feedback von fremden Providern (NWC-timeouts etc.) ist KEIN
 *  Job-Fehler — der Antwortfluss darf dadurch nicht abbrechen. */
function isPaymentNoise(msg: string): boolean {
  return /payment error|nwc timed out|keysend.*(fail|timeout)|invoice.*timeout/i.test(msg);
}

/** video_gen: direkt an ComfyUI (H3), nicht an das LLM. */
async function generateVideo(prompt: string): Promise<void> {
  hideTyping();
  // qualitaet/laenge aus den selects
  const dur = Number((document.getElementById("video-duration") as HTMLSelectElement | null)?.value ?? "3");
  const qual = (document.getElementById("video-quality") as HTMLSelectElement | null)?.value ?? "std";
  const size = qual === "hd" ? { width: 1280, height: 720 } : qual === "low" ? { width: 480, height: 270 } : { width: 768, height: 432 };
  const length = Math.max(17, Math.min(121, dur * 24 + 5)); // 17k+5 grid
  addAiMessage("ai", `[video] wird generiert (${size.width}×${size.height}, ~${dur}s) — das dauert ~1-2 min`, "");
  try {
    // ueber den gate-proxy (/comfy) auf gleicher origin
    const base = `${location.origin}/comfy`;
    const wf = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors", weight_dtype: "default" } },
      "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax" } },
      "3": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
      "5": { class_type: "MiniMaxH3ImageToVideo", inputs: { clip: ["2", 0], vae: ["3", 0], prompt, width: size.width, height: size.height, length } },
      "6": { class_type: "EmptyMiniMaxH3LatentAV", inputs: { width: size.width, height: size.height, length, batch_size: 1 } },
      "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["5", 0], negative: ["5", 0], latent_image: ["6", 0], seed: Math.floor(Math.random() * 2 ** 32), steps: 20, cfg: 5.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0 } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
      "9": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 24 } },
      "10": { class_type: "SaveVideo", inputs: { video: ["9", 0], filename_prefix: "freedom_h3", format: "mp4", codec: "h264" } },
    };
    const r = await fetch(`${base}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: wf }) });
    if (!r.ok) throw new Error(`comfy ${r.status}`);
    const { prompt_id } = await r.json();
    // poll bis fertig (max 10 min — H3 dauert)
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 5000));
      const h = await fetch(`${base}/history/${prompt_id}`);
      if (!h.ok) continue;
      const hd = await h.json();
      const entry = hd[prompt_id];
      if (entry?.status?.completed) {
        const files = Object.values(entry.outputs ?? {}).flatMap((o: unknown) => (o as { images?: Array<{ filename: string }> }).images ?? []);
        if (files.length > 0) {
          const fname = (files[0] as { filename: string }).filename;
          addAiMessage("ai", `✅ video fertig: <a href="${base}/view?filename=${encodeURIComponent(fname)}" target="_blank">${fname}</a>`, "");
          return;
        }
      }
      if (entry?.status?.status_str === "error") {
        addAiMessage("ai", `(video-fehler: ${entry.status.messages?.find((m: string[]) => m[0] === "execution_error")?.[1]?.exception_message ?? "unbekannt"})`, "");
        return;
      }
    }
    addAiMessage("ai", "(video-timeout — versuch es kuerzer oder spaeter)", "");
  } catch (e) {
    addAiMessage("ai", `(video-fehler: ${(e as Error).message})`, "");
  }
}

/** MAX MODE: Race — Job an N Provider, schnellster gewinnt. Opt-in (Aufpreis). */
async function askRace(prompt: string, bid: number, tier: "free" | "classic" | "pro", candidates: ScoredProvider[]): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  const racers = matchRaceProviders(candidates, tier, DEFAULT_MAX_MODE);
  if (racers.length === 0) {
    showAiError(new Error("kein provider im tier 'max' erreichbar"), prompt, bid, tier, { max: true });
    return;
  }
  const split = maxModeSplit(bid * 1000);
  toast(`max mode: ${racers.length} provider racen — gewinner ${Math.floor(split.winnerMsat / 1000)} sats, je verlierer ${Math.floor(split.loserMsatEach / 1000)}`);

  // Job an ALLE racer gleichzeitig (race-tag + p-tag pro provider)
  const jobs = racers.map((r) => {
    const ev = buildJobEvent(prompt, bid, tier, r.caps.pubkey, sc);
    ev.tags.push(["race", "1"]);
    // re-sign wegen neuem tag
    return signEvent({ pubkey: ev.pubkey, kind: ev.kind, tags: ev.tags, content: ev.content, created_at: ev.created_at }, state.keypair!.sk);
  });
  for (const j of jobs) await pool.publish(j);

  // Erste Antwort gewinnt
  const ids = new Set(jobs.map((j) => j.id));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const results = await pool.query({ kinds: [KIND_DVM_RESULT], limit: 20 });
    const hit = results.find((ev) => ids.has(ev.tags.find((t) => t[0] === "e")?.[1] ?? ""));
    if (hit) {
      let r: ReturnType<typeof parseJobResult>;
      try {
        r = parseJobResult(hit);
      } catch {
        r = { requestId: hit.id, customerPubkey: "", providerPubkey: hit.pubkey, output: hit.content, amountMsat: 0 } as ReturnType<typeof parseJobResult>;
      }
      const winner = r.providerPubkey;
      toast(`${pkShort(winner)} gewinnt das race`);
      await handleAnswer(hit, r);
      return;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  hideTyping();
  showAiError(new Error("max mode: kein racer geantwortet"), prompt, bid, tier, { max: true });
}

/** SWARM: N Responder antworten, Judge waehlt/synthetisiert die beste. */
async function askSwarm(prompt: string, bid: number, tier: "free" | "classic" | "pro"): Promise<void> {
  const pool = await ensurePool();
  const sc = ensureSessionClient();
  // Swarm = lokaler Provider mit beiden Modellen (nemotron + qwen3.8:27b)
  // Wir senden einen Job mit ["swarm", "1"] tag — der Provider erkennt das und nutzt beide Modelle
  const candidates = await findProviders(tier);
  const target = candidates[0]?.caps.pubkey ?? null; // Erster Provider (lokaler GX10)
  const btn = $("#ai-send") as HTMLButtonElement;
  if (!target) {
    showAiError(new Error("kein provider fuer swarm — freedomstack-node laeuft nicht"), prompt, bid, tier, { swarm: true });
    return;
  }

  toast(`swarm: beide modelle (nemotron + qwen3.8:27b) denken parallel…`);
  const ev = buildJobEvent(prompt, bid, tier, target, sc);
  ev.tags.push(["swarm", "1"]); // Tag fuer swarm-modus im provider
  await pool.publish(ev);
  const answer = await waitForAnswer(ev.id, 120_000, target);
  if (answer) {
    if ("providerError" in answer && answer.providerError) {
      showAiError(new Error(answer.providerError), prompt, bid, tier, { swarm: true });
      return;
    }
    if (answer.aborted) { addAiMessage("ai", "[abgebrochen]", ""); return; }
    await handleAnswer(answer.ev, answer.parsed!);
    return;
  }

  hideTyping();
  showAiError(new Error("swarm: provider keine antwort — timeout"), prompt, bid, tier, { swarm: true });
}

/** Modellwechsel-Summary: bei Tier-Wechsel mit Verlauf eine kompakte
 *  Zusammenfassung als Kontext einfuegen (wie Claude bei Modellwechsel).
 *  Gibt die Summary zurueck, die als Kontext-Praefix an den Job geht. */
let lastTier: string | null = null;
let pendingContextSummary = "";
function maybeInsertModelSwitchSummary(newTier: string): void {
  const thread = $("#ai-thread");
  const hasHistory = thread.querySelectorAll(".bubble").length > 0;
  pendingContextSummary = "";
  if (lastTier && lastTier !== newTier && hasHistory) {
    // Sammle bisherige Nachrichten als kompakten Kontext
    const msgs = Array.from(thread.querySelectorAll(".bubble .txt")).map((el) => el.textContent ?? "").filter(Boolean);
    const summary = msgs.slice(-8).join("\n").slice(0, 800);
    pendingContextSummary = `[Bisheriger Verlauf, kompakt]:\n${summary}\n\n[Neue Nachricht]:\n`;
    const note = document.createElement("div");
    note.className = "model-switch";
    note.innerHTML = `<div class="model-switch-inner">⇄ modell gewechselt zu <b>${escapeHtml(newTier)}</b> — kontext wird mitgegeben (${msgs.length} nachrichten)</div>`;
    thread.appendChild(note);
    stickToBottom(() => note.scrollIntoView({ behavior: "smooth", block: "end" }));
  }
  lastTier = newTier;
}

/** Einmal pro Sitzung: KI-Anfragen sind derzeit oeffentlich lesbar (Schritt 3.1 behebt das). */
function hinweisKiOeffentlich(): void {
  try {
    if (sessionStorage.getItem("freedom.hinweis.kiOeffentlich")) return;
    sessionStorage.setItem("freedom.hinweis.kiOeffentlich", "1");
    toast("Hinweis: KI-Anfragen sind derzeit öffentlich lesbar – bitte keine vertraulichen Daten senden.");
  } catch {
    // Ohne sessionStorage (z. B. im Test) kein Hinweis – die Anfrage selbst laeuft weiter.
  }
}

function buildJobEvent(
  prompt: string,
  bid: number,
  tier: string,
  targetPubkey: string | null,
  sc: SessionClient,
): import("@freedomstack/protocol").NostrEvent {
  hinweisKiOeffentlich();
  if (!state.keypair) throw new Error("no keypair");
  // Modellwechsel: Verlauf-Summary als Kontext-Praefix (KV-cache-Ersatz)
  const fullPrompt = pendingContextSummary ? pendingContextSummary + prompt : prompt;
  // Extra-Tags: Anhang (multimodal) + angeforderte Tools + gewuenschtes Modell
  const extraTags: string[][] = [];

  // CLIENT-GEBUEHR — offen deklariert, nicht im Protokoll versteckt.
  //
  // Der Entwickler-Anteil lag frueher im Protokoll: Jeder Provider fuehrte an
  // eine feste Adresse ab, die er nicht aendern konnte. Damit gab es einen
  // Betreiber, egal was die README sagte. Jetzt deklariert dieser Client seine
  // Gebuehr selbst — sichtbar, gedeckelt, und von einem Fork entfernbar. Genau
  // diese Entfernbarkeit ist der Beweis, dass niemand das Protokoll kontrolliert.
  const clientFee = aktiveClientGebuehr();
  if (clientFee) extraTags.push(clientFeeTag(clientFee));
  if (attachment) {
    extraTags.push(["attach", attachment.type, attachment.name, attachment.dataUrl.slice(0, 2000)]);
  }
  for (const tk of selectedTools) {
    extraTags.push(["tool", String(tk.kind), tk.input]);
  }
  // Modell-Wahl: aus Dropdown (leer = provider-default, nemotron bevorzugt)
  const modelSel = $("#ai-model") as HTMLSelectElement | null;
  if (modelSel && modelSel.value) {
    extraTags.push(["param", "model", modelSel.value]);
  }
  const useSession = targetPubkey && sc.activeFor(targetPubkey);
  if (useSession) {
    return signEvent(
      buildEvent(state.keypair.pk, KIND_DVM_TEXT_GENERATION, [
        ["i", fullPrompt, "text"],
        ...sc.jobTags(targetPubkey, bid * 1000),
        ["tier", tier],
        ["p", targetPubkey],
        ...extraTags,
      ], ""),
      state.keypair.sk,
    );
  }
  return signEvent(
    buildJobRequest({
      customerPubkey: state.keypair.pk,
      input: fullPrompt,
      bidMsat: bid * 1000,
      providerPubkey: targetPubkey ?? undefined,
      params: [["tier", tier]],
      extraTags,
    }),
    state.keypair.sk,
  );
}

/**
 * Die Gebuehr dieses Clients.
 *
 * Der Nutzer kann sie in den Einstellungen auf 0 setzen. Das ist kein Fehler
 * im Design, sondern der Punkt: Eine Gebuehr, die man nicht abschalten kann,
 * ist eine Steuer — und wer eine Steuer erhebt, ist ein Betreiber.
 */
function aktiveClientGebuehr(): ClientFee | null {
  const gespeichert = localStorage.getItem("freedom.clientfee.percent");
  const percent = gespeichert !== null ? Number(gespeichert) : DEFAULT_CLIENT_FEE_PERCENT;
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return {
    recipient: CLIENT_FEE_RECIPIENT,
    ppm: clientFeePpm(Math.min(percent, MAX_CLIENT_FEE_PERCENT)),
    clientName: "FreedomStack App",
  };
}

/**
 * Die App exportiert sich selbst.
 *
 * Damit wird jede Installation zu einer Bezugsquelle. Faellt die Domain aus —
 * beschlagnahmt, gekuendigt, DNS manipuliert —, kann jeder Nutzer die App
 * weitergeben, und der Empfaenger kann ihre Echtheit gegen das signierte
 * Manifest auf den Relays pruefen. Ein Bezugsweg, der an einem Domainnamen
 * haengt, war der zweite Punkt, an dem das System doch abschaltbar war.
 */
async function exportiereApp(): Promise<void> {
  const status = $("#selfexport-status");
  try {
    if (status) status.textContent = "lese die eigene Datei …";
    // Die App holt sich selbst — im Einzeldatei-Build ist das genau die Datei,
    // die der Nutzer weitergeben soll.
    const res = await fetch(location.href, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const { hashText, sharingInstructions } = await import("@freedomstack/protocol");
    const hash = hashText(html);
    const version = (window as unknown as { FREEDOM_VERSION?: string }).FREEDOM_VERSION ?? "dev";

    const lade = (inhalt: BlobPart, name: string, typ: string): void => {
      const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    };

    lade(html, "freedom.html", "text/html");
    // Die Prueflanleitung wandert mit: Wer weitergibt, soll sie nicht selbst
    // formulieren muessen.
    lade(sharingInstructions(hash, version), "freedom-pruefen.txt", "text/plain");

    if (status) {
      status.innerHTML =
        `Exportiert. Prüfsumme:<br><span class="mono-sm">${escapeHtml(hash)}</span><br>` +
        `Wer die Datei von dir bekommt, kann sie damit gegen das signierte ` +
        `Manifest auf den Relays prüfen.`;
      status.className = "mono-sm ok";
    }
    toast("App exportiert — jetzt bist du eine Bezugsquelle");
  } catch (e) {
    if (status) {
      status.textContent =
        `Selbst-Export nicht möglich (${(e as Error).message}). ` +
        `Im Einzeldatei-Build funktioniert er; hinter einem Server mit ` +
        `Zugriffsschutz kann die Seite sich nicht selbst lesen.`;
      status.className = "mono-sm warn";
    }
  }
}

/** Prueft die eigene Datei gegen die signierten Manifeste im Netz. */
async function pruefeEigeneEchtheit(): Promise<void> {
  const box = $("#selfcheck-status");
  if (!box) return;
  try {
    const {
      hashText, parseReleaseManifest, verifyArtifact, latestRelease, allSources,
      KIND_RELEASE_MANIFEST,
    } = await import("@freedomstack/protocol");

    const res = await fetch(location.href, { cache: "no-store" });
    const hash = hashText(await res.text());

    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_RELEASE_MANIFEST], limit: 50 });
    const manifeste = evs.map((e) => {
      try { return parseReleaseManifest(e); } catch { return null; }
    }).filter((m): m is NonNullable<typeof m> => m !== null);

    const r = verifyArtifact(hash, "freedom.html", manifeste, TRUSTED_SIGNERS);
    const cls = r.status === "echt" ? "ok" : r.status === "abweichend" ? "err" : "warn";
    const neueste = latestRelease(manifeste, TRUSTED_SIGNERS);
    const quellen = allSources(manifeste, TRUSTED_SIGNERS);

    box.innerHTML =
      `<span class="${cls}">${escapeHtml(r.message)}</span>` +
      (neueste && neueste.version !== r.version
        ? `<br>Neuere Version verfügbar: ${escapeHtml(neueste.version)}.`
        : "") +
      (quellen.length > 0
        ? `<br><span class="muted">Bezugsquellen: ${quellen.map((q) => escapeHtml(q)).join(", ")}</span>`
        : "");
  } catch (e) {
    box.textContent = `Echtheit nicht prüfbar: ${(e as Error).message}`;
    box.className = "mono-sm warn";
  }
}

/**
 * Signierschluessel, denen die App bei Release-Manifesten vertraut.
 *
 * Ohne diese Liste koennte jeder ein Manifest fuer seine eigene manipulierte
 * Datei veroeffentlichen und sie als echt ausweisen. Die Pruefung ist genau so
 * viel wert wie diese Liste — deshalb steht sie im Quelltext und nicht in
 * einer Konfiguration, die sich unterwegs aendern laesst.
 */
const TRUSTED_SIGNERS: string[] = [
  // VOR DEM RELEASE SETZEN: Pubkey des Projekt-Signierschluessels.
];

/**
 * Werden Direktnachrichten als Gift-Wrap (NIP-59/NIP-17) verschickt?
 * Seit Schritt 2.1: ja – sendChatMessage() nutzt buildPrivateDm(). Der
 * Datenschutzbericht liest diesen Wert; test/dm-verdrahtung.test.ts prueft,
 * dass er zum Sendepfad passt.
 */
const DMS_GIFT_WRAPPED = true;

/** Einstellung der App-Gebuehr: anzeigen, aendern, abschalten. */
async function wireClientFeeSetting(): Promise<void> {
  const input = $("#clientfee-percent") as HTMLInputElement | null;
  const save = $("#clientfee-save");
  const status = $("#clientfee-status");
  if (!input || !save || !status) return;

  const gespeichert = localStorage.getItem("freedom.clientfee.percent");
  input.value = String(gespeichert !== null ? Number(gespeichert) : DEFAULT_CLIENT_FEE_PERCENT);

  const zeige = (): void => {
    const p = Number(input.value);
    const gesamt = 2.5 + Math.max(0, Math.min(p, MAX_CLIENT_FEE_PERCENT));
    status.textContent =
      p <= 0
        ? `App-Gebühr aus. Gesamt 2,5 % — nur das Protokoll.`
        : `Gesamt ${gesamt.toFixed(1)} %: 2,0 % Pool, 0,5 % Werber, ${p.toFixed(1)} % App.`;
  };
  zeige();
  input.addEventListener("input", zeige);

  save.onclick = () => {
    const p = Math.max(0, Math.min(Number(input.value) || 0, MAX_CLIENT_FEE_PERCENT));
    localStorage.setItem("freedom.clientfee.percent", String(p));
    input.value = String(p);
    zeige();
    toast(p <= 0 ? "App-Gebühr abgeschaltet" : `App-Gebühr auf ${p} % gesetzt`);
  };
}

/** Empfaenger der Client-Gebuehr dieser App. */
const CLIENT_FEE_RECIPIENT =
  (window as unknown as { FREEDOM_CLIENT_FEE_LUD16?: string }).FREEDOM_CLIENT_FEE_LUD16
  ?? "freedomstack@walletofsatoshi.com";

/** Abbruch-Signal für den laufenden AI-Job (Stop-Button). */
let jobAbort: AbortController | null = null;

async function waitForAnswer(
  requestId: string,
  timeoutMs: number,
  expectedProvider?: string,
  opts: {
    /** Results aus ALLEN diesen Job-Ids akzeptieren (Hedging). */
    extraJobIds?: Set<string>;
    /** Callback für kind-7000-Ablehnungen (für Failover-Logik). */
    onFeedback?: (message: string) => void;
    /** AbortController des Stop-Buttons. */
    signal?: AbortSignal;
  } = {},
) {
  const pool = await ensurePool();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return { aborted: true as const };
    // Feedback-Events (kind 7000): Ablehnung -> Failover. ABER: status=progress
    // ist KEINE Ablehnung (provider arbeitet noch) — weiter warten.
    const feedback = await pool.query({ kinds: [7000], "#e": [requestId], limit: 5 });
    if (feedback.length > 0) {
      const statusTag = feedback[0].tags.find((t) => t[0] === "status")?.[1] ?? "";
      const fbMsg = feedback[0].content.replace(/^error:\s*/i, "");
      if (statusTag === "progress") {
        // Progress vom Provider: "tool:web_search" → research-chip + label
        if (fbMsg.startsWith("tool:")) {
          const tool = fbMsg.slice(5);
          const stepKey = /search|browser/i.test(tool) ? "researching"
            : /image|paint/i.test(tool) ? "creating"
            : "thinking";
          advanceJobPipeline(stepKey);
          setTypingLabel(toolLabel(tool));
        } else {
          advanceJobPipeline("thinking");
          setTypingLabel(fbMsg);
        }
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      if (/thinking|processing|working/i.test(fbMsg) && !/^error/i.test(fbMsg)) {
        // Alte Provider ohne status-tag aber klar progressivem Text
        setTypingLabel("denkt nach…");
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      if (isPaymentNoise(fbMsg)) {
        // Payment-Noise von fremden Providern: ignorieren, weiter auf Result warten.
        // (Ein NWC-timeout bei DEM Provider betrifft nicht unseren Job-Flow —
        // wir zahlen per Session/Beleg, nicht via NWC.)
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      opts.onFeedback?.(fbMsg);
      return { ev: feedback[0], parsed: null, providerError: fbMsg };
    }
    // Results aus allen aktiven Jobs (Hedge) akzeptieren:
    const ids = opts.extraJobIds ? [...opts.extraJobIds] : [requestId];
    const results = await pool.query({ kinds: [KIND_DVM_RESULT], "#e": ids });
    if (results.length > 0) {
      // NEU: Nur Antworten vom erwarteten Provider akzeptieren (wenn angegeben).
      // Beim Hedging entfällt dieser Filter — erster Result gewinnt.
      const filtered = expectedProvider && !opts.extraJobIds
        ? results.filter((ev) => ev.pubkey === expectedProvider || ev.pubkey.startsWith(expectedProvider))
        : results;
      if (filtered.length === 0) {
        // Keine Antwort vom erwarteten Provider — weiter warten
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      try {
        return { ev: filtered[0], parsed: parseJobResult(filtered[0]) };
      } catch {
        // Result ohne e/p/amount (z.B. provider-fehler) — als text-antwort zeigen
        return { ev: filtered[0], parsed: { requestId, customerPubkey: "", providerPubkey: filtered[0].pubkey, output: filtered[0].content, amountMsat: 0 } as ReturnType<typeof parseJobResult> };
      }
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return null;
}

async function handleAnswer(ev: import("@freedomstack/protocol").NostrEvent, r: ReturnType<typeof parseJobResult>): Promise<void> {
  hideTyping();
  // Modell-name: aus usage (provider setzt es), sonst aus den provider-caps
  const model = r.usage?.model ?? lastProviderModel ?? undefined;
  // DEBUG: zeige die provider-pubkey, damit wir wissen WER antwortet
  const who = model ? `${model} · ${r.providerPubkey.slice(0, 12)}…` : `provider ${r.providerPubkey.slice(0, 12)}…`;
  // Streaming-Anzeige: buchstabenweise statt ganzer block
  addAiMessageStreaming("ai", r.output, "", who, () => {
    addUsageBubble(r.usage ?? {}, r.amountMsat, r.providerPubkey, ev.id);
    // KEIN Zap-Button unter jeder Antwort — das wuerde die UX kaputt machen.
    // Zaps sind nur fuer besondere Antworten (manuell vom Nutzer gewaehlt).
  });
  // Erste Nutzung vermerken: Erst danach fragt die Fuehrung nach Sicherung
  // und Wallet. Vorher haette der Nutzer nichts zu verlieren und keinen Grund.
  localStorage.setItem("freedom.usedOnce", "1");
  void zeigeOnboarding();
  const succSetup = $("#succ-setup");
  if (succSetup) succSetup.onclick = () => void richteNachfolgeEin();
  const succBeat = $("#succ-heartbeat");
  if (succBeat) succBeat.onclick = async () => {
    if (!state.keypair) return;
    const { buildHeartbeat, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildHeartbeat(state.keypair.pk), state.keypair.sk));
    toast("Lebenszeichen gesendet — laufende Vorgänge sind abgebrochen");
    void zeigeNachfolge();
  };
  const modelsRefresh = $("#models-refresh");
  if (modelsRefresh) modelsRefresh.onclick = () => void zeigeModelle();
  const modelsSeed = $("#models-seed");
  if (modelsSeed) modelsSeed.onclick = () => void haltevorModell();
  const modelsPub = $("#models-publish");
  if (modelsPub) modelsPub.onclick = () => void kuendigeModellAn();
  const badgeCreate = $("#badge-create");
  if (badgeCreate) badgeCreate.onclick = () => void vergebeAbzeichen();
  void zeigeNachfolge();
  void zeigeModelle();
  void zeigeMitwirkende();
  state.lastProvider = r.providerPubkey;
  // Der Provider teilt seine SOL-Adresse im Ergebnis mit. Nur so bekommt der
  // Kunde eine Empfaengeradresse, die er nicht selbst abtippen muss.
  if (r.solanaAddress) state.lastProviderSolAddress = r.solanaAddress;
  if (r.usage?.model) lastProviderModel = r.usage.model;
  const sc = ensureSessionClient();
  const charge = await sc.chargeForResult(r.providerPubkey, r.amountMsat, ev.id);
  updateBudgetBar();
  if (r.amountMsat === 0) {
    // Gratis-Job (free-tier/bootstrap) — kein settlement nötig
  } else if (charge.settled) {
    toast(`settled: ${Math.floor(r.amountMsat / 1000)} sats via keysend`);
  } else {
    // Beleg-only: Schuld dokumentiert, Zahlung gebündelt sobald wallet verbunden
    const due = Math.floor(charge.remainingMsat / 1000);
    toast(`beleg gespeichert — zahlung gebündelt später (wallet optional)`);
    console.log(`[session] unsettled debt: ${due} sats remaining`);
  }
  void refreshQuota();
  resetSendBtn($("#ai-send") as HTMLButtonElement);
}

/** Send-Button nach Job-Ende zurücksetzen (Stop-Modus aus). */
function resetSendBtn(btn: HTMLButtonElement): void {
  btn.dataset.running = "";
  btn.classList.remove("stop-mode");
  btn.disabled = false;
  btn.textContent = "Anfragen";
}

async function pollAiAnswer(requestId: string): Promise<void> {
  // Legacy-Pfad (nicht mehr im Hauptflow; askWithFailover ersetzt es)
  const answer = await waitForAnswer(requestId, 120_000);
  if (answer && !("providerError" in answer && answer.providerError) && !("aborted" in answer && answer.aborted)) {
    await handleAnswer(answer.ev, answer.parsed!);
  }
}

function updateBudgetBar(): void {
  const el = $("#ai-budget");
  const bal = $("#balance");
  if (!state.lastProvider || !state.sessionClient) {
    el.textContent = "Noch keine Sitzung. Die erste Anfrage startet eine.";
    el.className = "mono-sm";
    if (bal) bal.textContent = "— sats";
    return;
  }
  const b = state.sessionClient.budgetState(state.lastProvider);
  if (!b) {
    el.textContent = "Noch keine Sitzung. Die erste Anfrage startet eine.";
    el.className = "mono-sm";
    if (bal) bal.textContent = "— sats";
    return;
  }
  el.textContent = `session: ${Math.floor(b.charged / 1000)}/${Math.floor(b.max / 1000)} sats (${b.pct}%)`;
  el.className = b.pct >= 80 ? "mono-sm warn" : "mono-sm";
  // Header-Guthaben: verbleibendes Session-Budget (non-custodial proxy)
  if (bal) {
    const left = Math.floor((b.max - b.charged) / 1000);
    bal.textContent = `${left} sats`;
    bal.className = left < 10 ? "balance warn" : "balance";
  }
  updateSidebarBalances();
}

function addAiMessage(role: "user" | "ai", text: string, meta: string, model?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  // AI-Antworten: Markdown rendern. User: plain (escaped).
  const body = role === "ai" ? renderMarkdown(escapeHtml(text)) : escapeHtml(text);
  // Der Modellname kommt vom Provider (usage.model, Ankuendigung) – nie roh ins HTML.
  const whoLabel = role === "user" ? "du" : `agent${model ? ` · ${escapeHtml(model)}` : ""}`;
  el.innerHTML = `<div class="who">${whoLabel}</div>
    <div class="body">${body}</div>${meta ? `<div class="cost">${escapeHtml(meta)}</div>` : ""}`;
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
  merkeNachricht(role, text, meta, model);
  return el;
}

/** Simuliertes Streaming: zeigt die AI-Antwort buchstabenweise an (typewriter).
 *  Echtes Nostr-Streaming waere komplex (multi-event); so wirkt es lebendig. */
function addAiMessageStreaming(role: "ai", text: string, meta: string, model?: string, onDone?: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  const whoLabel = `agent${model ? ` · ${escapeHtml(model)}` : ""}`;
  el.innerHTML = `<div class="who">${whoLabel}</div><div class="body"></div>${meta ? `<div class="cost">${escapeHtml(meta)}</div>` : ""}`;
  const bodyEl = el.querySelector(".body") as HTMLElement;
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));

  let i = 0;
  const speed = 12; // ms pro zeichen (schneller: nutzer wollen die antwort)
  const tick = () => {
    if (i < text.length) {
      bodyEl.textContent = text.slice(0, ++i);
      stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
      setTimeout(tick, speed);
    } else {
      // fertig: markdown rendern + code-block-copy-buttons aktivieren
      bodyEl.innerHTML = renderMarkdown(escapeHtml(text));
      activateCodeBlocks(bodyEl);
      stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
      merkeNachricht("ai", text, meta, model);
      onDone?.();
    }
  };
  setTimeout(tick, speed);
  return el;
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
  jobId: string | undefined, providerPk: string, amountMsat: number,
): Promise<void> {
  if (!state.keypair || !jobId) {
    toast("Ohne Bezug zur Antwort nicht reklamierbar", true);
    return;
  }
  const { disputeInfo, buildDispute, disputeWindowOpen, signEvent: se } =
    await import("@freedomstack/protocol");

  if (!confirm(disputeInfo())) return;

  const grund = prompt(
    "Was war das Problem?\n" +
    "  1 = gar keine Antwort\n" +
    "  2 = Antwort unbrauchbar\n" +
    "  3 = anderes Modell als vereinbart\n" +
    "  4 = mittendrin abgebrochen",
    "2",
  );
  if (!grund) return;
  const arten = ["nichts_geliefert", "unbrauchbar", "falsches_modell", "abgebrochen"] as const;
  const art = arten[Number(grund) - 1] ?? "unbrauchbar";

  try {
    const w = disputeWindowOpen(Math.floor(Date.now() / 1000) - 60);
    if (!w.open) {
      toast(w.message, true);
      return;
    }
    await (await ensurePool()).publish(se(buildDispute({
      jobId, customerPubkey: state.keypair.pk, providerPubkey: providerPk,
      reason: art, amountMsat, note: prompt("Kurze Beschreibung (öffentlich):") ?? "",
    }), state.keypair.sk));
    toast(`Reklamiert. ${w.message}`);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Zahl aus Fremddaten sicher als Text – nie ein ungepruefter Wert in innerHTML. */
function ganzeZahl(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : "0";
}

function addUsageBubble(usage: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  toolCalls?: Array<{ name: string; kind: number; costMsat: number }>;
  sessionTotalMsat?: number;
}, amountMsat: number, providerPk: string, resultEventId?: string): void {
  const el = document.createElement("div");
  el.className = "usage-bubble";
  aktualisiereAgentPanel(usage.toolCalls ?? [], usage.sessionTotalMsat);
  // Jedes Werkzeug als eigene Zeile mit Haken — im Entwurf war das der Kern:
  // man sieht auf einen Blick, was der Agent getan hat und was es gekostet hat.
  const haken = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
    stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>`;
  const toolRows = (usage.toolCalls ?? [])
    .map((t) => `<div class="tool-card">
      <span class="tool-check">${haken}</span>
      <span class="tool-name">${escapeHtml(t.name)}</span>
      <span class="tool-cost">${Math.floor(t.costMsat / 1000)} sat</span></div>`)
    .join("");

  // Nimmt Klartext und maskiert selbst – so kann kein Aufrufer es vergessen.
  const zeile = (k: string, v: string): string =>
    `<div class="usage-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`;

  const werkzeugTeil = toolRows
    ? `<div class="tool-list">${toolRows}</div>`
    : "";

  el.innerHTML = `
    <button class="usage-toggle" type="button" aria-expanded="false">
      <span class="tool-check">${haken}</span>
      <span class="usage-title">${escapeHtml(usage.model ?? "Antwort")}</span>
      <span class="usage-meta">${ganzeZahl(usage.completionTokens)} Tokens · ${Math.floor(amountMsat / 1000)} sat</span>
      <span class="usage-chev" aria-hidden="true">›</span>
    </button>
    <div class="usage-body hidden">
      ${werkzeugTeil}
      ${zeile("Modell", usage.model ?? "—")}
      ${zeile("Provider", pkShort(providerPk))}
      ${zeile("Tokens", `${ganzeZahl(usage.promptTokens)} rein, ${ganzeZahl(usage.completionTokens)} raus`)}
      ${zeile("Diese Antwort", `${Math.floor(amountMsat / 1000)} sat`)}
      ${usage.sessionTotalMsat !== undefined
        ? `<div class="usage-row total"><span>Sitzung gesamt</span><span>${Math.floor(usage.sessionTotalMsat / 1000)} sat</span></div>`
        : ""}
      ${amountMsat > 0 ? `<div class="usage-actions">
        <button class="ghost verify-fee" type="button">Zahlung prüfen</button>
        <button class="ghost file-dispute" type="button">Reklamieren</button></div>
      <div class="fee-verdict mono-sm"></div>` : ""}
    </div>`;
  // Der Fee-Beweis war gebaut, aber unsichtbar. Er ist das einzige Merkmal,
  // das ein zentraler Anbieter prinzipiell nicht bieten kann — und lag brach.
  const toggle = el.querySelector<HTMLElement>(".usage-toggle");
  toggle?.addEventListener("click", () => {
    const offen = el.querySelector(".usage-body")?.classList.contains("hidden") === false;
    toggle.setAttribute("aria-expanded", String(offen));
  });
  el.querySelector(".verify-fee")?.addEventListener("click", () => {
    void pruefeZahlung(el, resultEventId, amountMsat);
  });
  el.querySelector(".file-dispute")?.addEventListener("click", () => {
    void reklamiere(resultEventId, providerPk, amountMsat);
  });

  el.querySelector(".usage-toggle")!.addEventListener("click", () => {
    const body = el.querySelector(".usage-body")!;
    const tog = el.querySelector(".usage-toggle")!;
    const open = body.classList.toggle("hidden");
    tog.textContent = `${open ? "▸" : "▾"} details · ${Math.floor(amountMsat / 1000)} sats`;
  });
  $("#ai-thread").appendChild(el);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
}

/**
 * Prueft den Fee-Beweis zu einer Antwort.
 *
 * Zeigt, wohin das Geld gegangen ist — und was davon BELEGT ist. Der
 * Unterschied ist wichtig: Lightning hat kein oeffentliches Ledger, ohne
 * Preimage ist eine Zahlung angekuendigt, nicht bewiesen. Ein Knopf, der
 * "alles in Ordnung" sagt, obwohl er es nicht wissen kann, waere schlimmer
 * als gar keiner.
 */
async function pruefeZahlung(
  bubble: HTMLElement,
  resultEventId: string | undefined,
  amountMsat: number,
): Promise<void> {
  const out = bubble.querySelector(".fee-verdict") as HTMLElement | null;
  if (!out) return;
  if (!resultEventId) {
    out.textContent = "Kein Bezug zur Antwort — nicht prüfbar.";
    return;
  }

  out.textContent = "suche Beleg …";
  try {
    const { verifyFeeProof, KIND_FEE_PROOF, clientFeePpm } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_FEE_PROOF], "#e": [resultEventId], limit: 5 });

    if (evs.length === 0) {
      out.innerHTML =
        `<span class="warn">Noch kein Beleg veröffentlicht.</span><br>` +
        `<span class="muted">Provider veröffentlichen ihn nach der Abrechnung. ` +
        `Fehlt er dauerhaft, hat der Provider die Fee nicht abgeführt.</span>`;
      return;
    }

    // Die Client-Gebuehr folgt nicht aus dem Protokoll — sie stand in unserem
    // eigenen Job-Event, also kennen wir sie.
    const fee = aktiveClientGebuehr();
    const v = verifyFeeProof(evs[0], {
      clientFeeMsat: fee ? Math.floor((amountMsat * fee.ppm) / 1_000_000) : 0,
    });
    void clientFeePpm;

    const zeilen = v.legs.map((l) => {
      const farbe = l.status === "settled" ? "ok" : l.status === "invalid" ? "err" : "warn";
      const marke = l.status === "settled" ? "belegt" : l.status === "invalid" ? "FEHLER" : "angekündigt";
      return `<div class="usage-row"><span>${escapeHtml(l.leg)}</span>` +
        `<span class="${farbe}">${(l.amountMsat / 1000).toFixed(2)} sats · ${marke}</span></div>`;
    }).join("");

    out.innerHTML =
      `<span class="${v.ok ? "ok" : "err"}">${escapeHtml(v.summary)}</span>${zeilen}` +
      (v.legs.some((l) => l.status === "announced")
        ? `<div class="muted" style="margin-top:4px">„Angekündigt" heißt: rechnerisch korrekt, ` +
          `aber ohne Preimage nicht beweisbar. Lightning hat kein öffentliches Ledger.</div>`
        : "");
  } catch (e) {
    out.textContent = `Prüfung fehlgeschlagen: ${(e as Error).message}`;
  }
}

/** Thinking-Orb (wie orbs.jakubantalik.com): animierte Kugel statt Text.
 *  Leichte Canvas-Version (kein npm-Dep). States: working/searching/etc. */
function showTyping(status: string = "thinking"): HTMLElement {
  const el = document.createElement("div");
  el.className = "typing";
  el.id = "ai-typing";
  // Replit-Stil: wachsende Icon-Leiste. Jeder Schritt hängt sein Symbol an,
  // das Label zeigt dynamisch was GERADE passiert (auch provider-feedback).
  el.innerHTML = `
    <div class="step-rail" id="step-rail"></div>
    <div class="step-label"><span class="spinner"></span><span id="step-label-text">${escapeHtml(t(status))}</span></div>`;
  $("#ai-thread").appendChild(el);
  addStepIcon(status);
  stickToBottom(() => el.scrollIntoView({ behavior: "smooth", block: "end" }));
  return el;
}

/** Fügt ein Schritt-Icon an die wachsende Leiste an (Replit-Stil).
 *  Klick auf ein Icon zeigt Details zum Schritt (Tooltip + Alert-Label). */
function addStepIcon(stepKey: string): void {
  const rail = document.getElementById("step-rail");
  if (!rail) return;
  const iconFor = (k: string): { svg: string; title: string } => {
    switch (k) {
      case "connecting": return { svg: icon("zap", 12), title: "Verbinde mit dem Provider-Netz" };
      case "researching": return { svg: icon("search", 12), title: "Recherchiert online (web_search / browser)" };
      case "thinking": return { svg: icon("bot", 12), title: "Modell verarbeitet die Anfrage" };
      case "creating": return { svg: icon("image", 12), title: "Erstellt Medien (Bild/Video)" };
      default: return { svg: icon("wrench", 12), title: k };
    }
  };
  const { svg, title } = iconFor(stepKey);
  const prev = rail.querySelector(".step-ic.active");
  if (prev) { prev.classList.remove("active"); prev.classList.add("done"); }
  const ic = document.createElement("span");
  ic.className = "step-ic active";
  ic.title = title;
  ic.innerHTML = svg;
  ic.addEventListener("click", () => {
    // Klick: Schritt-Erklärung kurz im Label zeigen
    setTypingLabel(title);
  });
  rail.appendChild(ic);
}

/** Tool-Name → lesbares Label für die Schritt-Leiste. */
function toolLabel(tool: string): string {
  if (/web_search/i.test(tool)) return "sucht im web…";
  if (/browser/i.test(tool)) return "liest webseiten…";
  if (/image/i.test(tool)) return "erstellt bild…";
  if (/video/i.test(tool)) return "erstellt video…";
  return `${tool}…`;
}

function advanceJobPipeline(toStatus: string): void {
  addStepIcon(toStatus);
}

/** Update den typing-status (thinking -> researching -> creating). */
function setTypingStatus(status: string): void {
  advanceJobPipeline(status);
  setTypingLabel(t(status));
}

/** Label-Text der typing-Zeile (für live provider-feedback). */
function setTypingLabel(text: string): void {
  const el = document.getElementById("step-label-text");
  if (!el) return;
  // Provider-Namen/Artefakte aus Feedback-Texten säubern: "jeletor is
  // thinking" → "denkt nach…" — der Nutzer will wissen WAS passiert,
  // nicht WER denkt.
  let t2 = text.trim();
  t2 = t2.replace(/^\S+\s+is\s+thinking\s*\.?$/i, "denkt nach…");
  t2 = t2.replace(/^[a-z0-9]{6,}\s+is\s+/i, "").replace(/\s*\.?$/, "…");
  if (t2.length > 60) t2 = t2.slice(0, 57) + "…";
  el.textContent = t2;
}

/**
 * Scrollt nur, wenn der Nutzer bereits ganz unten ist. Sobald er hochscrollt,
 * bleibt die Ansicht stehen (lesen ohne Sprung). Rückgabe: war unten?
 */
function stickToBottom(scrollFn?: () => void): boolean {
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
function hideTyping(): void {
  document.getElementById("ai-typing")?.remove();
}

// ------------------------------------------------------------- Wallet-Tab

async function loadWallet(): Promise<void> {
  // Geraetegerechter Hinweis statt eines dauerhaften "—": auf dem Handy gibt
  // es keine Extension, dort ist NWC der Weg.
  try {
    const { detectPaymentCapabilities } = await import("@freedomstack/protocol");
    const caps = detectPaymentCapabilities();
    const hintEl = $("#ln-hint");
    if (hintEl) hintEl.textContent = caps.note;
  } catch { /* Hinweis ist optional */ }

  if (!nwc && localStorage.getItem(NWC_KEY)) {
    // Gespeicherte Verbindung still wiederherstellen — der Nutzer soll die URI
    // nicht bei jedem Laden neu einfuegen muessen.
    void connectNwc(undefined, true);
  } else if (!nwc) {
    $("#ln-balance").innerHTML = `— <small>sats</small>`;
  }

  // Solana still wiederverbinden, wenn die Seite schon einmal erlaubt wurde.
  if (!solWallet.connected) void connectSolana(true);

  try {
    const pool = await ensurePool();
    const offers = await pool.query({ kinds: [KIND_LP_OFFER], limit: 20 });
    const now = Math.floor(Date.now() / 1000);
    const valid = offers
      .map((ev) => {
        try {
          return { ev, offer: parseLpOffer(ev) };
        } catch {
          return null;
        }
      })
      .filter((x): x is { ev: NostrEvent; offer: ReturnType<typeof parseLpOffer> } => x !== null)
      .filter(({ offer }) => offer.expiry > now);

    const box = $("#lp-offers");
    // SICHERHEIT: offerId/pubkey kommen aus FREMDEN Relay-Events. Frueher
    // wurden sie in ein inline onclick="startSwap('...')" interpoliert — ein
    // boesartiger LP konnte damit beliebiges JS im App-Kontext ausfuehren und
    // den Nostr-Secret-Key aus localStorage abziehen. Jetzt: escapte
    // data-Attribute + addEventListener, nie Code aus fremdem Text.
    box.innerHTML = valid.length
      ? valid
          .map(
            ({ ev, offer }) => `
        <div class="stat">
          <span class="k">${escapeHtml(pkShort(ev.pubkey))} · ${Number(offer.minSats)}–${Number(offer.maxSats)} sats · ${(Number(offer.feePpm) / 100).toFixed(1)}%</span>
          <span><button class="ghost lp-swap-btn" style="width:auto;padding:6px 10px" data-lp="${escapeHtml(ev.pubkey)}" data-offer="${escapeHtml(offer.offerId)}">swap</button></span>
        </div>`,
          )
          .join("")
      : "<div class='mono-sm'>keine LP-Angebote gefunden</div>";
    box.querySelectorAll(".lp-swap-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLElement;
        void startSwap(el.dataset.lp ?? "", el.dataset.offer ?? "");
      });
    });
  } catch (e) {
    toast(`Relay-Fehler: ${(e as Error).message}`, true);
  }
}

async function startSwap(lpPubkey: string, offerId: string): Promise<void> {
  if (!state.keypair) return;
  const amountStr = prompt("Betrag in sats:");
  const amount = Number(amountStr);
  if (!amount || amount <= 0) return;
  // Adressverlauf: Die Kette ist der Abfluss, gegen den weder Tor noch
  // Verschluesselung hilft. Deshalb VOR dem Swap pruefen, nicht danach
  // berichten.
  const verlauf = JSON.parse(localStorage.getItem("freedom.swapHistory") ?? "[]") as {
    address: string; uses: number; firstUsed: number; lastUsed: number;
  }[];
  const letzter = verlauf.length > 0 ? Math.max(...verlauf.map((v) => v.lastUsed)) : undefined;

  const { swapPrivacyCheck, deriveSwapAddress, addressFingerprint } =
    await import("@freedomstack/protocol");

  const pruefung = swapPrivacyCheck({
    usage: verlauf,
    lamports: amount * 1000,
    lastSwapAt: letzter,
  });

  if (!pruefung.ok) {
    const weiter = confirm(
      `Bevor du das machst:\n\n${pruefung.findings.join("\n\n")}\n\n` +
      `Empfohlen:\n${pruefung.actions.map((a) => `  · ${a}`).join("\n")}\n\n` +
      `Trotzdem fortfahren?`,
    );
    if (!weiter) return;
  }

  // Frische Adresse vorschlagen — abgeleitet, also ohne zusaetzliche Sicherung
  // wiederherstellbar.
  const frisch = deriveSwapAddress(state.keypair.sk, verlauf.length);
  const solAddr = prompt(
    `Deine Solana-Empfangsadresse:\n\n` +
    `Vorschlag: eine frische Adresse Nummer ${verlauf.length} ` +
    `(${addressFingerprint(frisch)}…). Deine Merkphrase bringt sie zurueck.`,
  );
  if (!solAddr) return;

  // Benutzung mitschreiben, damit die naechste Pruefung etwas weiss.
  const vorhanden = verlauf.find((v) => v.address === solAddr);
  const jetzt = Math.floor(Date.now() / 1000);
  if (vorhanden) {
    vorhanden.uses++;
    vorhanden.lastUsed = jetzt;
  } else {
    verlauf.push({ address: solAddr, uses: 1, firstUsed: jetzt, lastUsed: jetzt });
  }
  localStorage.setItem("freedom.swapHistory", JSON.stringify(verlauf));

  try {
    const pool = await ensurePool();
    const preimage = generatePreimage();
    const H = hashlock(preimage);
    // Frueher sessionStorage: beim Schliessen des Tabs weg — und mit dem
    // Preimage der Zugriff auf das Geld. Jetzt dauerhaft, mit Exportmoeglichkeit.
    const { saveSwapSecret } = await import("../swap-client.js");
    saveSwapSecret({
      hashlockHex: toHex(H),
      preimageHex: toHex(preimage),
      solAddress: solAddr,
      amountSats: amount,
      createdAt: Math.floor(Date.now() / 1000),
    });

    const ev = signEvent(
      buildEvent(
        state.keypair.pk,
        KIND_SWAP_REQUEST,
        [
          ["p", lpPubkey],
          ["offer", offerId],
          ["amount_sats", String(amount)],
          ["hashlock", toHex(H)],
          ["solana_address", solAddr],
        ],
        "",
      ),
      state.keypair.sk,
    );
    await pool.publish(ev);
    toast("Swap-Request gesendet — warte auf Invoice…");
    void pollSwapResponse(ev.id, toHex(H), solAddr, amount);
  } catch (e) {
    toast(`Fehler: ${(e as Error).message}`, true);
  }
}
// Frueher global exportiert, weil ein inline onclick es brauchte. Der ist weg
// (XSS-Fix in loadWallet), also bleibt startSwap jetzt im Modul-Scope.

async function pollSwapResponse(
  requestId: string,
  hashlockHex: string,
  solAddress: string,
  amountSats: number,
): Promise<void> {
  const pool = await ensurePool();
  const statusEl = $("#swap-status");
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const resps = await pool.query({ kinds: [KIND_SWAP_RESPONSE], "#e": [requestId] });
    if (resps.length > 0) {
      const resp = resps[0];
      const bolt11 = resp.content;
      const swapId = resp.tags.find((t) => t[0] === "swap_id")?.[1];
      const lamports = Number(resp.tags.find((t) => t[0] === "amount_lamports")?.[1] ?? "0");
      const lnExpiry = Number(resp.tags.find((t) => t[0] === "ln_expiry")?.[1] ?? "0");

      $("#swap-invoice").classList.remove("hidden");
      $("#swap-bolt11").textContent = bolt11;

      // ---------------------------------------------------------------
      // HIER stand frueher nur "Invoice erhalten — bitte zahlen". Genau das
      // ist der Moment, in dem ein Kunde ohne Pruefung Geld verliert: er
      // zahlt fuer SOL, die niemand gesperrt hat. Der Zahl-Link bleibt daher
      // gesperrt, bis die Gegenleistung auf der Kette bestaetigt ist.
      // ---------------------------------------------------------------
      const payLink = $("#swap-pay-link") as HTMLAnchorElement;
      payLink.removeAttribute("href");
      payLink.classList.add("disabled");
      statusEl.textContent = "Rechnung erhalten. Pruefe die Sperre auf der Kette — noch nicht zahlen.";
      statusEl.className = "mono-sm warn";

      if (!swapId) {
        statusEl.textContent =
          "Der LP hat keine swap_id mitgeschickt — die Gegenleistung ist nicht pruefbar. Nicht zahlen.";
        statusEl.className = "mono-sm err";
        return;
      }

      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const { AnchorSolanaHtlc, fromHex: fh } = await import("@freedomstack/protocol");
        const { verifyCounterpartyLock } = await import("../swap-client.js");
        const rpcUrl = await solRpcUrl();
        void PublicKey;

        const reader = AnchorSolanaHtlc.reader(new Connection(rpcUrl, "confirmed"));
        const chainLock = await reader.get(swapId);

        const verdict = verifyCounterpartyLock({
          lock: chainLock
            ? {
                amountLamports: chainLock.amountLamports,
                timelockUnix: chainLock.timelockUnix,
                recipient: chainLock.recipient,
                hashlock: chainLock.hashlock,
                claimed: chainLock.claimed,
                refunded: chainLock.refunded,
              }
            : undefined,
          expectedHashlock: fh(hashlockHex),
          expectedRecipient: solAddress,
          expectedLamports: lamports,
          lightningExpiryUnix: lnExpiry || Math.floor(Date.now() / 1000) + 7200,
        });

        if (!verdict.ok) {
          statusEl.innerHTML =
            `<strong>Nicht zahlen.</strong><br>`
            + verdict.problems.map((p) => escapeHtml(p)).join("<br>");
          statusEl.className = "mono-sm err";
          return;
        }

        // Erst jetzt freigeben.
        payLink.href = `lightning:${bolt11}`;
        payLink.classList.remove("disabled");
        // Den Initiator merken: das Programm gibt ihm beim Einloesen die
        // Mietbefreiung zurueck, deshalb muss er in der Claim-Instruktion stehen.
        activeSwap = { swapId, hashlockHex, solAddress, amountSats, initiator: chainLock!.initiator, timelockUnix: chainLock!.timelockUnix };
        $("#swap-claim").classList.remove("hidden");
        statusEl.innerHTML =
          `<strong>Geprueft.</strong> ${escapeHtml(verdict.summary)}<br>`
          + `Nach dem Bezahlen unten einloesen — sonst laeuft der Tausch zurueck.`;
        statusEl.className = "mono-sm ok";
        toast("Gegenleistung geprueft — Rechnung kann bezahlt werden");
      } catch (e) {
        statusEl.textContent =
          `Pruefung nicht moeglich (${(e as Error).message}). Im Zweifel nicht zahlen.`;
        statusEl.className = "mono-sm err";
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  toast("keine LP-Antwort in 90s", true);
}

/** Laufender Swap, fuer den das Einloesen noch aussteht. */
let activeSwap: {
  swapId: string; hashlockHex: string; solAddress: string; amountSats: number;
  /** Wer den Swap angelegt hat (der LP) — bekommt die Mietbefreiung zurueck. */
  initiator: string;
  /** Frist des SOL-HTLC – Einloesen nur mit Sicherheitsabstand davor. */
  timelockUnix: number;
} | null = null;

/** Loest den SOL-HTLC ein und legt dabei das Preimage offen. */
async function claimActiveSwap(): Promise<void> {
  const statusEl = $("#swap-status");
  if (!activeSwap) return;
  const provider = solWallet.provider;
  if (!provider?.signTransaction) {
    statusEl.textContent = "Solana-Wallet verbinden, um einzuloesen.";
    statusEl.className = "mono-sm warn";
    return;
  }
  try {
    const { loadSwapSecret, claimSwap, preimageFits, forgetSwapSecret } =
      await import("../swap-client.js");
    const secret = loadSwapSecret(activeSwap.hashlockHex);
    if (!secret || !preimageFits(secret.preimageHex, activeSwap.hashlockHex)) {
      statusEl.textContent =
        "Preimage nicht gefunden oder unpassend — ohne es ist kein Einloesen moeglich.";
      statusEl.className = "mono-sm err";
      return;
    }

    const { Connection } = await import("@solana/web3.js");
    const { fromHex: fh } = await import("@freedomstack/protocol");
    const rpcUrl = await solRpcUrl();

    const r = await claimSwap({
      connection: new Connection(rpcUrl, "confirmed"),
      wallet: provider as never,
      swapId: activeSwap.swapId,
      preimage: fh(secret.preimageHex),
      initiator: activeSwap.initiator,
      timelockUnix: activeSwap.timelockUnix,
      onProgress: (step) => { statusEl.textContent = step; },
    });

    statusEl.innerHTML =
      `<strong>Eingeloest.</strong> Die SOL sind auf deiner Adresse.<br>`
      + `<span class="mono-sm">tx ${escapeHtml(r.signature.slice(0, 16))}…</span>`;
    statusEl.className = "mono-sm ok";
    forgetSwapSecret(activeSwap.hashlockHex);
    activeSwap = null;
    $("#swap-claim").classList.add("hidden");
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

/** Sicherung aller offenen Preimages herunterladen. */
async function exportSwapBackup(): Promise<void> {
  const { exportSwapSecrets } = await import("../swap-client.js");
  const blob = new Blob([exportSwapSecrets()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freedom-swap-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Sicherung heruntergeladen — sicher aufbewahren");
}

// ------------------------------------------------------------- Verdienen-Tab

async function loadEarnings(): Promise<void> {
  if (!state.keypair) return;
  const box = $("#earn-events");
  box.innerHTML = "<div class='mono-sm'>lade…</div>";
  try {
    const pool = await ensurePool();
    const events = await pool.query({
      kinds: [KIND_PERFORMANCE],
      authors: [state.keypair.pk],
      limit: 20,
    });
    const sorted = events.sort((a, b) => b.created_at - a.created_at);
    box.innerHTML = sorted.length
      ? sorted
          .map((ev) => {
            const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "—";
            return `<div class="stat"><span class="k">${escapeHtml(get("work_type"))} · ${escapeHtml(get("units"))} units</span>
              <span>${Math.floor(Number(get("volume_msat")) / 1000)} sats · ${timeAgo(ev.created_at)}</span></div>`;
          })
          .join("")
      : "<div class='mono-sm'>Noch keine Einnahmen. Sie erscheinen, sobald dein Provider-Knoten Jobs erledigt.</div>";
  } catch (e) {
    box.innerHTML = `<div class='mono-sm err'>${escapeHtml((e as Error).message)}</div>`;
  }
}

/** Provider-Leaderboard: alle Performance-Events im Netz, gruppiert nach Provider. */
async function loadLeaderboard(): Promise<void> {
  const box = $("#provider-leaderboard");
  if (!box) return;
  // Skeleton-Zeilen während des Ladens
  box.innerHTML = `<div class="lb-skeleton"></div>`.repeat(4);
  // Timeout: Relay hängt → Error-State mit Retry statt endlos „lade…"
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), 12_000));
  try {
    const pool = await ensurePool();
    const work = (async () => {
      const events = await pool.query({ kinds: [KIND_PERFORMANCE], limit: 500 });
      // Gruppieren: provider -> { jobs, sats }
      const stats = new Map<string, { jobs: number; msat: number }>();
      for (const ev of events) {
        const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "0";
        const cur = stats.get(ev.pubkey) ?? { jobs: 0, msat: 0 };
        cur.jobs += 1;
        cur.msat += Number(get("volume_msat"));
        stats.set(ev.pubkey, cur);
      }
      return [...stats.entries()].sort((a, b) => b[1].jobs - a[1].jobs).slice(0, 20);
    })();
    const ranked = await Promise.race([work, timeout]);
    if (!ranked) {
      box.innerHTML = `<div class="mono-sm err">relay-timeout — leaderboard nicht erreichbar</div>
        <button class="ghost lb-retry" style="width:auto;margin-top:6px">↻ erneut versuchen</button>`;
      box.querySelector(".lb-retry")?.addEventListener("click", () => loadLeaderboard());
      return;
    }
    // dienste-uebersicht: modelle + tools der provider aus deren caps
    const capsByPk = new Map<string, { models: string[]; tools: string[] }>();
    try {
      const providers = await discoverProviders(pool);
      for (const p of providers) {
        capsByPk.set(p.caps.pubkey, { models: p.caps.models ?? [], tools: (p.caps.tools ?? []).map((t: { name?: string } | string) => typeof t === "string" ? t : t.name ?? "") });
      }
    } catch { /* caps optional */ }
    if (ranked.length === 0) {
      box.innerHTML = `<div class="lb-empty">
          <div class="lb-empty-icon">${icon("monitor", 28)}</div>
          <div class="lb-empty-title">noch keine provider aktiv</div>
          <div class="mono-sm">starte einen freedomstack-node — er erscheint hier automatisch</div>
        </div>`;
      return;
    }
    // Tabelle: Rang | Provider | Jobs | Verdient | Tier
    const rows = ranked.map(([pk, s], i) => {
      const xp = s.jobs * 2;
      const tier = xp >= 50 ? "pro" : xp >= 10 ? "classic" : "free";
      return `<tr>
        <td class="lb-rank">${i + 1}</td>
        <td class="lb-pk">${escapeHtml(pkShort(pk))}</td>
        <td>${s.jobs}</td>
        <td>${Math.floor(s.msat / 1000)}</td>
        <td><span class="tier-badge tier-${tier}">${tier}</span></td>
      </tr>`;
    }).join("");
    box.innerHTML = `<table class="lb-table">
        <thead><tr><th>#</th><th>provider</th><th>jobs</th><th>sats</th><th>tier</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    box.innerHTML = `<div class='mono-sm err'>${escapeHtml((e as Error).message)}</div>
      <button class="ghost lb-retry" style="width:auto;margin-top:6px">↻ erneut versuchen</button>`;
    box.querySelector(".lb-retry")?.addEventListener("click", () => loadLeaderboard());
  }
}

/** Reward-Claim: eigene Season-Summen aus Performance-Events, Claim (38013) publizieren. */
async function submitRewardClaim(): Promise<void> {
  if (!state.keypair) return;
  const chainSel = $("#claim-chain") as HTMLSelectElement;
  const addrInput = $("#claim-address") as HTMLInputElement;
  const btn = $("#claim-submit") as HTMLButtonElement;
  try {
    btn.disabled = true;
    const pool = await ensurePool();
    const events = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const seasonId = "season-" + new Date().getFullYear();
    // nur events der aktuellen season zaehlen (heuristic: letzte 90 tage)
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const mine = events.filter((ev) => ev.created_at >= cutoff);
    const volumeMsat = mine.reduce((sum, ev) => {
      const v = ev.tags.find((t) => t[0] === "volume_msat")?.[1] ?? "0";
      return sum + Number(v);
    }, 0);
    if (mine.length === 0) {
      toast("keine performance-events — erst jobs arbeiten", true);
      return;
    }
    const payoutAddress = addrInput.value.trim() || undefined;
    const { buildRewardClaim } = await import("@freedomstack/protocol");
    const claim = buildRewardClaim(
      {
        seasonId,
        jobCount: mine.length,
        volumeMsat,
        chain: chainSel.value as "lightning" | "solana",
        payoutAddress: payoutAddress ?? "",
      },
      state.keypair.pk,
    );
    await pool.publish(signEvent(claim, state.keypair.sk));
    toast(`claim eingereicht: ${mine.length} jobs · ${Math.floor(volumeMsat / 1000)} sats`);
  } catch (e) {
    toast(`claim-fehler: ${(e as Error).message}`, true);
  } finally {
    btn.disabled = false;
  }
}

/** Claim-Zusammenfassung im Earn-Tab aktualisieren. */
async function refreshClaimSummary(): Promise<void> {
  const el = $("#claim-summary");
  if (!el || !state.keypair) return;
  try {
    const pool = await ensurePool();
    const events = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const mine = events.filter((ev) => ev.created_at >= cutoff);
    const volumeMsat = mine.reduce((s, ev) => s + Number(ev.tags.find((t) => t[0] === "volume_msat")?.[1] ?? "0"), 0);
    el.textContent = `Letzte 90 Tage: ${mine.length} Jobs, ${Math.floor(volumeMsat / 1000)} Sats`;
  } catch {
    el.textContent = "—";
  }
}

/** Freedom Git: repo-referenzen (38042) laden + klon-buttons. */
async function loadGitRepos(): Promise<void> {
  const list = $("#git-repo-list");
  if (!list) return;
  try {
    const pool = await ensurePool();
    const { KIND_GIT_REPO_REF } = await import("@freedomstack/protocol");
    const events = await pool.query({ kinds: [KIND_GIT_REPO_REF], limit: 50 });
    // pro (owner,name) nur die neueste version
    const latest = new Map<string, NostrEvent>();
    for (const ev of events) {
      const name = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
      const key = `${ev.pubkey}/${name}`;
      const cur = latest.get(key);
      if (!cur || ev.created_at > cur.created_at) latest.set(key, ev);
    }
    const sorted = [...latest.values()].sort((a, b) => b.created_at - a.created_at);
    list.innerHTML = sorted.length
      ? sorted.map((ev) => {
          const name = ev.tags.find((t) => t[0] === "d")?.[1] ?? "?";
          return `<div class="stat"><span class="k">📦 ${escapeHtml(name)} <span class="mono-sm">${escapeHtml(pkShort(ev.pubkey))}</span></span>
            <span><button class="ghost copy-btn git-clone-btn" data-blob="${escapeHtml(ev.tags.find((t) => t[0] === "blob")?.[1] ?? "")}" data-name="${escapeHtml(name)}" style="width:auto;padding:4px 8px">⇩ bundle</button></span></div>`;
        }).join("")
      : "<span>noch keine repos — publiziere das erste bundle!</span>";
    list.querySelectorAll(".git-clone-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const el = btn as HTMLButtonElement;
        el.disabled = true;
        try {
          const { downloadBlob } = await import("../blob-client.js");
          const pool = await ensurePool();
          const res = await downloadBlob(el.dataset.blob!, pool as never);
          if (!res) { toast("bundle nicht rekonstruierbar", true); return; }
          const url = URL.createObjectURL(new Blob([res.bytes as unknown as BlobPart], { type: "application/octet-stream" }));
          const a = document.createElement("a");
          a.href = url; a.download = `${el.dataset.name}.bundle`;
          a.click();
          URL.revokeObjectURL(url);
          toast(`bundle geladen — git clone ${el.dataset.name}.bundle`);
        } catch (e) {
          toast(`fehler: ${(e as Error).message}`, true);
        }
        el.disabled = false;
      });
    });
  } catch {
    list.innerHTML = "<span>relay offline</span>";
  }
}

function setGitStatus(text: string): void {
  const el = $("#git-repo-list");
  if (el) el.textContent = text;
}

// ------------------------------------------------------------- Solana-Tab

/** Solana-Wallet-State (MWA / Phantom / Solflare Detection). */
interface SolanaWalletState {
  connected: boolean;
  pubkey: string | null;
  /** Sign-Funktion des Wallets (MWA oder Browser-Extension). */
  signTransaction?: (tx: unknown) => Promise<unknown>;
  /** Der Provider selbst — noetig, um Transaktionen signieren zu lassen. */
  provider?: { publicKey: { toBase58(): string }; signTransaction?: (tx: unknown) => Promise<unknown> };
}
const solWallet: SolanaWalletState = { connected: false, pubkey: null };

async function connectSolana(silent = false): Promise<void> {
  const statusEl = $("#sol-status");
  const { connectSolanaWallet, fetchSolBalance, detectSolanaEnvironment } =
    await import("../solana-connect.js");
  try {
    // Frueher wurde hier nur window.solana geprueft. Auf jedem Handy ohne
    // Wallet-In-App-Browser war damit Schluss ("kein Wallet gefunden") — auch
    // auf dem Seeker. Jetzt: injizierter Provider, sonst Deeplink in die App.
    const conn = await connectSolanaWallet({
      silent,
      onNeedsDeeplink: (links, hint) => {
        statusEl.className = "mono-sm";
        statusEl.innerHTML =
          `${escapeHtml(hint)}<div style="display:flex;gap:6px;margin-top:6px">` +
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.phantom)}">Phantom öffnen</a>` +
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.solflare)}">Solflare öffnen</a></div>`;
      },
    });

    if (!conn) {
      if (!silent && !statusEl.textContent) {
        statusEl.textContent = detectSolanaEnvironment().hint;
        statusEl.className = "mono-sm warn";
      }
      return;
    }

    solWallet.connected = true;
    solWallet.pubkey = conn.pubkey;
    solWallet.signTransaction = conn.provider?.signTransaction?.bind(conn.provider);
    solWallet.provider = conn.provider as SolanaWalletState["provider"];

    statusEl.textContent = "verbunden";
    statusEl.className = "mono-sm ok";
    const addrEl = $("#sol-addr");
    addrEl.textContent = conn.pubkey;
    (addrEl as HTMLInputElement).value = conn.pubkey;
    addrEl.classList.remove("hidden");
    const btn = $("#sol-connect") as HTMLButtonElement;
    btn.textContent = "Verbunden";
    btn.disabled = true;

    try {
      const rpcUrl = await solRpcUrl();
      const bal = await fetchSolBalance(conn.pubkey, rpcUrl);
      localStorage.setItem("freedom.sol.balance", bal.sol.toFixed(4));
      localStorage.setItem("freedom.sol.pubkey", conn.pubkey);
    } catch { /* RPC nicht erreichbar — Sidebar bleibt bei "—" */ }
    updateSidebarBalances();
  } catch (e) {
    if (silent) return;
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

// ------------------------------------------------------- Lightning via NWC

/** Aktive NWC-Verbindung (Lightning auf jedem Geraet). */
let nwc: import("@freedomstack/protocol").NwcClient | null = null;
const NWC_KEY = "freedom.nwc.uri";

async function connectNwc(uri?: string, silent = false): Promise<void> {
  const statusEl = $("#nwc-status");
  const input = $("#nwc-uri") as HTMLInputElement | null;
  const raw = (uri ?? input?.value ?? "").trim() || localStorage.getItem(NWC_KEY) || "";
  if (!raw) {
    if (!silent) {
      statusEl.textContent = "Verbindungs-URI aus der Wallet einfuegen (Alby Hub, Coinos, Mutiny …).";
      statusEl.className = "mono-sm warn";
    }
    return;
  }

  try {
    const { parseNwcUri, NwcClient, redactNwcUri, WebSocketRelay, OutboxPool } =
      await import("@freedomstack/protocol");
    const conn = parseNwcUri(raw);

    // Eigener Pool auf den Relays DER WALLET — die muessen nicht dieselben
    // sein wie die des Protokolls, sonst findet das Wallet uns nicht.
    const walletPool = new OutboxPool(
      conn.relays.map((u) => new WebSocketRelay(u)),
      { minAcks: 1 },
    );
    const client = new NwcClient(conn, walletPool, 30_000);

    statusEl.textContent = "verbinde …";
    statusEl.className = "mono-sm";
    const info = await client.init();
    const balance = await client.getBalance();

    nwc = client;
    // Das Secret liegt lokal wie der Nostr-Key auch. Es ist eine im Wallet
    // widerrufbare, budgetierbare Vollmacht — kein Kontozugang.
    localStorage.setItem(NWC_KEY, raw);
    if (input) input.value = redactNwcUri(raw);

    $("#ln-balance").innerHTML = `${Math.floor(balance / 1000).toLocaleString()} <small>sats</small>`;
    statusEl.textContent = `verbunden (${info.encryption}, ${info.methods.length || "?"} Methoden)`;
    statusEl.className = "mono-sm ok";
    $("#nwc-disconnect").classList.remove("hidden");
    updateSidebarBalances();
  } catch (e) {
    if (silent) return;
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

function disconnectNwc(): void {
  nwc = null;
  localStorage.removeItem(NWC_KEY);
  const input = $("#nwc-uri") as HTMLInputElement | null;
  if (input) input.value = "";
  $("#ln-balance").innerHTML = `— <small>sats</small>`;
  $("#nwc-status").textContent = "getrennt";
  $("#nwc-status").className = "mono-sm";
  $("#nwc-disconnect").classList.add("hidden");
  updateSidebarBalances();
}

/** Zahlt eine Rechnung ueber den Weg, der auf diesem Geraet verfuegbar ist. */
async function payInvoiceAnyDevice(bolt11: string): Promise<{ preimage: string }> {
  if (nwc) return nwc.payInvoice(bolt11);
  const w = (window as unknown as { webln?: { enable(): Promise<void>; sendPayment(i: string): Promise<{ preimage: string }> } }).webln;
  if (w) {
    await w.enable();
    return w.sendPayment(bolt11);
  }
  throw new Error(
    "Keine Lightning-Wallet verbunden. Im Wallet-Tab per NWC verbinden — das " +
      "funktioniert auf Handy und Desktop gleichermassen.",
  );
}

/** Aktive Deposit-Session (RAM). */
let activeDeposit: { sessionId: string; spendSwapId: string; refundSwapId: string } | null = null;

async function startDeposit(): Promise<void> {
  if (!state.keypair) return;
  const statusEl = $("#dep-status");
  if (!solWallet.connected || !solWallet.pubkey) {
    statusEl.textContent = "erst Solana-Wallet verbinden";
    statusEl.className = "mono-sm warn";
    return;
  }
  const amountSol = Number(($("#dep-amount") as HTMLInputElement).value);
  if (!amountSol || amountSol <= 0) {
    statusEl.textContent = "ungueltiger Betrag";
    statusEl.className = "mono-sm err";
    return;
  }
  const providerPk =
    ($("#dep-provider") as HTMLInputElement).value.trim() || state.lastProvider;
  if (!providerPk) {
    statusEl.textContent = "kein Provider — erst eine KI-Anfrage stellen oder pubkey angeben";
    statusEl.className = "mono-sm warn";
    return;
  }

  const totalLamports = Math.floor(amountSol * 1e9);
  // Zwei-HTLC-Muster: 40% Verbrauch (Provider), 60% Rest (User, refundbar)
  const spendLamports = Math.floor(totalLamports * 0.4);
  const refundLamports = totalLamports - spendLamports;
  const sessionId = `sol-dep-${state.keypair.pk.slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;
  const spendSwapId = `${sessionId}-spend`;
  const refundSwapId = `${sessionId}-refund`;

  try {
    // REIHENFOLGE IST WICHTIG: erst sperren, dann ankuendigen.
    //
    // Vorher wurde nur das Event veroeffentlicht und eine Zahl in localStorage
    // hochgezaehlt — es fand nie eine Transaktion statt. Provider pruefen
    // inzwischen on-chain und lehnen ein ungedecktes Deposit ab. Wuerde das
    // Event zuerst kommen, stuende eine Ankuendigung auf den Relays, der nichts
    // entspricht; scheitert die Signatur, gaebe es keinen Weg, sie
    // zurueckzunehmen.
    const provider = solWallet.provider;
    if (!provider?.signTransaction) {
      statusEl.textContent = "Diese Wallet kann keine Transaktionen signieren.";
      statusEl.className = "mono-sm err";
      return;
    }

    const providerSol = ($("#dep-provider-sol") as HTMLInputElement | null)?.value.trim()
      || state.lastProviderSolAddress;
    if (!providerSol) {
      statusEl.textContent =
        "SOL-Adresse des Providers unbekannt — erst eine KI-Anfrage stellen, "
        + "damit der Provider sie mitteilt.";
      statusEl.className = "mono-sm warn";
      return;
    }

    const { Connection } = await import("@solana/web3.js");
    const rpcUrl = await solRpcUrl();
    const conn = new Connection(rpcUrl, "confirmed");

    const { lockDeposit } = await import("../sol-htlc.js");
    statusEl.className = "mono-sm";
    const lock = await lockDeposit({
      connection: conn,
      wallet: provider as never,
      providerSolAddress: providerSol,
      spendSwapId,
      refundSwapId,
      spendLamports,
      refundLamports,
      timelockUnix: Math.floor(Date.now() / 1000) + 7200,
      onProgress: (step) => { statusEl.textContent = step; },
    });

    // Das Preimage ist der einzige Weg, vor Ablauf des Timelocks an das Geld zu
    // kommen. Frueher lag es in sessionStorage und war beim Schliessen des Tabs
    // weg. localStorage ueberlebt wenigstens einen Neustart — dauerhaft sicher
    // ist nur eine Sicherung durch den Nutzer, deshalb wird sie eingefordert.
    localStorage.setItem(`freedom.htlc.${sessionId}`, JSON.stringify({
      preimageHex: lock.preimageHex,
      hashlockHex: lock.hashlockHex,
      spendSwapId, refundSwapId, timelockUnix: Math.floor(Date.now() / 1000) + 7200,
    }));

    // Erst JETZT ankuendigen — das Geld liegt bereits auf der Kette.
    const pool = await ensurePool();
    const { buildSolDepositOpen, signEvent: se } = await import("@freedomstack/protocol");
    const ev = se(
      buildSolDepositOpen({
        customerPubkey: state.keypair.pk,
        providerPubkey: providerPk,
        sessionId,
        totalLamports,
        spendSwapId,
        refundSwapId,
        spendLamports,
        refundLamports,
        timelockUnix: Math.floor(Date.now() / 1000) + 7200,
        maxLamportsPerKToken: 1000,
      }),
      state.keypair.sk,
    );
    await pool.publish(ev);

    activeDeposit = { sessionId, spendSwapId, refundSwapId };
    statusEl.innerHTML =
      `<strong>Deposit gedeckt.</strong> ${escapeHtml(String(amountSol))} SOL auf der Kette gesperrt.<br>`
      + `<span class="mono-sm">tx ${escapeHtml(lock.signature.slice(0, 16))}…</span><br>`
      + `Rueckholbar ab ${new Date((Math.floor(Date.now() / 1000) + 7200) * 1000).toLocaleTimeString("de-DE")}.`;
    statusEl.className = "mono-sm ok";
    ($("#dep-refund") as HTMLButtonElement).classList.remove("hidden");
    toast("Deposit gesperrt und angekuendigt");
    updateBudgetBar();
    updateSidebarBalances()
  } catch (e) {
    statusEl.textContent = `Fehler: ${(e as Error).message}`;
    statusEl.className = "mono-sm err";
  }
}

async function refundDeposit(): Promise<void> {
  const statusEl = $("#dep-status");
  if (!activeDeposit) {
    statusEl.textContent = "keine aktive Deposit-Session";
    return;
  }
  const provider = solWallet.provider;
  if (!provider?.signTransaction) {
    statusEl.textContent = "Wallet verbinden, um zurueckzuholen.";
    statusEl.className = "mono-sm warn";
    return;
  }

  // Erwartungshaltung geradeziehen, BEVOR die Wallet aufgeht: Was der Provider
  // bereits eingeloest hat, ist bezahlter Verbrauch und kommt nicht zurueck.
  const stored = localStorage.getItem(`freedom.htlc.${activeDeposit.sessionId}`);
  const meta = stored ? (JSON.parse(stored) as { timelockUnix: number }) : null;
  const now = Math.floor(Date.now() / 1000);
  if (meta && now < meta.timelockUnix) {
    const restMin = Math.ceil((meta.timelockUnix - now) / 60);
    statusEl.innerHTML =
      `Der Timelock laeuft noch ${restMin} Minuten. Vorher kann die Kette nichts `
      + `freigeben — das ist die Absicherung, die den Provider ohne Vertrauen `
      + `arbeiten laesst. Danach hier erneut klicken.`;
    statusEl.className = "mono-sm warn";
    return;
  }

  try {
    const { Connection } = await import("@solana/web3.js");
    const rpcUrl = await solRpcUrl();
    const { refundDepositOnChain } = await import("../sol-htlc.js");

    statusEl.className = "mono-sm";
    const res = await refundDepositOnChain({
      connection: new Connection(rpcUrl, "confirmed"),
      wallet: provider as never,
      swapIds: [activeDeposit.refundSwapId, activeDeposit.spendSwapId],
      onProgress: (step) => { statusEl.textContent = step; },
    });

    if (res.refunded.length > 0) {
      statusEl.innerHTML =
        `<strong>Zurueckgeholt.</strong> ${res.refunded.length} HTLC(s) freigegeben.<br>`
        + `<span class="mono-sm">tx ${escapeHtml((res.signature ?? "").slice(0, 16))}…</span>`;
      statusEl.className = "mono-sm ok";
      localStorage.removeItem(`freedom.htlc.${activeDeposit.sessionId}`);
      activeDeposit = null;
      ($("#dep-refund") as HTMLButtonElement).classList.add("hidden");
    } else {
      statusEl.textContent = res.failed[0]?.reason ?? "Rueckholung nicht moeglich.";
      statusEl.className = "mono-sm err";
    }
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

function setupToolChips(): void {
  document.querySelectorAll(".tool-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const el = chip as HTMLElement;
      const kind = Number(el.dataset.tool);
      const name = el.dataset.name!;
      el.classList.toggle("active");
      if (el.classList.contains("active")) {
        selectedTools.push({ kind, name, input: "" });
      } else {
        selectedTools = selectedTools.filter((t) => t.kind !== kind);
      }
      // video-optionen zeigen wenn video-chip aktiv
      const videoActive = selectedTools.some((t) => t.name === "video_gen");
      const opts = document.getElementById("video-opts");
      if (opts) opts.classList.toggle("hidden", !videoActive);
    });
  });
}

/** Empty-State: Beispiel-Prompts klickbar; Empty ausblenden sobald Verlauf da. */
function setupEmptyState(): void {
  document.querySelectorAll(".ai-example").forEach((b) => {
    b.addEventListener("click", () => {
      const prompt = (b as HTMLElement).dataset.prompt ?? "";
      ($("#ai-prompt") as HTMLTextAreaElement).value = prompt;
      ($("#ai-prompt") as HTMLTextAreaElement).focus();
    });
  });
}
function hideEmptyState(): void {
  const e = document.getElementById("ai-empty");
  if (e) e.style.display = "none";
}


/** Angehaengte Datei (multimodal). */
let attachment: { type: string; name: string; dataUrl: string } | null = null;
/** Angeforderte Tools fuer den naechsten Job. */
let selectedTools: Array<{ kind: number; name: string; input: string }> = [];

function setupAttach(): void {
  const btn = $("#attach-btn");
  const menu = $("#attach-menu");
  const input = $("#attach-input") as HTMLInputElement;
  const status = $("#attach-status");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menu.classList.add("hidden"));

  menu.querySelectorAll("button[data-attach]").forEach((b) => {
    b.addEventListener("click", () => {
      const type = (b as HTMLElement).dataset.attach!;
      menu.classList.add("hidden");
      const accept =
        type === "image" ? "image/*" :
        type === "audio" ? "audio/*" :
        type === "video" ? "video/*" :
        type === "camera" ? "image/*" : "*/*";
      input.accept = accept;
      if (type === "camera") input.setAttribute("capture", "environment");
      else input.removeAttribute("capture");
      input.dataset.atype = type;
      input.click();
    });
  });

  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      attachment = { type: input.dataset.atype ?? "file", name: f.name, dataUrl: String(reader.result) };
      status.textContent = `${f.name} angehängt`;
      status.className = "mono-sm ok";
      if (attachment.type === "image" || attachment.type === "camera") {
        status.innerHTML = `${escapeHtml(f.name)} <img class="attach-thumb" src="${escapeHtml(attachment.dataUrl)}" />`;
      }
    };
    reader.readAsDataURL(f);
    input.value = "";
  });
}

/** Minimales, sicheres Markdown fuer AI-Antworten (nach escapeHtml):
 *  **bold**, *italic*, `code`, ```codeblock```, Listen, Absaetze. */
function renderMarkdown(escaped: string): string {
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

// ------------------------------------------------------------- Init (v0.2)

/** Wendet die aktuelle Sprache auf alle [data-i18n]/[data-i18n-ph] an. */
function applyI18n(): void {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    // Nur reine Text-Nodes setzen — Elemente mit Kind-Elementen (z.B.
    // nav-buttons mit icon-span) bekommen ihr label aus einem dedicated span.
    if (el.children.length === 0) {
      el.textContent = t(el.getAttribute("data-i18n")!);
    } else {
      // erstes text-only child mit data-i18n-label oder letzter span
      const labelSpan = el.querySelector("[data-i18n]");
      const target = labelSpan === el ? null : labelSpan;
      if (target && target.children.length === 0) target.textContent = t(target.getAttribute("data-i18n")!);
    }
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    (el as HTMLInputElement).placeholder = t(el.getAttribute("data-i18n-ph")!);
  });
}

function setupLangMenu(): void {
  // Zwei Umschalter: Landing (#lang-btn) + App-Sidebar (#lang-btn-app).
  // Beide teilen dasselbe menü-verhalten; nur DE/EN angeboten (rest = EN-fallback).
  const pairs: Array<{ btnId: string; menuId: string }> = [
    { btnId: "#lang-btn", menuId: "#lang-menu" },
    { btnId: "#lang-btn-app", menuId: "#lang-menu-app" },
  ];
  const renderMenu = (menu: HTMLElement): void => {
    menu.innerHTML = LANGS.map(
      (l) => `<button type="button" data-lang="${l.code}" class="${l.code === getLang() ? "active" : ""}">${l.code.toUpperCase()} · ${l.label}</button>`,
    ).join("");
    menu.querySelectorAll("button[data-lang]").forEach((b) => {
      b.addEventListener("click", () => {
        const code = (b as HTMLElement).dataset.lang as Lang;
        setLang(code);
        localStorage.setItem("freedom.lang", code);
        document.documentElement.lang = code;
        applyI18n();
        pairs.forEach(({ btnId, menuId }) => {
          const m2 = $(menuId);
          if (m2) renderMenu(m2);
          const b2 = $(btnId) as HTMLButtonElement | null;
          if (b2) b2.textContent = `${code.toUpperCase()} ▾`;
        });
      });
    });
  };
  pairs.forEach(({ btnId, menuId }) => {
    const btn = $(btnId);
    const menu = $(menuId);
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderMenu(menu);
      menu.classList.toggle("hidden");
    });
  });
  document.addEventListener("click", () => {
    pairs.forEach(({ menuId }) => $(menuId)?.classList.add("hidden"));
  });
}

/** Landing -> Gate -> App. */
function setupFlow(): () => void {
  // Hero-Hintergrund (circuit-partikel) — läuft in der App als Ambient-Effekt
  const heroCanvas = document.getElementById("hero-gl") as HTMLCanvasElement | null;
  if (heroCanvas) startHero(heroCanvas);
  // Landing-Klick → App direkt (kein Gate; wallet später im wallet-tab)
  const landing = $("#landing");
  if (landing) {
    landing.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".lang-dropdown")) return;
      landing.classList.add("hidden");
      enter();
    });
  }
  const enter = () => {
    $("#landing")?.classList.add("hidden");
    $("#gate")?.classList.add("hidden");
    $("#app").classList.remove("hidden");
    checkOnboarding(); // Onboarding-Modal NACH dem App-Eintritt (echtes overlay)
    // App initialisieren (Tabs, etc.)
    updateFeePreview();
    updateBudgetBar();
    loadChatList();
    loadWallet();
    loadEarnings();
    switchTab("ai");
    // Modell-Katalog + Quota laden (async, sobald provider-discovery fertig)
    void refreshModelDropdown().then(() => refreshQuota());
  };
  $("#gate-lightning").onclick = () => { loadOrCreateIdentity(); checkOwnProvider(); enter(); };
  $("#gate-local").onclick = () => { loadOrCreateIdentity(); checkOwnProvider(); enter(); };
  $("#gate-solana").onclick = async () => { loadOrCreateIdentity(); await connectSolana(); checkOwnProvider(); enter(); };
  return enter;
}

/** Prueft ob ?provider= in der URL steht und setzt ihn als einzigen erlaubten. */
function checkOwnProvider(): void {
  const pk = getOwnProviderFromUrl();
  if (pk) {
    setOwnProvider(pk);
    console.log(`[provider] Eigener Provider gesetzt: ${pkShort(pk)}`);
    toast(`Eigener Provider aktiv: ${pkShort(pk)}`);
  }
}

export function boot(): void {
  captureReferral();
  void publishReferralClaim();
  // SVG-Icons: alle [data-icon]-Elemente bekommen ihr Inline-SVG (ersetzt Emojis)
  import("../icons.js").then(({ icon }) => {
    document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
      el.innerHTML = icon(el.dataset.icon!);
    });
  });
  // Sprache: gespeicherte oder Browser-Default (en)
  const saved = (localStorage.getItem("freedom.lang") as Lang | null);
  setLang(saved ?? detectLang());
  const langCode = getLang().toUpperCase();
  ($("#lang-btn") as HTMLButtonElement).textContent = `${langCode} ▾`;
  const appLangBtn = $("#lang-btn-app") as HTMLButtonElement | null;
  if (appLangBtn) appLangBtn.textContent = `${langCode} ▾`;
  applyI18n();
  setupLangMenu();
  // Kein Gate mehr → Identity beim Boot laden/erzeugen (früher gate-button)
  loadOrCreateIdentity();
  checkOwnProvider();
  const enter = setupFlow();
  // Kein Gate: App öffnet direkt. Wallet-Connect/Deposit über sidebar-CTA
  // → wallet-tab. (R1 in docs/ROADMAP.md ändert das vor dem Launch.)
  enter();

  // App-Interna (werden nach Login aktiv)
  document.querySelectorAll(".app-nav button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => switchTab((b as HTMLElement).dataset.tab!));
  });
  $("#ident").onclick = exportIdentity;
  $("#btn-import").onclick = importIdentity;
  // Sidebar-Balances: ident + import klonen die header-handler (desktop)
  const nbIdent = $("#nb-ident");
  const nbImport = $("#nb-import");
  if (nbIdent) nbIdent.onclick = exportIdentity;
  if (nbImport) nbImport.onclick = importIdentity;
  // Wallet-Button in der Sidebar: springt zum Wallet-Tab (verbinden/deposit)
  const nbWallet = $("#nb-wallet");
  if (nbWallet) {
    nbWallet.onclick = () => switchTab("wallet");
    // Bereits verbunden? → Button zeigt "deposit" und öffnet trotzdem wallet-tab
    if (localStorage.getItem("freedom.sol.pubkey") || localStorage.getItem("freedom.sol.balance")) {
      nbWallet.textContent = "+ SOL deposit";
    }
  }
  $("#chat-send").onclick = sendChatMessage;
  // Media-Anhaenge im Chat (frueher Feed): kleine Dateien inline, grosse ueber
  // das Chunk-/Blob-Netz mit Blossom als Fallback.
  const chatMediaBtn = $("#chat-media-btn");
  const chatFileInput = $("#chat-file-input") as HTMLInputElement | null;
  if (chatMediaBtn && chatFileInput) {
    chatMediaBtn.onclick = () => chatFileInput.click();
    chatFileInput.onchange = () => { void handleChatFiles(chatFileInput.files); chatFileInput.value = ""; };
  }
  // NEU: Zap-Button neben Eingabefeld
  const zapBtn = $("#chat-zap");
  if (zapBtn) {
    zapBtn.onclick = async () => {
      if (!activeConversation) {
        toast("waehle erst einen chat", true);
        return;
      }
      const c = conversations.find((x) => x.id === activeConversation);
      if (!c || c.type !== "dm") {
        toast("zaps nur in 1:1-chats", true);
        return;
      }
      const { openZapDialog } = await import("../chat-zap.js");
      openZapDialog(c.id, c.name);
    };
  }
  // Mesh-Transfer (USB/offline): chat-verlauf exportieren / datei importieren
  const meshExportBtn = $("#chat-mesh-export");
  const meshImportBtn = $("#chat-mesh-import");
  const meshFileInput = $("#chat-mesh-file") as HTMLInputElement | null;
  if (meshExportBtn) {
    meshExportBtn.onclick = async () => {
      if (!state.keypair || !activeConversation) { toast("waehle erst einen chat", true); return; }
      try {
        const pool = await ensurePool();
        const c = conversations.find((x) => x.id === activeConversation);
        if (!c) return;
        const kinds = c.type === "dm" ? [4] : [42];
        const filter = c.type === "dm"
          ? { kinds, authors: [state.keypair.pk, c.id], limit: 200 }
          : { kinds, "#h": [c.id], limit: 200 };
        const events = await pool.query(filter as never);
        const { exportMeshFile } = await import("../mesh-transfer.js");
        exportMeshFile(events, state.keypair.pk, c.name.replace(/[^a-z0-9]/gi, "-").slice(0, 20));
        toast(`${events.length} events exportiert — auf USB/Bluetooth senden`);
      } catch (e) {
        toast(`export-fehler: ${(e as Error).message}`, true);
      }
    };
  }
  if (meshImportBtn && meshFileInput) {
    meshImportBtn.onclick = () => meshFileInput.click();
    meshFileInput.onchange = async () => {
      const file = meshFileInput.files?.[0];
      meshFileInput.value = "";
      if (!file || !state.keypair) return;
      try {
        const { importMeshFile } = await import("../mesh-transfer.js");
        const events = await importMeshFile(file);
        // events ins netz publizieren (signaturen werden von relays geprueft)
        const pool = await ensurePool();
        let ok = 0;
        for (const ev of events) {
          try {
            await pool.publish(ev as never);
            ok++;
          } catch { /* duplikat/ungueltig */ }
        }
        toast(`${ok}/${events.length} offline-events importiert`);
        if (activeConversation) loadChatMessages(activeConversation);
      } catch (e) {
        toast(`import-fehler: ${(e as Error).message}`, true);
      }
    };
  }
  // Reward-Claim
  const claimBtn = $("#claim-submit");
  if (claimBtn) claimBtn.onclick = submitRewardClaim;
  // Freedom Git: bundle publizieren + repo-liste laden
  const gitPublishBtn = $("#git-repo-publish");
  const gitFileInput = $("#git-bundle-file") as HTMLInputElement | null;
  if (gitPublishBtn && gitFileInput) {
    gitPublishBtn.onclick = () => gitFileInput.click();
    gitFileInput.onchange = async () => {
      const file = gitFileInput.files?.[0];
      gitFileInput.value = "";
      if (!file || !state.keypair) return;
      const nameEl = $("#git-repo-name") as HTMLInputElement;
      const name = nameEl.value.trim().replace(/[^a-z0-9-_]/gi, "-") || file.name.replace(/\.bundle$/i, "");
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // sha256 head aus bundle-name (der user macht lokal: git bundle create)
        const { uploadBlob } = await import("../blob-client.js");
        const pool = await ensurePool();
        setGitStatus(`publiziere ${file.name} (${Math.round(bytes.length / 1024)}kb)…`);
        const res = await uploadBlob(
          new File([bytes], `${name}.bundle`, { type: "application/octet-stream" }),
          pool as never, state.keypair, signEvent as never,
        );
        // repo-ref-event (38042)
        const { buildGitRepoRef } = await import("@freedomstack/protocol");
        const ref = buildGitRepoRef(
          { name, blobId: res.blobId, headSha: "local", branch: "main", message: `bundle ${file.name}`, version: Math.floor(Date.now() / 1000) },
          state.keypair.pk,
        );
        await pool.publish(signEvent(ref, state.keypair.sk));
        toast(`${name} publiziert (${res.blobId.slice(0, 8)}…)`);
        loadGitRepos();
      } catch (e) {
        toast(`git-fehler: ${(e as Error).message}`, true);
      }
    };
  }
  loadGitRepos();
  $("#ai-send").onclick = askAi;
  $("#ai-bid").oninput = updateFeePreview;
  $("#wallet-refresh").onclick = loadWallet;
  void wireClientFeeSetting();
  void wireMeshTab();
  void wireSpacesTab();
  void wireProfil();
  setzeLogo();
  wireSubtabs();
  wireKommunikation();
  zeigeVerlaeufe();
  document.getElementById("agent-new")?.addEventListener("click", neueAufgabe);
  void aktualisiereNavStatus();
  void aktualisiereSicherheitsStand();
  // Profil teilen: den oeffentlichen Schluessel kopieren — damit findet dich jeder Nostr-Client.
  document.getElementById("profile-share")?.addEventListener("click", async () => {
    if (!state.keypair) return;
    try {
      await navigator.clipboard.writeText(state.keypair.pk);
      toast("Öffentlicher Schlüssel kopiert");
    } catch {
      prompt("Öffentlicher Schlüssel:", state.keypair.pk);
    }
  });
  const ziele: Record<string, string> = { "1": "backup-now", "2": "rotation-prepare", "3": "succ-setup" };
  document.querySelectorAll<HTMLElement>(".sec-action").forEach((b) => {
    b.addEventListener("click", () => document.getElementById(ziele[b.dataset.step!] ?? "")?.click());
  });
  setInterval(() => void aktualisiereNavStatus(), 30_000);
  void zeigeOnboarding();
  const succSetup = $("#succ-setup");
  if (succSetup) succSetup.onclick = () => void richteNachfolgeEin();
  const succBeat = $("#succ-heartbeat");
  if (succBeat) succBeat.onclick = async () => {
    if (!state.keypair) return;
    const { buildHeartbeat, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildHeartbeat(state.keypair.pk), state.keypair.sk));
    toast("Lebenszeichen gesendet — laufende Vorgänge sind abgebrochen");
    void zeigeNachfolge();
  };
  const modelsRefresh = $("#models-refresh");
  if (modelsRefresh) modelsRefresh.onclick = () => void zeigeModelle();
  const modelsSeed = $("#models-seed");
  if (modelsSeed) modelsSeed.onclick = () => void haltevorModell();
  const modelsPub = $("#models-publish");
  if (modelsPub) modelsPub.onclick = () => void kuendigeModellAn();
  const badgeCreate = $("#badge-create");
  if (badgeCreate) badgeCreate.onclick = () => void vergebeAbzeichen();
  void zeigeNachfolge();
  void zeigeModelle();
  void zeigeMitwirkende();
  void wireRpcSetting();
  const exportBtn = $("#selfexport-btn");
  if (exportBtn) exportBtn.onclick = () => void exportiereApp();
  const checkBtn = $("#selfcheck-btn");
  if (checkBtn) checkBtn.onclick = () => void pruefeEigeneEchtheit();
  const swapClaimBtn = $("#swap-claim");
  if (swapClaimBtn) swapClaimBtn.onclick = () => void claimActiveSwap();
  const swapBackupBtn = $("#swap-backup");
  if (swapBackupBtn) swapBackupBtn.onclick = () => void exportSwapBackup();
  $("#earn-refresh").onclick = loadEarnings;
  $("#sol-connect").onclick = () => void connectSolana();
  // NWC: Lightning ohne Browser-Extension — der einzige Weg, der auf iOS geht.
  const nwcConnectBtn = $("#nwc-connect");
  if (nwcConnectBtn) nwcConnectBtn.onclick = () => void connectNwc();
  const nwcDisconnectBtn = $("#nwc-disconnect");
  if (nwcDisconnectBtn) nwcDisconnectBtn.onclick = disconnectNwc;
  $("#dep-start").onclick = startDeposit;
  $("#dep-refund").onclick = refundDeposit;
  $("#chat-new-dm").onclick = () => void newDm();
  $("#chat-new-community").onclick = newCommunity;
  setupAttach();
  setupToolChips();
  setupModelPicker();
  setupEmptyState();
  // C7: Live-Kosten-Schätzung beim Tippen + Enter-to-Send (Shift+Enter = Zeilenumbruch)
  const aiPromptEl = $("#ai-prompt") as HTMLTextAreaElement;
  if (aiPromptEl) {
    aiPromptEl.addEventListener("input", updateTokenEstimate);
    aiPromptEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void askAi();
      }
    });
    // Auto-Resize bis max 6 rows
    aiPromptEl.addEventListener("input", () => {
      aiPromptEl.style.height = "auto";
      aiPromptEl.style.height = Math.min(aiPromptEl.scrollHeight, 160) + "px";
    });
  }
  setupReferral();
  setupCopyButtons();
}

/** Zap-Button: NIP-57 Lightning-Zahlung fuer eine Antwort. */
function addZapButton(providerPubkey: string, eventId: string, amountMsat: number): void {
  const el = document.createElement("div");
  el.className = "zap-bubble";
  const sats = Math.floor(amountMsat / 1000);
  el.innerHTML = `
    <button class="zap-btn" type="button">⚡ zap ${sats} sats</button>
    <span class="zap-status hidden"></span>
  `;
  const btn = el.querySelector(".zap-btn") as HTMLButtonElement;
  const status = el.querySelector(".zap-status") as HTMLElement;
  btn.onclick = async () => {
    try {
      btn.disabled = true;
      status.textContent = "verbinde wallet…";
      status.classList.remove("hidden");
      // Wallet verbinden (WebLN oder LNURL)
      const { detectWallet } = await import("../lightning-wallet.js");
      const wallet = await detectWallet();
      if (!wallet) {
        status.textContent = "keine lightning-wallet im browser — iphone: nutze solana-deposit im wallet-tab";
        return;
      }
      await wallet.connect();
      // Zap-Request bauen (NIP-57)
      const { buildZapRequest } = await import("@freedomstack/protocol");
      const zapReq = buildZapRequest({
        senderPubkey: state.keypair!.pk,
        recipientPubkey: providerPubkey,
        eventId,
        amountMsat,
        relays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
      });
      // LNURL-Pay vom Provider holen (aus seinem Profil, kind 0)
      const { parseProfile } = await import("@freedomstack/protocol");
      const pool = await ensurePool();
      const profiles = await pool.query({ kinds: [0], authors: [providerPubkey], limit: 1 });
      let lud16 = "";
      if (profiles.length > 0) {
        try {
          const p = parseProfile(profiles[0]);
          lud16 = p.lud16 ?? "";
        } catch { /* ignore */ }
      }
      if (!lud16) {
        status.textContent = "provider hat keine lightning-adresse (lud16)";
        return;
      }
      // LNURL-Pay: fetch -> get invoice -> pay
      const lnurlRes = await fetch(`https://${lud16.split("@")[1]}/.well-known/lnurlp/${lud16.split("@")[0]}`);
      const lnurlData = await lnurlRes.json();
      if (!lnurlData.callback) throw new Error("kein callback in LNURL");
      const cb = new URL(lnurlData.callback);
      cb.searchParams.set("amount", String(amountMsat));
      cb.searchParams.set("nostr", JSON.stringify(zapReq));
      const cbRes = await fetch(cb.toString());
      const cbData = await cbRes.json();
      if (!cbData.pr) throw new Error("keine invoice in callback");
      // Bezahlen mit Wallet
      const { preimage } = await wallet.sendPayment(cbData.pr);
      status.textContent = `⚡ gezappt! ${Math.floor(amountMsat / 1000)} sats`;
      // Zap-Receipt publizieren (NIP-57)
      const { buildZapReceipt, signEvent } = await import("@freedomstack/protocol");
      const receipt = buildZapReceipt({
        zapperPubkey: state.keypair!.pk,
        recipientPubkey: providerPubkey,
        eventId,
        zapRequestJson: JSON.stringify(zapReq),
        bolt11: cbData.pr,
        preimageHex: preimage,
      });
      await pool.publish(signEvent(receipt, state.keypair!.sk));
    } catch (e) {
      status.textContent = `fehler: ${(e as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  };
  $("#ai-thread").appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
}

/** Onboarding: 3-Schritt-Wizard fuer neue Nutzer. */
function showOnboarding(): void {
  const el = document.createElement("div");
  el.className = "onboarding-overlay";
  el.innerHTML = `
    <div class="onboarding-card">
      <h2>Willkommen bei Freedom</h2>
      <p class="mono-sm">Dezentrale KI + Zahlungen. Kein Account. Kein Server.</p>
      <div class="onboarding-steps">
        <div class="step active" data-step="1">
          <div class="step-num">1</div>
          <div class="step-title">Verbinden</div>
          <div class="step-desc">Nostr-Key oder Wallet</div>
        </div>
        <div class="step" data-step="2">
          <div class="step-num">2</div>
          <div class="step-title">AI testen</div>
          <div class="step-desc">3 Gratis-Antworten</div>
        </div>
        <div class="step" data-step="3">
          <div class="step-num">3</div>
          <div class="step-title">Zap senden</div>
          <div class="step-desc">1 sat an Provider</div>
        </div>
      </div>
      <div class="onboarding-actions">
        <button class="ghost" id="onboarding-skip">Ueberspringen</button>
        <button class="cta" id="onboarding-start">Starten</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  const closeOnboarding = (): void => {
    el.remove();
    localStorage.setItem("freedom.onboarded", "1");
  };
  $("#onboarding-skip")!.onclick = closeOnboarding;
  $("#onboarding-start")!.onclick = closeOnboarding;
  // Klick auf den dunklen Hintergrund schließt ebenfalls
  el.addEventListener("click", (e) => {
    if (e.target === el) closeOnboarding();
  });
}

/** Prueft ob Onboarding gezeigt werden soll. */
function checkOnboarding(): void {
  const onboarded = localStorage.getItem("freedom.onboarded");
  if (!onboarded) {
    showOnboarding();
  }
}

/** Copy-Buttons: letzte antwort + ganze konversation. */
function setupCopyButtons(): void {
  const copyLast = $("#copy-last");
  const copyAll = $("#copy-all");
  const getBubbles = () => Array.from(document.querySelectorAll("#ai-thread .bubble"));
  const bubbleText = (b: Element) => {
    const who = b.querySelector(".who")?.textContent?.trim() ?? "";
    const txt = b.querySelector(".body")?.textContent?.trim() ?? "";
    return who ? `${who}: ${txt}` : txt;
  };
  copyLast?.addEventListener("click", async () => {
    const bubbles = getBubbles().filter((b) => b.classList.contains("ai"));
    const last = bubbles[bubbles.length - 1];
    if (!last) { toast("keine antwort zum kopieren", true); return; }
    await navigator.clipboard.writeText(bubbleText(last));
    toast("letzte antwort kopiert");
  });
  copyAll?.addEventListener("click", async () => {
    const bubbles = getBubbles();
    if (bubbles.length === 0) { toast("keine konversation", true); return; }
    const text = bubbles.map(bubbleText).join("\n\n");
    await navigator.clipboard.writeText(text);
    toast("konversation kopiert");
  });
}

/** Referral: link mit eigener pubkey generieren + copy. */
function setupReferral(): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const copyBtn = $("#referral-copy");
  const stats = $("#referral-stats");
  if (!link || !copyBtn) return;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      toast("Referral-Link kopiert");
    } catch {
      link.select();
      document.execCommand("copy");
      toast("Referral-Link kopiert");
    }
  });

  // Rechner: der Nutzer soll die Annahme selbst verstellen koennen. Eine feste
  // Beispielzahl waere eine Verkaufszahl; eine, die er anfasst, ist eine
  // Rechnung, die er nachvollzieht.
  const n = $("#ref-calc-n") as HTMLInputElement | null;
  const satsIn = $("#ref-calc-sats") as HTMLInputElement | null;
  const out = $("#ref-calc-out");
  if (n && satsIn && out) {
    const rechne = async (): Promise<void> => {
      const { projectEarnings } = await import("@freedomstack/protocol");
      const p = projectEarnings({
        activeReferrals: Math.max(0, Number(n.value) || 0),
        avgMonthlySatsPerReferral: Math.max(0, Number(satsIn.value) || 0),
      });
      out.innerHTML =
        `<strong>${p.monthlySats.toLocaleString("de-DE")} sats/Monat</strong> ` +
        `(${p.yearlySats.toLocaleString("de-DE")} sats/Jahr), Stufe ${escapeHtml(p.tier)}.<br>` +
        `<span class="muted">${escapeHtml(p.assumption)}</span>`;
    };
    n.addEventListener("input", () => void rechne());
    satsIn.addEventListener("input", () => void rechne());
    void rechne();
  }
}

/**
 * Referral-URL mit der AKTUELLEN identity füllen. Muss NACH dem Identity-Laden
 * laufen (sonst ?ref= leer) und bei jedem Earn-Tab-Öffnen erneut — der pubkey
 * kann sich ändern (import).
 */
function updateReferralLink(): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const stats = $("#referral-stats");
  if (!link || !state.keypair) return;
  const pub = state.keypair.pk;
  // Origin-basiert (funktioniert auf jeder Domain — nicht nur localhost):
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("ref", pub);
  link.value = url.toString();
  if (stats) stats.textContent = `dein Code: ${pkShort(pub)}`;
  void renderReferralTier();
}

/** Eigene Stufe und der Weg zur naechsten. */
async function renderReferralTier(): Promise<void> {
  const box = $("#referral-tier");
  if (!box || !state.keypair) return;
  try {
    const {
      tierFor, nextTier, buildReferralGraph, referrerOverview,
      KIND_REFERRAL_CLAIM, KIND_PERFORMANCE,
    } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

    // Aus SIGNIERTEN Netz-Ereignissen gerechnet, nicht aus einer lokalen Zahl.
    // Damit kann jeder dieselbe Rechnung anstellen und das Ergebnis pruefen.
    const [claims, perfs] = await Promise.all([
      pool.query({ kinds: [KIND_REFERRAL_CLAIM], limit: 2000 }),
      pool.query({ kinds: [KIND_PERFORMANCE], since, limit: 2000 }),
    ]);
    const graph = buildReferralGraph(claims, perfs);
    const u = referrerOverview(state.keypair.pk, graph);

    const t = tierFor(u.activeReferrals);
    const next = nextTier(u.activeReferrals);
    box.innerHTML =
      `Stufe <strong>${escapeHtml(t.name)}</strong> — ${escapeHtml(t.perk)}<br>` +
      `<span class="muted">${u.activeReferrals} aktiv von ${u.totalReferrals} geworben` +
      (u.level2Count > 0 ? `, ${u.level2Count} auf Ebene 2` : "") + `.</span>` +
      (next
        ? `<br><span class="muted">Noch ${next.missing} aktive Geworbene bis ${escapeHtml(next.tier.name)}.</span>`
        : `<br><span class="muted">Hoechste Stufe erreicht.</span>`);
  } catch {
    // Ohne Netz keine erfundene Zahl anzeigen.
    box.innerHTML = `<span class="muted">Stufe wird beim naechsten Netzkontakt berechnet.</span>`;
  }
}

/** Referral aus URL lesen (?ref=pubkey) und speichern. */
function captureReferral(): void {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref && /^[0-9a-f]{64}$/.test(ref)) {
    // Nicht ueberschreiben: Es zaehlt ohnehin die frueheste Angabe im Netz.
    // Lokal dasselbe Verhalten, damit ein spaeter geoeffneter fremder Link
    // den urspruenglichen Werber nicht still verdraengt.
    if (!localStorage.getItem("freedom.referrer")) {
      localStorage.setItem("freedom.referrer", ref);
    }
  }
}

/**
 * Werbebeziehung EINMAL im Netz veroeffentlichen.
 *
 * Vorher lag der Werber nur in localStorage und war fuer das Netz unsichtbar —
 * die Stufen zeigten deshalb immer "Starter", und eine Auszahlung waere nur
 * auf Zuruf moeglich gewesen. Der Claim wird vom GEWORBENEN signiert: nur so
 * kann niemand fremde Pubkeys als eigene Geworbene eintragen.
 */
async function publishReferralClaim(): Promise<void> {
  if (!state.keypair) return;
  if (localStorage.getItem("freedom.referrer.published") === "1") return;
  const referrer = localStorage.getItem("freedom.referrer");
  if (!referrer || referrer === state.keypair.pk) return;

  try {
    const { buildReferralClaim, signEvent: se } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    await pool.publish(se(buildReferralClaim(state.keypair.pk, referrer), state.keypair.sk));
    localStorage.setItem("freedom.referrer.published", "1");
  } catch (e) {
    // Kein Abbruch: Der Claim wird beim naechsten Start erneut versucht.
    console.warn(`[referral] Claim noch nicht veroeffentlicht: ${(e as Error).message}`);
  }
}
