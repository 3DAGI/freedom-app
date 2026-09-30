/**
 * Kontakt prüfen (B-4): derselbe Code auf beiden Seiten, fester Testvektor
 * (unabhängig mit Python nachgerechnet), Vergleich ohne Leerzeichen und Präfix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "../src/event.js";
import { SICHERHEITSCODE_QR, sicherheitscode, sicherheitscodeQr, sicherheitscodeStimmt } from "../src/sicherheitscode.js";

test("Sicherheitscode: fester Testvektor – 12 Gruppen zu 5 Ziffern", () => {
  // hashlib.sha256(b"freedomstack-sicherheitscode-v1" + bytes([n]) + min + max), je Gruppe 5 Byte mod 10^5
  assert.equal(sicherheitscode("a".repeat(64), "0f".repeat(32)), "49092 03250 69804 96236 98455 46251 14256 15663 03669 07154 63358 21238");
});

test("Sicherheitscode: beide Seiten sehen denselben, ein anderer Kontakt einen anderen", () => {
  const ich = generateKeypair().pk;
  const du = generateKeypair().pk;
  const fremd = generateKeypair().pk;
  const code = sicherheitscode(ich, du);
  assert.ok(code);
  assert.match(code, /^\d{5}( \d{5}){11}$/);
  assert.equal(sicherheitscode(du, ich), code);
  assert.notEqual(sicherheitscode(ich, fremd), code, "wer nur so aussieht, hat einen anderen Schlüssel und einen anderen Code");
});

test("Sicherheitscode: ungültige Schlüssel oder zweimal derselbe ergeben keinen", () => {
  const ich = generateKeypair().pk;
  assert.equal(sicherheitscode(ich, ich), undefined);
  assert.equal(sicherheitscode(ich, "A".repeat(64)), undefined, "nur Kleinbuchstaben wie nach NIP-01");
  assert.equal(sicherheitscode(ich, "ab"), undefined);
  assert.equal(sicherheitscode("npub1xyz", ich), undefined);
});

test("Vergleich: vorgelesen, eingetippt oder gescannt – nur genau die 60 Ziffern", () => {
  const code = sicherheitscode(generateKeypair().pk, generateKeypair().pk)!;
  assert.ok(sicherheitscodeStimmt(code, code));
  assert.ok(sicherheitscodeStimmt(code.replace(/ /g, ""), code));
  assert.ok(sicherheitscodeStimmt(code.replace(/ /g, "-"), code));
  assert.ok(sicherheitscodeStimmt(`  ${sicherheitscodeQr(code)}  `, code));
  assert.equal(sicherheitscodeQr(code), SICHERHEITSCODE_QR + code.replace(/ /g, ""));
  const falsch = (code[0] === "1" ? "2" : "1") + code.slice(1);
  assert.equal(sicherheitscodeStimmt(falsch, code), false);
  assert.equal(sicherheitscodeStimmt(code.slice(0, -1), code), false, "eine Ziffer zu wenig");
  assert.equal(sicherheitscodeStimmt(`${code}1`, code), false, "eine zu viel");
  assert.equal(sicherheitscodeStimmt("", code), false);
  assert.equal(sicherheitscodeStimmt(code.replace(/\d/, "x"), code), false);
});
