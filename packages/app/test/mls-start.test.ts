/**
 * MLS-Engine nie beim Start (Schritt C-11, Sammlung C-11): Auch mit privaten
 * Räumen übersetzt die App beim Start kein WebAssembly. Ein privater Raum
 * öffnet erst beim Antippen, die Repos privater Räume kommen erst in die Liste,
 * wenn die Seite Repos oder ein privater Raum offen war. Der Smoke-Test
 * („mls_start“) zählt die Übersetzungen mit eingerichtetem Tresor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("C-11: beim Start nur einen offenen Raum öffnen – private erst beim Antippen", () => {
  const raeume = quelle("../src/shell/tabs/raeume.ts");
  const wire = raeume.slice(raeume.indexOf("export async function wireSpacesTab("));
  assert.match(wire, /if \(raeume\.length > 0 && !istPrivat\(raeume\[0\]\)\) await oeffneRaum\(raeume\[0\]\);\s*else void zeigeRaumLeiste\(\);/);
  // Erst wenn ein privater Raum offen ist (die Engine läuft), kommen dessen Repos in die Liste
  const privat = raeume.slice(raeume.indexOf("if (istPrivat(spaceId)) {"));
  assert.ok(privat.indexOf("await mlsAbgleichen([gruppe])") < privat.indexOf("void ladeNip34Repos({ privat: true });"));
});

test("C-11: Repos privater Räume erst nach der Seite Repos oder einem privaten Raum", () => {
  const repos = quelle("../src/shell/tabs/repos.ts");
  assert.match(repos, /let mitPrivaten = false;/);
  assert.match(repos, /export function ladeNip34Repos\(opts: \{ privat\?: boolean \} = \{\}\): Promise<void> \{\s*if \(opts\.privat\) mitPrivaten = true;/);
  assert.match(repos, /if \(mitPrivaten\) privat = await privateRaumRepos\(\)\.catch\(\(\) => \[\]\);/);
  // wireNip34() lädt beim Start gar nicht (seit C-15), die Seite Repos mit privaten
  assert.doesNotMatch(repos.slice(repos.indexOf("export function wireNip34(")), /ladeNip34Repos\(/);
  assert.match(quelle("../src/shell/app.ts"), /if \(name === "repos"\) void import\("\.\/tabs\/repos\.js"\)\.then\(\(m\) => m\.ladeNip34Repos\(\{ privat: true \}\)\);/);
  const smoke = quelle("../../../scripts/smoke_test.py");
  assert.match(smoke, /erg\["mls_start"\] = mls_start_pruefen\(browser,/);
  assert.match(smoke, /and erg\.get\("mls_start", \{\}\)\.get\("bestanden"\) is True/);
});
