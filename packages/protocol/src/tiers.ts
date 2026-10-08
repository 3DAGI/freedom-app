/**
 * Provider-Tiers (free / classic / pro) + Capabilities-Werbung.
 *
 * WICHTIG (Invarianten): Das Tier ist KEIN zentraler Gatekeeper. Es ist ein
 * client-seitiger Filter, der aus oeffentlichen Events berechnet wird:
 *   - Der Provider BEHAUPTET sein Tier + Faehigkeiten (kind 38025, signiert)
 *   - Belegen kann es nur der Ruf aus Quittungen (5.5, `berechneRuf()`): eigene
 *     und versiegelte Zusammenfassungen von Kontakten. Leistungs-Events (38010)
 *     sind Selbstauskuenfte und zaehlen dafuer nicht.
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
import { adresseFuer } from "./aufteilung.js";
import { gratisTag, leseGratisTag, type GratisAngebot } from "./gratis.js";

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
  /**
   * Kurs, mit dem der Anbieter SOL-Preise rechnet (Schritt 4.4): sats pro SOL
   * und woher er stammt – manuell gesetzt oder Median der Kurs-Events.
   */
  kurs?: { satsProSol: number; quelle: "manuell" | "markt" };
  /**
   * Lightning-Adresse des Providers (5.1): dorthin zahlt die App seinen Anteil
   * eines Auftrags.
   */
  lud16?: string;
  /**
   * Lightning-Adresse seines Werbers (5.1, Gebührenmodell A+): die App des
   * Kunden zahlt ihm 0,5 % direkt. Ohne Angabe bleibt der Anteil beim Provider.
   */
  werber?: string;
  /**
   * SOL-Adresse seines Werbers (12.3, E2 A): bei Zahlungen per Zahlkanal geht
   * der Anteil (0,5 %) dorthin – vom Programm aufgeteilt. Ohne Angabe beim Provider.
   */
  werberSol?: string;
  /**
   * Fassung der Aufteilung, mit der der Knoten rechnet (P5b,
   * `AUFTEILUNG_FASSUNG`). Ohne Angabe 1: Dann deklariert die App weder
   * Entwicklung noch Prüfbudget – beides bleibt beim Provider.
   */
  aufteilung?: number;
  /**
   * Zahlkanal (4.3c): Der Knoten nimmt Gutschriften für Kanäle an, deren
   * Provider diese Solana-Adresse ist, beim genannten Programm. Ohne Angabe
   * zahlt die App nicht über einen Kanal.
   */
  kanal?: { adresse: string; programm: string };
  /**
   * Funk-Gateway (7.4b2): Der Knoten hängt an einem Funkgerät und reicht
   * versiegelte KI-Aufträge aus dem Funk weiter. Wo das Gerät steht, sagt die
   * Angabe nicht – die App wählt es, solange sie Netz hat.
   */
  funkGateway?: boolean;
  /**
   * Gratis-Start (A-14, G1): Budget des Knotens je Tag, Grenze je Antwort und
   * die Rechenarbeit einer Gratis-Anfrage (`gratis.ts`). Ohne Angabe
   * verschenkt er nichts nach dieser Regel.
   */
  gratis?: GratisAngebot;
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
  if (c.kurs) tags.push(["kurs", "SOL/BTC", String(c.kurs.satsProSol), c.kurs.quelle]);
  const lud16 = adresseFuer({ lud16: c.lud16 }, "lightning");
  if (lud16) tags.push(["lud16", lud16]);
  const werber = adresseFuer({ lud16: c.werber }, "lightning");
  if (werber) tags.push(["werber", werber]);
  const werberSol = adresseFuer({ sol: c.werberSol }, "solana");
  if (werberSol) tags.push(["werber_sol", werberSol]);
  if (c.aufteilung !== undefined && Number.isInteger(c.aufteilung) && c.aufteilung > 0) tags.push(["aufteilung", String(c.aufteilung)]);
  const kanal = c.kanal && adresseFuer({ sol: c.kanal.adresse }, "solana") && adresseFuer({ sol: c.kanal.programm }, "solana");
  if (kanal) tags.push(["kanal", c.kanal!.adresse, c.kanal!.programm]);
  if (c.funkGateway) tags.push(["funk", "gateway"]);
  const gratis = c.gratis && gratisTag(c.gratis);
  if (gratis) tags.push(gratis);
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
  // Kurs des Anbieters (4.4): nur eine plausible ganze Zahl und eine bekannte Quelle.
  const kt = ev.tags.find((t) => t[0] === "kurs" && t[1] === "SOL/BTC");
  const kurs = kt && /^\d{1,10}$/.test(kt[2] ?? "") && Number(kt[2]) > 0 && (kt[3] === "manuell" || kt[3] === "markt")
    ? { satsProSol: Number(kt[2]), quelle: kt[3] as "manuell" | "markt" }
    : undefined;
  // Zahladressen (5.1): fremde Angaben – nur plausible Lightning-Adressen
  const lud16 = adresseFuer({ lud16: getTag(ev, "lud16") }, "lightning");
  const werber = adresseFuer({ lud16: getTag(ev, "werber") }, "lightning");
  const werberSol = adresseFuer({ sol: getTag(ev, "werber_sol") }, "solana");
  // Fassung der Aufteilung (P5b): fremde Angabe – nur eine kleine ganze Zahl
  const fassungRoh = getTag(ev, "aufteilung");
  const aufteilung = fassungRoh !== undefined && /^[1-9]\d{0,2}$/.test(fassungRoh) ? Number(fassungRoh) : undefined;
  // Zahlkanal (4.3c): fremde Angabe – nur zwei plausible Solana-Adressen
  const kt2 = ev.tags.find((t) => t[0] === "kanal");
  const kanalAdr = adresseFuer({ sol: kt2?.[1] }, "solana");
  const kanalProg = adresseFuer({ sol: kt2?.[2] }, "solana");
  const kanal = kanalAdr && kanalProg ? { adresse: kanalAdr, programm: kanalProg } : undefined;
  // Gratis-Start (A-14): fremde Angabe – drei ganze Zahlen im Bereich, sonst keine
  const gratis = leseGratisTag(ev.tags);

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
    ...(kurs ? { kurs } : {}),
    ...(lud16 ? { lud16 } : {}),
    ...(werber ? { werber } : {}),
    ...(werberSol ? { werberSol } : {}),
    ...(aufteilung !== undefined ? { aufteilung } : {}),
    ...(kanal ? { kanal } : {}),
    ...(ev.tags.some((t) => t[0] === "funk" && t[1] === "gateway") ? { funkGateway: true } : {}),
    ...(gratis ? { gratis } : {}),
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
 * Nicht zentral erzwungen — nur eine Empfehlung; die App fuettert sie seit 5.5b
 * nur mit dem Ruf aus Quittungen (`berechneRuf()`), nie mit Selbstauskuenften.
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
