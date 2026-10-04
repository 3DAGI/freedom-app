/**
 * Freedom-Prüfung P2b1 (E7, docs/FREEDOM-PRUEFUNG.md 3.3): Berichte der
 * gewählten Prüfer zählen bei der Auswahl, wo die eigene Messung zu wenig hat –
 * Stufe und Qualität (Ausreißer nach hinten). Abgefragt wird ohne Filter nach
 * Prüfer und nur, wenn jemand gewählt ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCapabilities, generateKeypair, parseCapabilities, signEvent, type MessStand, type PruefStand } from "@freedomstack/protocol";
import { LS_PRUEFER, PRUEFER_MAX, gewaehltePruefer } from "../src/pruefer-wahl.js";
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
