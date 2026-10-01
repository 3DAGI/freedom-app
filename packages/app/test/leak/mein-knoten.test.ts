/**
 * Leak-Szenario „Mein Knoten“ (B-8c): Die Anfrage an den eigenen Knoten wird
 * gebaut wie in `buildJobEvent()` – ohne Gebot, Anteile und Kanal, mit dem
 * Nachweis im Kern – und geht nur im Umschlag hinaus. Weder Nachweis noch
 * Geheimnis noch Prompt stehen offen, die Identität nirgends.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BESITZER_TAG, buildJobRequest, buildPrivateJobRequest, generateKeypair, mitBesitzerNachweis, neueKopplung,
  regelBesitzerVersiegelt, regelKeinBolt11, regelKeinKlartextPrompt, regelKeineZahlungsdaten, regelKundeVerborgen, regelPTagsNur,
} from "@freedomstack/protocol";
import { KiSitzungen } from "../../src/ki-sitzung.js";
import { aufzeichnung } from "./aufzeichnung.js";

const PROMPT = "Frage an meinen eigenen Knoten";

test("Mein Knoten: Nachweis und Geheimnis nur versiegelt, kein Gebot, Identität verborgen", async () => {
  const { pool, relay } = aufzeichnung();
  const identitaet = generateKeypair().pk;
  const knoten = generateKeypair().pk;
  const k = neueKopplung(knoten);
  const sitzung = new KiSitzungen().fuer(knoten);
  // Wie buildJobEvent() für den eigenen Knoten: Gebot 0, keine Deklaration, Nachweis im Kern vor dem Versiegeln
  const kern = mitBesitzerNachweis(buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 0, providerPubkey: knoten, params: [["tier", "standard"]], extraTags: [],
  }), k);
  const nachweis = kern.tags.find((t) => t[0] === BESITZER_TAG)![1]!;
  const { wrap } = await buildPrivateJobRequest({ request: kern, sessionSigner: sitzung, providerPk: knoten, powBits: 8 });
  await pool.publish(wrap);
  const gesendet = relay.gesendet;
  assert.deepEqual(gesendet.map((e) => e.kind), [1059]);
  assert.deepEqual(regelBesitzerVersiegelt(gesendet), []);
  assert.ok(gesendet.every((e) => !JSON.stringify(e).includes(k.geheimnis) && !JSON.stringify(e).includes(nachweis)));
  assert.deepEqual(regelKeinKlartextPrompt(gesendet, [PROMPT]), []);
  assert.deepEqual(regelKundeVerborgen(gesendet, identitaet), []);
  assert.deepEqual(regelKundeVerborgen(gesendet, sitzung.publicKey()), []);
  assert.deepEqual(regelPTagsNur(gesendet, [knoten]), []);
  assert.deepEqual(regelKeinBolt11(gesendet), []);
  assert.deepEqual(regelKeineZahlungsdaten(gesendet), []);
  // Der Pfad der App baut genau so: Nachweis nur für den eigenen Knoten, ohne Gebot, Anteile und Kanal
  const agent = readFileSync(new URL("../../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const bau = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("/** Abbruch-Signal"));
  assert.match(bau, /const eigen = kopplungFuer\(targetPubkey\);/);
  assert.match(bau, /const hoechst = eigen \? 0 : hoechstMsat\(bid, selectedTools\);/);
  assert.match(bau, /const kanal = eigen \? undefined : await kanalGutschrift\(targetPubkey, hoechst\);/);
  assert.match(bau, /extraTags\.push\(\.\.\.\(eigen \? \[\] : kanal \? kanal\.tags : deklaration\(empfaenger\)\)\);/);
  assert.match(bau, /const useSession = !eigen && !kanal && sc\.activeFor\(targetPubkey\);/);
  assert.match(bau, /bidMsat: eigen \? 0 : bid \* 1000,/);
  assert.match(bau, /request: eigen \? mitBesitzerNachweis\(request, eigen\) : request, sessionSigner: sitzung,/, "vor dem Versiegeln, im Kern");
});
