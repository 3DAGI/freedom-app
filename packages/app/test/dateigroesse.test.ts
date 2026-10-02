/**
 * Sammlung C-5: große Dateien aufgeteilt – reine Umzüge, keine
 * Verhaltensänderung (je Datei ein Schritt, MENSCH 02.10.2026). Was aufgeteilt
 * ist, bleibt es: Wächst eine Datei über die Grenze, ist das der Anlass, sie
 * weiter zu teilen – nicht, die Grenze zu heben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (d: string): string => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
const GRENZE = 700;
const AUFGETEILT = ["shell/tabs/waehrung.ts", "shell/tabs/tausch.ts", "shell/tabs/hinterlegen.ts"];

test("C-5: aufgeteilte Dateien bleiben unter 700 Zeilen", () => {
  for (const d of AUFGETEILT) {
    const zeilen = lies(d).split("\n").length;
    assert.ok(zeilen <= GRENZE, `${d}: ${zeilen} Zeilen`);
  }
});

test("C-5a: Tausch und Hinterlegen aus ihren eigenen Modulen, der Währung-Tab bleibt Seite, Solana-Wallet und NWC", () => {
  const waehrung = lies("shell/tabs/waehrung.ts");
  for (const fn of ["startSwap", "startRueckSwap", "claimActiveSwap", "startDeposit", "refundDeposit", "geldVorgangLaeuft"]) {
    assert.doesNotMatch(waehrung, new RegExp(`function ${fn}\\(`), `${fn} steht nicht mehr in waehrung.ts`);
  }
  assert.match(waehrung, /import \{ startRueckSwap, startSwap, starteRueckholWaechter \} from "\.\/tausch\.js";/);
  assert.match(lies("shell/tabs/tausch.ts"), /^export async function startSwap\(/m);
  assert.match(lies("shell/tabs/hinterlegen.ts"), /^export async function startDeposit\(/m);
  const app = lies("shell/app.ts");
  assert.match(app, /import \{ claimActiveSwap, exportSwapBackup \} from "\.\/tabs\/tausch\.js";/);
  assert.match(app, /import \{ geldVorgangLaeuft, refundDeposit, startDeposit \} from "\.\/tabs\/hinterlegen\.js";/);
  // Der Tresor sperrt weiter nicht, solange Tausch, Hinterlegen oder Einzahlung laufen
  assert.match(lies("shell/tabs/hinterlegen.ts"), /import \{ activeSwap, sperren, starteRueckholWaechter \} from "\.\/tausch\.js";/);
});
