/**
 * A-14a (G1, MENSCH 08.10.2026): Gratis-Angebot im Tag `gratis`.
 *
 * Beweist:
 *  - Vorgabe wie entschieden: 100 000 Tokens am Tag, 2 000 je Antwort, 16 Bit
 *  - Tag hin und zurück, auch über das Angebot (38027)
 *  - fremde Angaben streng: Unsinn, Kommazahlen, Null, zu viel Rechenarbeit → keine Angabe
 *  - Umgebung des Knotens: leer = Vorgabe, 0 = aus, Unbrauchbares ergibt einen Grund
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRATIS_VORGABE, MAX_POW_BITS, buildCapabilities, generateKeypair, gratisAusUmgebung, gratisTag,
  leseGratisTag, parseCapabilities, signEvent,
} from "../src/index.js";

test("gratis: Vorgabe wie in G1 entschieden", () => {
  assert.deepEqual({ ...GRATIS_VORGABE }, { tokensProTag: 100_000, tokensJeAntwort: 2_000, powBits: 16 });
  assert.ok(Object.isFrozen(GRATIS_VORGABE));
});

test("gratis: Tag hin und zurück, auch im Angebot", () => {
  const tag = gratisTag(GRATIS_VORGABE)!;
  assert.deepEqual(tag, ["gratis", "100000", "2000", "16"]);
  assert.deepEqual(leseGratisTag([tag]), { ...GRATIS_VORGABE });

  const kp = generateKeypair();
  const basis = { pubkey: kp.pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: true };
  const mit = parseCapabilities(signEvent(buildCapabilities({ ...basis, gratis: { tokensProTag: 5000, tokensJeAntwort: 300, powBits: 12 } }), kp.sk));
  assert.deepEqual(mit.gratis, { tokensProTag: 5000, tokensJeAntwort: 300, powBits: 12 });
  const ohne = parseCapabilities(signEvent(buildCapabilities(basis), kp.sk));
  assert.equal(ohne.gratis, undefined, "ohne Angabe verschenkt der Knoten nichts nach dieser Regel");
  // Unbrauchbare Werte schreibt der Knoten gar nicht erst
  const kaputt = signEvent(buildCapabilities({ ...basis, gratis: { tokensProTag: 0, tokensJeAntwort: 300, powBits: 12 } }), kp.sk);
  assert.ok(!kaputt.tags.some((t) => t[0] === "gratis"));
});

test("gratis: fremde Angaben streng gelesen", () => {
  const faelle: string[][] = [
    ["gratis"],
    ["gratis", "100000", "2000"],
    ["gratis", "abc", "2000", "16"],
    ["gratis", "1e5", "2000", "16"],
    ["gratis", "100000.5", "2000", "16"],
    ["gratis", "-1", "2000", "16"],
    ["gratis", "0", "2000", "16"],
    ["gratis", "100000", "0", "16"],
    ["gratis", "100000", "2000", String(MAX_POW_BITS + 1)],
    ["gratis", "99999999999", "2000", "16"],
    ["gratis", "100000", "2000000", "16"],
    ["gratis", " 100000", "2000", "16"],
  ];
  for (const t of faelle) assert.equal(leseGratisTag([t]), undefined, JSON.stringify(t));
  assert.equal(leseGratisTag([]), undefined);
  assert.deepEqual(leseGratisTag([["gratis", "1", "1", String(MAX_POW_BITS)]]), { tokensProTag: 1, tokensJeAntwort: 1, powBits: MAX_POW_BITS });
});

test("gratis: Umgebung des Knotens – leer Vorgabe, 0 aus, Unbrauchbares nie still", () => {
  assert.deepEqual(gratisAusUmgebung({}), { gratis: { ...GRATIS_VORGABE } });
  assert.deepEqual(gratisAusUmgebung({ GRATIS_TOKENS_TAG: "", GRATIS_TOKENS_JE_ANTWORT: " ", GRATIS_POW_BITS: "" }), { gratis: { ...GRATIS_VORGABE } });
  assert.deepEqual(gratisAusUmgebung({ GRATIS_TOKENS_TAG: "0" }), {}, "0 = aus");
  assert.deepEqual(
    gratisAusUmgebung({ GRATIS_TOKENS_TAG: "50000", GRATIS_TOKENS_JE_ANTWORT: "1000", GRATIS_POW_BITS: "18" }),
    { gratis: { tokensProTag: 50_000, tokensJeAntwort: 1000, powBits: 18 } },
  );
  for (const env of [
    { GRATIS_TOKENS_TAG: "viel" },
    { GRATIS_TOKENS_TAG: "-5" },
    { GRATIS_TOKENS_JE_ANTWORT: "2.5" },
    { GRATIS_POW_BITS: String(MAX_POW_BITS + 1) },
    { GRATIS_TOKENS_JE_ANTWORT: "0" },
  ]) {
    const r = gratisAusUmgebung(env);
    assert.equal(r.gratis, undefined, JSON.stringify(env));
    assert.ok(r.grund, `Grund für ${JSON.stringify(env)}`);
  }
});
