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
