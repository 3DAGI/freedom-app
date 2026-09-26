/**
 * Schritt 5.7 mit 8.8: Modellkataloge in der App – Abos, eigene Eingabe,
 * Reihenfolge im Modell-Dropdown, und dass alles im echten Pfad haengt, ohne
 * Vorauswahl und ohne den Relays die Abos zu verraten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE, baueModellKatalog, generateKeypair, leseModellKatalog, signEvent } from "@freedomstack/protocol";
import { ABOS_MAX, LS_KATALOGE, katalogKennung, katalogRang, leseAbos, leseKatalogEingabe, mitAbo, ohneAbo } from "../src/modell-kataloge.js";

const A = generateKeypair();
const B = generateKeypair();
const adr = (pk: string, d = "code") => `38080:${pk}:${d}`;

test("5.7: Abos – nur gueltige Adressen, keine doppelten, hoechstens 20", () => {
  assert.deepEqual(leseAbos(null), []);
  assert.deepEqual(leseAbos("kein json"), []);
  assert.deepEqual(leseAbos('{"a":1}'), []);
  assert.deepEqual(leseAbos(JSON.stringify([adr(A.pk), adr(A.pk), "30000:x:y", 7, adr(B.pk, "mit leer zeichen"), adr(B.pk)])), [adr(A.pk), adr(B.pk)]);
  const viele = Array.from({ length: 30 }, (_, i) => adr(A.pk, `k${i}`));
  assert.equal(leseAbos(JSON.stringify(viele)).length, ABOS_MAX);

  assert.deepEqual(mitAbo([], adr(A.pk)), [adr(A.pk)]);
  assert.deepEqual(mitAbo([adr(A.pk)], adr(A.pk)), [adr(A.pk)], "doppelt abonnieren aendert nichts");
  assert.throws(() => mitAbo([], "quatsch"), /Keine Katalog-Adresse/);
  assert.throws(() => mitAbo(viele.slice(0, ABOS_MAX), adr(B.pk)), /Höchstens 20/);
  assert.deepEqual(ohneAbo([adr(A.pk), adr(B.pk)], adr(A.pk)), [adr(B.pk)]);
  assert.equal(LS_KATALOGE, "freedom.kataloge");
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_KATALOGE), "ein neues Geraet uebernimmt die Abos (8.12)");
});

test("5.7: eigene Eingabe – durch „;“ oder Zeilen getrennt, Notiz dahinter, Kennung aus dem Titel", () => {
  assert.deepEqual(leseKatalogEingabe("qwen3.5:9b gut für Code;  llama3.2:3b ;\n deepseek-coder:6.7b  schnell  und klein\n;"), [
    { modell: "qwen3.5:9b", notiz: "gut für Code" },
    { modell: "llama3.2:3b" },
    { modell: "deepseek-coder:6.7b", notiz: "schnell und klein" },
  ]);
  assert.deepEqual(leseKatalogEingabe("  ;\n "), []);
  assert.equal(katalogKennung("Zum Programmieren – schnell & günstig!"), "zum-programmieren-schnell-gunstig");
  assert.equal(katalogKennung("???"), "katalog");
  assert.equal(katalogKennung("x".repeat(100)).length, 64);
  // Was die Eingabe liefert, baut das Protokoll – Ungueltiges wirft dort.
  assert.throws(() => baueModellKatalog({ kurator: A.pk, d: katalogKennung("T"), titel: "T", modelle: leseKatalogEingabe("<b>fett</b>") }), /Keine Modell-Kennung/);
});

test("5.7: Rang im Dropdown – in wie vielen abonnierten Katalogen, Schreibweise egal", () => {
  const k1 = leseModellKatalog(signEvent(baueModellKatalog({ kurator: A.pk, d: "a", titel: "A", modelle: [{ modell: "Qwen3.5:9b" }, { modell: "llama3.2:3b" }] }), A.sk));
  const k2 = leseModellKatalog(signEvent(baueModellKatalog({ kurator: B.pk, d: "b", titel: "B", modelle: [{ modell: "qwen3.5:9b" }] }), B.sk));
  const rang = katalogRang([k1, k2]);
  assert.equal(rang.get("qwen3.5:9b"), 2);
  assert.equal(rang.get("llama3.2:3b"), 1);
  assert.equal(katalogRang([]).size, 0, "ohne Abos keine Bevorzugung");
});

test("5.7/8.8 verdrahtet: alle Kataloge holen und lokal waehlen, Anzeige ohne innerHTML, keine Vorauswahl", () => {
  const netz = readFileSync(new URL("../src/shell/tabs/agent-netz.ts", import.meta.url), "utf8");
  const zeige = netz.slice(netz.indexOf("export async function zeigeKataloge"), netz.indexOf("export async function veroeffentlicheKatalog"));
  assert.match(zeige, /pool\.query\(\{ kinds: \[KIND_MODELL_KATALOG\], limit: 500 \}\)/, "ohne Filter nach Kurator – die Relays erfahren die Abos nicht");
  assert.doesNotMatch(zeige, /authors|#d/);
  assert.doesNotMatch(zeige, /innerHTML/, "Kataloge sind Fremddaten – nur textContent");
  assert.match(zeige, /vergleicheKataloge\(abonnierteKataloge, modellAngebote\(angebote\)\)/);
  assert.match(zeige, /ausMsat\(z\.preisMsat, kurs\)/, "Preis in sats und SOL");
  assert.match(netz, /const gefaehrdet = modelsAtRisk\(r\.models\);[\s\S]{0,120}z\.textContent = `Gefährdet: /, "gefaehrdete Modelle zuerst nennen (8.8)");
  const pub = netz.slice(netz.indexOf("export async function veroeffentlicheKatalog"));
  assert.match(pub, /if \(alsGeraet\(\)\) \{/, "als Geraet nicht – der Katalog gehoert der Person");
  assert.match(pub, /await signiere\(baueModellKatalog\(/);

  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(agent, /nemotron zuerst/, "keine feste Vorliebe des Projekts im Dropdown");
  assert.match(agent, /const rang = katalogRangJetzt\(\);/);
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /void zeigeKataloge\(\)\.then\(\(\) => refreshModelDropdown\(\)\);/, "beim Start geladen, dann das Dropdown geordnet");
  assert.match(app, /katPub\.onclick = \(\) => void veroeffentlicheKatalog\(\);/);

  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  for (const id of ["kataloge-abos", "kataloge-vergleich", "kataloge-gefunden", "kataloge-refresh", "katalog-publish"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /Voreingestellt ist keiner/);
});
