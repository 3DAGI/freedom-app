/**
 * Cluster-Pairing: zwei Geräte werden für die Dauer eines Jobs zu einem.
 *
 * WARUM GENAU ZWEI
 * Die WAN-Sharding-Studie hat gezeigt, dass Modell-Sharding nicht am Rechnen
 * scheitert, sondern am Prefill-Transfer PRO HOP. Bei 16 Stages fällt der
 * 16-mal an (8k Kontext über 1 Gbit: ~15 s allein für Transport). Bei zwei
 * Knoten fällt er genau einmal an — 0,94 s bei 8k, 4,7 ms wenn die Geräte
 * direkt verbunden sind. Das ist der Unterschied zwischen unbrauchbar und
 * unauffällig, und er ist der ganze Grund, warum K=2 funktioniert und K=16
 * nicht. Deshalb erlaubt dieses Modul bewusst KEINE beliebige Clustergröße.
 *
 * WAS DAS ERMÖGLICHT
 * Zwei Geräte mit je 128 GB halten zusammen Modelle bis ~400B (MoE, Q4) mit
 * vollem Kontext — allein schafft keines davon eines. Für den Betreiber heißt
 * das: unter der Woche vermieten, am Wochenende ein zweites dazumieten und mit
 * doppelter Kapazität arbeiten.
 *
 * KEIN NEUER TOKEN
 * Die Reziprozitäts-Rechnung unten ist eine ANSICHT auf bereits existierende,
 * signierte Ereignisse — keine Währung, kein Guthaben, das jemand verwahrt.
 * Wer mehr beigetragen als verbraucht hat, bekommt Vorrang beim Matching.
 * Bezahlt wird weiterhin in sats, non-custodial, an der Quelle gesplittet.
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag } from "./event.js";

/** Angebot: „mein Gerät ist in diesem Zeitfenster als Cluster-Hälfte verfügbar". */
export const KIND_CLUSTER_OFFER = 38026;
/** Zwei Geräte erklären sich für einen Zeitraum als Paar. */
export const KIND_CLUSTER_PAIRED = 38027;

export interface ClusterOffer {
  pubkey: string;
  /** Nutzbarer Speicher in GB (Unified/VRAM, abzüglich System). */
  memoryGb: number;
  /** Speicherbandbreite in GB/s — bestimmt die Token-Rate. */
  memBandwidthGbs: number;
  /** Uplink in Mbit/s — bestimmt, ob langer Kontext machbar ist. */
  uplinkMbit: number;
  /** Grobe Region für die Laufzeit-Abschätzung (z.B. "eu-central"). */
  region: string;
  /** Gemessene Umlaufzeit zu einem gemeinsamen Referenzpunkt, in ms. */
  rttMs: number;
  /** Preis pro Stunde in sats. */
  rateSatsPerHour: number;
  /** Unix-Zeit, ab wann verfügbar. */
  availableFrom: number;
  /** Unix-Zeit, bis wann. */
  availableUntil: number;
  /** Direkte Hochgeschwindigkeitsverbindung vorhanden (z.B. 200G-Link)? */
  directLink?: boolean;
}

export function buildClusterOffer(o: ClusterOffer, createdAt?: number): UnsignedEvent {
  return buildEvent(
    o.pubkey,
    KIND_CLUSTER_OFFER,
    [
      ["d", `cluster:${o.region}`],
      ["mem_gb", String(o.memoryGb)],
      ["mem_bw", String(o.memBandwidthGbs)],
      ["uplink", String(o.uplinkMbit)],
      ["region", o.region],
      ["rtt", String(o.rttMs)],
      ["rate", String(o.rateSatsPerHour)],
      ["window", String(o.availableFrom), String(o.availableUntil)],
      ...(o.directLink ? [["direct_link", "1"]] : []),
    ],
    "",
    createdAt,
  );
}

