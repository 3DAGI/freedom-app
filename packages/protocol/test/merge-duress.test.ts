/**
 * Tests fuer Zusammenfuehren und Notfall-Loeschung.
 *
 * Beim Zusammenfuehren geht es darum, dass keine Arbeit stillschweigend
 * verschwindet. Bei der Loeschung darum, dass die Aufklaerung die Gefahr
 * zuerst nennt — die Funktion kann ihrem Nutzer schaden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySet, setAdd, setRemove, setValues, mergeSets, mergeField,
  summarizeConflicts,
} from "../src/merge.js";
import {
  wipeAll, checkUnlock, duressWarning, wipeConfirmation, WIPE_TARGETS, StorageLike,
  loescheAllesLokal, WIPE_DATENBANKEN,
} from "../src/duress.js";

const T0 = 1000, T1 = 2000, T2 = 3000;

// ------------------------------------------------------- Zusammenfuehren

test("Hinzufuegen und Auslesen", () => {
  const s = setAdd(setAdd(emptySet<string>(), "a", "Alice", T0), "b", "Bob", T0);
  assert.equal(setValues(s).length, 2);
});

test("Entferntes verschwindet", () => {
  const s = setRemove(setAdd(emptySet<string>(), "a", "Alice", T0), "a", T1);
  assert.equal(setValues(s).length, 0);
});

test("Ein spaeteres Hinzufuegen hebt ein Entfernen auf", () => {
  const s = setAdd(setRemove(setAdd(emptySet<string>(), "a", "Alice", T0), "a", T1), "a", "Alice", T2);
  assert.equal(setValues(s).length, 1);
});

test("Ein aelteres Hinzufuegen hebt es NICHT auf", () => {
  // Sonst koennte ein Geraet mit alter Uhr jemanden zurueckholen, den ein
  // anderes gerade entfernt hat.
  const s = emptySet<string>();
  setRemove(s, "a", T2);
  setAdd(s, "a", "Alice", T0);
  assert.equal(setValues(s).length, 0);
});

test("DER KERN: verschiedene Aenderungen gehen NICHT verloren", () => {
  // Beim naiven "letzter gewinnt" waere die Haelfte weg.
  const geraetA = setAdd(emptySet<string>(), "alice", "Alice", T0);
  const geraetB = setAdd(emptySet<string>(), "bob", "Bob", T1);

  const { result } = mergeSets(geraetA, geraetB);
  assert.equal(setValues(result).length, 2);
});

test("Ein Entfernen auf einem Geraet setzt sich durch", () => {
  const beide = setAdd(emptySet<string>(), "mallory", "Mallory", T0);
  const entfernt = setRemove(setAdd(emptySet<string>(), "mallory", "Mallory", T0), "mallory", T1);

  const { result } = mergeSets(beide, entfernt);
  assert.equal(setValues(result).length, 0);
});

test("Grabsteine verhindern, dass Entferntes zurueckkommt", () => {
  // Ohne Grabstein haette das zweite Geraet den Eintrag noch und wuerde ihn
  // beim Zusammenfuehren wieder einbringen.
  const hat = setAdd(emptySet<string>(), "mallory", "Mallory", T0);
  const entferntOhneVorwissen = setRemove(emptySet<string>(), "mallory", T1);

  const { result } = mergeSets(hat, entferntOhneVorwissen);
  assert.equal(setValues(result).length, 0);
});

test("Bei Gleichstand gewinnt das Entfernen", () => {
  // Jemanden versehentlich auszuschliessen laesst sich rueckgaengig machen,
  // ihn versehentlich drinzulassen nicht.
  const a = setAdd(emptySet<string>(), "x", "X", T1);
  const b = setRemove(setAdd(emptySet<string>(), "x", "X", T0), "x", T1);
  assert.equal(setValues(mergeSets(a, b).result).length, 0);
});

test("Echte Konflikte werden GEMELDET, nicht verschwiegen", () => {
  // Stillschweigend zu ueberschreiben ist der Fehler, den die meisten
  // Systeme machen — der Nutzer merkt es Wochen spaeter.
  const a = setAdd(emptySet<string>(), "raum", "Alter Name", T0);
  const b = setAdd(emptySet<string>(), "raum", "Neuer Name", T1);

  const { report } = mergeSets(a, b);
  assert.equal(report.conflicts.length, 1);
  assert.match(report.conflicts[0].kept, /Neuer Name/);
  assert.match(report.conflicts[0].discarded, /Alter Name/);
});

test("Gleiche Werte sind kein Konflikt", () => {
  const a = setAdd(emptySet<string>(), "raum", "Name", T0);
  const b = setAdd(emptySet<string>(), "raum", "Name", T1);
  assert.equal(mergeSets(a, b).report.conflicts.length, 0);
});

test("Zusammenfuehren ist unabhaengig von der Reihenfolge", () => {
  // Sonst hingen zwei Geraete dauerhaft auseinander.
  const a = setAdd(emptySet<string>(), "alice", "Alice", T0);
  const b = setAdd(emptySet<string>(), "bob", "Bob", T1);
  const ab = setValues(mergeSets(a, b).result).map((x) => x.key).sort();
  const ba = setValues(mergeSets(b, a).result).map((x) => x.key).sort();
  assert.deepEqual(ab, ba);
});

test("Felder werden EINZELN zusammengefuehrt", () => {
  // Ein Geraet, das den Namen aendert, ueberschreibt nicht die Rollen, die
  // das andere geaendert hat.
  const name = mergeField(
    { value: "Alt", updatedAt: T0 }, { value: "Neu", updatedAt: T1 });
  const regeln = mergeField(
    { value: "Regel A", updatedAt: T2 }, { value: "Regel B", updatedAt: T0 });
  assert.equal(name.result.value, "Neu");
  assert.equal(regeln.result.value, "Regel A");
});

test("Feld-Konflikte melden, was verworfen wurde", () => {
  const r = mergeField({ value: "Alt", updatedAt: T0 }, { value: "Neu", updatedAt: T1 });
  assert.equal(r.conflicted, true);
  assert.equal(r.discarded, "Alt");
});

test("Bei exakt gleicher Zeit entscheiden beide Seiten GLEICH", () => {
  // Sonst kaemen zwei Geraete zu verschiedenen Ergebnissen und blieben
  // dauerhaft uneins.
  const a = { value: "A", updatedAt: T1, by: "geraet-a" };
  const b = { value: "B", updatedAt: T1, by: "geraet-b" };
  assert.equal(mergeField(a, b).result.value, mergeField(b, a).result.value);
});

test("Die Zusammenfassung sagt, was passiert ist", () => {
  const a = setAdd(emptySet<string>(), "x", "Alt", T0);
  const b = setAdd(emptySet<string>(), "x", "Neu", T1);
  const s = summarizeConflicts([mergeSets(a, b).report]);
  assert.equal(s.total, 1);
  assert.match(s.message, /überschrieben/);
  assert.equal(s.details.length, 1);
});

test("Ohne Konflikte wird nicht beunruhigt", () => {
  assert.match(summarizeConflicts([]).message, /Ohne Konflikte/);
});

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
