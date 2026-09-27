/**
 * Leak-Szenario „KI-Anfrage“ (Schritt 1.5, seit 3.1 privat): Sitzung eroeffnen
 * mit dem echten `SessionClient` und dem Sitzungsschluessel aus `KiSitzungen`,
 * dann die Anfrage so gebaut wie `buildJobEvent()` in `tabs/agent.ts` – einmal
 * mit Sitzung, einmal mit Gebot – und im Umschlag an den Provider. Seit 3.2e
 * gehen auch Sitzung und Belege nur versiegelt an ihn; seit 5.1.3 auch die
 * Deklaration der Anteile und die Belege bezahlter Rechnungen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, aufteilungTag, buildEvent, buildJobRequest, buildPrivateJobRequest, generateKeypair,
  regelKeinBolt11, regelKeinKind4, regelKeinKlartextPrompt, regelKeineZahlungsdaten, regelKundeVerborgen,
} from "@freedomstack/protocol";
import { KiSitzungen } from "../../src/ki-sitzung.js";
import { SessionClient } from "../../src/session-client.js";
import { aufzeichnung } from "./aufzeichnung.js";

const PROMPT = "Fasse meinen Arztbrief vom Maerz zusammen";
const WERBER = "werberin@wallet.example";

async function frage() {
  const { pool, relay } = aufzeichnung();
  const identitaet = new LocalSigner(generateKeypair().sk);
  const sitzungen = new KiSitzungen();
  const provider = generateKeypair().pk;
  const sc = new SessionClient({ signerFuer: (pk) => sitzungen.fuer(pk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600 });
  await sc.openSession(provider);
  const sitzung = sitzungen.fuer(provider);
  // Mit Sitzung – wie buildJobEvent(), wenn sc.activeFor(provider) gilt
  const mitSitzung = buildEvent(sitzung.publicKey(), KIND_DVM_TEXT_GENERATION, [
    ["i", PROMPT, "text"], ...sc.jobTags(provider, 21_000), ["tier", "standard"], ["p", provider], aufteilungTag(["werber-provider"]),
  ], "");
  // Ohne Sitzung – mit Gebot
  const mitGebot = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 21_000, providerPubkey: provider, params: [["tier", "standard"]],
    extraTags: [aufteilungTag(["werber-provider"])],
  });
  for (const request of [mitSitzung, mitGebot]) {
    const { wrap } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: provider, powBits: 8 });
    await pool.publish(wrap);
  }
  return { gesendet: relay.gesendet, identitaet: identitaet.publicKey(), sitzung: sitzung.publicKey() };
}

test("KI-Anfrage: Sitzung und zwei Anfragen gehen nur als Umschlaege ueber den Pool", async () => {
  const { gesendet } = await frage();
  assert.deepEqual(gesendet.map((e) => e.kind), [1059, 1059, 1059]);
  assert.equal(gesendet.filter((e) => e.kind >= 5000 && e.kind < 6000).length, 0);
  assert.deepEqual(regelKeinKind4(gesendet), []);
  assert.deepEqual(regelKeinBolt11(gesendet), []);
});

test("KI-Anfrage: kein Klartext-Prompt", async () => {
  const { gesendet } = await frage();
  assert.deepEqual(regelKeinKlartextPrompt(gesendet, [PROMPT]), []);
  // Auch ausserhalb von Kind 5xxx nicht – etwa im Umschlag.
  assert.ok(gesendet.every((e) => !(e.content + JSON.stringify(e.tags)).includes(PROMPT)));
});

test("KI-Anfrage: Kunden-Schluessel in keinem Job-Event", async () => {
  const { gesendet, identitaet, sitzung } = await frage();
  assert.deepEqual(regelKundeVerborgen(gesendet, identitaet), []);
  // Auch der Sitzungsschluessel zeigt sich nirgends – weder an Anfrage noch Sitzung (3.2e).
  assert.deepEqual(regelKundeVerborgen(gesendet, sitzung), []);
});

test("KI-Anfrage: keine Zahlungsdaten offen (Sitzung, Beleg)", async () => {
  const { pool, relay } = aufzeichnung();
  const sitzungen = new KiSitzungen();
  const provider = generateKeypair().pk;
  const sc = new SessionClient({ signerFuer: (pk) => sitzungen.fuer(pk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600 });
  await sc.openSession(provider);
  await sc.chargeForResult(provider, 7000, "e".repeat(64));
  assert.deepEqual(regelKeineZahlungsdaten(relay.gesendet), []);
});

test("KI-Anfrage: die Deklaration der Anteile (5.1.3) steht nur im versiegelten Kern", async () => {
  const { gesendet } = await frage();
  assert.ok(gesendet.every((e) => !JSON.stringify(e).includes("aufteilung") && !JSON.stringify(e).includes("werber-provider")));
});

test("KI-Anfrage: bezahlte Belege (5.1.3) zeigen offen weder Preimage noch Rechnung", async () => {
  const { pool, relay } = aufzeichnung();
  const sitzungen = new KiSitzungen();
  const provider = generateKeypair().pk;
  const sc = new SessionClient({ signerFuer: (pk) => sitzungen.fuer(pk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600 });
  const preimage = "ab".repeat(32);
  const r = await sc.chargeForResult(provider, 25_000, "e".repeat(64), {
    rechnung: async () => `lnbc250n1${WERBER}`, zahle: async () => preimage,
  });
  assert.equal(r.settled, true);
  assert.deepEqual(regelKeineZahlungsdaten(relay.gesendet), []);
  assert.ok(relay.gesendet.every((e) => !JSON.stringify(e).includes(preimage) && !JSON.stringify(e).includes("lnbc")));
});

test("Verdrahtung: buildJobEvent() baut die Anfrage wie das Szenario", () => {
  const agent = readFileSync(new URL("../../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const f = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("/** Abbruch-Signal für den laufenden AI-Job"));
  assert.match(f, /const sitzung = kiSitzungen\.fuer\(targetPubkey\);/);
  assert.match(f, /buildEvent\(sitzung\.publicKey\(\), KIND_DVM_TEXT_GENERATION, \[\s*\["i", fullPrompt, "text"\],\s*\.\.\.sc\.jobTags\(targetPubkey/);
  assert.match(f, /buildJobRequest\(\{\s*customerPubkey: sitzung\.publicKey\(\),\s*input: fullPrompt,/);
  assert.match(f, /const auftrag = await buildPrivateJobRequest\(\{\s*request, sessionSigner: sitzung, providerPk: targetPubkey,/);
  // Die Deklaration kommt vor dem Versiegeln in den Kern (Zusatz-Tags), nie danach
  assert.match(f, /extraTags\.push\(\.\.\.deklaration\(empfaenger\)\);[\s\S]*\.\.\.extraTags,[\s\S]*const auftrag = await buildPrivateJobRequest/);
  assert.doesNotMatch(agent, /customerPubkey: state\.keypair\.pk/);
  // Gesendet wird nur der Umschlag
  assert.doesNotMatch(agent, /await buildJobEvent\([^)]*\);\s*await pool\.publish\(ev\)/);
  const st = readFileSync(new URL("../../src/shell/state.ts", import.meta.url), "utf8");
  assert.match(st, /signerFuer: \(providerPk\) => kiSitzungen\.fuer\(providerPk\)/);
});
