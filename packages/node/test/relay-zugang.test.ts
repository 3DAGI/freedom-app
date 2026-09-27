/**
 * Schritt 8.4a (mit 5.4c): Relay-Rolle als Posteingang – Anmeldung (NIP-42),
 * Umschläge nur an den angemeldeten Empfänger, Zugang, Aufbewahrung nach
 * NIP-01/40, Selbstauskunft (NIP-11). Gegen einen echten WebSocket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { buildEvent, generateKeypair, signEvent, type Keypair, type NostrEvent } from "@freedomstack/protocol";
import { RelayRole, RelayZugang, type RelayConfig } from "../src/relay-role.js";

let port = 17_600;
const T0 = 1_800_000_000;

async function mitRelay<T>(cfg: Partial<RelayConfig>, fn: (url: string, r: RelayRole) => Promise<T>): Promise<T> {
  const p = port++;
  const r = new RelayRole({ port: p, retentionDays: 7, maxEventBytes: 64_000, ...cfg });
  await r.start();
  try {
    return await fn(`ws://127.0.0.1:${p}`, r);
  } finally {
    r.stop();
  }
}

/** Client mit Posteingang: sammelt alles außer der Challenge, die er sich merkt. */
async function client(url: string) {
  const ws = new WebSocket(url);
  const eingang: unknown[][] = [];
  let challenge = "";
  const warter: (() => void)[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as unknown[];
    if (m[0] === "AUTH") challenge = String(m[1]);
    else eingang.push(m);
    for (const w of warter.splice(0)) w();
  });
  await new Promise((ok, fehler) => { ws.on("open", ok); ws.on("error", fehler); });
  while (!challenge) await new Promise<void>((ok) => warter.push(ok));
  const warte = async (n: number, ms = 3000): Promise<unknown[][]> => {
    const ende = Date.now() + ms;
    while (eingang.length < n && Date.now() < ende) await new Promise<void>((ok) => { warter.push(ok); setTimeout(ok, 50); });
    return eingang.splice(0, eingang.length);
  };
  return {
    challenge: () => challenge,
    sende: (...m: unknown[][]) => { for (const x of m) ws.send(JSON.stringify(x)); },
    warte,
    zu: () => ws.close(),
  };
}

const auth = (kp: Keypair, relay: string, challenge: string, zeit = T0) =>
  signEvent(buildEvent(kp.pk, 22242, [["relay", relay], ["challenge", challenge]], "", zeit), kp.sk);
const umschlag = (an: string, zeit = T0, extra: string[][] = []): NostrEvent => {
  const weg = generateKeypair();
  return signEvent(buildEvent(weg.pk, 1059, [["p", an], ...extra], "chiffrat", zeit), weg.sk);
};

test("8.4a: Challenge beim Verbinden; gültige Anmeldung gilt, falsche Challenge, anderer Relay oder alte Zeit nicht", async () => {
  await mitRelay({ jetzt: () => T0 }, async (url) => {
    const kp = generateKeypair();
    const c = await client(url);
    assert.match(c.challenge(), /^[0-9a-f]{32}$/);
    const schlecht = [
      auth(kp, url, "falsch"),
      auth(kp, "wss://anderer.relay", c.challenge()),
      auth(kp, url, c.challenge(), T0 - 3600),
    ];
    for (const ev of schlecht) {
      c.sende(["AUTH", ev]);
      const [a] = await c.warte(1);
      assert.deepEqual([a[0], a[1], a[2]], ["OK", ev.id, false], JSON.stringify(a));
    }
    const gut = auth(kp, url, c.challenge());
    c.sende(["AUTH", gut]);
    assert.deepEqual((await c.warte(1))[0], ["OK", gut.id, true, ""]);
    c.zu();
  });
});

