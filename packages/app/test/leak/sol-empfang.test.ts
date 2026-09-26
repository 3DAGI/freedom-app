/**
 * Leak-Szenario „SOL empfangen“ (Schritt 4.9c): drei Taeusche sats → SOL mit
 * der eingebauten Wallet, wie `startSwap()` in `tabs/waehrung.ts` sie
 * adressiert – je Tausch eine frische Adresse aus dem Vorrat
 * (`frischeEmpfangsadresse()`), nie die Hauptadresse, nie zweimal dieselbe.
 * Gesendete Zahlungen sind nicht Teil davon (Entscheidung 4.9 A) – siehe
 * `sol-zahlung.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { regelSolAdresseFrisch } from "@freedomstack/protocol";
import { identityFromMnemonic } from "../../src/identity.js";
import { EingebauteSolWallet } from "../../src/sol-wallet.js";

// Oeffentliche BIP-39-Testphrase – kein Geheimnis.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("SOL empfangen: jeder Tausch an eine frische Adresse, nie an die Hauptadresse", async () => {
  const daten = new Map<string, string>();
  const w = new EingebauteSolWallet({ getItem: (k) => daten.get(k) ?? null, async setItem(k, v) { daten.set(k, v); }, async removeItem(k) { daten.delete(k); } });
  const haupt = await w.einrichten(PHRASE, identityFromMnemonic(PHRASE).pk);
  const empfang = [await w.frischeAdresse(), await w.frischeAdresse(), await w.frischeAdresse()];
  assert.deepEqual(regelSolAdresseFrisch([haupt, ...empfang]), []);
});

test("Verdrahtung: startSwap() nimmt die frische Adresse als Vorschlag", () => {
  const w = readFileSync(new URL("../../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  const f = w.slice(w.indexOf("async function startSwap("), w.indexOf("async function pollSwapResponse("));
  assert.ok(f.indexOf("frischeEmpfangsadresse()") < f.indexOf("hinAnfrage("), "erst die frische Adresse, dann die Anfrage");
});
