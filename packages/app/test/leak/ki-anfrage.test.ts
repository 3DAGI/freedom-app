/**
 * Leak-Szenario „KI-Anfrage“ (Schritt 1.5, seit 3.1 privat): die Anfrage vom
 * Sitzungsschluessel aus `KiSitzungen`, so gebaut wie `buildJobEvent()` in
 * `tabs/agent.ts` – mit Gebot – und im Umschlag an den Provider; seit 5.1.3 mit
 * der Deklaration der Anteile im Kern. Sitzung (38021) und Belege (38022), seit
 * 3.2e versiegelt, gibt es seit RM2c3 nicht mehr: bezahlt wird mit dem echten
 * `SessionClient` nur über die Lightning-Rechnung des Providers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, aufteilungTag, buildJobRequest, buildPrivateJobRequest, generateKeypair,
  regelKeinBolt11, regelKeinKind4, regelKeinKlartextPrompt, regelKeineZahlungsdaten, regelKundeVerborgen,
} from "@freedomstack/protocol";
import { Keypair } from "@solana/web3.js";
import { kanalAdresse, neuerSitzungsSchluessel, signEvent, toHex } from "@freedomstack/protocol";
import { KiSitzungen } from "../../src/ki-sitzung.js";
import { KanalBuch } from "../../src/zahlkanal.js";
import { SessionClient } from "../../src/session-client.js";
import { aufzeichnung } from "./aufzeichnung.js";

const PROMPT = "Fasse meinen Arztbrief vom Maerz zusammen";
const WERBER = "werberin@wallet.example";

async function frage() {
  const { pool, relay } = aufzeichnung();
  const identitaet = new LocalSigner(generateKeypair().sk);
  const sitzungen = new KiSitzungen();
  const provider = generateKeypair().pk;
  const sitzung = sitzungen.fuer(provider);
  // Mit Gebot – seit RM2c3 jede Anfrage, auch die zweite an denselben Provider
  const [erste, zweite] = [21_000, 34_000].map((bidMsat) => buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat, providerPubkey: provider, params: [["tier", "standard"]],
    extraTags: [aufteilungTag(["werber-provider"])],
  }));
  for (const request of [erste, zweite]) {
    const { wrap } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: provider, powBits: 8 });
    await pool.publish(wrap);
  }
  return { gesendet: relay.gesendet, identitaet: identitaet.publicKey(), sitzung: sitzung.publicKey() };
}

test("KI-Anfrage: zwei Anfragen gehen nur als Umschlaege ueber den Pool – keine Sitzung davor (RM2c3)", async () => {
  const { gesendet } = await frage();
  assert.deepEqual(gesendet.map((e) => e.kind), [1059, 1059]);
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
  // Auch der Sitzungsschluessel zeigt sich nirgends (3.2e).
  assert.deepEqual(regelKundeVerborgen(gesendet, sitzung), []);
});

test("KI-Anfrage: keine Zahlungsdaten offen (Gebot, Deklaration)", async () => {
  const { gesendet } = await frage();
  assert.deepEqual(regelKeineZahlungsdaten(gesendet), []);
  assert.ok(gesendet.every((e) => !JSON.stringify(e).includes("21000") && !JSON.stringify(e).includes("34000")), "kein Gebot offen");
});

test("KI-Anfrage: die Deklaration der Anteile (5.1.3) steht nur im versiegelten Kern", async () => {
  const { gesendet } = await frage();
  assert.ok(gesendet.every((e) => !JSON.stringify(e).includes("aufteilung") && !JSON.stringify(e).includes("werber-provider")));
});

test("KI-Anfrage: bezahlen (5.1.3) schickt nichts über den Pool – seit RM2c3 keine Belege, Preimage und Rechnung nie offen", async () => {
  const { pool, relay } = aufzeichnung();
  const sitzungen = new KiSitzungen();
  const provider = generateKeypair().pk;
  const sc = new SessionClient({ signerFuer: (pk) => sitzungen.fuer(pk) });
  const preimage = "ab".repeat(32);
  const r = await sc.chargeForResult(provider, 25_000, {
    rechnung: async () => `lnbc250n1${WERBER}`, zahle: async () => preimage,
  });
  assert.equal(r.settled, true);
  // Die Anfrage davor ging über denselben Pool – danach kommt nichts dazu
  const { wrap } = await buildPrivateJobRequest({
    request: buildJobRequest({ customerPubkey: sitzungen.fuer(provider).publicKey(), input: PROMPT, bidMsat: 25_000, providerPubkey: provider }),
    sessionSigner: sitzungen.fuer(provider), providerPk: provider, powBits: 8,
  });
  await pool.publish(wrap);
  assert.deepEqual(relay.gesendet.map((e) => e.kind), [1059], "nur die Anfrage");
  assert.deepEqual(regelKeineZahlungsdaten(relay.gesendet), []);
  assert.ok(relay.gesendet.every((e) => !JSON.stringify(e).includes(preimage) && !JSON.stringify(e).includes("lnbc")));
});

test("KI-Anfrage mit Zahlkanal (4.3d): die Gutschrift steht nur im versiegelten Kern – offen erkennt die Regel sie", async () => {
  const { pool, relay } = aufzeichnung();
  const sitzungen = new KiSitzungen();
  const provider = generateKeypair().pk;
  const sitzung = sitzungen.fuer(provider);
  const kunde = Keypair.generate().publicKey.toBase58();
  const providerSol = Keypair.generate().publicKey.toBase58();
  const kanal = kanalAdresse(kunde, providerSol, 7n).adresse;
  const m = new Map<string, string>();
  const buch = new KanalBuch({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } });
  const jetzt = Math.floor(Date.now() / 1000);
  await buch.merke({
    kanal, provider, providerSol, kunde, nonce: "7", ablauf: jetzt + 86_400, eingezahlt: "1000000", empfaenger: [],
    sitzung: toHex(neuerSitzungsSchluessel().geheim), letzte: "0", abgerechnet: "0", offen: [],
  });
  const wahl = buch.gutschriftFuer({ provider, bedarf: 21_000n, jetzt });
  assert.equal(wahl.art, "kanal");
  const tags = wahl.art === "kanal" ? wahl.tags : [];
  // Wie buildJobEvent(): Gutschrift statt Deklaration in den Zusatz-Tags, dann versiegelt
  const request = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 21_000, providerPubkey: provider, params: [["tier", "standard"]], extraTags: tags,
  });
  await pool.publish((await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: provider, powBits: 8 })).wrap);
  assert.deepEqual(relay.gesendet.map((e) => e.kind), [1059]);
  assert.deepEqual(regelKeineZahlungsdaten(relay.gesendet), []);
  const signatur = tags.find((t) => t[0] === "gutschrift")![3]!;
  assert.ok(relay.gesendet.every((e) => !JSON.stringify(e).includes(kanal) && !JSON.stringify(e).includes(signatur)), "weder Kanal noch Signatur offen");
  // Gegenprobe: dieselbe Anfrage offen signiert – die Regel meldet die Gutschrift
  const offen = signEvent(request, generateKeypair().sk);
  assert.match(regelKeineZahlungsdaten([offen])[0]!.detail, /gutschrift/);
});

test("Verdrahtung: buildJobEvent() baut die Anfrage wie das Szenario", () => {
  const agent = readFileSync(new URL("../../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const f = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("/** Abbruch-Signal für den laufenden AI-Job"));
  assert.match(f, /const sitzung = kiSitzungen\.fuer\(targetPubkey\);/);
  // Seit RM2c3 kein zweiter Weg mehr über eine Sitzung
  assert.doesNotMatch(f, /buildEvent\(|jobTags|activeFor/);
  assert.match(f, /buildJobRequest\(\{\s*customerPubkey: sitzung\.publicKey\(\),\s*input: fullPrompt,/);
  // Seit B-8c: an den eigenen Knoten mit dem Nachweis im Kern (Szenario in leak/mein-knoten.test.ts)
  assert.match(f, /const auftrag = await buildPrivateJobRequest\(\{\s*request: eigen \? mitBesitzerNachweis\(request, eigen\) : request, sessionSigner: sitzung, providerPk: targetPubkey,/);
  // Deklaration bzw. Gutschrift des Zahlkanals (4.3d) kommen vor dem Versiegeln in den Kern, nie danach
  assert.match(f, /extraTags\.push\(\.\.\.\(eigen \? \[\] : kanal \? kanal\.tags : \[\.\.\.deklaration\(empfaenger\), \.\.\.\(pfand\?\.tags \?\? \[\]\)\]\)\);[\s\S]*\.\.\.extraTags,[\s\S]*const auftrag = await buildPrivateJobRequest/);
  assert.doesNotMatch(agent, /customerPubkey: state\.keypair\.pk/);
  // Gesendet wird nur der Umschlag
  assert.doesNotMatch(agent, /await buildJobEvent\([^)]*\);\s*await pool\.publish\(ev\)/);
  const st = readFileSync(new URL("../../src/shell/state.ts", import.meta.url), "utf8");
  assert.match(st, /signerFuer: \(providerPk\) => kiSitzungen\.fuer\(providerPk\)/);
});