test("8.4a: mit öffentlicher Adresse gilt nur sie – nicht der Host-Kopf der Verbindung (Mittelsmann)", async () => {
  await mitRelay({ oeffentlicheUrl: "wss://relay.example", jetzt: () => T0 }, async (url) => {
    const kp = generateKeypair();
    const c = await client(url);
    c.sende(["AUTH", auth(kp, url, c.challenge())]);
    assert.equal((await c.warte(1))[0][2], false, "eine Anmeldung für 127.0.0.1 gilt hier nicht");
    c.sende(["AUTH", auth(kp, "wss://relay.example/", c.challenge())]);
    assert.equal((await c.warte(1))[0][2], true);
    c.zu();
  });
});

test("8.4a: Umschläge nur an den angemeldeten Empfänger – gespeichert und live", async () => {
  await mitRelay({ umschlaegeSchuetzen: true, jetzt: () => T0 }, async (url) => {
    const bob = generateKeypair();
    const carol = generateKeypair();
    const alt = umschlag(bob.pk);
    const a = await client(url);
    a.sende(["EVENT", alt]);
    assert.equal((await a.warte(1))[0][2], true);

    // Ohne Anmeldung: CLOSED auth-required, und auch ohne kinds-Filter kein Umschlag
    const fremd = await client(url);
    fremd.sende(["REQ", "s", { kinds: [1059], "#p": [bob.pk] }]);
    const [zu] = await fremd.warte(1);
    assert.equal(zu[0], "CLOSED");
    assert.match(String(zu[2]), /^auth-required:/);
    fremd.sende(["REQ", "alles", {}]);
    assert.deepEqual((await fremd.warte(1)).map((m) => m[0]), ["EOSE"]);

    // Carol angemeldet: Bobs Post bleibt zu
    fremd.sende(["AUTH", auth(carol, url, fremd.challenge())]);
    await fremd.warte(1);
    fremd.sende(["REQ", "s2", { kinds: [1059], "#p": [bob.pk] }]);
    assert.equal((await fremd.warte(1))[0][0], "CLOSED");

    // Bob angemeldet: seine Post kommt, auch was danach eintrifft – Carol sieht davon nichts
    const b = await client(url);
    b.sende(["AUTH", auth(bob, url, b.challenge())]);
    await b.warte(1);
    b.sende(["REQ", "post", { kinds: [1059], "#p": [bob.pk] }]);
    const post = await b.warte(2);
    assert.deepEqual(post.map((m) => m[0]), ["EVENT", "EOSE"]);
    assert.equal((post[0][2] as NostrEvent).id, alt.id);
    const neu = umschlag(bob.pk);
    a.sende(["EVENT", neu]);
    await a.warte(1);
    const live = await b.warte(1);
    assert.equal((live[0][2] as NostrEvent).id, neu.id);
    assert.deepEqual(await fremd.warte(1, 300), [], "das offene Abo „alles“ bekommt Bobs Umschlag nicht");
    for (const c of [a, b, fremd]) c.zu();
  });
});

test("8.4a: beschränkt – nur mit Zugang oder an jemanden mit Zugang; Zugang läuft ab", async () => {
  let jetzt = T0;
  const zugang = new RelayZugang();
  const bob = generateKeypair();
  const alice = generateKeypair();
  await zugang.gewaehre(bob.pk, 3600, jetzt);
  await mitRelay({ beschraenkt: true, zugang, jetzt: () => jetzt }, async (url) => {
    const c = await client(url);
    const vonAlice = signEvent(buildEvent(alice.pk, 1, [], "hallo", jetzt), alice.sk);
    const vonBob = signEvent(buildEvent(bob.pk, 1, [], "hallo", jetzt), bob.sk);
    const anBob = umschlag(bob.pk, jetzt);
    const anAlice = umschlag(alice.pk, jetzt);
    c.sende(["EVENT", vonAlice], ["EVENT", vonBob], ["EVENT", anBob], ["EVENT", anAlice]);
    const ok = new Map((await c.warte(4)).map((m) => [m[1], m]));
    assert.equal(ok.get(vonAlice.id)![2], false);
    assert.match(String(ok.get(vonAlice.id)![3]), /^restricted:/);
    assert.equal(ok.get(vonBob.id)![2], true, "Bob hat Zugang");
    assert.equal(ok.get(anBob.id)![2], true, "an Bob darf jeder schreiben – sein Posteingang");
    assert.equal(ok.get(anAlice.id)![2], false);
    jetzt += 3601;
    const spaeter = signEvent(buildEvent(bob.pk, 1, [], "danach", jetzt), bob.sk);
    c.sende(["EVENT", spaeter]);
    assert.equal((await c.warte(1))[0][2], false, "Zugang abgelaufen");
    c.zu();
  });
});

