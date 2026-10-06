/**
 * P5c: Prüfrunden – wer zusätzlich gefragt wird und wie drei Antworten
 * ausgewertet werden. Übereinstimmung heißt nie „richtig“; bei Streit gibt es
 * keine Aussage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mitEinig, rueckgabeMsat, waehleZusatz, werteRundeAus } from "../src/pruefrunde.js";

const pk = (c: string) => c.repeat(64);
/** Feste Zufallsfolge – nie echter Zufall im Test. */
const folge = (...w: number[]) => { let i = 0; return () => w[i++ % w.length]!; };

test("Zusätzliche Provider: nie der gewählte, nie eigene Knoten, keine Doppelten; gleiches Modell zuerst", () => {
  const k = [
    { pk: pk("a"), modelle: ["m"] }, { pk: pk("b"), modelle: ["x"] }, { pk: pk("c"), modelle: ["m", "x"] },
    { pk: pk("c"), modelle: ["m"] }, { pk: pk("d"), modelle: ["m"] }, { pk: pk("e"), modelle: ["x"] },
  ];
  const r = waehleZusatz(k, { haupt: pk("a"), modell: "m", eigene: new Set([pk("d")]), zufall: folge(0.99) });
  assert.equal(r.length, 2);
  assert.ok(!r.includes(pk("a")) && !r.includes(pk("d")));
  assert.equal(r[0], pk("c"), "einziger mit gleichem Modell");
  assert.ok([pk("b"), pk("e")].includes(r[1]!));
  assert.deepEqual(waehleZusatz([{ pk: pk("a"), modelle: ["m"] }], { haupt: pk("a"), modell: "m" }), [], "keiner frei → keine Runde");
  assert.equal(waehleZusatz(k, { haupt: pk("a"), anzahl: 0 }).length, 0);
});

test("Zusätzliche Provider: zufällig verteilt – jeder passende kommt dran", () => {
  const k = [pk("1"), pk("2"), pk("3"), pk("4")].map((p) => ({ pk: p, modelle: ["m"] }));
  const gesehen = new Set<string>();
  for (const z of [0.01, 0.3, 0.6, 0.99]) for (const p of waehleZusatz(k, { haupt: pk("9"), modell: "m", zufall: folge(z, 1 - z) })) gesehen.add(p);
  assert.equal(gesehen.size, 4);
});

test("Auswertung: einstimmig → alle einig; Mehrheit → Ausreißer erkannt; Streit oder zu wenig → keine Aussage", () => {
  const gleich = "Die Hauptstadt von Frankreich ist Paris.";
  assert.deepEqual([...werteRundeAus([{ pk: pk("a"), output: gleich }, { pk: pk("b"), output: gleich }, { pk: pk("c"), output: gleich }])],
    [[pk("a"), true], [pk("b"), true], [pk("c"), true]]);
  const r = werteRundeAus([
    { pk: pk("a"), output: gleich }, { pk: pk("b"), output: "Die Hauptstadt von Frankreich ist Paris" },
    { pk: pk("c"), output: "Ich kann dabei leider nicht helfen, versuche es später noch einmal." },
  ]);
  assert.deepEqual([r.get(pk("a")), r.get(pk("b")), r.get(pk("c"))], [true, true, false]);
  const streit = werteRundeAus([
    { pk: pk("a"), output: "Rot ist eine warme Farbe am Ende des Spektrums." },
    { pk: pk("b"), output: "Quantencomputer nutzen Überlagerung von Zuständen." },
    { pk: pk("c"), output: "Bananen wachsen in tropischen Gegenden an Stauden." },
  ]);
  assert.equal(streit.size, 0, "keine Mehrheit – keine Aussage");
  assert.equal(werteRundeAus([{ pk: pk("a"), output: gleich }]).size, 0, "eine Antwort allein sagt nichts");
  assert.equal(werteRundeAus([{ pk: pk("a"), output: gleich }, { pk: pk("b"), output: "  " }]).size, 0, "leere Antwort zählt nicht");
  assert.equal(werteRundeAus([{ pk: pk("a"), output: gleich }, { pk: pk("a"), output: gleich }]).size, 0, "derselbe Provider zweimal");
  // Zwei, die sich widersprechen: wer recht hat, ist offen
  assert.equal(werteRundeAus([{ pk: pk("a"), output: gleich }, { pk: pk("b"), output: "Bananen wachsen in tropischen Gegenden." }]).size, 0);
});

