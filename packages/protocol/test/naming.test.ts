/**
 * Tests fuer die Namensschicht.
 *
 * Der teuerste Fehler in solchen Systemen ist nicht der gestohlene Schluessel,
 * sondern die Zahlung an den falschen "Max". Die Tests pruefen deshalb vor
 * allem Imitation und Herkunft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildPetname, parsePetname, resolveName, inspectName,
  checkImpersonation, displayWithSource, searchByName, KIND_PETNAME,
} from "../src/naming.js";

const ICH = generateKeypair(), FREUND_A = generateKeypair(), FREUND_B = generateKeypair();
const FREMD = generateKeypair(), ZIEL = generateKeypair();
const VERTRAUT = new Set([FREUND_A.pk, FREUND_B.pk]);

const nennt = (von: typeof ICH, ziel: string, name: string) =>
  signEvent(buildPetname({ byPubkey: von.pk, forPubkey: ziel, name }), von.sk);

test("Petname: Roundtrip", () => {
  const ev = nennt(FREUND_A, ZIEL.pk, "Max");
  const p = parsePetname(ev);
  assert.equal(ev.kind, KIND_PETNAME);
  assert.equal(p.name, "Max");
  assert.equal(p.forPubkey, ZIEL.pk);
});

test("Selbstbenennung ist kein Petname", () => {
  const ev = signEvent(buildEvent(ICH.pk, KIND_PETNAME, [["p", ICH.pk], ["name", "Der Grosse"]], ""), ICH.sk);
  assert.throws(() => parsePetname(ev), /Selbstbenennung/);
});

test("Eigener Name schlaegt alles", () => {
  // Was DU vergeben hast, gilt. Alles andere sind Hinweise.
  const r = resolveName(ZIEL.pk, [nennt(FREUND_A, ZIEL.pk, "Max"), nennt(FREUND_B, ZIEL.pk, "Max")], {
    ownPetnames: new Map([[ZIEL.pk, "Chef"]]),
    trusted: VERTRAUT,
  });
  assert.equal(r.display, "Chef");
  assert.equal(r.source, "eigener");
});

test("Bekanntenkreis zaehlt, Fremde nicht", () => {
  // Sonst koennte jeder eine Namenslawine erzeugen und jemanden umbenennen.
  const evs = [
    nennt(FREUND_A, ZIEL.pk, "Max"),
    ...Array.from({ length: 50 }, () => nennt(generateKeypair(), ZIEL.pk, "Betrueger")),
  ];
  const r = resolveName(ZIEL.pk, evs, { trusted: VERTRAUT });
  assert.equal(r.display, "Max");
  assert.equal(r.agreement, 1);
});

test("Uneinigkeit wird angezeigt, nicht versteckt", () => {
  const r = resolveName(ZIEL.pk, [
    nennt(FREUND_A, ZIEL.pk, "Max"), nennt(FREUND_B, ZIEL.pk, "Maximilian"),
  ], { trusted: VERTRAUT });
  assert.equal(r.alternatives.length, 1);
});

test("Selbstbezeichnung ist die schwaechste Quelle", () => {
  const r = resolveName(ZIEL.pk, [], { selfNames: new Map([[ZIEL.pk, "Der Echte"]]) });
  assert.equal(r.source, "selbst");
  assert.match(displayWithSource(r), /ungeprüft/);
});

test("Ohne jede Quelle bleibt der gekuerzte Schluessel", () => {
  const r = resolveName(ZIEL.pk, []);
  assert.match(r.display, /…/);
});

test("Anzeige traegt die Herkunft mit", () => {
  // "Max" allein ist gefaehrlich. "Max (so nennen ihn 2 deiner Kontakte)" ist
  // eine Information.
  const r = resolveName(ZIEL.pk, [nennt(FREUND_A, ZIEL.pk, "Max"), nennt(FREUND_B, ZIEL.pk, "Max")], { trusted: VERTRAUT });
  assert.match(displayWithSource(r), /2 deiner Kontakte/);
});

// ------------------------------------------------------------- Imitation

test("Unsichtbare Zeichen werden erkannt", () => {
  const r = inspectName("Ma\u200Bx");
  assert.equal(r.suspicious, true);
  assert.match(r.reason!, /unsichtbare/);
  assert.equal(r.clean, "Max");
});

test("Gemischte Schriftsysteme werden markiert, nicht abgelehnt", () => {
  // Ablehnen wuerde Menschen ausschliessen, die ihre Sprache benutzen.
  const gemischt = inspectName("Mаx"); // kyrillisches а
  assert.equal(gemischt.suspicious, true);
  assert.match(gemischt.reason!, /Schriftsysteme/);

  const rein = inspectName("Владимир");
  assert.equal(rein.suspicious, false, "eine reine Schrift ist unverdaechtig");
});

test("Verwechslung mit Bekannten wird VOR der Zahlung gemeldet", () => {
  const bekannt = new Map([[FREUND_A.pk, "Max Mustermann"]]);
  const faelschung = resolveName(ZIEL.pk, [], { selfNames: new Map([[ZIEL.pk, "max.mustermann"]]) });
  const w = checkImpersonation(faelschung, bekannt);
  assert.ok(w);
  assert.match(w!, /Vor einer Zahlung prüfen/);
});

test("Ziffern-Tricks werden mit erkannt", () => {
  const bekannt = new Map([[FREUND_A.pk, "Alice"]]);
  const w = checkImpersonation(
    resolveName(ZIEL.pk, [], { selfNames: new Map([[ZIEL.pk, "A1ice"]]) }),
    bekannt,
  );
  assert.ok(w, "1 statt l ist der Klassiker");
});

test("Die Person selbst wird nicht als Imitation ihrer selbst gemeldet", () => {
  const bekannt = new Map([[ZIEL.pk, "Max"]]);
  assert.equal(checkImpersonation(resolveName(ZIEL.pk, [], { ownPetnames: bekannt }), bekannt), undefined);
});

// ------------------------------------------------------------- Suche

test("Suche findet ueber eigene und fremde Namen", () => {
  const r = searchByName("max", [nennt(FREUND_A, ZIEL.pk, "Maxime")], {
    ownPetnames: new Map([[FREMD.pk, "Max Chef"]]),
    trusted: VERTRAUT,
  });
  assert.equal(r.length, 2);
  assert.equal(r[0].source, "eigener", "eigene Namen zuerst");
});

test("Zu kurze Suchanfragen liefern nichts", () => {
  assert.equal(searchByName("m", [nennt(FREUND_A, ZIEL.pk, "Max")], { trusted: VERTRAUT }).length, 0);
});
