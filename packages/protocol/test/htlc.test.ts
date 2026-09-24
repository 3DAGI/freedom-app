import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePreimage, hashlock, verifyPreimage, sha256, toHex, fromHex } from "../src/htlc.js";

test("SHA-256 bekannter Vektor (leerer Input)", () => {
  // SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  assert.equal(
    toHex(sha256(new Uint8Array())),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("Preimage/Hashlock-Roundtrip verifiziert korrekt", () => {
  const r = generatePreimage();
  assert.equal(r.length, 32);
  const H = hashlock(r);
  assert.equal(H.length, 32);
  assert.ok(verifyPreimage(r, H));
});

test("falsche Preimage wird abgelehnt", () => {
  const r = generatePreimage();
  const H = hashlock(r);
  const wrong = generatePreimage();
  assert.ok(!verifyPreimage(wrong, H));
});

test("hex Roundtrip", () => {
  const r = generatePreimage();
  assert.deepEqual([...fromHex(toHex(r))], [...r]);
});
