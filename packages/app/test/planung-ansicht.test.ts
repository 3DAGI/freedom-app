/**
 * Umfragen und Termine im privaten Raum (B-15b): Eingaben der Dialoge,
 * Anteile, Wahl bei Mehrfachwahl, Zeitpunkt als Text – und dass die
 * Oberfläche nur über die Gruppe sendet und nur als Text zeigt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TERMIN_DAUERN, UMFRAGE_ENDEN, anteile, antwortenAus, neueWahl, pruefeUmfrage, terminAus, terminWann, umfrageEnde } from "../src/planung-ansicht.js";

test("B-15b: Umfrage – Antworten je Zeile, Prüfung, Ende aus der festen Wahl", () => {
  assert.deepEqual(antwortenAus(" Montag \n\n Dienstag\r\nMittwoch \n"), ["Montag", "Dienstag", "Mittwoch"]);
  assert.equal(pruefeUmfrage("Wann?", ["a", "b"]), null);
  assert.equal(pruefeUmfrage("  ", ["a", "b"]), "frage");
  assert.equal(pruefeUmfrage("x".repeat(501), ["a", "b"]), "frage");
  assert.equal(pruefeUmfrage("Wann?", ["a"]), "zahl");
  assert.equal(pruefeUmfrage("Wann?", Array.from({ length: 21 }, (_, i) => `o${i}`)), "zahl");
  assert.equal(pruefeUmfrage("Wann?", ["a", "b".repeat(101)]), "lang");
  assert.equal(pruefeUmfrage("Wann?", ["a", "a"]), "doppelt");
  const jetzt = 1_800_000_000;
  assert.equal(umfrageEnde("0", jetzt), undefined);
  assert.equal(umfrageEnde("24", jetzt), jetzt + 86_400);
  assert.equal(umfrageEnde("5", jetzt), undefined, "nur aus der Wahl");
  assert.equal(umfrageEnde("kaputt", jetzt), undefined);
  assert.deepEqual([...UMFRAGE_ENDEN], [0, 1, 24, 72, 168]);
});

test("B-15b: Stimmen – Anteile ganzzahlig, einfache Wahl ersetzt, Mehrfachwahl schaltet um", () => {
  assert.deepEqual(anteile({ optionen: [{ id: "0", text: "a", stimmen: 1 }, { id: "1", text: "b", stimmen: 2 }] }), [33, 67]);
  assert.deepEqual(anteile({ optionen: [{ id: "0", text: "a", stimmen: 0 }, { id: "1", text: "b", stimmen: 0 }] }), [0, 0]);
  assert.deepEqual(neueWahl({ mehrfach: false, meine: ["0"] }, "1"), ["1"]);
  assert.deepEqual(neueWahl({ mehrfach: true, meine: ["0"] }, "1"), ["0", "1"]);
  assert.deepEqual(neueWahl({ mehrfach: true, meine: ["0", "1"] }, "0"), ["1"]);
  assert.deepEqual(neueWahl({ mehrfach: true, meine: undefined }, "2"), ["2"]);
});

test("B-15b: Termin – ganztägig ohne Uhrzeit, sonst Ortszeit mit Dauer; falsche Eingaben mit Grund", () => {
  assert.deepEqual(terminAus({ datum: "2027-01-15", uhrzeit: "", dauer: "60" }), { beginn: "2027-01-15" });
  const mit = terminAus({ datum: "2027-01-15", uhrzeit: "18:30", dauer: "60" });
  assert.ok("beginn" in mit && typeof mit.beginn === "number");
  assert.equal(mit.beginn, Math.floor(new Date("2027-01-15T18:30:00").getTime() / 1000), "Ortszeit des Geräts");
  assert.equal(mit.ende, (mit.beginn as number) + 3600);
  assert.deepEqual(terminAus({ datum: "2027-01-15", uhrzeit: "18:30", dauer: "0" }), { beginn: mit.beginn });
  assert.deepEqual(terminAus({ datum: "2027-02-30", uhrzeit: "", dauer: "0" }), { fehler: "datum" });
  assert.deepEqual(terminAus({ datum: "15.01.2027", uhrzeit: "", dauer: "0" }), { fehler: "datum" });
  assert.deepEqual(terminAus({ datum: "2027-01-15", uhrzeit: "25:00", dauer: "0" }), { fehler: "uhrzeit" });
  assert.deepEqual(terminAus({ datum: "2027-01-15", uhrzeit: "18:30", dauer: "45" }), { fehler: "dauer" }, "nur aus der Wahl");
  assert.deepEqual([...TERMIN_DAUERN], [0, 30, 60, 120, 240]);
});

test("B-15b: Zeitpunkt als Text – ganztägig ohne Uhrzeit, mit Uhrzeit in der Sprache der Oberfläche", () => {
  const tag = terminWann({ ganztags: true, beginn: "2027-01-15", ende: undefined }, "de-DE");
  assert.match(tag, /15\. Januar 2027/);
  assert.doesNotMatch(tag, /:/, "ganztägig ohne Uhrzeit");
  assert.match(terminWann({ ganztags: true, beginn: "2027-01-15", ende: "2027-01-17" }, "de-DE"), /15\. Januar 2027 – .*17\. Januar 2027/);
  const beginn = Math.floor(new Date("2027-01-15T18:30:00").getTime() / 1000);
  const zeit = terminWann({ ganztags: false, beginn, ende: beginn + 3600 }, "de-DE");
  assert.match(zeit, /18:30/);
  assert.match(zeit, /– 19:30$/, "am selben Tag nur die Uhrzeit des Endes");
  assert.match(terminWann({ ganztags: false, beginn, ende: undefined }, "en-GB"), /January 2027/);
});

test("B-15b: verdrahtet – nur im privaten Raum, nur über die Gruppe, nur als Text", () => {
  const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const ui = lies("shell/raum-planung-ui.ts");
  assert.doesNotMatch(ui, /innerHTML|publish\(|signiere\(/, "kein HTML aus Fremddaten, nie offen veröffentlicht");
  for (const bau of ["raumStimme(raum.gruppe, u.id, neueWahl(u, o.id))", "raumTerminAntwort(raum.gruppe, termin, status)", "raumUmfrage(raum.gruppe, {", "raumTermin(raum.gruppe, {"]) {
    assert.ok(ui.includes(`mlsSendeEvent(raum.gruppe, ${bau}`), bau);
  }
  assert.match(ui, /raumUmfragen\(raum\.gruppe, raum\.ereignisse, raum, \{ ich: raum\.ich \}\)\.filter\(\(u\) => u\.kanal === kanal\)/);
  assert.match(ui, /raumTermine\(raum\.gruppe, raum\.ereignisse, raum, \{ ich: raum\.ich \}\)\.filter\(\(x\) => x\.kanal === kanal\)/);
  const raeume = lies("shell/tabs/raeume.ts");
  assert.match(raeume, /if \(planung && spacesUi\.privat\) zeigePlanung\(planung, spacesUi\.privat, channelId, kontaktName, \(\) => void raumNeuLaden\(\)\);/);
  assert.match(raeume, /document\.getElementById\(id\)\?\.classList\.toggle\("hidden", !spacesUi\.privat \|\| !darf\);/, "Knöpfe nur privat und mit Schreibrecht");
  assert.match(raeume, /if \(spacesUi\.privat && spacesUi\.channelId\) void neueUmfrage\(spacesUi\.privat, spacesUi\.channelId, /);
  assert.match(raeume, /if \(spacesUi\.privat && spacesUi\.channelId\) void neuerTermin\(spacesUi\.privat, spacesUi\.channelId, /);
  assert.match(lies("shell/raum-mls.ts"), /ereignisse: stand\.ereignisse, gruppe,/);
  const html = lies("shell/index.html");
  assert.match(html, /<div id="kanal-planung" class="kanal-planung hidden" role="region"/);
  assert.match(html, /<button id="kanal-umfrage" class="ghost icon-btn planung-knopf hidden" type="button"/);
  assert.match(html, /<button id="kanal-termin" class="ghost icon-btn planung-knopf hidden" type="button"/);
  assert.match(lies("shell/dialog.ts"), /"typ" in f && f\.typ \? f\.typ : "text"/);
});
