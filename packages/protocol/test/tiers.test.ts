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
  AUFTEILUNG_FASSUNG,
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

test("Capabilities (4.3c): Kanal-Annahme mit Solana-Adresse und Programm; Unsinn fällt weg", () => {
  const kp = generateKeypair();
  const basis = { pubkey: kp.pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false };
  const kanal = { adresse: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", programm: "7tukwiJ8cKiWPmkhH2seJycWebHuZy1XLXEZYAMLB5Dj" };
  const mit = signEvent(buildCapabilities({ ...basis, kanal }), kp.sk);
  assert.deepEqual(mit.tags.find((t) => t[0] === "kanal"), ["kanal", kanal.adresse, kanal.programm]);
  assert.deepEqual(parseCapabilities(mit).kanal, kanal);
  assert.equal(parseCapabilities(signEvent(buildCapabilities(basis), kp.sk)).kanal, undefined, "ohne Angabe kein Kanal");
  assert.equal(buildCapabilities({ ...basis, kanal: { adresse: "kaputt", programm: kanal.programm } }).tags.some((t) => t[0] === "kanal"), false);
  const fremd = signEvent({ ...buildCapabilities(basis), tags: [...buildCapabilities(basis).tags, ["kanal", kanal.adresse, "<script>"]] }, kp.sk);
  assert.equal(parseCapabilities(fremd).kanal, undefined, "fremde Angabe nur mit zwei gültigen Adressen");
});

test("Capabilities (P5b): Fassung der Aufteilung im Angebot; ohne Angabe keine, Unsinn fällt weg", () => {
  const kp = generateKeypair();
  const basis = { pubkey: kp.pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false };
  const mit = signEvent(buildCapabilities({ ...basis, aufteilung: AUFTEILUNG_FASSUNG }), kp.sk);
  assert.deepEqual(mit.tags.find((t) => t[0] === "aufteilung"), ["aufteilung", "2"]);
  assert.equal(parseCapabilities(mit).aufteilung, 2);
  assert.equal(parseCapabilities(signEvent(buildCapabilities(basis), kp.sk)).aufteilung, undefined, "ältere Knoten: keine Angabe");
  assert.equal(buildCapabilities({ ...basis, aufteilung: 0 }).tags.some((t) => t[0] === "aufteilung"), false);
  for (const roh of ["0", "-2", "2.5", "abc", "1000", ""]) {
    const fremd = signEvent({ ...buildCapabilities(basis), tags: [...buildCapabilities(basis).tags, ["aufteilung", roh]] }, kp.sk);
    assert.equal(parseCapabilities(fremd).aufteilung, undefined, `fremde Angabe ${JSON.stringify(roh)}`);
  }
});