test("8.4a: Zugangsbuch liegt in einer Datei und verlängert ab dem laufenden Ende", async () => {
  const datei = join(mkdtempSync(join(tmpdir(), "relay-zugang-")), "zugang.json");
  const kp = generateKeypair();
  const a = new RelayZugang(datei);
  assert.equal(await a.gewaehre(kp.pk, 100, T0), T0 + 100);
  assert.equal(await a.gewaehre(kp.pk, 100, T0 + 50), T0 + 200, "zweite Zahlung hängt an");
  const b = new RelayZugang(datei);
  await b.laden();
  assert.ok(b.hat(kp.pk, T0 + 199));
  assert.ok(!b.hat(kp.pk, T0 + 200));
  const dauerhaft = generateKeypair().pk;
  assert.ok(new RelayZugang(undefined, [dauerhaft]).hat(dauerhaft, T0 + 1e9));
  await assert.rejects(a.gewaehre("kein-schluessel", 100, T0));
  // zwei Zahlungen zugleich: beide stehen danach in der Datei
  const [x, y] = [generateKeypair().pk, generateKeypair().pk];
  await Promise.all([a.gewaehre(x, 100, T0), a.gewaehre(y, 100, T0)]);
  const c = new RelayZugang(datei);
  await c.laden();
  assert.ok(c.hat(x, T0) && c.hat(y, T0) && c.hat(kp.pk, T0));
});

test("8.4a: ersetzbare nur in neuester Fassung, flüchtige nur weitergereicht, limit mit den neuesten", async () => {
  await mitRelay({ jetzt: () => T0 }, async (url, r) => {
    const kp = generateKeypair();
    const liste = (zeit: number, d?: string) =>
      signEvent(buildEvent(kp.pk, d ? 30000 : 10002, d ? [["d", d]] : [], String(zeit), zeit), kp.sk);
    const c = await client(url);
    const [alt, neu, aelter] = [liste(T0 - 10), liste(T0), liste(T0 - 20)];
    c.sende(["EVENT", alt], ["EVENT", neu], ["EVENT", aelter], ["EVENT", liste(T0, "a")], ["EVENT", liste(T0, "b")]);
    const oks = await c.warte(5);
    assert.ok(oks.every((m) => m[2] === true));
    assert.match(String(oks[2][3]), /^duplicate:/, "ältere Fassung nach der neueren: nicht gespeichert");
    c.sende(["REQ", "l", { kinds: [10002], authors: [kp.pk] }]);
    const l = (await c.warte(2)).filter((m) => m[0] === "EVENT");
    assert.deepEqual(l.map((m) => (m[2] as NostrEvent).id), [neu.id]);
    c.sende(["REQ", "d", { kinds: [30000] }]);
    assert.equal((await c.warte(3)).filter((m) => m[0] === "EVENT").length, 2, "adressierbar je d");

    // flüchtig: an das laufende Abo, aber nicht gespeichert
    const vorher = r.stats().events;
    c.sende(["REQ", "f", { kinds: [24133] }]);
    await c.warte(1);
    const f = signEvent(buildEvent(kp.pk, 24133, [], "x", T0), kp.sk);
    c.sende(["EVENT", f]);
    const fl = await c.warte(2);
    assert.ok(fl.some((m) => m[0] === "EVENT" && (m[2] as NostrEvent).id === f.id));
    assert.equal(r.stats().events, vorher);

    // limit: die neuesten zuerst
    for (let i = 0; i < 3; i++) c.sende(["EVENT", signEvent(buildEvent(kp.pk, 1, [], `n${i}`, T0 + i), kp.sk)]);
    await c.warte(3);
    c.sende(["REQ", "lim", { kinds: [1], limit: 2 }]);
    const lim = (await c.warte(3)).filter((m) => m[0] === "EVENT").map((m) => (m[2] as NostrEvent).content);
    assert.deepEqual(lim, ["n2", "n1"]);
    c.zu();
  });
});

