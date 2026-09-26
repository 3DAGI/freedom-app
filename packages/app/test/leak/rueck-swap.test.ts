/**
 * Leak-Szenario „Tausch SOL → sats“ (Schritt 4.6c, seit 4.9b versiegelt): die
 * Anfrage so, wie `startRueckSwap()` in `tabs/waehrung.ts` sie sendet – mit
 * `rueckAnfrage()` im Umschlag von einem Wegwerf-Schluessel. Bis 4.9 stand die
 * Rechnung offen darin, weil der LP (4.6b) nur offene Anfragen las.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import {
  generateKeypair, generatePreimage, regelAutorNicht, regelKeinBolt11, regelKeinKind4, regelKeineSolAdresse,
} from "@freedomstack/protocol";
import { rueckAnfrage } from "../../src/swap-umschlag.js";
import { knotenSchluessel, rechnung } from "../../../protocol/test/bolt11-hilfe.js";
import { aufzeichnung } from "./aufzeichnung.js";

async function tausche() {
  const { pool, relay } = aufzeichnung();
  const identitaet = generateKeypair().pk;
  const kundeSol = Keypair.generate().publicKey.toBase58(); // Initiator der Sperre – nur auf der Kette
  const bolt11 = rechnung(knotenSchluessel(), "lnbc100u", generatePreimage());
  const post = await rueckAnfrage({ lpPk: generateKeypair().pk, offerId: "lp-1-buy", bolt11 });
  await pool.publish(post.wrap);
  return { gesendet: relay.gesendet, identitaet, kundeSol };
}

test("Tausch SOL → sats: eine Anfrage, nicht vom eigenen npub, ohne SOL-Adresse, ohne Kind 4", async () => {
  const { gesendet, identitaet, kundeSol } = await tausche();
  assert.equal(gesendet.length, 1);
  assert.deepEqual(regelAutorNicht(gesendet, identitaet), []);
  assert.deepEqual(regelKeineSolAdresse(gesendet, [kundeSol]), []);
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Tausch SOL → sats: keine Rechnung im oeffentlichen Event", async () => {
  const { gesendet } = await tausche();
  assert.deepEqual(regelKeinBolt11(gesendet), []);
});

test("Verdrahtung: startRueckSwap() sendet die Anfrage wie das Szenario – nur versiegelt", () => {
  const w = readFileSync(new URL("../../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  const f = w.slice(w.indexOf("async function startRueckSwap("), w.indexOf("async function warteAufRueckAntwort("));
  assert.match(f, /const post = await rueckAnfrage\(\{ lpPk: lpPubkey, offerId: offer\.offerId, bolt11 \}\);\s*await \(await ensurePool\(\)\)\.publish\(post\.wrap\);/);
});
