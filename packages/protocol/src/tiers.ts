/**
 * Provider-Tiers (free / classic / pro) + Capabilities-Werbung.
 *
 * WICHTIG (Invarianten): Das Tier ist KEIN zentraler Gatekeeper. Es ist ein
 * client-seitiger Filter, der aus oeffentlichen Events berechnet wird:
 *   - Der Provider BEHAUPTET sein Tier + Faehigkeiten (kind 38025, signiert)
 *   - Die Reputation (38010-Leistungs-Events + WoT) BEWEIST es
 * Jeder User kann jeden Provider anfragen; der Client empfiehlt standardmaessig
 * das passende Tier. Niemand wird zentral ausgesperrt.
 *
 * Tier-Regeln (Client-Filter-Empfehlung, nicht Protokoll-Zwang):
 *   free    — neue (Bootstrap) + freiwillige. Kleinste Modelle. 0 sats.
 *   classic — Bootstrap bestanden + Mindest-Reputation. Mittlere Modelle.
 *   pro     — hoher Trust-Score + Uptime + ehrliche Metering. Beste Modelle.
 */
import { UnsignedEvent, buildEvent, getTag, getTags } from "./event.js";
import { KIND_PROVIDER_CAPABILITIES } from "./kinds.js";
import { MAX_POW_BITS } from "./private-job.js";

export type ProviderTier = "free" | "classic" | "pro";

export interface ToolPrice {
  /** DVM-Tool-Kind (z. B. 5060 web_search). */
  kind: number;
  name: string;
  /** Preis in msat pro Call. */
  priceMsat: number;
}

export interface ProviderCapabilities {
  pubkey: string;
  tier: ProviderTier;
  /** Verfuegbare Modelle (z. B. ["qwen2.5:0.5b", "llama3.2:1b"]). */
  models: string[];
  /** Text-Rate in msat pro 1k tokens. */
  textRatePerKTokenMsat: number;
  /** Tool-Preise (leer = nur Text). */
  tools: ToolPrice[];
  /** Ob aktuell gratis (Bootstrap oder freiwillig). */
  currentlyFree: boolean;
  /** Storage-Rolle: dieser Provider seedet Blobs. */
  storage?: { capacityBytes: number; priceMsatPerMB: number; bootstrap: boolean };
  /** Rechenarbeit (NIP-13-Bits), die private Anfragen tragen muessen (Schritt 3.1). */
  powBits?: number;
  /** Gueltig ab (ersetzbar via d-Tag = pubkey). */
  updatedAt: number;
}

export function buildCapabilities(
  c: Omit<ProviderCapabilities, "updatedAt">,
  createdAt = Math.floor(Date.now() / 1000),
): UnsignedEvent {
  const tags: string[][] = [
    ["d", c.pubkey], // adressierbar/ersetzbar pro Provider
    ["tier", c.tier],
    ["text_rate_msat", String(c.textRatePerKTokenMsat)],
    ["free", c.currentlyFree ? "1" : "0"],
  ];
  for (const m of c.models) tags.push(["model", m]);
  for (const t of c.tools) tags.push(["tool", String(t.kind), t.name, String(t.priceMsat)]);
  if (c.storage) {
    tags.push(["storage", String(c.storage.capacityBytes), String(c.storage.priceMsatPerMB), c.storage.bootstrap ? "1" : "0"]);
  }
  if (c.powBits !== undefined) tags.push(["pow", String(c.powBits)]);
  return buildEvent(c.pubkey, KIND_PROVIDER_CAPABILITIES, tags, "", createdAt);
}

export function parseCapabilities(ev: UnsignedEvent): ProviderCapabilities {
  if (ev.kind !== KIND_PROVIDER_CAPABILITIES) throw new Error(`kein Capabilities-Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  const tier = req("tier");
  if (tier !== "free" && tier !== "classic" && tier !== "pro") {
    throw new Error(`ungueltiges tier: ${tier}`);
  }
  const tools: ToolPrice[] = getTags(ev, "tool").map((t) => ({
    kind: Number(t[1]),
    name: t[2] ?? `tool-${t[1]}`,
    priceMsat: Number(t[3] ?? "0"),
  }));
  // Die Speicherangabe wurde geschrieben, aber beim Lesen VERWORFEN. Wer
  // `parseCapabilities` benutzte, um ein Speicherangebot zu pruefen, sah
  // nichts — obwohl es im Event stand. `network-capacity.ts` liest den Tag
  // direkt und war deshalb nie betroffen, was den Fehler verdeckt hat.
  const st = ev.tags.find((t) => t[0] === "storage");
  const storage = st
    ? {
        capacityBytes: Number(st[1] ?? "0"),
        priceMsatPerMB: Number(st[2] ?? "0"),
        bootstrap: st[3] === "1",
      }
    : undefined;

  // Fremde Angabe: nur ganze Zahlen im erlaubten Bereich, sonst keine.
  const powRoh = getTag(ev, "pow");
  const pow = powRoh !== undefined && /^\d{1,2}$/.test(powRoh) ? Number(powRoh) : NaN;
  const powBits = Number.isInteger(pow) && pow >= 0 && pow <= MAX_POW_BITS ? pow : undefined;

  return {
    pubkey: ev.pubkey,
    tier,
    models: getTags(ev, "model").map((t) => t[1]),
    textRatePerKTokenMsat: Number(req("text_rate_msat")),
    tools,
    currentlyFree: getTag(ev, "free") === "1",
    ...(storage && Number.isFinite(storage.capacityBytes) && storage.capacityBytes > 0
      ? { storage }
      : {}),
    ...(powBits !== undefined ? { powBits } : {}),
    updatedAt: ev.created_at,
  };
}

/**
 * Tier-Reihenfolge fuer Filter: pro > classic > free.
 * Ein Client, der "classic" will, akzeptiert classic UND pro (besser ist ok),
 * aber nicht free (zu schwach). "free" akzeptiert alles (Nutzer will gratis,
 * nimmt was da ist).
 */
export function tierSatisfies(offered: ProviderTier, wanted: ProviderTier): boolean {
  const rank = (t: ProviderTier): number => (t === "pro" ? 3 : t === "classic" ? 2 : 1);
  if (wanted === "free") return true; // gratis: jedes Tier ok
  return rank(offered) >= rank(wanted);
}

/**
 * Berechnet das empfohlene Tier aus Reputation (Client-Filter).
 * Nicht zentral erzwungen — nur eine Empfehlung auf Basis oeffentlicher Daten.
 *
 *   pro:     trustScore >= 70 UND >= 50 Jobs UND nicht in Bootstrap
 *   classic: trustScore >= 20 ODER >= 10 Jobs (Bootstrap bestanden)
 *   free:    alles andere (inkl. Bootstrap/neue Provider)
 */
export function recommendedTier(opts: {
  trustScore: number;
  jobsCompleted: number;
  inBootstrap: boolean;
}): ProviderTier {
  if (opts.inBootstrap) return "free";
  if (opts.trustScore >= 70 && opts.jobsCompleted >= 50) return "pro";
  if (opts.trustScore >= 20 || opts.jobsCompleted >= 10) return "classic";
  return "free";
}
