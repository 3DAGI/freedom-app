/**
 * Projekte-Seite (VKe): Schritte eines Laufs kommen in beliebiger Reihenfolge (Umschläge mit zufälliger Ankunft) –
 * geordnet nach `nr`, `befehl` vor `ausgabe`; ein Schritt wartet auf mich, solange ein `befehl` mit `wartet` und noch
 * keine `ausgabe` da ist und ich nicht geantwortet habe. Wie der Lauf endete, kommt nur aus der Kennung. Die Seite
 * zeigt alles nur als Text, Freigabe und Stopp gehen nur über `frageKnotenCode()`, der Auftrag über `wegZumKnoten()`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CODE_ENDEN, KIND_DVM_KNOTEN_CODE, codeSchrittText, type NostrEvent } from "@freedomstack/protocol";
import { setLang } from "../src/i18n.js";
import { CODE_ENDE_TEXT, codeText, endeText, neuerLauf, nimmSchritt, wartetAufMich, werteAbrufAus } from "../src/knoten-lauf.js";
import { settings } from "../src/texte/settings.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("VKe: Schritte nach nr geordnet, Ausgabe vor dem Befehl geht nicht verloren, doppelt ändert nichts", () => {
  const s = neuerLauf("a".repeat(64), "app", "fragen", "Baue eine Seite");
  assert.equal(nimmSchritt(s, { nr: 2, art: "ausgabe", ausgabe: "ok", code: 0, gekuerzt: false }), true);
  assert.equal(nimmSchritt(s, { nr: 1, art: "befehl", gedanke: "Erst lesen.", befehl: "ls", wartet: false }), true);
  assert.equal(nimmSchritt(s, { nr: 2, art: "befehl", gedanke: "", befehl: "npm test", wartet: false }), true);
  assert.equal(nimmSchritt(s, { nr: 1, art: "befehl", gedanke: "Erst lesen.", befehl: "ls", wartet: false }), false, "derselbe Umschlag zweimal");
  assert.deepEqual(s.schritte.map((z) => [z.nr, z.befehl, z.ausgabe?.text]), [[1, "ls", undefined], [2, "npm test", "ok"]]);
  assert.equal(s.schritte[0]!.gedanke, "Erst lesen.");
});

test("VKe: wartet auf mich nur mit wartet, ohne Ausgabe, unbeantwortet und vor dem Ende", () => {
  const s = neuerLauf("b".repeat(64), "app", "fragen", "x");
  nimmSchritt(s, { nr: 1, art: "befehl", gedanke: "", befehl: "rm -rf build", wartet: false });
  assert.equal(wartetAufMich(s.schritte[0]!, s), false);
  // derselbe Schritt kommt ein zweites Mal mit wartet (PROTOCOL §34) – auch wenn ein späteres „wartet: false“ folgt
  nimmSchritt(s, { nr: 1, art: "befehl", gedanke: "", befehl: "rm -rf build", wartet: true });
  nimmSchritt(s, { nr: 1, art: "befehl", gedanke: "", befehl: "rm -rf build", wartet: false });
  assert.equal(wartetAufMich(s.schritte[0]!, s), true);
  s.schritte[0]!.beantwortet = "ja";
  assert.equal(wartetAufMich(s.schritte[0]!, s), false, "schon beantwortet");
  delete s.schritte[0]!.beantwortet;
  nimmSchritt(s, { nr: 1, art: "ausgabe", ausgabe: "", code: 0, gekuerzt: false });
  assert.equal(wartetAufMich(s.schritte[0]!, s), false, "mit Ausgabe wartet nichts mehr");
  nimmSchritt(s, { nr: 2, art: "befehl", gedanke: "", befehl: "x", wartet: true });
  s.ende = { aktion: "auftrag", ende: "gestoppt", schritte: 2, abschluss: "" };
  assert.equal(wartetAufMich(s.schritte[1]!, s), false, "nach dem Ende keine Knöpfe");
});

test("VKe: wie der Lauf endete – jede Kennung mit Text in beiden Sprachen, nie Text vom Knoten", () => {
  assert.deepEqual(Object.keys(CODE_ENDE_TEXT).sort(), [...CODE_ENDEN].sort());
  for (const k of [...Object.values(CODE_ENDE_TEXT), "set.laufZeitUm", "set.laufCode", "set.laufSchweigt", "set.laufWartet", "set.modusFragen", "set.modusFrei"]) {
    const e = (settings as Record<string, { de: string; en: string }>)[k];
    assert.ok(e?.de && e.en, k);
  }
  setLang("de");
  assert.equal(endeText({ ende: "fertig", schritte: 3 }), "Fertig (Schritte: 3)");
  assert.equal(codeText(-1), "Zeit um");
  assert.equal(codeText(2), "Rückgabe 2");
  // ehrlich: „fragen“ heißt nicht „vor jedem Befehl“ – Hermes fragt vor Dateien und riskanten Befehlen (VKc3a)
  assert.doesNotMatch(settings["set.modusFragen"].de, /jede[nm]? Befehl/);
  setLang("en");
});

test("VKe: Seite nur als Text, Freigabe und Stopp über frageKnotenCode(), der Auftrag über den Weg zu meinem Knoten", () => {
  const ui = lies("shell/knoten-projekt-ui.ts");
  assert.ok(!ui.includes("innerHTML"));
  assert.match(ui, /frage\(k, \{ aktion: "freigabe", lauf: stand\.lauf, schritt: z\.nr, ja \}/);
  assert.match(ui, /frage\(k, \{ aktion: "stopp", lauf: stand!\.lauf \}/);
  assert.match(ui, /const weg = await wegZumKnoten\(k\.knoten, sitzung\);\n\s+if \(!weg\) return toast/);
  assert.match(ui, /markdownDom\(stand\.ende\.abschluss/);
  assert.ok(!/localStorage|geheim\.setItem/.test(ui), "nichts gemerkt");
  const liste = lies("shell/knoten-code-ui.ts");
  assert.match(liste, /oeffneProjekt\(name, frageKnotenCode\)/);
  assert.match(liste, /istProjektName\(String\(x\.name\)\.trim\(\)\)/);
  const weg = lies("shell/knoten-weg-ui.ts");
  assert.match(weg, /if \(gesehen\.has\(w\.id\)\) continue;/, "jeder Umschlag nur einmal");
  // seit C-60 über werteAbrufAus(): Schritte nur aus 7000 „partial“ über leseCodeSchritt(), erst alle Schritte, dann das Ende
  assert.match(weg, /werteAbrufAus\(antworten, requestId, KIND_DVM_KNOTEN_CODE \+ 1000\)/);
  assert.match(lies("knoten-lauf.ts"), /a\.kind === 7000 && getTag\(a, "status"\) === "partial"\)\s*\.map\(\(a\) => leseCodeSchritt\(a\.content\)\)/);
});

test("C-60: ein Abruf mit Ergebnis und letzter Ausgabe – erst alle Schritte, dann das Ende, auch wenn das Ergebnis vorn steht", () => {
  const lauf = "c".repeat(64), anderer = "d".repeat(64);
  const ev = (kind: number, tags: string[][], content: string, created_at: number) =>
    ({ id: "", pubkey: "", sig: "", kind, tags, content, created_at }) as NostrEvent;
  const schritt = (nr: number, t: number, auftrag = lauf) =>
    ev(7000, [["e", auftrag], ["status", "partial"]], codeSchrittText({ nr, art: "ausgabe", ausgabe: `aus ${nr}`, code: 0, gekuerzt: false }), t);
  const ergebnis = ev(KIND_DVM_KNOTEN_CODE + 1000, [["e", lauf]], "{\"aktion\":\"auftrag\"}", 101);
  // so liefert der Pool: die neueste zuerst – das Ergebnis vor der Ausgabe, die eine Sekunde älter ist
  const r = werteAbrufAus([ergebnis, schritt(2, 100), schritt(1, 99), schritt(9, 100, anderer)], lauf, KIND_DVM_KNOTEN_CODE + 1000);
  assert.deepEqual(r.schritte.map((s) => s.nr), [2, 1], "beide Schritte, keiner aus einem anderen Lauf");
  assert.deepEqual(r.ende, { ergebnis: "{\"aktion\":\"auftrag\"}" });
  // eine Ablehnung beendet den Lauf, ihre Kennung kommt mit; ohne Ende bleibt es offen
  const nein = ev(7000, [["e", lauf], ["status", "error"], ["fall", "code-ohne-motor"]], "kein Motor", 102);
  assert.deepEqual(werteAbrufAus([nein, schritt(1, 99)], lauf, KIND_DVM_KNOTEN_CODE + 1000).ende, { abgelehnt: "kein Motor", fall: "code-ohne-motor" });
  assert.equal(werteAbrufAus([schritt(1, 99)], lauf, KIND_DVM_KNOTEN_CODE + 1000).ende, null);
  assert.deepEqual(werteAbrufAus([ev(7000, [["e", lauf], ["status", "partial"]], "kaputt", 1)], lauf, KIND_DVM_KNOTEN_CODE + 1000).schritte, [], "Unlesbares fällt weg");
});
