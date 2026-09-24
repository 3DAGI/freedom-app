import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, buildEvent, signEvent, verifyEvent, computeEventId, serializeEvent } from "../src/event.js";
import { buildProfile, parseProfile, payoutAddress } from "../src/profile.js";
import { mineEvent, verifyPow, eventDifficulty, countLeadingZeroBits } from "../src/pow.js";
import { KIND_PROFILE } from "../src/kinds.js";

test("Event: echte Schnorr-Signatur verifiziert", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 1, [["t", "x"]], "hallo", 1_700_000_000), kp.sk);
  assert.equal(ev.id.length, 64);
  assert.equal(ev.sig.length, 128);
  assert.ok(verifyEvent(ev));
});

test("Event: Manipulation des Contents wird erkannt", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 1, [], "original", 1_700_000_000), kp.sk);
  assert.ok(!verifyEvent({ ...ev, content: "manipuliert" }));
});

test("Event: fremde Signatur wird erkannt", () => {
  const a = generateKeypair();
  const b = generateKeypair();
  const ev = signEvent(buildEvent(a.pk, 1, [], "x", 1_700_000_000), a.sk);
  // Pubkey auf b umschreiben -> ID aendert sich, Signatur passt nicht
  assert.ok(!verifyEvent({ ...ev, pubkey: b.pk }));
});

test("Event: NIP-01 kanonische Serialisierung ist deterministisch", () => {
  const kp = generateKeypair();
  const e = buildEvent(kp.pk, 1, [["a", "b"]], "c", 1_700_000_000);
  assert.equal(serializeEvent(e), `[0,"${kp.pk}",1700000000,1,[["a","b"]],"c"]`);
  assert.equal(computeEventId(e), computeEventId({ ...e }));
});

test("Profil: lud16 und Chain-Adressen roundtrip (Clawstr-Muster)", () => {
  const kp = generateKeypair();
  const meta = {
    name: "agent-1",
    agent: true,
    lud16: `${kp.pk}@npub.cash`,
    chains: { solana: "So11111", polygon: "0xabc", ton: "EQabc" },
  };
  const ev = buildProfile(kp.pk, meta, 1_700_000_000);
  assert.equal(ev.kind, KIND_PROFILE);
  const back = parseProfile(ev);
  assert.deepEqual(back, meta);
  assert.equal(payoutAddress(back, "lightning"), meta.lud16);
  assert.equal(payoutAddress(back, "solana"), "So11111");
});

test("PoW: fuehrende Null-Bits korrekt gezaehlt", () => {
  assert.equal(countLeadingZeroBits("00".padEnd(64, "f")), 8);
  assert.equal(countLeadingZeroBits("0f".padEnd(64, "f")), 4);
  assert.equal(countLeadingZeroBits("ff".padEnd(64, "f")), 0);
  assert.equal(countLeadingZeroBits("0000".padEnd(64, "f")), 16);
});

test("PoW: mineEvent erreicht Zielschwierigkeit", () => {
  const kp = generateKeypair();
  const base = buildEvent(kp.pk, 1, [], "pow", 1_700_000_000);
  const mined = mineEvent(base, 8); // 8 Bits: schnell, aber echt
  assert.ok(eventDifficulty(mined) >= 8);
  assert.ok(verifyPow(mined, 8));
  assert.ok(!verifyPow(base, 200)); // absurd hohe Schwelle
});

// ---------------------------------------------------------------- Schritt 0.J
//
// Die Form eines Events wird VOR der Signaturpruefung geprueft. Jeder Fall
// unten ist so signiert, wie ein Angreifer es kann; nurSignatur() zeigt, dass
// die reine Kryptografie ihn annehmen wuerde (so pruefte verifyEvent() vorher).
// Abgelehnt wird er nur wegen der Form.

import { schnorr } from "@noble/curves/secp256k1.js";
import { hasValidEventShape, type NostrEvent } from "../src/event.js";
import { OutboxPool, type Relay } from "../src/outbox.js";

