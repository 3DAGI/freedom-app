/**
 * C-6d2: Code in Antworten einfärben ohne DOM – `codeTeile()` zerlegt, die
 * App zeichnet die Stücke nur mit `textContent` (`shell/antwort-ui.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_FARBE_MAX, CODE_ZEILE_MAX, codeTeile } from "../src/code-farbe.js";

const zusammen = (code: string): string => codeTeile(code).map((s) => s.text).join("");
const gefaerbt = (code: string): string[] => codeTeile(code).filter((s) => s.art).map((s) => `${s.art}:${s.text}`);

test("C-6d2: Stücke ergeben wieder genau den Code – auch mit HTML darin", () => {
  for (const code of [
    "", "x", "const a = \"<img src=x onerror=alert(1)>\"; // </code>\nlet b = 'c';\n",
    "def f(self):\n    return None  # kommentar\n", "/* offen\n zu */ 42 3.14 x1", "\"\\\"\" 'a\\'b'\n\n\n",
  ]) assert.equal(zusammen(code), code);
});

test("C-6d2: Zeichenketten, Kommentare, Schlüsselwörter und Zahlen", () => {
  assert.deepEqual(gefaerbt('const s = "a // b"; // echt'), ["kw:const", 'str:"a // b"', "com:// echt"]);
  assert.deepEqual(gefaerbt("return x1 + 42 # py"), ["kw:return", "num:42", "com:# py"]);
  assert.deepEqual(gefaerbt("let a = /* kurz */ 1.5;"), ["kw:let", "com:/* kurz */", "num:1.5"]);
  assert.deepEqual(gefaerbt("'it\\'s' \"x\\\"y\""), ["str:'it\\'s'", 'str:"x\\"y"']);
  // Nichts reicht über ein Zeilenende: offene Zeichenkette, Kommentar über zwei Zeilen
  assert.deepEqual(gefaerbt('"offen\nconst'), ["kw:const"]);
  assert.deepEqual(gefaerbt("/* a\nb */"), []);
  assert.deepEqual(gefaerbt("constant typeofx"), [], "nur ganze Wörter");
});

test("C-6d2: zu lang bleibt ungefärbt – der Block und je Zeile", () => {
  const block = "const x = 1;\n".repeat(Math.ceil(CODE_FARBE_MAX / 13) + 1);
  assert.deepEqual(codeTeile(block), [{ text: block }]);
  const lang = `const a = "${"b".repeat(CODE_ZEILE_MAX)}";\nlet c = 2;\n`;
  assert.deepEqual(gefaerbt(lang), ["kw:let", "num:2"]);
  assert.equal(zusammen(lang), lang);
});

test("C-6d2: böse Texte bleiben schnell", () => {
  // Jeder Anfang einer offenen Zeichenkette oder eines Kommentars sucht bis zum Zeilenende
  const zeile = (z: string): string => (z.repeat(Math.ceil(CODE_ZEILE_MAX / z.length)).slice(0, CODE_ZEILE_MAX - 1) + "\n");
  for (const muster of ['"\\', "/*", "'\\", "\"'"]) {
    // viele Zeilen knapp unter der Grenze – und eine einzige lange Zeile (ohne Grenze über 1 s)
    for (const text of [zeile(muster).repeat(Math.floor(CODE_FARBE_MAX / CODE_ZEILE_MAX)), muster.repeat(CODE_FARBE_MAX / 2)]) {
      const start = performance.now();
      assert.equal(zusammen(text), text);
      assert.ok(performance.now() - start < 1000, `${muster}: ${Math.round(performance.now() - start)} ms`);
    }
  }
});
