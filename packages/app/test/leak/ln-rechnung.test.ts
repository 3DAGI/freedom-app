/**
 * Leak-Szenario „Rechnung versiegelt erfragen“ (Schritt 6.3b): Anfrage und
 * Antwort, wie `frageRechnungAn()` und `beantworteRechnungsAnfrage()` sie
 * über den Pool schicken – mitgeschnitten am Relay. Nur Umschläge: weder
 * Betrag noch Rechnung noch eine der beiden Identitäten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalSigner, generateKeypair, regelAutorNicht, regelKeinBolt11, regelKeinKlartext } from "@freedomstack/protocol";
import { RechnungsBremse, beantworteRechnungsAnfrage, frageRechnungAn } from "../../src/ln-rechnung-anfrage.js";
import { knotenSchluessel, rechnung } from "../../../protocol/test/bolt11-hilfe.js";
import { aufzeichnung } from "./aufzeichnung.js";

test("Rechnung erfragen: nur Umschläge, weder Betrag noch Rechnung noch Identität", async () => {
  const { pool, relay } = aufzeichnung();
  const zahler = new LocalSigner(generateKeypair().sk);
  const empf = new LocalSigner(generateKeypair().sk);
  const pr = rechnung(knotenSchluessel(), "lnbc210n", new Uint8Array(32).fill(3));
  const empfaengerApp = async () => {
    for (const w of await pool.query({ kinds: [1059], "#p": [empf.publicKey()] })) {
      await beantworteRechnungsAnfrage({
        wrap: w, signer: empf, bremse: new RechnungsBremse(), istKontakt: () => true,
        stelleAus: async () => pr, sende: async (wrap) => { await pool.publish(wrap); },
      });
    }
  };
  const bezahlt = await frageRechnungAn({ pool, signer: zahler, empfaenger: empf.publicKey(), betragMsat: 21_000, warteMs: 300, pause: empfaengerApp });
  assert.equal(bezahlt, pr);
  assert.equal(relay.gesendet.length, 2);
  assert.ok(relay.gesendet.every((e) => e.kind === 1059));
  assert.deepEqual(regelKeinBolt11(relay.gesendet), []);
  assert.deepEqual(regelKeinKlartext(relay.gesendet, ["21000", pr]), []);
  assert.deepEqual(regelAutorNicht(relay.gesendet, zahler.publicKey()), []);
  assert.deepEqual(regelAutorNicht(relay.gesendet, empf.publicKey()), []);
});
