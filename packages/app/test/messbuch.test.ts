/**
 * Freedom-Prüfung P2a (E7, docs/FREEDOM-PRUEFUNG.md 3.1, 3.3): eigene Messung
 * der Provider – nur im Tresor, nie in der Sicherung – und Auswahl nach ihr
 * (normale vorn, Neue in der Mitte, gerade Ausgefallene hinten).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_NIE, buildCapabilities, generateKeypair, parseCapabilities, signEvent, type MessStand } from "@freedomstack/protocol";
import { LS_MESSUNGEN, MESS_PROVIDER_MAX, MessBuch, ergebnisDesLaufs } from "../src/messbuch.js";
import { type ScoredProvider, matchProviders, mitMessung } from "../src/matchmaking.js";

const JETZT = 1_790_000_000;
const pk = (c: string) => c.repeat(64);
const speicher = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");

test("Messbuch: merken, je Provider die letzten 100, streng gelesen", async () => {
  const s = speicher();
  const buch = new MessBuch(s);
  for (let i = 0; i < 120; i++) await buch.merke(pk("a"), { zeit: JETZT - 200 + i, ok: i % 10 !== 0, ms: 900 + i });
  await buch.merke(pk("b"), { zeit: JETZT - 5, ok: false });
  assert.equal(buch.alle().get(pk("a"))!.length, 100);
  const st = buch.staende(JETZT);
  assert.equal(st.get(pk("a"))!.anfragen, 100);
  assert.equal(st.get(pk("a"))!.erfolge, 90);
  assert.equal(st.get(pk("a"))!.stufe, "herabgestuft");
  assert.equal(st.get(pk("b"))!.ausfallJetzt, true);
  assert.equal(st.get(pk("b"))!.stufe, "neu", "ein Fehler macht noch keine Stufe");

  await buch.merke("kein-schluessel", { zeit: JETZT, ok: true });
  await buch.merke(pk("c"), { zeit: JETZT, ok: true, ms: -1 });
  await buch.merke(pk("c"), { zeit: 1.5, ok: true } as never);
  assert.equal(buch.alle().has(pk("c")), false, "Unsinn wird nicht gemerkt");

  s.setItem(LS_MESSUNGEN, JSON.stringify({ [pk("d")]: [{ zeit: JETZT, ok: true }, { zeit: "x", ok: true }, { zeit: JETZT, ok: "ja" }], kaputt: [{ zeit: JETZT, ok: true }] }));
  assert.deepEqual([...buch.alle()], [[pk("d"), [{ zeit: JETZT, ok: true }]]], "nur gültige Punkte und Schlüssel");
  s.setItem(LS_MESSUNGEN, "{nicht json");
  assert.equal(buch.alle().size, 0);
  s.setItem(LS_MESSUNGEN, "[]");
  assert.equal(buch.alle().size, 0);
});

test("Messbuch: höchstens 200 Provider – die zuletzt gemessenen bleiben", async () => {
  const buch = new MessBuch(speicher());
  for (let i = 0; i < MESS_PROVIDER_MAX + 5; i++) await buch.merke(i.toString(16).padStart(64, "0"), { zeit: JETZT - 1000 + i, ok: true });
  const alle = buch.alle();
  assert.equal(alle.size, MESS_PROVIDER_MAX);
  assert.equal(alle.has("0".repeat(64)), false, "der älteste fällt weg");
  assert.equal(alle.has((MESS_PROVIDER_MAX + 4).toString(16).padStart(64, "0")), true);
});

test("Ergebnis eines Laufs: Antwort mit Zeit, verpasste Frist als Fehler, laufende zählen nicht", () => {
  const gesendet = new Map([[pk("a"), 1_000_000], [pk("b"), 1_020_000], [pk("c"), 1_040_000]]);
  const jetztMs = 1_045_500;
  const zeit = Math.floor(jetztMs / 1000);
  assert.deepEqual(ergebnisDesLaufs(gesendet, new Set([pk("a"), pk("b")]), { pk: pk("c") }, jetztMs), [
    [pk("c"), { zeit, ok: true, ms: 5_500 }],
    [pk("a"), { zeit, ok: false }],
    [pk("b"), { zeit, ok: false }],
  ]);
  // Der erste antwortet doch noch (Hedging): Erfolg für ihn, der zweite lief noch – zählt nicht
  assert.deepEqual(ergebnisDesLaufs(gesendet, new Set([pk("a")]), { pk: pk("a") }, jetztMs), [[pk("a"), { zeit, ok: true, ms: 45_500 }]]);
  assert.deepEqual(ergebnisDesLaufs(gesendet, new Set(), { pk: pk("b"), kaputt: true }, jetztMs), [[pk("b"), { zeit, ok: false }]], "kaputtes Ergebnis");
  assert.deepEqual(ergebnisDesLaufs(gesendet, new Set([pk("a"), pk("b"), pk("c")]), null, jetztMs).map(([p, x]) => [p, x.ok]), [[pk("a"), false], [pk("b"), false], [pk("c"), false]]);
  assert.deepEqual(ergebnisDesLaufs(gesendet, new Set(), { pk: pk("f") }, jetztMs), [], "wer nicht gefragt wurde, zählt nicht");
});

function provider(preis: number, geprueft = false): ScoredProvider {
  const k = generateKeypair();
  const caps = parseCapabilities(signEvent(buildCapabilities({ pubkey: k.pk, tier: "classic", models: ["m"], textRatePerKTokenMsat: preis, tools: [], currentlyFree: false }, JETZT), k.sk));
  return { caps, trustScore: geprueft ? 50 : 0, jobsCompleted: geprueft ? 3 : 0, repTier: "classic", score: geprueft ? 503 : -1, geprueft, reklamationen: 0 };
}
const stand = (s: Partial<MessStand>): MessStand => ({ anfragen: 100, erfolge: 100, ausfallJetzt: false, stufe: "normal", ...s });

test("Auswahl nach der eigenen Messung: normal vorn, Neue in der Mitte, gerade Ausgefallene und schwache hinten, eigene Provider zuerst", () => {
  const [gut, neu, bekannt, wackelt, gerade, tot, eigen] = [provider(4000), provider(500), provider(3000, true), provider(500), provider(500), provider(500), provider(9000)];
  const messung = new Map([
    [gut.caps.pubkey, stand({})],
    [wackelt.caps.pubkey, stand({ erfolge: 85, stufe: "herabgestuft" })],
    [gerade.caps.pubkey, stand({ ausfallJetzt: true })],
    [tot.caps.pubkey, stand({ erfolge: 50, stufe: "ausgefallen" })],
  ]);
  const alle = mitMessung([tot, gerade, wackelt, neu, bekannt, gut, eigen], messung);
  assert.equal(alle.find((p) => p.caps.pubkey === neu.caps.pubkey)!.messung, undefined);
  const r = matchProviders(alle, "classic", { allowlist: [eigen.caps.pubkey], maxResults: 10, zufall: () => 0.5 }).map((p) => p.caps.pubkey);
  assert.deepEqual(r, [eigen, gut, bekannt, neu, wackelt, gerade, tot].map((p) => p.caps.pubkey), "trotz höherem Preis: gemessen normal vor neu, bekannt vor unbekannt");
  assert.deepEqual(matchProviders(alle, "classic", { zufall: () => 0.5 }).length, 5, "höchstens fünf");
});

test("Ablage: nur im Tresor, nie in der Sicherung; verdrahtet in Auswahl und Failover", () => {
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_MESSUNGEN)));
  assert.match(lies("shell/tresor.ts"), /"freedom\.messungen"/, "in GEHEIM_FEST – mit Tresor nie im Klartext");
  assert.match(lies("shell/messung.ts"), /new MessBuch\(geheim\)/);
  assert.match(lies("shell/state.ts"), /mitMessung\(await bekannteProvider\(\), messBuch\.staende\(/);
  const wege = lies("shell/tabs/agent-wege.ts");
  const lauf = wege.slice(wege.indexOf("export async function askWithFailover("), wege.indexOf("export async function privateAntworten("));
  // Seit P5c2 über messeLauf(): ohne Runde gleich merkeMessung(), mit Runde nach den zusätzlichen Antworten
  assert.equal(lauf.match(/messeLauf\(runde, ergebnisDesLaufs\(/g)?.length, 2, "nach einer Antwort und wenn alle versagten");
  assert.match(lies("shell/pruefrunde-lauf.ts"), /r \? r\.abschluss\(punkte, antwort\) : merkeMessung\(punkte\)/);
  const ablehnung = lauf.slice(lauf.indexOf('"providerError" in answer'), lauf.indexOf("continue; // Failover!"));
  assert.doesNotMatch(ablehnung, /merkeMessung|zuLangsam/, "Ablehnungen zählen nicht – oft ein Fehler des Nutzers");
  const abbruch = lauf.slice(lauf.indexOf("if (answer.aborted)"), lauf.indexOf('t("agent.abgebrochen")') + 40);
  assert.doesNotMatch(abbruch, /merkeMessung/, "Abbrüche zählen nicht");
});

test("P5c: Messpunkte aus Prüfrunden – „einig“ wird gemerkt und streng gelesen; Ausreißer stehen in der Auswahl hinten", async () => {
  const s = speicher();
  const buch = new MessBuch(s);
  for (let i = 0; i < 3; i++) await buch.merke(pk("a"), { zeit: JETZT - 10 + i, ok: true, ms: 900, einig: false });
  await buch.merke(pk("a"), { zeit: JETZT - 1, ok: true, ms: 900, einig: "ja" } as never);
  assert.equal(buch.alle().get(pk("a"))!.length, 3, "„einig“ nur als Wahrheitswert");
  assert.equal(buch.staende(JETZT).get(pk("a"))!.qualitaet, 0);
  s.setItem(LS_MESSUNGEN, JSON.stringify({ [pk("b")]: [{ zeit: JETZT, ok: true, einig: 1 }, { zeit: JETZT, ok: true, einig: true }] }));
  assert.deepEqual(buch.alle().get(pk("b")), [{ zeit: JETZT, ok: true, einig: true }]);
  // Gleich gut verfügbar, aber in Prüfrunden abgewichen: hinter den übrigen
  const [abweichend, einig1, einig2] = [provider(500), provider(500), provider(500)];
  const r = matchProviders(mitMessung([abweichend, einig1, einig2], new Map([
    [abweichend.caps.pubkey, stand({ qualitaet: 0 })], [einig1.caps.pubkey, stand({ qualitaet: 1 })], [einig2.caps.pubkey, stand({ qualitaet: 1 })],
  ])), "classic", { maxResults: 10, zufall: () => 0.5 }).map((p) => p.caps.pubkey);
  assert.equal(r[2], abweichend.caps.pubkey);
});
