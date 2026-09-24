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
