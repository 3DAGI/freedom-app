/**
 * Tests fuer die Relay-Rolle.
 *
 * Sie ist der Teil, der das Netz selbsttragend macht — ein Provider, der auch
 * Relay ist, haengt nicht mehr an fremden Servern. Getestet wird gegen einen
 * echten WebSocket auf einem echten Port: Ein Relay, das nur im Testdouble
 * funktioniert, traegt nichts bei.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "@freedomstack/protocol";
import { RelayRole } from "../src/relay-role.js";

const KP = generateKeypair();
let portZaehler = 17_400;

async function mitRelay<T>(fn: (url: string, r: RelayRole) => Promise<T>): Promise<T> {
  const port = portZaehler++;
  const r = new RelayRole({ port, retentionDays: 7, maxEventBytes: 64_000 });
  await r.start();
  try {
    return await fn(`ws://127.0.0.1:${port}`, r);
  } finally {
    r.stop();
  }
}

/** Minimaler Client: verbinden, senden, auf Antwort warten. */
function sprich(url: string, nachrichten: unknown[], erwarte = 1, timeoutMs = 4000): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const antworten: unknown[][] = [];
    const timer = setTimeout(() => { ws.close(); resolve(antworten); }, timeoutMs);
    ws.on("open", () => { for (const n of nachrichten) ws.send(JSON.stringify(n)); });
    ws.on("message", (raw) => {
      antworten.push(JSON.parse(String(raw)) as unknown[]);
      if (antworten.length >= erwarte) {
        clearTimeout(timer);
        ws.close();
        resolve(antworten);
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const ev = (content = "hallo", kind = 1): NostrEvent =>
  signEvent(buildEvent(KP.pk, kind, [], content), KP.sk);

test("Relay nimmt ein gueltiges Event an", async () => {
  await mitRelay(async (url) => {
    const a = await sprich(url, [["EVENT", ev()]]);
    assert.equal(a[0][0], "OK");
    assert.equal(a[0][2], true, JSON.stringify(a[0]));
  });
});

test("Relay liefert gespeicherte Events auf Anfrage", async () => {
  await mitRelay(async (url, r) => {
    const e = ev("gespeichert");
    await sprich(url, [["EVENT", e]]);
    // Zwei Antworten: das Event selbst und EOSE.
    const a = await sprich(url, [["REQ", "s1", { kinds: [1] }]], 2);
    assert.equal(a[0][0], "EVENT");
    assert.equal((a[0][2] as NostrEvent).content, "gespeichert");
    assert.equal(a[1][0], "EOSE");
    assert.ok(r.stats().events >= 1);
  });
});

test("Event mit kaputter Signatur wird abgelehnt", async () => {
  // Ohne diese Pruefung koennte jeder beliebige Events unter fremdem Namen
  // ablegen — ein Relay, das das zulaesst, ist wertlos.
  await mitRelay(async (url) => {
    const e = ev();
    const gefaelscht = { ...e, content: "nachtraeglich geaendert" };
    const a = await sprich(url, [["EVENT", gefaelscht]]);
    assert.equal(a[0][0], "OK");
    assert.equal(a[0][2], false, "manipuliertes Event darf nicht angenommen werden");
  });
});

test("Muell bringt das Relay nicht zum Absturz", async () => {
  await mitRelay(async (url) => {
    await sprich(url, [["UNSINN"], ["EVENT"], ["REQ"], "kein array"], 0, 800);
    // Danach muss es weiter funktionieren.
    const a = await sprich(url, [["EVENT", ev("danach")]]);
    assert.equal(a[0][2], true);
  });
});

test("Zu grosse Events werden abgelehnt", async () => {
  // Sonst fuellt ein Einzelner den Speicher des Betreibers.
  await mitRelay(async (url) => {
    const a = await sprich(url, [["EVENT", ev("x".repeat(100_000))]]);
    assert.equal(a[0][2], false);
  });
});

test("Filter greifen: fremde Kinds kommen nicht zurueck", async () => {
  await mitRelay(async (url) => {
    await sprich(url, [["EVENT", ev("text", 1)], ["EVENT", ev("anderes", 30_078)]], 2);
    const a = await sprich(url, [["REQ", "s1", { kinds: [30078] }]], 2);
    const events = a.filter((x) => x[0] === "EVENT");
    assert.equal(events.length, 1);
    assert.equal((events[0][2] as NostrEvent).kind, 30_078);
  });
});

test("CLOSE beendet ein Abo", async () => {
  await mitRelay(async (url, r) => {
    await sprich(url, [["REQ", "s1", { kinds: [1] }], ["CLOSE", "s1"]], 1, 800);
    // Nach dem Schliessen darf keine Subscription haengenbleiben.
    await new Promise((res) => setTimeout(res, 200));
    assert.equal(r.stats().subscriptions, 0);
  });
});

test("Getrennte Verbindung raeumt ihre Abos auf", async () => {
  // Sonst waechst die Liste mit jeder Verbindung, bis der Knoten steht.
  await mitRelay(async (url, r) => {
    await sprich(url, [["REQ", "s1", { kinds: [1] }]], 1, 600);
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(r.stats().subscriptions, 0);
  });
});

test("Dasselbe Event zweimal fuehrt nicht zu zwei Kopien", async () => {
  await mitRelay(async (url, r) => {
    const e = ev("einmal");
    await sprich(url, [["EVENT", e]]);
    const vorher = r.stats().events;
    await sprich(url, [["EVENT", e]]);
    assert.equal(r.stats().events, vorher);
  });
});
