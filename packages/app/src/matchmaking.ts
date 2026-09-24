/**
 * Provider-Matchmaking + Failover (App-Seite).
 *
 * Der Client waehlt automatisch den besten Provider — KEIN manuelles pubkey
 * mehr. Quelle: PROVIDER_CAPABILITIES (38025) + Reputation (38010/WoT).
 *
 * Auswahl-Logik:
 *   1. Filter nach gewuenschtem Tier (tierSatisfies)
 *   2. Sortierung: Reputation (jobsCompleted/trustScore) absteigend,
 *      dann Preis aufsteigend
 *   3. Failover: antwortet der beste nicht in timeoutMs -> naechster
 *
 * Race-Modus (optional, NICHT default): siehe requestRace(). User zahlt
 * Aufpreis fuer Redundanz; Default ist effizientes Failover (kein Waste).
 */
import {
  OutboxPool,
  parseCapabilities,
  ProviderCapabilities,
  ProviderTier,
  tierSatisfies,
  recommendedTier,
  KIND_PROVIDER_CAPABILITIES,
  KIND_PERFORMANCE,
  parsePerformance,
} from "@freedomstack/protocol";

export interface ScoredProvider {
  caps: ProviderCapabilities;
  trustScore: number;
  jobsCompleted: number;
  /** Empfohlenes Tier aus Reputation (Client-Filter). */
  repTier: ProviderTier;
  score: number;
}

/**
 * Laedt alle Provider-Capabilities + baut Reputation aus 38010-Events.
 * Dezentral: alles aus oeffentlichen Relays, kein Server.
 */