export function parseClusterOffer(ev: UnsignedEvent): ClusterOffer {
  if (ev.kind !== KIND_CLUSTER_OFFER) throw new Error(`kein Cluster-Angebot: kind ${ev.kind}`);
  const win = ev.tags.find((t) => t[0] === "window");
  const num = (tag: string): number => Number(getTag(ev, tag) ?? "NaN");
  const o: ClusterOffer = {
    pubkey: ev.pubkey,
    memoryGb: num("mem_gb"),
    memBandwidthGbs: num("mem_bw"),
    uplinkMbit: num("uplink"),
    region: getTag(ev, "region") ?? "",
    rttMs: num("rtt"),
    rateSatsPerHour: num("rate"),
    availableFrom: Number(win?.[1] ?? 0),
    availableUntil: Number(win?.[2] ?? 0),
    directLink: getTag(ev, "direct_link") === "1",
  };
  if (!Number.isFinite(o.memoryGb) || !Number.isFinite(o.rateSatsPerHour)) {
    throw new Error("Cluster-Angebot ohne mem_gb/rate");
  }
  return o;
}

// ------------------------------------------------------- Modell-Machbarkeit

export interface ModelSpec {
  name: string;
  /** Gesamtparameter in Milliarden (bestimmt den Speicherbedarf). */
  totalB: number;
  /** Aktive Parameter pro Token (bei MoE deutlich kleiner). */
  activeB: number;
  layers: number;
  hidden: number;
  /** GQA: Anzahl KV-Köpfe und Kopfdimension. */
  kvHeads?: number;
  headDim?: number;
  /** MLA (DeepSeek-Linie): komprimierte Cache-Dimension statt kvHeads/headDim. */
  mlaDim?: number;
}

export type Quant = "fp8" | "q4" | "q3";
const BYTES_PER_PARAM: Record<Quant, number> = { fp8: 1.0, q4: 0.5, q3: 0.4 };

/**
 * KV-Cache-Bedarf in GB.
 *
 * Das ist die Größe, die „volles Kontextlimit" tatsächlich kostet — nicht die
 * Gewichte. Sie wächst linear mit dem Kontext, weshalb ein Modell bei 8k
 * bequem passt und bei 256k nicht mehr.
 */
export function kvCacheGb(m: ModelSpec, contextTokens: number, bytesPer = 2): number {
  if (m.mlaDim) return (contextTokens * m.layers * m.mlaDim * bytesPer) / 1e9;
  const kvHeads = m.kvHeads ?? 8;
  const headDim = m.headDim ?? 128;
  return (2 * contextTokens * m.layers * kvHeads * headDim * bytesPer) / 1e9;
}

export interface FitResult {
  fits: boolean;
  weightsGb: number;
  kvGb: number;
  totalGb: number;
  availableGb: number;
  /** Größter Kontext, der bei diesen Geräten noch hineinpasst. */
  maxContextTokens: number;
  reason: string;
}

/**
 * Passt ein Modell mit gewünschtem Kontext auf N Geräte?
 *
 * `overhead` reserviert Platz für Aktivierungen, Fragmentierung und das
 * Betriebssystem. 0,90 ist erfahrungsgemäß knapp, aber nicht unrealistisch.
 */
export function modelFitsOnCluster(
  m: ModelSpec,
  contextTokens: number,
  devices: { memoryGb: number }[],
  quant: Quant = "q4",
  overhead = 0.9,
): FitResult {
  const availableGb = devices.reduce((s, d) => s + d.memoryGb, 0) * overhead;
  const weightsGb = m.totalB * BYTES_PER_PARAM[quant];
  const kvGb = kvCacheGb(m, contextTokens);
  const totalGb = weightsGb + kvGb;

  // Maximaler Kontext = was nach den Gewichten übrig bleibt.
  const kvPerToken = kvCacheGb(m, 1);
  const maxContextTokens = kvPerToken > 0 ? Math.max(0, Math.floor((availableGb - weightsGb) / kvPerToken)) : 0;

  let reason: string;
  if (weightsGb > availableGb) {
    const need = Math.ceil(weightsGb / (devices[0]?.memoryGb ?? 1) / overhead);
    reason = `Schon die Gewichte (${weightsGb.toFixed(0)} GB) passen nicht in ${availableGb.toFixed(0)} GB. Nötig wären ~${need} Geräte oder stärkere Quantisierung.`;
  } else if (totalGb > availableGb) {
    reason = `Gewichte passen, aber der KV-Cache für ${contextTokens.toLocaleString()} Tokens (${kvGb.toFixed(0)} GB) sprengt es. Maximal möglich: ~${maxContextTokens.toLocaleString()} Tokens.`;
  } else {
    reason = `Passt: ${weightsGb.toFixed(0)} GB Gewichte + ${kvGb.toFixed(0)} GB Cache von ${availableGb.toFixed(0)} GB. Reserve für bis zu ~${maxContextTokens.toLocaleString()} Tokens.`;
  }
  return { fits: totalGb <= availableGb, weightsGb, kvGb, totalGb, availableGb, maxContextTokens, reason };
}

