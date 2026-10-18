/**
 * B-34c1: Einladung zum Gruppenanruf als inneres Event des privaten Raums – je Mitglied ein Zugang, streng gelesen,
 * beendet nur vom Anrufenden, bei zwei Anrufenden mit derselben Kennung keiner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ART_GRUPPENANRUF, ProtokollFehler, raumGruppenanruf, raumGruppenanrufe, raumGruppenanrufEnde, type InneresEvent, type InneresSenden,
  type LivekitZugaenge,
} from "../src/index.js";

const RAUM = "raum-1";
const ANRUF = "ab".repeat(16);
const JETZT = 1_790_000_000;
const [A, B, C, D] = ["a", "b", "c", "d"].map((x) => x.repeat(64));
const token = (n: number) => `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ${n}In0.c2lnbmF0dXI${n}`;
const zugaenge = (anzahl: number, anruf = ANRUF): LivekitZugaenge => ({
  url: "wss://knoten.example.org", raum: anruf, bis: JETZT + 3600,
  zugaenge: Array.from({ length: anzahl }, (_, i) => ({ kennung: `${i}`.repeat(16), token: token(i) })),
});
let n = 0;
const innen = (s: InneresSenden, von: string, zeit = JETZT): InneresEvent => ({ id: (++n).toString(16).padStart(64, "0"), von, art: s.art, tags: s.tags, text: s.text, zeit });
const fehlerFall = (e: unknown) => e instanceof ProtokollFehler && e.kennung === "gruppenanruf-ungueltig";

test("B-34c1: Einladung – inneres Event mit je Mitglied einem Zugang; jeder liest seinen", () => {
  const s = raumGruppenanruf(RAUM, zugaenge(3), [A, B, C]);
  assert.equal(s.art, ART_GRUPPENANRUF);
  assert.deepEqual(s.tags, [["space", RAUM], ["anruf", ANRUF]]);
  const e = innen(s, A);
  for (const [i, ich] of [A, B, C].entries()) {
    const [g] = raumGruppenanrufe(RAUM, [e], { ich, jetzt: JETZT });
    assert.deepEqual(g, {
      id: e.id, von: A, anruf: ANRUF, url: "wss://knoten.example.org", bis: JETZT + 3600, zeit: JETZT, teilnehmer: 3,
      zugang: zugaenge(3).zugaenge[i],
    });
  }
  assert.equal(raumGruppenanrufe(RAUM, [e], { ich: D, jetzt: JETZT })[0]!.zugang, undefined, "wer nicht eingeladen ist, hat keinen Zugang");
  assert.deepEqual(raumGruppenanrufe("anderer-raum", [e], { ich: B, jetzt: JETZT }), [], "nur im eigenen Raum");
});

test("B-34c1: bauen nur mit passenden Mitgliedern und gültigen Zugängen", () => {
  assert.throws(() => raumGruppenanruf(RAUM, zugaenge(2), [A, B, C]), fehlerFall, "mehr Mitglieder als Zugänge");
  assert.throws(() => raumGruppenanruf(RAUM, zugaenge(2), [A, A]), fehlerFall, "doppelt");
  assert.throws(() => raumGruppenanruf(RAUM, zugaenge(1), ["A".repeat(64)]), fehlerFall, "kein Hex");
  assert.throws(() => raumGruppenanruf(RAUM, { ...zugaenge(1), url: "ws://knoten.example.org" }, [A]), fehlerFall, "unverschlüsselt");
  assert.throws(() => raumGruppenanrufEnde(RAUM, "kein-anruf"), fehlerFall);
});

test("B-34c1: beendet nur vom Anrufenden, abgelaufen fällt weg, neueste Einladung gilt", () => {
  const einladung = innen(raumGruppenanruf(RAUM, zugaenge(2), [A, B]), A);
  const fremdesEnde = innen(raumGruppenanrufEnde(RAUM, ANRUF), B, JETZT + 1);
  assert.equal(raumGruppenanrufe(RAUM, [einladung, fremdesEnde], { ich: B, jetzt: JETZT }).length, 1, "Bob beendet Alices Anruf nicht");
  const ende = innen(raumGruppenanrufEnde(RAUM, ANRUF), A, JETZT + 1);
  assert.deepEqual(raumGruppenanrufe(RAUM, [einladung, ende], { ich: B, jetzt: JETZT }), []);
  assert.deepEqual(raumGruppenanrufe(RAUM, [einladung], { ich: B, jetzt: JETZT + 3600 }), [], "abgelaufen");

  // neu eingeladen (ein Mitglied mehr): die neueste gilt
  const neu = innen(raumGruppenanruf(RAUM, zugaenge(3), [A, B, C]), A, JETZT + 5);
  const [g] = raumGruppenanrufe(RAUM, [neu, einladung], { ich: C, jetzt: JETZT });
  assert.equal(g!.teilnehmer, 3);
  assert.ok(g!.zugang);

  // zwei Anrufe zugleich – neueste zuerst
  const zweiter = innen(raumGruppenanruf(RAUM, zugaenge(2, "cd".repeat(16)), [B, A]), B, JETZT + 9);
  assert.deepEqual(raumGruppenanrufe(RAUM, [einladung, zweiter], { ich: A, jetzt: JETZT }).map((x) => x.anruf), ["cd".repeat(16), ANRUF]);
});

test("B-34c1: dieselbe Kennung von zwei Anrufenden – keiner gilt; kaputte Einladungen fallen weg", () => {
  const vonA = innen(raumGruppenanruf(RAUM, zugaenge(2), [A, B]), A);
  const vonB = innen(raumGruppenanruf(RAUM, { ...zugaenge(2), url: "wss://andere.example.org" }, [A, B]), B, JETZT - 100);
  assert.deepEqual(raumGruppenanrufe(RAUM, [vonA, vonB], { ich: A, jetzt: JETZT }), [], "die eigene Zeit beweist nichts");

  const gut = raumGruppenanruf(RAUM, zugaenge(2), [A, B]);
  const daten = JSON.parse(gut.text) as Record<string, unknown>;
  const mit = (aenderung: Record<string, unknown>): InneresSenden => ({ ...gut, text: JSON.stringify({ ...daten, ...aenderung }) });
  const kaputt: Array<[string, InneresSenden]> = [
    ["kein JSON", { ...gut, text: "{" }],
    ["ohne Mitglieder", mit({ mitglieder: undefined })],
    ["Mitglieder doppelt", mit({ mitglieder: [A, A] })],
    ["weniger Mitglieder als Zugänge", mit({ mitglieder: [A] })],
    ["anderer Anruf im Inhalt", mit({ raum: "cd".repeat(16) })],
    ["Token kein JWT", mit({ zugaenge: [{ kennung: "0".repeat(16), token: "x" }, { kennung: "1".repeat(16), token: token(1) }] })],
    ["zu lange gültig", mit({ bis: JETZT + 2 * 86_400 })],
    ["Anruf-Tag kaputt", { ...gut, tags: [["space", RAUM], ["anruf", "zz"]] }],
  ];
  for (const [fall, s] of kaputt) assert.deepEqual(raumGruppenanrufe(RAUM, [innen(s, A)], { ich: B, jetzt: JETZT }), [], fall);
});
