/**
 * D1b1: Abrechnung und Reklamation mit dem Sitzungsschlüssel des Auftrags –
 * nicht mit dem aktuellen. Vorbereitung für neue Schlüssel je Unterhaltung
 * (D1b2): Eine Antwort auf einen früheren Auftrag darf dem Provider nie den
 * neuen Schlüssel nennen, sonst verbände er beide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, generateKeypair } from "@freedomstack/protocol";
import { KI_AUFTRAEGE_MAX, KiSitzungen } from "../src/ki-sitzung.js";
import { SessionClient } from "../src/session-client.js";

const lies = (d: string) => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");

test("KiSitzungen merkt den Schlüssel je Auftrag – begrenzt, nur aus dem eigenen Gedächtnis; der rohe Schlüssel je Sitzungsschlüssel", () => {
  const s = new KiSitzungen();
  const provider = generateKeypair().pk;
  const a = s.fuer(provider);
  s.merkeAuftrag("r1", a);
  assert.equal(s.fuerAuftrag("r1"), a);
  assert.equal(s.fuerAuftrag("r2"), undefined, "unbekannter Auftrag: kein Schlüssel – nie ein geratener");
  assert.match(s.schluesselHex(a.publicKey())!, /^[0-9a-f]{64}$/);
  assert.equal(new LocalSigner(Uint8Array.from(Buffer.from(s.schluesselHex(a.publicKey())!, "hex"))).publicKey(), a.publicKey());
  assert.equal(s.schluesselHex(provider), undefined, "nicht mehr je Provider");
  for (let i = 0; i < KI_AUFTRAEGE_MAX; i++) s.merkeAuftrag(`x${i}`, a);
  assert.equal(s.fuerAuftrag("r1"), undefined, "die ältesten fallen heraus");
  assert.equal(s.fuerAuftrag(`x${KI_AUFTRAEGE_MAX - 1}`), a);
});

test("SessionClient: Konten gehören zum Schlüssel – eine Antwort auf einen früheren Auftrag verbucht dort, nie beim neuen", async () => {
  const provider = generateKeypair().pk;
  const alt = new LocalSigner(generateKeypair().sk);
  const neu = new LocalSigner(generateKeypair().sk);
  let aktuell = alt;
  const sc = new SessionClient({ signerFuer: () => aktuell });
  await sc.chargeForResult(provider, 5_500);
  assert.deepEqual(sc.offeneVon(alt.publicKey()), [provider]);

  // Der aktuelle Schlüssel wechselt (D1b2): das Konto des alten gilt für ihn nicht
  aktuell = neu;
  await sc.chargeForResult(provider, 300);
  assert.deepEqual(sc.offeneVon(neu.publicKey()), [], "300 msat beim neuen – nichts vom alten");
  const zahlungen: number[] = [];
  const wallet = { rechnung: async (m: number) => `lnbc-${m}`, zahle: async (_r: string, m: number) => { zahlungen.push(m); return "ab".repeat(32); } };
  assert.equal((await sc.begleiche(provider, neu, wallet)).settled, false, "der neue begleicht nie die Schuld des alten");

  // Späte Antwort auf den alten Auftrag: beim alten Schlüssel verbucht und dort gezahlt
  const spaet = await sc.chargeForResult(provider, 700, wallet, alt);
  assert.deepEqual([spaet.settled, spaet.gezahltMsat, spaet.offenMsat], [true, 6_000, 200]);
  assert.deepEqual(zahlungen, [6_000]);
  // Eine Antwort auf einen neuen Auftrag: beim neuen
  const jetzt = await sc.chargeForResult(provider, 700, wallet, neu);
  assert.deepEqual([jetzt.settled, jetzt.gezahltMsat, jetzt.offenMsat], [true, 1_000, 0]);
});

test("Verdrahtet: Auftrag gemerkt vor dem Senden, Abrechnung und Reklamation mit seinem Schlüssel", () => {
  const agent = lies("shell/tabs/agent.ts");
  const bau = agent.slice(agent.indexOf("export async function buildJobEvent("), agent.indexOf("export let jobAbort"));
  assert.match(bau, /const sitzung = kiSitzungen\.fuer\(targetPubkey\);/);
  // Seit RM2c3 ohne Sitzung: jede Anfrage vom Sitzungsschlüssel, mit Gebot
  assert.match(bau, /const request = buildJobRequest\(\{\n    customerPubkey: sitzung\.publicKey\(\),/);
  assert.doesNotMatch(bau, /useSession|jobTags|activeFor|sc\b/);
  assert.match(bau, /kiSitzungen\.merkeAuftrag\(auftrag\.requestId, sitzung\);[^\n]*\n  merkeErsetzt\(/);
  const antwort = agent.slice(agent.indexOf("export async function handleAnswer("), agent.indexOf("export function resetSendBtn("));
  assert.match(antwort, /sc\.chargeForResult\(r\.providerPubkey, abrechnung\.providerMsat, zahlung, kiSitzungen\.fuerAuftrag\(r\.requestId\)\)/);
  assert.match(antwort, /addUsageBubble\([^\n]*, abrechnung, r\.requestId\);/);
  assert.match(lies("shell/pruefrunde-lauf.ts"), /sc\.chargeForResult\(r\.providerPubkey, abrechnung\.providerMsat, zahlung, kiSitzungen\.fuerAuftrag\(r\.requestId\)\)/);
  // Jeder Aufruf mit Schlüssel – keiner fällt still auf den aktuellen zurück
  const alle = [agent, lies("shell/pruefrunde-lauf.ts"), lies("shell/tabs/agent-wege.ts"), lies("shell/tabs/agent-anzeige.ts")].join("\n");
  assert.equal(alle.match(/chargeForResult\(/g)?.length, 2);
  const anzeige = lies("shell/tabs/agent-anzeige.ts");
  assert.match(anzeige, /void reklamiere\(resultEventId, providerPk, amountMsat, frageAntwort, auftragId\);/);
  assert.match(anzeige, /const sk = kiSitzungen\.schluesselHex\(sitzung\.publicKey\(\)\);/);
});
