/**
 * Tests fuer die Relay-Entdeckung.
 *
 * Hier entscheidet sich, ob das Netz sich selbst traegt oder an vier fremden
 * Servern haengt. Der Schwerpunkt liegt auf den Angriffen: erfundene Adressen,
 * Adressen im Heimnetz des Opfers, und der Versuch, einen Client vollstaendig
 * auf eigene Server umzulenken.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import { MemoryRelay } from "../src/outbox.js";
import {
  buildRelayList, parseRelayList, discoverRelays, isPlausibleRelayUrl,
  normalizeRelayUrl, buildRelaySet, checkRelayHealth, KIND_RELAY_LIST,
} from "../src/relay-discovery.js";

const SEEDS = ["wss://relay.damus.io", "wss://nos.lol"];

function ann(urls: string[], kp = generateKeypair()): NostrEvent {
  return signEvent(buildRelayList(kp.pk, urls.map((url) => ({ url }))), kp.sk);
}

// ------------------------------------------------------------- Format

test("Ankuendigung: Roundtrip build -> parse", () => {
  const kp = generateKeypair();
  const ev = signEvent(
    buildRelayList(kp.pk, [
      { url: "wss://a.io" },
      { url: "wss://b.io", write: false },
      { url: "wss://c.io", read: false },
    ]),
    kp.sk,
  );
  const p = parseRelayList(ev);
  assert.equal(p.relays.length, 3);
  assert.equal(p.relays[1].write, false, "nur-lesen wird uebernommen");
  assert.equal(p.relays[2].read, false);
  assert.equal(ev.kind, KIND_RELAY_LIST);
});

test("URL-Vereinheitlichung: dieselbe Adresse landet nicht doppelt im Pool", () => {
  assert.equal(normalizeRelayUrl("wss://A.IO/"), normalizeRelayUrl("wss://a.io"));
  assert.equal(normalizeRelayUrl("wss://a.io:443"), normalizeRelayUrl("wss://a.io"));
  assert.equal(normalizeRelayUrl("ws://a.io:80/"), normalizeRelayUrl("ws://a.io"));
  assert.notEqual(normalizeRelayUrl("wss://a.io:7777"), normalizeRelayUrl("wss://a.io"));
});

// ------------------------------------------------------------- Angriffe

test("Adressen im privaten Netz werden abgelehnt", () => {
  // Der interessanteste Angriff: Ein Client, der ws://192.168.1.1 in seinen
  // Pool nimmt, klopft am Router seines eigenen Nutzers an.
  for (const url of [
    "ws://192.168.1.1", "ws://127.0.0.1:7777", "ws://10.0.0.5",
    "ws://169.254.169.254", "ws://172.16.0.1", "wss://localhost:7777",
    "wss://relay.local",
  ]) {
    assert.equal(isPlausibleRelayUrl(url).ok, false, `${url} muss abgelehnt werden`);
  }
});

test("Falsche Schemata und Zugangsdaten werden abgelehnt", () => {
  assert.equal(isPlausibleRelayUrl("https://a.io").ok, false);
  assert.equal(isPlausibleRelayUrl("javascript:alert(1)").ok, false);
  assert.equal(isPlausibleRelayUrl("wss://user:pw@a.io").ok, false);
  assert.equal(isPlausibleRelayUrl("nicht mal eine url").ok, false);
  assert.equal(isPlausibleRelayUrl("wss://" + "a".repeat(300)).ok, false);
});

test("Echte Relay-Adressen bleiben erlaubt", () => {
  for (const url of ["wss://relay.damus.io", "wss://nos.lol", "ws://relay.example.org:7777"]) {
    assert.equal(isPlausibleRelayUrl(url).ok, true, url);
  }
});

test("Abgelehnte Adressen werden mit Grund gemeldet, nicht still verschluckt", () => {
  const r = discoverRelays([ann(["ws://192.168.1.1", "wss://echt.io"])]);
  assert.equal(r.relays.length, 1);
  assert.equal(r.relays[0].url, "wss://echt.io");
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /privaten Bereich/);
});

// ------------------------------------------------------------- Bewertung

test("Nachgewiesene Arbeit wiegt schwerer als blosse Anzahl", () => {
  // Anzahl laesst sich mit Wegwerf-Schluesseln erzeugen, Arbeit nicht.
  const arbeiter = generateKeypair();
  const events = [
    ann(["wss://guter-relay.io"], arbeiter),
    ...Array.from({ length: 8 }, () => ann(["wss://sybil-relay.io"])),
  ];
  const r = discoverRelays(events, { trustedPubkeys: new Set([arbeiter.pk]) });
  assert.equal(r.relays[0].url, "wss://guter-relay.io");
  assert.equal(r.relays[0].announcedByTrusted, 1);
});

test("Verbreitung zaehlt, wenn kein Vertrauen bekannt ist", () => {
  const events = [
    ann(["wss://viele.io"]), ann(["wss://viele.io"]), ann(["wss://viele.io"]),
    ann(["wss://einer.io"]),
  ];
  const r = discoverRelays(events);
  assert.equal(r.relays[0].url, "wss://viele.io");
  assert.equal(r.relays[0].announcedBy, 3);
});

test("Derselbe Schluessel kann eine Adresse nicht hochzaehlen", () => {
  const kp = generateKeypair();
  const r = discoverRelays([ann(["wss://x.io"], kp), ann(["wss://x.io"], kp), ann(["wss://x.io"], kp)]);
  assert.equal(r.relays[0].announcedBy, 1, "pro Schluessel eine Stimme");
});

test("Bereits bekannte Adressen werden nicht erneut vorgeschlagen", () => {
  const r = discoverRelays([ann(["wss://nos.lol", "wss://neu.io"])], { known: SEEDS });
  assert.deepEqual(r.relays.map((x) => x.url), ["wss://neu.io"]);
});

test("Die Zahl der Funde ist begrenzt", () => {
  // Ein Angreifer koennte tausende Adressen streuen, um den Pool zu verstopfen.
  const events = Array.from({ length: 200 }, (_, i) => ann([`wss://r${i}.io`]));
  const r = discoverRelays(events, { maxDiscovered: 12 });
  assert.equal(r.relays.length, 12);
});

test("Nur-Lese-Relays werden nicht zum Schreiben uebernommen", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildRelayList(kp.pk, [{ url: "wss://nurlesen.io", write: false }]), kp.sk);
  assert.equal(discoverRelays([ev]).relays.length, 0);
});

// ------------------------------------------------------------- Gesundheit

test("Erreichbarkeit wird geprueft, bevor eine Adresse in den Pool kommt", async () => {
  const lebt = new MemoryRelay("wss://lebt.io");
  const tot = new MemoryRelay("wss://tot.io");
  tot.setOffline(true);

  assert.equal((await checkRelayHealth(lebt)).ok, true);
  const r = await checkRelayHealth(tot);
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test("Tote Adressen landen nicht im Set", async () => {
  const tot = new MemoryRelay("wss://tot.io");
  tot.setOffline(true);
  const relays = new Map<string, MemoryRelay>([
    ["wss://lebt.io", new MemoryRelay("wss://lebt.io")],
    ["wss://tot.io", tot],
  ]);

  const set = await buildRelaySet({
    seedUrls: SEEDS,
    discovered: [
      { url: "wss://lebt.io", announcedBy: 5, announcedByTrusted: 2, score: 25 },
      { url: "wss://tot.io", announcedBy: 5, announcedByTrusted: 2, score: 25 },
    ],
    makeRelay: (u) => relays.get(u)!,
  });

  assert.ok(set.urls.includes("wss://lebt.io"));
  assert.ok(!set.urls.includes("wss://tot.io"), "tote Adressen verstopfen jeden Publish");
  assert.equal(set.skipped.length, 1);
});

test("Die Startliste wird NIE ganz verdraengt", async () => {
  // Sonst koennte ein Angreifer mit genug Ankuendigungen einen Client
  // vollstaendig auf eigene Server umlenken und ihm eine erfundene Sicht des
  // Netzes zeigen.
  const discovered = Array.from({ length: 20 }, (_, i) => ({
    url: `wss://angreifer${i}.io`, announcedBy: 99, announcedByTrusted: 99, score: 9999,
  }));
  const set = await buildRelaySet({
    seedUrls: SEEDS,
    discovered,
    makeRelay: (u) => new MemoryRelay(u),
    maxTotal: 4,
  });
  for (const seed of SEEDS) {
    assert.ok(set.urls.includes(seed), `${seed} muss erhalten bleiben`);
  }
});

test("Ohne Funde bleibt die Startliste unveraendert nutzbar", async () => {
  const set = await buildRelaySet({
    seedUrls: SEEDS, discovered: [], makeRelay: (u) => new MemoryRelay(u),
  });
  assert.deepEqual(set.urls, SEEDS);
});

// ------------------------------------------------------------- Tor

test("Zwiebeladressen werden erkannt", async () => {
  const { isOnion } = await import("../src/relay-discovery.js");
  assert.equal(isOnion("wss://abcdefgh1234567.onion"), true);
  assert.equal(isOnion("wss://relay.damus.io"), false);
  assert.equal(isOnion("kein url"), false);
});

test("Nur-Tor sagt es, wenn danach nichts uebrig bleibt", async () => {
  // Ein Client ohne Relays sieht fuer den Nutzer aus wie ein kaputtes
  // Programm — das gehoert erklaert, nicht stillschweigend hingenommen.
  const { sortByTorPreference } = await import("../src/relay-discovery.js");
  const r = sortByTorPreference(["wss://relay.damus.io"], { onionOnly: true, preferOnion: false });
  assert.equal(r.relays.length, 0);
  assert.match(r.message, /keine Verbindung/);
});

test("Bevorzugen stellt Zwiebeladressen nach vorn, behaelt aber den Rueckfall", async () => {
  const { sortByTorPreference } = await import("../src/relay-discovery.js");
  const r = sortByTorPreference(
    ["wss://relay.damus.io", "wss://abc.onion"],
    { onionOnly: false, preferOnion: true },
  );
  assert.ok(r.relays[0].includes(".onion"));
  assert.equal(r.relays.length, 2);
});

test("Ohne Tor-Vorliebe bleibt die Reihenfolge, die Zahl wird genannt", async () => {
  const { sortByTorPreference } = await import("../src/relay-discovery.js");
  const r = sortByTorPreference(["wss://a.onion", "wss://b.example"],
    { onionOnly: false, preferOnion: false });
  assert.equal(r.relays.length, 2);
  assert.equal(r.onionCount, 1);
});

test("Die Auskunft nennt die verbleibende Grenze", async () => {
  const { torInfo } = await import("../src/relay-discovery.js");
  const t = torInfo();
  assert.match(t, /jedes Relay deine IP/);
  assert.match(t, /Mixnetz/);
});