test("8.4a: Abgelaufenes (NIP-40) wird nicht angenommen, nicht ausgeliefert und aufgeräumt; alte Eingänge nach der Aufbewahrung", async () => {
  let jetzt = T0;
  await mitRelay({ jetzt: () => jetzt }, async (url, r) => {
    const kp = generateKeypair();
    const c = await client(url);
    const weg = signEvent(buildEvent(kp.pk, 1, [["expiration", String(T0 - 1)]], "alt", T0), kp.sk);
    const bald = signEvent(buildEvent(kp.pk, 1, [["expiration", String(T0 + 60)]], "bald", T0), kp.sk);
    const liste = signEvent(buildEvent(kp.pk, 10050, [], "", T0), kp.sk);
    const normal = signEvent(buildEvent(kp.pk, 1, [], "normal", T0), kp.sk);
    c.sende(["EVENT", weg], ["EVENT", bald], ["EVENT", liste], ["EVENT", normal]);
    const oks = new Map((await c.warte(4)).map((m) => [m[1], m[2]]));
    assert.equal(oks.get(weg.id), false);
    assert.equal(oks.get(bald.id), true);
    jetzt = T0 + 61;
    c.sende(["REQ", "a", { kinds: [1] }]);
    assert.deepEqual((await c.warte(2)).filter((m) => m[0] === "EVENT").map((m) => (m[2] as NostrEvent).id), [normal.id]);
    assert.equal(r.aufraeumen(), 1);
    jetzt = T0 + 8 * 86400;
    assert.equal(r.aufraeumen(), 1, "normales Event nach 7 Tagen weg");
    assert.equal(r.stats().events, 1, "die Posteingangsliste (ersetzbar) bleibt");
    c.zu();
  });
});

test("8.4a: Abos zweier Verbindungen mit derselben Id stören sich nicht", async () => {
  await mitRelay({ jetzt: () => T0 }, async (url) => {
    const kp = generateKeypair();
    const [a, b] = [await client(url), await client(url)];
    a.sende(["REQ", "s1", { kinds: [1] }]);
    b.sende(["REQ", "s1", { kinds: [7] }]);
    await a.warte(1);
    await b.warte(1);
    a.sende(["EVENT", signEvent(buildEvent(kp.pk, 1, [], "eins", T0), kp.sk)]);
    const bei = (await a.warte(2)).map((m) => m[0]).sort();
    assert.deepEqual(bei, ["EVENT", "OK"], "vorher überschrieb b das Abo von a");
    assert.deepEqual(await b.warte(1, 300), []);
    a.zu();
    b.zu();
  });
});

test("8.4a: Selbstauskunft (NIP-11) auf demselben Port – mit Schlüssel des Betreibers", async () => {
  const betreiber = generateKeypair().pk;
  await mitRelay({ pubkey: betreiber, beschraenkt: true }, async (url) => {
    const http = url.replace("ws://", "http://");
    const res = await fetch(http, { headers: { Accept: "application/nostr+json" } });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const info = (await res.json()) as { pubkey: string; supported_nips: number[]; limitation: Record<string, unknown> };
    assert.equal(info.pubkey, betreiber);
    assert.ok(info.supported_nips.includes(42) && info.supported_nips.includes(40));
    assert.equal(info.limitation.payment_required, true);
    assert.equal(info.limitation.restricted_writes, true);
    assert.equal((await fetch(http)).headers.get("content-type"), "text/plain; charset=utf-8");
  });
});
