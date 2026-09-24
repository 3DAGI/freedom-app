import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, NostrEvent } from "../src/event.js";
import { buildZapRequest, buildZapReceipt, parseZapReceipt, verifyZapPayment, sumZapsByRecipient } from "../src/zap.js";
import { buildJobRequest, buildJobResult, parseJobResult, buildJobFeedback } from "../src/dvm.js";
import { computeFeeSplit, accumulatePool, buildLeaderboard, allocateProportional, totalAllocated } from "../src/rewards.js";
import { buildPerformanceEvent, parsePerformance } from "../src/performance.js";
import { buildSwapAttestation } from "../src/nostr-order.js";
import { mineEvent } from "../src/pow.js";
import { generatePreimage, hashlock, toHex } from "../src/htlc.js";
import { KIND_ZAP_REQUEST, KIND_DVM_TEXT_GENERATION, KIND_DVM_TEXT_RESULT } from "../src/kinds.js";

// ---------------------------------------------------------------- Zaps

test("Zap: Request hat flache relays-Liste und p/amount-Tags (NIP-57)", () => {
  const a = generateKeypair(), b = generateKeypair();
  const req = buildZapRequest({
    senderPubkey: a.pk, recipientPubkey: b.pk, amountMsat: 21_000,
    relays: ["wss://r1", "wss://r2"], comment: "danke",
  }, 1_700_000_000);
  assert.equal(req.kind, KIND_ZAP_REQUEST);
  const relaysTag = req.tags.find((t) => t[0] === "relays")!;
  assert.deepEqual(relaysTag, ["relays", "wss://r1", "wss://r2"]);
  assert.equal(req.tags.find((t) => t[0] === "amount")?.[1], "21000");
});

test("Zap: Receipt-Zahlungsbeweis via preimage (gleiche Logik wie HTLC)", () => {
  const zapper = generateKeypair(), recipient = generateKeypair(), sender = generateKeypair();
  const preimage = generatePreimage();
  const H = hashlock(preimage);

  const req = buildZapRequest({
    senderPubkey: sender.pk, recipientPubkey: recipient.pk,
    amountMsat: 50_000, relays: ["wss://r1"],
  }, 1_700_000_000);

  const receipt = buildZapReceipt({
    zapperPubkey: zapper.pk, recipientPubkey: recipient.pk,
    zapRequestJson: JSON.stringify(req), bolt11: "lnbc...",
    preimageHex: toHex(preimage), senderPubkey: sender.pk,
  }, 1_700_000_100);

  const parsed = parseZapReceipt(receipt);
  assert.equal(parsed.amountMsat, 50_000, "Betrag aus eingebettetem Request gelesen");
  assert.ok(verifyZapPayment(parsed, toHex(H)), "korrekte Preimage beweist Zahlung");

  const wrong = toHex(hashlock(generatePreimage()));
  assert.ok(!verifyZapPayment(parsed, wrong), "falscher Hash -> kein Beweis");
});

test("Zap: Summierung pro Empfaenger (Leaderboard-Basis)", () => {
  const z = generateKeypair(), r1 = generateKeypair(), r2 = generateKeypair(), s = generateKeypair();
  const mk = (recipient: string, amount: number, t: number): NostrEvent => {
    const req = buildZapRequest({ senderPubkey: s.pk, recipientPubkey: recipient, amountMsat: amount, relays: ["wss://r"] }, t);
    return signEvent(buildZapReceipt({ zapperPubkey: z.pk, recipientPubkey: recipient, zapRequestJson: JSON.stringify(req), bolt11: "ln" }, t), z.sk);
  };
  const sums = sumZapsByRecipient([mk(r1.pk, 1000, 1), mk(r1.pk, 500, 2), mk(r2.pk, 300, 3)]);
  assert.equal(sums.get(r1.pk), 1500);
  assert.equal(sums.get(r2.pk), 300);
});

// ---------------------------------------------------------------- DVM

