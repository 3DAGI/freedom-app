/**
 * Tests fuer die Schema-Pruefung des usage-Tags (Schritt 0.1 im Ausbauplan).
 *
 * Anlass: Das usage-Tag eines Provider-Ergebnisses wurde ungeprueft
 * durchgereicht, und die App setzte Token-Zahlen in innerHTML ein. Ein
 * Provider konnte so HTML mit Skript einschleusen (XSS) und Schluessel aus
 * dem localStorage lesen. Diese Tests halten fest, dass nur das feste Schema
 * durchkommt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJobResult, sanitizeUsage } from "../src/dvm.js";

function resultEvent(usage: unknown) {
  return {
    kind: 6050,
    pubkey: "ab".repeat(32),
    created_at: 1_700_000_000,
    content: "antwort",
    tags: [
      ["e", "11".repeat(32)],
      ["p", "22".repeat(32)],
      ["amount", "1000"],
      ["usage", JSON.stringify(usage)],
    ],
  } as unknown as Parameters<typeof parseJobResult>[0];
}

test("HTML statt Zahl im usage-Tag kommt nicht durch", () => {
  const r = parseJobResult(resultEvent({
    model: "llama",
    promptTokens: "<img src=x onerror=alert(1)>",
    completionTokens: "<script>alert(1)</script>",
  }));
  assert.equal(r.usage?.model, "llama");
  assert.equal(r.usage?.promptTokens, undefined);
  assert.equal(r.usage?.completionTokens, undefined);
});

test("gueltige Werte bleiben erhalten, Kommazahlen werden abgerundet", () => {
  const r = parseJobResult(resultEvent({
    model: "m",
    promptTokens: 12,
    completionTokens: 34.7,
    sessionTotalMsat: 5000,
    toolCalls: [{ name: "web", kind: 5302, costMsat: 1000 }],
  }));
  assert.deepEqual(r.usage, {
    model: "m",
    promptTokens: 12,
    completionTokens: 34,
    sessionTotalMsat: 5000,
    toolCalls: [{ name: "web", kind: 5302, costMsat: 1000 }],
  });
});

test("negative Zahlen und null werden verworfen", () => {
  assert.equal(sanitizeUsage({ promptTokens: -5, completionTokens: null }), undefined);
});

test("fehlerhafte Werkzeug-Eintraege fallen raus, hoechstens 50 bleiben", () => {
  const viele = Array.from({ length: 60 }, (_, i) => ({ name: `t${i}`, kind: 1, costMsat: 1 }));
  const u = sanitizeUsage({ toolCalls: [{ name: { boese: true }, kind: 1, costMsat: 1 }, ...viele] });
  assert.equal(u?.toolCalls?.length, 49); // 50 geprueft, der erste davon ungueltig
  assert.ok(u?.toolCalls?.every((t) => typeof t.name === "string"));
});

test("kein Objekt ergibt undefined", () => {
  assert.equal(sanitizeUsage("x"), undefined);
  assert.equal(sanitizeUsage([1, 2]), undefined);
  assert.equal(sanitizeUsage(null), undefined);
});

test("Steuerzeichen und Ueberlaenge im Modellnamen werden entfernt", () => {
  const u = sanitizeUsage({ model: "a\u0000b" + "x".repeat(500) });
  assert.ok(u?.model && !u.model.includes("\u0000"));
  assert.ok((u?.model?.length ?? 0) <= 100);
});

test("ein kaputtes usage-Tag bricht das Ergebnis nicht", () => {
  const ev = resultEvent({});
  (ev as unknown as { tags: string[][] }).tags[3] = ["usage", "{kein json"];
  const r = parseJobResult(ev);
  assert.equal(r.usage, undefined);
  assert.equal(r.output, "antwort");
});
