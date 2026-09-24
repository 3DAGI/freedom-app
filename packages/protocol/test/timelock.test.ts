import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTimelockOrdering } from "../src/timelock.js";

test("gueltige Ordnung: Lightning-Frist deutlich laenger", () => {
  // 6 Bloecke * 600s = 3600s Lightning; Solana 600s -> Puffer 3000s... zu klein bei 3600 min.
  const r = validateTimelockOrdering({ tSolSecs: 600, lnCltvDeltaBlocks: 12 });
  // 12*600=7200s LN, Solana 600 -> Puffer 6600 >= 3600 -> ok
  assert.ok(r.ok, r.reason ?? "ordering invalid");
  assert.equal(r.tLnSecs, 7200);
});

test("ungueltig: Lightning-Frist kuerzer als Solana", () => {
  const r = validateTimelockOrdering({ tSolSecs: 7200, lnCltvDeltaBlocks: 6 }); // LN=3600 < 7200
  assert.ok(!r.ok);
});

test("ungueltig: Puffer zu klein", () => {
  const r = validateTimelockOrdering({ tSolSecs: 3400, lnCltvDeltaBlocks: 6 }); // LN=3600, Puffer 200 < 3600
  assert.ok(!r.ok);
});

test("ungueltig: tSol <= 0", () => {
  const r = validateTimelockOrdering({ tSolSecs: 0, lnCltvDeltaBlocks: 12 });
  assert.ok(!r.ok);
});
