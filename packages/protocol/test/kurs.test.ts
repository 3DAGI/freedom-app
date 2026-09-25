/**
 * Schritt 4.4: Marktkurs aus Kurs-Events – Median je Absender, Frische,
 * Warnungen – und ganzzahlige Umrechnung msat ↔ Lamports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "../src/index.js";
import { signEvent } from "../src/event.js";
import { buildPriceTicker } from "../src/price-ticker.js";
import { buildCapabilities, parseCapabilities } from "../src/tiers.js";
import { KURS_PAAR, lamportsProMsat, lamportsZuMsat, marktKurs, msatZuLamports } from "../src/kurs.js";

const JETZT = 1_790_000_000;

function ticker(kurs: number, zeit = JETZT, kp = generateKeypair(), paar = KURS_PAAR) {
  return signEvent(buildPriceTicker({ pair: paar, satsPerUnit: kurs, publishedAt: zeit }, kp.pk), kp.sk);
}

test("Median je Absender: zehn Events eines Absenders sind eine Stimme", () => {
  const laut = generateKeypair();
  const events = [
    ticker(150_000), ticker(152_000), ticker(148_000),
    ...Array.from({ length: 10 }, (_, i) => ticker(900_000, JETZT - i, laut)),
  ];
  const k = marktKurs(events, JETZT)!;
  assert.equal(k.quellen, 4);
  assert.equal(k.satsProSol, 151_000, "Median aus 148k, 150k, 152k, 900k");
  assert.ok(k.warnungen.some((w) => /weichen bis \d+ % voneinander ab/.test(w)), "Ausreisser faellt auf");
  // Der juengste Kurs eines Absenders zaehlt
  const kp = generateKeypair();
  const k2 = marktKurs([ticker(100_000, JETZT - 100, kp), ticker(200_000, JETZT - 10, kp)], JETZT)!;
  assert.equal(k2.satsProSol, 200_000);
});

test("Frische und Gueltigkeit: alte, zukuenftige, fremde und unsinnige Kurse zaehlen nicht", () => {
  const events = [
    ticker(150_000, JETZT - 3601), // zu alt
    ticker(150_000, JETZT + 3600), // aus der Zukunft
    ticker(150_000, JETZT, generateKeypair(), "ETH/BTC"),
    ticker(0), ticker(-5), ticker(1e11), // unsinnig
  ];
  assert.equal(marktKurs(events, JETZT), undefined);
  const k = marktKurs([...events, ticker(160_000)], JETZT)!;
  assert.equal(k.satsProSol, 160_000);
  assert.deepEqual(k.warnungen, ["Kurs aus nur 1 Quelle"]);
});

test("Warnungen: wenige Quellen, Streuung, Anbieter-Kurs neben dem Markt", () => {
  const drei = [ticker(150_000), ticker(151_000), ticker(149_000)];
  assert.deepEqual(marktKurs(drei, JETZT)!.warnungen, [], "drei nahe Quellen: keine Warnung");
  assert.deepEqual(marktKurs(drei, JETZT, { referenz: 160_000 })!.warnungen, [], "7 % Abweichung: noch keine Warnung");
  assert.deepEqual(marktKurs(drei, JETZT, { referenz: 5_000_000 })!.warnungen, ["Kurs des Anbieters weicht 3233 % vom Markt ab"]);
  assert.deepEqual(marktKurs(drei.slice(0, 2), JETZT)!.warnungen, ["Kurs aus nur 2 Quellen"]);
});

test("Umrechnung: 1 SOL = 1e9 Lamports = Kurs · 1000 msat, aufgerundet, ohne Ueberlauf", () => {
  // 2 sats bei 150.000 sats/SOL = 13.333,3 Lamports -> 13.334
  assert.equal(msatZuLamports(2_000, 150_000), 13_334);
  assert.equal(msatZuLamports(150_000_000, 150_000), 1_000_000_000, "150k sats = 1 SOL");
  assert.equal(lamportsZuMsat(1_000_000_000, 150_000), 150_000_000);
  assert.equal(lamportsZuMsat(1, 150_000), 1, "Bruchteile runden auf");
  assert.equal(msatZuLamports(0, 150_000), 0);
  // Grosse Betraege: 21 Mio. BTC in msat bleibt exakt
  assert.equal(msatZuLamports(2_100_000_000_000_000, 100_000_000), 21_000_000_000_000_000 / 1_000_000 * 1_000);
  assert.ok(Math.abs(lamportsProMsat(150_000) - 6.6667) < 1e-4);
  assert.throws(() => msatZuLamports(1.5, 150_000), /ganze Zahl/);
  assert.throws(() => msatZuLamports(1_000, 0), /Kurs/);
  assert.throws(() => lamportsZuMsat(-1, 150_000), /ganze Zahl/);
});

test("Angebot: Kurs des Anbieters mit Quelle; fremde Unsinnswerte fallen weg", () => {
  const kp = generateKeypair();
  const basis = { pubkey: kp.pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false };
  const mit = parseCapabilities(buildCapabilities({ ...basis, kurs: { satsProSol: 150_000, quelle: "markt" } }, JETZT));
  assert.deepEqual(mit.kurs, { satsProSol: 150_000, quelle: "markt" });
  assert.equal(parseCapabilities(buildCapabilities(basis, JETZT)).kurs, undefined);
  for (const tag of [["kurs", "SOL/BTC", "0", "markt"], ["kurs", "SOL/BTC", "1e5", "markt"], ["kurs", "SOL/BTC", "150000", "geraten"], ["kurs", "ETH/BTC", "150000", "markt"]]) {
    const ev = buildCapabilities(basis, JETZT);
    ev.tags.push(tag);
    assert.equal(parseCapabilities(ev).kurs, undefined, tag.join(" "));
  }
});
