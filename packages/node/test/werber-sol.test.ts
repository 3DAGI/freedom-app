/**
 * Phase 12.3 (E2 A): Ein Provider nennt die SOL-Adresse seines Werbers über
 * `PROVIDER_WERBER_SOL` im Angebot – geprüft wie die Lightning-Adresse; eine
 * ungültige verhindert den Start, statt still keinen Anteil zu nennen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Verdrahtet: PROVIDER_WERBER_SOL geprüft, ungültig kein Start, im Angebot als werberSol", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const werberSol = process\.env\.PROVIDER_WERBER_SOL \? adresseFuer\(\{ sol: process\.env\.PROVIDER_WERBER_SOL \}, "solana"\) : undefined;/);
  assert.match(main, /if \(process\.env\.PROVIDER_WERBER_SOL && !werberSol\) \{\s*console\.error\([^)]*\);\s*process\.exit\(1\);/);
  assert.match(main, /lud16,\s*werber,\s*werberSol,\s*\/\/ Zahlkanal/);
});