// ----------------------------------------------------------- Leistung

export type ParallelMode = "pipeline" | "tensor";

export interface PerfEstimate {
  mode: ParallelMode;
  tokensPerSec: number;
  prefillTransferMs: number;
  ttftEstimateMs: number;
  note: string;
}

/**
 * Schätzt die Leistung eines Paars.
 *
 * Der wichtige, oft übersehene Punkt: Pipeline-Parallelismus bringt bei
 * Batch 1 KEINE Beschleunigung. Beide Knoten arbeiten nacheinander an
 * verschiedenen Schichten, in Summe wird dieselbe Byte-Menge gelesen wie auf
 * einem hypothetischen Einzelgerät mit genug Speicher. Pipeline kauft
 * Kapazität, nicht Tempo. Tensor-Parallelismus teilt dieselbe Schicht auf
 * beide Geräte und verdoppelt damit die effektive Speicherbandbreite — kostet
 * dafür pro Schicht eine Synchronisation über die Verbindung.
 */
export function estimateClusterPerf(
  m: ModelSpec,
  devices: { memBandwidthGbs: number; uplinkMbit: number }[],
  contextTokens: number,
  mode: ParallelMode = "tensor",
  quant: Quant = "q4",
  linkMbit?: number,
): PerfEstimate {
  const activeGb = m.activeB * BYTES_PER_PARAM[quant];
  const n = devices.length;
  const minBw = Math.min(...devices.map((d) => d.memBandwidthGbs));

  let computeMs: number;
  let syncMs = 0;
  if (mode === "pipeline") {
    computeMs = (activeGb / minBw) * 1000;
  } else {
    computeMs = (activeGb / (minBw * n)) * 1000;
    // Zwei All-Reduces pro Schicht über die Verbindung zwischen den Knoten.
    const link = linkMbit ?? Math.min(...devices.map((d) => d.uplinkMbit));
    const payloadBytes = 2 * m.hidden * 2 * m.layers;
    syncMs = (payloadBytes / ((link * 1e6) / 8)) * 1000;
  }

  const perTokenMs = computeMs + syncMs;
  const link = linkMbit ?? Math.min(...devices.map((d) => d.uplinkMbit));
  const prefillTransferMs = ((contextTokens * m.hidden * 2) / ((link * 1e6) / 8)) * 1000;
  // Prefill rechnet grob so lange wie ein paar hundert Decode-Schritte.
  const ttftEstimateMs = prefillTransferMs + perTokenMs * Math.max(1, contextTokens / 16);

  let note: string;
  if (mode === "tensor" && syncMs > computeMs) {
    note =
      `Die Synchronisation (${syncMs.toFixed(0)} ms/Token) kostet mehr als das Rechnen ` +
      `(${computeMs.toFixed(0)} ms). Bei dieser Verbindung ist Pipeline die bessere Wahl.`;
  } else if (mode === "tensor") {
    note = `Tensor-Parallelismus lohnt: Synchronisation ${syncMs.toFixed(1)} ms gegen ${computeMs.toFixed(0)} ms Rechenzeit.`;
  } else {
    note = "Pipeline: verdoppelt den Speicher, nicht das Tempo. Sinnvoll, wenn die Verbindung für Tensor zu langsam ist.";
  }

  return { mode, tokensPerSec: 1000 / perTokenMs, prefillTransferMs, ttftEstimateMs, note };
}

