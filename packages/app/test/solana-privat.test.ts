/**
 * Schritt 4.9e: Betragsrauschen fuer SOL-Trinkgeld und verteilte RPC-Anfragen.
 * Das Rauschen selbst prueft `swap-privacy.test.ts` (checkAmount); hier geht es
 * um die Verdrahtung: Standard an, nur nach oben, und kein fester fremder
 * Anbieter fuer die Abfragen der App.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAmount } from "@freedomstack/protocol";

test("Rauschen: runde Betraege hoechstens 0,3 % nach oben, krumme bleiben", () => {
  for (const lamports of [10_000_000, 100_000_000, 1_000_000_000]) {
    const r = checkAmount(lamports, () => 0.999);
    assert.ok(r.suspicious && r.suggested! > lamports && r.suggested! <= lamports * 1.003, String(lamports));
  }
  assert.equal(checkAmount(2_345_678).suspicious, false);
});

test("Verdrahtung (4.9e): Trinkgeld verrauscht runde Betraege (Standard an), die App verteilt ihre RPC-Anfragen", () => {
  const z = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  assert.match(z, /<input type="checkbox" id="zap-rauschen" checked \/>/);
  assert.match(z, /if \(r\.suspicious && r\.suggested\) lamports = r\.suggested;/);
  assert.ok(z.indexOf("lamports = r.suggested") < z.indexOf("await zahle(zahlschienen(), { ziel, betrag: { einheit: \"lamports\", wert: lamports }"), "erst verrauschen, dann zahlen");
  for (const datei of ["../src/sol-transfer.ts", "../src/shell/state.ts", "../src/solana-connect.ts"]) {
    const s = readFileSync(new URL(datei, import.meta.url), "utf8");
    assert.match(s, /new RpcPool\(DEFAULT_MAINNET_RPCS, \{[\s\S]*?verteilen: true/, datei);
  }
});
