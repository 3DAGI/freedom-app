/**
 * Schritt 4.1a: Zahlschienen – Ziel erkennen, Anfrage pruefen, Schiene
 * waehlen (nie still umleiten), Betraege in beiden Einheiten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Beleg, type PaymentRail, type RailId, type Zahlanfrage, betragText, inBeidenEinheiten, pruefeAnfrage, railFuerZiel,
  waehleRail, zahle,
} from "../src/payment-rail.js";

// Testvektor aus BOLT 11 – oeffentlich, kein Geheimnis.
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";

class MockRail implements PaymentRail {
  gezahlt: Zahlanfrage[] = [];
  constructor(readonly id: RailId, private da = true) {}
  async verfuegbar() { return this.da; }
  async quote(a: Zahlanfrage) { return { rail: this.id, betrag: a.betrag }; }
  async pay(a: Zahlanfrage): Promise<Beleg> { this.gezahlt.push(a); return { rail: this.id, ziel: a.ziel, betrag: a.betrag, ref: "r", zeit: 1 }; }
  async verify() { return true; }
}

test("Ziel erkennen: Rechnung, Lightning-Adresse, Solana-Adresse, Unfug", () => {
  assert.equal(railFuerZiel(BOLT11), "lightning");
  assert.equal(railFuerZiel(BOLT11.toUpperCase()), "lightning");
  assert.equal(railFuerZiel("alice@getalby.com"), "lightning");
  assert.equal(railFuerZiel(SOL), "solana");
  for (const x of ["", "hallo", "lnbc1", "alice@", "0OIl" + SOL.slice(4), "javascript:alert(1)"]) assert.equal(railFuerZiel(x), null, x);
});

test("Anfrage pruefen: Einheit zur Schiene, Betrag ganzzahlig und positiv", () => {
  pruefeAnfrage("lightning", { ziel: BOLT11, betrag: { einheit: "msat", wert: 21_000 }, zweck: "zap" });
  pruefeAnfrage("solana", { ziel: SOL, betrag: { einheit: "lamports", wert: 5_000 }, zweck: "trinkgeld" });
  assert.throws(() => pruefeAnfrage("solana", { ziel: BOLT11, betrag: { einheit: "lamports", wert: 1 }, zweck: "zap" }), /passt nicht/);
  assert.throws(() => pruefeAnfrage("lightning", { ziel: BOLT11, betrag: { einheit: "lamports", wert: 1 }, zweck: "zap" }), /rechnet in msat/);
  for (const wert of [0, -1, 1.5, Number.NaN, 2 ** 60]) {
    assert.throws(() => pruefeAnfrage("lightning", { ziel: BOLT11, betrag: { einheit: "msat", wert }, zweck: "zap" }), /positive ganze Zahl/, String(wert));
  }
});

test("Schiene waehlen: passend und verbunden – sonst Fehler, nie stille Umleitung", async () => {
  const ln = new MockRail("lightning");
  const sol = new MockRail("solana");
  const a: Zahlanfrage = { ziel: SOL, betrag: { einheit: "lamports", wert: 5_000 }, zweck: "trinkgeld" };
  assert.equal((await waehleRail([ln, sol], a)).id, "solana");
  await assert.rejects(waehleRail([ln], a), /Keine Schiene für solana/);
  await assert.rejects(waehleRail([ln, new MockRail("solana", false)], a), /Solana-Wallet verbunden/);
  await assert.rejects(waehleRail([ln, sol], { ...a, ziel: "irgendwas" }), /Unbekanntes Zahlungsziel/);
  const b = await zahle([ln, sol], a);
  assert.deepEqual([b.rail, sol.gezahlt.length, ln.gezahlt.length], ["solana", 1, 0]);
  await assert.rejects(zahle([ln, sol], { ...a, betrag: { einheit: "msat", wert: 1 } }), /rechnet in lamports/);
  assert.equal(sol.gezahlt.length, 1, "falsche Einheit wird nicht gezahlt");
});

test("Betraege in beiden Einheiten und lesbar", () => {
  // 1 SOL = 150.000 sats -> 1e9 lamports / 1.5e8 msat
  const kurs = 1e9 / 150_000_000;
  assert.deepEqual(inBeidenEinheiten({ einheit: "msat", wert: 21_000 }, kurs), { msat: 21_000, lamports: 140_000 });
  assert.deepEqual(inBeidenEinheiten({ einheit: "lamports", wert: 1e9 }, kurs), { lamports: 1e9, msat: 150_000_000 });
  assert.deepEqual(inBeidenEinheiten({ einheit: "msat", wert: 21_000 }), { msat: 21_000 }, "ohne Kurs nur die eigene Einheit");
  assert.deepEqual(inBeidenEinheiten({ einheit: "msat", wert: 21_000 }, -1), { msat: 21_000 });
  assert.equal(betragText({ einheit: "msat", wert: 21_000 }), "21 sats");
  assert.equal(betragText({ einheit: "msat", wert: 7 }), "7 msat");
  assert.equal(betragText({ einheit: "lamports", wert: 5_000 }), "0,000005 SOL");
});
