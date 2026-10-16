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

// C-57b: helles Design – dieselben Tokens, gewählt (`data-theme="hell"`) oder nach dem Gerät
const block = (kopf: string): Map<string, string> => {
  const i = css.indexOf(kopf);
  assert.ok(i >= 0, kopf);
  const inhalt = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return new Map([...inhalt.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};

test("helles Design: jede Farbe des dunklen hat einen hellen Wert, gewählt und nach dem Gerät gleich", () => {
  const dunkel = block(":root {");
  const hell = block(':root[data-theme="hell"] {');
  const geraet = block(':root:not([data-theme="dunkel"]) {');
  const farben = [...dunkel].filter(([, v]) => /^#[0-9a-fA-F]{3,8}$/.test(v)).map(([k]) => k);
  assert.ok(farben.length >= 30, `${farben.length} Farb-Tokens`);
  assert.deepEqual(farben.filter((k) => !hell.has(k)), [], "ohne hellen Wert");
  assert.deepEqual([...hell], [...geraet], "Wahl „Hell“ und „Wie das Gerät“ (hell) gleich");
  assert.match(css, /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme="dunkel"\]\) \{/);
  assert.match(css, /:root\[data-theme="hell"\] \{[^}]*color-scheme: light;/);
});

const hex = (h: string): [number, number, number] => {
  const x = h.length === 4 ? h.slice(1).split("").map((c) => c + c).join("") : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number];
};
const leuchte = (h: string): number => {
  const [r, g, b] = hex(h).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontrast = (a: string, b: string): number => {
  const [x, y] = [leuchte(a), leuchte(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("helles Design: Schrift mindestens 4,5:1 auf jeder Fläche, auch auf Grün und Rot", () => {
  const hell = block(':root[data-theme="hell"] {');
  const v = (k: string) => hell.get(k)!;
  const flaechen = ["--bg", "--card", "--surf", "--surf2", "--flaeche-hover", "--code-bg"];
  const schriften = ["--text", "--text-muted", "--text-leise", "--accent", "--red-text", "--amber", "--gold", "--farbe-ln",
    "--farbe-sol", "--farbe-tief", "--farbe-lokal", "--farbe-verdient", "--farbe-verliehen", "--farbe-angenommen", "--farbe-bluetooth",
    "--tok-kw", "--tok-str", "--tok-num"];
  const zuWenig: string[] = [];
  for (const f of flaechen) for (const s of schriften) {
    const k = kontrast(v(s), v(f));
    if (k < 4.5) zuWenig.push(`${s} auf ${f}: ${k.toFixed(2)}`);
  }
  assert.deepEqual(zuWenig, []);
  assert.ok(kontrast(v("--auf-akzent"), v("--accent")) >= 4.5, "Schrift auf Grün");
  assert.ok(kontrast("#FFFFFF", v("--red")) >= 4.5, "Weiß auf Rot");
});

test("Bilder aus Code nehmen die Tokens – kein festes Grün auf hellem Grund", () => {
  const hero = readFileSync(new URL("../src/hero.ts", import.meta.url), "utf8");
  const orb = readFileSync(new URL("../src/shell/tabs/agent-anzeige.ts", import.meta.url), "utf8");
  assert.match(hero, /token\("--bg", "#050505"\)/);
  assert.match(hero, /token\("--accent", "#7BC80A"\)/);
  assert.match(orb, /getPropertyValue\("--accent"\)/);
});
