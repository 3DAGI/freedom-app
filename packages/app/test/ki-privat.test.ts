/**
 * D2: Privat-Schalter je Unterhaltung – nur dieses Gerät oder der eigene
 * Knoten, nie Funk, nie das Netz (also auch keine Prüfrunde), nie still
 * ausweichen; der Haken gehört zur Unterhaltung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kiWeg, wegErlaubt, type KiWeg } from "../src/ki-privat.js";

const lies = (d: string) => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("Weg wie askAi() entscheidet: Funk vor Gerät vor Knoten vor Netz; privat nur Gerät und Knoten", () => {
  assert.equal(kiWeg({ funk: true, geraet: true, knoten: true }), "funk", "Funk zuerst – auch mit gewähltem Gerät");
  assert.equal(kiWeg({ funk: false, geraet: true, knoten: true }), "geraet");
  assert.equal(kiWeg({ funk: false, geraet: false, knoten: true }), "knoten");
  assert.equal(kiWeg({ funk: false, geraet: false, knoten: false }), "netz");
  const alle: KiWeg[] = ["funk", "geraet", "knoten", "netz"];
  assert.deepEqual(alle.filter((w) => wegErlaubt(true, w)), ["geraet", "knoten"]);
  assert.deepEqual(alle.filter((w) => wegErlaubt(false, w)), alle, "ohne Haken wie bisher");
});

test("askAi(): die Sperre steht vor jedem Weg – Funk, Gerät, Knoten, Netz – und vor allem, was etwas sendet", () => {
  const agent = lies("shell/tabs/agent.ts");
  const ask = ohneKommentare(agent.slice(agent.indexOf("export async function askAi("), agent.indexOf("async function frageUeberFunk(") > 0 ? agent.indexOf("async function frageUeberFunk(") : undefined));
  const sperre = ask.indexOf("if (!wegErlaubt(privatGewaehlt(), weg)) {");
  assert.ok(sperre > ask.indexOf("if (!prompt) return;"), "nach der Prüfung des Prompts (Stopp bleibt davor)");
  for (const danach of ["await frageUeberFunk(", "await frageAufDiesemGeraet(", "await frageMeinenKnoten(", "await askSwarm(", "await askWithFailover(", "addAiMessage(\"user\"", "btn.dataset.running = \"1\""]) {
    const i = ask.indexOf(danach);
    assert.ok(i > sperre, `${danach} erst nach der Sperre`);
  }
  assert.match(ask, /if \(!wegErlaubt\(privatGewaehlt\(\), weg\)\) \{\n    toast\(t\("agent\.privatNurGeraet"\), true\);\n    return;\n  \}/, "nichts hinaus, nie still ausweichen");
  // Die Eingaben des Wegs sind dieselben wie die Weichen darunter
  assert.match(ask, /const weg = kiWeg\(\{ funk: \(\$\("#ai-funk"\) as HTMLInputElement \| null\)\?\.checked === true, geraet: !!lokalesModellAus\(wahl\), knoten: knotenModellAus\(wahl\) !== null \}\);/);
  assert.match(ask, /if \(\(\$\("#ai-funk"\) as HTMLInputElement \| null\)\?\.checked\) \{/);
  assert.match(ask, /const lokalModell = lokalesModellAus\(\(\$\("#ai-model"\) as HTMLInputElement \| null\)\?\.value\);/);
  assert.match(ask, /const knotenModell = knotenModellAus\(\(\$\("#ai-model"\) as HTMLInputElement \| null\)\?\.value\);/);
  // Andere Wege zur KI gibt es nicht: „Erneut“ geht über askAi()
  assert.match(lies("shell/tabs/agent-anzeige.ts"), /void askAi\(\);/);
});

test("Der Haken gehört zur Unterhaltung: mit ihr gemerkt, beim Öffnen gesetzt, neu offen; Texte in beiden Sprachen", () => {
  const html = lies("shell/index.html");
  assert.match(html, /<label id="ai-privat-wahl"[^>]*data-i18n-title="agent\.privatTitel"><input type="checkbox" id="ai-privat" data-i18n-aria="agent\.privatAria"[^>]*\/> <span data-i18n="agent\.privat">/);
  const v = lies("shell/tabs/agent-verlauf.ts");
  assert.match(v, /messages: \[\],\n      \.\.\.\(privatGewaehlt\(\) \? \{ privat: true \} : \{\}\),/, "die neue Unterhaltung übernimmt den Haken");
  assert.match(v, /aktuellerVerlauf = v;\n  setzePrivatHaken\(v\.privat === true\);/);
  assert.match(v, /wechsleKiSchluessel\(\);[^\n]*\n  setzePrivatHaken\(false\);/, "neue Aufgabe beginnt offen");
  assert.match(v, /aktuellerVerlauf\.privat = h\.checked \|\| undefined;[\s\S]*?speichereVerlaeufe\(alle\);/, "geändert mit der Unterhaltung gemerkt");
  assert.doesNotMatch(ohneKommentare(v), /localStorage/, "der Verlauf liegt nur im Tresor");
  assert.match(lies("shell/app.ts"), /wirePrivat\(\);/);
  const texte = lies("texte/agent.ts");
  for (const k of ["agent.privat", "agent.privatAria", "agent.privatTitel", "agent.privatNurGeraet"]) {
    assert.match(texte, new RegExp(`"${k.replace(".", "\\.")}": \\{ de: "[^"]+", en: "[^"]+" \\}`), k);
  }
});
