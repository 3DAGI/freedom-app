/**
 * Schritt 8.4b: Zugang zur Relay-Rolle kaufen – Sats über eine Rechnung des
 * eigenen Knotens, SOL mit Referenz nach Solana Pay, geprüft auf der Kette.
 * Abnahme: Ein beschränkter Relay nimmt einen Umschlag an Bob erst an, wenn
 * Bob bezahlt hat, und gibt ihn nur Bob heraus – bezahlt für die Zustellung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { buildEvent, generateKeypair, signEvent, solReferenz, type NostrEvent } from "@freedomstack/protocol";
import { RelayKasse, type Angebot, type KasseConfig } from "../src/relay-kasse.js";
import { RelayRole, RelayZugang } from "../src/relay-role.js";

const T0 = 1_800_000_000;
const TAG = 86400;
const ADRESSE = solReferenz(new Uint8Array(32).fill(3));
const sig = () => solReferenz(randomBytes(32)) + solReferenz(randomBytes(32)).slice(0, 44);
const ordner = () => mkdtempSync(join(tmpdir(), "relay-kauf-"));

/** Stub des eigenen LND und der Kette. */
function welt() {
  const bezahlt = new Set<string>();
  const ketten = new Map<string, unknown>();
  let lndKaputt = false;
  return {
    bezahlt, ketten,
    kaputt: (x: boolean) => { lndKaputt = x; },
    rechnungen: {
      rechnung: async (sats: number) => {
        if (lndKaputt) throw new Error("LND: interner Fehler mit /pfad/zur/macaroon");
        const hash = randomBytes(32).toString("hex");
        return { bolt11: `lnbc${sats}n1${hash.slice(0, 20)}`, hash };
      },
      bezahlt: async (hash: string) => {
        if (lndKaputt) throw new Error("LND weg");
        return bezahlt.has(hash);
      },
    },
    ladeTransaktion: async (s: string) => ketten.get(s) ?? null,
  };
}

const ueberweisung = (lamports: number, konten: string[], err: unknown = null) => ({
  meta: { err },
  transaction: { message: {
    accountKeys: ["Absender1111111111111111111111111111111111", ADRESSE, ...konten].map((pubkey) => ({ pubkey })),
    instructions: [{ program: "system", parsed: { type: "transfer", info: { source: "Absender1111111111111111111111111111111111", destination: ADRESSE, lamports } } }],
  } },
});

function kasse(w: ReturnType<typeof welt>, extra: Partial<KasseConfig> = {}) {
  const zugang = new RelayZugang();
  const k = new RelayKasse({
    tage: 30, sats: 1000, lamports: 5_000_000, solAdresse: ADRESSE,
    rechnungen: w.rechnungen, ladeTransaktion: w.ladeTransaktion, zugang, jetzt: () => T0, ...extra,
  });
  return { k, zugang: extra.zugang ?? zugang };
}

test("8.4b: Sats – Zugang erst, wenn der eigene Knoten die Rechnung als bezahlt meldet; genau einmal", async () => {
  const w = welt();
  const { k, zugang } = kasse(w);
  const bob = generateKeypair().pk;
  const a = await k.angebot(bob, "lightning") as Extract<Angebot, { schiene: "lightning" }>;
  assert.equal(a.sats, 1000);
  assert.match(a.bolt11, /^lnbc/);
  assert.deepEqual(await k.pruefe(a.id), { bezahlt: false, grund: "Noch nicht bezahlt" });
  assert.ok(!zugang.hat(bob, T0));
  w.kaputt(true);
  assert.deepEqual(await k.pruefe(a.id), { bezahlt: false, grund: "Eigener Knoten nicht erreichbar – später erneut prüfen" }, "nie die Meldung von LND");
  w.kaputt(false);
  w.bezahlt.add(a.hash);
  assert.deepEqual(await k.pruefe(a.id), { bezahlt: true, bis: T0 + 30 * TAG });
  assert.ok(zugang.hat(bob, T0 + 30 * TAG - 1));
  assert.equal((await k.pruefe(a.id)).bezahlt, false, "ein zweites Mal nicht");
  w.kaputt(true);
  await assert.rejects(k.angebot(bob, "lightning"), /^Error: Rechnung konnte nicht erstellt werden$/);
});

