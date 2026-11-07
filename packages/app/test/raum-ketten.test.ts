/**
 * Schritt 11.3e3: Schalter „Agenten sprechen Agenten an“ (Entwurf `docs/AGENTEN-RAUM-ENTWURF.md`,
 * „Agentenketten“, F5) – Standard aus, an mit Grenze 1 … 50. Offen in der Definition des
 * Gründers, privat im Raumstand; wer die Definition neu schreibt, nimmt den Schalter mit.
 * Seit 11.5c4 ebenso „Pakete für Agenten holen“ im privaten Raum (`mitSchaltern()`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KIND_SPACE, leseAgentenketten, leseRepoPakete, type InneresEvent } from "@freedomstack/protocol";
import { leseGrenze, mitKetten, mitSchaltern, privateDefinition } from "../src/raum-ketten.js";

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");
const BASIS = [["d", "space:x"], ["space", "x"], ["name", "Raum"]];

test("mitKetten: an setzt genau ein Tag, ändern ersetzt, aus entfernt – die übrigen Tags bleiben", () => {
  const an = mitKetten(BASIS, 12);
  assert.deepEqual(an, [...BASIS, ["agentenketten", "12"]]);
  assert.equal(leseAgentenketten(an), 12);
  const geaendert = mitKetten(an, 3);
  assert.deepEqual(geaendert.filter((t) => t[0] === "agentenketten"), [["agentenketten", "3"]], "nie zwei Schalter");
  assert.deepEqual(mitKetten(geaendert, null), BASIS);
  assert.notEqual(mitKetten(BASIS, null), BASIS, "eine Kopie");
  assert.throws(() => mitKetten(BASIS, 0));
  assert.throws(() => mitKetten(BASIS, 51), "höchstens 50");
});

test("11.5c4: mitSchaltern – beide Schalter der geltenden Definition gehen mit, `neu` ändert genau einen", () => {
  const geltend = [...BASIS, ["agentenketten", "7"], ["repo_pakete", "sperrdatei"], ["kasse", "alt"]];
  const frisch = [...BASIS, ["kasse", "neu"]];
  const mit = mitSchaltern(frisch, geltend);
  assert.deepEqual(mit, [...frisch, ["agentenketten", "7"], ["repo_pakete", "sperrdatei"]], "nur die Schalter, nie andere Tags der alten");
  const ohnePakete = mitSchaltern(frisch, geltend, { pakete: false });
  assert.equal(leseRepoPakete(ohnePakete), false);
  assert.equal(leseAgentenketten(ohnePakete), 7, "die Ketten bleiben");
  const ohneKetten = mitSchaltern(frisch, geltend, { ketten: null });
  assert.equal(leseAgentenketten(ohneKetten), null);
  assert.equal(leseRepoPakete(ohneKetten), true, "die Pakete bleiben");
  assert.deepEqual(mitSchaltern(frisch, BASIS), frisch, "Vorgabe: beide aus");
  assert.equal(leseRepoPakete(mitSchaltern(frisch, BASIS, { pakete: true })), true);
});

test("Grenze aus dem Feld: 1 bis 50, sonst keine", () => {
  assert.equal(leseGrenze("10"), 10);
  assert.equal(leseGrenze(" 50 "), 50);
  for (const unfug of ["", "0", "51", "1.5", "-3", "abc", "100"]) assert.equal(leseGrenze(unfug), undefined, unfug);
});

test("Private Definition: die neueste eines Admins – Mitglieder zählen nicht", () => {
  const ev = (von: string, zeit: number, tags: string[][], admin?: boolean): InneresEvent =>
    ({ id: `${von}${zeit}`, von, zeit, art: KIND_SPACE, tags, text: "", ...(admin !== undefined ? { admin } : {}) }) as InneresEvent;
  const admin = "a".repeat(64);
  const mitglied = "b".repeat(64);
  const evs = [ev(admin, 10, [...BASIS, ["agentenketten", "5"]]), ev(mitglied, 20, BASIS), ev(admin, 5, BASIS)];
  assert.equal(leseAgentenketten(privateDefinition(evs, [admin])), 5, "das neuere Mitglied ändert nichts");
  assert.equal(leseAgentenketten(privateDefinition([...evs, ev(mitglied, 30, BASIS, true)], [admin])), null, "MDK belegt den Admin – dann zählt er");
  assert.deepEqual(privateDefinition([], [admin]), []);
});

test("Verdrahtet: privat nimmt jede neue Definition den Schalter mit, offen nie in derselben Sekunde, Menü nur für Verwalter", () => {
  const mls = lies("shell/raum-mls.ts");
  assert.match(mls, /return \{ \.\.\.d, tags: mitSchaltern\(d\.tags, privateDefinition\(raum\.ereignisse, raum\.admins\), neu\) \};/);
  assert.equal((mls.match(/definitionMitKetten\(raum, \{/g) ?? []).length, 5, "Raumstand, Kanal anlegen, Kanal ändern, Kasse (A-12b2b), Pakete (11.5c4)");
  // Auch wer die Ketten umschaltet, nimmt „Pakete holen“ mit (11.5c4) – und umgekehrt
  assert.match(mls, /tags: mitSchaltern\(d\.tags, privateDefinition\(raum\.ereignisse, raum\.admins\), \{ ketten: grenze \}\)/);
  assert.match(mls, /definitionMitKetten\(raum, \{ name: sp\.name, beschreibung: sp\.description, kanaele: sp\.channels \}, \{ pakete: an \}\)/);
  assert.doesNotMatch(mls, /mitKetten\(/, "nie mehr nur die Ketten");
  assert.doesNotMatch(mls.slice(mls.indexOf("export async function sendeRaumstand(")), /raumDefinition\(raum\.gruppe, \{ name: st\.space/);
  const setze = mls.slice(mls.indexOf("export function setzePrivateKetten("), mls.indexOf("/** Den Raumstand"));
  assert.match(setze, /if \(!sp \|\| !raum\.admins\.includes\(raum\.ich\)\) return Promise\.resolve\(false\);/);
  const ui = lies("shell/raum-ketten-ui.ts");
  assert.match(ui, /const zeit = Math\.max\(Math\.floor\(Date\.now\(\) \/ 1000\), offen\.zeit \+ 1\);/);
  assert.match(ui, /buildEvent\(state\.keypair\.pk, KIND_SPACE, mitKetten\(offen\.tags, neu\), "", zeit\)/);
  assert.match(ui, /authors: \[ort\.besitzer\]/, "nur die Definition des Gründers");
  const raeume = lies("shell/tabs/raeume.ts");
  assert.match(raeume, /document\.getElementById\("space-ketten"\)\?\.classList\.toggle\("hidden", !verwalten \|\| alsGeraet\(\) \|\| !agentOrt\(\)\);/);
  // Pakete für Agenten holen (11.5c4): nur privat, nur Moderatoren, nie als Gerät
  assert.match(raeume, /document\.getElementById\("space-pakete"\)\?\.classList\.toggle\("hidden", !privat \|\| !moderator \|\| alsGeraet\(\)\);/);
  assert.match(raeume, /if \(raum\) void import\("\.\.\/raum-pakete-ui\.js"\)\.then\(async \(m\) => \{ if \(\(await m\.stellePaketeEin\(raum\)\) && spacesUi\.spaceId\) await oeffneRaum\(spacesUi\.spaceId\); \}\);/);
  const pakete = lies("shell/raum-pakete-ui.ts");
  assert.match(pakete, /const jetzt = leseRepoPakete\(privateDefinition\(raum\.ereignisse, raum\.admins\)\);/);
  assert.match(pakete, /const ok = await setzePrivatePakete\(raum, neu\)\.catch\(\(\) => false\);/);
  assert.doesNotMatch(pakete, /publish\(|localStorage|geheim/, "nur in die Gruppe, nichts gemerkt");
  const setzePakete = mls.slice(mls.indexOf("export function setzePrivatePakete("), mls.indexOf("/** Den Raumstand"));
  assert.match(setzePakete, /if \(!sp \|\| !raum\.admins\.includes\(raum\.ich\)\) return Promise\.resolve\(false\);/);
  assert.match(lies("shell/index.html"), /id="space-pakete" class="menue-punkt hidden"[^>]*data-i18n="pakete\.menue"/);
  assert.match(raeume, /if \(ort\) void import\("\.\.\/raum-ketten-ui\.js"\)\.then\(async \(m\) => \{ if \(\(await m\.stelleKettenEin\(ort\)\) && spacesUi\.spaceId\) await oeffneRaum\(spacesUi\.spaceId\); \}\);/);
});
