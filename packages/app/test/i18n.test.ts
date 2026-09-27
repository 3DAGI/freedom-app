/**
 * Schritt 8.16 (Variante B): Deutsch und Englisch vollständig. Findet
 * fehlende, unbenutzte und rohe Texte. Rohtext in index.html zählt je
 * Bereich: fertige Bereiche stehen auf 0, offene dürfen nur sinken – jeder
 * Teilschritt setzt seinen Bereich auf 0 (8.16a: Rahmen).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BEREICHE, LANGS, detectLang, gespeicherteSprache, getLang, setLang, t } from "../src/i18n.js";
import { rohtexte } from "./i18n-rohtext.js";

const SRC = new URL("../src/", import.meta.url).pathname;
const html = readFileSync(join(SRC, "shell/index.html"), "utf8");
const dateien = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "texte" ? [] : dateien(join(dir, e.name))) : e.name.endsWith(".ts") && e.name !== "i18n.ts" ? [join(dir, e.name)] : []);
const code = dateien(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
const alle = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;

/** Offene Rohtexte je Bereich – dürfen nur sinken; fertig heißt 0. */
const OFFEN: Record<string, number> = {
  rahmen: 0,
  "page-ai": 60,
  "page-comm": 41,
  "page-wallet": 39,
  "page-earn": 27,
  "page-profile": 23,
  "page-settings": 118,
};

test("8.16: nur Deutsch und Englisch – jeder Text in beiden, nicht leer, mit denselben Platzhaltern, in genau einem Bereich", () => {
  assert.deepEqual(LANGS.map((l) => l.code), ["de", "en"]);
  const gesehen = new Map<string, string>();
  const platzhalter = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [bereich, texte] of Object.entries(BEREICHE)) {
    for (const [k, v] of Object.entries(texte)) {
      assert.ok(!gesehen.has(k), `${k} in ${bereich} und ${gesehen.get(k)}`);
      gesehen.set(k, bereich);
      assert.deepEqual(Object.keys(v).sort(), ["de", "en"], k);
      assert.ok(v.de.trim() && v.en.trim(), `${k}: leer`);
      assert.deepEqual(platzhalter(v.de), platzhalter(v.en), `${k}: Platzhalter verschieden`);
    }
  }
});

test("8.16: t() – aktuelle Sprache, Werte eingesetzt, Unbekanntes sichtbar; Sprache aus Wahl oder Browser", () => {
  const vorher = getLang();
  try {
    setLang("de");
    assert.equal(t("navComm"), "Kommunikation");
    setLang("en");
    assert.equal(t("navComm"), "Chat");
    assert.equal(t("gibt-es-nicht"), "gibt-es-nicht", "unbekannt → der Schlüssel selbst");
    assert.equal(t("{n} von {m}", { n: 2, m: 5 }), "2 von 5");
    assert.equal(t("{n} und {x}", { n: 1 }), "1 und {x}", "fehlender Wert bleibt sichtbar");
  } finally {
    setLang(vorher);
  }
  assert.equal(detectLang("de-AT"), "de");
  assert.equal(detectLang("DE"), "de");
  assert.equal(detectLang("en-US"), "en");
  assert.equal(detectLang("fr-FR"), "en", "andere Sprachen → Englisch");
  assert.equal(gespeicherteSprache("de"), "de");
  assert.equal(gespeicherteSprache("fr"), null, "bis 8.16 gewählt, gibt es nicht mehr");
  assert.equal(gespeicherteSprache(null), null);
});

test("8.16: Oberfläche – jeder Schlüssel aus index.html und jedes t(…) im Code existiert, jeder Text wird benutzt", () => {
  const ausHtml = [...html.matchAll(/data-i18n(?:-ph|-title|-aria)?="([^"]+)"/g)].map((m) => m[1]);
  const ausCode = [...code.matchAll(/\bt\(\s*["'`]([\w.-]+)["'`]/g)].map((m) => m[1]);
  assert.ok(ausHtml.length > 30);
  for (const k of [...ausHtml, ...ausCode]) assert.ok(k in alle, `Schlüssel fehlt: ${k}`);
  const benutzt = (k: string) => ausHtml.includes(k) || code.includes(`"${k}"`) || code.includes(`'${k}'`);
  const unbenutzt = Object.keys(alle).filter((k) => !benutzt(k));
  assert.deepEqual(unbenutzt, [], "unbenutzte Texte");
});

test("8.16: Rohtext-Suche – findet Text und Attribute ohne Schlüssel, übersieht Eigennamen und Übersetztes", () => {
  const probe = `<header title="Kopf">FREEDOM <span data-i18n="x">Hallo</span> Offen</header>
    <section id="page-x"><p data-i18n="y">Übersetzt <b>auch innen</b></p><input placeholder="Suche" /><input placeholder="Suche" data-i18n-ph="z" />
    <button aria-label="Schließen" data-i18n-aria="w">×</button><!-- Kommentar zählt nicht --><script>var s = "Code";</script>
    <span>12 sats</span><span>Lightning</span><svg><text>Grafik</text></svg><div>Noch roh</div></section><footer>Fuß</footer>`;
  assert.deepEqual(rohtexte(probe), [
    { bereich: "rahmen", text: 'title="Kopf"' },
    { bereich: "rahmen", text: "Offen" },
    { bereich: "page-x", text: 'placeholder="Suche"' },
    { bereich: "page-x", text: "Noch roh" },
    { bereich: "rahmen", text: "Fuß" },
  ]);
});

test("8.16: kein roher Text in fertigen Bereichen von index.html, in offenen nicht mehr als bisher", () => {
  const je: Record<string, string[]> = {};
  for (const r of rohtexte(html)) (je[r.bereich] ??= []).push(r.text);
  for (const bereich of new Set([...Object.keys(je), ...Object.keys(OFFEN)])) {
    const gefunden = je[bereich] ?? [];
    assert.ok(bereich in OFFEN, `neuer Bereich ${bereich}: in OFFEN eintragen`);
    assert.ok(gefunden.length <= OFFEN[bereich], `${bereich}: ${gefunden.length} rohe Texte (erlaubt ${OFFEN[bereich]})${OFFEN[bereich] === 0 ? `: ${gefunden.join(" | ")}` : ""}`);
  }
});

test("8.16a: Rahmen – Navigation und Kopfzeile über Schlüssel, gespeicherte Sprache geprüft, das nie gezeigte Wallet-Gate ist weg", () => {
  const app = readFileSync(join(SRC, "shell/app.ts"), "utf8");
  assert.match(app, /setLang\(gespeicherteSprache\(localStorage\.getItem\("freedom\.lang"\)\) \?\? detectLang\(\)\);\s*document\.documentElement\.lang = getLang\(\);/);
  assert.match(app, /querySelectorAll\("\[data-i18n-title\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-i18n-aria\]"\)/);
  for (const k of ["navAi", "navComm", "navWallet", "navEarn", "navProfile", "navSettings"]) assert.match(html, new RegExp(`<span data-i18n="${k}">`));
  assert.doesNotMatch(html, /id="gate"|gate-lightning|gate-solana|gate-local/);
  assert.doesNotMatch(app, /#gate/);
});
