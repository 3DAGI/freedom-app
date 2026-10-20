/**
 * Bild vom eigenen Knoten (VKg2b): Größe des Bildschirms im Rahmen des Protokolls, die Stelle im eingepassten Bild und nur
 * Eingaben im Format, das der Knoten liest (`PROTOCOL.md` §34).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_GRENZEN } from "@freedomstack/protocol";
import { EINGABE_ZEICHEN, bildGroesse, eingabeText, gehtInsBild, knopfImBild, zeigerAnteil } from "../src/bild-ablauf.js";

test("VKg2b: Größe – Gerätepixel im Seitenverhältnis, eingepasst in den Rahmen, gerade", () => {
  assert.deepEqual(bildGroesse(640, 360, 1), { breite: 640, hoehe: 360 });
  assert.deepEqual(bildGroesse(390, 293, 3), { breite: 1170, hoehe: 878 }, "Handy mit dreifacher Dichte");
  assert.deepEqual(bildGroesse(2560, 1440, 2), { breite: 1920, hoehe: 1080 }, "größer als der Rahmen: verkleinert");
  assert.deepEqual(bildGroesse(200, 100, 1), { breite: 480, hoehe: 240 }, "kleiner als der Rahmen: vergrößert");
  assert.deepEqual(bildGroesse(100, 2000, 1), { breite: 320, hoehe: 1080 }, "sehr schmal: an beiden Grenzen");
  for (const [b, h, d] of [[0, 0, 1], [Number.NaN, 300, 1], [800, 600, Number.NaN], [800, 600, -1], [800, 600, 10]] as const) {
    const g = bildGroesse(b, h, d);
    const [minB, maxB] = CODE_GRENZEN.bild.breite, [minH, maxH] = CODE_GRENZEN.bild.hoehe;
    assert.ok(g.breite >= minB && g.breite <= maxB && g.hoehe >= minH && g.hoehe <= maxH, `${b}×${h}@${d}`);
    assert.equal(g.breite % 2 + g.hoehe % 2, 0, `${b}×${h}@${d}: gerade`);
  }
});

test("VKg2b: Stelle im Bild – Ränder des eingepassten Bildes zählen nicht", () => {
  const flaeche = { left: 10, top: 20, width: 800, height: 600 };
  const bild = { breite: 1600, hoehe: 900 }; // 16:9 in 4:3 → oben und unten je 75 Pixel Rand
  assert.deepEqual(zeigerAnteil({ x: 410, y: 320 }, flaeche, bild), { x: 0.5, y: 0.5 });
  assert.deepEqual(zeigerAnteil({ x: 10, y: 95 }, flaeche, bild), { x: 0, y: 0 });
  assert.deepEqual(zeigerAnteil({ x: 810, y: 545 }, flaeche, bild), { x: 1, y: 1 });
  assert.equal(zeigerAnteil({ x: 410, y: 60 }, flaeche, bild), null, "im Rand oben");
  assert.equal(zeigerAnteil({ x: 5, y: 320 }, flaeche, bild), null, "links daneben");
  assert.equal(zeigerAnteil({ x: 410, y: 320 }, flaeche, { breite: 0, hoehe: 0 }), null, "noch kein Bild");
  // hochkant: Ränder links und rechts
  assert.deepEqual(zeigerAnteil({ x: 410, y: 320 }, flaeche, { breite: 600, hoehe: 1200 }), { x: 0.5, y: 0.5 });
  assert.equal(zeigerAnteil({ x: 200, y: 320 }, flaeche, { breite: 600, hoehe: 1200 }), null);
});

test("VKg2b: Eingaben nur im Format des Knotens, höchstens 200 Zeichen", () => {
  assert.equal(eingabeText({ t: "b", x: 0.25, y: 1 }), '{"t":"b","x":0.25,"y":1}');
  assert.equal(eingabeText({ t: "d", x: 0.5, y: 0.5, k: 1 }), '{"t":"d","x":0.5,"y":0.5,"k":1}');
  assert.equal(eingabeText({ t: "r", dy: -120 }), '{"t":"r","dy":-120}');
  for (const s of ["a", "Ä", " ", "€", "Enter", "ArrowLeft", "Shift", "F12"]) assert.equal(JSON.parse(eingabeText({ t: "kd", s })!).s, s, s);
  for (const falsch of [
    { t: "b", x: 1.5, y: 0 }, { t: "b", x: -0.1, y: 0 }, { t: "d", x: 0.5, y: 0.5, k: 4 }, { t: "r", dy: 0 }, { t: "r", dy: Number.NaN },
    { t: "kd", s: "Unidentified" }, { t: "kd", s: "Dead" }, { t: "kd", s: "ab" }, { t: "kd", s: "" }, { t: "x" },
  ]) assert.equal(eingabeText(falsch as never), null, JSON.stringify(falsch));
  assert.ok((eingabeText({ t: "kd", s: "🎮" }) ?? "").length <= EINGABE_ZEICHEN, "ein Zeichen aus zwei Code-Einheiten geht");
  assert.equal(gehtInsBild("🎮"), true);
  assert.deepEqual([0, 1, 2, 3, 4].map(knopfImBild), [1, 2, 3, null, null]);
});
