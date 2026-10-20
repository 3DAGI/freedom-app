/**
 * B-35c1: Der Relay-Client (`WebSocketRelay.abgleiche()`) gleicht nach NIP-77 ab – gegen die echte Relay-Rolle
 * (B-35b). Umschläge nur nach Anmeldung und nur über `anmelden`; Fehler nur als `NegFehler` mit Kennung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import {
  NEG_CLIENT, NegFehler, NegSpeicher, OutboxPool, WebSocketRelay, baueRelayAuth, buildEvent, generateKeypair, signEvent,
  type Keypair, type NostrEvent,
} from "@freedomstack/protocol";
import { RelayRole } from "../src/relay-role.js";

let port = 19_420;
const alice = generateKeypair(), bob = generateKeypair();
const notiz = (kp: Keypair, text: string, zeit: number): NostrEvent => signEvent({ ...buildEvent(kp.pk, 1, [], text), created_at: zeit }, kp.sk);
const umschlag = (an: string): NostrEvent => {
  const weg = generateKeypair();
  return signEvent(buildEvent(weg.pk, 1059, [["p", an]], "chiffrat"), weg.sk);
};
const als = (kp: Keypair, zaehler: { n: number }) => async (url: string, challenge: string) => {
  zaehler.n++;
  return signEvent(baueRelayAuth(kp.pk, url, challenge), kp.sk);
};
const speicher = (evs: NostrEvent[]) => {
  const s = new NegSpeicher();
  for (const ev of evs) s.einfuegen(ev.created_at, ev.id);
  return s.versiegeln();
};
const ids = (evs: NostrEvent[]) => evs.map((e) => e.id).sort();
const sortiert = (r: { habe: string[]; brauche: string[] }) => ({ habe: [...r.habe].sort(), brauche: [...r.brauche].sort() });

async function mitRelay(events: NostrEvent[], fn: (url: string) => Promise<void>): Promise<void> {
  const p = port++;
  // viele Events über eine Verbindung: der Flutschutz (B-3) bremst sonst das Einspielen
  const r = new RelayRole({ port: p, retentionDays: 3650, maxEventBytes: 64_000, umschlaegeSchuetzen: true,
    flutschutz: { eventsJeVerbindung: 10_000, eventsJeSchluessel: 10_000 } });
  await r.start();
  try {
    const url = `ws://127.0.0.1:${p}`;
    const sender = new WebSocketRelay(url, { autoReconnect: false });
    await Promise.all(events.map((ev) => sender.publish(ev)));
    sender.close();
    await fn(url);
  } finally {
    r.stop();
  }
}

test("B-35c1: Abgleich mit dem Relay – was fehlt, in beide Richtungen, auch über mehrere Runden", async () => {
  const gemeinsam = Array.from({ length: 1200 }, (_, i) => notiz(alice, `g${i}`, 1_760_000_000 + i));
  const nurRelay = Array.from({ length: 40 }, (_, i) => notiz(bob, `r${i}`, 1_760_000_000 + i * 70));
  const nurHier = Array.from({ length: 30 }, (_, i) => notiz(alice, `c${i}`, 1_760_000_000 + i * 90));
  await mitRelay([...gemeinsam, ...nurRelay], async (url) => {
    const k = new WebSocketRelay(url, { timeoutMs: 5000, autoReconnect: false });
    try {
      assert.deepEqual(sortiert(await k.abgleiche({ kinds: [1] }, speicher([...gemeinsam, ...nurHier]))), { habe: ids(nurHier), brauche: ids(nurRelay) });
      // der Filter wirkt, und dieselbe Verbindung gleicht mehrmals ab
      assert.deepEqual(sortiert(await k.abgleiche({ kinds: [1], authors: [bob.pk] }, speicher([]))), { habe: [], brauche: ids(nurRelay) });
      assert.deepEqual(sortiert(await k.abgleiche({ kinds: [1] }, speicher([...gemeinsam, ...nurRelay]))), { habe: [], brauche: [] });
      // was danach kommt, ist wie bisher: REQ geht weiter
      assert.equal((await k.query({ ids: [nurRelay[0]!.id] }))[0]?.id, nurRelay[0]!.id);
      // über den Pool (die App): dieselbe Verbindung; ein Relay, das der Pool nicht hat, wie eines ohne NIP-77
      const pool = new OutboxPool([k]);
      assert.deepEqual(sortiert(await pool.abgleicheAn(url, { kinds: [1], authors: [bob.pk] }, speicher(nurRelay.slice(1)))), { habe: [], brauche: [nurRelay[0]!.id] });
      await assert.rejects(pool.abgleicheAn("wss://anderes.example", { kinds: [1] }, speicher([])), (e: unknown) => e instanceof NegFehler && e.fall === "neg.zeit");
      const ohneNeg = new OutboxPool([{ url: "wss://alt.example", publish: async () => {}, query: async () => [] }]);
      await assert.rejects(ohneNeg.abgleicheAn("wss://alt.example", { kinds: [1] }, speicher([])), (e: unknown) => e instanceof NegFehler && e.fall === "neg.zeit");
    } finally {
      k.close();
    }
  });
});

test("B-35c1: Umschläge nur nach Anmeldung – einmal je Verbindung, nur über anmelden, nur die eigenen", async () => {
  const anBob = [umschlag(bob.pk), umschlag(bob.pk), umschlag(bob.pk)], anAlice = umschlag(alice.pk);
  await mitRelay([...anBob, anAlice], async (url) => {
    const filter = { kinds: [1059], "#p": [bob.pk] };
    const ohne = new WebSocketRelay(url, { timeoutMs: 3000, autoReconnect: false });
    await assert.rejects(ohne.abgleiche(filter, speicher([])), (e: unknown) => e instanceof NegFehler && e.fall === "neg.anmeldung");
    ohne.close();

    const n = { n: 0 };
    const k = new WebSocketRelay(url, { timeoutMs: 3000, autoReconnect: false, anmelden: als(bob, n) });
    try {
      assert.deepEqual(sortiert(await k.abgleiche({ kinds: [1] }, speicher([]))), { habe: [], brauche: [] });
      assert.equal(n.n, 0, "nie von selbst anmelden");
      assert.deepEqual(sortiert(await k.abgleiche(filter, speicher([anBob[0]!]))), { habe: [], brauche: ids(anBob.slice(1)) }, "nie der an Alice");
      assert.deepEqual(sortiert(await k.abgleiche(filter, speicher(anBob))), { habe: [], brauche: [] });
      assert.equal(n.n, 1, "je Verbindung einmal");
    } finally {
      k.close();
    }

    // Wer sich als jemand anderes anmeldet, bekommt keinen Abgleich – nie fremde Ids
    const m = { n: 0 };
    const fremd = new WebSocketRelay(url, { timeoutMs: 3000, autoReconnect: false, anmelden: als(alice, m) });
    await assert.rejects(fremd.abgleiche(filter, speicher([])), (e: unknown) => e instanceof NegFehler && e.fall === "neg.anmeldung");
    assert.equal(m.n, 1, "einmal versucht, dann aufgegeben");
    fremd.close();
  });
});

test("B-35c1: Relay ohne NIP-77, Ablehnung, kaputte Antworten – nur Kennungen, nie Text des Relays", async () => {
  const p = port++;
  const verhalten: Record<string, (ws: import("ws").WebSocket, sub: string) => void> = {
    still: () => { /* kennt NEG-OPEN nicht und schweigt */ },
    notiz: (ws) => ws.send(JSON.stringify(["NOTICE", "unknown type: NEG-OPEN"])),
    blockiert: (ws, sub) => ws.send(JSON.stringify(["NEG-ERR", sub, "blocked: <script>geheim</script>"])),
    kaputt: (ws, sub) => ws.send(JSON.stringify(["NEG-MSG", sub, "zz"])),
    fremdeFassung: (ws, sub) => ws.send(JSON.stringify(["NEG-MSG", sub, "62"])),
    // ein Fingerabdruck über alles, der nie passt: der Client teilt und fragt immer weiter
    endlos: (ws, sub) => ws.send(JSON.stringify(["NEG-MSG", sub, `61000001${"ff".repeat(16)}`])),
  };
  let jetzt = "still";
  let runden = 0;
  const server = new WebSocketServer({ port: p, host: "127.0.0.1" });
  server.on("connection", (ws) => ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as unknown[];
    if (m[0] !== "NEG-OPEN" && m[0] !== "NEG-MSG") return;
    runden++;
    verhalten[jetzt]!(ws, String(m[1]));
  }));
  await new Promise((ok) => server.on("listening", ok));
  const k = new WebSocketRelay(`ws://127.0.0.1:${p}`, { timeoutMs: 300, autoReconnect: false });
  const fall = async (art: string) => {
    jetzt = art;
    runden = 0;
    try {
      await k.abgleiche({ kinds: [1] }, speicher([notiz(alice, "x", 1_760_000_000)]));
      return "kein Fehler";
    } catch (e) {
      assert.ok(e instanceof NegFehler, `${art}: nur NegFehler`);
      assert.doesNotMatch(e.message, /script|geheim|unknown/, `${art}: kein Text des Relays`);
      return e.fall;
    }
  };
  try {
    assert.equal(await fall("still"), "neg.zeit");
    assert.equal(await fall("notiz"), "neg.zeit");
    assert.equal(await fall("blockiert"), "neg.abgelehnt");
    assert.equal(await fall("kaputt"), "neg.format");
    assert.equal(await fall("fremdeFassung"), "neg.fassung");
    assert.equal(await fall("endlos"), "neg.runden");
    assert.equal(runden, NEG_CLIENT.runden, "höchstens so viele Runden");
  } finally {
    k.close();
    server.close();
  }
});
