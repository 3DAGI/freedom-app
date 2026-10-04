/**
 * Tests fuer die Notfall-Loeschung: Die Aufklaerung nennt die Gefahr zuerst –
 * die Funktion kann ihrem Nutzer schaden. (Die Mengen mit Zeitstempeln aus
 * `merge.ts`, die hier mitgetestet wurden, fielen mit B-21; zusammengefuehrt
 * wird seit B-5 in der App, `zustand-zusammenfuehren.ts`.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  wipeAll, checkUnlock, duressWarning, wipeConfirmation, WIPE_TARGETS, StorageLike,
  loescheAllesLokal, WIPE_DATENBANKEN,
} from "../src/duress.js";

const T0 = 1000, T1 = 2000, T2 = 3000;

// ------------------------------------------------------------- Loeschung

function fakeStorage(daten: Record<string, string>): StorageLike & { daten: Record<string, string> } {
  return {
    daten,
    get length() { return Object.keys(daten).length; },
    key(i: number) { return Object.keys(daten)[i] ?? null; },
    removeItem(k: string) { delete daten[k]; },
  };
}

test("Alles mit dem Praefix wird geloescht", () => {
  const s = fakeStorage({
    "freedom.sk": "geheim", "freedom.conversations": "[]",
    "freedom.unbekannter_neuer_schluessel": "x", "andere.app": "bleibt",
  });
  const r = wipeAll(s);
  assert.equal(s.daten["freedom.sk"], undefined);
  // Eine Liste veraltet, ein Praefix nicht — ein vergessener Eintrag waere
  // genau der, der jemanden verraet.
  assert.equal(s.daten["freedom.unbekannter_neuer_schluessel"], undefined);
  assert.equal(s.daten["andere.app"], "bleibt", "fremde Daten bleiben");
  assert.ok(r.cleared.length >= 3);
});

test("Fehlgeschlagene Loeschungen werden BENANNT", () => {
  // Ein stiller Fehlschlag laesst den Nutzer glauben, er sei sicher.
  const s = fakeStorage({ "freedom.sk": "geheim" });
  const kaputt: StorageLike = {
    length: 1,
    key: () => "freedom.sk",
    removeItem: () => { throw new Error("Speicher gesperrt"); },
  };
  void s;
  const r = wipeAll(kaputt);
  assert.ok(r.failed.length > 0);
  assert.match(r.message, /NICHT/);
});

test("Alle kritischen Ziele stehen in der Liste", () => {
  for (const noetig of ["Identität", "Wallet", "Gerätevollmachten"]) {
    assert.ok(WIPE_TARGETS.some((t) => t.label.includes(noetig)), `${noetig} fehlt`);
  }
});

// ------------------------------------------------------------- Zwangslage

const hash = (s: string) => `h(${s})`;

test("Die richtige Phrase oeffnet normal", () => {
  const r = checkUnlock("meine phrase", hash("meine phrase"), null, hash);
  assert.equal(r.result, "normal");
  assert.equal(r.action, "oeffnen");
});

test("Eine falsche Phrase wird abgelehnt", () => {
  assert.equal(checkUnlock("falsch", hash("richtig"), null, hash).result, "falsch");
});

test("Ohne eingerichtete Zwangsphrase gibt es keine", () => {
  // Sie ist AUS, bis jemand sie ausdruecklich einschaltet.
  assert.equal(checkUnlock("irgendwas", hash("richtig"), null, hash).result, "falsch");
});

test("Die Zwangsphrase loescht und oeffnet leer", () => {
  const r = checkUnlock("zwang", hash("normal"), hash("zwang"), hash);
  assert.equal(r.result, "zwang");
  assert.equal(r.action, "leer_oeffnen_und_loeschen");
});

test("Der Zwangsfall gibt dem NUTZER keinen Hinweis", () => {
  // Wer daneben steht, sieht eine App, die aufgeht. Eine abweichende Meldung
  // waere das Gegenteil des Zwecks.
  const zwang = checkUnlock("zwang", hash("normal"), hash("zwang"), hash);
  const normal = checkUnlock("normal", hash("normal"), hash("zwang"), hash);
  assert.notEqual(zwang.internalNote, "", "intern muss es vermerkt sein");
  assert.equal(normal.internalNote, "");
});

test("DIE AUFKLAERUNG NENNT DIE GEFAHR ZUERST", () => {
  // Diese Funktion kann ihrem Nutzer schaden. Wer nach dem Text noch
  // einrichtet, hat bewusst entschieden — das ist die Mindestanforderung.
  const t = duressWarning();
  const gefahr = t.indexOf("SCHADEN");
  const nutzen = t.indexOf("Sie hilft");
  assert.ok(gefahr < nutzen, "die Gefahr muss vor dem Nutzen stehen");
  assert.match(t, /strafbar/);
  assert.match(t, /quelloffen/);
  assert.match(t, /sicherer, diese Funktion NICHT zu nutzen/);
});

test("Die Loeschbestaetigung nennt die Endgueltigkeit und die Grenze", () => {
  const t = wipeConfirmation();
  assert.match(t, /KEINE Wiederherstellung/);
  assert.match(t, /Merkphrase/);
  assert.match(t, /schon auf Relays liegt/);
});

// ------------------------------------------------- Notfall-Loeschung (8.14)

function fakeDbs(namen: string[], kaputt: string[] = [], kommtWieder: string[] = []) {
  const da = new Set(namen);
  return {
    da,
    datenbanken: async () => [...da],
    loescheDatenbank: async (n: string) => {
      if (kaputt.includes(n)) throw new Error("blockiert");
      da.delete(n);
      if (kommtWieder.includes(n)) da.add(n);
    },
  };
}

test("8.14: loescht localStorage, sessionStorage und alle eigenen Datenbanken – und prueft nach", async () => {
  const local = fakeStorage({ "freedom.nsec": "geheim", "freedom.chats": "[]", "freedom.neu": "x", "andere.app": "bleibt" });
  const session = fakeStorage({ "freedom.sitzung": "y", "fremd": "bleibt" });
  const dbs = fakeDbs(["freedom-vault", "freedom-suche", "freedom-blobs", "freedom-kuenftig", "andere-db"]);
  const r = await loescheAllesLokal({ local, session, datenbanken: dbs.datenbanken, loescheDatenbank: dbs.loescheDatenbank });
  assert.deepEqual(Object.keys(local.daten), ["andere.app"]);
  assert.deepEqual(Object.keys(session.daten), ["fremd"]);
  assert.deepEqual([...dbs.da], ["andere-db"], "eigene Datenbanken weg – auch eine, die in keiner Liste steht");
  assert.deepEqual(r.uebrig, []);
  assert.equal(r.nachgeprueft, true);
  assert.ok(r.cleared.includes("db:freedom-kuenftig"));
  assert.match(r.message, /nachgeprüft\. Dieses Gerät weiß nichts mehr/);
});

test("8.14: was blockiert oder wieder auftaucht, wird BENANNT", async () => {
  const dbs = fakeDbs(["freedom-vault", "freedom-suche"], ["freedom-vault"], ["freedom-suche"]);
  const r = await loescheAllesLokal({ local: fakeStorage({}), datenbanken: dbs.datenbanken, loescheDatenbank: dbs.loescheDatenbank });
  assert.ok(r.failed.includes("db:freedom-vault"));
  assert.ok(r.uebrig.includes("db:freedom-suche"));
  assert.match(r.message, /NICHT — .*db:freedom-vault.*db:freedom-suche/);
});

test("8.14: ohne Liste der Datenbanken werden die bekannten geloescht, nachgeprueft ist dann nicht", async () => {
  const geloescht: string[] = [];
  const r = await loescheAllesLokal({ local: fakeStorage({ "freedom.nsec": "k" }), loescheDatenbank: async (n) => { geloescht.push(n); } });
  assert.deepEqual(geloescht, WIPE_DATENBANKEN);
  assert.equal(r.nachgeprueft, false);
  assert.doesNotMatch(r.message, /nachgeprüft/);
});

test("8.14: der rechtliche Hinweis steht in der Loeschbestaetigung", () => {
  const t = wipeConfirmation();
  assert.match(t, /RECHTLICHER HINWEIS/);
  assert.match(t, /Beweismitteln strafbar/);
  assert.match(t, /keine Rechtsberatung/);
  assert.match(t, /laufenden\s+Tauschvorgängen/);
  assert.ok(t.indexOf("RECHTLICHER HINWEIS") < t.indexOf("Was NICHT gelöscht wird"));
});
