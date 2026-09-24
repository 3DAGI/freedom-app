/**
 * Leak-Szenario „Raum-Nachricht“ (Schritt 1.5): so, wie `sendeRaumNachricht()`
 * (Kanal eines Raums) und der Community-Zweig von `sendChatMessage()` (Kind 42)
 * in `tabs/kommunikation.ts` senden. Heute im Klartext – Schritt 2.3 macht
 * Raeume zu verschluesselten Gruppen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, buildChannelMessage, buildEvent, generateKeypair, regelKeinKind4, regelKeinKlartext,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

const TEXT = "Das Treffen im Raum ist verschoben";

async function sende() {
  const { pool, relay } = aufzeichnung();
  const signer = new LocalSigner(generateKeypair().sk);
  const pk = signer.publicKey();
  await pool.publish(await signer.signEvent(buildChannelMessage({
    authorPubkey: pk, spaceId: "raum-1", channelId: "kanal-1", content: TEXT, mentions: [],
  } as never)));
  await pool.publish(await signer.signEvent(buildEvent(pk, 42, [["h", "gruppe-1"]], TEXT)));
  return relay.gesendet;
}

test("Raum: Nachrichten gehen ueber den Pool, kein Kind 4", async () => {
  const gesendet = await sende();
  assert.equal(gesendet.length, 2);
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Raum: kein Klartext", { todo: "Schritt 2.3" }, async () => {
  assert.deepEqual(regelKeinKlartext(await sende(), [TEXT]), []);
});

test("Verdrahtung: Raum-Kanal und Community-Chat senden wie das Szenario", () => {
  const kom = readFileSync(new URL("../../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  assert.match(kom, /signiere\(buildChannelMessage\(\{\s*authorPubkey: state\.keypair\.pk, spaceId: spacesUi\.spaceId,\s*channelId: spacesUi\.channelId, content: text,/);
  assert.match(kom, /signiere\(buildEvent\(state\.keypair\.pk, 42, \[\["h", c\.id\], \.\.\.imeta\], text\)\)/);
});