test("DVM: Job-Request -> Result mit korrektem Kind-Mapping (+1000)", () => {
  const customer = generateKeypair(), provider = generateKeypair();
  const req = buildJobRequest({ customerPubkey: customer.pk, input: "Uebersetze: hallo", bidMsat: 10_000 }, 1_700_000_000);
  assert.equal(req.kind, KIND_DVM_TEXT_GENERATION);

  const signedReq = signEvent(req, customer.sk);
  const result = buildJobResult({
    providerPubkey: provider.pk, requestId: signedReq.id, requestKind: req.kind,
    customerPubkey: customer.pk, output: "hello", amountMsat: 10_000, bolt11: "lnbc10n",
  }, 1_700_000_050);

  assert.equal(result.kind, KIND_DVM_TEXT_RESULT);
  const parsed = parseJobResult(result);
  assert.equal(parsed.requestId, signedReq.id);
  assert.equal(parsed.output, "hello");
  assert.equal(parsed.amountMsat, 10_000);
  assert.equal(parsed.bolt11, "lnbc10n");
});

test("DVM: Feedback-Event traegt Status", () => {
  const p = generateKeypair(), c = generateKeypair();
  const fb = buildJobFeedback(p.pk, "req1", c.pk, "payment-required", "bitte zahlen", 1_700_000_000);
  assert.equal(fb.kind, 7000);
  assert.equal(fb.tags.find((t) => t[0] === "status")?.[1], "payment-required");
});

// ---------------------------------------------------------------- Fee-Split

test("Fee-Split: Summe bleibt erhalten, non-custodial dreiteilig", () => {
  const s = computeFeeSplit(1_000_000, { totalFeePpm: 30_000, poolSharePercent: 60 }); // 3 % Fee, 60 % davon in Pool
  assert.equal(s.recipientMsat + s.poolMsat + s.protocolMsat, s.totalMsat, "nichts geht verloren");
  assert.equal(s.recipientMsat, 970_000);
  assert.equal(s.poolMsat, 18_000);
  assert.equal(s.protocolMsat, 12_000);
});

test("Fee-Split: lehnt unsinnige Parameter ab", () => {
  assert.throws(() => computeFeeSplit(100, { totalFeePpm: 2_000_000, poolSharePercent: 50 }));
  assert.throws(() => computeFeeSplit(100, { totalFeePpm: 1000, poolSharePercent: 150 }));
  assert.throws(() => computeFeeSplit(-1, { totalFeePpm: 1000, poolSharePercent: 50 }));
});

// ---------------------------------------------------------------- Leaderboard

function perfEvent(kp: { sk: Uint8Array; pk: string }, season: string, units: number, volume: number, t: number, pow = 8): NostrEvent {
  const base = buildPerformanceEvent({
    workerPubkey: kp.pk, workType: "ai_job", units, volumeMsat: volume,
    chain: "lightning", seasonId: season, proofEventId: `proof-${t}`,
  }, t);
  return signEvent(mineEvent(base, pow), kp.sk);
}

test("Performance: Selbstbezeugung erzwungen (worker == Autor)", () => {
  const a = generateKeypair(), b = generateKeypair();
  const ev = buildPerformanceEvent({
    workerPubkey: b.pk, workType: "ai_job", units: 1, volumeMsat: 1000,
    chain: "lightning", seasonId: "s1",
  }, 1_700_000_000);
  const signedByA = signEvent(ev, a.sk); // A signiert, behauptet aber B habe gearbeitet
  assert.throws(() => parsePerformance({ ...signedByA, pubkey: a.pk }));
});