export async function discoverProviders(pool: OutboxPool): Promise<ScoredProvider[]> {
  const capsEvents = await pool.query({ kinds: [KIND_PROVIDER_CAPABILITIES], limit: 200 });
  const perfEvents = await pool.query({ kinds: [KIND_PERFORMANCE], limit: 1000 });

  // Reputation aggregieren: jobs + letzter aktiver Zeitpunkt pro worker
  const jobs = new Map<string, number>();
  const lastActive = new Map<string, number>();
  for (const ev of perfEvents) {
    try {
      const p = parsePerformance(ev);
      jobs.set(p.workerPubkey, (jobs.get(p.workerPubkey) ?? 0) + 1);
      lastActive.set(p.workerPubkey, Math.max(lastActive.get(p.workerPubkey) ?? 0, ev.created_at));
    } catch {
      /* ungueltig */
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const out: ScoredProvider[] = [];
  for (const ev of capsEvents) {
    try {
      const caps = parseCapabilities(ev);
      const jobsCompleted = jobs.get(caps.pubkey) ?? 0;
      // Einfacher Trust-Score: jobs*2, Bonus wenn kuerzlich aktiv, Cap bei 100.
      // (WoT-Gewichtung kaeme oben drauf; v1: Aktivitaets-basiert.)
      const recency = lastActive.get(caps.pubkey) ?? 0;
      const recentBonus = now - recency < 86400 ? 10 : 0;
      const trustScore = Math.min(100, jobsCompleted * 2 + recentBonus);
      const inBootstrap = caps.currentlyFree && jobsCompleted < 10;
      const repTier = recommendedTier({ trustScore, jobsCompleted, inBootstrap });

      // NEU: Provider ohne aktuelle Aktivitaet (letzte 7 Tage) aussortieren.
      // Verhindert dass "tote" Provider mit altem Trust-Score Anfragen abfangen.
      const isStale = now - recency > 7 * 86400 && jobsCompleted > 0;
      if (isStale) continue;

      // NEU: Capabilities-Event muss frisch sein (letzte 24h), sonst veraltet.
      // Verhindert dass alte Events von nicht mehr laufenden Providern dominieren.
      const capsAge = now - ev.created_at;
      if (capsAge > 86400) continue;

      // NEU: Bekannte tote Provider explizit ausschliessen (alter GX10-Provider).
      // Dieser laeuft nicht mehr lokal, publiziert aber noch irgendwo im Netz.
      const DEAD_PROVIDERS = new Set([
        "90d8d489", // alter provider (nicht mehr lokal aktiv)
      ]);
      if (DEAD_PROVIDERS.has(caps.pubkey.slice(0, 8))) continue;

      out.push({
        caps,
        trustScore,
        jobsCompleted,
        repTier,
        // Gesamt-Score: Trust dominierend, dann Jobs
        score: trustScore * 10 + jobsCompleted,
      });
    } catch {
      /* ungueltiges caps-event */
    }
  }
  return out;
}

/**
 * Waehlt die besten Provider fuer ein Tier, sortiert nach Score (best first).
 * Gibt eine geordnete Liste zurueck (fuer Failover: [0] zuerst, dann [1]...).
 */
export function matchProviders(
  providers: ScoredProvider[],
  wantedTier: ProviderTier,
  opts: { model?: string; maxResults?: number; minTrust?: number; allowlist?: string[] } = {},
): ScoredProvider[] {
  const max = opts.maxResults ?? 5;
  // Scam-filter: free=0 (neue provider koennen providen), classic/pro brauchen trust.
  // ABER: allowlist (eigene provider) immer erlaubt, egal welcher trust.
  const minTrust = opts.minTrust ?? (wantedTier === "free" ? 0 : 10);
  const allow = new Set(opts.allowlist ?? []);
  return providers
    .filter((p) => tierSatisfies(p.repTier, wantedTier))
    .filter((p) => allow.has(p.caps.pubkey) || p.trustScore >= minTrust)
    .filter((p) => (opts.model ? p.caps.models.includes(opts.model) : true))
    .sort((a, b) => {
      // allowlist zuerst, dann score absteigend
      const aAllow = allow.has(a.caps.pubkey) ? 1 : 0;
      const bAllow = allow.has(b.caps.pubkey) ? 1 : 0;
      if (aAllow !== bAllow) return bAllow - aAllow;
      if (b.score !== a.score) return b.score - a.score;
      return a.caps.textRatePerKTokenMsat - b.caps.textRatePerKTokenMsat;
    })
    .slice(0, max);
}

// ------------------------------------------------------------- MAX MODE

/**
 * MAX MODE (Race, opt-in — NICHT default):
 * Der Job geht an N Provider gleichzeitig; der SCHNELLSTE gewinnt den
 * vollen Preis, die Verlierer bekommen einen kleinen Bereitschafts-Anteil
 * (sie haben KV-Cache warm gehalten und angefangen zu rechnen).
 *
 * Oekonomisch ehrlich: Staerkere Latenz/Redundanz kostet mehr. Der User
 * zahlt den Aufpreis bewusst. NICHT default, weil N-1 Provider sonst
 * umsonst rechnen wuerden (ruinoes bei 70B-Jobs).
 *
 * Default-Split (Gewinner 60%, Verlierer teilen 40%): summiert zu 100%,
 * Verlierer bekommen fuer Bereitschaft + Teilarbeit etwas, Gewinner die
 * Mehrheit. Kein Topf — Split an der Quelle (Fee-Split-Logik).
 */
export interface MaxModeConfig {
  /** Anzahl Provider im Race (default 3). */
  racers: number;
  /** Gewinner-Anteil in Prozent (default 60). Rest gleichmaessig an Verlierer. */
  winnerSharePct: number;
}

export const DEFAULT_MAX_MODE: MaxModeConfig = { racers: 3, winnerSharePct: 60 };

/** Berechnet die Anteile pro Platz (Gewinner + Verlierer). Summe == totalMsat. */
export function maxModeSplit(totalMsat: number, cfg: MaxModeConfig = DEFAULT_MAX_MODE): {
  winnerMsat: number;
  loserMsatEach: number;
  racers: number;
} {
  const winnerMsat = Math.floor((totalMsat * cfg.winnerSharePct) / 100);
  const losers = cfg.racers - 1;
  const rest = totalMsat - winnerMsat;
  const loserMsatEach = losers > 0 ? Math.floor(rest / losers) : 0;
  return { winnerMsat, loserMsatEach, racers: cfg.racers };
}

/** Waehlt N Provider fuer ein Race (Top-N nach Score). */
export function matchRaceProviders(
  providers: ScoredProvider[],
  wantedTier: ProviderTier,
  cfg: MaxModeConfig = DEFAULT_MAX_MODE,
  model?: string,
): ScoredProvider[] {
  return matchProviders(providers, wantedTier, { model, maxResults: cfg.racers });
}

// ------------------------------------------------------------- SWARM (Judge)

/**
 * SWARM-Tier (5. Modus, wie OpenRouter Fusion):
 * N Provider antworten ALLE auf denselben Job; ein starker JUDGE (ein
 * Pro-Provider) bewertet die Antworten und waehlt/synthetisiert die beste.
 *
 * Unterschied zu max (race): bei max gewinnt der SCHNELLSTE, bei swarm
 * gewinnt die BESTE (Qualitaet). Zahlt mehr (N Antworten + Judge), lohnt
 * sich fuer wichtige Bulk-/Qualitaets-Jobs.
 */
export interface SwarmConfig {
  /** Anzahl antwortender Provider (default 3). */
  responders: number;
  /** Judge-Tier (default pro). */
  judgeTier: ProviderTier;
  /** Anteil des Judge am Gesamtpreis (default 20%). */
  judgeSharePct: number;
}

export const DEFAULT_SWARM: SwarmConfig = { responders: 3, judgeTier: "pro", judgeSharePct: 20 };

/** Preis-Split fuer swarm: Judge-Anteil + Responder teilen den Rest. */
export function swarmSplit(totalMsat: number, cfg: SwarmConfig = DEFAULT_SWARM): {
  judgeMsat: number;
  responderMsatEach: number;
  responders: number;
} {
  const judgeMsat = Math.floor((totalMsat * cfg.judgeSharePct) / 100);
  const rest = totalMsat - judgeMsat;
  const responderMsatEach = cfg.responders > 0 ? Math.floor(rest / cfg.responders) : 0;
  return { judgeMsat, responderMsatEach, responders: cfg.responders };
}

/** Waehlt N Responder + 1 Judge (beste des judgeTier). */
export function matchSwarmProviders(
  providers: ScoredProvider[],
  wantedTier: ProviderTier,
  cfg: SwarmConfig = DEFAULT_SWARM,
  model?: string,
): { responders: ScoredProvider[]; judge: ScoredProvider | undefined } {
  const responders = matchProviders(providers, wantedTier, { model, maxResults: cfg.responders });
  const judges = matchProviders(providers, cfg.judgeTier, { maxResults: 1 });
  return { responders, judge: judges[0] };
}
