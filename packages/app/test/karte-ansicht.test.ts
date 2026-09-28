/**
 * Schritt C.4a: Abdeckungskarte als SVG – Projektion, Zellen als Rechtecke,
 * Zoom und Verschieben, Gradnetz. Die Karte zeigt nur, was `buildCoverage()`
 * ausgibt: Zellen über der Schwelle, nie einzelne Einträge, nie die Zahl.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type CoverageCell, type CoverageLayer, K_ANONYMITY, baueCoverageEintrag, buildCoverage } from "@freedomstack/protocol";
import {
  START, WELT, ZOOM_MAX, ausschnitt, gradnetz, imAusschnitt, kartenZellen, projiziere, verschiebe, zellRechteck, zoome,
} from "../src/karte-ansicht.js";
import { gebietText, zellText } from "../src/shell/tabs/karte.js";
import { setLang } from "../src/i18n.js";

const ALLE = new Set<CoverageLayer>(["online", "lora", "bluetooth"]);
const JETZT = 1_800_000_000;
const eintrag = (layer: CoverageLayer, cell: string, region = "") => baueCoverageEintrag({ layer, cell, region }, JETZT).event;
const zelle = (layer: CoverageLayer, cell: string, nodes = 5, region = ""): CoverageCell =>
  ({ layer, cell, nodes, region, center: null, label: "wenige" } as unknown as CoverageCell);

test("C.4a: Plattkarte – Länge nach x, Breite nach y, Zelle an der Südwest-Ecke in der Größe ihrer Ebene", () => {
  assert.deepEqual(projiziere(90, -180), { x: 0, y: 0 });
  assert.deepEqual(projiziere(-90, 180), { x: WELT.breite, y: WELT.hoehe });
  assert.deepEqual(zellRechteck({ layer: "lora", cell: "48.50,11.00" }), { x: 191, y: 41, b: 0.5, h: 0.5 });
  assert.deepEqual(zellRechteck({ layer: "online", cell: "48.00,10.00" }), { x: 190, y: 40, b: 2, h: 2 });
  assert.deepEqual(zellRechteck({ layer: "bluetooth", cell: "-34.00,-59.00" }), { x: 121, y: 123, b: 1, h: 1 });
  assert.deepEqual(zellRechteck({ layer: "lora", cell: "89.50,179.50" }), { x: 359.5, y: 0, b: 0.5, h: 0.5 });
});

test("C.4a: Unfug in der Zellkennung ergibt kein Rechteck (sie kommt aus fremden Events)", () => {
  for (const cell of ["", "abc", "1,2,3", "NaN,1", "1,", ",1", " 1,1", "1,1\n", "0x1,1", "+1,1", "1.,1", "95.00,0.00", "-91.00,0.00", "90.00,0.00", "0.00,180.00", "0.00,-181.00", "1e400,0", "Infinity,0"]) {
    assert.equal(zellRechteck({ layer: "lora", cell }), null, cell);
  }
  assert.equal(zellRechteck({ layer: "funk" as CoverageLayer, cell: "1.00,1.00" }), null);
  assert.deepEqual(kartenZellen([zelle("lora", "x,y"), zelle("lora", "1.00,1.00")], ALLE).map((z) => z.cell), ["1.00,1.00"]);
});

test("C.4a: nur Zellen über der Schwelle aus buildCoverage() – zu wenige Einträge ergeben kein Rechteck", () => {
  assert.equal(K_ANONYMITY, 3);
  const evs = [
    // zwei Funkknoten: unter der Schwelle, nie auf der Karte
    eintrag("lora", "52.00,13.00"), eintrag("lora", "52.00,13.00"),
    // drei Funkknoten: gezeigt
    eintrag("lora", "48.00,11.00"), eintrag("lora", "48.00,11.00"), eintrag("lora", "48.00,11.00"),
    // ein Provider im Netz: ab einem gezeigt (Adresse ohnehin öffentlich)
    eintrag("online", "50.00,8.00"),
    // zwei Bluetooth: unter der Schwelle
    eintrag("bluetooth", "47.00,8.00"), eintrag("bluetooth", "47.00,8.00"),
  ];
  const r = buildCoverage(evs, { nowSecs: JETZT });
  assert.equal(r.hiddenCells, 2);
  const z = kartenZellen(r.cells, ALLE);
  assert.deepEqual(z.map((c) => `${c.layer}:${c.cell}`), ["online:50.00,8.00", "lora:48.00,11.00"], "gröbere Ebene zuerst (liegt unten)");
  assert.ok(!z.some((c) => c.cell === "52.00,13.00" || c.layer === "bluetooth"));
  // Die Karte bekommt Zellen, nie Einträge: keine Schlüssel, keine Event-Felder
  for (const c of z) assert.deepEqual(Object.keys(c).sort(), ["b", "cell", "h", "layer", "nodes", "region", "x", "y"]);
  // Schalter: nur die gewählten Ebenen
  assert.deepEqual(kartenZellen(r.cells, new Set(["lora"])).map((c) => c.layer), ["lora"]);
  assert.deepEqual(kartenZellen(r.cells, new Set()), []);
});

test("C.4a: Angaben je Zelle – Ebene, Gebiet, Stufe; nie die Zahl der Einträge", () => {
  setLang("de");
  const text = zellText(zelle("lora", "48.00,11.00", 4));
  assert.equal(text, "Funk (LoRa): um 48,25° N, 11,25° O – wenige");
  assert.doesNotMatch(text, /\b4\b/);
  assert.equal(zellText(zelle("bluetooth", "-34.00,-59.00", 9)), "Bluetooth: um 33,5° S, 58,5° W – mehrere");
  assert.equal(zellText(zelle("online", "50.00,8.00", 25, "Frankfurt")), "Provider im Netz: Frankfurt – viele");
  setLang("en");
  assert.equal(gebietText(zelle("lora", "48.00,11.00")), "around 48.25° N, 11.25° E");
  // Fremder Name: gekürzt und getrimmt; Unfug ohne Namen: die Kennung, gekürzt
  assert.equal(gebietText(zelle("lora", "1.00,1.00", 3, `  ${"x".repeat(100)}  `)), "x".repeat(60));
  assert.equal(gebietText(zelle("lora", "y".repeat(100))), "y".repeat(30));
});

test("C.4a: Zoom und Verschieben bleiben in der Welt; der Punkt unter dem Zeiger bleibt stehen", () => {
  assert.deepEqual(ausschnitt(START), { x: 0, y: 0, b: 360, h: 180 });
  assert.deepEqual(zoome(START, 0.5), START, "weiter weg als die Welt geht nicht");
  assert.equal(zoome(START, 1000).zoom, ZOOM_MAX);
  assert.deepEqual(verschiebe(START, 50, 50), START, "bei der ganzen Welt gibt es nichts zu verschieben");
  const p = { x: 100, y: 50 };
  const z2 = zoome(START, 2, p);
  const s = ausschnitt(z2);
  assert.equal(s.b, 180);
  assert.equal((p.x - s.x) / s.b, 100 / 360);
  assert.equal((p.y - s.y) / s.h, 50 / 180);
  // Ganz nach rechts unten verschoben: der Ausschnitt endet am Rand
  const rand = ausschnitt(verschiebe(z2, 1e6, 1e6));
  assert.equal(rand.x + rand.b, WELT.breite);
  assert.equal(rand.y + rand.h, WELT.hoehe);
  const links = ausschnitt(verschiebe(z2, -1e6, -1e6));
  assert.equal(links.x, 0);
  assert.equal(links.y, 0);
  // zurück auf die Welt
  assert.deepEqual(ausschnitt(zoome(z2, 1 / 2)), ausschnitt(START));
});

test("C.4a: Gradnetz alle 30°, beim Zoomen alle 10°; Tab nur zu Zellen im Ausschnitt", () => {
  const grob = gradnetz(1), fein = gradnetz(3);
  assert.equal(grob.laengen.length, 13);
  assert.equal(grob.breiten.length, 7);
  assert.ok(grob.breiten.includes(0));
  assert.equal(fein.laengen.length, 37);
  assert.equal(fein.breiten.length, 19);
  const europa = zoome(START, 8, projiziere(50, 10));
  const muenchen = zellRechteck({ layer: "lora", cell: "48.00,11.00" })!;
  const sydney = zellRechteck({ layer: "lora", cell: "-34.00,151.00" })!;
  assert.ok(imAusschnitt(muenchen, europa));
  assert.ok(!imAusschnitt(sydney, europa));
  assert.ok(imAusschnitt(sydney, START));
});

test("C.4a: verdrahtet – Karte nach buildCoverage(), nur DOM, keine rohen Events, Liste ohne innerHTML", () => {
  const karte = readFileSync(new URL("../src/shell/tabs/karte.ts", import.meta.url), "utf8");
  const rechnung = readFileSync(new URL("../src/karte-ansicht.ts", import.meta.url), "utf8");
  const earn = readFileSync(new URL("../src/shell/tabs/earn.ts", import.meta.url), "utf8");
  const ohneKommentare = (q: string) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const quelle of [karte, rechnung].map(ohneKommentare)) {
    assert.doesNotMatch(quelle, /innerHTML|insertAdjacentHTML|outerHTML/);
    assert.doesNotMatch(quelle, /KIND_COVERAGE|parseCoverageAnnouncement|buildCoverage\(|pool\.query|pubkey/);
  }
  assert.match(earn, /const r = buildCoverage\(evs\);\n\s+zeigeKarte\(r\.cells, r\.hiddenCells\);/);
  const liste = earn.slice(earn.indexOf("export async function ladeAbdeckung"), earn.indexOf("export async function trageAbdeckungEin"));
  assert.doesNotMatch(liste, /innerHTML|slice\(0, 15\)/);
  assert.match(liste, /gebietText\(c\)/);
});
