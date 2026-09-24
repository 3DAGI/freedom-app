/**
 * Tests fuer die Abdeckungskarte.
 *
 * Hier geht es nicht um Korrektheit im ueblichen Sinn, sondern um Schaden:
 * Eine Karte von Funkknoten ist in manchen Laendern eine Zielliste. Die Tests
 * pruefen deshalb vor allem, dass die Karte WENIGER zeigt, als sie koennte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildCoverageAnnouncement, parseCoverageAnnouncement, buildCoverage,
  coverageAt, toCell, cellCenter, coverageConsentText,
  K_ANONYMITY, LAYER_CELL_DEGREES, KIND_COVERAGE, LAYER_LABEL, summarizeLayers,
  CoverageLayer,
} from "../src/coverage.js";

const NOW = 1_800_000_000;
const WIEN = { lat: 48.21, lon: 16.37 };

function meldung(layer: CoverageLayer, cell: string, createdAt = NOW - 100, kp = generateKeypair()) {
  return signEvent(
    buildCoverageAnnouncement({ pubkey: kp.pk, layer, cell, region: "eu" }, createdAt),
    kp.sk,
  );
}

// ------------------------------------------------------------- Zellen

test("Koordinaten werden auf Zellen gerundet — nie exakt gemeldet", () => {
  const c = toCell(WIEN.lat, WIEN.lon, LAYER_CELL_DEGREES.lora);
  assert.match(c, /^-?\d+\.\d{2},-?\d+\.\d{2}$/);
  // Zwei Punkte, 10 km auseinander, landen in derselben Zelle.
  assert.equal(toCell(48.21, 16.37, LAYER_CELL_DEGREES.lora), toCell(48.24, 16.39, LAYER_CELL_DEGREES.lora));
});

test("Weit entfernte Punkte liegen in verschiedenen Zellen", () => {
  assert.notEqual(
    toCell(48.21, 16.37, LAYER_CELL_DEGREES.lora),
    toCell(52.52, 13.40, LAYER_CELL_DEGREES.lora),
  );
});

test("Zellgroessen passen zur Reichweite, nicht zur Technik", () => {
  // Online darf genauer sein, weil die IP ohnehin sichtbar ist.
  assert.ok(LAYER_CELL_DEGREES.online > LAYER_CELL_DEGREES.lora);
  // Bluetooth reicht nur Meter — eine feine Zelle waere praktisch eine
  // Adresse. Deshalb GROEBER als Funk, nicht feiner.
  assert.ok(LAYER_CELL_DEGREES.bluetooth > LAYER_CELL_DEGREES.lora);
});

test("Drei Ebenen werden getrennt ausgewiesen", () => {
  // "Abdeckung vorhanden" ohne Angabe welcher Art waere fuer den Nutzer
  // wertlos: LoRa reicht Kilometer und traegt Text, Bluetooth reicht Meter
  // und traegt Dateien.
  const evs = [
    ...Array.from({ length: 3 }, () => meldung("lora", "48.00,16.00")),
    ...Array.from({ length: 3 }, () => meldung("bluetooth", "48.00,16.00")),
    meldung("online", "48.00,16.00"),
  ];
  const r = buildCoverage(evs, { nowSecs: NOW });
  const s = summarizeLayers(r.cells, r.hiddenCells);
  assert.equal(s.length, 3);
  assert.equal(s.find((x) => x.layer === "lora")!.cells, 1);
  assert.equal(s.find((x) => x.layer === "bluetooth")!.cells, 1);
  assert.equal(LAYER_LABEL.lora, "Funk (LoRa)");
});

test("Bluetooth unterliegt derselben Schwelle wie Funk", () => {
  // Ein einzelner Bluetooth-Knoten ist genauso ein Haushalt.
  const r = buildCoverage([meldung("bluetooth", "48.00,16.00")], { nowSecs: NOW });
  assert.equal(r.cells.length, 0);
});

test("Standortabfrage nennt die groesste Luecke", () => {
  // Ohne Funk hilft der beste Provider nichts, wenn das Netz weg ist.
  const cells = buildCoverage(
    [meldung("online", toCell(WIEN.lat, WIEN.lon, LAYER_CELL_DEGREES.online))], { nowSecs: NOW }).cells;
  const r = coverageAt(WIEN.lat, WIEN.lon, cells);
  assert.equal(r.online, true);
  assert.equal(r.lora, false);
  assert.equal(r.biggestGap, "lora");
});

test("Zustimmungstext fuer Bluetooth erklaert die groebere Zelle", () => {
  const t = coverageConsentText("bluetooth");
  assert.match(t, /GRÖBER/);
  assert.match(t, /nicht wo/);
  assert.match(t, /auch ohne Karte/);
});

test("Zellmittelpunkt laesst sich zurueckrechnen", () => {
  const c = toCell(48.21, 16.37, LAYER_CELL_DEGREES.lora);
  const m = cellCenter(c, LAYER_CELL_DEGREES.lora)!;
  assert.ok(Math.abs(m.lat - 48.21) < LAYER_CELL_DEGREES.lora);
  assert.equal(cellCenter("kaputt", 1), null);
});

// ------------------------------------------------------------- Meldungen

test("Meldung: Roundtrip", () => {
  const kp = generateKeypair();
  const ev = signEvent(
    buildCoverageAnnouncement({ pubkey: kp.pk, layer: "lora", cell: "48.00,16.00", region: "eu", rangeKm: 12 }),
    kp.sk,
  );
  const a = parseCoverageAnnouncement(ev);
  assert.equal(ev.kind, KIND_COVERAGE);
  assert.equal(a.layer, "lora");
  assert.equal(a.cell, "48.00,16.00");
  assert.equal(a.rangeKm, 12);
});

test("Zu genaue Angaben werden VERWORFEN, nicht gerundet uebernommen", () => {
  // Sonst koennte ein manipulierter Client heimlich genauer melden und die
  // Karte gaebe die Genauigkeit weiter.
  const kp = generateKeypair();
  const zuGenau = signEvent(buildEvent(kp.pk, KIND_COVERAGE, [
    ["layer", "lora"], ["cell", "48.2134,16.3712"], ["region", "eu"],
  ], ""), kp.sk);
  assert.throws(() => parseCoverageAnnouncement(zuGenau), /gültige Zelle/);
});

test("Meldung ohne gueltige Ebene wird abgelehnt", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, KIND_COVERAGE, [["layer", "satellit"], ["cell", "1.00,1.00"]], ""), kp.sk);
  assert.throws(() => parseCoverageAnnouncement(ev), /gültige Ebene/);
});

// ------------------------------------------------- Der eigentliche Punkt

test("Einzelner Funkknoten erscheint NICHT auf der Karte", () => {
  // Eine Zelle mit einem Knoten ist eine Adresse. Genau das darf die Karte
  // nicht ausgeben — auch nicht als "mindestens einer".
  const r = buildCoverage([meldung("lora", "48.00,16.00")], { nowSecs: NOW });
  assert.equal(r.cells.length, 0);
  assert.equal(r.hiddenCells, 1);
});

test("Zwei Funkknoten reichen auch nicht", () => {
  const evs = [meldung("lora", "48.00,16.00"), meldung("lora", "48.00,16.00")];
  assert.equal(buildCoverage(evs, { nowSecs: NOW }).cells.length, 0);
  assert.ok(K_ANONYMITY >= 3, "die Schwelle darf nie unter 3 rutschen");
});

test("Ab der Schwelle wird die Zelle angezeigt", () => {
  const evs = Array.from({ length: K_ANONYMITY }, () => meldung("lora", "48.00,16.00"));
  const r = buildCoverage(evs, { nowSecs: NOW });
  assert.equal(r.cells.length, 1);
  assert.equal(r.cells[0].layer, "lora");
});

test("Derselbe Knoten zaehlt nur einmal", () => {
  // Sonst koennte ein einzelner Betreiber die Schwelle allein ueberspringen
  // und sich damit selbst sichtbar machen.
  const kp = generateKeypair();
  const evs = Array.from({ length: 5 }, (_, i) => meldung("lora", "48.00,16.00", NOW - i, kp));
  assert.equal(buildCoverage(evs, { nowSecs: NOW }).cells.length, 0);
});

test("Online-Provider duerfen ab einem angezeigt werden", () => {
  // Ihre Adresse ist ohnehin oeffentlich, sobald sich jemand verbindet.
  const r = buildCoverage([meldung("online", "48.00,16.00")], { nowSecs: NOW });
  assert.equal(r.cells.length, 1);
  assert.equal(r.cells[0].layer, "online");
});

test("Anzahl wird in Stufen genannt, nicht exakt", () => {
  // "4" ist bei einer kleinen Zelle selbst schon ein Merkmal.
  const wenige = buildCoverage(
    Array.from({ length: 4 }, () => meldung("lora", "48.00,16.00")), { nowSecs: NOW },
  );
  assert.equal(wenige.cells[0].label, "wenige");

  const viele = buildCoverage(
    Array.from({ length: 25 }, () => meldung("lora", "48.00,16.00")), { nowSecs: NOW },
  );
  assert.equal(viele.cells[0].label, "viele");
});

test("Alte Meldungen verfallen — kein Verlauf", () => {
  // Bewegungsmuster ueber die Zeit sind deutlich identifizierender als ein
  // einzelner Punkt.
  const alt = Array.from({ length: 5 }, () => meldung("lora", "48.00,16.00", NOW - 30 * 86400));
  assert.equal(buildCoverage(alt, { nowSecs: NOW }).cells.length, 0);
});

test("Verdeckte Zellen werden gezaehlt, aber nicht verortet", () => {
  const evs = [
    meldung("lora", "48.00,16.00"),
    meldung("lora", "10.00,10.00"),
    ...Array.from({ length: 3 }, () => meldung("lora", "52.00,13.00")),
  ];
  const r = buildCoverage(evs, { nowSecs: NOW });
  assert.equal(r.cells.length, 1, "nur die Zelle ueber der Schwelle");
  assert.equal(r.hiddenCells, 2);
  // Die verdeckten Zellen duerfen im Ergebnis nirgends auftauchen.
  assert.ok(!r.cells.some((c) => c.cell === "48.00,16.00"));
});

// ------------------------------------------------------------- Abfrage

test("Standortabfrage antwortet ohne Zahlen zur Funk-Ebene", () => {
  const cells = buildCoverage(
    Array.from({ length: 5 }, () => meldung("lora", toCell(WIEN.lat, WIEN.lon, LAYER_CELL_DEGREES.lora))),
    { nowSecs: NOW },
  ).cells;
  const r = coverageAt(WIEN.lat, WIEN.lon, cells);
  assert.equal(r.lora, true);
  assert.doesNotMatch(r.message, /\d+ Knoten/, "keine Gruppengroesse nennen");
});

test("Ohne Eintraege wird nicht behauptet, es gaebe nichts", () => {
  // Eintragen ist freiwillig — "nichts eingetragen" ist etwas anderes als
  // "nichts da".
  const r = coverageAt(WIEN.lat, WIEN.lon, []);
  assert.equal(r.online, false);
  assert.match(r.message, /freiwillig/);
});

test("Provider ohne Funk: die Luecke wird als Einladung benannt", () => {
  const cells = buildCoverage([meldung("online", toCell(WIEN.lat, WIEN.lon, LAYER_CELL_DEGREES.online))], { nowSecs: NOW }).cells;
  const r = coverageAt(WIEN.lat, WIEN.lon, cells);
  assert.equal(r.online, true);
  assert.match(r.message, /Lücke schließen/);
});

// ------------------------------------------------------------- Zustimmung

test("Zustimmungstext fuer Funk warnt deutlich und nennt die Grenzen", () => {
  const t = coverageConsentText("lora");
  assert.match(t, /ÜBERLEG DIR DAS/);
  assert.match(t, /Zielliste|Risiko/);
  // Wichtiger als die Schutzmassnahmen: was NICHT geschuetzt wird.
  assert.match(t, /NICHT geschützt/);
  assert.match(t, /Im Zweifel: nicht eintragen/);
  assert.ok(t.includes(String(K_ANONYMITY)));
});

test("Zustimmungstext fuer Online ist angemessen kurz", () => {
  const t = coverageConsentText("online");
  assert.match(t, /ohnehin sichtbar/);
  assert.ok(t.length < coverageConsentText("lora").length, "keine Panikmache, wo kein Risiko ist");
});
