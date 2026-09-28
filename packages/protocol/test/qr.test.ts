/**
 * Schritt 11.1a: QR-Codes ohne Abhängigkeit. Verglichen mit python-qrcode
 * 7.4.2 (`fixtures/qr-referenz.json`, erzeugt mit `scripts/qr-referenz.py`):
 * Kapazität je Version und Stufe, Version nach Länge, Module Bit für Bit bei
 * fester Maske (alle acht, alle Stufen, Längenangabe mit 8 und 16 Bit,
 * Versionsinformation ab 7, bis Version 40). Die Wahl der Maske prüft der Test
 * selbst: die mit den wenigsten Strafpunkten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ProtokollFehler } from "../src/fehler.js";
import { qrCode, qrKapazitaet, qrStrafpunkte, qrSvgPfad, type QrStufe } from "../src/qr.js";

interface Fall { stufe: QrStufe; maske: number; version: number; text?: string; hex?: string; zeilen?: string[]; sha256?: string }
const REF = JSON.parse(readFileSync(new URL("./fixtures/qr-referenz.json", import.meta.url), "utf8")) as {
  kapazitaet: Record<QrStufe, number[]>;
  faelle: Fall[];
};

const bits = (m: boolean[][]) => m.map((z) => z.map((b) => (b ? "1" : "0")).join(""));
const ausHex = (hex: string, n: number) => [...hex].map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("").slice(0, n);
const daten = (f: Fall) => (f.text !== undefined ? f.text : Uint8Array.from(Buffer.from(f.hex!, "hex")));

test("Kapazität im Byte-Modus: alle 40 Versionen, alle Stufen wie die Referenz", () => {
  for (const s of ["L", "M", "Q", "H"] as const) {
    assert.deepEqual(Array.from({ length: 40 }, (_, i) => qrKapazitaet(i + 1, s)), REF.kapazitaet[s], s);
  }
  // Eckwerte aus der Norm (Tabelle 7)
  assert.deepEqual([qrKapazitaet(1, "L"), qrKapazitaet(1, "H"), qrKapazitaet(40, "L"), qrKapazitaet(40, "M")], [17, 7, 2953, 2331]);
});

test("Module Bit für Bit wie die Referenz – feste Maske, Version nach Länge", () => {
  assert.equal(REF.faelle.length, 48);
  for (const f of REF.faelle) {
    const q = qrCode(daten(f), { stufe: f.stufe, maske: f.maske });
    const name = `${(f.text ?? f.hex!).slice(0, 16)}… ${f.stufe}/${f.maske}`;
    assert.equal(q.version, f.version, name);
    assert.equal(q.groesse, 17 + 4 * f.version, name);
    assert.equal(q.module.length, q.groesse, name);
    if (f.zeilen) {
      assert.deepEqual(bits(q.module), f.zeilen.map((h) => ausHex(h, q.groesse)), name);
    } else {
      assert.equal(createHash("sha256").update(bits(q.module).join("\n")).digest("hex"), f.sha256, name);
    }
  }
});

test("Gerätecode (144 Zeichen) passt bei Stufe M in Version 8, UTF-8 wie Bytes", () => {
  const code = "freedom-geraet:" + "ab".repeat(32) + ":" + "cd".repeat(32);
  assert.equal(qrCode(code).version, 8);
  assert.equal(qrCode(code).stufe, "M");
  const text = "grüße ✓";
  assert.deepEqual(qrCode(text), qrCode(new TextEncoder().encode(text)));
});

test("Maske: die mit den wenigsten Strafpunkten, bei Gleichstand die kleinste", () => {
  for (const f of REF.faelle.filter((f) => f.maske === 0 && f.zeilen)) {
    const auto = qrCode(daten(f), { stufe: f.stufe });
    const punkte = Array.from({ length: 8 }, (_, k) => qrStrafpunkte(qrCode(daten(f), { stufe: f.stufe, maske: k }).module));
    assert.equal(auto.maske, punkte.indexOf(Math.min(...punkte)), `${f.stufe}: ${punkte.join(",")}`);
    assert.deepEqual(auto.module, qrCode(daten(f), { stufe: f.stufe, maske: auto.maske }).module);
  }
});

test("Strafpunkte: Läufe, Blöcke, Suchmuster, Anteil dunkel", () => {
  const leer = (n: number) => Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  // 5×5 hell: 10 Läufe à 5 (je 3) + 16 Blöcke (je 3) + 0 % dunkel (100)
  assert.equal(qrStrafpunkte(leer(5)), 30 + 48 + 100);
  const schach = (n: number) => Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (x + y) % 2 === 0));
  assert.equal(qrStrafpunkte(schach(5)), 0);
  // 1:1:3:1:1 mit vier hellen Modulen daneben – einmal je Fundstelle
  const m = schach(15);
  m[7] = [..."000010111010000"].map((c) => c === "1");
  assert.equal(qrStrafpunkte(m), 40);
  // am Rand zählt die Ruhezone als hell
  const r = schach(15);
  r[7] = [..."101110101010101"].map((c) => c === "1");
  assert.equal(qrStrafpunkte(r), 40);
});

test("zu lang → ProtokollFehler qr-zu-lang mit Länge und Höchstwert; falsche Optionen werfen", () => {
  assert.equal(qrCode(new Uint8Array(2331)).version, 40);
  assert.throws(() => qrCode(new Uint8Array(2332)), (e: unknown) =>
    e instanceof ProtokollFehler && e.kennung === "qr-zu-lang" && e.werte.n === 2332 && e.werte.max === 2331);
  assert.throws(() => qrCode("x", { stufe: "X" as QrStufe }), /unbekannte Stufe/);
  assert.throws(() => qrCode("x", { maske: 8 }), /Maske 0–7/);
  assert.throws(() => qrCode("x", { maske: 1.5 }), /Maske 0–7/);
});

test("SVG-Pfad: je Zeile zusammengefasste Rechtecke mit Ruhezone, nur Zahlen und Befehle", () => {
  assert.equal(qrSvgPfad({ module: [[true, true, false], [false, true, false]] }, 1), "M1 1h2v1h-2zM2 2h1v1h-1z");
  const q = qrCode("FreedomStack");
  const d = qrSvgPfad(q);
  assert.match(d, /^(M\d+ \d+h\d+v1h-\d+z)+$/);
  const flaeche = [...d.matchAll(/h(\d+)v/g)].reduce((s, x) => s + Number(x[1]), 0);
  assert.equal(flaeche, q.module.flat().filter(Boolean).length);
  assert.ok(d.startsWith("M4 4h7v1h-7z"), "Suchmuster oben links, Rand 4");
});
