/**
 * Tests fuer das Zwei-Geraete-Pairing.
 *
 * Die Rechnungen hier sind nicht akademisch: an ihnen haengt, ob ein Nutzer
 * am Wochenende ein Modell starten kann oder ob ihm nach 40 Minuten Prefill
 * der Speicher ausgeht. Deshalb pruefen die Tests vor allem die Grenzfaelle,
 * an denen ein zu optimistischer Schaetzer teuer wuerde.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import {
  buildClusterOffer,
  parseClusterOffer,
  modelFitsOnCluster,
  kvCacheGb,
  estimateClusterPerf,
  recommendMode,
  findPairPartners,
  computeReciprocity,
  hoursNeededToRent,
  buildPairedEvent,
  ClusterOffer,
  ModelSpec,
} from "../src/cluster.js";

const SPARK = { memoryGb: 128, memBandwidthGbs: 273, uplinkMbit: 1000 };

const MODELS: Record<string, ModelSpec> = {
  // MoE mit MLA-Cache (DeepSeek-Bauart): Cache winzig, Gewichte gross.
  moe400: { name: "~400B MoE", totalB: 400, activeB: 30, layers: 61, hidden: 7168, mlaDim: 576 },
  moe670: { name: "~670B MoE", totalB: 670, activeB: 37, layers: 61, hidden: 7168, mlaDim: 576 },
  // Dichtes Modell mit GQA: Cache waechst deutlich schneller.
  dense100: { name: "~100B dense", totalB: 100, activeB: 100, layers: 80, hidden: 8192, kvHeads: 8, headDim: 128 },
};

function offer(p: Partial<ClusterOffer> & { pubkey: string }): ClusterOffer {
  return {
    memoryGb: 128, memBandwidthGbs: 273, uplinkMbit: 1000,
    region: "eu-central", rttMs: 10, rateSatsPerHour: 1000,
    availableFrom: 0, availableUntil: 2 ** 31, ...p,
  };
}

// ------------------------------------------------------------- Speicher

test("Passt-Rechnung: ein Spark reicht fuer 400B nicht, zwei schon", () => {
  const einer = modelFitsOnCluster(MODELS.moe400, 32768, [SPARK]);
  const zwei = modelFitsOnCluster(MODELS.moe400, 32768, [SPARK, SPARK]);

  assert.equal(einer.fits, false);
  assert.equal(zwei.fits, true);
  assert.match(einer.reason, /Gewichte.*passen nicht/);
  // Das ist der ganze Sinn des Paars — genau diese Zeile muss stimmen.
});

test("Passt-Rechnung: 670B sprengt zwei Sparks auch bei Q3 — drei sind noetig", () => {
  // Ehrliche Grenze des Paars: 670B x 0,4 Byte = 268 GB gegen 230 GB nutzbar.
  // Auch aggressives Quantisieren rettet das nicht; wer diese Klasse fahren
  // will, braucht ein drittes Geraet. Genau deshalb ist die Empfehlung
  // "Modelle bis ~400B", nicht "alles geht irgendwie".
  assert.equal(modelFitsOnCluster(MODELS.moe670, 8192, [SPARK, SPARK], "q4").fits, false);
  assert.equal(modelFitsOnCluster(MODELS.moe670, 8192, [SPARK, SPARK], "q3").fits, false);
  assert.equal(modelFitsOnCluster(MODELS.moe670, 8192, [SPARK, SPARK, SPARK], "q4").fits, true);

  const r = modelFitsOnCluster(MODELS.moe670, 8192, [SPARK, SPARK], "q3");
  assert.match(r.reason, /Gewichte.*passen nicht/);
});

test("Passt-Rechnung: der KV-Cache ist die Grenze, nicht die Gewichte", () => {
  // Dichtes 100B: Gewichte nur 50 GB, aber GQA-Cache waechst schnell.
  const kurz = modelFitsOnCluster(MODELS.dense100, 8192, [SPARK, SPARK]);
  const lang = modelFitsOnCluster(MODELS.dense100, 1_000_000, [SPARK, SPARK]);

  assert.equal(kurz.fits, true);
  assert.equal(lang.fits, false);
  assert.match(lang.reason, /KV-Cache/);
  assert.ok(lang.maxContextTokens > 100_000, "sechsstellige Kontexte muessen drin sein");
});

test("KV-Cache: MLA ist drastisch sparsamer als GQA", () => {
  const mla = kvCacheGb(MODELS.moe400, 131072);
  const gqa = kvCacheGb(MODELS.dense100, 131072);
  assert.ok(mla < gqa / 4, `MLA ${mla.toFixed(1)} GB vs GQA ${gqa.toFixed(1)} GB`);
});

test("Passt-Rechnung: maxContextTokens ist konsistent mit fits()", () => {
  const r = modelFitsOnCluster(MODELS.moe400, 1024, [SPARK, SPARK]);
  // Genau am errechneten Maximum muss es noch passen, deutlich darueber nicht.
  assert.equal(modelFitsOnCluster(MODELS.moe400, r.maxContextTokens, [SPARK, SPARK]).fits, true);
  assert.equal(modelFitsOnCluster(MODELS.moe400, r.maxContextTokens * 2, [SPARK, SPARK]).fits, false);
});

// ------------------------------------------------------------- Leistung

test("Leistung: Pipeline bringt bei Batch 1 KEINE Beschleunigung", () => {
  const einer = estimateClusterPerf(MODELS.moe400, [SPARK], 1024, "pipeline");
  const zwei = estimateClusterPerf(MODELS.moe400, [SPARK, SPARK], 1024, "pipeline");
  // Beide Knoten arbeiten nacheinander — in Summe dieselbe Byte-Menge.
  assert.ok(Math.abs(einer.tokensPerSec - zwei.tokensPerSec) < 0.01,
    "Pipeline kauft Kapazitaet, nicht Tempo — wer das anders erwartet, plant falsch");
});

test("Leistung: Tensor schlaegt Pipeline bei schneller Verbindung", () => {
  const pipe = estimateClusterPerf(MODELS.moe400, [SPARK, SPARK], 1024, "pipeline");
  const tens = estimateClusterPerf(MODELS.moe400, [SPARK, SPARK], 1024, "tensor", "q4", 200_000);
  assert.ok(tens.tokensPerSec > pipe.tokensPerSec * 1.5, `tensor ${tens.tokensPerSec.toFixed(1)} vs pipeline ${pipe.tokensPerSec.toFixed(1)}`);
});

test("Leistung: bei langsamer Verbindung kippt die Empfehlung auf Pipeline", () => {
  const schnell = recommendMode(MODELS.moe400, 200_000, 273); // Direktlink
  const langsam = recommendMode(MODELS.moe400, 40, 273);      // Heim-Uplink

  assert.equal(schnell.mode, "tensor");
  assert.equal(langsam.mode, "pipeline");
  assert.match(langsam.reason, /zu langsam/);
});

test("Leistung: Prefill-Transfer faellt bei zwei Knoten nur einmal an", () => {
  const ctx = 8192;
  const r = estimateClusterPerf(MODELS.moe400, [SPARK, SPARK], ctx, "pipeline");
  // 8192 x 7168 x 2 Byte ueber 1 Gbit ~ 940 ms. Bei 16 Hops waeren es ~15 s.
  assert.ok(r.prefillTransferMs > 800 && r.prefillTransferMs < 1100,
    `erwartet ~940ms, war ${r.prefillTransferMs.toFixed(0)}ms`);
});

test("Leistung: Warnung, wenn die Synchronisation teurer ist als das Rechnen", () => {
  const langsamerLink = estimateClusterPerf(
    MODELS.moe400,
    [{ memBandwidthGbs: 273, uplinkMbit: 40 }, { memBandwidthGbs: 273, uplinkMbit: 40 }],
    1024, "tensor", "q4", 40,
  );
  assert.match(langsamerLink.note, /Pipeline ist die bessere Wahl|kostet mehr/);
});

// ------------------------------------------------------------- Matching

test("Matching: Partner in derselben Region gewinnt gegen den billigeren fernen", () => {
  const own = offer({ pubkey: "self", rttMs: 10 });
  const matches = findPairPartners(own, [
    offer({ pubkey: "nah", region: "eu-central", rttMs: 12, rateSatsPerHour: 1200 }),
    offer({ pubkey: "fern", region: "ap-southeast", rttMs: 150, rateSatsPerHour: 300 }),
  ]);
  assert.equal(matches[0].partner.pubkey, "nah", "Verbindung schlaegt Preis");
});

test("Matching: schmaler Uplink wird gewarnt, nicht verschwiegen", () => {
  const own = offer({ pubkey: "self" });
  const [m] = findPairPartners(own, [offer({ pubkey: "dsl", uplinkMbit: 40 })]);
  assert.ok(m.warnings.some((w) => /Uplink/.test(w)));
  assert.ok(m.warnings.some((w) => /Prefill/.test(w)));
});

test("Matching: Vertrauensschwelle filtert unbekannte Geraete", () => {
  const own = offer({ pubkey: "self" });
  const trust = new Map([["bekannt", 0.8], ["unbekannt", 0.0]]);
  const matches = findPairPartners(own, [offer({ pubkey: "bekannt" }), offer({ pubkey: "unbekannt" })], {
    trust, minTrust: 0.2,
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].partner.pubkey, "bekannt");
});

test("Matching: Zeitfenster wird eingehalten", () => {
  const own = offer({ pubkey: "self" });
  const wochenende = { from: 1000, until: 2000 };
  const matches = findPairPartners(own, [
    offer({ pubkey: "passt", availableFrom: 900, availableUntil: 2100 }),
    offer({ pubkey: "zu_frueh_weg", availableFrom: 900, availableUntil: 1500 }),
  ], wochenende);
  assert.deepEqual(matches.map((m) => m.partner.pubkey), ["passt"]);
});

test("Matching: sich selbst nie als Partner vorschlagen", () => {
  const own = offer({ pubkey: "self" });
  assert.equal(findPairPartners(own, [own]).length, 0);
});

test("Matching: kombinierter Speicher wird korrekt ausgewiesen", () => {
  const own = offer({ pubkey: "self", memoryGb: 128 });
  const [m] = findPairPartners(own, [offer({ pubkey: "p", memoryGb: 128 })]);
  assert.equal(m.combinedMemoryGb, 256);
});

test("Matching: Reziprozitaet bevorzugt, wer selbst beigetragen hat", () => {
  const own = offer({ pubkey: "self" });
  const recip = new Map([["gibt_viel", 100], ["nimmt_nur", -100]]);
  const matches = findPairPartners(own, [
    offer({ pubkey: "nimmt_nur" }),
    offer({ pubkey: "gibt_viel" }),
  ], { reciprocity: recip });
  assert.equal(matches[0].partner.pubkey, "gibt_viel");
});

// ------------------------------------------------------- Reziprozitaet

test("Reziprozitaet: Woche vermieten deckt Wochenende — aber nicht bei 8h/Tag", () => {
  // Genau die Zahl, an der die Idee haengt: 48h mieten kostet bei 5% Fee
  // gut 50h vermieten. 5 Arbeitstage x 8h reichen NICHT.
  assert.ok(hoursNeededToRent(48) > 50);
  assert.ok(hoursNeededToRent(48) < 51);

  const kp = generateKeypair();
  const knapp = computeReciprocity([
    signEvent(buildPairedEvent(kp.pk, "andere", 40, 1000), kp.sk),
    signEvent(buildPairedEvent("fremd", kp.pk, 48, 1000), kp.sk),
  ]);
  assert.equal(knapp.get(kp.pk)!.selfSustaining, false, "40h decken 48h nicht");

  const reicht = computeReciprocity([
    signEvent(buildPairedEvent(kp.pk, "andere", 60, 1000), kp.sk),
    signEvent(buildPairedEvent("fremd", kp.pk, 48, 1000), kp.sk),
  ]);
  assert.equal(reicht.get(kp.pk)!.selfSustaining, true, "60h decken 48h");
});

test("Reziprozitaet: Bilanz zaehlt beide Seiten korrekt", () => {
  const kp = generateKeypair();
  const bilanz = computeReciprocity([
    signEvent(buildPairedEvent("alice", "bob", 10, 1000), kp.sk),
    signEvent(buildPairedEvent("bob", "alice", 4, 1000), kp.sk),
  ]);
  assert.equal(bilanz.get("alice")!.hoursContributed, 10);
  assert.equal(bilanz.get("alice")!.hoursConsumed, 4);
  assert.equal(bilanz.get("alice")!.balance, 6);
  assert.equal(bilanz.get("bob")!.balance, -6);
});

test("Reziprozitaet: kaputte Ereignisse werden ignoriert statt zu vergiften", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildPairedEvent("a", "b", 5, 100), kp.sk);
  const kaputt = { ...ev, tags: ev.tags.filter((t) => t[0] !== "hours") };
  const bilanz = computeReciprocity([kaputt as typeof ev, ev]);
  assert.equal(bilanz.get("a")!.hoursContributed, 5, "nur das gueltige Ereignis zaehlt");
});

// ------------------------------------------------------------- Events

test("Angebot: Roundtrip build -> parse", () => {
  const o = offer({ pubkey: "a".repeat(64), directLink: true, rateSatsPerHour: 750 });
  const back = parseClusterOffer(buildClusterOffer(o));
  assert.equal(back.memoryGb, 128);
  assert.equal(back.rateSatsPerHour, 750);
  assert.equal(back.directLink, true);
  assert.equal(back.region, "eu-central");
});

test("Angebot: falscher Kind wird abgelehnt", () => {
  const o = offer({ pubkey: "a".repeat(64) });
  const ev = { ...buildClusterOffer(o), kind: 1 };
  assert.throws(() => parseClusterOffer(ev), /kein Cluster-Angebot/);
});
