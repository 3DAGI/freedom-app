/**
 * TURN-Zugänge im Knoten (B-13a, T1 A, T2 A): nur mit gültiger Umgebung,
 * je Anfrage ein frischer Zugang nach TURN-REST (so wie coturn ihn prüft),
 * nur an den Besitzer aus einem Umschlag, nie im Log.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_DVM_TURN, LocalSigner, MemoryRelay, OutboxPool, baueStatusAuftrag, baueTurnAnfrage, buildJobRequest,
  buildPrivateJobRequest, generateKeypair, leseKnotenStatus, leseTurnZugang, neueKopplung, openPrivateJobResponse,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { TURN_GEHEIMNIS_MIN, turnAusUmgebung, turnZugang } from "../src/turn.js";

const GEHEIM = "x".repeat(TURN_GEHEIMNIS_MIN);
const URLS = "turns:knoten.example:5349?transport=tcp, turn:knoten.example:3478";

test("B-13a: Umgebung – nur mit Adressen und langem Geheimnis, nie halb", () => {
  assert.deepEqual(turnAusUmgebung({}), { grund: "aus (TURN_URLS und TURN_SECRET setzen)" });
  const gut = turnAusUmgebung({ TURN_URLS: URLS, TURN_SECRET: GEHEIM });
  assert.deepEqual(gut.dienst, { urls: ["turns:knoten.example:5349?transport=tcp", "turn:knoten.example:3478"], geheimnis: GEHEIM, gueltigSek: 3600 });
  assert.match(turnAusUmgebung({ TURN_URLS: URLS }).grund!, /TURN_SECRET fehlt/);
  assert.match(turnAusUmgebung({ TURN_URLS: URLS, TURN_SECRET: "kurz" }).grund!, /kürzer als 32/);
  assert.match(turnAusUmgebung({ TURN_SECRET: GEHEIM }).grund!, /TURN_URLS ungültig/, "Geheimnis ohne Adresse ist ein Fehler, keine Wahl");
  for (const falsch of ["stun:knoten.example:3478", "https://knoten.example", "turn:a,turn:a", "turn:a,turn:b,turn:c,turn:d,turn:e"]) {
    assert.match(turnAusUmgebung({ TURN_URLS: falsch, TURN_SECRET: GEHEIM }).grund!, /TURN_URLS ungültig/, falsch);
  }
  for (const s of ["30", "100000", "x"]) assert.match(turnAusUmgebung({ TURN_URLS: URLS, TURN_SECRET: GEHEIM, TURN_GUELTIG_SEK: s }).grund!, /TURN_GUELTIG_SEK/);
  assert.equal(turnAusUmgebung({ TURN_URLS: URLS, TURN_SECRET: GEHEIM, TURN_GUELTIG_SEK: "600" }).dienst!.gueltigSek, 600);
});

test("B-13a: Zugang nach TURN-REST – so wie coturn ihn mit static-auth-secret prüft, je Anfrage ein neuer", () => {
  const d = turnAusUmgebung({ TURN_URLS: URLS, TURN_SECRET: GEHEIM }).dienst!;
  const a = turnZugang(d, 1_790_000_000), b = turnZugang(d, 1_790_000_000);
  assert.equal(a.bis, 1_790_003_600);
  assert.match(a.nutzer, /^1790003600:[A-Za-z0-9_-]{16}$/);
  assert.equal(a.passwort, createHmac("sha1", GEHEIM).update(a.nutzer).digest("base64"), "coturn rechnet dasselbe");
  assert.notEqual(a.nutzer, b.nutzer, "frischer Zufall je Zugang");
  assert.deepEqual(leseTurnZugang(JSON.stringify(a), 1_790_000_000), a, "die App liest ihn");
});

async function aufbau(mitTurn = true) {
  const relay = new MemoryRelay(`mem://turn-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], turn: mitTurn ? turnAusUmgebung({ TURN_URLS: URLS, TURN_SECRET: GEHEIM }).dienst : undefined,
    status: () => ({ fassung: "0.1.0", seit: 1, rollen: ["ki", "turn"], modelle: [], relay: null }),
  }, pool);
  return { relay, pool, kp, k, provider };
}

const antworten = async (relay: MemoryRelay, s: LocalSigner) =>
  (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s)))).flatMap((a) => (a.ok ? [a.response] : []));

test("B-13a: der Besitzer bekommt einen Zugang – versiegelt, nie im Log, zählt nicht als Auftrag", async () => {
  const { relay, pool, k, provider } = await aufbau();
  const s = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueTurnAnfrage({ sitzung: s, kopplung: k })).wrap);
  const log: string[] = [];
  const alt = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  let jobs;
  try {
    jobs = await provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.outputPreview, "TURN-Zugang an den Besitzer");
  const a = (await antworten(relay, s)).find((r) => r.kind === KIND_DVM_TURN + 1000);
  const z = leseTurnZugang(a!.content);
  assert.ok(z, a!.content);
  assert.equal(z.passwort, createHmac("sha1", GEHEIM).update(z.nutzer).digest("base64"));
  assert.ok(!log.join("\n").includes(z.passwort) && !log.join("\n").includes(z.nutzer), "der Zugang nie im Log");
  assert.equal((await relay.query({ kinds: [KIND_DVM_TURN + 1000] })).length, 0, "nie offen");
  // Status: Rolle „turn“, der Zugang zählt nicht als Auftrag
  const st = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueStatusAuftrag({ sitzung: st, kopplung: k })).wrap);
  await provider.pollOnce();
  const status = leseKnotenStatus((await antworten(relay, st)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000)!.content)!;
  assert.deepEqual(status.rollen, ["ki", "turn"]);
  assert.deepEqual(status.auftraege, { erledigt: 0, gratis: 0, abgelehnt: 0 });
});

test("B-13a: ohne Nachweis, mit fremdem Geheimnis oder ohne TURN kein Zugang – feste Rückmeldung", async () => {
  const { relay, pool, kp, provider } = await aufbau();
  const fremd = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueTurnAnfrage({ sitzung: fremd, kopplung: neueKopplung(kp.pk) })).wrap);
  const ohne = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({ kind: KIND_DVM_TURN, customerPubkey: ohne.publicKey(), input: "turn", bidMsat: 0, providerPubkey: kp.pk });
  await pool.publish((await buildPrivateJobRequest({ request: kern, sessionSigner: ohne, providerPk: kp.pk })).wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  for (const s of [fremd, ohne]) {
    const r = await antworten(relay, s);
    assert.ok(!r.some((x) => x.kind === KIND_DVM_TURN + 1000));
    assert.ok(r.some((x) => x.kind === 7000 && x.content.includes("TURN nur für den Besitzer")));
  }
  const leer = await aufbau(false);
  const s = new LocalSigner(generateKeypair().sk);
  await leer.pool.publish((await baueTurnAnfrage({ sitzung: s, kopplung: leer.k })).wrap);
  await leer.provider.pollOnce();
  assert.ok((await antworten(leer.relay, s)).some((x) => x.kind === 7000 && x.content.includes("kein TURN")));
});

test("B-13a: main.ts – Zugänge aus der Umgebung, Rolle „turn“ nur dann, an den Provider", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const \{ dienst: turn, grund: turnGrund \} = turnAusUmgebung\(process\.env\);/);
  assert.match(main, /if \(turn\) statusRollen\.add\("turn"\);/);
  assert.match(main, /keypair,\s*weckBuch,\s*turn,/);
  assert.doesNotMatch(main, /TURN_SECRET[^\n]*console\./, "das Geheimnis nie ins Log");
});
