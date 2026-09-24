import { test } from "node:test";
import assert from "node:assert/strict";
import { runSwap, SwapConfig } from "../src/swap.js";
import { MockLightning, MockSolana } from "../src/mocks.js";

function baseCfg(now: () => number): SwapConfig {
  return {
    swapId: "swap-1",
    amountSats: 100_000,
    amountLamports: 500_000_000,
    userSolanaAddress: "User111",
    lpSolanaAddress: "LP111",
    tSolSecs: 600,
    lnCltvDeltaBlocks: 12, // LN=7200s > T_sol=600s, Puffer 6600s ok
    now,
  };
}

test("Happy Path: beide Seiten settlen atomar, Summen erhalten", async () => {
  let t = 1_700_000_000;
  const now = () => t;
  const ln = new MockLightning(100_000); // Nutzer hat 100k sats
  const sol = new MockSolana(500_000_000, now); // LP hat 0.5 SOL

  const res = await runSwap(ln, sol, baseCfg(now), true);

  assert.equal(res.phase, "DONE");
  // Nutzer: sats weg, SOL erhalten. LP: SOL weg, sats erhalten.
  assert.equal(ln.userSats, 0);
  assert.equal(ln.lpSats, 100_000);
  assert.equal(sol.userLamports, 500_000_000);
  assert.equal(sol.lpLamports, 0);
  assert.ok(res.preimageHex);
});

test("Refund Path: Nutzer loest nicht ein, niemand verliert Geld", async () => {
  let t = 1_700_000_000;
  const now = () => t;
  const ln = new MockLightning(100_000);
  const sol = new MockSolana(500_000_000, now);

  const cfg = baseCfg(now);
  // Lock passiert bei t0; der Hook rueckt die Uhr ueber die Timelock hinaus,
  // bevor refund aufgerufen wird (modelliert "Zeit vergeht bis Timeout").
  cfg.advanceClockForRefund = () => { t = 1_700_000_000 + 601; };

  const res = await runSwap(ln, sol, cfg, /* userClaims */ false);

  assert.equal(res.phase, "REFUNDED");
  // Alles zurueck auf Anfang: Nutzer hat seine sats, LP hat sein SOL.
  assert.equal(ln.userSats, 100_000);
  assert.equal(ln.lpSats, 0);
  assert.equal(sol.userLamports, 0);
  assert.equal(sol.lpLamports, 500_000_000);
});

test("Abbruch bei unsicherer Timelock-Ordnung, bevor Gelder bewegt werden", async () => {
  let t = 1_700_000_000;
  const now = () => t;
  const ln = new MockLightning(100_000);
  const sol = new MockSolana(500_000_000, now);

  const cfg = baseCfg(now);
  cfg.lnCltvDeltaBlocks = 1; // LN=600s, nicht laenger als T_sol=600 -> unsicher

  const res = await runSwap(ln, sol, cfg, true);
  assert.equal(res.phase, "ABORTED");
  // keine Bewegung
  assert.equal(ln.userSats, 100_000);
  assert.equal(sol.lpLamports, 500_000_000);
});

test("Refund vor Ablauf der Timelock wird abgelehnt (Solana-Regel)", async () => {
  let t = 1_700_000_000;
  const now = () => t;
  const sol = new MockSolana(500_000_000, now);
  await sol.lock({
    swapId: "x",
    hashlock: new Uint8Array(32),
    amountLamports: 1,
    timelockUnix: t + 600,
    recipient: "u",
    initiator: "lp",
  });
  await assert.rejects(() => sol.refund("x"), /Timelock noch nicht abgelaufen/);
});
