/**
 * FileRelay + Mesh Tests: USB-Stick-Transport, Kurier-Belohnung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair, signEvent, buildEvent,
  FileRelay, memStorage, OutboxPool,
  buildMeshPacket, parseMeshPacket,
  buildDeliveryReceipt, parseDeliveryReceipt, receiptMatchesPacket,
  KIND_MESH_PACKET, KIND_DELIVERY_RECEIPT,
} from "../src/index.js";

test("FileRelay: publish+query roundtrip (USB-Stick-Simulation)", async () => {
  const kp = generateKeypair();
  const storage = memStorage();
  const relay = new FileRelay(storage, "file://usb");
  const ev = signEvent(buildEvent(kp.pk, 1, [], "hallo mesh"), kp.sk);
  await relay.publish(ev);

  // Simuliere: Datei auf anderem Geraet (neuer Relay, gleicher Inhalt)
  const relay2 = new FileRelay(memStorage({ ...storage.files }), "file://usb-anders");
  const found = await relay2.query({ kinds: [1] });
  assert.equal(found.length, 1);
  assert.equal(found[0].content, "hallo mesh");
  assert.equal(found[0].id, ev.id, "Signatur verifiziert, gleiche ID");
});

test("FileRelay: ungueltige Signatur wird verworfen", async () => {
  const kp = generateKeypair();
  const storage = memStorage();
  const relay = new FileRelay(storage);
  const ev = signEvent(buildEvent(kp.pk, 1, [], "echt"), kp.sk);
  await relay.publish(ev);
  // Gefaelschtes Event (falsche sig)
  const fake = { ...ev, id: "f".repeat(64), content: "fake" };
  await storage.write("fake.json", JSON.stringify(fake));
  const found = await relay.query({ kinds: [1] });
  assert.equal(found.length, 1, "nur das echte Event");
  assert.equal(found[0].content, "echt");
});

test("FileRelay: Tag-Filter funktioniert", async () => {
  const kp = generateKeypair();
  const storage = memStorage();
  const relay = new FileRelay(storage);
  await relay.publish(signEvent(buildEvent(kp.pk, 42, [["h", "comm-1"]], "in comm1"), kp.sk));
  await relay.publish(signEvent(buildEvent(kp.pk, 42, [["h", "comm-2"]], "in comm2"), kp.sk));
  const found = await relay.query({ kinds: [42], "#h": ["comm-1"] });
  assert.equal(found.length, 1);
  assert.equal(found[0].content, "in comm1");
});

test("Mesh: Paket + Receipt roundtrip + Konsistenz", () => {
  const sender = generateKeypair();
  const recipient = generateKeypair();
  const courier = generateKeypair();
  const now = Math.floor(Date.now() / 1000);

  const packet = parseMeshPacket(signEvent(buildMeshPacket({
    packetId: "pkt-1", recipientPubkey: recipient.pk,
    rewardMsat: 5000, rewardSwapId: "swap-1",
    payload: "encrypted-payload", expiryUnix: now + 3600,
  }, sender.pk), sender.sk));
  assert.equal(packet.packetId, "pkt-1");
  assert.equal(packet.rewardMsat, 5000);

  const receipt = parseDeliveryReceipt(signEvent(buildDeliveryReceipt({
    packetId: "pkt-1", courierPubkey: courier.pk, preimageHex: "ab".repeat(32),
  }, recipient.pk), recipient.sk));
  assert.equal(receipt.courierPubkey, courier.pk);

  assert.ok(receiptMatchesPacket(receipt, packet, now), "receipt passt");
  assert.ok(!receiptMatchesPacket(receipt, packet, now + 7200), "abgelaufen -> false");
  assert.ok(!receiptMatchesPacket({ ...receipt, packetId: "anderes" }, packet, now), "falsche id -> false");
});
