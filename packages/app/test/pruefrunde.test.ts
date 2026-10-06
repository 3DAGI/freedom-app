/**
 * P5c: Prüfrunden – wer zusätzlich gefragt wird und wie drei Antworten
 * ausgewertet werden. Übereinstimmung heißt nie „richtig“; bei Streit gibt es
 * keine Aussage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waehleZusatz, werteRundeAus } from "../src/pruefrunde.js";

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
