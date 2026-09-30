/**
 * Flutschutz der Relay-Rolle (B-3): Grenzen je Verbindung, je Schluessel und
 * fuer die Zahl der Verbindungen – gegen einen echten WebSocket, mit
 * gestellter Uhr fuer das Zeitfenster.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { buildEvent, generateKeypair, signEvent, type NostrEvent } from "@freedomstack/protocol";
import { FLUTSCHUTZ, RelayRole, RelayZugang, type Flutschutz } from "../src/relay-role.js";

let portZaehler = 17_900;

async function mitRelay<T>(flutschutz: Partial<Flutschutz>, fn: (url: string, r: RelayRole, uhr: { t: number }) => Promise<T>, zugang?: RelayZugang): Promise<T> {
  const port = portZaehler++;
  const uhr = { t: 1_800_000_000 };
  const r = new RelayRole({ port, retentionDays: 7, maxEventBytes: 64_000, flutschutz, jetzt: () => uhr.t, ...(zugang ? { zugang } : {}) });
  await r.start();
  try {
    return await fn(`ws://127.0.0.1:${port}`, r, uhr);
  } finally {
    r.stop();
  }
}

/** Eine offene Verbindung: senden und auf n Antworten warten (AUTH-Challenge uebersprungen). */
async function verbinde(url: string): Promise<{ sende(n: unknown[], erwarte?: number): Promise<unknown[][]>; zu(): void; ws: WebSocket }> {
  const ws = new WebSocket(url);
  const eingang: unknown[][] = [];
  let warte: (() => void) | null = null;
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as unknown[];
    if (m[0] === "AUTH") return;
    eingang.push(m);
    warte?.();
  });
  await new Promise<void>((ok, fail) => { ws.once("open", () => ok()); ws.once("error", fail); });
  return {
    ws,
    async sende(nachrichten, erwarte = nachrichten.length) {
      const start = eingang.length;
      for (const n of nachrichten) ws.send(JSON.stringify(n));
      const frist = Date.now() + 4000;
      while (eingang.length - start < erwarte && Date.now() < frist) await new Promise<void>((ok) => { warte = ok; setTimeout(ok, 50); });
      return eingang.slice(start);
    },
    zu() { ws.close(); },
  };
}

const ev = (kp = generateKeypair(), inhalt = "hallo", kind = 1): NostrEvent => signEvent(buildEvent(kp.pk, kind, [], inhalt), kp.sk);
const angenommen = (a: unknown[][]) => a.filter((m) => m[0] === "OK" && m[2] === true).length;
const gedrosselt = (a: unknown[][]) => a.filter((m) => (m[0] === "OK" && m[2] === false || m[0] === "CLOSED") && String(m.at(-1)).startsWith("rate-limited:")).length;

test("B-3: Events je Verbindung – darüber „rate-limited:“, eine andere Verbindung bleibt frei", async () => {
  await mitRelay({ eventsJeVerbindung: 3 }, async (url, r) => {
    const a = await verbinde(url);
    const antworten = await a.sende(Array.from({ length: 5 }, (_, i) => ["EVENT", ev(undefined, `e${i}`)]));
    assert.equal(angenommen(antworten), 3);
    assert.equal(gedrosselt(antworten), 2);
    assert.match(String((antworten.find((m) => m[2] === false) ?? [])[3]), /^rate-limited: zu viele Events/);
    const b = await verbinde(url);
    assert.equal(angenommen(await b.sende([["EVENT", ev()]])), 1, "die Grenze gilt je Verbindung");
    assert.equal(r.stats().gedrosselt, 2);
    a.zu(); b.zu();
  });
});

test("B-3: Zeitfenster – nach einer Minute ist die Verbindung wieder frei", async () => {
  await mitRelay({ eventsJeVerbindung: 2 }, async (url, _r, uhr) => {
    const a = await verbinde(url);
    assert.equal(angenommen(await a.sende([["EVENT", ev()], ["EVENT", ev()], ["EVENT", ev()]])), 2);
    uhr.t += 61;
    assert.equal(angenommen(await a.sende([["EVENT", ev()]])), 1);
    a.zu();
  });
});

test("B-3: gespeicherte Events je Schlüssel – über Verbindungen hinweg; mit Zugang das Zehnfache", async () => {
  const kp = generateKeypair();
  await mitRelay({ eventsJeSchluessel: 2 }, async (url) => {
    const a = await verbinde(url);
    const b = await verbinde(url);
    assert.equal(angenommen(await a.sende([["EVENT", ev(kp, "1")], ["EVENT", ev(kp, "2")]])), 2);
    const dritt = await b.sende([["EVENT", ev(kp, "3")]]);
    assert.equal(angenommen(dritt), 0, "derselbe Schlüssel über eine zweite Verbindung");
    assert.match(String(dritt[0][3]), /^rate-limited: zu viele Events von diesem Schlüssel/);
    assert.equal(angenommen(await b.sende([["EVENT", ev()]])), 1, "ein anderer Schlüssel bleibt frei");
    a.zu(); b.zu();
  });
  const zugang = new RelayZugang();
  await zugang.gewaehre(kp.pk, 3600, 1_800_000_000);
  await mitRelay({ eventsJeSchluessel: 2 }, async (url) => {
    const a = await verbinde(url);
    assert.equal(angenommen(await a.sende(Array.from({ length: 6 }, (_, i) => ["EVENT", ev(kp, `z${i}`)]))), 6, "mit Zugang zählt das Zehnfache");
    a.zu();
  }, zugang);
});

