/**
 * Knappheitsbonus: Kapazität dorthin lenken, wo sie fehlt.
 *
 * DAS PROBLEM MIT GLEICHVERTEILTEN BELOHNUNGEN
 * Ein Reward-Pool, der alle Provider gleich behandelt, kauft das, wovon es
 * ohnehin am meisten gibt. Der zwanzigste Knoten in Mitteleuropa bringt dem
 * Netz fast nichts; der erste in Südostasien verändert für alle dortigen
 * Nutzer, ob das Netz überhaupt benutzbar ist. Genau diese Ungleichheit muss
 * sich in der Bezahlung abbilden, sonst wächst das Netz dort, wo es schon ist.
 *
 * WARUM DAS OHNE EIGENEN TOKEN BESONDERS WICHTIG IST
 * Wer Belohnungen aus einem Token druckt, kann es sich leisten, breit zu
 * gießen. Wer sie aus echten Einnahmen zahlt, hat exakt so viel wie er
 * einnimmt — und muss deshalb gezielt zahlen. Wenige Zahlungen an knappen
 * Stellen schlagen viele Zahlungen überall.
 *
 * WAS HIER NICHT PASSIERT
 * Kein Standortnachweis, keine IP-Geolokalisierung, kein Zwang zur
 * Selbstauskunft. Ein Provider nennt seine Region selbst. Das ist
 * manipulierbar — deshalb ist der Bonus gedeckelt, an Reputation gekoppelt
 * und knüpft an NACHGEWIESENE Arbeit an, nicht an bloße Anwesenheit. Wer sich
 * in eine leere Region lügt, muss dort trotzdem echte Jobs liefern.
 */
import { NostrEvent } from "./event.js";
import { ParsedPerformance, parsePerformance } from "./performance.js";

/** Grobe Region. Bewusst kontinentweit — feiner wäre eine Ortsangabe. */
export type Region =
  | "eu" | "na" | "sa" | "af" | "as" | "oc" | "unknown";

export const ALL_REGIONS: Region[] = ["eu", "na", "sa", "af", "as", "oc"];

export interface RegionStats {
  region: Region;
  /** Provider, die in dieser Region im Zeitfenster gearbeitet haben. */
  providers: number;
  /** Erledigte Jobs im Zeitfenster. */
  jobs: number;
  /** Anteil an allen Providern, 0..1. */
  share: number;
}

export interface ScarcityOptions {
  /**
   * Ab wie vielen Providern eine Region als versorgt gilt.
   *
   * Unter diesem Wert ist jeder zusätzliche Knoten überproportional wertvoll:
   * Bei einem einzigen Provider gibt es keine Ausfallsicherheit und keinen
   * Redundanz-Konsens.
   */
  targetProvidersPerRegion?: number;
  /** Obergrenze des Multiplikators. */
  maxMultiplier?: number;
  /** Zeitfenster in Sekunden (Default 7 Tage). */
  windowSeconds?: number;
}

const DEFAULT_TARGET = 5;
const DEFAULT_MAX_MULT = 3;

/** Wertet Leistungsnachweise nach Region aus. */
export function computeRegionStats(
  events: NostrEvent[],
  opts: ScarcityOptions = {},
  nowSecs = Math.floor(Date.now() / 1000),
): Map<Region, RegionStats> {
  const window = opts.windowSeconds ?? 7 * 24 * 3600;
  const byRegion = new Map<Region, { providers: Set<string>; jobs: number }>();

  for (const ev of events) {
    if (ev.created_at < nowSecs - window) continue;
    let perf: ParsedPerformance;
    try {
      perf = parsePerformance(ev);
    } catch {
      continue;
    }
    const region = normalizeRegion(ev.tags.find((t) => t[0] === "region")?.[1]);
    const e = byRegion.get(region) ?? { providers: new Set<string>(), jobs: 0 };
    e.providers.add(perf.workerPubkey);
    e.jobs += 1;
    byRegion.set(region, e);
  }

  const totalProviders = [...byRegion.values()].reduce((s, e) => s + e.providers.size, 0);
  const out = new Map<Region, RegionStats>();

  // Auch leere Regionen auflisten — eine Region ohne Eintrag ist die
  // knappste überhaupt, und genau die würde sonst unsichtbar bleiben.
  for (const region of [...ALL_REGIONS, "unknown" as Region]) {
    const e = byRegion.get(region);
    out.set(region, {
      region,
      providers: e?.providers.size ?? 0,
      jobs: e?.jobs ?? 0,
      share: totalProviders > 0 ? (e?.providers.size ?? 0) / totalProviders : 0,
    });
  }
  return out;
}

