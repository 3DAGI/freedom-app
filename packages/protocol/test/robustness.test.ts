/**
 * Tests fuer die Robustheitsschicht: lauter Publish-Fehlschlag, Dauer-Abos
 * und Wiederverbindung.
 *
 * Alle drei Themen haben gemeinsam, dass ihr Fehlerfall wie Normalbetrieb
 * aussieht: ein Event, das nirgends ankam; ein Abo, das nach einem
 * Verbindungsabriss stumm bleibt. Genau deshalb brauchen sie Tests — von
 * allein faellt so etwas erst auf, wenn jemand auf ein Ergebnis wartet, das
 * nie kommt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutboxPool,
  MemoryRelay,
  PublishError,
  generateKeypair,
  signEvent,
  buildEvent,
  PublishReport,
  NostrEvent,
} from "../src/index.js";

function ev(kind = 1, content = "x"): NostrEvent {
  const kp = generateKeypair();
  return signEvent(buildEvent(kp.pk, kind, [], content), kp.sk);
}

// ------------------------------------------------- Publish-Fehlschlag

test("Publish: vollstaendiger Fehlschlag wirft statt still zu bleiben", async () => {
  // Genau dieser Fall verschwand vorher spurlos: publish() gab ok:false
  // zurueck, und kein einziger Aufrufer hat das geprueft.
  const relay = new MemoryRelay("mem://a");
  relay.setOffline(true);
  const pool = new OutboxPool([relay], { minAcks: 1 });

  await assert.rejects(() => pool.publish(ev()), PublishError);
});

test("Publish: der Fehler traegt den Bericht mit", async () => {
  const relay = new MemoryRelay("mem://a");
  relay.setOffline(true);
  const pool = new OutboxPool([relay], { minAcks: 1 });

  try {
    await pool.publish(ev());
    assert.fail("haette werfen muessen");
  } catch (e) {
    assert.ok(e instanceof PublishError);
    // Ein Aufrufer soll entscheiden koennen, ohne den Text zu parsen.
    assert.equal(e.report.accepted.length, 0);
    assert.equal(e.report.rejected.length, 1);
    assert.equal(e.report.rejected[0].url, "mem://a");
  }
});

test("Publish: Teilerfolg wirft NICHT, meldet aber", async () => {
  // Das Event ist draussen, nur duenner verteilt als gewuenscht. Abbrechen
  // waere hier falsch — die Nachricht ist ja zugestellt.
  const gut = new MemoryRelay("mem://gut");
  const schlecht = new MemoryRelay("mem://schlecht");
  schlecht.setOffline(true);

  const berichte: PublishReport[] = [];
  const pool = new OutboxPool([gut, schlecht], {
    minAcks: 2,
    onPublishFailure: (r) => berichte.push(r),
  });

  const r = await pool.publish(ev());
  assert.equal(r.ok, false, "minAcks nicht erreicht");
  assert.equal(r.accepted.length, 1, "aber zugestellt");
  assert.equal(berichte.length, 1, "und gemeldet");
});

test("Publish: Erfolg meldet nichts", async () => {
  const berichte: PublishReport[] = [];
  const pool = new OutboxPool([new MemoryRelay("mem://a"), new MemoryRelay("mem://b")], {
    minAcks: 2,
    onPublishFailure: (r) => berichte.push(r),
  });
  const r = await pool.publish(ev());
  assert.equal(r.ok, true);
  assert.equal(berichte.length, 0, "kein Rauschen im Normalfall");
});

test("Publish: throwOnTotalFailure=false nur mit eigener Auswertung", async () => {
  const relay = new MemoryRelay("mem://a");
  relay.setOffline(true);
  let gemeldet = false;
  const pool = new OutboxPool([relay], {
    minAcks: 1,
    throwOnTotalFailure: false,
    onPublishFailure: () => { gemeldet = true; },
  });

  const r = await pool.publish(ev());
  assert.equal(r.ok, false);
  assert.equal(gemeldet, true, "wer nicht wirft, muss wenigstens melden");
});

test("Publish: Zensur eines Kinds faellt auf", async () => {
  const zensor = new MemoryRelay("mem://zensor", [1]);
  const pool = new OutboxPool([zensor], { minAcks: 1 });
  await assert.rejects(() => pool.publish(ev(1)), /kind 1/);
  // Andere Kinds gehen weiterhin durch.
  await assert.doesNotReject(() => pool.publish(ev(30078)));
});

// ------------------------------------------------------------- limit

test("MemoryRelay: limit wird beachtet (wie bei echten Relays)", async () => {
  // Wurde vorher ignoriert. Damit verhielt sich der Testdouble anders als das
  // Netz — Tests konnten gruen sein, obwohl derselbe Code live eine gekuerzte
  // Antwort bekommen haette.
  const relay = new MemoryRelay("mem://a");
  for (let i = 0; i < 10; i++) await relay.publish(ev(1, `n${i}`));

  assert.equal((await relay.query({ kinds: [1], limit: 3 })).length, 3);
  assert.equal((await relay.query({ kinds: [1] })).length, 10, "ohne limit alles");
});

test("MemoryRelay: limit liefert die NEUESTEN Events", async () => {
  const relay = new MemoryRelay("mem://a");
  const kp = generateKeypair();
  for (let i = 0; i < 5; i++) {
    await relay.publish(signEvent(buildEvent(kp.pk, 1, [], `n${i}`, 1000 + i), kp.sk));
  }
  const neueste = await relay.query({ kinds: [1], limit: 2 });
  // Ein Relay, das die aeltesten zurueckgibt, waere fuer einen Feed nutzlos.
  assert.deepEqual(neueste.map((e) => e.content), ["n4", "n3"]);
});

// ------------------------------------------- Dauer-Abos (simuliertes WS)

/**
 * Minimaler WebSocket-Ersatz.
 *
 * Damit lassen sich Verbindungsabriss und Wiederverbindung pruefen — mit
 * einem echten Relay waere genau das nicht reproduzierbar.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.onclose?.(); }

  /** Ein Event vom Relay simulieren. */
  emit(subId: string, event: NostrEvent): void {
    this.onmessage?.({ data: JSON.stringify(["EVENT", subId, event]) });
  }
  eose(subId: string): void {
    this.onmessage?.({ data: JSON.stringify(["EOSE", subId]) });
  }
  /** Abriss ohne Zutun des Nutzers. */
  drop(): void { this.readyState = 3; this.onclose?.(); }

  get reqs(): { subId: string }[] {
    return this.sent
      .map((s) => JSON.parse(s) as unknown[])
      .filter((m) => m[0] === "REQ")
      .map((m) => ({ subId: m[1] as string }));
  }
}

