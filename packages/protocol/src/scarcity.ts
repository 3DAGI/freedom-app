/**
 * Regionen: wo dem Netz Kapazität fehlt.
 *
 * Provider nennen ihre Region selbst, grob und kontinentweit (Tag `region` am
 * Leistungsnachweis 38010) – kein Standortnachweis, keine
 * IP-Geolokalisierung. Daraus zählt die App, wo es wenige Provider gibt, und
 * sagt Interessenten, wo ein neuer Knoten am meisten hilft.
 *
 * Seit 5.1.4 (Gebührenmodell A+) ohne Knappheitsbonus: Es gibt keinen Topf
 * mehr, aus dem er gezahlt würde. Anreize für Randregionen kommen über
 * gesponserte Pools mit offenen Regeln (5.1b).
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
  /** Zeitfenster in Sekunden (Default 7 Tage). */
  windowSeconds?: number;
}

const DEFAULT_TARGET = 5;

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
 * Für die UI: wo lohnt sich ein neuer Knoten am meisten?
 *
 * Genau die Frage, die ein Interessent stellt — und die zu beantworten
 * wertvoller ist als jede Werbeaussage.
 */
export function whereIsCapacityNeeded(
  stats: Map<Region, RegionStats>,
  opts: ScarcityOptions = {},
): { region: Region; providers: number; fehlen: number; hint: string }[] {
  const target = opts.targetProvidersPerRegion ?? DEFAULT_TARGET;
  return ALL_REGIONS.map((region) => {
    const providers = stats.get(region)?.providers ?? 0;
    const fehlen = Math.max(0, target - providers);
    return {
      region,
      providers,
      fehlen,
      hint:
        providers === 0
          ? "Noch kein Provider — der erste hier versorgt eine ganze Region."
          : fehlen > 0
            ? `Unterversorgt: ${providers} Provider, ${fehlen} fehlen bis ${target}.`
            : "Ausreichend versorgt.",
    };
  }).sort((a, b) => b.fehlen - a.fehlen || a.providers - b.providers);
}
