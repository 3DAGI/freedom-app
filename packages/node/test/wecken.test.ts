/**
 * Weckdienst im Knoten, erster Teil (B-12a, W1 A, W2 A): VAPID-Schlüssel
 * und Anmeldungen nur in Dateien mit 0600, Anmeldung nur vom Besitzer aus
 * einem Umschlag, die Push-Adresse nie im Log.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_DVM_WECKEN, LocalSigner, MemoryRelay, OutboxPool, WECK_SCHLUESSEL, baueStatusAuftrag, baueWeckAnmeldung,
  buildJobRequest, buildPrivateJobRequest, generateKeypair, leseKnotenStatus, leseWeckAntwort, neueKopplung, openPrivateJobResponse, type Kopplung,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { WECKEN_HOECHSTENS, WeckBuch, ladeVapid } from "../src/wecken.js";

const ENDPUNKT = "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH";
const ordner = () => mkdtempSync(join(tmpdir(), "wecken-"));

test("B-12a: VAPID-Schlüssel – beim ersten Mal erzeugt (0600), danach derselbe; der öffentliche Teil passt zum privaten", () => {
  const d = ordner();
  const datei = join(d, ".freedom", "vapid.json");
  const a = ladeVapid(datei)!;
  assert.ok(a);
  assert.match(a.oeffentlich, WECK_SCHLUESSEL);
  assert.equal(statSync(datei).mode & 0o777, 0o600, "nur für den Knoten lesbar");
  assert.equal(statSync(join(d, ".freedom")).mode & 0o777, 0o700);
  const b = ladeVapid(datei)!;
  assert.equal(b.oeffentlich, a.oeffentlich, "derselbe Schlüssel nach dem Neustart");
  // Signatur mit dem privaten Teil prüft mit dem öffentlichen (RFC 8292 braucht ES256)
  const roh = Buffer.from(a.oeffentlich, "base64url");
  const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: roh.subarray(1, 33).toString("base64url"), y: roh.subarray(33).toString("base64url") }, format: "jwk" });
  const sig = sign("sha256", Buffer.from("probe"), { key: b.privat, dsaEncoding: "ieee-p1363" });
  assert.ok(verify("sha256", Buffer.from("probe"), { key: pub, dsaEncoding: "ieee-p1363" }, sig));
  // Kaputt bleibt kaputt: kein neuer Schlüssel über einen alten
  writeFileSync(datei, "{");
  assert.equal(ladeVapid(datei), null);
  assert.equal(readFileSync(datei, "utf8"), "{");
});

test("B-12a: WeckBuch – an ersetzt dieselbe Adresse, ab entfernt, höchstens zehn, in einer Datei mit 0600", () => {
  const datei = join(ordner(), ".freedom", "wecken.json");
  const b = new WeckBuch(datei);
  const p = generateKeypair().pk, g = generateKeypair().pk;
  assert.equal(b.nimm({ aktion: "an", endpunkt: ENDPUNKT, schluessel: [p] }, 100), 1);
  assert.equal(b.nimm({ aktion: "an", endpunkt: ENDPUNKT, schluessel: [p, g] }, 200), 2, "dieselbe Adresse ersetzt");
  assert.deepEqual(b.alle(), [{ endpunkt: ENDPUNKT, schluessel: [p, g], seit: 200 }]);
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  assert.deepEqual(new WeckBuch(datei).alle(), b.alle(), "nach dem Neustart noch da");
  for (let i = 1; i < WECKEN_HOECHSTENS; i++) b.nimm({ aktion: "an", endpunkt: `${ENDPUNKT}${i}`, schluessel: [p] });
  assert.throws(() => b.nimm({ aktion: "an", endpunkt: `${ENDPUNKT}neu`, schluessel: [p] }), /zu viele Weck-Anmeldungen/);
  assert.deepEqual(b.schluessel().sort(), [p, g].sort(), "je Schlüssel einmal");
  assert.equal(b.nimm({ aktion: "ab", endpunkt: ENDPUNKT, schluessel: [] }), 0);
  assert.equal(b.alle().length, WECKEN_HOECHSTENS - 1);
  b.vergiss(`${ENDPUNKT}1`);
  assert.equal(new WeckBuch(datei).alle().length, WECKEN_HOECHSTENS - 2);
  writeFileSync(datei, '[{"endpunkt":"x","schluessel":["kein-hex"],"seit":1}]');
  assert.deepEqual(new WeckBuch(datei).alle(), [], "streng gelesen");
});

async function aufbau(mitBuch = true) {
  const relay = new MemoryRelay(`mem://wecken-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const buch = new WeckBuch(join(ordner(), "wecken.json"));
  const vapid = ladeVapid(join(ordner(), "vapid.json"))!;
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], weckBuch: mitBuch ? buch : undefined,
    status: () => ({ fassung: "0.1.0", seit: 1, rollen: ["ki"], modelle: [], relay: null, weckSchluessel: vapid.oeffentlich }),
  }, pool);
  return { relay, pool, kp, k, buch, vapid, provider };
}

async function antworten(relay: MemoryRelay, sitzung: LocalSigner) {
  const roh = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  return roh.flatMap((a) => (a.ok ? [a.response] : []));
}

async function melde(pool: OutboxPool, k: Kopplung, aktion: "an" | "ab", schluessel: string[]) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueWeckAnmeldung({ sitzung, kopplung: k, anmeldung: { aktion, endpunkt: ENDPUNKT, schluessel } })).wrap);
  return sitzung;
}

test("B-12a: der Besitzer meldet an und ab – versiegelte Antwort, im Buch gemerkt, Adresse nie im Log; der Status nennt den Weckschlüssel", async () => {
  const { relay, pool, k, buch, vapid, provider } = await aufbau();
  const person = generateKeypair().pk;
  const log: string[] = [];
  const alt = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  try {
    const s = await melde(pool, k, "an", [person]);
    const jobs = await provider.pollOnce();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.outputPreview, "Wecken an (1 Schlüssel)");
    const a = (await antworten(relay, s)).find((r) => r.kind === KIND_DVM_WECKEN + 1000);
    assert.deepEqual(leseWeckAntwort(a!.content), { aktion: "an", schluessel: 1 });
    assert.deepEqual(buch.schluessel(), [person]);
    const ab = await melde(pool, k, "ab", []);
    await provider.pollOnce();
    assert.deepEqual(leseWeckAntwort((await antworten(relay, ab)).find((r) => r.kind === KIND_DVM_WECKEN + 1000)!.content), { aktion: "ab", schluessel: 0 });
    assert.deepEqual(buch.alle(), []);
    // Status: Weckschlüssel für die App, Anmeldungen zählen nicht als Aufträge
    const st = new LocalSigner(generateKeypair().sk);
    await pool.publish((await baueStatusAuftrag({ sitzung: st, kopplung: k })).wrap);
    await provider.pollOnce();
    const status = leseKnotenStatus((await antworten(relay, st)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000)!.content)!;
    assert.equal(status.weckSchluessel, vapid.oeffentlich);
    assert.deepEqual(status.auftraege, { erledigt: 0, gratis: 0, abgelehnt: 0 });
  } finally {
    Object.assign(console, alt);
  }
  assert.ok(!log.join("\n").includes("fcm.googleapis.com"), "die Push-Adresse nie im Log");
});

test("B-12a: ohne Nachweis, mit fremdem Geheimnis, ohne Buch oder kaputt – keine Anmeldung, feste Rückmeldung", async () => {
  const { relay, pool, kp, buch, provider } = await aufbau();
  const person = generateKeypair().pk;
  const fremd = await melde(pool, neueKopplung(kp.pk), "an", [person]);
  const ohne = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({ kind: KIND_DVM_WECKEN, customerPubkey: ohne.publicKey(), input: "wecken", bidMsat: 0, providerPubkey: kp.pk,
    params: [["aktion", "an"], ["endpunkt", ENDPUNKT], ["schluessel", person]] });
  await pool.publish((await buildPrivateJobRequest({ request: kern, sessionSigner: ohne, providerPk: kp.pk })).wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  assert.deepEqual(buch.alle(), [], "nichts angemeldet");
  for (const s of [fremd, ohne]) assert.ok((await antworten(relay, s)).some((x) => x.kind === 7000 && x.content.includes("Wecken nur für den Besitzer")));
  const leer = await aufbau(false);
  const s2 = await melde(leer.pool, leer.k, "an", [person]);
  await leer.provider.pollOnce();
  assert.ok((await antworten(leer.relay, s2)).some((x) => x.kind === 7000 && x.content.includes("kein Weckdienst")));
});

test("B-12a: main.ts – Schlüssel und Buch aus ~/.freedom, Buch an den Provider, Weckschlüssel in den Status", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const vapid = ladeVapid\(vapidDatei\(\)\);/);
  assert.match(main, /const weckBuch = vapid \? new WeckBuch\(weckDatei\(\)\) : undefined;/);
  assert.match(main, /keypair,\s*weckBuch,/);
  assert.match(main, /weckSchluessel: vapid\?\.oeffentlich,/);
});
