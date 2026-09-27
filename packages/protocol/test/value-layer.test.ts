import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, NostrEvent } from "../src/event.js";
import { buildZapRequest, buildZapReceipt, parseZapReceipt, verifyZapPayment, sumZapsByRecipient } from "../src/zap.js";
import { buildJobRequest, buildJobResult, parseJobResult, buildJobFeedback } from "../src/dvm.js";
import { buildPerformanceEvent, parsePerformance } from "../src/performance.js";
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

// ---------------------------------------------------------------- Leistungsnachweis

test("Performance: Selbstbezeugung erzwungen (worker == Autor)", () => {
  const a = generateKeypair(), b = generateKeypair();
  const ev = buildPerformanceEvent({
    workerPubkey: b.pk, workType: "ai_job", units: 1, volumeMsat: 1000,
    chain: "lightning", seasonId: "s1",
  }, 1_700_000_000);
  const signedByA = signEvent(ev, a.sk); // A signiert, behauptet aber B habe gearbeitet
  assert.throws(() => parsePerformance({ ...signedByA, pubkey: a.pk }));
});
