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
  baueClusterAbsprache,
  oeffneClusterAbsprache,
  KIND_CLUSTER_OFFER,
  KIND_CLUSTER_ABSPRACHE,
  ClusterOffer,
  ModelSpec,
} from "../src/cluster.js";
import { KIND_PRICE_TICKER, KIND_PROVIDER_CAPABILITIES } from "../src/kinds.js";
import { LocalSigner } from "../src/signer.js";
import { giftUnwrapMitSigner } from "../src/gift-wrap.js";

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

// Seit E9-1 gibt es keine Bilanz und keinen Vorrang aus ihr (B3) – und keine 5 % Protokollgebühr (B2).

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

test("E9-1: eigenes Kind 38028 – nicht mehr Kurs-Ticker (38026) oder Provider-Angebot (38027)", () => {
  assert.equal(KIND_CLUSTER_OFFER, 38028);
  assert.notEqual(KIND_CLUSTER_OFFER, KIND_PRICE_TICKER);
  assert.notEqual(KIND_CLUSTER_OFFER, KIND_PROVIDER_CAPABILITIES);
  assert.equal(buildClusterOffer(offer({ pubkey: "a".repeat(64) })).kind, 38028);
});

test("E9-1: fremde Angebote streng gelesen – kaputte Zahlen, Region oder Zeitfenster werfen", () => {
  const ev = buildClusterOffer(offer({ pubkey: "a".repeat(64), availableFrom: 100, availableUntil: 200 }));
  const mit = (name: string, ...werte: string[]) => ({ ...ev, tags: ev.tags.map((t) => (t[0] === name ? [name, ...werte] : t)) });
  for (const [name, ...werte] of [["mem_gb", "-1"], ["mem_gb", "1e3"], ["rate", "NaN"], ["rate", ""], ["rtt", "0x10"], ["window", "200", "100"], ["window", "100"], ["region", "EU Central"], ["region", "x".repeat(33)]]) {
    assert.throws(() => parseClusterOffer(mit(name!, ...werte)), /Cluster-Angebot/, `${name}=${werte.join(",")}`);
  }
  assert.equal(parseClusterOffer(mit("mem_gb", "127.5")).memoryGb, 127.5);
});

test("E9-1: die Absprache geht nur versiegelt an den Partner und wird streng gelesen", async () => {
  const fuehrend = new LocalSigner(generateKeypair().sk), partner = new LocalSigner(generateKeypair().sk), fremd = new LocalSigner(generateKeypair().sk);
  const absprache = { modell: "deepseek-v3:671b-q4", von: 1_800_000_000, bis: 1_800_172_800, satsJeStunde: 900 };
  const { wrap, id } = await baueClusterAbsprache({ von: fuehrend, anPk: partner.publicKey(), absprache, nowSecs: 1_800_000_000 });
  assert.equal(wrap.kind, 1059, "nur der Umschlag geht hinaus");
  assert.deepEqual(wrap.tags, [["p", partner.publicKey()]], "offen steht nur der Empfänger – kein Modell, kein Preis, kein Absender");
  const offen = await oeffneClusterAbsprache(wrap, partner);
  assert.deepEqual(offen, { von: fuehrend.publicKey(), id, absprache });
  assert.equal(await oeffneClusterAbsprache(wrap, fremd), null, "nur der Partner liest sie");
  // Bestätigung mit Bezug
  const zurueck = await baueClusterAbsprache({ von: partner, anPk: fuehrend.publicKey(), absprache, antwortAuf: id });
  assert.equal((await oeffneClusterAbsprache(zurueck.wrap, fuehrend))!.antwortAuf, id);
  // Unbrauchbares wird nie gebaut
  for (const a of [{ ...absprache, bis: absprache.von }, { ...absprache, satsJeStunde: -1 }, { ...absprache, modell: "<b>" }]) {
    await assert.rejects(baueClusterAbsprache({ von: fuehrend, anPk: partner.publicKey(), absprache: a }), /Absprache ungültig/);
  }
  await assert.rejects(baueClusterAbsprache({ von: fuehrend, anPk: "x", absprache }), /Partner ungültig/);
  const innen = await giftUnwrapMitSigner(wrap, partner);
  assert.equal(innen.ok && innen.inner!.kind, KIND_CLUSTER_ABSPRACHE);
});