test("P5c2: „einig“ nur an Erfolgen mit Aussage; was übrig bleibt, geht ins Budget zurück", () => {
  const z = 1_790_000_000;
  const r = mitEinig([[pk("a"), { zeit: z, ok: true, ms: 900 }], [pk("b"), { zeit: z, ok: false }], [pk("c"), { zeit: z, ok: true }], [pk("d"), { zeit: z, ok: true }]],
    new Map([[pk("a"), true], [pk("b"), true], [pk("c"), false]]));
  assert.deepEqual(r.map(([, p]) => p.einig), [true, undefined, false, undefined], "nie an Fehlern, nie ohne Aussage");
  assert.deepEqual(r[0], [pk("a"), { zeit: z, ok: true, ms: 900, einig: true }]);
  assert.equal(rueckgabeMsat(10_000, [4_000, 0]), 16_000, "einer kostete 4 000, einer antwortete nicht");
  assert.equal(rueckgabeMsat(10_000, [25_000, 10_000]), 0, "mehr als das Gebot zahlt die Abrechnung nie");
  for (const k of [-5, 1.5, Number.NaN]) assert.equal(rueckgabeMsat(10_000, [k]), 10_000, String(k));
  assert.equal(rueckgabeMsat(0, [0, 0]), 0, "gratis – nichts zurück");
  assert.equal(rueckgabeMsat(-1, [0]), 0);
});

test("P5c2 verdrahtet: nach dem ersten Senden, versiegelt über buildJobEvent, still abgeholt, ohne Kanal und eigene Knoten, nie angezeigt", () => {
  const lies = (d: string) => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
  const wege = lies("shell/tabs/agent-wege.ts");
  const lauf = wege.slice(wege.indexOf("export async function askWithFailover("), wege.indexOf("export async function privateAntworten("));
  assert.match(lauf, /gesendetMs\.set\(target, Date\.now\(\)\);\n    if \(i === 0\) \{\n      runde = starteRunde\(\{/, "erst wenn die eigentliche Anfrage draußen ist");
  assert.match(lauf, /hoechstMsat: hoechstMsat\(bid, selectedTools\), kandidaten: candidates, ausser: targets,/);
  assert.equal(lauf.match(/messeLauf\(runde, /g)?.length, 3, "Antwort, Abbruch, alle versagt – jede Runde wird abgeschlossen");
  assert.doesNotMatch(lauf.slice(lauf.indexOf("for (let i = 0;")), /askRace|askSwarm/, "nur der normale Weg");
  const r = lies("shell/pruefrunde-lauf.ts");
  assert.match(r, /const auftrag = await buildJobEvent\(p\.prompt, p\.bid, p\.tier, pk, p\.sc\);\n    await p\.publish\(auftrag\.wrap\);/, "wie jede Anfrage versiegelt");
  assert.match(r, /still: true \}/);
  assert.match(r, /!ausser\.has\(k\.caps\.pubkey\) && !eigen\(k\.caps\.pubkey\) && !kanalDa\(k\.caps\.pubkey\)/);
  assert.match(r, /const eigen = \(pk: string\): boolean => !!kopplungFuer\(pk\) \|\| getAllowlist\(\)\.includes\(pk\);/);
  assert.match(r, /if \(eigen\(p\.ausser\[0\] \?\? ""\) \|\| !pruefBudget\.faellig\(bedarf\)\) return null;/);
  assert.match(r, /if \(antwort && !eigen\(antwort\.pk\)\) void pruefBudget\.zaehleAntwort\(\)/, "gezählt nur Antworten aus dem Netz");
  // Bezahlt wie jede Antwort – über ki-zahlung.ts, erst Abrechnung, dann die Sitzung
  assert.match(r, /const abrechnung = await rechneAntwortAb\(r\.requestId, r\.amountMsat\);[\s\S]*await providerZahlung\(r\.providerPubkey\);[\s\S]*sc\.chargeForResult\(/);
  assert.match(r, /pruefBudget\.verbuche\(rueckgabeMsat\(hoechstMsat, /);
  const code = r.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const verboten of [/addAiMessage|handleAnswer|innerHTML|textContent/, /\bzahle\(/, /\.publish\((?!auftrag\.wrap)/]) assert.doesNotMatch(code, verboten);
});
