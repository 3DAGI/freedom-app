/**
 * Schritt C-53b (Oberflächen-Review 15.10.2026): Settings › Datenschutz als gruppierte Zeilen mit Schaltern.
 * Jede Zeile: Titel und ein Satz, rechts Schalter oder Auswahl; die ganze Erklärung bleibt wörtlich unter
 * „Mehr dazu“ – kürzer heißt nicht weniger ehrlich. Die Ids bleiben, die Verdrahtung ist unverändert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
const teil = html.slice(html.indexOf('data-subpane="settings:privacy"'), html.indexOf('data-subpane="settings:share"'));

test("drei Gruppen, jede Zeile mit Titel und einem Satz", () => {
  assert.deepEqual([...teil.matchAll(/<h3 class="einst-gruppe-titel" data-i18n="(set\.[a-zA-Z]+)">/g)].map((m) => m[1]),
    ["set.gruppeNetz", "set.gruppeDaten", "set.gruppeNachrichten"]);
  const zeilen = [...teil.matchAll(/class="einst-zeile">([\s\S]*?)<\/(label|div)>/g)].map((m) => m[1]);
  assert.equal(zeilen.length, 8);
  for (const z of zeilen) {
    assert.match(z, /<span class="einst-titel" data-i18n="set\.[a-zA-Z]+">/);
    assert.match(z, /<span class="einst-satz"/);
  }
});

test("Schalter statt Häkchen – mit role=switch, Ids wie bisher", () => {
  const schalter = [...teil.matchAll(/<input type="checkbox" id="([a-z-]+)" class="schalter" role="switch" \/>/g)].map((m) => m[1]);
  assert.deepEqual(schalter, ["huelle-tor", "kontakte-sichern", "ki-platzhalter", "ruf-teilen"]);
  assert.doesNotMatch(teil, /<input type="checkbox"(?![^>]*class="schalter")/, "kein Häkchen mehr ohne Schalter");
  for (const id of ["net-mode", "ki-verlauf", "versand-verzoegerung", "onion-pruefen", "onion-pruefrelay", "privacy-report", "ruf-stand", "huelle-tor-stand"]) {
    assert.equal(teil.split(`id="${id}"`).length, 2, id);
  }
});

test("die lange Erklärung bleibt wörtlich unter „Mehr dazu“", () => {
  for (const k of ["set.torText", "set.onionText", "set.kontakteText", "set.platzhalterText", "set.rufTeilenText", "set.verlaufText", "set.verzoegerungText"]) {
    assert.match(teil, new RegExp(`<details class="einst-mehr"><summary data-i18n="set\\.mehrDazu">Mehr dazu</summary><p class="mono-sm muted" data-i18n="${k.replace(".", "\\.")}">`), k);
  }
});

test("kurze Sätze verschweigen keine Grenze", () => {
  setLang("de");
  assert.match(t("set.torKurz"), /Anrufe schon/);
  assert.match(t("set.verzoegerungKurz"), /IP-Adresse verbirgt das nicht/);
  assert.match(t("set.verlaufKurz2"), /liest der Provider/);
  assert.match(t("set.platzhalterKurz"), /^Nur, was eine prüfbare Form hat/);
  setLang("en");
  assert.match(t("set.torKurz"), /calls do/);
  setLang("de");
});
