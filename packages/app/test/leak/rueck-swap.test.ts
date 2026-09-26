/**
 * Leak-Szenario „Tausch SOL → sats“ (Schritt 4.6c): die Anfrage (Kind 25001)
 * so, wie `startRueckSwap()` in `tabs/waehrung.ts` sie baut – von einem
 * Wegwerf-Schluessel, ohne SOL-Adresse. Die Rechnung steht heute offen darin,
 * weil der LP (4.6b) nur offene Anfragen liest; Schritt 4.9 aendert das.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import {
  LocalSigner, generateKeypair, generatePreimage, regelAutorNicht, regelKeinBolt11, regelKeinKind4, regelKeineSolAdresse,
} from "@freedomstack/protocol";
import { baueRueckAnfrage } from "../../src/rueck-swap.js";
import { knotenSchluessel, rechnung } from "../../../protocol/test/bolt11-hilfe.js";
import { aufzeichnung } from "./aufzeichnung.js";

async function tausche() {
  const { pool, relay } = aufzeichnung();
  const identitaet = generateKeypair().pk;
  const kundeSol = Keypair.generate().publicKey.toBase58(); // Initiator der Sperre – nur auf der Kette
  const einmal = new LocalSigner(generateKeypair().sk);
  const bolt11 = rechnung(knotenSchluessel(), "lnbc100u", generatePreimage());
  await pool.publish(await einmal.signEvent(baueRueckAnfrage(einmal.publicKey(), generateKeypair().pk, "lp-1-buy", bolt11, Math.floor(Date.now() / 1000))));
  return { gesendet: relay.gesendet, identitaet, kundeSol };
}

test("Tausch SOL → sats: eine Anfrage, nicht vom eigenen npub, ohne SOL-Adresse, ohne Kind 4", async () => {
  const { gesendet, identitaet, kundeSol } = await tausche();
  assert.equal(gesendet.length, 1);
  assert.deepEqual(regelAutorNicht(gesendet, identitaet), []);
  assert.deepEqual(regelKeineSolAdresse(gesendet, [kundeSol]), []);
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Tausch SOL → sats: keine Rechnung im oeffentlichen Event", { todo: "Schritt 4.9" }, async () => {
  const { gesendet } = await tausche();
  assert.deepEqual(regelKeinBolt11(gesendet), []);
});