test("Leaderboard: WoT-Gewichtung entwertet Sybils", () => {
  const root = generateKeypair();
  const honest = generateKeypair();
  const sybil1 = generateKeypair();
  const sybil2 = generateKeypair();

  // Root attestiert dem ehrlichen Teilnehmer; Sybils attestieren nur sich gegenseitig.
  const att: NostrEvent[] = [
    signEvent(buildSwapAttestation({ swapId: "s1", counterpartyPubkey: honest.pk, success: true }, root.pk, 1), root.sk),
    signEvent(buildSwapAttestation({ swapId: "s2", counterpartyPubkey: sybil2.pk, success: true }, sybil1.pk, 2), sybil1.sk),
    signEvent(buildSwapAttestation({ swapId: "s3", counterpartyPubkey: sybil1.pk, success: true }, sybil2.pk, 3), sybil2.sk),
  ];

  // Sybils erzeugen VIEL mehr Leistungs-Events als der Ehrliche.
  const perf: NostrEvent[] = [
    perfEvent(honest, "season1", 10, 100_000, 100),
    perfEvent(sybil1, "season1", 100, 1_000_000, 101),
    perfEvent(sybil2, "season1", 100, 1_000_000, 102),
  ];

  const board = buildLeaderboard(perf, att, "season1", {
    pointsPerUnit: { ai_job: 10, message: 1, liquidity: 5, relay: 2 },
    pointsPerKMsat: 1,
    minPowDifficulty: 8,
    wot: { roots: [root.pk], maxDepth: 3, decay: 0.5 },
  });

  assert.equal(board[0].pubkey, honest.pk, "Ehrlicher fuehrt trotz weniger Rohpunkten");
  const sybils = board.filter((e) => e.pubkey === sybil1.pk || e.pubkey === sybil2.pk);
  assert.ok(sybils.every((s) => s.score === 0), "Sybils ohne Vertrauensanker haben Score 0");
  assert.ok(board[0].rawPoints < 1500, "Sybils hatten mehr Rohpunkte");
});

test("Leaderboard: Events ohne ausreichenden PoW werden ignoriert", () => {
  const root = generateKeypair(), w = generateKeypair();
  const att = [signEvent(buildSwapAttestation({ swapId: "s", counterpartyPubkey: w.pk, success: true }, root.pk, 1), root.sk)];
  const weak = signEvent(buildPerformanceEvent({
    workerPubkey: w.pk, workType: "ai_job", units: 999, volumeMsat: 0, chain: "lightning", seasonId: "s1",
  }, 5), w.sk); // ungeminet

  const board = buildLeaderboard([weak], att, "s1", {
    pointsPerUnit: { ai_job: 10 }, pointsPerKMsat: 0, minPowDifficulty: 16,
    wot: { roots: [root.pk] },
  });
  assert.equal(board.length, 0);
});

test("Verteilung: proportional, nie mehr als der Pool", () => {
  const root = generateKeypair(), a = generateKeypair(), b = generateKeypair();
  const att = [
    signEvent(buildSwapAttestation({ swapId: "1", counterpartyPubkey: a.pk, success: true }, root.pk, 1), root.sk),
    signEvent(buildSwapAttestation({ swapId: "2", counterpartyPubkey: b.pk, success: true }, root.pk, 2), root.sk),
  ];
  const perf = [perfEvent(a, "s1", 30, 0, 10), perfEvent(b, "s1", 10, 0, 11)];

  const board = buildLeaderboard(perf, att, "s1", {
    pointsPerUnit: { ai_job: 1 }, pointsPerKMsat: 0, minPowDifficulty: 8,
    wot: { roots: [root.pk] },
  });

  const pool = accumulatePool([computeFeeSplit(1_000_000, { totalFeePpm: 30_000, poolSharePercent: 100 })], "s1", "lightning");
  assert.equal(pool.balanceMsat, 30_000);

  const allocs = allocateProportional(pool, board);
  assert.equal(allocs.length, 2);
  assert.ok(totalAllocated(allocs) <= pool.balanceMsat, "nie mehr als der Pool");
  // a hat 3x so viel geleistet wie b
  const aAlloc = allocs.find((x) => x.pubkey === a.pk)!.amountMsat;
  const bAlloc = allocs.find((x) => x.pubkey === b.pk)!.amountMsat;
  assert.ok(Math.abs(aAlloc / bAlloc - 3) < 0.01);
});
