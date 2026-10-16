/**
 * Schritt C-51 (Oberflächen-Review 15.10.2026): Tauschformular mit dem günstigsten Angebot vorgewählt.
 * Die Vorschau ist in der Gegenrichtung genau (derselbe `rueckSwapLamports()` wie beim Sperren), in der
 * Hinrichtung nur geschätzt und ohne Kurs leer – nie ein erfundener SOL-Betrag. „Tauschen“ geht durch
 * denselben Ablauf wie die Liste, der Dialog fragt weiter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type LpOffer, msatZuLamports, rueckSwapLamports } from "@freedomstack/protocol";
import { type AngebotMitLp, bestesAngebot, fristText, gebuehrText, kursText, tauschVorschau } from "../src/tausch-wahl.js";
import { setLang } from "../src/i18n.js";

setLang("de");
const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const JETZT = 1_800_000_000;

const angebot = (o: Partial<LpOffer>): LpOffer => ({
  offerId: "a", pair: "LN-BTC/SOL", direction: "sell-sol", minSats: 1000, maxSats: 50_000, feePpm: 3000,
  tSolSecs: 3600, lnCltvDeltaBlocks: 40, expiry: JETZT + 600, versiegelt: true, ...o,
});
const mit = (pubkey: string, o: Partial<LpOffer>): AngebotMitLp => ({ pubkey, offer: angebot(o) });

test("das günstigste gültige Angebot je Richtung, bei gleicher Gebühr das größere", () => {
  const liste = [
    mit("teuer", { feePpm: 5000 }),
    mit("billig-klein", { feePpm: 2000, maxSats: 10_000 }),
    mit("billig-gross", { feePpm: 2000, maxSats: 90_000 }),
    mit("rueck", { direction: "buy-sol", feePpm: 1000, solAddress: "x", lamportsPerSat: 6.5 }),
  ];
  assert.equal(bestesAngebot(liste, "sats-sol", JETZT)?.pubkey, "billig-gross");
  assert.equal(bestesAngebot(liste, "sol-sats", JETZT)?.pubkey, "rueck");
});

test("abgelaufen, unversiegelt oder mit unbrauchbaren Zahlen zählt nicht", () => {
  const schlecht = [
    mit("abgelaufen", { feePpm: 1, expiry: JETZT }),
    mit("offen", { feePpm: 1, versiegelt: undefined }),
    mit("nan", { feePpm: Number.NaN }),
    mit("negativ", { feePpm: -500 }),
    mit("alles", { feePpm: 1_000_000 }),
    mit("verdreht", { feePpm: 1, minSats: 9000, maxSats: 100 }),
    mit("null", { feePpm: 1, minSats: 0 }),
    mit("ohne-frist", { feePpm: 1, tSolSecs: 0 }),
  ];
  assert.equal(bestesAngebot(schlecht, "sats-sol", JETZT), undefined);
  assert.equal(bestesAngebot([...schlecht, mit("gut", { feePpm: 9000 })], "sats-sol", JETZT)?.pubkey, "gut");
  assert.equal(bestesAngebot([], "sol-sats", JETZT), undefined);
});

test("SOL → sats: der SOL-Betrag ist genau der, der gesperrt wird", () => {
  const offer = angebot({ direction: "buy-sol", minSats: 2000, maxSats: 20_000, feePpm: 3000, solAddress: "x", lamportsPerSat: 6.5 });
  const v = tauschVorschau(offer, 10_000);
  const lamports = rueckSwapLamports(10_000, 6.5, 3000);
  assert.equal(lamports, 65_195);
  assert.deepEqual(v, { zahlst: "0,000065195 SOL", bekommst: "10.000 sats", genau: true, imBereich: true, gebuehr: "0,3 %", grenzen: "2.000–20.000 sats" });
  // Gegenrichtung ohne Kurs des LP: keine Vorschau statt eines geratenen Betrags
  assert.equal(tauschVorschau(angebot({ direction: "buy-sol" }), 10_000), undefined);
});

test("sats → SOL: nur geschätzt mit Marktkurs, ohne Kurs kein Betrag", () => {
  const offer = angebot({ feePpm: 3000 });
  const mitKurs = tauschVorschau(offer, 10_000, { satsProSol: 150_000 });
  // 10 000 sats minus 0,3 % = 9 970 000 msat → aufgerundet in Lamports
  assert.equal(msatZuLamports(9_970_000, 150_000), 66_466_667);
  assert.equal(mitKurs?.bekommst, "≈ 0,066467 SOL");
  assert.equal(mitKurs?.zahlst, "10.000 sats");
  assert.equal(mitKurs?.genau, false);
  assert.equal(tauschVorschau(offer, 10_000)?.bekommst, "");
});

test("Betrag außerhalb der Grenzen oder ungültig", () => {
  const offer = angebot({});
  assert.equal(tauschVorschau(offer, 999)?.imBereich, false);
  assert.equal(tauschVorschau(offer, 50_001)?.imBereich, false);
  assert.equal(tauschVorschau(offer, 1000)?.imBereich, true);
  for (const sats of [0, -5, 1.5, Number.NaN]) assert.equal(tauschVorschau(offer, sats), undefined);
});

test("die Vorab-Gebühr der Hinrichtung steht bei der Gebühr", () => {
  assert.equal(gebuehrText(angebot({ feePpm: 3000, vorabSats: 100 })), "0,3 % + 100 sats vorab (nicht erstattbar)");
  assert.equal(gebuehrText(angebot({ feePpm: 2500 })), "0,25 %");
  setLang("en");
  assert.equal(gebuehrText(angebot({ feePpm: 3000, vorabSats: 1500 })), "0.3 % + 1,500 sats upfront (non-refundable)");
  setLang("de");
});

test("Kurs nur genau vom Anbieter oder als Marktkurs (≈), sonst keiner; Frist in Stunden", () => {
  assert.equal(kursText(angebot({ direction: "buy-sol", lamportsPerSat: 1000 })), "1 SOL = 1.000.000 sats");
  assert.equal(kursText(angebot({ direction: "buy-sol", lamportsPerSat: 1000 }), { satsProSol: 5 }), "1 SOL = 1.000.000 sats");
  assert.equal(kursText(angebot({}), { satsProSol: 150_000 }), "≈ 1 SOL = 150.000 sats");
  assert.equal(kursText(angebot({})), "");
  assert.equal(kursText(angebot({ direction: "buy-sol" }), { satsProSol: 150_000 }), "");
  assert.equal(fristText(angebot({ tSolSecs: 7200 })), "2 h");
  assert.equal(fristText(angebot({ tSolSecs: 5400 })), "1,5 h");
});

test("Tauschen geht durch den Ablauf der Liste, der Dialog fragt weiter", () => {
  const ui = quelle("../src/shell/tauschformular-ui.ts");
  assert.match(ui, /startRueckSwap\(bestes\.pubkey, bestes\.offer, sats\)/);
  assert.match(ui, /startSwap\(bestes\.pubkey, bestes\.offer\.offerId, bestes\.offer\.vorabSats, sats\)/);
  assert.match(ui, /form\.hidden = liste\.length === 0/);
  const tausch = quelle("../src/shell/tabs/tausch.ts");
  // Vorbelegt, aber Pflichtfeld im Dialog – nichts geht ungefragt hinaus
  assert.equal((tausch.match(/\.\.\.\(betrag \? \{ wert: String\(betrag\) \} : \{\}\)/g) ?? []).length, 2);
  const waehrung = quelle("../src/shell/tabs/waehrung.ts");
  assert.match(waehrung, /zeigeTauschformular\(valid\.map/);
  assert.match(quelle("../src/shell/app.ts"), /wireTauschformular\(\);/);
});

test("Formular im Tausch-Reiter über allen Angeboten", () => {
  const html = quelle("../src/shell/index.html");
  const formular = html.indexOf('id="tausch-formular"');
  const alle = html.indexOf('id="lp-alle"');
  assert.ok(formular > 0 && alle > formular, "Formular vor der Liste");
  assert.ok(html.indexOf('id="lp-offers"') > alle, "Angebote in „Alle Angebote“");
  assert.match(html, /<button[^>]*id="tausch-los"[^>]*disabled/);
});
