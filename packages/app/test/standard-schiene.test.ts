/**
 * Schritt 4.1c: Standard-Schiene – Vorgabe fuer Zaps und Trinkgeld, je
 * Zahlung aenderbar; ohne Einstellung Lightning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const speicher = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => speicher.get(k) ?? null,
  setItem: (k: string, v: string) => { speicher.set(k, v); },
  removeItem: (k: string) => { speicher.delete(k); },
};
const { LS_STANDARD_SCHIENE, standardSchiene } = await import("../src/standard-schiene.js");

test("Standard-Schiene: ohne Einstellung Lightning, sonst die gewaehlte; Unfug zaehlt als Lightning", () => {
  speicher.clear();
  assert.equal(standardSchiene(), "lightning");
  speicher.set(LS_STANDARD_SCHIENE, "solana");
  assert.equal(standardSchiene(), "solana");
  speicher.set(LS_STANDARD_SCHIENE, "dogecoin");
  assert.equal(standardSchiene(), "lightning");
});

test("Verdrahtung: Einstellung in den Settings, Vorgabe im Zap-Dialog, Einheit folgt der Schiene", () => {
  const set = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  assert.match(set, /schiene\.value = standardSchiene\(\);/);
  assert.match(set, /localStorage\.setItem\(LS_STANDARD_SCHIENE, schiene\.value === "solana" \? "solana" : "lightning"\)/);
  const zap = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  assert.match(zap, /const schiene = standardSchiene\(\);/);
  assert.match(zap, /walletType: schiene,/);
  assert.match(zap, /\(document\.getElementById\("zap-unit"\) as HTMLSelectElement\)\.value = walletSel\.value === "solana" \? "sol" : "sats";/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<select id="standard-schiene"/);
});