test("8.4b: SOL – nur mit Referenz, Betrag und Erfolg auf der Kette; eine Überweisung löst nur ein Angebot ein", async () => {
  const w = welt();
  const { k, zugang } = kasse(w);
  const [bob, carol] = [generateKeypair().pk, generateKeypair().pk];
  const a = await k.angebot(bob, "solana") as Extract<Angebot, { schiene: "solana" }>;
  const b = await k.angebot(carol, "solana") as Extract<Angebot, { schiene: "solana" }>;
  assert.equal(a.adresse, ADRESSE);
  assert.notEqual(a.referenz, b.referenz);
  const faelle: [unknown, string][] = [
    [null, "Überweisung noch nicht bestätigt"],
    [ueberweisung(5_000_000, []), "Überweisung passt nicht zum Angebot"],
    [ueberweisung(4_999_999, [a.referenz]), "Überweisung passt nicht zum Angebot"],
    [ueberweisung(5_000_000, [a.referenz], { InstructionError: [0, "x"] }), "Überweisung passt nicht zum Angebot"],
    [ueberweisung(5_000_000, [b.referenz]), "Überweisung passt nicht zum Angebot"],
  ];
  for (const [tx, grund] of faelle) {
    const s = sig();
    w.ketten.set(s, tx);
    assert.deepEqual(await k.pruefe(a.id, s), { bezahlt: false, grund });
  }
  assert.deepEqual(await k.pruefe(a.id), { bezahlt: false, grund: "Signatur der Überweisung fehlt" });
  // Eine Überweisung mit beiden Referenzen, einmal bezahlt
  const beide = sig();
  w.ketten.set(beide, ueberweisung(5_000_000, [a.referenz, b.referenz]));
  assert.deepEqual(await k.pruefe(a.id, beide), { bezahlt: true, bis: T0 + 30 * TAG });
  assert.deepEqual(await k.pruefe(b.id, beide), { bezahlt: false, grund: "Diese Überweisung wurde schon eingelöst" });
  assert.ok(zugang.hat(bob, T0) && !zugang.hat(carol, T0));
});

test("8.4b: nie in einer Schiene, die nicht eingerichtet ist; höchstens drei offene Angebote je Schlüssel", async () => {
  const w = welt();
  const nurSats = kasse(w, { lamports: undefined }).k;
  assert.deepEqual(nurSats.schienen(), ["lightning"]);
  assert.deepEqual(nurSats.preise(), { tage: 30, msat: 1_000_000 });
  await assert.rejects(nurSats.angebot(generateKeypair().pk, "solana"), /nimmt kein SOL/);
  const nurSol = kasse(w, { rechnungen: undefined }).k;
  assert.deepEqual(nurSol.preise(), { tage: 30, lamports: 5_000_000 });
  await assert.rejects(nurSol.angebot(generateKeypair().pk, "lightning"), /nimmt keine Sats/);
  await assert.rejects(nurSol.angebot("kein schlüssel", "solana"), /Schlüssel ungültig/);
  const pk = generateKeypair().pk;
  for (let i = 0; i < 3; i++) await nurSol.angebot(pk, "solana");
  await assert.rejects(nurSol.angebot(pk, "solana"), /Zu viele offene Angebote/);
});

