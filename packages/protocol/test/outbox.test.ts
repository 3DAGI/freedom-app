import { test } from "node:test";
import assert from "node:assert/strict";
import { OutboxPool, MemoryRelay } from "../src/outbox.js";
import { generateKeypair, buildEvent, signEvent } from "../src/event.js";

function signed(kind = 1, content = "x") {
  const kp = generateKeypair();
  return { kp, ev: signEvent(buildEvent(kp.pk, kind, [], content, 1_700_000_000), kp.sk) };
}

test("Outbox: publiziert auf alle Relays", async () => {
  const pool = new OutboxPool([new MemoryRelay("wss://a"), new MemoryRelay("wss://b"), new MemoryRelay("wss://c")]);
  const { ev } = signed();
  const rep = await pool.publish(ev);
  assert.ok(rep.ok);
  assert.equal(rep.accepted.length, 3);
  assert.equal(rep.rejected.length, 0);
});

test("Outbox: ein zensierendes Relay bricht nichts (Kernpunkt Luecke #1)", async () => {
  const censor = new MemoryRelay("wss://censor", [38001]); // lehnt LP-Angebote ab
  const pool = new OutboxPool([censor, new MemoryRelay("wss://free1"), new MemoryRelay("wss://free2")]);
  const { ev } = signed(38001, "LP-Angebot");

  const rep = await pool.publish(ev);
  assert.ok(rep.ok, "Publikation muss trotz Zensur erfolgreich sein");
  assert.equal(rep.accepted.length, 2);
  assert.equal(rep.rejected[0].url, "wss://censor");

  // Und das Event ist ueber den Pool weiterhin abrufbar:
  const found = await pool.query({ kinds: [38001] });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, ev.id);
});

test("Outbox: offline-Relay wird toleriert", async () => {
  const dead = new MemoryRelay("wss://dead");
  dead.setOffline(true);
  const pool = new OutboxPool([dead, new MemoryRelay("wss://a"), new MemoryRelay("wss://b")]);
  const { ev } = signed();
  const rep = await pool.publish(ev);
  assert.ok(rep.ok);
  assert.equal(rep.accepted.length, 2);
});

test("Outbox: scheitert ehrlich, wenn zu wenige akzeptieren", async () => {
  const pool = new OutboxPool(
    [new MemoryRelay("wss://c1", [1]), new MemoryRelay("wss://c2", [1]), new MemoryRelay("wss://ok")],
    { minAcks: 2 },
  );
  const { ev } = signed(1);
  const rep = await pool.publish(ev);
  assert.ok(!rep.ok, "nur 1 von 3 akzeptiert -> nicht ok");
  assert.equal(rep.accepted.length, 1);
});

test("Outbox: Query dedupliziert und verwirft manipulierte Events", async () => {
  const a = new MemoryRelay("wss://a");
  const b = new MemoryRelay("wss://b");
  const pool = new OutboxPool([a, b]);
  const { ev } = signed(1, "echt");
  await pool.publish(ev);

  // Boesartiges Relay schiebt ein manipuliertes Event unter (Signatur passt nicht).
  const evil = new MemoryRelay("wss://evil");
  // publish() wuerde es ablehnen; wir injizieren direkt in den Store:
  (evil as unknown as { store: unknown[] }).store = [{ ...ev, content: "gefaelscht" }];
  const pool2 = new OutboxPool([a, b, evil]);

  const found = await pool2.query({ kinds: [1] });
  assert.equal(found.length, 1, "dedupliziert + Faelschung verworfen");
  assert.equal(found[0].content, "echt");
});

test("Outbox: Verfuegbarkeits-Audit macht Vorenthalten sichtbar", async () => {
  const censor = new MemoryRelay("wss://censor", [1]);
  const pool = new OutboxPool([censor, new MemoryRelay("wss://a"), new MemoryRelay("wss://b")]);
  const { ev } = signed(1);
  await pool.publish(ev);

  const audit = await pool.auditAvailability(ev.id);
  assert.deepEqual(audit.missing, ["wss://censor"]);
  assert.equal(audit.has.length, 2);
});
