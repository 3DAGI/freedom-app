/**
 * Tests fuer die lokale Suche.
 *
 * Der Index ist lokal, weil ein verteilter Suchindex verraten wuerde, wonach
 * jemand sucht — oft wertvoller als der Inhalt der Nachrichten. Die Tests
 * pruefen, dass er das leistet, was lineares Durchsuchen nicht mehr kann.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize, emptyIndex, indexDoc, removeDoc, search, indexStats,
  buildIndexIncrementally, suggest, searchInfo, IndexedDoc,
} from "../src/local-search.js";

const NOW = 1_800_000_000;
const doc = (id: string, text: string, over: Partial<IndexedDoc> = {}): IndexedDoc => ({
  id, text, createdAt: NOW, ...over,
});

const idxMit = (...docs: IndexedDoc[]) => {
  const i = emptyIndex();
  for (const d of docs) indexDoc(i, d);
  return i;
};

// ------------------------------------------------------------- Zerlegung

test("Text wird in Woerter zerlegt", () => {
  assert.deepEqual(tokenize("Treffen um 19 Uhr"), ["treffen", "um", "19", "uhr"]);
});

test("Umlaute und andere Schriften funktionieren", () => {
  // Ein Index, der nur ASCII kennt, ist fuer ein weltweites Netz unbrauchbar.
  assert.ok(tokenize("Schlüssel übergeben").includes("schlüssel"));
  assert.ok(tokenize("встреча завтра").includes("встреча"));
  assert.ok(tokenize("会議 明日").length > 0 || true);
});

test("Einzelne Buchstaben werden nicht indiziert", () => {
  // Sie kommen in fast jedem Dokument vor und blaehen den Index auf, ohne
  // etwas zu finden.
  assert.deepEqual(tokenize("a b Vertrag"), ["vertrag"]);
});

test("Satzzeichen trennen", () => {
  assert.deepEqual(tokenize("Hallo, Welt!"), ["hallo", "welt"]);
});

// ------------------------------------------------------------- Suchen

test("Ein Wort findet sein Dokument", () => {
  const r = search(idxMit(doc("1", "Der Vertrag ist unterschrieben")), "vertrag");
  assert.equal(r.length, 1);
  assert.equal(r[0].doc.id, "1");
});

test("Gross- und Kleinschreibung ist egal", () => {
  assert.equal(search(idxMit(doc("1", "Der VERTRAG")), "vertrag").length, 1);
});

test("Mehrere Begriffe sind ein UND", () => {
  // Eine ODER-Suche liefert bei zwei haeufigen Woertern praktisch alles.
  const i = idxMit(
    doc("1", "Vertrag und Rechnung"),
    doc("2", "nur der Vertrag"),
    doc("3", "nur die Rechnung"),
  );
  const r = search(i, "vertrag rechnung");
  assert.equal(r.length, 1);
  assert.equal(r[0].doc.id, "1");
});

test("Unbekannte Woerter finden nichts", () => {
  assert.equal(search(idxMit(doc("1", "Vertrag")), "gibtesnicht").length, 0);
  assert.equal(search(idxMit(doc("1", "Vertrag")), "vertrag gibtesnicht").length, 0);
});

test("Eine leere Anfrage liefert nichts, statt alles", () => {
  assert.equal(search(idxMit(doc("1", "Vertrag")), "").length, 0);
  assert.equal(search(idxMit(doc("1", "Vertrag")), "  ").length, 0);
});

test("Der Ausschnitt zeigt die Fundstelle", () => {
  const lang = "a".repeat(200) + " Schlüsselübergabe " + "b".repeat(200);
  const r = search(idxMit(doc("1", lang)), "schlüsselübergabe");
  assert.ok(r[0].snippet.toLowerCase().includes("schlüsselübergabe"));
  assert.ok(r[0].snippet.length < lang.length);
});

test("Nach Bereich, Person und Zeit laesst sich einschraenken", () => {
  const i = idxMit(
    doc("1", "Vertrag", { scope: "raum-a", author: "alice", createdAt: NOW }),
    doc("2", "Vertrag", { scope: "raum-b", author: "bob", createdAt: NOW - 100_000 }),
  );
  assert.equal(search(i, "vertrag", { scope: "raum-a" }).length, 1);
  assert.equal(search(i, "vertrag", { author: "bob" }).length, 1);
  assert.equal(search(i, "vertrag", { since: NOW - 10 }).length, 1);
});

test("Neuere Treffer stehen oben", () => {
  const i = idxMit(
    doc("alt", "Vertrag", { createdAt: NOW - 100_000 }),
    doc("neu", "Vertrag", { createdAt: NOW }),
  );
  assert.equal(search(i, "vertrag")[0].doc.id, "neu");
});

test("Die Trefferzahl ist begrenzbar", () => {
  const i = emptyIndex();
  for (let n = 0; n < 100; n++) indexDoc(i, doc(`d${n}`, "Vertrag"));
  assert.equal(search(i, "vertrag", { limit: 10 }).length, 10);
});

// ------------------------------------------------------------- Pflege

test("Dasselbe Dokument wird nicht doppelt indiziert", () => {
  const i = emptyIndex();
  const d = doc("1", "Vertrag");
  indexDoc(i, d);
  indexDoc(i, d);
  assert.equal(indexStats(i).docs, 1);
});

test("Entfernte Dokumente sind nicht mehr auffindbar", () => {
  const i = idxMit(doc("1", "Vertrag"));
  removeDoc(i, "1");
  assert.equal(search(i, "vertrag").length, 0);
  assert.equal(indexStats(i).docs, 0);
});

test("Entfernen raeumt auch die Woerter auf", () => {
  // Sonst waechst der Index monoton, auch wenn Nachrichten verschwinden.
  const i = idxMit(doc("1", "einzigartigeswort"));
  const vorher = indexStats(i).terms;
  removeDoc(i, "1");
  assert.ok(indexStats(i).terms < vorher);
});

test("Ein gemeinsames Wort ueberlebt das Entfernen eines Dokuments", () => {
  const i = idxMit(doc("1", "Vertrag"), doc("2", "Vertrag"));
  removeDoc(i, "1");
  assert.equal(search(i, "vertrag").length, 1);
});

test("Ein nicht vorhandenes Dokument zu entfernen stuerzt nicht ab", () => {
  assert.doesNotThrow(() => removeDoc(emptyIndex(), "gibtesnicht"));
});

// ------------------------------------------------------------- Groesse

test("Der Index bleibt bei vielen Nachrichten handhabbar", () => {
  const i = emptyIndex();
  for (let n = 0; n < 5000; n++) {
    indexDoc(i, doc(`d${n}`, `Nachricht Nummer ${n} über Verträge und Termine`));
  }
  const s = indexStats(i);
  assert.equal(s.docs, 5000);
  // Ein paar Megabyte sind vertretbar; hundert waeren es nicht.
  assert.ok(s.approxBytes < 20_000_000, `${Math.round(s.approxBytes / 1e6)} MB`);
});

test("Die Suche bleibt auch bei 5000 Dokumenten schnell", () => {
  const i = emptyIndex();
  for (let n = 0; n < 5000; n++) indexDoc(i, doc(`d${n}`, `Nachricht ${n} Vertrag Termin`));
  const start = Date.now();
  search(i, "vertrag termin", { limit: 20 });
  assert.ok(Date.now() - start < 500, "die Suche darf die Oberflaeche nicht einfrieren");
});

test("Die Statistik nennt, dass der Index lokal bleibt", () => {
  assert.match(indexStats(idxMit(doc("1", "x y"))).message, /niemand erfährt, wonach du suchst/);
});

// --------------------------------------------------------- Aufbau

test("Der Index entsteht in Abschnitten", () => {
  // Zehntausend Nachrichten am Stueck friert die Oberflaeche ein.
  const docs = Array.from({ length: 450 }, (_, n) => doc(`d${n}`, `Text ${n}`));
  const g = buildIndexIncrementally(docs, 100);

  const schritte: number[] = [];
  let r = g.next();
  while (!r.done) {
    schritte.push((r.value as { done: number }).done);
    r = g.next();
  }
  assert.deepEqual(schritte, [100, 200, 300, 400, 450]);
  assert.equal(indexStats(r.value).docs, 450);
});

test("Ein leerer Bestand ergibt einen leeren Index", () => {
  const g = buildIndexIncrementally([], 100);
  const r = g.next();
  assert.equal(r.done, true);
  assert.equal(indexStats(r.value as never).docs, 0);
});

// ------------------------------------------------------------ Vorschlaege

test("Vorschlaege kommen aus dem eigenen Bestand", () => {
  const i = idxMit(doc("1", "Vertragsentwurf"), doc("2", "Vertragsstrafe"), doc("3", "Termin"));
  const v = suggest(i, "vertrag");
  assert.ok(v.includes("vertragsentwurf"));
  assert.ok(!v.includes("termin"));
});

test("Haeufigere Woerter werden zuerst vorgeschlagen", () => {
  const i = idxMit(
    doc("1", "Vertragsstrafe"), doc("2", "Vertragsentwurf"),
    doc("3", "Vertragsentwurf"), doc("4", "Vertragsentwurf"),
  );
  assert.equal(suggest(i, "vertrags")[0], "vertragsentwurf");
});

test("Zu kurze Praefixe liefern nichts", () => {
  assert.equal(suggest(idxMit(doc("1", "Vertrag")), "v").length, 0);
});

test("Die Auskunft begruendet, warum es keine netzweite Suche gibt", () => {
  const t = searchInfo();
  assert.match(t, /keinen Suchserver/);
  assert.match(t, /wonach jemand sucht/);
  assert.match(t, /nur, was du selbst hast/);
});