async function withFakeWs<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { WebSocket?: unknown };
  const orig = g.WebSocket;
  FakeSocket.instances = [];
  g.WebSocket = FakeSocket;
  try {
    return await fn();
  } finally {
    if (orig) g.WebSocket = orig; else delete g.WebSocket;
  }
}

test("Abo: Events kommen sofort an, ohne auf EOSE zu warten", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test");
    const empfangen: NostrEvent[] = [];

    const stop = await relay.subscribe({ kinds: [1] }, (e) => empfangen.push(e));
    const sock = FakeSocket.instances[0];
    const subId = sock.reqs[0].subId;

    // Genau das war mit Polling nicht moeglich: bis zu 15 s Verzoegerung.
    sock.emit(subId, ev(1, "sofort"));
    assert.equal(empfangen.length, 1);
    assert.equal(empfangen[0].content, "sofort");

    stop();
    relay.close();
  });
});

test("Abo: doppelt geliefertes Event wird nur einmal gemeldet", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test");
    const empfangen: NostrEvent[] = [];
    await relay.subscribe({ kinds: [1] }, (e) => empfangen.push(e));

    const sock = FakeSocket.instances[0];
    const subId = sock.reqs[0].subId;
    const e = ev(1, "doppelt");
    sock.emit(subId, e);
    sock.emit(subId, e);

    assert.equal(empfangen.length, 1, "Relays liefern gelegentlich doppelt");
    relay.close();
  });
});

test("Abo: Fehler im Handler reisst die Verbindung nicht mit", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test");
    let zweiterKam = false;

    await relay.subscribe({ kinds: [1] }, (e) => {
      if (e.content === "boom") throw new Error("Handler kaputt");
      zweiterKam = true;
    });
    const sock = FakeSocket.instances[0];
    const subId = sock.reqs[0].subId;

    sock.emit(subId, ev(1, "boom"));
    sock.emit(subId, ev(1, "danach"));
    assert.equal(zweiterKam, true, "ein kaputter Handler darf das Abo nicht toeten");
    relay.close();
  });
});

test("Abo: stop() meldet ab und liefert nichts mehr", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test");
    const empfangen: NostrEvent[] = [];
    const stop = await relay.subscribe({ kinds: [1] }, (e) => empfangen.push(e));

    const sock = FakeSocket.instances[0];
    const subId = sock.reqs[0].subId;
    stop();
    sock.emit(subId, ev(1, "danach"));

    assert.equal(empfangen.length, 0);
    assert.ok(sock.sent.some((m) => m.includes("CLOSE")), "CLOSE muss raus");
    relay.close();
  });
});

test("Abo: EOSE-Rueckruf feuert", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test");
    let eose = false;
    await relay.subscribe({ kinds: [1] }, () => {}, () => { eose = true; });

    const sock = FakeSocket.instances[0];
    sock.eose(sock.reqs[0].subId);
    assert.equal(eose, true, "der Aufrufer soll wissen, wann der Verlauf durch ist");
    relay.close();
  });
});

test("Wiederverbindung: nach Abriss wird das Abo erneuert", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test");
    await relay.subscribe({ kinds: [1] }, () => {});
    assert.equal(FakeSocket.instances.length, 1);

    // Abriss ohne Zutun des Nutzers.
    FakeSocket.instances[0].drop();
    // Erster Backoff-Schritt ist 1 s.
    await new Promise((r) => setTimeout(r, 1300));

    assert.ok(FakeSocket.instances.length >= 2, "es muss neu verbunden werden");
    const neu = FakeSocket.instances[FakeSocket.instances.length - 1];
    // Ohne erneutes REQ waere die Verbindung zwar da, es kaeme aber nichts an
    // — der Fehlerzustand, der wie Normalbetrieb aussieht.
    assert.ok(neu.reqs.length >= 1, "Abo muss erneut angemeldet werden");
    relay.close();
  });
});

test("Wiederverbindung: close() durch den Nutzer verbindet NICHT neu", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test");
    await relay.subscribe({ kinds: [1] }, () => {});

    relay.close();
    const vorher = FakeSocket.instances.length;
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(FakeSocket.instances.length, vorher, "gewolltes Schliessen bleibt geschlossen");
  });
});

test("Wiederverbindung: laesst sich abschalten", async () => {
  await withFakeWs(async () => {
    const { WebSocketRelay } = await import("../src/ws-relay.js");
    const relay = new WebSocketRelay("wss://test", { autoReconnect: false });
    await relay.subscribe({ kinds: [1] }, () => {});

    FakeSocket.instances[0].drop();
    const vorher = FakeSocket.instances.length;
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(FakeSocket.instances.length, vorher);
    relay.close();
  });
});
