/**
 * `.gitignore` (11.5a2b): Regeln wie gitignore(5) – der Vergleich mit `git ls-files`
 * auf einem echten Ordner steht in `node/test/arbeitskopie.test.ts`; hier die Regeln
 * einzeln und was aus dem Repo kommt, begrenzt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { IGNORE_GRENZEN, istIgnoriert, leseIgnore } from "../src/index.js";

test("11.5a2b: Regeln einzeln – Kommentar, Zurückholen, nur Ordner, verankert, Sterne, Klassen, Escapes", () => {
  const r = leseIgnore("# c\n*.log\n!wichtig.log\nbuild/\n/oben.txt\n**/cache\na/**/b\n[Tt]mp\n\\!ausruf\n\\#raute\nleer\\ \n", "");
  const ign = (p: string, ordner = false) => istIgnoriert(p, ordner, r);
  assert.ok(ign("x.log") && ign("a/b/x.log") && !ign("wichtig.log") && !ign("a/wichtig.log"));
  assert.ok(ign("build", true) && ign("a/build", true) && !ign("build"), "build/ nur Ordner");
  assert.ok(ign("oben.txt") && !ign("a/oben.txt"), "verankert");
  assert.ok(ign("cache") && ign("x/y/cache", true) && ign("a/b") && ign("a/x/y/b") && !ign("x/a/b"));
  assert.ok(ign("Tmp") && ign("tmp") && !ign("Xmp"));
  assert.ok(ign("!ausruf") && ign("#raute") && ign("leer ") && !ign("leer") && !ign("c") && !ign("# c"));
  // eine tiefere .gitignore gilt nur unter ihrem Ordner und geht vor
  const tief = [...r, ...leseIgnore("!x.log\n/lokal\n", "src")];
  assert.ok(!istIgnoriert("src/x.log", false, tief) && istIgnoriert("x.log", false, tief));
  assert.ok(istIgnoriert("src/lokal", false, tief) && !istIgnoriert("src/a/lokal", false, tief) && !istIgnoriert("lokal", false, tief));
});

test("11.5a2b: was aus dem Repo kommt, ist begrenzt – kaputte Klassen fallen weg, nie ein Absturz", () => {
  assert.deepEqual(leseIgnore("[abc\n", ""), []);
  assert.equal(leseIgnore(Array.from({ length: 5000 }, (_, i) => `f${i}`).join("\n"), "").length, IGNORE_GRENZEN.regeln);
  assert.deepEqual(leseIgnore(`${"x".repeat(IGNORE_GRENZEN.zeichen + 1)}\n`, ""), []);
  assert.ok(!istIgnoriert("a", false, leseIgnore("(\n)\n+\n", "")), "Sonderzeichen sind Text");
  assert.ok(istIgnoriert("(", false, leseIgnore("(\n", "")));
});
