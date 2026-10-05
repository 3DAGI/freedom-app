/**
 * Freedom-Prüfung nach dem Rückbau der Prüfer (P5a, Entscheidung 05.10.2026):
 * Stand, Auswahl und die Seite Netz › Prüfung kommen nur aus der eigenen Messung
 * auf dem Gerät. Ersetzt die Tests aus `pruefer-wahl.test.ts` (P2b1/P2b2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE, buildCapabilities, generateKeypair, parseCapabilities, signEvent, type MessStand } from "@freedomstack/protocol";
import { pruefZeile, pruefZeilen } from "../src/pruef-anzeige.js";
import { type ScoredProvider, matchProviders, mitMessung } from "../src/matchmaking.js";

const JETZT = 1_790_000_000;
const pk = (c: string) => c.repeat(64);
const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");

function provider(preis: number): ScoredProvider {
  const k = generateKeypair();
  const caps = parseCapabilities(signEvent(buildCapabilities({ pubkey: k.pk, tier: "classic", models: ["m"], textRatePerKTokenMsat: preis, tools: [], currentlyFree: false }, JETZT), k.sk));
  return { caps, trustScore: 0, jobsCompleted: 0, repTier: "classic", score: -1, geprueft: false, reklamationen: 0 };
}
const gemessen = (s: Partial<MessStand>): MessStand => ({ anfragen: 30, erfolge: 30, ausfallJetzt: false, stufe: "normal", ...s });

test("Auswahl: die eigene Messung bestimmt die Stufe – gemessen normal vor neu (auch teurer), zu wenig Messung zählt als neu", () => {
  const [gut, unbekannt, wenig, herab, aus] = [provider(4000), provider(500), provider(500), provider(500), provider(500)];
  const alle = mitMessung([unbekannt, wenig, herab, aus, gut], new Map([
    [gut.caps.pubkey, gemessen({})],
    [wenig.caps.pubkey, gemessen({ anfragen: 5, erfolge: 5, stufe: "neu" })],
    [herab.caps.pubkey, gemessen({ erfolge: 26, stufe: "herabgestuft" })],
    [aus.caps.pubkey, gemessen({ erfolge: 10, stufe: "ausgefallen" })],
  ]));
  assert.equal(alle.find((p) => p.caps.pubkey === unbekannt.caps.pubkey)!.messung, undefined);
  const r = matchProviders(alle, "classic", { maxResults: 10, zufall: () => 0.5 }).map((p) => p.caps.pubkey);
  assert.equal(r[0], gut.caps.pubkey, "gemessen normal vorn – trotz achtfachem Preis");
  assert.deepEqual(new Set(r.slice(1, 3)), new Set([unbekannt.caps.pubkey, wenig.caps.pubkey]), "ohne genug Messung in der Mitte");
  assert.deepEqual(r.slice(3), [herab.caps.pubkey, aus.caps.pubkey]);
});

test("Zeile je Provider – nur aus der eigenen Messung, Verfügbarkeit in ganzen Prozent, sortiert nach Stand", () => {
  assert.deepEqual(pruefZeile(pk("a"), gemessen({ anfragen: 40, erfolge: 39, medianMs: 1800 })),
    { pk: pk("a"), stand: "normal", quelle: "eigene", verfuegbarkeit: 97, antwortMs: 1800 });
  assert.deepEqual(pruefZeile(pk("b"), gemessen({ anfragen: 60, erfolge: 50, stufe: "herabgestuft" })),
    { pk: pk("b"), stand: "herabgestuft", quelle: "eigene", verfuegbarkeit: 83 }, "ohne Zeit keine Antwortzeit");
  assert.deepEqual(pruefZeile(pk("c"), gemessen({ anfragen: 5, stufe: "neu" })), { pk: pk("c"), stand: "neu", quelle: "keine" }, "zu wenig – keine Zahl");
  assert.deepEqual(pruefZeile(pk("d")), { pk: pk("d"), stand: "neu", quelle: "keine" });
  const r = pruefZeilen([
    { pk: pk("d"), messung: gemessen({ erfolge: 10, stufe: "ausgefallen" }) },
    { pk: pk("c") },
    { pk: pk("b"), messung: gemessen({}) },
    { pk: pk("a"), messung: gemessen({ erfolge: 26, stufe: "herabgestuft" }) },
  ]).map((z) => [z.pk[0], z.stand]);
  assert.deepEqual(r, [["b", "normal"], ["c", "neu"], ["a", "herabgestuft"], ["d", "ausgefallen"]]);
});

test("Verdrahtet: Auswahl und Seite Netz nur aus der eigenen Messung, geladen erst beim Öffnen des Reiters; keine Prüfer mehr", () => {
  const state = lies("shell/state.ts");
  assert.match(state, /return mitMessung\(await bekannteProvider\(\), messBuch\.staende\(/);
  assert.match(state, /return matchProviders\(await providerMitStand\(\), tier/);
  assert.match(lies("matchmaking.ts"), /stufe: p\.messung\?\.stufe \?\? "neu",/);
  const ui = lies("shell/tabs/pruefung-ui.ts");
  assert.match(ui, /\[data-subtab="pruefung"\]'\)\?\.addEventListener\("click", \(\) => void zeigePruefung\(\)\)/);
  assert.match(ui, /pruefZeilen\(\(await providerMitStand\(\)\)/, "dieselbe Quelle wie die Auswahl");
  assert.doesNotMatch(ui, /innerHTML/);
  const app = lies("shell/app.ts");
  assert.match(app, /\n  wirePruefung\(\);\n/);
  assert.doesNotMatch(app, /zeigePruefung/, "nie beim Start oder beim Seitenwechsel");
  // Prüfer und Messberichte (38081) fielen mit P5a: keine Abfrage, keine Wahl, nichts in der Sicherung
  for (const datei of ["shell/state.ts", "matchmaking.ts", "shell/tabs/pruefung-ui.ts", "pruef-anzeige.ts", "shell/index.html"]) {
    assert.doesNotMatch(lies(datei), /messbericht|38081|pruefStaende|gewaehltePruefer|FREEDOM_PRUEFER|pruefer-folgen|freedom\.pruefer\b/i, datei);
  }
  assert.ok(!(SICHERUNG_EINTRAEGE as readonly string[]).includes("freedom.pruefer"));
});