/** Empfiehlt den Parallelismus-Modus für eine gegebene Verbindung. */
export function recommendMode(m: ModelSpec, linkMbit: number, memBandwidthGbs: number, quant: Quant = "q4"): {
  mode: ParallelMode;
  reason: string;
} {
  const devices = [
    { memBandwidthGbs, uplinkMbit: linkMbit },
    { memBandwidthGbs, uplinkMbit: linkMbit },
  ];
  const t = estimateClusterPerf(m, devices, 1, "tensor", quant, linkMbit);
  const p = estimateClusterPerf(m, devices, 1, "pipeline", quant, linkMbit);
  return t.tokensPerSec > p.tokensPerSec
    ? { mode: "tensor", reason: `Tensor ist ${(t.tokensPerSec / p.tokensPerSec).toFixed(1)}× schneller bei dieser Verbindung.` }
    : { mode: "pipeline", reason: `Die Verbindung (${linkMbit} Mbit) ist zu langsam für Tensor — Pipeline liefert mehr.` };
}

// ------------------------------------------------------------- Matching

export interface PairMatch {
  partner: ClusterOffer;
  score: number;
  combinedMemoryGb: number;
  estimatedRttMs: number;
  costSatsPerHour: number;
  warnings: string[];
}

export interface MatchOptions {
  /** Vertrauenswerte aus wot.ts — ohne Vertrauen kein Paar. */
  trust?: Map<string, number>;
  minTrust?: number;
  /** Reziprozität: wer mehr beigetragen hat, bekommt Vorrang. */
  reciprocity?: Map<string, number>;
  /** Gewünschtes Zeitfenster. */
  from?: number;
  until?: number;
  maxRttMs?: number;
  maxSatsPerHour?: number;
}

/**
 * Findet Partner für ein Zwei-Geräte-Paar.
 *
 * Sortiert bewusst nicht nur nach Preis: ein billiger Partner mit 300 ms RTT
 * und schwachem Uplink macht das Paar für lange Kontexte unbrauchbar. Die
 * Verbindung ist das Bauteil, an dem dieses Konstrukt steht oder fällt.
 */
