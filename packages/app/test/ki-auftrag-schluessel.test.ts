/**
 * D1b1: Abrechnung und Reklamation mit dem Sitzungsschlüssel des Auftrags –
 * nicht mit dem aktuellen. Vorbereitung für neue Schlüssel je Unterhaltung
 * (D1b2): Eine Antwort auf einen früheren Auftrag darf dem Provider nie den
 * neuen Schlüssel nennen, sonst verbände er beide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, generateKeypair, openPrivateKundenEvent, type NostrEvent, type OutboxPool } from "@freedomstack/protocol";
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

test("SessionClient: Sitzungen gehören zum Schlüssel – eine Antwort auf einen früheren Auftrag verbucht dort und nennt den neuen nie", async () => {
  const provider = generateKeypair();
  const gesendet: NostrEvent[] = [];
  const pool = { publish: async (ev: NostrEvent) => { gesendet.push(ev); return { ok: true }; } } as unknown as OutboxPool;
  const alt = new LocalSigner(generateKeypair().sk);
  const neu = new LocalSigner(generateKeypair().sk);
  let aktuell = alt;
  const sc = new SessionClient({ signerFuer: () => aktuell, pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600 });
  const e = "e".repeat(64);
  await sc.chargeForResult(provider.pk, 5_000, e);
  const sitzungAlt = sc.activeFor(provider.pk)!;
  assert.equal(sitzungAlt.open.customerPubkey, alt.publicKey());

  // Der aktuelle Schlüssel wechselt (D1b2): die alte Sitzung gilt für ihn nicht
  aktuell = neu;
  assert.equal(sc.activeFor(provider.pk), null);
  assert.equal(sc.activeFor(provider.pk, alt.publicKey()), sitzungAlt);
  assert.deepEqual(sc.jobTags(provider.pk, 21_000, neu.publicKey()), [["bid", "21000"]], "nie die Sitzungs-Id eines anderen Schlüssels");
  assert.deepEqual(sc.jobTags(provider.pk, 21_000, alt.publicKey()), [["session", sitzungAlt.open.sessionId]]);
  assert.equal(sc.budgetState(provider.pk), null);

  // Späte Antwort auf den alten Auftrag: in der alten Sitzung, Beleg vom alten Schlüssel
  const vorher = gesendet.length;
  await sc.chargeForResult(provider.pk, 7_000, e, undefined, alt);
  assert.equal(gesendet.length, vorher + 1, "nur der Beleg – keine neue Sitzung");
  const beleg = await openPrivateKundenEvent(gesendet.at(-1)!, new LocalSigner(provider.sk));
  assert.ok(beleg.ok);
  assert.equal(beleg.request.kind, 38022);
  assert.equal(beleg.kundePk, alt.publicKey());
  assert.equal(beleg.request.tags.find((t) => t[0] === "d")?.[1], sitzungAlt.open.sessionId);
  assert.equal(sitzungAlt.chargedMsat, 12_000);

  // Eine Antwort auf einen neuen Auftrag: eigene Sitzung des neuen Schlüssels
  await sc.chargeForResult(provider.pk, 3_000, e, undefined, neu);
  const sitzungNeu = sc.activeFor(provider.pk)!;
  assert.notEqual(sitzungNeu, sitzungAlt);
  assert.equal(sitzungNeu.open.customerPubkey, neu.publicKey());
  assert.ok(!sitzungNeu.open.sessionId.includes(alt.publicKey().slice(0, 8)), "die Id nennt den alten Schlüssel nicht");
  // Was der Provider vom neuen Schlüssel bekommt, nennt den alten nirgends
  for (const w of gesendet.slice(vorher + 1)) {
    const o = await openPrivateKundenEvent(w, new LocalSigner(provider.sk));
    assert.ok(o.ok);
    assert.equal(o.kundePk, neu.publicKey());
    assert.ok(!JSON.stringify(o.request).includes(alt.publicKey()));
    assert.ok(!JSON.stringify(o.request).includes(sitzungAlt.open.sessionId));
  }
});

test("Verdrahtet: Auftrag gemerkt vor dem Senden, Abrechnung und Reklamation mit seinem Schlüssel", () => {
  const agent = lies("shell/tabs/agent.ts");
  const bau = agent.slice(agent.indexOf("export async function buildJobEvent("), agent.indexOf("export let jobAbort"));
  assert.match(bau, /const sitzung = kiSitzungen\.fuer\(targetPubkey\);/);
  assert.match(bau, /const useSession = !eigen && !kanal && sc\.activeFor\(targetPubkey, sitzung\.publicKey\(\)\);/);
  assert.match(bau, /\.\.\.sc\.jobTags\(targetPubkey, bid \* 1000, sitzung\.publicKey\(\)\),/);
  assert.match(bau, /kiSitzungen\.merkeAuftrag\(auftrag\.requestId, sitzung\);[^\n]*\n  merkeErsetzt\(/);
  const antwort = agent.slice(agent.indexOf("export async function handleAnswer("), agent.indexOf("export function resetSendBtn("));
  assert.match(antwort, /sc\.chargeForResult\(r\.providerPubkey, abrechnung\.providerMsat, ev\.id, zahlung, kiSitzungen\.fuerAuftrag\(r\.requestId\)\)/);
  assert.match(antwort, /addUsageBubble\([^\n]*, abrechnung, r\.requestId\);/);
  assert.match(lies("shell/pruefrunde-lauf.ts"), /sc\.chargeForResult\(r\.providerPubkey, abrechnung\.providerMsat, ev\.id, zahlung, kiSitzungen\.fuerAuftrag\(r\.requestId\)\)/);
  // Jeder Aufruf mit Schlüssel – keiner fällt still auf den aktuellen zurück
  const alle = [agent, lies("shell/pruefrunde-lauf.ts"), lies("shell/tabs/agent-wege.ts"), lies("shell/tabs/agent-anzeige.ts")].join("\n");
  assert.equal(alle.match(/chargeForResult\(/g)?.length, 2);
  const anzeige = lies("shell/tabs/agent-anzeige.ts");
  assert.match(anzeige, /void reklamiere\(resultEventId, providerPk, amountMsat, frageAntwort, auftragId\);/);
  assert.match(anzeige, /const sk = kiSitzungen\.schluesselHex\(sitzung\.publicKey\(\)\);/);
});
