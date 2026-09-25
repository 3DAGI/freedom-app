/**
 * Die Prueffregeln der Leak-Tests selbst (Schritt 1.5): Jede Regel findet ihren
 * Verstoss und schlaegt bei harmlosen Events nicht an. Eine Regel, die still
 * nichts findet, wuerde jedes Szenario gruen machen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import {
  LEAK_REGELN, regelAutorNicht, regelKeinBolt11, regelKeinKind4, regelKeinKlartext, regelKeinKlartextPrompt,
  regelKeineSolAdresse, regelKeineZahlungsdaten, regelKundeVerborgen, regelPTagsNur, regelSolAdresseFrisch,
  regelUploadVerschluesselt,
} from "../src/leak-rules.js";

const kunde = generateKeypair();
const provider = generateKeypair();
const ev = (kind: number, tags: string[][], content = "", kp = kunde): NostrEvent =>
  signEvent(buildEvent(kp.pk, kind, tags, content, 1_790_000_000), kp.sk);

// Testvektor aus BOLT 11 – oeffentlich, kein Geheimnis.
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";

test("kein-klartext-prompt: Prompt im i-Tag einer Anfrage, nicht aber in anderen Kinds", () => {
  const prompt = "Wie spaet ist es in Tokio?";
  assert.equal(regelKeinKlartextPrompt([ev(5050, [["i", prompt, "text"]])], [prompt]).length, 1);
  assert.equal(regelKeinKlartextPrompt([ev(5050, [["i", "verschluesselt…", "text"]])], [prompt]).length, 0);
  assert.equal(regelKeinKlartextPrompt([ev(1, [], prompt)], [prompt]).length, 0, "Kind 1 ist keine Anfrage");
  const [fund] = regelKeinKlartextPrompt([ev(5050, [["i", prompt, "text"]])], [prompt]);
  assert.equal(fund.regel, "kein-klartext-prompt");
  assert.match(fund.detail, /^Prompt sichtbar: Wie spaet/);
});

test("kunde-verborgen: Kunde als Autor oder im p-Tag", () => {
  assert.equal(regelKundeVerborgen([ev(5050, [])], kunde.pk).length, 1);
  assert.equal(regelKundeVerborgen([ev(6050, [["p", kunde.pk]], "", provider)], kunde.pk).length, 1);
  assert.equal(regelKundeVerborgen([ev(6050, [["p", "a".repeat(64)]], "", provider)], kunde.pk).length, 0);
});

test("kein-bolt11: Rechnung in Inhalt oder Tag, auch gross geschrieben; kurze Woerter nicht", () => {
  assert.equal(regelKeinBolt11([ev(1, [], `bitte zahlen: ${BOLT11}`)]).length, 1);
  assert.equal(regelKeinBolt11([ev(1, [["bolt11", BOLT11]])]).length, 1);
  assert.equal(regelKeinBolt11([ev(1, [], BOLT11.toUpperCase())]).length, 1);
  assert.equal(regelKeinBolt11([ev(1, [], "lnbc ist ein Praefix, lnbc1abc auch keine Rechnung")]).length, 0);
});

test("keine-sol-adresse und sol-adresse-frisch", () => {
  assert.equal(regelKeineSolAdresse([ev(25001, [["solana_address", SOL]])], [SOL]).length, 1);
  assert.equal(regelKeineSolAdresse([ev(0, [], JSON.stringify({ solana: SOL }))], [SOL]).length, 1);
  assert.equal(regelKeineSolAdresse([ev(25001, [["hashlock", "b".repeat(64)]])], [SOL]).length, 0);
  assert.equal(regelSolAdresseFrisch([SOL, "x".repeat(44), SOL]).length, 1);
  assert.equal(regelSolAdresseFrisch([SOL, "x".repeat(44)]).length, 0);
});

test("upload-verschluesselt: Dateiinhalt als Hex oder Base64 wird gefunden, Chiffrat nicht", () => {
  const datei = crypto.getRandomValues(new Uint8Array(3000));
  const hex = Buffer.from(datei).toString("hex");
  const b64 = Buffer.from(datei).toString("base64");
  assert.equal(regelUploadVerschluesselt([ev(1064, [], hex.slice(2000, 4000))], datei).length, 1, "Mitte als Hex");
  assert.equal(regelUploadVerschluesselt([ev(1064, [], b64)], datei).length, 1, "ganz als Base64");
  const anders = crypto.getRandomValues(new Uint8Array(3000));
  assert.equal(regelUploadVerschluesselt([ev(1064, [], Buffer.from(anders).toString("hex"))], datei).length, 0);
  const klein = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(regelUploadVerschluesselt([ev(1064, [], Buffer.from(klein).toString("hex"))], klein).length, 1, "kleine Datei ganz");
});

test("jede Regel meldet unter einem Namen aus LEAK_REGELN", () => {
  const e4 = ev(4, [["p", provider.pk]], "geheimer Text 123");
  const funde = [
    ...regelKeinKind4([e4]),
    ...regelKeinKlartext([e4], ["geheimer Text 123"]),
    ...regelAutorNicht([e4], kunde.pk),
    ...regelPTagsNur([e4], []),
    ...regelKeinKlartextPrompt([ev(5050, [["i", "geheimer Prompt", "text"]])], ["geheimer Prompt"]),
    ...regelKundeVerborgen([e4], kunde.pk),
    ...regelKeinBolt11([ev(1, [], BOLT11)]),
    ...regelKeineSolAdresse([ev(1, [], SOL)], [SOL]),
    ...regelSolAdresseFrisch([SOL, SOL]),
    ...regelUploadVerschluesselt([ev(1, [], "0102030405060708090a")], new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])),
    ...regelKeineZahlungsdaten([ev(6050, [["amount", "21000"]])]),
  ];
  const gemeldet = new Set(funde.map((f) => f.regel));
  assert.deepEqual([...gemeldet].sort(), Object.keys(LEAK_REGELN).sort());
});

test("keine-zahlungsdaten: Betrag, Rechnung, Adresse, Sitzung, Beleg – aber nicht das Leistungs-Event", () => {
  const faelle: Array<[string[][], string]> = [
    [[["amount", "21000", BOLT11]], "Ergebnis mit Rechnung"],
    [[["amount", "0"]], "Ergebnis ohne Rechnung"],
    [[["solana_address", SOL], ["amount_lamports", "5000"]], "SOL-Zahloption"],
    [[["usage", "{\"completionTokens\":7}"]], "usage"],
    [[["max_total_msat", "100000"], ["settle_every_msat", "20000"]], "Sitzung"],
    [[["cumulative_msat", "40000"], ["units", "7"], ["payment", "ref"]], "Beleg"],
    [[["bid", "21000"]], "Gebot"],
    [[["amount_msat", "7000"], ["reason", "unbrauchbar"]], "Reklamation"],
  ];
  for (const [tags, name] of faelle) {
    const funde = regelKeineZahlungsdaten([ev(6050, tags)]);
    assert.equal(funde.length, 1, name);
    assert.equal(funde[0].regel, "keine-zahlungsdaten");
  }
  assert.equal(regelKeineZahlungsdaten([ev(1, [], `zahl bitte ${BOLT11}`)]).length, 1, "Rechnung im Inhalt");
  // Leistungs-Event: Volumen des Providers ohne Kunden – gehoert nicht dazu.
  assert.equal(regelKeineZahlungsdaten([ev(38010, [["volume_msat", "21000"], ["units", "7"]])]).length, 0);
  assert.equal(regelKeineZahlungsdaten([ev(38022, [["units", "7"]])]).length, 1, "units im Beleg zaehlt");
  assert.equal(regelKeineZahlungsdaten([ev(1059, [["p", provider.pk]], "Chiffrat")]).length, 0, "Umschlag");
});
