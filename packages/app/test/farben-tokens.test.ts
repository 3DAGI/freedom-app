/**
 * Schritt C-57a (Oberflächen-Review 15.10.2026): jede Farbe als Token. Bis jetzt standen rund 70 Farben fest im CSS –
 * ein helles Design hätte jede einzeln gebraucht. Fest bleiben nur Farben, die in beiden Designs gleich sind: Weiß auf
 * farbigem Grund (Avatare, Rot), Schwarz unter Videos und in Masken.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/shell/app.css", import.meta.url), "utf8");
const ERLAUBT = new Set(["#fff", "#000", "#3a3f44"]);

test("Farben stehen nur in den Token-Definitionen – außer Weiß/Schwarz für beide Designs", () => {
  const funde: string[] = [];
  // Kommentare (auch über mehrere Zeilen) weg, die Zeilennummern bleiben
  const ohne = css.replace(/\/\*[\s\S]*?\*\//g, (k) => k.replace(/[^\n]/g, ""));
  for (const [i, ohneKommentar] of ohne.split("\n").entries()) {
    if (/^\s*--[a-z0-9-]+:/.test(ohneKommentar) || /^:root/.test(ohneKommentar) || ohneKommentar.includes("data-farbe")) continue;
    for (const m of ohneKommentar.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      if (!ERLAUBT.has(m[0].toLowerCase())) funde.push(`${i + 1}: ${m[0]}`);
    }
  }
  assert.deepEqual(funde, []);
});

test("jede benutzte Variable ist definiert (kein stiller Fallback mehr)", () => {
  const benutzt = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const definiert = new Set([...css.matchAll(/(?:^|[{;\s])(--[a-z0-9-]+):/gm)].map((m) => m[1]));
  assert.deepEqual([...benutzt].filter((v) => !definiert.has(v)), []);
  assert.doesNotMatch(css, /var\(--[a-z0-9-]+, ?#/, "keine Fallback-Farben neben Tokens");
});

test("Schrift auf Grün über --auf-akzent – das helle Design braucht dort Weiß", () => {
  assert.match(css, /button\.primaer, \.dlg-knoepfe button:not\(\.ghost\):not\(\.dlg-gefahr\) \{ background: var\(--accent\); color: var\(--auf-akzent\);/);
  assert.match(css, /\.chip\[aria-pressed="true"\] \{ background: var\(--accent\); color: var\(--auf-akzent\);/);
  assert.doesNotMatch(css, /background: var\(--accent\); color: #000/);
});