export function findPairPartners(
  own: ClusterOffer,
  candidates: ClusterOffer[],
  opts: MatchOptions = {},
): PairMatch[] {
  const minTrust = opts.minTrust ?? 0;
  const out: PairMatch[] = [];

  for (const c of candidates) {
    if (c.pubkey === own.pubkey) continue;

    const warnings: string[] = [];
    const trust = opts.trust?.get(c.pubkey) ?? 0;
    if (opts.trust && trust < minTrust) continue;

    if (opts.from !== undefined && opts.until !== undefined) {
      if (c.availableFrom > opts.from || c.availableUntil < opts.until) continue;
    }
    if (opts.maxSatsPerHour !== undefined && c.rateSatsPerHour > opts.maxSatsPerHour) continue;

    // RTT zwischen beiden: gleiche Region ≈ Differenz, sonst Summe (beide
    // messen zu einem Referenzpunkt, quer über Regionen addiert es sich).
    const estimatedRttMs =
      c.region === own.region
        ? Math.max(1, Math.abs(c.rttMs - own.rttMs))
        : c.rttMs + own.rttMs;
    if (opts.maxRttMs !== undefined && estimatedRttMs > opts.maxRttMs) continue;

    const linkMbit = Math.min(own.uplinkMbit, c.uplinkMbit);
    if (linkMbit < 100) {
      warnings.push(
        `Schmalster Uplink ${linkMbit} Mbit — bei langem Kontext dominiert der Prefill-Transfer.`,
      );
    }
    if (estimatedRttMs > 50) {
      warnings.push(`RTT ~${estimatedRttMs.toFixed(0)} ms — Tensor-Parallelismus lohnt hier nicht mehr.`);
    }
    if (c.memBandwidthGbs < own.memBandwidthGbs * 0.7) {
      warnings.push("Partner ist deutlich langsamer — das Paar läuft im Takt des Langsameren.");
    }

    // Score: Verbindung zählt am meisten, dann Vertrauen, dann Preis.
    const linkScore = Math.min(1, linkMbit / 1000);
    const rttScore = 1 / (1 + estimatedRttMs / 20);
    const trustScore = opts.trust ? Math.min(1, trust) : 0.5;
    const recip = opts.reciprocity?.get(c.pubkey) ?? 0;
    const recipScore = 1 / (1 + Math.exp(-recip / 10)); // sanft, kein Schwellwert
    const priceScore = 1 / (1 + c.rateSatsPerHour / 1000);

    const score =
      linkScore * 0.3 + rttScore * 0.25 + trustScore * 0.25 + recipScore * 0.1 + priceScore * 0.1;

    out.push({
      partner: c,
      score,
      combinedMemoryGb: own.memoryGb + c.memoryGb,
      estimatedRttMs,
      costSatsPerHour: c.rateSatsPerHour,
      warnings,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

// --------------------------------------------------------- Reziprozität

export interface ReciprocityEntry {
  pubkey: string;
  /** Stunden, die dieses Gerät anderen zur Verfügung gestellt hat. */
  hoursContributed: number;
  /** Stunden, die es von anderen bezogen hat. */
  hoursConsumed: number;
  /** Positiv = mehr gegeben als genommen. */
  balance: number;
  /** Deckt der Beitrag den Bezug nach Abzug der Protokollfee? */
  selfSustaining: boolean;
}

/**
 * Reziprozitäts-Bilanz aus signierten Paar-Ereignissen.
 *
 * Ausdrücklich KEINE Währung: hier entsteht kein Guthaben, das jemand
 * verwahrt oder das übertragbar wäre. Es ist eine Auswertung dessen, was
 * ohnehin öffentlich signiert auf den Relays liegt, und dient allein der
 * Reihenfolge beim Matching. Bezahlt wird in sats.
 */
export function computeReciprocity(pairEvents: NostrEvent[], feePercent = 5): Map<string, ReciprocityEntry> {
  const acc = new Map<string, { given: number; taken: number }>();
  const bump = (pk: string, given: number, taken: number): void => {
    const e = acc.get(pk) ?? { given: 0, taken: 0 };
    e.given += given;
    e.taken += taken;
    acc.set(pk, e);
  };

  for (const ev of pairEvents) {
    if (ev.kind !== KIND_CLUSTER_PAIRED) continue;
    const provider = getTag(ev, "provider");
    const renter = getTag(ev, "renter");
    const hours = Number(getTag(ev, "hours") ?? "0");
    if (!provider || !renter || !Number.isFinite(hours) || hours <= 0) continue;
    bump(provider, hours, 0);
    bump(renter, 0, hours);
  }

  const out = new Map<string, ReciprocityEntry>();
  for (const [pubkey, e] of acc) {
    // Wer N Stunden beziehen will, muss N/(1-fee) Stunden beitragen — die
    // Protokollfee fällt auf der Verdienstseite an, nicht auf der Ausgabenseite.
    const needed = e.taken / (1 - feePercent / 100);
    out.set(pubkey, {
      pubkey,
      hoursContributed: e.given,
      hoursConsumed: e.taken,
      balance: e.given - e.taken,
      selfSustaining: e.given >= needed,
    });
  }
  return out;
}

/** Wie viele Stunden muss man vermieten, um N Stunden zu mieten? */
export function hoursNeededToRent(hoursWanted: number, feePercent = 5): number {
  return hoursWanted / (1 - feePercent / 100);
}

export function buildPairedEvent(
  providerPubkey: string,
  renterPubkey: string,
  hours: number,
  ratesSatsPerHour: number,
  createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    providerPubkey,
    KIND_CLUSTER_PAIRED,
    [
      ["d", `pair:${renterPubkey}:${createdAt ?? Math.floor(Date.now() / 1000)}`],
      ["provider", providerPubkey],
      ["renter", renterPubkey],
      ["hours", String(hours)],
      ["rate", String(ratesSatsPerHour)],
      ["p", renterPubkey],
    ],
    "",
    createdAt,
  );
}
