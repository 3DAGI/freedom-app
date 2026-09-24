/**
 * Treasury-Tests.
 *
 * Auch diese Datei fehlte. Ungetestet blieb dadurch, dass der Sweep sein
 * Keypair aus dem OEFFENTLICHEN Schluessel ableitete und die Wochen-Adresse
 * als Hex statt base58 an Solana gab — beides haetten die Tests unten sofort
 * gefunden. Es geht hier um den Weg, auf dem die Development-Fee ankommt;
 * genau da ist "ungetestet" am teuersten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import {
  deriveWeekRecipient,
  deriveWeekSeed,
  verifyWeekRecipient,
  weekNumber,
  toBase58,
} from "../src/treasury.js";

const MASTER = "a".repeat(64);

test("Treasury: abgeleiteter Seed kontrolliert die Adresse wirklich", () => {
  const r = deriveWeekRecipient(MASTER, 1000);
  // Genau diese Gleichheit war verletzt: der Sweep baute sein Keypair aus
  // pubkeyHex und signierte damit fuer eine Adresse, die ihm nicht gehoerte.
  const kp = Keypair.fromSeed(r.seed);
  assert.equal(kp.publicKey.toBase58(), r.address);
});

test("Treasury: Adresse ist base58, nicht hex", () => {
  const r = deriveWeekRecipient(MASTER, 1000);
  assert.doesNotThrow(() => Keypair.fromSeed(r.seed));
  assert.match(r.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.notEqual(r.address, r.pubkeyHex);
});

test("Treasury: Ableitung ist deterministisch und reproduzierbar", () => {
  const a = deriveWeekRecipient(MASTER, 1234);
  const b = deriveWeekRecipient(MASTER, 1234);
  assert.equal(a.address, b.address);
  // Das ist die Ausfallsicherheits-Zusage: mit dem Offline-Backup laesst sich
  // jede vergangene Woche auf jedem beliebigen Geraet rekonstruieren.
  assert.equal(deriveWeekRecipient(MASTER, 900).address, deriveWeekRecipient(MASTER, 900).address);
});

test("Treasury: verschiedene Wochen ergeben verschiedene Adressen", () => {
  const seen = new Set<string>();
  for (let w = 1000; w < 1010; w++) seen.add(deriveWeekRecipient(MASTER, w).address);
  assert.equal(seen.size, 10, "keine Kollision ueber 10 Wochen");
});

test("Treasury: anderes Master-Secret -> andere Adresse", () => {
  const a = deriveWeekRecipient(MASTER, 1000).address;
  const b = deriveWeekRecipient("b".repeat(64), 1000).address;
  assert.notEqual(a, b);
});

test("Treasury: eine Wochen-Adresse verraet den Master nicht", () => {
  // Einwegigkeit der HMAC-Ableitung: aus Woche N laesst sich Woche N+1 nicht
  // berechnen. Wir pruefen die schwaechere, aber testbare Eigenschaft, dass
  // der Seed nicht mit dem Master uebereinstimmt oder ihn enthaelt.
  const r = deriveWeekRecipient(MASTER, 1000);
  const seedHex = Buffer.from(r.seed).toString("hex");
  assert.notEqual(seedHex, MASTER);
  assert.ok(!MASTER.includes(seedHex));
  assert.equal(deriveWeekSeed(MASTER, 1000).length, 64, "HMAC-SHA512 = 64 bytes");
});

test("Treasury: verifyWeekRecipient erkennt richtige und falsche Adresse", () => {
  const r = deriveWeekRecipient(MASTER, 1000);
  // Frueher gab diese Funktion IMMER false zurueck.
  assert.equal(verifyWeekRecipient(MASTER, r.address, 1000), true);
  assert.equal(verifyWeekRecipient(MASTER, r.address, 1001), false);
  assert.equal(
    verifyWeekRecipient(MASTER, deriveWeekRecipient("c".repeat(64), 1000).address, 1000),
    false,
  );
});

test("Treasury: weekNumber laeuft monoton und wechselt woechentlich", () => {
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  // Auf einen Wochenanfang normieren, sonst liegt t0 mitten in einer Woche
  // und "eine Stunde spaeter" kann schon die naechste sein.
  const start = Math.floor(1_700_000_000_000 / WEEK_MS) * WEEK_MS;

  assert.equal(weekNumber(start + 3600 * 1000), weekNumber(start), "innerhalb der Woche gleich");
  assert.equal(weekNumber(start + WEEK_MS - 1), weekNumber(start), "bis zur letzten ms gleich");
  assert.equal(weekNumber(start + WEEK_MS), weekNumber(start) + 1, "danach exakt +1");

  for (let i = 1; i < 10; i++) {
    assert.ok(weekNumber(start + i * WEEK_MS) > weekNumber(start + (i - 1) * WEEK_MS));
  }
});

test("Treasury: base58-Encoder stimmt mit @solana/web3.js ueberein", () => {
  for (let i = 0; i < 20; i++) {
    const kp = Keypair.generate();
    assert.equal(toBase58(kp.publicKey.toBytes()), kp.publicKey.toBase58());
  }
  // Fuehrende Nullbytes sind der klassische base58-Fallstrick ("1"-Praefix).
  const withZeros = new Uint8Array(32);
  withZeros[31] = 1;
  assert.equal(toBase58(withZeros).startsWith("1"), true);
});
