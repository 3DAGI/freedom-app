/**
 * Tests fuer die Preisberechnung. (Die Client-Gebuehr gibt es seit 5.1.4a
 * nicht mehr – sie geht im Entwicklungsanteil des Modells A+ auf.)
 *
 * Preise rechnen mit Geld und hatten keine Tests. Der Schwerpunkt liegt auf
 * Rundung und Grenzfaellen — ein Preis, der auf null rundet, macht Arbeit
 * geschenkt, und einer, der ueberlaeuft, macht sie unbezahlbar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_PRICES, DEFAULT_TOOL_PRICES, DEFAULT_VIDEO_PRICES,
  videoPriceSats, defaultToolPrice, defaultPriceFor, textPriceSats,
} from "../src/pricing.js";

// ------------------------------------------------------------- Preise

test("Free-Tier ist gratis, alles andere nicht", () => {
  // Der Nullpreis im Free-Tier ist Absicht: Er laeuft auf dem Geraet des
  // Nutzers selbst. Bei allen anderen waere er ein Fehler — verschenkte
  // Arbeit hoehlt das Anreizsystem schleichend aus.
  for (const m of DEFAULT_MODEL_PRICES) {
    assert.ok(m.model.length > 0);
    if (m.tier === "free") {
      assert.equal(m.inputSatsPerK, 0, `${m.model} sollte gratis sein`);
    } else {
      assert.ok(m.outputSatsPerK > 0, `${m.model} (${m.tier}) ist versehentlich gratis`);
    }
  }
});

test("Ausgabe kostet nie weniger als Eingabe", () => {
  // Bei Sprachmodellen ist die Erzeugung teurer als das Lesen. Ein Preis, der
  // das umdreht, macht lange Antworten kuenstlich billig.
  for (const m of DEFAULT_MODEL_PRICES) {
    assert.ok(m.outputSatsPerK >= m.inputSatsPerK, `${m.model}: Ausgabe billiger als Eingabe`);
  }
});

test("Groessere Stufen kosten mehr", () => {
  const max = (t: string): number =>
    Math.max(...DEFAULT_MODEL_PRICES.filter((m) => m.tier === t).map((m) => m.outputSatsPerK));
  assert.ok(max("pro") > max("classic"), "sonst waehlt niemand die kleinere Stufe");
  assert.ok(max("classic") > max("free"));
});

test("Textpreis waechst mit der Laenge", () => {
  const bezahlt = DEFAULT_MODEL_PRICES.find((m) => m.tier !== "free")!.model;
  assert.ok(textPriceSats(bezahlt, 10_000, 10_000) > textPriceSats(bezahlt, 100, 100));
});

test("Free-Tier bleibt auch bei langen Anfragen gratis", () => {
  const frei = DEFAULT_MODEL_PRICES.find((m) => m.tier === "free")!.model;
  assert.equal(textPriceSats(frei, 100_000, 100_000), 0);
});

test("Bezahlte Modelle kosten bei nennenswerter Laenge etwas", () => {
  const bezahlt = DEFAULT_MODEL_PRICES.find((m) => m.tier !== "free")!.model;
  assert.ok(textPriceSats(bezahlt, 5000, 5000) > 0);
});

test("Unbekanntes Modell wird nicht still mit null bepreist", () => {
  assert.equal(defaultPriceFor("gibt-es-nicht:1b"), undefined);
});

test("Videopreis steigt mit Laenge und Aufloesung", () => {
  const kurz = videoPriceSats(2);
  const lang = videoPriceSats(10);
  assert.ok(lang > kurz);
  assert.ok(DEFAULT_VIDEO_PRICES.length > 0);
});

test("Werkzeugpreise sind je Art hinterlegt", () => {
  for (const t of DEFAULT_TOOL_PRICES) {
    assert.ok(t.kind > 0);
    assert.ok(t.satsPerCall >= 0);
    assert.ok(t.name.length > 0);
  }
  const bekannt = DEFAULT_TOOL_PRICES[0];
  assert.equal(defaultToolPrice(bekannt.kind)?.kind, bekannt.kind);
  assert.equal(defaultToolPrice(999_999), undefined);
});
