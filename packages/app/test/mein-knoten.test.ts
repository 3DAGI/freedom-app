/**
 * Mein Knoten (B-8c): Der Kopplungscode liegt nur auf dem Gerät (im Tresor,
 * nie in Sicherung oder Export) und wird nur an den gekoppelten Knoten als
 * Nachweis verwendet; die Karte in Settings → Geräte nur mit textContent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_NIE, generateKeypair, kopplungscode, neueKopplung, waehleSicherung } from "@freedomstack/protocol";
import { waehleExport } from "../src/datenexport.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const LS = "freedom.knoten.kopplung";

test("B-8c: der Kopplungscode nur auf dem Gerät – im Tresor, nie in Sicherung oder Export", () => {
  const code = kopplungscode(neueKopplung(generateKeypair().pk));
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS)));
  assert.ok(!(LS in waehleSicherung([LS], () => code)));
  assert.ok(!(LS in waehleExport([LS], () => code)));
  const tresor = lies("shell/tresor.ts");
  assert.match(tresor.slice(tresor.indexOf("const GEHEIM_FEST"), tresor.indexOf("const GEHEIM_PRAEFIXE")), /"freedom\.knoten\.kopplung"/);
  const k = lies("shell/mein-knoten.ts");
  assert.match(k, /export const LS_KOPPLUNG = "freedom\.knoten\.kopplung";/);
  assert.match(k, /await geheim\.setItem\(LS_KOPPLUNG, kopplungscode\(k\)\);/);
  assert.doesNotMatch(k, /localStorage|innerHTML|publish|console\./, "nur geheim, nur Text, nichts hinaus, nichts ins Log");
});

test("B-8c: verdrahtet – Karte in Settings → Geräte, Code verdeckt und scanbar, streng geprüft", () => {
  const html = lies("shell/index.html");
  const geraete = html.slice(html.indexOf('data-subpane="settings:devices"'), html.indexOf('id="bunker-karte"'));
  for (const id of ["knoten-karte", "knoten-status", "knoten-koppeln", "knoten-entkoppeln"]) assert.ok(geraete.includes(`id="${id}"`), id);
  assert.match(lies("shell/app.ts"), /wireBunkerKarte\(beschaeftigt\);\n\s+wireMeinKnoten\(\);/);
  const k = lies("shell/mein-knoten.ts");
  assert.match(k, /\{ art: "text", name: "code", label: t\("set\.knotenCode"\), pflicht: true, mono: true, scannen: true, verdeckt: true \}/);
  assert.match(k, /pruefe: \(v\) => \(leseKopplungscode\(String\(v\.code \?\? ""\)\) \? null : t\("set\.knotenCodeFalsch"\)\),/);
  assert.match(k, /if \(alt && alt\.knoten !== k\.knoten\n\s+&& !await bestaetige\(/, "einen anderen Knoten ersetzt es nur nach Rückfrage");
  assert.match(k, /export function kopplungFuer\(knoten: string\): Kopplung \| null \{\n\s+const k = meineKopplung\(\);\n\s+return k && k\.knoten === knoten \? k : null;/);
  assert.match(lies("shell/tabs/agent.ts"), /import \{ kopplungFuer \} from "\.\.\/mein-knoten\.js";/);
});
