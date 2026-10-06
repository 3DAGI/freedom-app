/**
 * D1a: Platzhalter in KI-Fragen – verdrahtet vor dem Versiegeln, zurückgesetzt
 * in der Antwort, je Unterhaltung neu, nie beim eigenen Knoten, die Zuordnung
 * nie gespeichert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lies = (d: string) => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("Vor dem Versiegeln: Frage und Verlauf ersetzt, nie beim eigenen Knoten; die Zahl je Anfrage gemerkt", () => {
  const agent = lies("shell/tabs/agent.ts");
  const bau = agent.slice(agent.indexOf("export async function buildJobEvent("), agent.indexOf("export let jobAbort"));
  assert.match(bau, /const eigen = kopplungFuer\(targetPubkey\);[\s\S]*const roh = pendingContextSummary \? pendingContextSummary \+ prompt : prompt;\n  const maske = eigen \? \{ text: roh, ersetzt: 0 \} : maskiere\(roh\);\n  const fullPrompt = maske\.text;/);
  assert.match(bau, /\["i", fullPrompt, "text"\]/);
  assert.match(bau, /input: fullPrompt,/);
  assert.equal(ohneKommentare(bau).match(/\broh\b/g)?.length, 3, "der rohe Text nur in seiner Definition und in der Maske – nie in der Anfrage");
  assert.match(bau, /eigen \? attachment\.name : maskiere\(attachment\.name\)\.text/);
  assert.match(bau, /merkeErsetzt\(auftrag\.requestId, maske\.ersetzt\);\n  merkeAnfrage\(auftrag\.requestId, empfaenger, hoechst, !!kanal\);\n  return auftrag;/);
});

test("Die Antwort bekommt die Werte zurück – angezeigt und im Verlauf nur die zurückgesetzte, darunter nur die Zahl", () => {
  const agent = lies("shell/tabs/agent.ts");
  const antwort = agent.slice(agent.indexOf("export async function handleAnswer("), agent.indexOf("export function resetSendBtn("));
  assert.match(antwort, /const ausgabe = entmaskiere\(r\.output\);[\s\S]*addAiMessageStreaming\("ai", ausgabe, ersetzt > 0 \? t\("agent\.platzhalterErsetzt", \{ n: ersetzt \}\) : ""/);
  assert.doesNotMatch(antwort, /addAiMessageStreaming\("ai", r\.output/);
  assert.match(antwort, /antwort: ausgabe \}/);
});

test("Über Funk ebenso; je Unterhaltung eine neue Zuordnung; die Zuordnung nie gespeichert", () => {
  const funk = lies("shell/ki-ueber-funk.ts");
  assert.match(funk, /const maske = maskiere\(prompt\);\n  const a = await baueFunkAuftrag\(\{ prompt: maske\.text,/);
  const verlauf = lies("shell/tabs/agent-verlauf.ts");
  assert.equal(verlauf.match(/neueZuordnung\(\);/g)?.length, 2, "neue Aufgabe und gewechselte Unterhaltung");
  const modul = ohneKommentare(lies("shell/ki-platzhalter.ts"));
  assert.doesNotMatch(modul, /geheim|sessionStorage|indexedDB|publish\(/);
  assert.deepEqual(modul.match(/localStorage\.(?:set|remove)Item\([^,)]+/g), ["localStorage.removeItem(LS_PLATZHALTER", "localStorage.setItem(LS_PLATZHALTER"],
    "gespeichert wird nur der Schalter, nie Werte oder Platzhalter");
  assert.match(modul, /export const LS_PLATZHALTER = "freedom\.platzhalter";/);
  assert.match(modul, /platzhalterAn\(\) \? ersetzeAngaben\(text, zuordnung, bekannteNamen\(\)\) : \{ text, ersetzt: 0 \}/);
});

test("Schalter in Settings › Datenschutz, Standard an", () => {
  assert.match(lies("shell/index.html"), /<input type="checkbox" id="ki-platzhalter" \/> <span data-i18n="set\.platzhalter">/);
  const mesh = lies("shell/tabs/mesh.ts");
  assert.match(mesh, /platzhalter\.checked = platzhalterAn\(\);\n    platzhalter\.onchange = \(\) => \{\n      setzePlatzhalter\(platzhalter\.checked\);/);
  assert.match(lies("shell/ki-platzhalter.ts"), /localStorage\.getItem\(LS_PLATZHALTER\) !== "aus"/, "an, solange nicht ausgeschaltet");
});
