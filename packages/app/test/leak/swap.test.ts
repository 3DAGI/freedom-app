/**
 * Leak-Szenario „Swap starten“ (Schritt 1.5): die Swap-Anfrage (Kind 25001) so,
 * wie `startSwap()` in `tabs/waehrung.ts` sie baut. Heute steht die
 * Solana-Empfangsadresse offen im Event und verknuepft sie mit dem npub –
 * Schritt 4.9 aendert das.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import {
  LocalSigner, buildEvent, generateKeypair, generatePreimage, hashlock, regelKeinBolt11, regelKeinKind4,
  regelKeineSolAdresse, toHex,
} from "@freedomstack/protocol";
import { KIND_SWAP_REQUEST } from "../../src/shell/state.js";
import { aufzeichnung } from "./aufzeichnung.js";

async function starte() {
  const { pool, relay } = aufzeichnung();
  const signer = new LocalSigner(generateKeypair().sk);
  const solAddr = Keypair.generate().publicKey.toBase58();
  await pool.publish(await signer.signEvent(buildEvent(signer.publicKey(), KIND_SWAP_REQUEST, [
    ["p", generateKeypair().pk],
    ["offer", "angebot-1"],
    ["amount_sats", "21000"],
    ["hashlock", toHex(hashlock(generatePreimage()))],
    ["solana_address", solAddr],
  ], "")));
  return { gesendet: relay.gesendet, solAddr };
}

test("Swap: Anfrage geht ueber den Pool, ohne Rechnung und ohne Kind 4", async () => {
  const { gesendet } = await starte();
  assert.equal(gesendet.length, 1);
  assert.deepEqual(regelKeinKind4(gesendet), []);
  assert.deepEqual(regelKeinBolt11(gesendet), []);
});

test("Swap: keine SOL-Adresse im oeffentlichen Event", { todo: "Schritt 4.9" }, async () => {
  const { gesendet, solAddr } = await starte();
  assert.deepEqual(regelKeineSolAdresse(gesendet, [solAddr]), []);
});

test("Verdrahtung: startSwap() baut die Anfrage wie das Szenario", () => {
  const w = readFileSync(new URL("../../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  const f = w.slice(w.indexOf("async function startSwap("), w.indexOf("async function pollSwapResponse("));
  assert.match(f, /KIND_SWAP_REQUEST,\s*\[\s*\["p", lpPubkey\],\s*\["offer", offerId\],\s*\["amount_sats", String\(amount\)\],\s*\["hashlock", toHex\(H\)\],\s*\["solana_address", solAddr\],\s*\],/);
});
