/**
 * Freedom-Prüfung P2b1 (E7, docs/FREEDOM-PRUEFUNG.md 3.3): Berichte der
 * gewählten Prüfer zählen bei der Auswahl, wo die eigene Messung zu wenig hat –
 * Stufe und Qualität (Ausreißer nach hinten). Abgefragt wird ohne Filter nach
 * Prüfer und nur, wenn jemand gewählt ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE, buildCapabilities, generateKeypair, parseCapabilities, signEvent, type MessStand, type PruefStand } from "@freedomstack/protocol";
import { LS_PRUEFER, PRUEFER_MAX, eigenePruefer, entfolgePruefer, folgePruefer, gewaehltePruefer } from "../src/pruefer-wahl.js";
import { pruefZeile, pruefZeilen } from "../src/pruef-anzeige.js";
import { fuehreZusammen } from "../src/zustand-zusammenfuehren.js";
import { type ScoredProvider, matchProviders, mitMessung, mitPruefung } from "../src/matchmaking.js";

const JETZT = 1_790_000_000;
const pk = (c: string) => c.repeat(64);
const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");
const speicher = (wert: string | null) => ({ getItem: (k: string) => (k === LS_PRUEFER ? wert : null) });

function provider(preis: number): ScoredProvider {
  const k = generateKeypair();
  const caps = parseCapabilities(signEvent(buildCapabilities({ pubkey: k.pk, tier: "classic", models: ["m"], textRatePerKTokenMsat: preis, tools: [], currentlyFree: false }, JETZT), k.sk));
  return { caps, trustScore: 0, jobsCompleted: 0, repTier: "classic", score: -1, geprueft: false, reklamationen: 0 };
}
const geprueft = (s: Partial<PruefStand>): PruefStand => ({ anfragen: 60, erfolge: 60, stufe: "normal", pruefer: 1, ...s });
const gemessen = (s: Partial<MessStand>): MessStand => ({ anfragen: 30, erfolge: 30, ausfallJetzt: false, stufe: "normal", ...s });

test("Gewählte Prüfer: eigene Wahl ohne Doppelte, nur Schlüssel, höchstens zehn; kaputte Ablage – keiner", () => {
  assert.deepEqual(gewaehltePruefer(speicher(null)), [], "ohne Wahl und ohne Freedom-Prüfer (Platzhalter) keiner");
  assert.deepEqual(gewaehltePruefer(speicher(JSON.stringify([pk("a"), pk("a"), "npub1kaputt", 7, pk("b")]))), [pk("a"), pk("b")]);
  assert.deepEqual(gewaehltePruefer(speicher("{kaputt")), []);
  assert.deepEqual(gewaehltePruefer(speicher(JSON.stringify({ a: pk("a") }))), []);
  const viele = Array.from({ length: 15 }, (_, i) => i.toString(16).repeat(64).slice(0, 64));
  assert.equal(gewaehltePruefer(speicher(JSON.stringify(viele))).length, PRUEFER_MAX);
});

test("Auswahl: Prüfer-Bericht hebt einen Neuen in die normale Stufe; die eigene Messung geht vor; Ausreißer der Qualität nach hinten", () => {
  const [geprueftGut, unbekannt, ausreisser, eigenSchlecht, herab] = [provider(4000), provider(500), provider(500), provider(500), provider(500)];
  const alle = mitPruefung(
    mitMessung([unbekannt, ausreisser, eigenSchlecht, herab, geprueftGut], new Map([[eigenSchlecht.caps.pubkey, gemessen({ erfolge: 10, stufe: "ausgefallen" })]])),
    new Map([
      [geprueftGut.caps.pubkey, geprueft({ qualitaet: 0.95 })],
      [ausreisser.caps.pubkey, geprueft({ qualitaet: 0.5 })],
      [eigenSchlecht.caps.pubkey, geprueft({ qualitaet: 0.95 })],
      [herab.caps.pubkey, geprueft({ erfolge: 50, stufe: "herabgestuft", qualitaet: 0.95 })],
    ]),
  );
  assert.equal(alle.find((p) => p.caps.pubkey === unbekannt.caps.pubkey)!.pruefung, undefined);
  const r = matchProviders(alle, "classic", { maxResults: 10, zufall: () => 0.5 }).map((p) => p.caps.pubkey);
  assert.deepEqual(r, [geprueftGut, unbekannt, ausreisser, herab, eigenSchlecht].map((p) => p.caps.pubkey),
    "geprüft normal vor neu – trotz achtfachem Preis; die eigene Messung „ausgefallen“ schlägt den Bericht");
});

test("Verdrahtet: Berichte nur mit gewählten Prüfern, ohne Filter nach Prüfer, in jeder Auswahl", () => {
  const state = lies("shell/state.ts");
  assert.match(state, /mitPruefung\(mitMessung\(await bekannteProvider\(\), messBuch\.staende\(jetzt\)\), await pruefBerichte\(gewaehltePruefer\(localStorage\), jetzt\)\)/);
  const berichte = state.slice(state.indexOf("async function pruefBerichte("), state.indexOf("export async function findProviders("));
  assert.match(berichte, /if \(pruefer\.length === 0\) return new Map\(\);/, "ohne Wahl keine Abfrage");
  assert.match(berichte, /pool\.query\(messberichtFilter\(\)\)/, "alle holen – ein Filter nach Prüfer verriete die Wahl");
  assert.doesNotMatch(berichte, /authors/);
  assert.match(lies("matchmaking.ts"), /stufe: stufeFuerAuswahl\(p\.messung, p\.pruefung\),/);
});

test("P2b2: folgen und nicht mehr folgen – nur Schlüssel, höchstens zehn, Doppelte zählen einmal", () => {
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(folgePruefer(s, pk("a")), true);
  assert.equal(folgePruefer(s, pk("a")), true, "schon gefolgt");
  assert.equal(folgePruefer(s, "npub1kaputt"), false);
  assert.deepEqual(eigenePruefer(s), [pk("a")]);
  for (let i = 0; i < 9; i++) assert.equal(folgePruefer(s, i.toString(16).repeat(64)), true);
  assert.equal(folgePruefer(s, pk("b")), false, "höchstens zehn");
  entfolgePruefer(s, pk("a"));
  assert.equal(eigenePruefer(s).includes(pk("a")), false);
  assert.equal(folgePruefer(s, pk("b")), true, "Platz wieder frei");
});

test("P2b2: Zeile je Provider – Quelle wie bei der Auswahl, Verfügbarkeit in ganzen Prozent, sortiert nach Stand", () => {
  assert.deepEqual(pruefZeile(pk("a"), gemessen({ anfragen: 40, erfolge: 39, medianMs: 1800 }), geprueft({ stufe: "ausgefallen" })),
    { pk: pk("a"), stand: "normal", quelle: "eigene", verfuegbarkeit: 97, antwortMs: 1800 }, "eigene Messung geht vor");
  assert.deepEqual(pruefZeile(pk("b"), gemessen({ anfragen: 5, stufe: "neu" }), geprueft({ anfragen: 60, erfolge: 50, stufe: "herabgestuft", medianMs: 4000, pruefer: 2 })),
    { pk: pk("b"), stand: "herabgestuft", quelle: "pruefer", verfuegbarkeit: 83, antwortMs: 4000, pruefer: 2 });
  assert.deepEqual(pruefZeile(pk("c")), { pk: pk("c"), stand: "neu", quelle: "keine" });
  const r = pruefZeilen([
    { pk: pk("d"), messung: gemessen({ erfolge: 10, stufe: "ausgefallen" }) },
    { pk: pk("c") },
    { pk: pk("b"), pruefung: geprueft({}) },
    { pk: pk("a"), pruefung: geprueft({ stufe: "herabgestuft" }) },
  ]).map((z) => [z.pk[0], z.stand]);
  assert.deepEqual(r, [["b", "normal"], ["c", "neu"], ["a", "herabgestuft"], ["d", "ausgefallen"]]);
});

test("P2b2: Seite Netz lädt erst beim Öffnen des Reiters; Wahl der Prüfer geht in die Sicherung, beim Zusammenführen ohne Verlust", () => {
  const ui = lies("shell/tabs/pruefung-ui.ts");
  assert.match(ui, /\[data-subtab="pruefung"\]'\)\?\.addEventListener\("click", \(\) => void zeigePruefung\(\)\)/);
  assert.match(ui, /pruefZeilen\(\(await providerMitStand\(\)\)/, "dieselbe Quelle wie die Auswahl");
  assert.doesNotMatch(ui, /innerHTML/);
  const app = lies("shell/app.ts");
  assert.match(app, /\n  wirePruefung\(\);\n/);
  assert.doesNotMatch(app, /zeigePruefung/, "nie beim Start oder beim Seitenwechsel");
  assert.match(lies("shell/state.ts"), /return matchProviders\(await providerMitStand\(\), tier/);
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_PRUEFER));
  const { werte } = fuehreZusammen({ [LS_PRUEFER]: JSON.stringify([pk("a")]) }, (k) => (k === LS_PRUEFER ? JSON.stringify([pk("b")]) : null));
  assert.deepEqual(new Set(JSON.parse(werte[LS_PRUEFER]!)), new Set([pk("a"), pk("b")]));
});
