/**
 * Schritt 4.6: Swap in der Gegenrichtung (SOL -> Lightning). Geprueft wird vor
 * allem, dass in keinem Fehlerfall jemand Geld verliert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLightning, MockSolana } from "../src/mocks.js";
import { maxCltvLimitFuer, SLOW_BLOCK_SECS, validateReverseTimelock } from "../src/timelock.js";
import { pruefeRueckSwapSperre, rueckSwapLamports, runReverseSwap } from "../src/swap-umgekehrt.js";
import { hashlock } from "../src/htlc.js";

const JETZT = 1_790_000_000;
const KUNDE = "Kunde1111111111111111111111111111111111111";
const LP = "LpSoL11111111111111111111111111111111111111";

test("Regel: Lightning endet auch bei langsamen Bloecken plus Abstand vor T_sol", () => {
  // 30 Bloecke · 20 min = 10 h, plus 1 h Abstand -> T_sol mindestens 11 h
  assert.equal(validateReverseTimelock({ tSolSecs: 11 * 3600, lnCltvLimitBlocks: 30 }).ok, true);
  const knapp = validateReverseTimelock({ tSolSecs: 11 * 3600 - 1, lnCltvLimitBlocks: 30 });
  assert.equal(knapp.ok, false);
  assert.match(knapp.reason!, /vor der Solana-Frist/);
  assert.equal(validateReverseTimelock({ tSolSecs: 3600, lnCltvLimitBlocks: 0 }).ok, false);
  assert.equal(validateReverseTimelock({ tSolSecs: 0, lnCltvLimitBlocks: 1 }).ok, false);
  // Umgekehrt zur Hinrichtung: dort muss Lightning LAENGER laufen
  assert.equal(SLOW_BLOCK_SECS, 1200);
  assert.equal(maxCltvLimitFuer(11 * 3600), 30);
  assert.equal(maxCltvLimitFuer(3000), 0, "zu kurz fuer jede Zahlung");
});

function aufbau(tSolSecs = 12 * 3600, cltv = 30) {
  let uhr = JETZT;
  const ln = new MockLightning(0);
  ln.lpSats = 100_000;
  const sol = new MockSolana(5_000_000, () => uhr); // Initiator = Kunde
  const cfg = {
    swapId: "rueck-1", amountSats: 50_000, amountLamports: 3_000_000, kundeSolAdresse: KUNDE, lpSolAdresse: LP,
    tSolSecs, lnCltvLimitBlocks: cltv, now: () => uhr, advanceClockForRefund: () => { uhr += tSolSecs + 1; },
  };
  return { ln, sol, cfg };
}

test("Erfolg: Kunde gibt SOL und bekommt sats, LP umgekehrt; Zahlung mit cltv_limit", async () => {
  const { ln, sol, cfg } = aufbau();
  const r = await runReverseSwap(ln, sol, cfg);
  assert.equal(r.phase, "DONE", r.log.join("\n"));
  assert.equal(ln.userSats, 50_000, "Kunde hat die sats");
  assert.equal(ln.lpSats, 50_000);
  assert.equal(sol.userLamports, 3_000_000, "LP (Empfaenger) hat die SOL");
  assert.equal(sol.lpLamports, 2_000_000, "Kunde (Initiator) hat den Rest");
  assert.equal(ln.letztesCltvLimit, 30);
});

test("LP zahlt nicht: Kunde holt nach T_sol alles zurueck", async () => {
  const { ln, sol, cfg } = aufbau();
  const r = await runReverseSwap(ln, sol, cfg, { lpZahlt: false });
  assert.equal(r.phase, "REFUNDED");
  assert.equal(sol.lpLamports, 5_000_000, "Kunde wieder voll");
  assert.equal(ln.lpSats, 100_000);
});

test("Kunde haelt das Preimage zurueck: Zahlung laeuft ab, LP behaelt sats, Kunde holt SOL", async () => {
  const { ln, sol, cfg } = aufbau();
  ln.kundeHaeltZurueck = true;
  const r = await runReverseSwap(ln, sol, cfg);
  assert.equal(r.phase, "REFUNDED");
  assert.equal(ln.lpSats, 100_000, "LP verliert nichts");
  assert.equal(ln.userSats, 0, "Kunde bekommt keine sats");
  assert.equal(sol.lpLamports, 5_000_000, "und seine SOL zurueck");
});

test("LP prueft vor dem Zahlen: falscher Hashlock, zu wenig, fremder Empfaenger, zu kurze Frist", async () => {
  const { ln, sol, cfg } = aufbau();
  const falsch = await runReverseSwap(ln, sol, cfg, { hashlockDaneben: hashlock(new Uint8Array(32).fill(1)) });
  assert.equal(falsch.phase, "REFUNDED");
  assert.match(falsch.log.join("\n"), /Hashlock passt nicht/);
  assert.equal(ln.lpSats, 100_000, "nichts gezahlt");
  const basis = { recipient: LP, amountLamports: 3_000_000, hashlock: new Uint8Array(32), timelockUnix: JETZT + 12 * 3600, claimed: false, refunded: false };
  const erwartet = { lpSolAdresse: LP, amountLamports: 3_000_000, paymentHash: new Uint8Array(32), jetzt: JETZT, lnCltvLimitBlocks: 30 };
  assert.deepEqual(pruefeRueckSwapSperre(basis, erwartet), { ok: true });
  assert.match((pruefeRueckSwapSperre({ ...basis, amountLamports: 2_999_999 }, erwartet) as { grund: string }).grund, /nur 2999999/);
  assert.match((pruefeRueckSwapSperre({ ...basis, recipient: KUNDE }, erwartet) as { grund: string }).grund, /anderen Empfänger/);
  assert.match((pruefeRueckSwapSperre({ ...basis, timelockUnix: JETZT + 5 * 3600 }, erwartet) as { grund: string }).grund, /Frist zu kurz/);
  assert.match((pruefeRueckSwapSperre({ ...basis, claimed: true }, erwartet) as { grund: string }).grund, /abgeschlossen/);
  assert.match((pruefeRueckSwapSperre(undefined, erwartet) as { grund: string }).grund, /keine Sperre/);
  // Zu kurze Frist schon in der Konfiguration: Abbruch, bevor Geld bewegt wird
  const kurz = aufbau(5 * 3600, 30);
  const r = await runReverseSwap(kurz.ln, kurz.sol, kurz.cfg);
  assert.equal(r.phase, "ABORTED");
  assert.equal(kurz.sol.lpLamports, 5_000_000);
});

test("Sperrbetrag der Gegenrichtung: sats zum Kurs plus Gebuehr, ganzzahlig aufgerundet", () => {
  assert.equal(rueckSwapLamports(10_000, 100, 10_000), 1_010_000);
  assert.equal(rueckSwapLamports(10_000, 5000, 0), 50_000_000);
  assert.equal(rueckSwapLamports(1, 1, 3000), 2, "angebrochene Lamports werden aufgerundet");
  // In Fliesskomma laege das um ein Lamport daneben: 1000 · 0,1 · 1,1 = 110,00000000000001 -> 111.
  // Die App saehe 110, der LP verlangte 111 – und zahlte nicht.
  assert.equal(Math.ceil(1000 * 0.1 * (1 + 100_000 / 1e6)), 111);
  assert.equal(rueckSwapLamports(1000, 0.1, 100_000), 110);
  assert.equal(rueckSwapLamports(7, 0.1, 3000), 1);
  assert.equal(rueckSwapLamports(123_457, 4321.5, 2500), 534_853_225);
  assert.equal(rueckSwapLamports(500_000, 5000, 999_999), 4_999_997_500);
  for (const [sats, kurs, ppm] of [[0, 100, 0], [1.5, 100, 0], [10, 0, 0], [10, Number.NaN, 0], [10, 100, -1], [10, 100, 1_000_000], [10, 100, 0.5]]) {
    assert.throws(() => rueckSwapLamports(sats, kurs, ppm), /ungültig/);
  }
});
