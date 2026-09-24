/**
 * Leak-Szenario „KI-Anfrage“ (Schritt 1.5): Sitzung eroeffnen mit dem echten
 * `SessionClient`, dann die Anfrage so gebaut wie `buildJobEvent()` in
 * `tabs/agent.ts` – einmal mit Sitzung, einmal mit Gebot. Heute stehen Prompt
 * und Kunden-Schluessel offen in den Events; Schritt 3.1 verschluesselt beides.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, buildEvent, buildJobRequest, generateKeypair,
  regelKeinBolt11, regelKeinKind4, regelKeinKlartextPrompt, regelKundeVerborgen,
} from "@freedomstack/protocol";
import { SessionClient } from "../../src/session-client.js";
import { aufzeichnung } from "./aufzeichnung.js";

const PROMPT = "Fasse meinen Arztbrief vom Maerz zusammen";

async function frage() {
  const { pool, relay } = aufzeichnung();
  const signer = new LocalSigner(generateKeypair().sk);
  const kunde = signer.publicKey();
  const provider = generateKeypair().pk;
  const sc = new SessionClient({ signer, pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600 });
  await sc.openSession(provider);
  // Mit Sitzung – wie buildJobEvent(), wenn sc.activeFor(provider) gilt
  await pool.publish(await signer.signEvent(buildEvent(kunde, KIND_DVM_TEXT_GENERATION, [
    ["i", PROMPT, "text"], ...sc.jobTags(provider, 21_000), ["tier", "standard"], ["p", provider],
  ], "")));
  // Ohne Sitzung – mit Gebot
  await pool.publish(await signer.signEvent(buildJobRequest({
    customerPubkey: kunde, input: PROMPT, bidMsat: 21_000, providerPubkey: provider, params: [["tier", "standard"]],
  })));
  return { gesendet: relay.gesendet, kunde };
}

test("KI-Anfrage: Sitzung und Anfragen gehen ueber den Pool", async () => {
  const { gesendet } = await frage();
  assert.equal(gesendet.length, 3);
  assert.deepEqual(regelKeinKind4(gesendet), []);
  assert.deepEqual(regelKeinBolt11(gesendet), []);
});

test("KI-Anfrage: kein Klartext-Prompt", { todo: "Schritt 3.1" }, async () => {
  const { gesendet } = await frage();
  assert.deepEqual(regelKeinKlartextPrompt(gesendet, [PROMPT]), []);
});

test("KI-Anfrage: Kunden-Schluessel in keinem Job-Event", { todo: "Schritt 3.1" }, async () => {
  const { gesendet, kunde } = await frage();
  assert.deepEqual(regelKundeVerborgen(gesendet, kunde), []);
});

test("Verdrahtung: buildJobEvent() baut die Anfrage wie das Szenario", () => {
  const agent = readFileSync(new URL("../../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const f = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("function aktiveClientGebuehr("));
  assert.match(f, /\["i", fullPrompt, "text"\],\s*\.\.\.sc\.jobTags\(targetPubkey/);
  assert.match(f, /buildJobRequest\(\{\s*customerPubkey: state\.keypair\.pk,\s*input: fullPrompt,/);
  assert.match(agent, /ensureSessionClient\(\)/);
});
