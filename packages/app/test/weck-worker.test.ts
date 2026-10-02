/**
 * Weck-Worker (Sammlung B-12c, Entscheidungen W2 A, W3 A): eine zweite Datei
 * neben freedom.html, nur zum Wecken – fester Text ohne Inhalt und Absender,
 * kein Cache, kein `fetch`. Die CSP erlaubt Worker nur von derselben Herkunft;
 * Build, Website, reproduzierbarer Build und Release führen die Datei mit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wecken } from "../src/texte/wecken.js";

const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const wurzel = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("B-12c: der Worker weckt nur – fester Text, nichts aus dem Push, kein Cache, kein fetch", () => {
  const sw = lies("src/sw/freedom-sw.ts");
  const code = sw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.deepEqual([...code.matchAll(/addEventListener\("(\w+)"/g)].map((m) => m[1]), ["install", "push", "notificationclick"], "nur diese drei Ereignisse");
  for (const verboten of [/\bfetch\b/, /\bcaches\b/, /importScripts/, /\.data\b/, /indexedDB|localStorage/, /postMessage/]) {
    assert.doesNotMatch(code, verboten, `nicht im Worker: ${verboten}`);
  }
  assert.match(code, /showNotification\(wecken\["weck\.titel"\]\[sprache\], \{ body: wecken\["weck\.text"\]\[sprache\], tag: WECK_TAG \}\)/, "nur der feste Text");
  assert.match(code, /import \{ wecken \} from "\.\.\/texte\/wecken\.js";/);
  assert.equal((code.match(/^import /gm) ?? []).length, 1, "keine weiteren Module im Worker");
  // Ein Klick öffnet nur die App neben dem Worker – keine Adresse von außen
  assert.match(code, /new URL\("freedom\.html", sw\.registration\.scope\)\.href/);
  assert.match(code, /searchParams\.get\("sprache"\)/, "Sprache der App aus der eigenen Adresse");
  for (const k of ["weck.titel", "weck.text"] as const) {
    assert.ok(wecken[k]?.de && wecken[k]?.en, k);
    assert.doesNotMatch(wecken[k].de + wecken[k].en, /\{/, "keine Platzhalter – es gibt nichts einzusetzen");
  }
});

test("B-12c: CSP – Worker nur von derselben Herkunft; der Build schreibt freedom-sw.js und prüft ihn", () => {
  const b = lies("build.mjs");
  assert.match(b, /"worker-src blob: 'self'",/);
  assert.equal((b.match(/worker-src/g) ?? []).length, 1);
  assert.doesNotMatch(b, /script-src[^"]*'self'/, "Skripte der Seite weiter nur per Hash");
  assert.match(b, /entryPoints: \[join\(root, "src\/sw\/freedom-sw\.ts"\)\]/);
  assert.match(b, /await writeFile\(join\(root, "dist\/freedom-sw\.js"\), swJs\);/);
  assert.match(b, /importScripts\\b\|addEventListener\\\("fetch"\|\\bcaches\\b/, "der Build bricht ab, wenn der Worker etwas lädt");
  assert.match(b, /`\$\{sha\}  freedom\.html\\n`/, "die Summen-Datei der App bleibt, wie sie war (Knoten, B-10)");
});

test("B-12c: Website, reproduzierbarer Build, Pages und Release führen den Worker mit", () => {
  const site = wurzel("scripts/build-site.sh");
  assert.match(site, /cp "\$ROOT\/packages\/app\/dist\/freedom-sw\.js" "\$OUT"\/freedom-sw\.js/);
  const repro = wurzel("scripts/repro-build.sh");
  assert.match(repro, /sw="\$\(sha256sum "\$ziel\/packages\/app\/dist\/freedom-sw\.js"/, "beide Summen je Build");
  assert.match(repro, /\[ "\$A" = "\$B" \]/, "zwei Builds: App und Worker gleich");
  assert.match(repro, /--vergleiche-ordner\)/);
  assert.match(wurzel(".github/workflows/pages.yml"), /run: bash scripts\/repro-build\.sh --vergleiche-ordner site/, "veröffentlicht nur, was bitgleich nachgebaut ist");
  assert.match(wurzel("scripts/publish-release.mjs"), /\{ name: "freedom-sw\.js", sha256: createHash\("sha256"\)\.update\(sw\)\.digest\("hex"\), sizeBytes: sw\.length \}/);
});

test("B-12c: die App meldet noch keinen Worker an – das tut erst der Haken aus B-12d", () => {
  const app = lies("src/shell/app.ts");
  assert.doesNotMatch(app, /serviceWorker/);
  assert.doesNotMatch(lies("src/shell/knoten-weg-ui.ts") + lies("src/shell/mein-knoten.ts"), /serviceWorker/);
});
