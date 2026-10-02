/**
 * Status meines Knotens im Knoten (B-11a, L6 A – nur lesen): nur der
 * Besitzer, nur versiegelt mit Nachweis; die Antwort in fester Form, mit den
 * Aufträgen seit dem Start – ohne Text aus ihnen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_KNOTEN_STATUS, LocalSigner, MemoryRelay, OutboxPool, baueStatusAuftrag, buildJobRequest, buildPrivateJobRequest, generateKeypair,
  leseKnotenStatus, mitBesitzerNachweis, neueKopplung, openPrivateJobResponse, signEvent, type Kopplung, type KnotenStatus,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { StorageRole } from "../src/storage-role.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class MerkBackend implements InferenceBackend {
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(_req: InferenceRequest): Promise<InferenceResult> {
    return { output: "Antwort", model: "merk", promptTokens: 1, completionTokens: 5, durationMs: 1 };
  }
}

const BASIS: Pick<KnotenStatus, "fassung" | "seit" | "rollen" | "modelle" | "relay"> = {
  fassung: "0.1.0", seit: 1_790_000_000, rollen: ["ki", "speicher"], modelle: ["merk"], relay: { events: 7, verbindungen: 1 },
};

async function aufbau(mitStatus = true) {
  const relay = new MemoryRelay(`mem://status-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const storage = new StorageRole({ dir: mkdtempSync(join(tmpdir(), "status-")), quotaBytes: 0, bootstrapSeeder: false });
  await storage.init();
  const k = neueKopplung(kp.pk);
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], status: mitStatus ? () => BASIS : undefined,
  }, pool, new MerkBackend(), undefined, storage);
  return { relay, pool, kp, k, provider };
}

async function frage(pool: OutboxPool, k: Kopplung) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap, requestId } = await baueStatusAuftrag({ sitzung, kopplung: k });
  await pool.publish(wrap);
  return { sitzung, requestId };
}

async function antworten(relay: MemoryRelay, sitzung: LocalSigner) {
  const roh = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  return roh.flatMap((a) => (a.ok ? [a.response] : []));
}

test("B-11a: der Besitzer fragt – versiegelte Antwort in fester Form, Aufträge gezählt, kein Text aus ihnen", async () => {
  const { relay, pool, kp, k, provider } = await aufbau();
  // Ein Auftrag des Besitzers (gratis) und ein abgelehnter (ohne Eingabe)
  const kunde = new LocalSigner(generateKeypair().sk);
  const kern = mitBesitzerNachweis(buildJobRequest({ customerPubkey: kunde.publicKey(), input: "Geheime Frage an meinen Knoten", bidMsat: 0, providerPubkey: kp.pk }), k);
  await pool.publish((await buildPrivateJobRequest({ request: kern, sessionSigner: kunde, providerPk: kp.pk })).wrap);
  const leer = buildJobRequest({ customerPubkey: kunde.publicKey(), input: "", bidMsat: 0, providerPubkey: kp.pk });
  await pool.publish((await buildPrivateJobRequest({ request: leer, sessionSigner: kunde, providerPk: kp.pk })).wrap);
  assert.equal((await provider.pollOnce()).length, 1);

  const { sitzung, requestId } = await frage(pool, k);
  const jobs = await provider.pollOnce();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.amountMsat, 0, "kostet nichts");
  const a = (await antworten(relay, sitzung)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000);
  assert.ok(a, "Antwort versiegelt an die Sitzung");
  assert.ok(a.tags.some((t) => t[0] === "e" && t[1] === requestId));
  const s = leseKnotenStatus(a.content);
  assert.ok(s, a.content);
  assert.deepEqual(s, {
    ...BASIS,
    auftraege: { erledigt: 1, gratis: 1, abgelehnt: 1 },
    abgerechnetMsat: 0,
    speicher: { belegtBytes: 0, quotaBytes: 0, gehalten: 0 },
  });
  assert.ok(!a.content.includes("Geheime Frage"), "kein Text aus Aufträgen");
  // Die Statusabfrage selbst zählt nicht
  const zweite = await frage(pool, k);
  await provider.pollOnce();
  const b = (await antworten(relay, zweite.sitzung)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000);
  assert.deepEqual(leseKnotenStatus(b!.content)!.auftraege, { erledigt: 1, gratis: 1, abgelehnt: 1 });
});

test("B-11a: ohne Nachweis, mit fremdem Geheimnis oder offen gibt der Knoten keinen Status – Rückmeldung mit festem Text", async () => {
  const { relay, pool, kp, k, provider } = await aufbau();
  // Versiegelt ohne Nachweis
  const ohne = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({ kind: KIND_DVM_KNOTEN_STATUS, customerPubkey: ohne.publicKey(), input: "status", bidMsat: 0, providerPubkey: kp.pk });
  await pool.publish((await buildPrivateJobRequest({ request: kern, sessionSigner: ohne, providerPk: kp.pk })).wrap);
  // Mit einem anderen Geheimnis
  const fremd = await frage(pool, neueKopplung(kp.pk));
  // Offen mit Nachweis zählt nie
  const kunde = generateKeypair();
  await pool.publish(signEvent(mitBesitzerNachweis(buildJobRequest({ kind: KIND_DVM_KNOTEN_STATUS, customerPubkey: kunde.pk, input: "status", bidMsat: 0, providerPubkey: kp.pk }), k), kunde.sk));
  assert.equal((await provider.pollOnce()).length, 0);
  for (const s of [ohne, fremd.sitzung]) {
    const r = await antworten(relay, s);
    assert.ok(!r.some((x) => x.kind === KIND_DVM_KNOTEN_STATUS + 1000), "kein Status");
    assert.ok(r.some((x) => x.kind === 7000 && x.content.includes("Status nur für den Besitzer")), "fester Text");
  }
  assert.equal((await relay.query({ kinds: [KIND_DVM_KNOTEN_STATUS + 1000] })).length, 0, "nie offen");
});

test("B-11c: die Selbstprüfung geht mit, wie der Knoten sie kennt – nur Kennungen und Werte", async () => {
  const relay = new MemoryRelay(`mem://status-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const einrichtung: KnotenStatus["einrichtung"] = [{ schiene: "sol", stufe: "hinweis", fall: "sol.kanalAus", werte: {} }];
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], status: () => ({ ...BASIS, einrichtung }),
  }, pool, new MerkBackend());
  const { sitzung } = await frage(pool, k);
  await provider.pollOnce();
  const a = (await antworten(relay, sitzung)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000);
  assert.deepEqual(leseKnotenStatus(a!.content)!.einrichtung, einrichtung);
  assert.equal(leseKnotenStatus(a!.content)!.speicher, null, "ohne Speicher-Rolle null");
});

test("B-11a: ohne Status in der Konfiguration lehnt der Knoten ab", async () => {
  const { relay, pool, k, provider } = await aufbau(false);
  const { sitzung } = await frage(pool, k);
  assert.equal((await provider.pollOnce()).length, 0);
  assert.ok((await antworten(relay, sitzung)).some((x) => x.kind === 7000 && x.content.includes("kein Status")));
});

test("B-11a: main.ts – Rollen erst nach dem Start, Status aus Fassung, Start, Modellen und Relay", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /status: \(\) => \{\s*const r = relayRole\?\.stats\(\);\s*return \{\s*fassung, seit: statusSeit, rollen: \[\.\.\.statusRollen\], modelle: angebotModelle\(\), relay: r \? \{ events: r\.events, verbindungen: r\.verbindungen \} : null,/);
  // Selbstprüfung (B-11c): die Befunde vom Start, nur Kennung, Stufe und Werte – nie der Satz
  assert.match(main, /einrichtung: einrichtung\?\.map\(\(\{ schiene, stufe, fall, werte \}\) => \(\{ schiene, stufe, fall, werte: werte \?\? \{\} \}\)\),/);
  assert.match(main, /\.then\(\(befunde\) => \{\s*einrichtung = befunde;/);
  for (const [nach, rolle] of [
    ["await relayRole.start();", "relay"], ["funkGateway.starte();", "gateway"], ["starteLnurlServer(new LnurlDienst(r.konfig, r.quelle), Number(process.env.LNURL_PORT || 3601));", "lnurl"],
    ["await relayer.veroeffentlicheAngebot();", "relayer"], ["if (provider.storage) await provider.storage.init();", "speicher"],
  ] as const) {
    const i = main.indexOf(nach);
    assert.ok(i > 0 && main.indexOf(`statusRollen.add("${rolle}")`) > i, `${rolle} erst nach dem Start`);
  }
  assert.match(main, /const models = angebotModelle\(\);/, "dieselben Modelle wie im Angebot");
});