export function normalizeRegion(raw?: string): Region {
  const r = (raw ?? "").toLowerCase().trim();
  if (["eu", "europe", "europa"].includes(r)) return "eu";
  if (["na", "north-america", "us", "ca"].includes(r)) return "na";
  if (["sa", "south-america", "latam"].includes(r)) return "sa";
  if (["af", "africa", "afrika"].includes(r)) return "af";
  if (["as", "asia", "apac", "sea"].includes(r)) return "as";
  if (["oc", "oceania", "au", "nz"].includes(r)) return "oc";
  // Auch längere Angaben wie "eu-central-1" einfangen.
  for (const known of ALL_REGIONS) {
    if (r.startsWith(known + "-") || r.startsWith(known + "_")) return known;
  }
  return "unknown";
}

/**
 * Knappheits-Multiplikator einer Region.
 *
 * 1,0 = versorgt, kein Aufschlag. Steigt, je weniger Provider da sind, bis
 * zur Obergrenze. Bewusst nicht linear: der Sprung von 0 auf 1 Provider ist
 * wichtiger als der von 4 auf 5.
 */
export function scarcityMultiplier(
  region: Region,
  stats: Map<Region, RegionStats>,
  opts: ScarcityOptions = {},
): number {
  const target = opts.targetProvidersPerRegion ?? DEFAULT_TARGET;
  const maxMult = opts.maxMultiplier ?? DEFAULT_MAX_MULT;

  // "unknown" bekommt nie einen Bonus: sonst wäre das Weglassen der
  // Regionsangabe die günstigste Art, ihn zu kassieren.
  if (region === "unknown") return 1;

  const present = stats.get(region)?.providers ?? 0;
  if (present >= target) return 1;

  // Quadratisch: bei 0 volle Prämie, bei target keine.
  const gap = (target - present) / target;
  return 1 + (maxMult - 1) * gap * gap;
}

export type PeakLevel = "ruhig" | "normal" | "stark";

export interface PeakOptions {
  /** Auslastung, ab der es als stark gilt (0..1). */
  busyThreshold?: number;
  /** Obergrenze des Stoßzeiten-Aufschlags. */
  maxMultiplier?: number;
}

/**
 * Stoßzeiten-Aufschlag anhand der aktuellen Auslastung.
 *
 * Bewusst NICHT an die Uhrzeit gekoppelt: „abends ist viel los" gilt in einem
 * weltweiten Netz für jede Zeitzone anders, und ein fester Zeitplan wäre in
 * der Hälfte der Welt falsch. Gemessen wird, was tatsächlich los ist —
 * wartende Jobs gegen verfügbare Provider.
 */
export function peakMultiplier(
  pendingJobs: number,
  availableProviders: number,
  opts: PeakOptions = {},
): { level: PeakLevel; multiplier: number; note: string } {
  const busy = opts.busyThreshold ?? 2;
  const maxMult = opts.maxMultiplier ?? 2;

  if (availableProviders <= 0) {
    return {
      level: "stark",
      multiplier: maxMult,
      note: "Kein Provider verfügbar — jeder zusätzliche ist maximal wertvoll.",
    };
  }

  const load = pendingJobs / availableProviders;
  if (load < 0.5) {
    return { level: "ruhig", multiplier: 1, note: "Genug Kapazität, kein Aufschlag." };
  }
  if (load < busy) {
    const m = 1 + ((load - 0.5) / (busy - 0.5)) * 0.5;
    return { level: "normal", multiplier: Number(m.toFixed(2)), note: "Leicht erhöhte Nachfrage." };
  }
  const m = Math.min(maxMult, 1.5 + (load - busy) * 0.25);
  return {
    level: "stark",
    multiplier: Number(m.toFixed(2)),
    note: `${pendingJobs} wartende Jobs auf ${availableProviders} Provider — Aufschlag aktiv.`,
  };
}

export interface BonusInput {
  providerPubkey: string;
  region: Region;
  /** Nachgewiesene Jobs des Providers im Zeitfenster. */
  jobsCompleted: number;
  /** Verdienst im Zeitfenster (msat) — Bemessungsgrundlage des Bonus. */
  earnedMsat: number;
  /** Vertrauenswert aus wot.ts, 0..1. Ohne Vertrauen kein Bonus. */
  trust: number;
}

export interface BonusResult {
  providerPubkey: string;
  region: Region;
  baseMsat: number;
  scarcityMultiplier: number;
  peakMultiplier: number;
  bonusMsat: number;
  reason: string;
}

export interface DistributionOptions extends ScarcityOptions {
  /** Wieviel im Topf ist. Wird nie überschritten. */
  poolMsat: number;
  /** Grundprämie als Anteil des Verdienstes, bevor Multiplikatoren greifen. */
  baseRatePpm?: number;
  /** Mindestvertrauen. Darunter gibt es nichts. */
  minTrust?: number;
  /** Mindestzahl an Jobs, bevor ein Provider überhaupt in Frage kommt. */
  minJobs?: number;
  peak?: { pendingJobs: number; availableProviders: number };
}

