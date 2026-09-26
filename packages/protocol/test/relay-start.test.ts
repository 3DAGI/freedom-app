/**
 * Schritt 5.4: Startliste und eigener Relay-Satz. Geprueft wird Vielfalt
 * (Betreiber), dass der eigene Satz stabil bleibt und alte Posteingaenge
 * behaelt, und dass die Sitzung wechselnd weitere Relays dazunimmt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EIGENE_ANZAHL, ROTIERENDE_ANZAHL, STARTRELAYS, eigenerRelaySatz, listeVeraltet, schreibRelays, sitzungsRelays, startUrls, waehleEigeneRelays,
} from "../src/relay-start.js";
import { buildRelayList, isPlausibleRelayUrl } from "../src/relay-discovery.js";
import { buildDmRelayList } from "../src/private-dm.js";
import { generateKeypair, signEvent } from "../src/event.js";
import { MemoryRelay, OutboxPool, type Relay } from "../src/outbox.js";

const folge = (...z: number[]) => { let i = 0; return () => z[i++ % z.length]; };

test("Startliste: mindestens acht Relays, verschiedene Betreiber, alle plausibel, nicht mehr an den drei alten haengend", () => {
  assert.ok(STARTRELAYS.length >= 8);
  assert.equal(new Set(STARTRELAYS.map((s) => s.betreiber)).size, STARTRELAYS.length, "jeder Betreiber nur einmal");
  assert.ok(STARTRELAYS.every((s) => isPlausibleRelayUrl(s.url).ok));
  const alte = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
  assert.ok(STARTRELAYS.filter((s) => !alte.includes(s.url)).length >= 5, "ohne die alten drei bleiben genug");
});

test("Eigener Satz: neu zufaellig aus der Startliste; wer schon Relays hat, behaelt sie und bekommt zwei dazu", () => {
  const neu = waehleEigeneRelays({ zufall: folge(0.1, 0.9, 0.5, 0.3, 0.7) });
  assert.equal(neu.length, EIGENE_ANZAHL);
  assert.equal(new Set(neu).size, EIGENE_ANZAHL);
  const anderer = waehleEigeneRelays({ zufall: folge(0.8, 0.2, 0.6) });
  assert.notDeepEqual(new Set(anderer), new Set(neu), "verschiedene Nutzer, verschiedene Relays – die Last verteilt sich");
  const alt = waehleEigeneRelays({ bisher: ["wss://relay.nostr.band", "wss://nos.lol/", "ws://192.168.1.1"], zufall: folge(0.4) });
  assert.deepEqual(alt.slice(0, 2), ["wss://relay.nostr.band", "wss://nos.lol"], "alte Posteingaenge bleiben, private Adressen nicht");
  assert.equal(alt.length, 4);
});

test("Sitzung: eigener Satz vorn, dazu wechselnd weitere – ohne Doppelte", () => {
  const eigene = ["wss://relay.damus.io", "wss://nostr.mom"];
  const s1 = sitzungsRelays({ eigene, zufall: folge(0.1, 0.9, 0.3), anzahl: 3 });
  const s2 = sitzungsRelays({ eigene, zufall: folge(0.9, 0.1, 0.6), anzahl: 3 });
  assert.deepEqual(s1.slice(0, 2), eigene);
  assert.equal(s1.length, 5);
  assert.notDeepEqual(s1.slice(2), s2.slice(2), "rotierend");
});

test("Liste veraltet: nur wenn sich die Menge aendert", () => {
  assert.equal(listeVeraltet(undefined, ["wss://a.example"]), true);
  assert.equal(listeVeraltet(["wss://a.example", "wss://b.example"], ["wss://b.example/", "wss://a.example"]), false);
  assert.equal(listeVeraltet(["wss://a.example"], ["wss://a.example", "wss://b.example"]), true);
});

const kp = generateKeypair();
const liste = (urls: { url: string; read?: boolean; write?: boolean }[]) => signEvent(buildRelayList(kp.pk, urls), kp.sk);
const posteingang = (urls: string[]) => signEvent(buildDmRelayList(kp.pk, urls), kp.sk);

test("Sitzung: zwei Nutzer teilen immer mindestens sechs Startrelays – auch ohne die Listen des anderen", () => {
  for (let i = 0; i < 50; i++) {
    const a = sitzungsRelays({ eigene: waehleEigeneRelays() });
    const b = sitzungsRelays({ eigene: waehleEigeneRelays() });
    assert.equal(a.length, EIGENE_ANZAHL + ROTIERENDE_ANZAHL);
    assert.ok(a.filter((u) => b.includes(u)).length >= 6);
  }
  assert.equal(startUrls().length, STARTRELAYS.length);
});

test("Eigener Satz: die veroeffentlichte NIP-65-Liste gilt – ein zweites Geraet uebernimmt sie, statt neu zu wuerfeln", () => {
  const l = liste([{ url: "wss://nostr.mom" }, { url: "wss://offchain.pub/" }, { url: "wss://nur-lesen.example", write: false }, { url: "ws://10.0.0.1" }]);
  const s = eigenerRelaySatz({ liste: l, posteingang: posteingang(["wss://offchain.pub", "wss://nostr.mom"]) });
  assert.deepEqual(s.eigene, ["wss://nostr.mom", "wss://offchain.pub"], "nur Schreib-Relays, nur plausible");
  assert.equal(s.liste, false);
  assert.equal(s.posteingang, false, "Posteingang stimmt schon");
  assert.equal(eigenerRelaySatz({ liste: l }).posteingang, true, "Posteingang fehlt → veroeffentlichen");
});

test("Eigener Satz: alter Posteingang (vor 5.4) bleibt, zwei neue kommen dazu; neu ohne alles: zufaellig", () => {
  const alt = eigenerRelaySatz({ posteingang: posteingang(["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]), zufall: folge(0.3) });
  assert.deepEqual(alt.eigene.slice(0, 3), ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]);
  assert.equal(alt.eigene.length, 5);
  assert.equal(alt.liste, true);
  assert.equal(alt.posteingang, true, "zwei neue → Posteingang neu veroeffentlichen");
  const neu = eigenerRelaySatz({});
  assert.equal(neu.eigene.length, EIGENE_ANZAHL);
  assert.ok(neu.eigene.every((u) => startUrls().includes(u)));
  assert.equal(neu.liste && neu.posteingang, true);
});

test("Schreib-Relays: fremde Kinds und kaputte Listen ergeben nichts", () => {
  assert.deepEqual(schreibRelays(undefined), []);
  assert.deepEqual(schreibRelays(posteingang(["wss://nos.lol"])), [], "Kind 10050 ist keine NIP-65-Liste");
});

test("Pool: publishAn schreibt nur an die genannten Relays; queryMitBericht nennt, wer antwortete", async () => {
  const a = new MemoryRelay("wss://a.example");
  const b = new MemoryRelay("wss://b.example");
  const tot: Relay = { url: "wss://tot.example", publish: async () => { throw new Error("weg"); }, query: async () => { throw new Error("weg"); } };
  const pool = new OutboxPool([a, b, tot], { minAcks: 1 });
  const ev = liste([{ url: "wss://a.example" }]);
  const r = await pool.publishAn(ev, ["wss://b.example", "wss://tot.example"]);
  assert.deepEqual(r.accepted, ["wss://b.example"]);
  assert.equal(r.rejected[0].url, "wss://tot.example");
  assert.equal((await a.query({ ids: [ev.id] })).length, 0, "a bekam nichts");
  const { events, antworten } = await pool.queryMitBericht({ ids: [ev.id] });
  assert.equal(events.length, 1);
  assert.deepEqual(antworten, ["wss://a.example", "wss://b.example"]);
  assert.equal((await pool.publishAn(ev, [])).ok, false, "keine Ziele – nichts angenommen, kein Wurf");
});
