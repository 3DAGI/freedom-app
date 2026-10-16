/**
 * Abgleich nach NIP-77 in der Relay-Rolle (B-35b): `NEG-OPEN` legt den Stand
 * fest, `NEG-MSG` bis zum Ende, `NEG-CLOSE` schließt. Abgeglichen wird nur, was
 * die Verbindung auch per `REQ` sähe – Umschläge nur für den angemeldeten
 * Empfänger. Gegen einen echten WebSocket auf einem echten Port.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { NegSpeicher, Negentropy, baueRelayAuth, buildEvent, generateKeypair, signEvent, type Keypair, type NostrEvent } from "@freedomstack/protocol";
import { NEG_RELAY, RelayRole } from "../src/relay-role.js";

let port = 19_350;
const alice = generateKeypair(), bob = generateKeypair();
const notiz = (kp: Keypair, text: string, zeit: number): NostrEvent => signEvent({ ...buildEvent(kp.pk, 1, [], text), created_at: zeit }, kp.sk);
const umschlag = (an: string): NostrEvent => {
  const weg = generateKeypair();
  return signEvent(buildEvent(weg.pk, 1059, [["p", an]], "chiffrat"), weg.sk);
};

async function mitRelay(events: NostrEvent[], fn: (url: string, r: RelayRole) => Promise<void>, flutschutz?: { abosJeVerbindung?: number }): Promise<void> {
  const p = port++;
  const r = new RelayRole({ port: p, retentionDays: 7, maxEventBytes: 64_000, umschlaegeSchuetzen: true, ...(flutschutz ? { flutschutz } : {}) });
  await r.start();
  try {
    const url = `ws://127.0.0.1:${p}`;
    const k = await verbinde(url);
    for (const ev of events) await k.frage(["EVENT", ev], (m) => m[0] === "OK");
    k.ws.close();
    await fn(url, r);
  } finally {
    r.stop();
  }
}

/** Ein Client, der auf eine passende Antwort wartet; angemeldet, wenn `als` gesetzt ist. */
async function verbinde(url: string, als?: Keypair) {
  const ws = new WebSocket(url);
  const eingang: unknown[][] = [];
  const warten: Array<() => void> = [];
  let challenge = "";
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as unknown[];
    if (m[0] === "AUTH") challenge = String(m[1]);
    eingang.push(m);
    for (const w of warten.splice(0)) w();
  });
  await new Promise((ok) => ws.on("open", ok));
  const frage = async (msg: unknown[], passt: (m: unknown[]) => boolean): Promise<unknown[]> => {
    ws.send(JSON.stringify(msg));
    for (const ende = Date.now() + 5000; Date.now() < ende;) {
      const i = eingang.findIndex(passt);
      if (i >= 0) return eingang.splice(i, 1)[0]!;
      await new Promise<void>((ok) => { warten.push(ok); setTimeout(ok, 100); });
    }
    throw new Error("keine Antwort");
  };
  while (!challenge) await new Promise((ok) => setTimeout(ok, 5));
  if (als) await frage(["AUTH", signEvent(baueRelayAuth(als.pk, url, challenge), als.sk)], (m) => m[0] === "OK");
  return { ws, frage };
}

/** Ein Abgleich vom Anfang bis zum Ende: was der Client hat, was ihm fehlt. */
async function gleicheAb(k: Awaited<ReturnType<typeof verbinde>>, filter: object, meine: NostrEvent[], sub = "neg1") {
  const s = new NegSpeicher();
  for (const ev of meine) s.einfuegen(ev.created_at, ev.id);
  const neg = new Negentropy(s.versiegeln(), 4096);
  const habe: string[] = [], brauche: string[] = [];
  let msg: unknown[] = ["NEG-OPEN", sub, filter, neg.beginne()];
  for (let runde = 0; runde < 50; runde++) {
    const antwort = await k.frage(msg, (m) => (m[0] === "NEG-MSG" || m[0] === "NEG-ERR") && m[1] === sub);
    if (antwort[0] === "NEG-ERR") return { fehler: String(antwort[2]), habe, brauche };
    const r = neg.abgleich(String(antwort[2]));
    habe.push(...r.habe);
    brauche.push(...r.brauche);
    if (r.antwort === null) {
      k.ws.send(JSON.stringify(["NEG-CLOSE", sub]));
      return { habe: habe.sort(), brauche: brauche.sort() };
    }
    msg = ["NEG-MSG", sub, r.antwort];
  }
  throw new Error("kein Ende");
}

