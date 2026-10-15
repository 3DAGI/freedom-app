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
 * EIN PROVIDER NACH AUSSEN (E9-1, V1 A aus `docs/E9-ENTWURF.md`, freigegeben 08.10.2026)
 * Der Kunde sieht nur den führenden Knoten und zahlt nur ihn – nach A+, wie
 * jede KI-Antwort. Den Partner mietet der führende selbst und bezahlt ihn
 * direkt, außerhalb des Protokolls; er haftet für die Antwort.
 * - Öffentlich ist nur das Angebot „Gerät als Cluster-Hälfte verfügbar“
 *   (Kind 38028 – bis E9-1 lag es auf 38026, dem Kurs-Ticker).
 * - Die Absprache (Modell, Zeitraum, Preis je Stunde) geht nur versiegelt an
 *   den anderen Knoten (innen Kind 25050, `baueClusterAbsprache()`).
 * - Kein öffentliches Paar-Ereignis, keine Bilanz, kein Vorrang aus ihr: Das
 *   alte Paar-Event (38027, das Kind des Provider-Angebots), die
 *   „Reziprozität“ und die Rechnung mit 5 % Protokollgebühr fielen mit E9-1.
 * Betrieben wird ein Paar erst mit zwei Geräten (E9-5).
 */
import { UnsignedEvent, NostrEvent, buildEvent, computeEventId, getTag } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

/** Angebot: „mein Gerät ist in diesem Zeitfenster als Cluster-Hälfte verfügbar" (seit E9-1 eigenes Kind). */
export const KIND_CLUSTER_OFFER = 38028;
/** Absprache zweier Knoten – nur als inneres Event im Umschlag (NIP-59) an den Partner. */
export const KIND_CLUSTER_ABSPRACHE = 25050;

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

/** Fremde Zahlen nur als nicht negative Dezimalzahl (höchstens 12 Stellen vor dem Komma) – sonst NaN. */
const zahl = (roh: string | undefined): number => (roh !== undefined && /^\d{1,12}(\.\d{1,6})?$/.test(roh) ? Number(roh) : NaN);
const REGION = /^[a-z0-9-]{1,32}$/;

/** Ein fremdes Angebot streng lesen – wirft bei allem, was nicht passt (seit E9-1). */
export function parseClusterOffer(ev: UnsignedEvent): ClusterOffer {
  if (ev.kind !== KIND_CLUSTER_OFFER) throw new Error(`kein Cluster-Angebot: kind ${ev.kind}`);
  const win = ev.tags.find((t) => t[0] === "window");
  const o: ClusterOffer = {
    pubkey: ev.pubkey,
    memoryGb: zahl(getTag(ev, "mem_gb")),
    memBandwidthGbs: zahl(getTag(ev, "mem_bw")),
    uplinkMbit: zahl(getTag(ev, "uplink")),
    region: getTag(ev, "region") ?? "",
    rttMs: zahl(getTag(ev, "rtt")),
    rateSatsPerHour: zahl(getTag(ev, "rate")),
    availableFrom: zahl(win?.[1]),
    availableUntil: zahl(win?.[2]),
    directLink: getTag(ev, "direct_link") === "1",
  };
  const zahlen = [o.memoryGb, o.memBandwidthGbs, o.uplinkMbit, o.rttMs, o.rateSatsPerHour, o.availableFrom, o.availableUntil];
  if (!zahlen.every(Number.isFinite)) throw new Error("Cluster-Angebot mit fehlender oder ungültiger Zahl");
  if (!REGION.test(o.region)) throw new Error("Cluster-Angebot ohne gültige Region");
  if (o.availableUntil <= o.availableFrom) throw new Error("Cluster-Angebot mit leerem Zeitfenster");
  return o;
}

// ------------------------------------------------------- Absprache (versiegelt)

