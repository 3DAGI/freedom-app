/**
 * Leak-Szenario „KI-Anfrage“ (Schritt 1.5, seit 3.1 privat): Sitzung eroeffnen
 * mit dem echten `SessionClient` und dem Sitzungsschluessel aus `KiSitzungen`,
 * dann die Anfrage so gebaut wie `buildJobEvent()` in `tabs/agent.ts` – einmal
 * mit Sitzung, einmal mit Gebot – und im Umschlag an den Provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, buildEvent, buildJobRequest, buildPrivateJobRequest, generateKeypair,
  regelKeinBolt11, regelKeinKind4, regelKeinKlartextPrompt, regelKeineZahlungsdaten, regelKundeVerborgen,
} from "@freedomstack/protocol";
import { KiSitzungen } from "../../src/ki-sitzung.js";
import { SessionClient } from "../../src/session-client.js";
import { aufzeichnung } from "./aufzeichnung.js";

const PROMPT = "Fasse meinen Arztbrief vom Maerz zusammen";

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
    ["i", PROMPT, "text"], ...sc.jobTags(provider, 21_000), ["tier", "standard"], ["p", provider],
  ], "");
  // Ohne Sitzung – mit Gebot
  const mitGebot = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 21_000, providerPubkey: provider, params: [["tier", "standard"]],
  });
  for (const request of [mitSitzung, mitGebot]) {
    const { wrap } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: provider, powBits: 8 });
    await pool.publish(wrap);
  }
  return { gesendet: relay.gesendet, identitaet: identitaet.publicKey(), sitzung: sitzung.publicKey() };
}

test("KI-Anfrage: Sitzung und zwei Umschlaege gehen ueber den Pool, keine offene Anfrage", async () => {
  const { gesendet } = await frage();
  assert.deepEqual(gesendet.map((e) => e.kind).sort(), [1059, 1059, 38021]);
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
  // Der Sitzungsschluessel zeigt sich nur in der Sitzungseroeffnung, nie an einer Anfrage.
  assert.deepEqual(gesendet.filter((e) => e.pubkey === sitzung).map((e) => e.kind), [38021]);
});

test("KI-Anfrage: keine Zahlungsdaten offen (Sitzung, Beleg)", { todo: "Schritt 3.2" }, async () => {
  const { pool, relay } = aufzeichnung();
  const sitzungen = new KiSitzungen();
  const provider = generateKeypair().pk;
  const sc = new SessionClient({ signerFuer: (pk) => sitzungen.fuer(pk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600 });
  await sc.openSession(provider);
  await sc.chargeForResult(provider, 7000, "e".repeat(64));
  assert.deepEqual(regelKeineZahlungsdaten(relay.gesendet), []);
});

test("Verdrahtung: buildJobEvent() baut die Anfrage wie das Szenario", () => {
  const agent = readFileSync(new URL("../../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const f = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("function aktiveClientGebuehr("));
  assert.match(f, /const sitzung = kiSitzungen\.fuer\(targetPubkey\);/);
  assert.match(f, /buildEvent\(sitzung\.publicKey\(\), KIND_DVM_TEXT_GENERATION, \[\s*\["i", fullPrompt, "text"\],\s*\.\.\.sc\.jobTags\(targetPubkey/);
  assert.match(f, /buildJobRequest\(\{\s*customerPubkey: sitzung\.publicKey\(\),\s*input: fullPrompt,/);
  assert.match(f, /return buildPrivateJobRequest\(\{\s*request, sessionSigner: sitzung, providerPk: targetPubkey,/);
  assert.doesNotMatch(agent, /customerPubkey: state\.keypair\.pk/);
  // Gesendet wird nur der Umschlag
  assert.doesNotMatch(agent, /await buildJobEvent\([^)]*\);\s*await pool\.publish\(ev\)/);
  const st = readFileSync(new URL("../../src/shell/state.ts", import.meta.url), "utf8");
  assert.match(st, /signerFuer: \(providerPk\) => kiSitzungen\.fuer\(providerPk\)/);
});
