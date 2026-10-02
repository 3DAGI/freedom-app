/**
 * Der Relay im eigenen Prozess (B-9c1, L5 A): Der Knoten liest und schreibt
 * im eigenen Relay ohne WebSocket, als sei er mit seinem Schlüssel angemeldet.
 * Eine Anfrage, die nur über sein Relay kommt, erreicht den Provider; die
 * Antwort liegt dort und geht nur an den angemeldeten Sitzungsschlüssel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_TEXT_GENERATION, LocalSigner, OutboxPool, WebSocketRelay, baueRelayAuth, buildEvent, buildJobRequest, buildPrivateJobRequest,
  generateKeypair, mitBesitzerNachweis, neueKopplung, openPrivateJobResponse, signEvent, type Keypair, type NostrEvent,
} from "@freedomstack/protocol";
import { RelayRole, RelayZugang } from "../src/relay-role.js";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

let port = 18_200;
const umschlag = (an: string): NostrEvent => {
  const weg = generateKeypair();
  return signEvent(buildEvent(weg.pk, 1059, [["p", an]], "chiffrat"), weg.sk);
};
const als = (kp: Keypair) => async (url: string, challenge: string) => signEvent(baueRelayAuth(kp.pk, url, challenge), kp.sk);

async function mitRelay<T>(cfg: Partial<ConstructorParameters<typeof RelayRole>[0]>, fn: (url: string, r: RelayRole) => Promise<T>): Promise<T> {
  const p = port++;
  const r = new RelayRole({ port: p, retentionDays: 7, maxEventBytes: 64_000, umschlaegeSchuetzen: true, ...cfg });
  await r.start();
  try {
    return await fn(`ws://127.0.0.1:${p}`, r);
  } finally {
    r.stop();
  }
}

class MerkBackend implements InferenceBackend {
  prompts: string[] = [];
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.prompts.push(JSON.stringify(req));
    return { output: "Antwort aus dem eigenen Relay", model: "merk", promptTokens: 1, completionTokens: 5, durationMs: 1 };
  }
}

test("B-9c1: alsRelay – dieselben Regeln wie über das Netz, Umschläge nur an den Knoten", async () => {
  const knoten = generateKeypair();
  await mitRelay({ oeffentlicheUrl: "wss://knoten.example/" }, async (url, r) => {
    const intern = r.alsRelay(knoten.pk);
    assert.equal(intern.url, "wss://knoten.example", "die öffentliche Adresse – so ersetzt sie eine Verbindung zu sich selbst");
    const an = umschlag(knoten.pk), fremd = umschlag(generateKeypair().pk);
    // Über das Netz eingegangen, im Prozess gelesen
    const s = new WebSocketRelay(url, { autoReconnect: false });
    for (const e of [an, fremd]) await s.publish(e);
    s.close();
    assert.deepEqual((await intern.query({ kinds: [1059] })).map((e) => e.id), [an.id], "nur Umschläge an den Knoten");
    // Im Prozess geschrieben, über das Netz gelesen
    const notiz = signEvent(buildEvent(knoten.pk, 1, [], "vom Knoten"), knoten.sk);
    await intern.publish(notiz);
    const leser = new WebSocketRelay(url, { timeoutMs: 2000, autoReconnect: false });
    assert.deepEqual((await leser.query({ kinds: [1], authors: [knoten.pk] })).map((e) => e.id), [notiz.id]);
    leser.close();
    // Kaputt bleibt kaputt
    await assert.rejects(intern.publish({ ...notiz, content: "verändert" }), /invalid signature/);
  });
  // Beschränkt: auch im Prozess nur von oder an Schlüssel mit Zugang
  await mitRelay({ beschraenkt: true, zugang: new RelayZugang(undefined, [knoten.pk]) }, async (_url, r) => {
    const intern = r.alsRelay(knoten.pk);
    const fremd = generateKeypair();
    await assert.rejects(intern.publish(signEvent(buildEvent(fremd.pk, 1, [], "x"), fremd.sk)));
    await intern.publish(signEvent(buildEvent(knoten.pk, 1, [], "eigen"), knoten.sk));
  });
});

test("B-9c1: nur über das Relay des Knotens – Anfrage kommt an, die Antwort nur an den angemeldeten Sitzungsschlüssel", async () => {
  const kp: Keypair = generateKeypair();
  const k = neueKopplung(kp.pk);
  await mitRelay({}, async (url, r) => {
    const backend = new MerkBackend();
    // Der Pool des Knotens kennt nur den Weg im Prozess – kein fremdes Relay
    const pool = new OutboxPool([r.alsRelay(kp.pk)], { minAcks: 1 });
    const provider = new DvmProvider({
      keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", besitzer: () => [k.geheimnis],
    }, pool, backend);
    const sitzungKp = generateKeypair();
    const sitzung = new LocalSigner(sitzungKp.sk);
    const kern = mitBesitzerNachweis(buildJobRequest({ customerPubkey: sitzung.publicKey(), input: "Frage nur über mein Relay", bidMsat: 0, providerPubkey: kp.pk }), k);
    const { wrap, requestId } = await buildPrivateJobRequest({ request: kern, sessionSigner: sitzung, providerPk: kp.pk });
    // Die App meldet sich am Relay des eigenen Knotens mit dem Sitzungsschlüssel an (L5 A)
    const app = new WebSocketRelay(url, { timeoutMs: 3000, autoReconnect: false, anmelden: als(sitzungKp) });
    await app.publish(wrap);
    const jobs = await provider.pollOnce();
    assert.equal(jobs.length, 1, "die Anfrage erreicht den Provider nur über sein Relay");
    assert.ok(backend.prompts.some((p) => p.includes("Frage nur über mein Relay")));
    // Die Antwort liegt im Relay des Knotens – für den angemeldeten Sitzungsschlüssel
    const post = await app.query({ kinds: [1059], "#p": [sitzung.publicKey()] });
    const antworten = (await Promise.all(post.map((w) => openPrivateJobResponse(w, sitzung)))).flatMap((a) => (a.ok ? [a.response] : []));
    const antwort = antworten.find((a) => a.kind === KIND_DVM_TEXT_GENERATION + 1000 && a.tags.some((t) => t[0] === "e" && t[1] === requestId));
    assert.ok(antwort, "Antwort versiegelt an die Sitzung, im eigenen Relay");
    assert.equal(antwort.content, "Antwort aus dem eigenen Relay");
    // Ohne Anmeldung bekommt niemand die Antwort
    const ohne = new WebSocketRelay(url, { timeoutMs: 1500, autoReconnect: false });
    assert.deepEqual(await ohne.query({ kinds: [1059], "#p": [sitzung.publicKey()] }), []);
    ohne.close();
    app.close();
  });
});

test("B-9c1: main.ts – der Weg im Prozess ersetzt eine Verbindung zu sich selbst, erst nach dem Start", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const start = main.indexOf("await relayRole.start();");
  const intern = main.indexOf("const intern = relayRole.alsRelay(keypair.pk);");
  assert.ok(start > 0 && intern > start);
  assert.match(main.slice(intern), /^const intern = relayRole\.alsRelay\(keypair\.pk\);\s*pool\.removeRelay\(intern\.url\);\s*pool\.addRelay\(intern\);/);
});