test("B-3: flüchtige Events und Doppelte zählen nicht gegen den Schlüssel", async () => {
  const kp = generateKeypair();
  await mitRelay({ eventsJeSchluessel: 1 }, async (url) => {
    const a = await verbinde(url);
    const e = ev(kp, "einmal");
    assert.equal(angenommen(await a.sende([["EVENT", e], ["EVENT", e]])), 2, "das Doppelte bekommt OK „duplicate“ und zählt nicht");
    assert.equal(angenommen(await a.sende([["EVENT", ev(kp, "flüchtig", 25_000)]])), 1, "flüchtige Events speichert der Relay nicht");
    a.zu();
  });
});

test("B-3: Abfragen je Verbindung und offene Abos begrenzt", async () => {
  await mitRelay({ abfragenJeVerbindung: 3, abosJeVerbindung: 2 }, async (url) => {
    const a = await verbinde(url);
    const zwei = await a.sende([["REQ", "s1", { kinds: [1] }], ["REQ", "s2", { kinds: [1] }]], 2);
    assert.deepEqual(zwei.map((m) => m[0]), ["EOSE", "EOSE"]);
    const dritt = await a.sende([["REQ", "s3", { kinds: [1] }]], 1);
    assert.deepEqual(dritt[0], ["CLOSED", "s3", "error: zu viele offene Abos – erst eines schließen"]);
    const viert = await a.sende([["REQ", "s1", { kinds: [0] }]], 1);
    assert.equal(viert[0][0], "CLOSED", "die vierte Abfrage in der Minute – auch für ein bestehendes Abo");
    assert.match(String(viert[0][2]), /^rate-limited: zu viele Abfragen/);
    a.zu();
  });
  await mitRelay({ abosJeVerbindung: 1 }, async (url) => {
    const a = await verbinde(url);
    await a.sende([["REQ", "s1", { kinds: [1] }]], 1);
    const ersetzt = await a.sende([["REQ", "s1", { kinds: [0] }]], 1);
    assert.deepEqual(ersetzt.map((m) => m[0]), ["EOSE"], "dasselbe Abo neu zu fassen, ist kein weiteres");
    a.zu();
  });
});

test("B-3: Anmeldungen zählen wie Abfragen", async () => {
  await mitRelay({ abfragenJeVerbindung: 1 }, async (url) => {
    const a = await verbinde(url);
    const antworten = await a.sende([["AUTH", ev()], ["AUTH", ev()]], 2);
    assert.equal(antworten[0][2], false, "die erste ist schlicht ungültig");
    assert.match(String(antworten[1][3]), /^rate-limited: zu viele Anmeldungen/);
    a.zu();
  });
});

test("B-3: zu viele Verbindungen – die nächste wird mit 1013 geschlossen", async () => {
  await mitRelay({ verbindungen: 2 }, async (url, r) => {
    const a = await verbinde(url);
    const b = await verbinde(url);
    const c = new WebSocket(url);
    const code = await new Promise<number>((ok) => c.once("close", (n) => ok(n)));
    assert.equal(code, 1013);
    assert.equal(r.stats().verbindungen, 2);
    a.zu();
    await new Promise<void>((ok) => setTimeout(ok, 100));
    const d = await verbinde(url);
    assert.equal(angenommen(await d.sende([["EVENT", ev()]])), 1, "nach dem Schließen ist wieder Platz");
    b.zu(); d.zu();
  });
});

test("B-3: Standardgrenzen – ein Upload in 200 Stücken über eine Verbindung geht durch", async () => {
  await mitRelay({}, async (url) => {
    const a = await verbinde(url);
    const kp = generateKeypair();
    const stuecke = Array.from({ length: 200 }, (_, i) => signEvent(buildEvent(kp.pk, 38041, [["d", `stueck-${i}`]], "00".repeat(512)), kp.sk));
    const antworten = await a.sende(stuecke.map((e) => ["EVENT", e]));
    assert.equal(angenommen(antworten), 200);
    assert.ok(antworten.every((m) => m[3] === ""), "alle neu gespeichert, keines ersetzt");
    a.zu();
  });
  assert.deepEqual(FLUTSCHUTZ, { eventsJeVerbindung: 600, abfragenJeVerbindung: 300, eventsJeSchluessel: 600, abosJeVerbindung: 100, verbindungen: 1000 });
});

test("B-3: aufräumen vergisst abgelaufene Zählstände", async () => {
  await mitRelay({ eventsJeVerbindung: 1 }, async (url, r, uhr) => {
    const a = await verbinde(url);
    await a.sende([["EVENT", ev()], ["EVENT", ev()]]);
    uhr.t += 61;
    r.aufraeumen();
    assert.equal(angenommen(await a.sende([["EVENT", ev()]])), 1);
    a.zu();
  });
  const src = readFileSync(new URL("../src/relay-role.ts", import.meta.url), "utf8");
  assert.match(src, /for \(const g of \[this\.eventsJeVerbindung, this\.abfragenJeVerbindung, this\.eventsJeSchluessel\]\) g\.prune\(jetzt\);/);
});
