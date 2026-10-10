/**
 * A-16 (Nutzertest 08.10.2026, Befund N-1): weniger Verbindungen.
 *
 * Beweist:
 *  - dieselbe Adresse gibt dieselbe Verbindung, je Identität eine eigene
 *  - nach der Ruhezeit ohne Gebrauch geschlossen, nie während sie gebraucht wird; Gebrauch setzt die Uhr zurück
 *  - höchstens `max` zugleich – es geht die am längsten ungenutzte, nie eine gebrauchte
 *  - `mit()` gibt zurück, auch wenn die Arbeit scheitert
 *  - verdrahtet: Relays des Pools über dessen Verbindung, die übrigen über Nebenverbindungen; frageAn() prüft Signaturen
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEBEN_GRENZEN, Nebenverbindungen } from "../src/neben-verbindungen.js";

const lies = (d: string): string => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");

function aufbau(o: { max?: number } = {}) {
  let uhr = 0;
  let id = 0;
  const geplant = new Map<number, { fn: () => void; bis: number }>();
  const zu: string[] = [];
  const n = new Nebenverbindungen((url) => ({ url, nr: ++id, close: () => { zu.push(url); } }), {
    ...o, ruheMs: 1000, jetzt: () => uhr,
    planen: (fn, ms) => { const h = ++id; geplant.set(h, { fn, bis: uhr + ms }); return h; },
    abbrechen: (h) => { geplant.delete(h as number); },
  });
  const vergeht = (ms: number) => {
    uhr += ms;
    for (const [h, g] of [...geplant]) if (g.bis <= uhr) { geplant.delete(h); g.fn(); }
  };
  return { n, zu, vergeht };
}

test("A-16: dieselbe Adresse, dieselbe Verbindung – je Identität eine eigene", () => {
  const { n } = aufbau();
  const a = n.hole("wss://x", "ich");
  n.gib("wss://x", "ich");
  assert.equal(n.hole("wss://x", "ich"), a, "wiederverwendet");
  assert.notEqual(n.hole("wss://x", "andere"), a, "angemeldet wird je Identität");
  assert.equal(n.anzahl, 2);
  assert.ok(NEBEN_GRENZEN.max >= 4 && NEBEN_GRENZEN.ruheMs >= 60_000);
});

test("A-16: nach der Ruhezeit zu, nie im Gebrauch, Gebrauch setzt die Uhr zurück", () => {
  const { n, zu, vergeht } = aufbau();
  n.hole("wss://x");
  vergeht(5000);
  assert.deepEqual(zu, [], "im Gebrauch bleibt sie offen");
  n.gib("wss://x");
  vergeht(600);
  n.hole("wss://x");
  n.gib("wss://x");
  vergeht(600);
  assert.deepEqual(zu, [], "erneuter Gebrauch setzt die Ruhezeit zurück");
  vergeht(500);
  assert.deepEqual(zu, ["wss://x"]);
  assert.equal(n.anzahl, 0);
  n.gib("wss://x"); // doppelt zurückgeben schadet nicht
});

test("A-16: höchstens max zugleich – die am längsten ungenutzte geht, nie eine gebrauchte", () => {
  const { n, zu, vergeht } = aufbau({ max: 2 });
  n.hole("wss://a");
  vergeht(1);
  n.hole("wss://b");
  n.gib("wss://b");
  vergeht(1);
  n.hole("wss://c");
  assert.deepEqual(zu, ["wss://b"], "a ist im Gebrauch, b die ungenutzte");
  n.hole("wss://d");
  assert.equal(n.anzahl, 3, "über max nur, solange alle gebraucht werden");
  assert.deepEqual(zu, ["wss://b"]);
});

test("A-16: mit() gibt zurück, auch wenn die Arbeit scheitert", async () => {
  const { n, zu, vergeht } = aufbau();
  assert.equal(await n.mit("wss://x", "", async (v) => (v as unknown as { url: string }).url), "wss://x");
  await assert.rejects(n.mit("wss://x", "", async () => { throw new Error("weg"); }));
  vergeht(1000);
  assert.deepEqual(zu, ["wss://x"], "zurückgegeben – nach der Ruhezeit zu");
});

test("A-26: eine Verbindung scheitert – die Adresse ist eine Viertelstunde ausgesetzt, ein Erfolg hebt das auf", async () => {
  const { n, vergeht } = aufbau();
  await assert.rejects(n.mit("wss://tot", "ich", async () => { throw new Error("Connect-Timeout"); }));
  assert.deepEqual([...n.ausgesetzt()], ["wss://tot"], "je Adresse, gleich für welche Identität");
  vergeht(NEBEN_GRENZEN.aussetzenMs - 1);
  assert.deepEqual([...n.ausgesetzt()], ["wss://tot"]);
  vergeht(1);
  assert.deepEqual([...n.ausgesetzt()], [], "danach wieder eingeplant");
  await assert.rejects(n.mit("wss://wackel", "", async () => { throw new Error("weg"); }));
  await n.mit("wss://wackel", "", async () => []);
  assert.deepEqual([...n.ausgesetzt()], [], "wieder erreichbar");
  assert.equal(NEBEN_GRENZEN.aussetzenMs, 15 * 60_000);
});

test("A-16: verdrahtet – Pool-Relays über den Pool, die übrigen über Nebenverbindungen", () => {
  const s = lies("shell/state.ts");
  const teil = (von: string, bis: string) => s.slice(s.indexOf(von), s.indexOf(bis, s.indexOf(von) + 1));
  const frage = teil("export async function frageAn(", "\n}\n");
  assert.match(frage, /pool\.queryAn\(filter, imPool\)/);
  assert.match(frage, /neben\.mit\(u, art, \(r\) => r\.query\(filter\)\)/);
  assert.match(frage, /verifyEvent\(ev\)/, "auch von fremden Relays nur gültig Signiertes");
  const pub = teil("export async function veroeffentlicheAn(", "\n}\n");
  assert.match(pub, /pool\.publishAn\(ev, imPool\)/);
  assert.match(pub, /neben\.mit\(u, art, \(r\) => r\.publish\(ev\)\)/);
  const abo = teil("export async function abonniereAn(", "\n}\n");
  assert.match(abo, /pool\.subscribeAn\(filter, imPool, onEvent\)/);
  assert.match(abo, /neben\.hole\(u, art\)/);
  assert.match(abo, /neben\.gib\(u, art\)/);
  assert.doesNotMatch(s, /autoReconnect: false/, "keine Wegwerf-Verbindung je Aufruf mehr");
  assert.match(s, /const nebenArt = \(\): string => state\.keypair\?\.pk \?\? "";/, "je Identität");
  assert.match(s, /new OutboxLeser\(\{[^}]*ausgesetzt: \(\) => neben\.ausgesetzt\(\)/, "A-26: der Outbox-Plan lässt gescheiterte aus");
});
