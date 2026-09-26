/**
 * Leak-Szenario „Swap starten“ (Schritt 1.5, seit 4.9b versiegelt): die
 * Swap-Anfrage so, wie `startSwap()` in `tabs/waehrung.ts` sie sendet – mit
 * `hinAnfrage()` im Umschlag von einem Wegwerf-Schluessel an den LP. Bis 4.9
 * stand die Solana-Empfangsadresse offen im Event, vom eigenen npub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import {
  generateKeypair, generatePreimage, hashlock, regelAutorNicht, regelKeinBolt11, regelKeinKind4, regelKeineSolAdresse, toHex,
} from "@freedomstack/protocol";
import { hinAnfrage } from "../../src/swap-umschlag.js";
import { aufzeichnung } from "./aufzeichnung.js";

async function starte() {
  const { pool, relay } = aufzeichnung();
  const identitaet = generateKeypair().pk;
  const solAddr = Keypair.generate().publicKey.toBase58();
  const post = await hinAnfrage({
    lpPk: generateKeypair().pk, offerId: "angebot-1", amountSats: 21000, hashlockHex: toHex(hashlock(generatePreimage())), solAdresse: solAddr,
  });
  await pool.publish(post.wrap);
  return { gesendet: relay.gesendet, solAddr, identitaet };
}

test("Swap: Anfrage geht ueber den Pool, ohne Rechnung und ohne Kind 4", async () => {
  const { gesendet } = await starte();
  assert.equal(gesendet.length, 1);
  assert.deepEqual(regelKeinKind4(gesendet), []);
  assert.deepEqual(regelKeinBolt11(gesendet), []);
});

test("Swap: keine SOL-Adresse im oeffentlichen Event", async () => {
  const { gesendet, solAddr } = await starte();
  assert.deepEqual(regelKeineSolAdresse(gesendet, [solAddr]), []);
});

test("Swap: nicht vom eigenen npub", async () => {
  const { gesendet, identitaet } = await starte();
  assert.deepEqual(regelAutorNicht(gesendet, identitaet), []);
});

test("Verdrahtung: startSwap() sendet die Anfrage wie das Szenario – nur versiegelt", () => {
  const w = readFileSync(new URL("../../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  const f = w.slice(w.indexOf("async function startSwap("), w.indexOf("async function pollSwapResponse("));
  assert.match(f, /const post = await hinAnfrage\(\{ lpPk: lpPubkey, offerId, amountSats: amount, hashlockHex: toHex\(H\), solAdresse: solAddr \}\);\s*await pool\.publish\(post\.wrap\);/);
  assert.doesNotMatch(f, /signiere\(|buildEvent\(/, "keine offene Anfrage mehr");
});