export interface ClusterAbsprache {
  /** Modell, das das Paar zusammen rechnet (Name wie im Angebot des führenden Knotens). */
  modell: string;
  /** Unix-Zeit von/bis. */
  von: number;
  bis: number;
  /** Preis je Stunde in sats, den der führende Knoten dem Partner direkt zahlt. */
  satsJeStunde: number;
}

const MODELL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function abspracheOk(a: ClusterAbsprache): boolean {
  return MODELL.test(a.modell) && Number.isSafeInteger(a.von) && Number.isSafeInteger(a.bis) && a.von >= 0 && a.bis > a.von
    && Number.isSafeInteger(a.satsJeStunde) && a.satsJeStunde >= 0;
}

/**
 * Absprache an den anderen Knoten – nur versiegelt (NIP-59), nie offen: Wer bei
 * wem mietet, verrät Geschäftsbeziehungen (B3). `antwortAuf` nennt die
 * Absprache, die damit bestätigt wird.
 */
export async function baueClusterAbsprache(p: { von: Signer; anPk: string; absprache: ClusterAbsprache; antwortAuf?: string; nowSecs?: number }): Promise<{ wrap: NostrEvent; id: string }> {
  if (!HEX64.test(p.anPk)) throw new Error("Partner ungültig");
  if (p.antwortAuf !== undefined && !HEX64.test(p.antwortAuf)) throw new Error("Bezug ungültig");
  if (!abspracheOk(p.absprache)) throw new Error("Absprache ungültig");
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const a = p.absprache;
  const kern: UnsignedEvent = {
    pubkey: p.von.publicKey(), kind: KIND_CLUSTER_ABSPRACHE, created_at: now,
    tags: [["p", p.anPk], ["model", a.modell], ["window", String(a.von), String(a.bis)], ["rate", String(a.satsJeStunde)], ...(p.antwortAuf ? [["e", p.antwortAuf]] : [])],
    content: "",
  };
  const wrap = await giftWrapMitSigner(kern, p.von, p.anPk, { nowSecs: now });
  return { wrap, id: computeEventId(kern) };
}

/** Eine Absprache als Partner öffnen – null, wenn der Umschlag keine gültige ist. */
export async function oeffneClusterAbsprache(wrap: NostrEvent, signer: Signer): Promise<{ von: string; id: string; absprache: ClusterAbsprache; antwortAuf?: string } | null> {
  const r = await giftUnwrapMitSigner(wrap, signer);
  if (!r.ok || !r.inner || r.inner.kind !== KIND_CLUSTER_ABSPRACHE || r.inner.pubkey !== r.senderPubkey) return null;
  const ev = r.inner;
  if (getTag(ev, "p") !== signer.publicKey()) return null;
  const win = ev.tags.find((t) => t[0] === "window");
  const ganz = (x: string | undefined) => (x !== undefined && /^\d{1,15}$/.test(x) ? Number(x) : NaN);
  const absprache: ClusterAbsprache = { modell: getTag(ev, "model") ?? "", von: ganz(win?.[1]), bis: ganz(win?.[2]), satsJeStunde: ganz(getTag(ev, "rate")) };
  if (!abspracheOk(absprache)) return null;
  const e = getTag(ev, "e");
  if (e !== undefined && !HEX64.test(e)) return null;
  return { von: ev.pubkey, id: computeEventId(ev), absprache, ...(e ? { antwortAuf: e } : {}) };
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

    // Score: Verbindung zählt am meisten, dann Vertrauen, dann Preis – nie eine öffentliche Bilanz (E9-1, B3).
    const linkScore = Math.min(1, linkMbit / 1000);
    const rttScore = 1 / (1 + estimatedRttMs / 20);
    const trustScore = opts.trust ? Math.min(1, trust) : 0.5;
    const priceScore = 1 / (1 + c.rateSatsPerHour / 1000);

    const score = linkScore * 0.35 + rttScore * 0.25 + trustScore * 0.25 + priceScore * 0.15;

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
