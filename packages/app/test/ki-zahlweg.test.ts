/**
 * Schritt 12.4a (E3 A, 04.10.2026): KI zahlt nach der Standard-Schiene. Mit SOL
 * nur über einen Zahlkanal zum Provider – ohne Kanal geht nichts hinaus, nie
 * still über Lightning. Mit Lightning wie bisher; ein offener Kanal zahlt weiter
 * (4.3d). Gratis-Anfragen brauchen keinen Zahlweg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kiZahlweg, kiZiele } from "../src/ki-zahlweg.js";

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");

test("Zahlweg: SOL nur mit Kanal, Lightning per Rechnung, ein offener Kanal zahlt immer", () => {
  assert.equal(kiZahlweg("solana", true), "kanal");
  assert.equal(kiZahlweg("solana", false), "kanal-noetig", "ohne Kanal nichts senden – nie still Lightning");
  assert.equal(kiZahlweg("lightning", false), "lightning");
  assert.equal(kiZahlweg("lightning", true), "kanal", "wie seit 4.3d: der Kanal zahlt");
});

test("Ziele: mit SOL nur Provider mit Kanal, Reihenfolge bleibt; mit Lightning alle", () => {
  const mitKanal = new Set(["c", "a"]);
  const da = (pk: string) => mitKanal.has(pk);
  assert.deepEqual(kiZiele(["a", "b", "c", "d"], "solana", da), ["a", "c"]);
  assert.deepEqual(kiZiele(["b", "d"], "solana", da), [], "keiner mit Kanal");
  assert.deepEqual(kiZiele(["a", "b"], "lightning", da), ["a", "b"]);
  const liste = ["a"];
  assert.notEqual(kiZiele(liste, "lightning", da), liste, "eine Kopie, die Liste des Aufrufers bleibt");
});

test("Verdrahtet: Prüfung vor der Gutschrift, Failover und Max nur mit erlaubten Zielen, Fehler vor dem Senden", () => {
  const agent = lies("shell/tabs/agent.ts");
  const bau = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("/** Abbruch-Signal"));
  const i = (s: string) => { const n = bau.indexOf(s); assert.ok(n >= 0, s); return n; };
  // Nicht für den eigenen Knoten (gratis, B-8c) und nicht für Gratis-Anfragen
  assert.ok(i("if (!eigen && hoechst > 0) pruefeKiZahlweg(targetPubkey);") < i("const kanal = eigen ? undefined : await kanalGutschrift(targetPubkey, hoechst);"));
  assert.ok(i("pruefeKiZahlweg(targetPubkey)") < i("buildPrivateJobRequest({"));

  const wege = lies("shell/tabs/agent-wege.ts");
  const failover = wege.slice(wege.indexOf("export async function askWithFailover("), wege.indexOf("// HEDGING"));
  assert.match(failover, /ziele = zieleNachSchiene\(pubkeyList, bid > 0\);\s*\} catch \(e\) \{\s*showAiError\(e, prompt, bid, tier\);\s*return;\s*\}\s*const targets = ziele\.slice\(0, 3\);/);
  const race = wege.slice(wege.indexOf("async function askRace("), wege.indexOf("for (const j of jobs) await pool.publish(j.wrap);"));
  assert.match(race, /const erlaubt = new Set\(zieleNachSchiene\(candidates\.map\(\(c\) => c\.caps\.pubkey\), bid > 0\)\);\s*const racers = matchRaceProviders\(candidates\.filter\(\(c\) => erlaubt\.has\(c\.caps\.pubkey\)\), tier, DEFAULT_MAX_MODE\);/);

  const zahlung = lies("shell/ki-zahlung.ts");
  assert.match(zahlung, /if \(kiZahlweg\(standardSchiene\(\), kanalDa\(providerPk\)\) === "kanal-noetig"\) throw new Error\(t\("zahl\.kanalNoetig"\)\);/);
  assert.match(zahlung, /if \(liste\.length > 0 && ziele\.length === 0\) throw new Error\(t\("zahl\.kanalNoetig"\)\);/, "keiner mit Kanal – Fehler statt Lightning");
  // Die Einstellung sagt, dass sie auch für KI gilt
  assert.match(lies("texte/settings.ts"), /"set\.schieneText": \{ de: "Vorgabe für Zaps, Trinkgeld und KI/);
});
