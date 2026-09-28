/**
 * Provider-Matchmaking + Failover (App-Seite).
 *
 * Der Client waehlt automatisch den besten Provider — KEIN manuelles pubkey
 * mehr. Quelle: PROVIDER_CAPABILITIES (38027) + Ruf aus eigenen Quittungen und
 * den Zusammenfassungen der Kontakte (5.5, `berechneRuf()`). Leistungs-Events
 * (38010) zaehlen seit 5.5b nicht mehr – Selbstauskuenfte lassen sich faelschen.
 *
 * Auswahl-Logik:
 *   1. Filter nach gewuenschtem Tier (tierSatisfies) auf die Stufe: das Angebot,
 *      durch Quittungen hoeher, durch bestaetigte Reklamationen tiefer
 *   2. Sortierung: Provider mit Ruf vor ungeprueften, Ruf absteigend,
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
  type Ruf,
} from "@freedomstack/protocol";

export interface ScoredProvider {
  caps: ProviderCapabilities;
  trustScore: number;
  jobsCompleted: number;
  /** Stufe (Client-Filter): das Angebot, durch Quittungen hoeher, durch bestaetigte Reklamationen tiefer. */
  repTier: ProviderTier;
  score: number;
  /** Gibt es Quittungen (eigene oder von Kontakten)? Ohne sie ist der Provider ungeprueft. */
  geprueft: boolean;
  /** Bestaetigte Reklamationen (eigene, von Kontakten zur Haelfte). */
  reklamationen: number;
}

const RANG: Record<ProviderTier, number> = { free: 1, classic: 2, pro: 3 };

/**
 * Stufe aus dem Ruf (5.5b): ohne Quittungen das, was der Provider anbietet;
 * Quittungen koennen sie heben, nur bestaetigte Reklamationen senken – sonst
 * saenke eine einzige bezahlte Antwort einen neuen Provider unter sein Angebot.
 */
export function stufeAusRuf(angebot: ProviderTier, ruf: Ruf | undefined): ProviderTier {
  if (!ruf) return angebot;
  const verdient = recommendedTier({ trustScore: ruf.vertrauen, jobsCompleted: Math.round(ruf.auftraege), inBootstrap: false });
  if (ruf.reklamationen > 0) return RANG[verdient] < RANG[angebot] ? verdient : angebot;
  return RANG[verdient] > RANG[angebot] ? verdient : angebot;
}

/**
 * Laedt alle Provider-Angebote und ordnet ihnen den Ruf zu – nur aus eigenen
 * Quittungen und den Zusammenfassungen der Kontakte (`ruf`, 5.5b). Was ein
 * Provider ueber sich selbst veroeffentlicht (38010), fragt die App nicht ab.
 */
export async function discoverProviders(pool: OutboxPool, ruf: ReadonlyMap<string, Ruf> = new Map()): Promise<ScoredProvider[]> {
  const capsEvents = await pool.query({ kinds: [KIND_PROVIDER_CAPABILITIES], limit: 200 });

  const now = Math.floor(Date.now() / 1000);
  const out: ScoredProvider[] = [];
  for (const ev of capsEvents) {
    try {
      const caps = parseCapabilities(ev);
      const r = ruf.get(caps.pubkey);
      const trustScore = r?.vertrauen ?? 0;
      const jobsCompleted = Math.round(r?.auftraege ?? 0);
      const repTier = stufeAusRuf(caps.tier, r);

      // Das Angebot muss frisch sein (letzte 24h) – der Knoten erneuert es alle 30 min.
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
        // Gesamt-Score: Ruf dominierend, dann Auftraege; ungepruefte hinter allen mit Ruf
        score: r ? trustScore * 10 + jobsCompleted : -1,
        geprueft: !!r,
        reklamationen: r?.reklamationen ?? 0,
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
  // Scam-Filter: Wer bestaetigte Reklamationen hat, braucht fuer classic/pro
  // Vertrauen. Ohne Reklamation zaehlt das Angebot – sonst stuende ein einmal
  // bezahlter Provider hinter einem unbekannten. Ungepruefte (keine Quittungen)
  // bleiben waehlbar, sonst faende ein neuer Nutzer keinen; sie stehen hinten
  // (score -1). Die Allowlist (eigene Provider) ist immer erlaubt.
  const minTrust = opts.minTrust ?? (wantedTier === "free" ? 0 : 10);
  const allow = new Set(opts.allowlist ?? []);
  return providers
    .filter((p) => tierSatisfies(p.repTier, wantedTier))
    .filter((p) => allow.has(p.caps.pubkey) || p.reklamationen === 0 || p.trustScore >= minTrust)
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
