/**
 * Leak-Szenario „Raum-Nachricht“ (Schritt 1.5, seit 2.3b): Private Räume –
 * der Standard – senden wie `sendePrivat()` (`shell/raum-mls.ts`) über MLS:
 * Relays sehen nur Kind 445 und Einladungen im Umschlag, keinen Namen, keinen
 * Kanal, keinen Text. Offene Räume (nur ausdrücklich) und Communities (Kind
 * 42) bleiben öffentlich – so, wie `sendeRaumNachricht()` und der
 * Community-Zweig von `sendChatMessage()` in `tabs/kommunikation.ts` senden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  LocalSigner, buildChannelMessage, buildEvent, fromHex, generateKeypair, raumDefinition, raumNachricht, regelKeinKind4, regelKeinKlartext,
  regelMlsGruppe, toHex,
} from "@freedomstack/protocol";
import { Mls, ladeMls } from "@freedomstack/mls";
import { aufzeichnung } from "./aufzeichnung.js";

const TEXT = "Das Treffen im Raum ist verschoben";
const NAME = "Werkstatt am Fluss";
const KANAL = "geheimplanung";

async function sendeOffen() {
  const { pool, relay } = aufzeichnung();
  const signer = new LocalSigner(generateKeypair().sk);
  const pk = signer.publicKey();
  await pool.publish(await signer.signEvent(buildChannelMessage({
    authorPubkey: pk, spaceId: "raum-1", channelId: "kanal-1", content: TEXT, mentions: [],
  } as never)));
  await pool.publish(await signer.signEvent(buildEvent(pk, 42, [["h", "gruppe-1"]], TEXT)));
  return relay.gesendet;
}

ladeMls(gunzipSync(readFileSync(new URL("../../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));
const person = () => {
  const kp = generateKeypair();
  return { pk: kp.pk, signer: new LocalSigner(kp.sk), mls: new Mls(new LocalSigner(kp.sk), (id) => toHex(schnorr.sign(fromHex(id), kp.sk))) };
};

/** Wie ein privater Raum entsteht und schreibt: Gruppe, Kanäle, Einladung, Nachricht – alles über den Pool. */
async function sendePrivat() {
  const { pool, relay } = aufzeichnung();
  const [a, b] = [person(), person()];
  const kpB = await b.signer.signEvent(await b.mls.keyPackage("ab".repeat(32)));
  const g = await a.mls.gruppeAnlegen(NAME, [kpB], ["wss://gruppe.test"]);
  const def = raumDefinition(g.gruppe, { name: NAME, kanaele: [{ id: KANAL, name: KANAL, privacy: "verschluesselt", writeRoles: [], position: 0 }] });
  const msg = raumNachricht({ kanal: KANAL, text: TEXT, erwaehnt: [b.pk] });
  for (const w of g.einladungen) await pool.publish(w);
  for (const s of [def, msg]) for (const ev of (await a.mls.sendenEvent(g.gruppe, s.art, s.tags, s.text)).events) await pool.publish(ev);
  return { gesendet: relay.gesendet, gruppe: g.gruppe, a, b };
}

test("Offener Raum und Community: gehen über den Pool, kein Kind 4 – öffentlich, nur ausdrücklich", async () => {
  const gesendet = await sendeOffen();
  assert.equal(gesendet.length, 2);
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Privater Raum (2.3b): kein Klartext – weder Text noch Name noch Kanal; nur Kind 445 und Umschläge", async () => {
  const { gesendet, gruppe, a, b } = await sendePrivat();
  assert.deepEqual([...new Set(gesendet.map((e) => e.kind))].sort((x, y) => x - y), [445, 1059]);
  assert.deepEqual(regelKeinKlartext(gesendet, [TEXT, NAME, KANAL]), []);
  assert.deepEqual(regelMlsGruppe(gesendet, { gruppenIds: [gruppe], identitaeten: [a.pk, b.pk] }), []);
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Verdrahtung: private Räume sind der Standard und senden über MLS; offene wie das Szenario", () => {
  const kom = readFileSync(new URL("../../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  // Der Raum-Teil steht seit C.2a wörtlich in raeume.ts; Communities bleiben in kommunikation.ts
  const raeume = readFileSync(new URL("../../src/shell/tabs/raeume.ts", import.meta.url), "utf8");
  const raum = readFileSync(new URL("../../src/shell/raum-mls.ts", import.meta.url), "utf8");
  // Seit C.2c mit Bezug (Thread, Antwort auf) – weiter nur über MLS
  assert.match(raum, /return mlsSendeEvent\(gruppe, raumNachricht\(\{ kanal, text, \.\.\.bezug \}\)\);/);
  assert.match(raeume, /if \(spacesUi\.privat\) \{\s*\/\/ Privat \(2\.3b\)[^\n]*\n\s*if \(await sendePrivat\(spacesUi\.privat\.gruppe, spacesUi\.channelId, text, bezug\)/);
  assert.match(raeume, /async function legeRaumAn\(oeffentlich = false\)/);
  assert.match(raeume, /create\.onclick = \(\) => void legeRaumAn\(\);/, "der Knopf „Raum anlegen“ legt privat an");
  // Seit C.2b1 steht der Hinweis im Dialog, in dem der Name eingegeben wird – ohne Name wird nichts angelegt
  assert.match(raeume, /text: t\(oeffentlich \? "komm\.oeffentlichWarnung" : "komm\.privatTitel"\),/);
  assert.match(raeume, /if \(!name\.trim\(\)\) return;/);
  // Offene Räume und Communities wie im Szenario oben
  // Seit B-7 ist spacesUi.spaceId offen die Adresse – das Tag trägt die Kennung (offeneKennung())
  assert.match(raeume, /signiere\(buildChannelMessage\(\{\s*authorPubkey: state\.keypair\.pk, spaceId: offeneKennung\(\)!,\s*channelId: spacesUi\.channelId, content: text,/);
  assert.match(kom, /signiere\(buildEvent\(state\.keypair\.pk, 42, \[\["h", c\.id\], \.\.\.imeta\], text\)\)/);
  // Private Räume moderieren nie mit öffentlichen Sperr-Events; Meldungen nur versiegelt (8.5)
  assert.match(raeume, /const modKnopf = darfModerieren && !spacesUi\.privat && /);
  assert.match(raum, /const wraps = await baueRaumMeldung\(/);
});
