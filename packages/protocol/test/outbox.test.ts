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

test("A-15b: subscribeAn – Abo nur an den genannten Relays des Pools, geprüft und je Event einmal", async () => {
  const abos: string[] = [];
  const senden = new Map<string, (ev: ReturnType<typeof signed>["ev"]) => void>();
  const relay = (url: string) => Object.assign(new MemoryRelay(url), {
    subscribe: async (_f: unknown, on: (ev: ReturnType<typeof signed>["ev"]) => void) => {
      abos.push(url);
      senden.set(url, on);
      return () => { abos.splice(abos.indexOf(url), 1); };
    },
  });
  const pool = new OutboxPool([relay("wss://a"), relay("wss://b"), relay("wss://c")]);
  const empfangen: string[] = [];
  const stopp = await pool.subscribeAn({ kinds: [445], "#h": ["g"] }, ["wss://a", "wss://c", "wss://fremd"], (ev) => empfangen.push(ev.id));
  assert.deepEqual(abos, ["wss://a", "wss://c"], "der Filter geht an kein anderes Relay");
  const { ev } = signed(445);
  senden.get("wss://a")!(ev);
  senden.get("wss://c")!(ev);
  senden.get("wss://a")!({ ...ev, content: "manipuliert" });
  assert.deepEqual(empfangen, [ev.id], "doppelt einmal, Gefälschtes nie");
  stopp();
  assert.deepEqual(abos, []);
  // Ohne passendes Relay: kein Fehler, kein Abo
  const leer = await pool.subscribeAn({ kinds: [445] }, ["wss://fremd"], () => assert.fail("nichts"));
  leer();
  assert.deepEqual(abos, []);
  // subscribe() bleibt, wie es war: alle Relays
  const alle = await pool.subscribe({ kinds: [1] }, () => {});
  assert.deepEqual(abos.sort(), ["wss://a", "wss://b", "wss://c"]);
  alle();
});

test("A-16: queryAn – nur die genannten Relays des Pools, geprüft und je Event einmal", async () => {
  const a = new MemoryRelay("wss://a"), b = new MemoryRelay("wss://b"), c = new MemoryRelay("wss://c");
  const gefragt: string[] = [];
  for (const r of [a, b, c]) {
    const q = r.query.bind(r);
    r.query = async (f) => { gefragt.push(r.url); return q(f); };
  }
  const pool = new OutboxPool([a, b, c]);
  const { ev } = signed(445);
  await a.publish(ev);
  await c.publish(ev);
  const { ev: nurB } = signed(445);
  await b.publish(nurB);
  // Ein manipuliertes Event in einem Relay: fällt heraus
  const f = { ...signed(445).ev, content: "manipuliert" };
  (a as unknown as { store: unknown[] }).store.push(f);
  const r = await pool.queryAn({ kinds: [445] }, ["wss://a", "wss://c", "wss://fremd"]);
  assert.deepEqual(gefragt.sort(), ["wss://a", "wss://c"], "kein anderes Relay gefragt");
  assert.deepEqual(r.map((e) => e.id), [ev.id], "doppelt einmal, Gefälschtes nie, b nicht gefragt");
  assert.deepEqual(await pool.queryAn({ kinds: [445] }, ["wss://fremd"]), []);
});
