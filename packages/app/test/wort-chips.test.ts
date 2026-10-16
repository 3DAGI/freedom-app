/**
 * Schritt C-55b (Oberflächen-Review 15.10.2026): Merkphrase per Wort-Chips bestätigen. Je Stelle das richtige Wort
 * und drei andere derselben Merkphrase, gemischt; geprüft wird weiter mit `verifyMnemonicChallenge()`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wortAuswahl } from "../src/wort-chips.js";

const W = "apfel birne kirsche dattel feige guave honig ingwer jojoba kiwi limette mango".split(" ");
const erster: (n: number) => number = () => 0;

test("vier Wörter: das richtige und drei andere derselben Merkphrase, ohne Doppelte", () => {
  for (let pos = 0; pos < W.length; pos++) {
    const a = wortAuswahl(W, pos);
    assert.equal(a.length, 4);
    assert.ok(a.includes(W[pos]!));
    assert.equal(new Set(a).size, 4);
    for (const w of a) assert.ok(W.includes(w));
  }
});

test("gemischt mit dem vorgegebenen Zufall – das richtige steht nicht immer vorn", () => {
  // Zufall 0: die ersten drei anderen Wörter, dann Fisher-Yates mit j = 0 – das richtige („guave“, Stelle 5) wandert ans Ende
  assert.deepEqual(wortAuswahl(W, 5, erster), ["apfel", "birne", "kirsche", "guave"]);
  const positionen = new Set(Array.from({ length: 40 }, () => wortAuswahl(W, 3).indexOf("dattel")));
  assert.ok(positionen.size > 1, "die Stelle des richtigen Worts wechselt");
});

test("Wiederholte Wörter zählen einmal; ungültige Stelle ergibt nichts", () => {
  const doppelt = ["a", "a", "a", "b"];
  assert.deepEqual(new Set(wortAuswahl(doppelt, 0)), new Set(["a", "b"]));
  assert.deepEqual(wortAuswahl(W, 12), []);
});

test("verdrahtet: verborgene Felder mit der Wahl, Chips mit aria-pressed, die Prüfung bleibt", () => {
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /feld\.type = "hidden";\s*feld\.dataset\.pos = String\(p\);/);
  assert.match(app, /const chips = wortAuswahl\(woerter, p\)\.map/);
  assert.match(app, /for \(const c of chips\) c\.setAttribute\("aria-pressed", String\(c === chip\)\);/);
  assert.match(app, /const r = verifyMnemonicChallenge\(mnemonic, positionen, antworten\);/);
});
