/**
 * Umfragen und Termine in privaten Räumen (B-15a): NIP-88 und NIP-52 als
 * innere Events – gebaut mit Grenzen, gelesen streng, gezählt je Mitglied
 * die letzte Stimme bzw. Antwort, Gelöschtes fällt weg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProtokollFehler } from "../src/fehler.js";
import { type InneresEvent, type InneresSenden, gruppenRaum, raumDefinition, raumLoeschung, raumRollen } from "../src/raum-gruppe.js";
import {
  ART_STIMME, ART_TERMIN_ANTWORT, ART_TERMIN_TAG, ART_TERMIN_ZEIT, ART_UMFRAGE, PLANUNG_GRENZEN,
  raumStimme, raumTermin, raumTerminAntwort, raumTermine, raumUmfrage, raumUmfragen,
} from "../src/raum-planung.js";

const RAUM = "d".repeat(64);
const [ADMIN, ANNA, BO, CARL] = ["1", "2", "3", "4"].map((c) => c.repeat(64)) as [string, string, string, string];
const T = 1_800_000_000;
let n = 0;
const ev = (von: string, s: InneresSenden, zeit = T + ++n): InneresEvent =>
  ({ id: (++n).toString(16).padStart(64, "0"), von, art: s.art, tags: s.tags, text: s.text, zeit });
const kanaele = [
  { id: "allgemein", name: "allgemein", privacy: "verschluesselt" as const, writeRoles: [], position: 0 },
  { id: "ankuendigungen", name: "ankündigungen", privacy: "verschluesselt" as const, writeRoles: ["mod"], position: 1 },
];
const basis = () => [
  ev(ADMIN, raumDefinition(RAUM, { name: "Werkstatt", kanaele }), T),
  ev(ADMIN, raumRollen(RAUM, [{ id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "threads", "moderieren"] }]), T),
];
const raumAus = (l: InneresEvent[]) => gruppenRaum(RAUM, l, { admins: [ADMIN], mitglieder: [ADMIN, ANNA, BO, CARL] });

test("B-15a: Umfrage bauen – NIP-88 mit Kanal, Antworten 0…n, Art und Ende; Grenzen", () => {
  const u = raumUmfrage(RAUM, { kanal: "allgemein", frage: " Wann treffen wir uns? ", optionen: ["Montag", "Dienstag "], mehrfach: true, endet: T + 3600 });
  assert.equal(u.art, ART_UMFRAGE);
  assert.equal(u.text, "Wann treffen wir uns?");
  assert.deepEqual(u.tags, [["space", RAUM], ["h", "allgemein"], ["option", "0", "Montag"], ["option", "1", "Dienstag"], ["polltype", "multiplechoice"], ["endsAt", String(T + 3600)]]);
  assert.deepEqual(raumUmfrage(RAUM, { kanal: "allgemein", frage: "?", optionen: ["a", "b"] }).tags.slice(-1), [["polltype", "singlechoice"]]);
  const falsch = (u: Parameters<typeof raumUmfrage>[1]) => assert.throws(() => raumUmfrage(RAUM, u), (e) => e instanceof ProtokollFehler && e.kennung === "planung-ungueltig");
  falsch({ kanal: "allgemein", frage: "", optionen: ["a", "b"] });
  falsch({ kanal: "allgemein", frage: "x".repeat(PLANUNG_GRENZEN.frage + 1), optionen: ["a", "b"] });
  falsch({ kanal: "allgemein", frage: "?", optionen: ["nur eine"] });
  falsch({ kanal: "allgemein", frage: "?", optionen: Array.from({ length: 21 }, (_, i) => `o${i}`) });
  falsch({ kanal: "allgemein", frage: "?", optionen: ["a", "a"] });
  falsch({ kanal: "allgemein", frage: "?", optionen: ["a", " "] });
  falsch({ kanal: "kein kanal", frage: "?", optionen: ["a", "b"] });
  falsch({ kanal: "allgemein", frage: "?", optionen: ["a", "b"], endet: -1 });
  const s = raumStimme(RAUM, "a".repeat(64), ["1", "1", "0"]);
  assert.deepEqual(s, { art: ART_STIMME, tags: [["space", RAUM], ["e", "a".repeat(64)], ["response", "1"], ["response", "0"]], text: "" });
  assert.throws(() => raumStimme(RAUM, "kurz", ["0"]), ProtokollFehler);
  assert.throws(() => raumStimme(RAUM, "a".repeat(64), []), ProtokollFehler);
  assert.throws(() => raumStimme(RAUM, "a".repeat(64), ["x"]), ProtokollFehler);
});

test("B-15a: Umfrage auswerten – je Mitglied die letzte Stimme, einfache Wahl zählt eine, nach dem Ende nichts mehr", () => {
  const l = basis();
  const einfach = ev(ANNA, raumUmfrage(RAUM, { kanal: "allgemein", frage: "Pizza?", optionen: ["ja", "nein"], endet: T + 1000 }));
  const mehr = ev(BO, raumUmfrage(RAUM, { kanal: "allgemein", frage: "Welche Tage?", optionen: ["Mo", "Di", "Mi"], mehrfach: true }));
  l.push(einfach, mehr,
    ev(ANNA, raumStimme(RAUM, einfach.id, ["1"]), T + 10),
    ev(ANNA, raumStimme(RAUM, einfach.id, ["0"]), T + 20), // umentschieden: die letzte zählt
    ev(BO, raumStimme(RAUM, einfach.id, ["0", "1"]), T + 30), // einfache Wahl: nur die erste
    ev(CARL, raumStimme(RAUM, einfach.id, ["1"]), T + 2000), // nach dem Ende
    ev(ADMIN, { art: ART_STIMME, tags: [["space", RAUM], ["e", einfach.id], ["response", "9"]], text: "" }, T + 40), // unbekannte Antwort
    ev(ANNA, raumStimme(RAUM, mehr.id, ["0", "2"]), T + 50),
    ev(CARL, raumStimme(RAUM, mehr.id, ["2"]), T + 60),
  );
  const [a, b] = raumUmfragen(RAUM, l, raumAus(l), { ich: ANNA, jetzt: T + 5000 });
  assert.deepEqual(a!.optionen, [{ id: "0", text: "ja", stimmen: 2 }, { id: "1", text: "nein", stimmen: 0 }]);
  assert.equal(a!.teilnehmer, 2);
  assert.deepEqual(a!.meine, ["0"]);
  assert.equal(a!.beendet, true);
  assert.deepEqual(b!.optionen.map((o) => o.stimmen), [1, 0, 2]);
  assert.equal(b!.mehrfach, true);
  assert.deepEqual(b!.meine, ["0", "2"]);
  assert.equal(b!.beendet, false);
  assert.equal(raumUmfragen(RAUM, l, raumAus(l), { ich: CARL, jetzt: T })[0]!.meine, undefined, "Carls Stimme kam nach dem Ende");
});

test("B-15a: Umfrage streng gelesen – nur mit Schreibrecht im Kanal, fremder Raum, kaputte Antworten, gelöscht", () => {
  const l = basis();
  const nurMods = ev(ANNA, raumUmfrage(RAUM, { kanal: "ankuendigungen", frage: "Darf ich?", optionen: ["a", "b"] }));
  const vomAdmin = ev(ADMIN, raumUmfrage(RAUM, { kanal: "ankuendigungen", frage: "Wahl", optionen: ["a", "b"] }));
  const fremd = ev(ANNA, raumUmfrage("e".repeat(64), { kanal: "allgemein", frage: "Anderswo", optionen: ["a", "b"] }));
  const eine = ev(ANNA, { art: ART_UMFRAGE, tags: [["space", RAUM], ["h", "allgemein"], ["option", "0", "a"], ["option", "0", "doppelt"]], text: "Kaputt" });
  const weg = ev(BO, raumUmfrage(RAUM, { kanal: "allgemein", frage: "Weg damit", optionen: ["a", "b"] }));
  l.push(nurMods, vomAdmin, fremd, eine, weg, ev(BO, raumLoeschung(weg.id, false)));
  assert.deepEqual(raumUmfragen(RAUM, l, raumAus(l)).map((u) => u.frage), ["Wahl"]);
  // Löschen durch den Admin wirkt auch, durch andere nicht
  const bleibt = ev(ANNA, raumUmfrage(RAUM, { kanal: "allgemein", frage: "Bleibt", optionen: ["a", "b"] }));
  const adminWeg = ev(ANNA, raumUmfrage(RAUM, { kanal: "allgemein", frage: "Admin löscht", optionen: ["a", "b"] }));
  l.push(bleibt, adminWeg, ev(CARL, raumLoeschung(bleibt.id, false)), ev(ADMIN, raumLoeschung(adminWeg.id, true)));
  assert.deepEqual(raumUmfragen(RAUM, l, raumAus(l)).map((u) => u.frage), ["Wahl", "Bleibt"]);
});

test("B-15a: Termin bauen – mit Uhrzeit (31923) oder ganztägig (31922); Grenzen", () => {
  const t = raumTermin(RAUM, { kanal: "allgemein", titel: "Treffen", beginn: T + 86_400, ende: T + 90_000, ort: "Werkstatt", text: "Bitte pünktlich", zeitzone: "Europe/Berlin" });
  assert.equal(t.art, ART_TERMIN_ZEIT);
  const d = t.tags.find((x) => x[0] === "d")![1]!;
  assert.match(d, /^[0-9a-f]{32}$/);
  assert.deepEqual(t.tags.filter((x) => x[0] !== "d"), [["space", RAUM], ["h", "allgemein"], ["title", "Treffen"], ["start", String(T + 86_400)], ["end", String(T + 90_000)], ["start_tzid", "Europe/Berlin"], ["location", "Werkstatt"]]);
  assert.equal(t.text, "Bitte pünktlich");
  const g = raumTermin(RAUM, { kanal: "allgemein", titel: "Ausflug", beginn: "2027-01-15", ende: "2027-01-16" });
  assert.equal(g.art, ART_TERMIN_TAG);
  assert.deepEqual(g.tags.filter((x) => x[0] === "start" || x[0] === "end"), [["start", "2027-01-15"], ["end", "2027-01-16"]]);
  const falsch = (x: Parameters<typeof raumTermin>[1]) => assert.throws(() => raumTermin(RAUM, x), ProtokollFehler);
  falsch({ kanal: "allgemein", titel: "", beginn: T });
  falsch({ kanal: "allgemein", titel: "x", beginn: "2027-02-30" });
  falsch({ kanal: "allgemein", titel: "x", beginn: T, ende: T - 1 });
  falsch({ kanal: "allgemein", titel: "x", beginn: T, ende: "2027-01-01" });
  falsch({ kanal: "allgemein", titel: "x", beginn: -5 });
  falsch({ kanal: "allgemein", titel: "x", beginn: T, ort: "o".repeat(PLANUNG_GRENZEN.ort + 1) });
  falsch({ kanal: "allgemein", titel: "x", beginn: T, text: "t".repeat(PLANUNG_GRENZEN.text + 1) });
  // Eine ungültige Zeitzone fällt einfach weg
  assert.ok(!raumTermin(RAUM, { kanal: "allgemein", titel: "x", beginn: T, zeitzone: "<b>" }).tags.some((x) => x[0] === "start_tzid"));
});

test("B-15a: Termin auswerten – Zu- und Absagen je Mitglied die letzte, nach Beginn sortiert, streng gelesen", () => {
  const l = basis();
  const spaet = ev(ANNA, raumTermin(RAUM, { kanal: "allgemein", titel: "Spät", beginn: T + 90_000 }));
  const frueh = ev(BO, raumTermin(RAUM, { kanal: "allgemein", titel: "Früh", beginn: "2027-01-15" }));
  const termin = (e: InneresEvent) => ({ id: e.id, von: e.von, art: e.art, d: e.tags.find((x) => x[0] === "d")![1]! });
  const antwort = raumTerminAntwort(RAUM, termin(spaet), "accepted");
  assert.equal(antwort.art, ART_TERMIN_ANTWORT);
  assert.deepEqual(antwort.tags.find((x) => x[0] === "a"), ["a", `${ART_TERMIN_ZEIT}:${ANNA}:${termin(spaet).d}`]);
  l.push(spaet, frueh,
    ev(ANNA, antwort, T + 10),
    ev(BO, raumTerminAntwort(RAUM, termin(spaet), "declined"), T + 20),
    ev(BO, raumTerminAntwort(RAUM, termin(spaet), "tentative"), T + 30), // umentschieden
    ev(CARL, { art: ART_TERMIN_ANTWORT, tags: [["space", RAUM], ["e", spaet.id], ["status", "maybe"]], text: "" }, T + 40), // unbekannt
    // Kaputte Termine: ohne Titel, falsches Datum, Ende vor Beginn, im Kanal nur für Moderatoren
    ev(ANNA, { art: ART_TERMIN_ZEIT, tags: [["space", RAUM], ["h", "allgemein"], ["d", "a".repeat(32)], ["start", String(T)]], text: "" }),
    ev(ANNA, { art: ART_TERMIN_TAG, tags: [["space", RAUM], ["h", "allgemein"], ["d", "b".repeat(32)], ["title", "x"], ["start", "2027-13-01"]], text: "" }),
    ev(ANNA, { art: ART_TERMIN_ZEIT, tags: [["space", RAUM], ["h", "allgemein"], ["d", "c".repeat(32)], ["title", "x"], ["start", String(T)], ["end", String(T - 1)]], text: "" }),
    ev(ANNA, raumTermin(RAUM, { kanal: "ankuendigungen", titel: "Nur Mods", beginn: T })),
  );
  const liste = raumTermine(RAUM, l, raumAus(l), { ich: BO });
  // Nach Beginn: „Früh“ ist der 15.01.2027 (ganztägig), „Spät“ der 16.01.2027 9 Uhr UTC; die kaputten und der ohne Schreibrecht fallen weg
  assert.deepEqual(liste.map((t) => t.titel), ["Früh", "Spät"]);
  const [f, s] = liste as [typeof liste[0], typeof liste[0]];
  assert.deepEqual([s.zusagen, s.absagen, s.vielleicht, s.meine], [1, 0, 1, "tentative"]);
  assert.deepEqual([f.ganztags, f.beginn, s.ganztags, s.beginn], [true, "2027-01-15", false, T + 90_000]);
  // Gelöscht fällt weg
  l.push(ev(ANNA, raumLoeschung(spaet.id, false)));
  assert.deepEqual(raumTermine(RAUM, l, raumAus(l)).map((t) => t.titel), ["Früh"]);
  assert.throws(() => raumTerminAntwort(RAUM, termin(spaet), "maybe" as never), ProtokollFehler);
  assert.throws(() => raumTerminAntwort(RAUM, { ...termin(spaet), art: 1 }, "accepted"), ProtokollFehler);
});

test("B-15a: gruppenRaum nennt Gelöschtes – Nachrichten wie bisher, jetzt auch Umfragen und Termine", () => {
  const l = basis();
  const u = ev(ANNA, raumUmfrage(RAUM, { kanal: "allgemein", frage: "?", optionen: ["a", "b"] }));
  l.push(u, ev(ANNA, raumLoeschung(u.id, false)));
  assert.ok(raumAus(l).geloescht.has(u.id));
  // Fremdes löschen bleibt verworfen
  const v = ev(ANNA, raumUmfrage(RAUM, { kanal: "allgemein", frage: "!", optionen: ["a", "b"] }));
  l.push(v, ev(BO, raumLoeschung(v.id, false)));
  const r = raumAus(l);
  assert.ok(!r.geloescht.has(v.id));
  assert.ok(r.verworfen.some((x) => x.grund === "darf diese Nachricht nicht löschen"));
});
