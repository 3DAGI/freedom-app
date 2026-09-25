/**
 * Schritt 4.8: bolt11 lesen und die Signatur pruefen – Empfaengerknoten aus
 * der Signatur, Betrag aus dem Praefix, Payment-Hash aus dem Feld p.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bech32 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { leseBolt11 } from "../src/bolt11.js";
import { rechnung } from "./bolt11-hilfe.js";

// Testvektor aus BOLT 11 – oeffentlich; signiert vom Schluessel der Spezifikation.
const SPEZ = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const SPEZ_KNOTEN = "03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad";

test("Spezifikation: Knoten aus der Signatur, Betrag, Hash und Zeit", () => {
  assert.deepEqual(leseBolt11(SPEZ), {
    netz: "bc", betragMsat: 250_000_000, empfaengerKnoten: SPEZ_KNOTEN, zeit: 1496314658,
    zahlungsHash: "0001020304050607080900010203040506070809000102030405060708090102",
  });
});

test("Eigene Rechnungen: Knoten, Betraege, genannter Knoten; Manipulation faellt auf", () => {
  const sk = secp256k1.utils.randomSecretKey();
  const knoten = bytesToHex(secp256k1.getPublicKey(sk, true));
  const pre = new Uint8Array(32).fill(5);
  for (const [prefix, msat] of [["lnbc250n", 25_000], ["lnbc1m", 100_000_000], ["lnbc10u", 1_000_000], ["lnbc10p", 1], ["lntb1", 100_000_000_000], ["lnbc", null]] as const) {
    const r = leseBolt11(rechnung(sk, prefix, pre));
    assert.equal(r.betragMsat, msat, prefix);
    assert.equal(r.empfaengerKnoten, knoten);
    assert.equal(r.zahlungsHash, bytesToHex(sha256(pre)));
  }
  assert.equal(leseBolt11(rechnung(sk, "lnbc250n", pre, secp256k1.getPublicKey(sk, true))).empfaengerKnoten, knoten, "Feld n passt");
  const fremd = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true);
  assert.throws(() => leseBolt11(rechnung(sk, "lnbc250n", pre, fremd)), /genannten Knoten/);
  // Ein Zeichen im Datenteil geaendert: Pruefsumme oder Signatur stimmt nicht mehr
  const echt = rechnung(sk, "lnbc250n", pre);
  const kaputt = echt.slice(0, 20) + (echt[20] === "q" ? "p" : "q") + echt.slice(21);
  assert.throws(() => leseBolt11(kaputt));
  // Betrag im Praefix geaendert und neu mit Pruefsumme versehen: anderer Knoten
  const { words } = bech32.decode(echt as `${string}1${string}`, 2000);
  assert.notEqual(leseBolt11(bech32.encode("lnbc2500n", words, false)).empfaengerKnoten, knoten, "Betrag ist mitsigniert");
  assert.throws(() => leseBolt11("lnbc1kaputt"));
  assert.throws(() => leseBolt11("nostr1abc"));
  assert.throws(() => leseBolt11(bech32.encode("nostr", words, false)), /Präfix/);
});