test("8.4b: Angebote und eingelöste Überweisungen überdauern einen Neustart", async () => {
  const w = welt();
  const datei = join(ordner(), "angebote.json");
  const erst = kasse(w, { datei }).k;
  const bob = generateKeypair().pk;
  const a = await erst.angebot(bob, "solana") as Extract<Angebot, { schiene: "solana" }>;
  const b = await erst.angebot(bob, "solana") as Extract<Angebot, { schiene: "solana" }>;
  const s = sig();
  w.ketten.set(s, ueberweisung(5_000_000, [a.referenz, b.referenz]));
  // Neustart vor dem Einlösen: das Angebot ist noch da
  const zweit = kasse(w, { datei });
  await zweit.k.laden();
  assert.equal((await zweit.k.pruefe(a.id, s)).bezahlt, true);
  const dritt = kasse(w, { datei }).k;
  await dritt.laden();
  assert.deepEqual(await dritt.pruefe(b.id, s), { bezahlt: false, grund: "Diese Überweisung wurde schon eingelöst" });
  assert.equal((await dritt.pruefe(a.id, s)).bezahlt, false, "eingelöstes Angebot ist geschlossen");
});

test("8.4b: zwei Prüfungen zugleich gewähren den Zugang nur einmal", async () => {
  const w = welt();
  const { k, zugang } = kasse(w);
  const bob = generateKeypair().pk;
  const a = await k.angebot(bob, "lightning") as Extract<Angebot, { schiene: "lightning" }>;
  w.bezahlt.add(a.hash);
  const r = await Promise.all([k.pruefe(a.id), k.pruefe(a.id), k.pruefe(a.id)]);
  assert.equal(r.filter((x) => x.bezahlt).length, 1);
  assert.ok(zugang.hat(bob, T0 + 30 * TAG - 1) && !zugang.hat(bob, T0 + 30 * TAG));
});

// ------------------------------------------------------------ über den Relay

let port = 17_700;
async function client(url: string) {
  const ws = new WebSocket(url);
  const eingang: unknown[][] = [];
  let challenge = "";
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as unknown[];
    if (m[0] === "AUTH") challenge = String(m[1]);
    else eingang.push(m);
  });
  await new Promise((ok, fehler) => { ws.on("open", ok); ws.on("error", fehler); });
  const warte = async (n: number, ms = 3000) => {
    const ende = Date.now() + ms;
    while (eingang.length < n && Date.now() < ende) await new Promise((ok) => setTimeout(ok, 20));
    return eingang.splice(0, eingang.length);
  };
  while (!challenge) await new Promise((ok) => setTimeout(ok, 10));
  return { ws, warte, challenge: () => challenge, sende: (m: unknown[]) => ws.send(JSON.stringify(m)) };
}

