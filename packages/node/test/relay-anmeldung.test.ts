/**
 * Schritt 8.4c: Der Relay-Client (`WebSocketRelay`) meldet sich nach NIP-42
 * an – nur, wenn der Relay es verlangt (`auth-required:`), und nur, wenn
 * `anmelden` ein Event liefert. Gegen die echte Relay-Rolle und einen Relay,
 * der schon das Schreiben an eine Anmeldung bindet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { WebSocketRelay, baueRelayAuth, buildEvent, generateKeypair, signEvent, type Keypair, type NostrEvent } from "@freedomstack/protocol";
import { RelayRole } from "../src/relay-role.js";

let port = 17_800;
const bob = generateKeypair();
const umschlag = (an: string): NostrEvent => {
  const weg = generateKeypair();
  return signEvent(buildEvent(weg.pk, 1059, [["p", an]], "chiffrat"), weg.sk);
};
const als = (kp: Keypair, zaehler?: { n: number }) => async (url: string, challenge: string) => {
  if (zaehler) zaehler.n++;
  return signEvent(baueRelayAuth(kp.pk, url, challenge), kp.sk);
};

async function mitRelay(fn: (url: string) => Promise<void>): Promise<void> {
  const p = port++;
  const r = new RelayRole({ port: p, retentionDays: 7, maxEventBytes: 64_000, umschlaegeSchuetzen: true });
  await r.start();
  try {
    await fn(`ws://127.0.0.1:${p}`);
  } finally {
    r.stop();
  }
}

test("8.4c: Umschläge vom geschützten Relay erst nach Anmeldung – einmal je Verbindung, nur auf Verlangen", async () => {
  await mitRelay(async (url) => {
    const post = umschlag(bob.pk);
    const sender = new WebSocketRelay(url, { autoReconnect: false });
    await sender.publish(post);
    sender.close();

    const ohne = new WebSocketRelay(url, { timeoutMs: 1500, autoReconnect: false });
    assert.deepEqual(await ohne.query({ kinds: [1059], "#p": [bob.pk] }), [], "ohne Anmeldung nichts");
    ohne.close();

    const n = { n: 0 };
    const mit = new WebSocketRelay(url, { timeoutMs: 3000, autoReconnect: false, anmelden: als(bob, n) });
    assert.deepEqual((await mit.query({ kinds: [1] })), [], "offene Anfrage: keine Anmeldung nötig");
    assert.equal(n.n, 0, "nie von selbst anmelden");
    const gelesen = await mit.query({ kinds: [1059], "#p": [bob.pk] });
    assert.deepEqual(gelesen.map((e) => e.id), [post.id]);
    await mit.query({ kinds: [1059], "#p": [bob.pk] });
    assert.equal(n.n, 1, "je Verbindung einmal");

    // Dauer-Abo: nach der Anmeldung kommt auch Neues
    const neu = umschlag(bob.pk);
    const live: string[] = [];
    const stopp = await mit.subscribe({ kinds: [1059], "#p": [bob.pk] }, (e) => live.push(e.id));
    await new Promise((ok) => setTimeout(ok, 200));
    const s2 = new WebSocketRelay(url, { autoReconnect: false });
    await s2.publish(neu);
    s2.close();
    await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(live.includes(neu.id));
    stopp();
    mit.close();
  });
});

test("8.4c: anmelden liefert null oder einen fremden Schlüssel – dann nichts, und ohne auf die Zeitgrenze zu warten", async () => {
  await mitRelay(async (url) => {
    const s = new WebSocketRelay(url, { autoReconnect: false });
    await s.publish(umschlag(bob.pk));
    s.close();
    const nein = new WebSocketRelay(url, { timeoutMs: 5000, autoReconnect: false, anmelden: async () => null });
    const t0 = Date.now();
    assert.deepEqual(await nein.query({ kinds: [1059], "#p": [bob.pk] }), []);
    assert.ok(Date.now() - t0 < 2000, "nicht erst nach der Zeitgrenze");
    nein.close();
    const carol = new WebSocketRelay(url, { timeoutMs: 3000, autoReconnect: false, anmelden: als(generateKeypair()) });
    assert.deepEqual(await carol.query({ kinds: [1059], "#p": [bob.pk] }), [], "Carol liest Bobs Post nicht");
    carol.close();
  });
});

test("8.4c: Relay bindet das Schreiben an eine Anmeldung – nach der Anmeldung wird einmal erneut gesendet", async () => {
  const p = port++;
  const wss = new WebSocketServer({ port: p });
  const angenommen: string[] = [];
  wss.on("connection", (ws) => {
    let angemeldet = false;
    ws.send(JSON.stringify(["AUTH", "c123"]));
    ws.on("message", (raw) => {
      const [typ, ev] = JSON.parse(String(raw)) as [string, NostrEvent];
      if (typ === "AUTH") {
        angemeldet = ev.tags.some((t) => t[0] === "challenge" && t[1] === "c123");
        ws.send(JSON.stringify(["OK", ev.id, angemeldet, ""]));
      } else if (typ === "EVENT") {
        if (angemeldet) angenommen.push(ev.id);
        ws.send(JSON.stringify(["OK", ev.id, angemeldet, angemeldet ? "" : "auth-required: erst anmelden"]));
      }
    });
  });
  try {
    const url = `ws://127.0.0.1:${p}`;
    const ev = signEvent(buildEvent(bob.pk, 1, [], "hallo"), bob.sk);
    const ohne = new WebSocketRelay(url, { timeoutMs: 1500, autoReconnect: false });
    await assert.rejects(ohne.publish(ev));
    ohne.close();
    const mit = new WebSocketRelay(url, { timeoutMs: 3000, autoReconnect: false, anmelden: als(bob) });
    await mit.publish(ev);
    assert.deepEqual(angenommen, [ev.id]);
    mit.close();
  } finally {
    wss.close();
  }
});
