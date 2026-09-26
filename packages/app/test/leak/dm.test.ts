/**
 * Leak-Szenario „DM senden“ (Schritt 1.5): so, wie `sendChatMessage()` in
 * `tabs/kommunikation.ts` sendet – NIP-17 ueber den Signer, Umschlag an den
 * Empfaenger und die Kopie an sich selbst. Dass die App genau diesen Weg nimmt,
 * prueft `dm-verdrahtung.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalSigner, buildPrivateDm, generateKeypair,
  regelAutorNicht, regelKeinBolt11, regelKeinKind4, regelKeinKlartext, regelPTagsNur,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

const GEHEIM = "Treffpunkt morgen 7 Uhr am Hafen";

async function sende() {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk);
  const partner = generateKeypair().pk;
  const dm = await buildPrivateDm({ signer: ich, recipientPk: partner, content: GEHEIM });
  await pool.publish(dm.toRecipient);
  await pool.publish(dm.toSelf);
  return { gesendet: relay.gesendet, ich: ich.publicKey(), partner };
}

test("DM: kein Kind 4", async () => {
  const { gesendet } = await sende();
  assert.equal(gesendet.length, 2);
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("DM: kein Klartext", async () => {
  const { gesendet } = await sende();
  assert.deepEqual(regelKeinKlartext(gesendet, [GEHEIM]), []);
});

test("DM: Absender ist nicht Autor", async () => {
  const { gesendet, ich } = await sende();
  assert.deepEqual(regelAutorNicht(gesendet, ich), []);
});

test("DM: p-Tags nur an Empfaenger und eigene Kopie", async () => {
  const { gesendet, ich, partner } = await sende();
  assert.deepEqual(regelPTagsNur(gesendet, [partner, ich]), []);
});

test("DM: keine Rechnung", async () => {
  const { gesendet } = await sende();
  assert.deepEqual(regelKeinBolt11(gesendet), []);
});

test("DM an Personen mit Geraeten (8.6b): je Geraet ein Umschlag – ohne Klartext, Absender verborgen, p nur Personen und ihre Geraete", async () => {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk);
  const [meinHandy, partner, seinTablet] = [generateKeypair().pk, generateKeypair().pk, generateKeypair().pk];
  const dm = await buildPrivateDm({ signer: ich, recipientPk: partner, content: GEHEIM, weitereEmpfaenger: [seinTablet, meinHandy] });
  for (const w of [dm.toRecipient, dm.toSelf, ...dm.weitere.map((k) => k.wrap)]) await pool.publish(w);
  assert.equal(relay.gesendet.length, 4);
  assert.deepEqual(regelKeinKind4(relay.gesendet), []);
  assert.deepEqual(regelKeinKlartext(relay.gesendet, [GEHEIM]), []);
  assert.deepEqual(regelAutorNicht(relay.gesendet, ich.publicKey()), []);
  assert.deepEqual(regelPTagsNur(relay.gesendet, [partner, ich.publicKey(), seinTablet, meinHandy]), []);
  // Jeder Umschlag nennt genau einen Empfaenger – kein Relay sieht, welche Schluessel zusammengehoeren
  assert.ok(relay.gesendet.every((ev) => ev.tags.filter((t) => t[0] === "p").length === 1));
});