/** Signiert beliebige – auch fehlerhafte – Felder. */
function roh(felder: Record<string, unknown>, sk: Uint8Array): NostrEvent {
  const id = computeEventId(felder as never);
  const sig = Buffer.from(schnorr.sign(Buffer.from(id, "hex"), sk)).toString("hex");
  return { ...felder, id, sig } as NostrEvent;
}

/** Nur ID und Signatur – ohne Formpruefung. */
function nurSignatur(ev: NostrEvent): boolean {
  try {
    return computeEventId(ev) === ev.id &&
      schnorr.verify(Buffer.from(ev.sig, "hex"), Buffer.from(ev.id, "hex"), Buffer.from(ev.pubkey, "hex"));
  } catch {
    return false;
  }
}

function basis(kp: { pk: string }): Record<string, unknown> {
  return { pubkey: kp.pk, created_at: 1_700_000_000, kind: 1, tags: [["t", "x"]], content: "hallo" };
}

const FAELLE: Array<[string, (kp: { pk: string }) => Record<string, unknown>, (ev: NostrEvent) => NostrEvent]> = [
  ["pubkey mit angehaengtem HTML (Nachweis aus 0.B)", (kp) => ({ ...basis(kp), pubkey: kp.pk + "<b>x</b>" }), (e) => e],
  ["pubkey in Grossbuchstaben", (kp) => ({ ...basis(kp), pubkey: kp.pk.toUpperCase() }), (e) => e],
  ["sig mit angehaengtem Text", basis, (e) => ({ ...e, sig: e.sig + "zz" })],
  ["created_at als Text", (kp) => ({ ...basis(kp), created_at: "1700000000" }), (e) => e],
  ["created_at mit Nachkommastelle", (kp) => ({ ...basis(kp), created_at: 1_700_000_000.5 }), (e) => e],
  ["kind als Text", (kp) => ({ ...basis(kp), kind: "1" }), (e) => e],
  ["kind negativ", (kp) => ({ ...basis(kp), kind: -1 }), (e) => e],
  ["tags kein Array", (kp) => ({ ...basis(kp), tags: "x" }), (e) => e],
  ["Tag mit Zahl", (kp) => ({ ...basis(kp), tags: [["t", 5]] }), (e) => e],
  ["content keine Zeichenkette", (kp) => ({ ...basis(kp), content: 42 }), (e) => e],
];

for (const [name, felder, nachher] of FAELLE) {
  test(`Event-Form (0.J): ${name} -> abgelehnt`, () => {
    const kp = generateKeypair();
    const ev = nachher(roh(felder(kp), kp.sk));
    assert.ok(nurSignatur(ev), "Kontrolle: die reine Kryptografie nimmt das Event an");
    assert.equal(hasValidEventShape(ev), false);
    assert.equal(verifyEvent(ev), false);
  });
}

test("Event-Form (0.J): gueltige Events bestehen weiter", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 30_000, [["d", "x"], ["p", kp.pk, "", "role"]], "", 1_700_000_000), kp.sk);
  assert.ok(hasValidEventShape(ev));
  assert.ok(verifyEvent(ev));
});

test("Event-Form (0.J): kein Objekt -> abgelehnt, ohne Ausnahme", () => {
  for (const x of [null, undefined, "event", 42, []]) {
    assert.equal(hasValidEventShape(x), false);
    assert.equal(verifyEvent(x as never), false);
  }
});

test("Event-Form (0.J): der Pool verwirft ein solches Event aus einem Relay", async () => {
  // Echter Pfad der App: OutboxPool.query() prueft jedes Event mit verifyEvent().
  const kp = generateKeypair();
  const gut = signEvent(buildEvent(kp.pk, 1, [], "gut", 1_700_000_000), kp.sk);
  const boese = roh({ ...basis(kp), pubkey: kp.pk + "<img src=x>" }, kp.sk);
  const relay: Relay = { url: "mem://ungeprueft", publish: async () => {}, query: async () => [gut, boese] };
  const evs = await new OutboxPool([relay], { minAcks: 1 }).query({ kinds: [1] });
  assert.deepEqual(evs.map((e) => e.id), [gut.id]);
});
