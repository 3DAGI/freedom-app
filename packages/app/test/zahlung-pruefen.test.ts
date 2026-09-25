/**
 * Schritt 4.8: „Zahlung pruefen“ in der App prueft Lightning-Teile an Rechnung
 * und Empfaengerknoten und Solana-Teile gegen die Kette.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Verdrahtung: Zahlung pruefen nutzt verifyFeeProofMitKette mit dem RPC-Pool und zeigt die Begruendung", () => {
  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /const v = await verifyFeeProofMitKette\(evs\[0\], \{[\s\S]*?\}, solTransaktion\);/);
  assert.doesNotMatch(agent, /verifyFeeProof\(evs\[0\]/, "nicht mehr ohne Kette");
  assert.match(agent, /<div class="muted mono-sm">\$\{escapeHtml\(l\.detail\)\}<\/div>/);
  const state = readFileSync(new URL("../src/shell/state.ts", import.meta.url), "utf8");
  assert.match(state, /return \(await ensureRpcPool\(\)\)\.getTransaction\(signatur\);/);
});
