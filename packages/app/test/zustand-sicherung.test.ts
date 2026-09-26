/**
 * Schritt 8.12: Die App sichert nur die feste Liste und holt nur sie zurueck –
 * jeden Wert aus seinem Speicher (Tresor oder localStorage).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SICHERUNG_EINTRAEGE } from "@freedomstack/protocol";

function dateien(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "shims" ? [] : dateien(new URL(`${e.name}/`, dir));
    return e.name.endsWith(".ts") ? [readFileSync(new URL(e.name, dir), "utf8")] : [];
  });
}
const app = dateien(new URL("../src/", import.meta.url)).join("\n");
const settings = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
const tresor = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");

function funktion(text: string, kopf: string): string {
  const start = text.indexOf(kopf);
  assert.ok(start >= 0, `${kopf} nicht gefunden`);
  return text.slice(start, text.indexOf("\n}\n", start));
}

test("8.12: Sichern nur ueber waehleSicherung, Werte aus Tresor oder localStorage", () => {
  const f = funktion(settings, "async function sammleZustand(");
  assert.match(f, /waehleSicherung\(alle, \(k\) => \(istGeheimnis\(k\) \? geheim\.getItem\(k\) : localStorage\.getItem\(k\)\)\)/);
  assert.doesNotMatch(settings, /\\\.\(sk\|identity\|secret\)/, "der alte Namensfilter ist weg");
});

test("8.12: Zurueckholen nur ueber filtereWiederherstellung, Geheimes in den Tresor", () => {
  const f = funktion(settings, "async function stelleZustandWieder(");
  assert.match(f, /const daten = filtereWiederherstellung\(r\.data\);/);
  assert.match(f, /if \(istGeheimnis\(k\)\) await geheim\.setItem\(k, v\);\n\s+else localStorage\.setItem\(k, v\);/);
  assert.doesNotMatch(f, /Object\.entries\(r\.data\)/, "nie ungefiltert zurueckschreiben");
});

test("8.12: jeder gesicherte Eintrag, den die App im Tresor fuehrt, gilt als Geheimnis – und umgekehrt", () => {
  const fest = /const GEHEIM_FEST = \[([^\]]+)\]/.exec(tresor)![1]!;
  const praefixe = /const GEHEIM_PRAEFIXE = \[([^\]]+)\]/.exec(tresor)![1]!;
  const geheimFest = [...fest.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).concat(["freedom.nsec", "freedom.bunker"]);
  const geheimPraefixe = [...praefixe.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const istGeheim = (k: string) => geheimFest.includes(k) || geheimPraefixe.some((p) => k.startsWith(p));
  for (const k of SICHERUNG_EINTRAEGE) {
    const esc = k.replace(/\./g, "\\.");
    const imTresor = new RegExp(`geheim\\.(get|set)Item\\("${esc}"`).test(app);
    const offen = new RegExp(`localStorage\\.(get|set)Item\\("${esc}"`).test(app);
    if (imTresor) assert.ok(istGeheim(k), `${k} liegt im Tresor, istGeheimnis kennt ihn nicht`);
    if (offen) assert.ok(!istGeheim(k), `${k} liegt in localStorage, gilt aber als Geheimnis`);
  }
  assert.ok(istGeheim("freedom.chats"), "Unterhaltungen liegen im Tresor");
});