test("8.4b Abnahme: ein Relay wird für die Zustellung bezahlt – vorher abgewiesen, danach angenommen und nur an Bob", async () => {
  const w = welt();
  const zugang = new RelayZugang();
  const { k } = kasse(w, { zugang });
  const p = port++;
  const relay = new RelayRole({ port: p, retentionDays: 7, maxEventBytes: 64_000, beschraenkt: true, zugang, kasse: k, jetzt: () => T0 });
  await relay.start();
  const url = `ws://127.0.0.1:${p}`;
  const http = `http://127.0.0.1:${p}`;
  const post = async (pfad: string, body: unknown) => {
    const r = await fetch(`${http}${pfad}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, daten: (await r.json()) as Record<string, unknown> };
  };
  try {
    const bob = generateKeypair();
    const weg = generateKeypair();
    const umschlag = signEvent(buildEvent(weg.pk, 1059, [["p", bob.pk]], "chiffrat", T0), weg.sk);
    const alice = await client(url);
    alice.sende(["EVENT", umschlag]);
    const [vorher] = await alice.warte(1);
    assert.equal(vorher[2], false, "Bob hat nicht bezahlt – nicht zugestellt");

    // NIP-11 nennt Preise und die Kaufadresse
    const info = await (await fetch(http, { headers: { Accept: "application/nostr+json" } })).json() as { fees: { subscription: unknown[] }; payments_url: string };
    assert.equal(info.fees.subscription.length, 2);
    assert.equal(info.payments_url, `${http}/zugang`);

    // Bob kauft mit Sats
    assert.equal((await post("/zugang", { pubkey: bob.pk, schiene: "bitcoin" })).status, 400);
    const { status, daten: angebot } = await post("/zugang", { pubkey: bob.pk, schiene: "lightning" });
    assert.equal(status, 200);
    assert.equal(angebot.sats, 1000);
    assert.deepEqual((await post(`/zugang/${angebot.id}`, {})).daten, { bezahlt: false, grund: "Noch nicht bezahlt" });
    w.bezahlt.add(String(angebot.hash));
    assert.deepEqual((await post(`/zugang/${angebot.id}`, {})).daten, { bezahlt: true, bis: T0 + 30 * TAG });

    // Jetzt zugestellt – und nur an den angemeldeten Bob
    alice.sende(["EVENT", umschlag]);
    assert.equal((await alice.warte(1))[0][2], true);
    const b = await client(url);
    b.sende(["AUTH", signEvent(buildEvent(bob.pk, 22242, [["relay", url], ["challenge", b.challenge()]], "", T0), bob.sk)]);
    await b.warte(1);
    b.sende(["REQ", "post", { kinds: [1059], "#p": [bob.pk] }]);
    const post1 = await b.warte(2);
    assert.equal((post1[0][2] as NostrEvent).id, umschlag.id);
    alice.sende(["REQ", "post", { kinds: [1059], "#p": [bob.pk] }]);
    assert.equal((await alice.warte(1))[0][0], "CLOSED", "Alice liest Bobs Post nicht");
    alice.ws.close();
    b.ws.close();
  } finally {
    relay.stop();
  }
  // Ein Relay ohne Kasse verkauft nichts
  const q = port++;
  const ohne = new RelayRole({ port: q, retentionDays: 7, maxEventBytes: 64_000 });
  await ohne.start();
  try {
    const r = await fetch(`http://127.0.0.1:${q}/zugang`, { method: "POST", body: "{}" });
    assert.equal(r.status, 404);
  } finally {
    ohne.stop();
  }
});

test("8.4b: Events überdauern einen Neustart; Gefälschtes in der Datei wird verworfen; voll heißt ablehnen", async () => {
  const datei = join(ordner(), "events.json");
  const kp = generateKeypair();
  const ev = (inhalt: string, kind = 1) => signEvent(buildEvent(kp.pk, kind, [], inhalt, T0), kp.sk);
  const p = port++;
  const erst = new RelayRole({ port: p, retentionDays: 7, maxEventBytes: 64_000, eventDatei: datei, maxEvents: 2, jetzt: () => T0 });
  await erst.start();
  const c = await client(`ws://127.0.0.1:${p}`);
  c.sende(["EVENT", ev("eins")]);
  c.sende(["EVENT", ev("zwei")]);
  c.sende(["EVENT", ev("drei")]);
  c.sende(["EVENT", ev("liste", 10002)]);
  const oks = await c.warte(4);
  assert.deepEqual(oks.map((m) => m[2]), [true, true, false, true]);
  assert.match(String(oks[2][3]), /^error: Relay voll/);
  c.ws.close();
  erst.stop();

  // Ein manipulierter Eintrag in der Datei kommt nicht zurück
  const gespeichert = JSON.parse((await import("node:fs")).readFileSync(datei, "utf8")) as { ev: NostrEvent; seit: number }[];
  assert.equal(gespeichert.length, 3);
  gespeichert.push({ ev: { ...ev("gefälscht"), content: "anders" }, seit: T0 });
  writeFileSync(datei, JSON.stringify(gespeichert));

  const q = port++;
  const zweit = new RelayRole({ port: q, retentionDays: 7, maxEventBytes: 64_000, eventDatei: datei, jetzt: () => T0 });
  await zweit.start();
  try {
    assert.equal(zweit.stats().events, 3);
    const d = await client(`ws://127.0.0.1:${q}`);
    d.sende(["REQ", "a", { authors: [kp.pk] }]);
    const inhalte = (await d.warte(4)).filter((m) => m[0] === "EVENT").map((m) => (m[2] as NostrEvent).content).sort();
    assert.deepEqual(inhalte, ["eins", "liste", "zwei"]);
    d.ws.close();
  } finally {
    zweit.stop();
  }
});
