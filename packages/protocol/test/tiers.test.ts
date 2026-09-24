/**
 * Tier- + Capabilities- + Usage-Tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signEvent,
  buildCapabilities,
  parseCapabilities,
  tierSatisfies,
  recommendedTier,
  buildJobResult,
  parseJobResult,
  KIND_DVM_TEXT_GENERATION,
  KIND_DVM_WEB_SEARCH,
  KIND_DVM_IMAGE_GEN,
  KIND_PROVIDER_CAPABILITIES,
} from "../src/index.js";

test("Capabilities: bauen, signieren, parsen (Roundtrip mit Modellen + Tools)", () => {
  const kp = generateKeypair();
  const ev = signEvent(
    buildCapabilities({
      pubkey: kp.pk,
      tier: "classic",
      models: ["qwen2.5-coder:7b", "llama3.1:8b"],
      textRatePerKTokenMsat: 1500,
      tools: [
        { kind: KIND_DVM_WEB_SEARCH, name: "web_search", priceMsat: 2000 },
        { kind: KIND_DVM_IMAGE_GEN, name: "image_gen", priceMsat: 20000 },
      ],
      currentlyFree: false,
    }),
    kp.sk,
  );
  assert.equal(ev.kind, KIND_PROVIDER_CAPABILITIES);
  const c = parseCapabilities(ev);
  assert.equal(c.tier, "classic");
  assert.deepEqual(c.models, ["qwen2.5-coder:7b", "llama3.1:8b"]);
  assert.equal(c.textRatePerKTokenMsat, 1500);
  assert.equal(c.tools.length, 2);
  assert.equal(c.tools[0].name, "web_search");
  assert.equal(c.tools[0].priceMsat, 2000);
  assert.equal(c.currentlyFree, false);
});

test("tierSatisfies: Filter-Logik (pro>classic>free, free akzeptiert alles)", () => {
  // User will classic -> classic+pro ok, free nicht
  assert.ok(tierSatisfies("classic", "classic"));
  assert.ok(tierSatisfies("pro", "classic"));
  assert.ok(!tierSatisfies("free", "classic"));
  // User will pro -> nur pro
  assert.ok(tierSatisfies("pro", "pro"));
  assert.ok(!tierSatisfies("classic", "pro"));
  // User will free -> alles ok
  assert.ok(tierSatisfies("free", "free"));
  assert.ok(tierSatisfies("pro", "free"));
});

test("recommendedTier: aus Reputation berechnet (Client-Empfehlung)", () => {
  assert.equal(recommendedTier({ trustScore: 0, jobsCompleted: 0, inBootstrap: true }), "free");
  assert.equal(recommendedTier({ trustScore: 25, jobsCompleted: 12, inBootstrap: false }), "classic");
  assert.equal(recommendedTier({ trustScore: 80, jobsCompleted: 100, inBootstrap: false }), "pro");
  // pro braucht BEIDE Bedingungen
  assert.equal(recommendedTier({ trustScore: 80, jobsCompleted: 5, inBootstrap: false }), "classic");
  assert.equal(recommendedTier({ trustScore: 5, jobsCompleted: 3, inBootstrap: false }), "free");
});

test("Result mit usage-Tag: Roundtrip (Claude-Stil Kosten-Transparenz)", () => {
  const kp = generateKeypair();
  const ev = signEvent(
    buildJobResult({
      providerPubkey: kp.pk,
      requestId: "req1",
      requestKind: KIND_DVM_TEXT_GENERATION,
      customerPubkey: "cust1",
      output: "antwort",
      amountMsat: 1500,
      usage: {
        model: "qwen2.5-coder:7b",
        promptTokens: 120,
        completionTokens: 800,
        toolCalls: [{ name: "web_search", kind: KIND_DVM_WEB_SEARCH, costMsat: 2000 }],
        sessionTotalMsat: 5500,
      },
    }),
    kp.sk,
  );
  const parsed = parseJobResult(ev);
  assert.ok(parsed.usage, "usage vorhanden");
  assert.equal(parsed.usage!.model, "qwen2.5-coder:7b");
  assert.equal(parsed.usage!.completionTokens, 800);
  assert.equal(parsed.usage!.toolCalls!.length, 1);
  assert.equal(parsed.usage!.toolCalls![0].costMsat, 2000);
  assert.equal(parsed.usage!.sessionTotalMsat, 5500);
});

test("Result ohne usage-Tag: rueckwaertskompatibel", () => {
  const kp = generateKeypair();
  const ev = signEvent(
    buildJobResult({
      providerPubkey: kp.pk,
      requestId: "req2",
      requestKind: KIND_DVM_TEXT_GENERATION,
      customerPubkey: "cust2",
      output: "x",
      amountMsat: 100,
    }),
    kp.sk,
  );
  const parsed = parseJobResult(ev);
  assert.equal(parsed.usage, undefined);
});