/**
 * Verteilt einen Bonus-Topf nach Knappheit und Auslastung.
 *
 * Zwei Eigenschaften, die nicht verhandelbar sind:
 *
 * 1. Der Topf wird NIE überschritten. Ohne eigenen Token gibt es nichts
 *    nachzudrucken; ein zugesagter Bonus, der nicht gedeckt ist, wäre ein
 *    Versprechen auf Kosten der Provider.
 * 2. Der Bonus knüpft an NACHGEWIESENE Arbeit an, nicht an Anwesenheit. Sonst
 *    wäre das Anmelden in einer leeren Region die günstigste Einnahmequelle
 *    im ganzen Netz.
 */
export function distributeScarcityBonus(
  providers: BonusInput[],
  opts: DistributionOptions,
): { payouts: BonusResult[]; distributedMsat: number; remainingMsat: number } {
  const baseRate = opts.baseRatePpm ?? 100_000; // 10 % des Verdienstes
  const minTrust = opts.minTrust ?? 0.1;
  const minJobs = opts.minJobs ?? 3;

  const peak = opts.peak
    ? peakMultiplier(opts.peak.pendingJobs, opts.peak.availableProviders)
    : { level: "ruhig" as PeakLevel, multiplier: 1, note: "" };

  // Stats aus den übergebenen Providern selbst ableiten.
  const stats = new Map<Region, RegionStats>();
  const counts = new Map<Region, Set<string>>();
  for (const p of providers) {
    const set = counts.get(p.region) ?? new Set<string>();
    set.add(p.providerPubkey);
    counts.set(p.region, set);
  }
  const total = [...counts.values()].reduce((s, v) => s + v.size, 0);
  for (const region of [...ALL_REGIONS, "unknown" as Region]) {
    const n = counts.get(region)?.size ?? 0;
    stats.set(region, { region, providers: n, jobs: 0, share: total > 0 ? n / total : 0 });
  }

  const kandidaten = providers.filter((p) => p.trust >= minTrust && p.jobsCompleted >= minJobs);

  const roh: BonusResult[] = kandidaten.map((p) => {
    const scarcity = scarcityMultiplier(p.region, stats, opts);
    const base = Math.floor((p.earnedMsat * baseRate) / 1_000_000);
    const bonus = Math.floor(base * scarcity * peak.multiplier);
    const gruende: string[] = [];
    if (scarcity > 1) {
      gruende.push(`unterversorgte Region ${p.region} (×${scarcity.toFixed(2)})`);
    }
    if (peak.multiplier > 1) gruende.push(`Stoßzeit (×${peak.multiplier})`);
    return {
      providerPubkey: p.providerPubkey,
      region: p.region,
      baseMsat: base,
      scarcityMultiplier: Number(scarcity.toFixed(2)),
      peakMultiplier: peak.multiplier,
      bonusMsat: bonus,
      reason: gruende.length > 0 ? gruende.join(", ") : "Grundprämie",
    };
  });

  const summe = roh.reduce((s, r) => s + r.bonusMsat, 0);
  if (summe === 0) {
    return { payouts: [], distributedMsat: 0, remainingMsat: opts.poolMsat };
  }

  // Übersteigt die Summe den Topf, wird anteilig gekürzt — nicht abgeschnitten.
  // Abschneiden würde die zuletzt Einsortierten leer ausgehen lassen, und das
  // wären zufällig die, die in der Liste weiter hinten stehen.
  const faktor = summe > opts.poolMsat ? opts.poolMsat / summe : 1;
  const payouts = roh
    .map((r) => ({ ...r, bonusMsat: Math.floor(r.bonusMsat * faktor) }))
    .filter((r) => r.bonusMsat > 0);

  const distributed = payouts.reduce((s, r) => s + r.bonusMsat, 0);
  return { payouts, distributedMsat: distributed, remainingMsat: opts.poolMsat - distributed };
}

/**
 * Für die UI: wo lohnt sich ein neuer Knoten am meisten?
 *
 * Genau die Frage, die ein Interessent stellt — und die zu beantworten
 * wertvoller ist als jede Werbeaussage.
 */
export function whereIsCapacityNeeded(
  stats: Map<Region, RegionStats>,
  opts: ScarcityOptions = {},
): { region: Region; providers: number; multiplier: number; hint: string }[] {
  return ALL_REGIONS.map((region) => {
    const s = stats.get(region);
    const m = scarcityMultiplier(region, stats, opts);
    return {
      region,
      providers: s?.providers ?? 0,
      multiplier: Number(m.toFixed(2)),
      hint:
        (s?.providers ?? 0) === 0
          ? "Noch kein Provider — der erste hier versorgt eine ganze Region."
          : m > 1
            ? `Unterversorgt: ${s!.providers} Provider, Bonus ×${m.toFixed(2)}.`
            : "Ausreichend versorgt.",
    };
  }).sort((a, b) => b.multiplier - a.multiplier || a.providers - b.providers);
}
