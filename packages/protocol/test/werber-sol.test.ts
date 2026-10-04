/**
 * Phase 12.3 (E2 A): Das Angebot (38027) nennt die SOL-Adresse des Werbers
 * eines Providers (`werber_sol`). Mit den SOL-Adressen der Werber und der
 * Relays teilt das Zahlkanal-Programm deren Anteile zu – vorher fand
 * `kanalEmpfaenger()` dort nichts, und der Provider bekam fast alles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANTEILE_PPM, buildCapabilities, generateKeypair, kanalEmpfaenger, parseCapabilities } from "../src/index.js";

const JETZT = 1_790_000_000;
const SOL_W = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SOL_K = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const SOL_R = "So11111111111111111111111111111111111111112";
const basis = { pubkey: generateKeypair().pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false };

test("Angebot: SOL-Adresse des Werbers – nur eine plausible, auch ohne Lightning-Adresse", () => {
  const mit = parseCapabilities(buildCapabilities({ ...basis, werberSol: SOL_W }, JETZT));
  assert.equal(mit.werberSol, SOL_W);
  assert.equal(mit.werber, undefined);
  assert.equal(parseCapabilities(buildCapabilities({ ...basis, werberSol: "kaputt" }, JETZT)).werberSol, undefined);
  const ev = buildCapabilities(basis, JETZT);
  ev.tags.push(["werber_sol", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"]);
  assert.equal(parseCapabilities(ev).werberSol, undefined, "fremde Angabe geprüft");
});

test("Zahlkanal: Werber des Providers, Werber des Kunden und Relays bekommen ihre Anteile an SOL-Adressen", () => {
  const e = kanalEmpfaenger({
    "werber-provider": { lud16: "w@wallet.example", sol: SOL_W },
    "werber-kunde": { sol: SOL_K },
    relays: [{ lud16: "r@wallet.example" }, { sol: SOL_R }],
  });
  const ppm = Object.fromEntries(e.map((x) => [x.adresse, x.ppm]));
  assert.equal(ppm[SOL_W], ANTEILE_PPM["werber-provider"]);
  assert.equal(ppm[SOL_K], ANTEILE_PPM["werber-kunde"]);
  assert.equal(ppm[SOL_R], ANTEILE_PPM.relays, "ein Relay mit SOL-Adresse bekommt den ganzen Relay-Anteil");
  assert.equal(e.length, 3, "Lightning-Adressen zählen im Kanal nicht");
});
