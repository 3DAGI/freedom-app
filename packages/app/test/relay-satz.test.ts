/**
 * Schritt 5.4a: eigener Relay-Satz statt drei fester Relays. Geprueft wird
 * der Aufbau des Pools, das Abgleichen mit den veroeffentlichten Listen
 * (Kind 10002/10050) – auch mit zwei Geraeten und mit zu wenigen Antworten –
 * und die Verdrahtung in App und Knoten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DM_RELAYS, KIND_RELAY_LIST, LocalSigner, MemoryRelay, OutboxPool, buildDmRelayList, generateKeypair, parseDmRelayList,
  schreibRelays, signEvent, startUrls, type NostrEvent, type Relay, type UnsignedEvent,
} from "@freedomstack/protocol";
import { LS_EIGENE_RELAYS, eigeneListenAbgleichen, ladeEigeneRelays, poolRelays } from "../src/relay-satz.js";

function speicher(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

function netz(anzahl = 3) {
  const relays: Relay[] = Array.from({ length: anzahl }, (_, i) => new MemoryRelay(`wss://r${i}.example`));
  return { relays, pool: new OutboxPool(relays, { minAcks: 1 }) };
}

function geraet(sk: Uint8Array, pool: OutboxPool, s = speicher()) {
  const signer = new LocalSigner(sk);
  const gestreut: NostrEvent[] = [];
  return {
    s, gestreut,
    abgleichen: () => eigeneListenAbgleichen({
      pool, pk: signer.publicKey(), speicher: s,
      signiere: (ev: UnsignedEvent) => signer.signEvent(ev),
      weit: async (ev) => { gestreut.push(ev); await pool.publish(ev); return true; },
    }),
  };
}

test("Gemerkter Satz: nur plausible Adressen; kaputter Speicher ergibt nichts", () => {
  const s = speicher({ [LS_EIGENE_RELAYS]: JSON.stringify(["wss://nos.lol", "ws://192.168.0.1", 7, "wss://nostr.mom"]) });
  assert.deepEqual(ladeEigeneRelays(s), ["wss://nos.lol", "wss://nostr.mom"]);
  assert.deepEqual(ladeEigeneRelays(speicher({ [LS_EIGENE_RELAYS]: "{kaputt" })), []);
  assert.deepEqual(ladeEigeneRelays({ getItem: () => { throw new Error("gesperrt"); } }), []);
});

test("Pool: erster Start mit der ganzen Startliste, danach eigener Satz vorn plus drei wechselnde und die Funde", () => {
  assert.deepEqual(poolRelays({ eigene: [], gemerkt: [] }), startUrls());
  const eigene = ["wss://nostr.mom", "wss://offchain.pub", "wss://relay.primal.net", "wss://nos.lol"];
  const p = poolRelays({ eigene, gemerkt: ["wss://provider.example/"] });
  assert.deepEqual(p.slice(0, 4), eigene);
  assert.equal(p.length, 8);
  assert.equal(p[7], "wss://provider.example");
  assert.ok(!p.includes("wss://relay.nostr.band"), "der ausgefallene alte Relay ist nicht mehr fest dabei");
});

test("Neuer Nutzer: zufaelliger Satz, als NIP-65-Liste und Posteingang gestreut, dann gemerkt – einmal", async () => {
  const { pool } = netz();
  const kp = generateKeypair();
  const g = geraet(kp.sk, pool);
  const eigene = await g.abgleichen();
  assert.equal(eigene?.length, 4);
  assert.deepEqual(g.gestreut.map((e) => e.kind), [KIND_RELAY_LIST, KIND_DM_RELAYS]);
  assert.deepEqual(schreibRelays(g.gestreut[0]), eigene);
  assert.deepEqual(parseDmRelayList(g.gestreut[1]), eigene);
  assert.deepEqual(JSON.parse(g.s.m.get(LS_EIGENE_RELAYS)!), eigene);
  assert.deepEqual(await g.abgleichen(), eigene, "beim zweiten Mal derselbe Satz");
  assert.equal(g.gestreut.length, 2, "nichts neu veroeffentlicht");
});

test("Zweites Geraet derselben Identitaet uebernimmt den Satz, statt neu zu wuerfeln", async () => {
  const { pool } = netz();
  const kp = generateKeypair();
  const erstes = await geraet(kp.sk, pool).abgleichen();
  const zweites = geraet(kp.sk, pool);
  assert.deepEqual(await zweites.abgleichen(), erstes);
  assert.equal(zweites.gestreut.length, 0);
});

test("Nutzer von vor 5.4: alter Posteingang bleibt im Satz, zwei neue kommen dazu", async () => {
  const { pool } = netz();
  const kp = generateKeypair();
  const alt = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
  await pool.publish(signEvent(buildDmRelayList(kp.pk, alt), kp.sk));
  const g = geraet(kp.sk, pool);
  const eigene = await g.abgleichen();
  assert.deepEqual(eigene?.slice(0, 3), alt);
  assert.equal(eigene?.length, 5);
  assert.deepEqual(parseDmRelayList(g.gestreut[1]), eigene, "Posteingang um die neuen ergaenzt");
});

test("Zu wenige Antworten: nichts entscheiden, nichts veroeffentlichen, nichts merken", async () => {
  const kp = generateKeypair();
  const tot: Relay = { url: "wss://tot.example", publish: async () => { throw new Error("weg"); }, query: async () => { throw new Error("weg"); } };
  const pool = new OutboxPool([new MemoryRelay("wss://allein.example"), tot], { minAcks: 1 });
  const g = geraet(kp.sk, pool);
  assert.equal(await g.abgleichen(), null);
  assert.equal(g.gestreut.length, 0);
  assert.equal(g.s.m.has(LS_EIGENE_RELAYS), false);
});

test("Liste nicht angenommen: kein Posteingang, nichts gemerkt – naechstes Mal wieder", async () => {
  const { pool } = netz();
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const s = speicher();
  const gestreut: number[] = [];
  const r = await eigeneListenAbgleichen({
    pool, pk: kp.pk, speicher: s, signiere: (ev) => signer.signEvent(ev),
    weit: async (ev) => { gestreut.push(ev.kind); return false; },
  });
  assert.equal(r, null);
  assert.deepEqual(gestreut, [KIND_RELAY_LIST]);
  assert.equal(s.m.has(LS_EIGENE_RELAYS), false);
});

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");

test("Verdrahtung: Pool aus dem eigenen Satz, Listen je Sitzung abgeglichen, DMs nur an den Posteingang", () => {
  const state = quelle("../src/shell/state.ts");
  assert.match(state, /const urls = poolRelays\(\{ eigene: ladeEigeneRelays\(localStorage\), gemerkt: ladeGemerkteRelays\(\) \}\);/);
  assert.doesNotMatch(state, /export const RELAYS\b/, "keine drei festen Relays mehr");
  assert.match(state, /eigeneListenAbgleichen\(\{\s*pool: await ensurePool\(\), pk: state\.keypair\.pk, signiere, weit: veroeffentlicheWeit, speicher: localStorage,/);
  assert.match(state, /return \(await veroeffentlicheAn\(ev, \[\.\.\.pool\.urls, \.\.\.startUrls\(\)\]\)\) > 0;/);

  const kom = quelle("../src/shell/tabs/kommunikation.ts");
  const sync = kom.slice(kom.indexOf("async function syncDmInbox("));
  assert.match(sync.slice(0, 800), /await eigeneRelayListen\(\)/);
  const dm = kom.slice(kom.indexOf("async function veroeffentlicheDm("), kom.indexOf("let letzterDmAbgleich"));
  assert.match(dm, /if \(ziele\.length > 0 && \(await veroeffentlicheAn\(wrap, ziele\)\) > 0\) return;\s*await pool\.publish\(wrap\);/);
  assert.match(kom, /await veroeffentlicheDm\(dm\.toRecipient, c\.id\);\s*await veroeffentlicheDm\(dm\.toSelf, ich\);/);
  // Seit 8.6b: Kopien an Geraete ebenfalls nur an den Posteingang ihrer Person
  assert.match(kom, /for \(const k of dm\.weitere\) await veroeffentlicheDm\(k\.wrap, meine!\.includes\(k\.an\) \? ich : c\.id\);/);
});

test("Verdrahtung: keine fest verdrahteten alten Relays in App, Knoten und Veroeffentlichung", () => {
  for (const pfad of ["../src/shell/state.ts", "../src/shell/tabs/kommunikation.ts", "../src/chat-zap.ts", "../../node/src/main.ts", "../../../scripts/publish-release.mjs"]) {
    assert.doesNotMatch(quelle(pfad), /relay\.nostr\.band/, pfad);
  }
  assert.match(quelle("../../node/src/main.ts"), /const RELAYS_DEFAULT = startUrls\(\)\.join\(","\);/);
  assert.match(quelle("../src/chat-zap.ts"), /relays: pool\.urls\.slice\(0, 5\),/);
  const dash = quelle("../../website/dashboard.html");
  const liste = dash.slice(dash.indexOf("const RELAYS = ["), dash.indexOf("];", dash.indexOf("const RELAYS = [")));
  assert.deepEqual([...liste.matchAll(/"(wss:\/\/[^"]+)"/g)].map((m) => m[1]), startUrls(), "Dashboard liest die Startliste");
});