test("B-35b: Abgleich über den Relay – was fehlt, in beide Richtungen, auch über mehrere Runden", async () => {
  const gemeinsam = Array.from({ length: 300 }, (_, i) => notiz(alice, `g${i}`, 1_760_000_000 + i));
  const nurRelay = Array.from({ length: 40 }, (_, i) => notiz(bob, `r${i}`, 1_760_000_000 + i * 7));
  const nurClient = Array.from({ length: 30 }, (_, i) => notiz(alice, `c${i}`, 1_760_000_000 + i * 3));
  await mitRelay([...gemeinsam, ...nurRelay], async (url) => {
    const k = await verbinde(url);
    const r = await gleicheAb(k, { kinds: [1] }, [...gemeinsam, ...nurClient]);
    assert.deepEqual(r.brauche, nurRelay.map((e) => e.id).sort());
    assert.deepEqual(r.habe, nurClient.map((e) => e.id).sort());
    // Filter wirkt: nur Bob
    const nurBob = await gleicheAb(k, { kinds: [1], authors: [bob.pk] }, [], "neg2");
    assert.deepEqual(nurBob.brauche, nurRelay.map((e) => e.id).sort());
    k.ws.close();
  });
});

test("B-35b: Umschläge nur für den angemeldeten Empfänger – sonst blocked, nie ihre Ids", async () => {
  const anBob = [umschlag(bob.pk), umschlag(bob.pk)], anAlice = umschlag(alice.pk);
  await mitRelay([...anBob, anAlice], async (url) => {
    const fremd = await verbinde(url);
    const r = await gleicheAb(fremd, { kinds: [1059], "#p": [bob.pk] }, []);
    assert.match(r.fehler ?? "", /^blocked: .*auth-required/);
    // ohne Kind im Filter: Umschläge fallen still weg wie beim REQ
    const alles = await gleicheAb(fremd, {}, [], "neg2");
    assert.deepEqual(alles.brauche, []);
    fremd.ws.close();
    const alsBob = await verbinde(url, bob);
    const ok = await gleicheAb(alsBob, { kinds: [1059], "#p": [bob.pk] }, []);
    assert.deepEqual(ok.brauche, anBob.map((e) => e.id).sort(), "nur die an Bob, nie der an Alice");
    alsBob.ws.close();
  });
});

test("B-35b: Grenzen und Fehler – feste Texte, ohne offenen Abgleich kein NEG-MSG, Abgleiche zählen wie Abos", async () => {
  await mitRelay([notiz(alice, "x", 1_760_000_000)], async (url) => {
    const k = await verbinde(url);
    const err = (m: unknown[]) => m[0] === "NEG-ERR" || m[0] === "NEG-MSG" || m[0] === "NOTICE";
    assert.deepEqual(await k.frage(["NEG-MSG", "unbekannt", "61"], err), ["NEG-ERR", "unbekannt", "closed: kein offener Abgleich unter dieser Kennung"]);
    assert.deepEqual(await k.frage(["NEG-OPEN", "a", {}, "zz<script>"], err), ["NEG-ERR", "a", "error: Nachricht ungültig (neg.format)"]);
    assert.deepEqual(await k.frage(["NEG-OPEN", "b", "kein Filter", "61"], err), ["NEG-ERR", "b", "error: Filter fehlt"]);
    assert.equal((await k.frage(["NEG-OPEN", "x".repeat(65), {}, "61"], err))[0], "NOTICE");
    // offen, dann geschlossen: danach gibt es ihn nicht mehr
    const s = new NegSpeicher().versiegeln();
    const erste = new Negentropy(s).beginne();
    assert.equal((await k.frage(["NEG-OPEN", "c", {}, erste], err))[0], "NEG-MSG");
    k.ws.send(JSON.stringify(["NEG-CLOSE", "c"]));
    assert.equal((await k.frage(["NEG-MSG", "c", "61"], err))[0], "NEG-ERR");
    k.ws.close();
  });
  await mitRelay([], async (url) => {
    const k = await verbinde(url);
    const erste = new Negentropy(new NegSpeicher().versiegeln()).beginne();
    const pass = (sub: string) => (m: unknown[]) => m[1] === sub;
    assert.equal((await k.frage(["REQ", "abo", {}], (m) => m[0] === "EOSE"))[0], "EOSE");
    assert.equal((await k.frage(["NEG-OPEN", "n1", {}, erste], pass("n1")))[0], "NEG-MSG");
    assert.deepEqual(await k.frage(["NEG-OPEN", "n2", {}, erste], pass("n2")), ["NEG-ERR", "n2", "blocked: zu viele offene Abos – erst eines schließen"]);
    k.ws.close();
  }, { abosJeVerbindung: 2 });
  assert.ok(NEG_RELAY.events >= 10_000 && NEG_RELAY.rahmen >= 4096);
});
