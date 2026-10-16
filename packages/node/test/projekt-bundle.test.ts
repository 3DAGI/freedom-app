/**
 * VKl (Teil 1): ein Projekt als git-Bundle ins Blob-Netz – nur für den Besitzer, verschlüsselt, unter einem
 * Wegwerfschlüssel (nie dem des Knotens), vom Knoten selbst gehalten; den Schlüssel bekommt nur der Besitzer
 * versiegelt. Ohne Commit `code-leer`; ins Log nie der Projektname; keine Bundle-Datei bleibt liegen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_BLOB_CHUNK, KIND_BLOB_MANIFEST, KIND_DVM_KNOTEN_CODE, LocalSigner, MemoryRelay, OutboxPool, assembleBlob, baueCodeAuftrag,
  entschluesseleDatei, generateKeypair, getTag, leseCodeAntwort, neueKopplung, openPrivateJobResponse, parseBlobManifest,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { CodeAbgelehnt, ProjektAblage } from "../src/projekte.js";
import { StorageRole } from "../src/storage-role.js";

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).toString();

async function ablageMitProjekt(name: string): Promise<{ o: string; a: ProjektAblage }> {
  const o = join(mkdtempSync(join(tmpdir(), "bundle-")), "projekte");
  const a = new ProjektAblage(o);
  await a.pruefe();
  await a.neu(name);
  return { o, a };
}

test("VKl: Bundle aus dem Projekt – alle Zweige, ohne Commit code-leer, keine Datei bleibt liegen", async () => {
  const { o, a } = await ablageMitProjekt("meine-app");
  await assert.rejects(a.bundle("meine-app"), (e: unknown) => e instanceof CodeAbgelehnt && e.fall === "code-leer");
  await assert.rejects(a.bundle("../x"), /ungültig/);
  writeFileSync(join(o, "meine-app", "index.html"), "<p>hallo</p>");
  git(join(o, "meine-app"), "add", "-A");
  git(join(o, "meine-app"), "commit", "-q", "-m", "eins");
  const bytes = await a.bundle("meine-app");
  assert.match(Buffer.from(bytes.subarray(0, 20)).toString(), /^# v[23] git bundle\n/);
  const datei = join(mkdtempSync(join(tmpdir(), "pruef-")), "x.bundle");
  writeFileSync(datei, bytes);
  assert.match(git(join(o, "meine-app"), "bundle", "list-heads", datei), /refs\/heads\/main/);
  assert.deepEqual(readdirSync(o), ["meine-app"], "keine Bundle-Datei bleibt neben den Projekten");
});

test("VKl: der Besitzer bekommt das Bundle als verschlüsselten Blob – Wegwerfschlüssel, gehalten, Schlüssel nur versiegelt", async () => {
  const { o, a } = await ablageMitProjekt("geheimes-projekt");
  writeFileSync(join(o, "geheimes-projekt", "a.txt"), "x".repeat(5000));
  git(join(o, "geheimes-projekt"), "add", "-A");
  git(join(o, "geheimes-projekt"), "commit", "-q", "-m", "eins");
  const relay = new MemoryRelay(`mem://bundle-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const storage = new StorageRole({ dir: mkdtempSync(join(tmpdir(), "halten-")), quotaBytes: 0, bootstrapSeeder: false });
  await storage.init();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], projekte: a,
  }, pool, undefined, undefined, storage);

  const s = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueCodeAuftrag({ sitzung: s, kopplung: k, aktion: { aktion: "bundle", projekt: "geheimes-projekt" } })).wrap);
  const log: string[] = [];
  const alt = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  try {
    assert.equal((await provider.pollOnce()).length, 1);
  } finally {
    Object.assign(console, alt);
  }
  const roh = (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s))))
    .flatMap((x) => (x.ok ? [x.response] : [])).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!;
  const antwort = leseCodeAntwort(roh.content, "bundle");
  assert.ok(antwort && antwort.aktion === "bundle", roh.content);

  // Im Blob-Netz: Manifest und Stücke, alle als verschlüsselt gekennzeichnet, von einem fremden Schlüssel
  const [manifestEv] = await relay.query({ kinds: [KIND_BLOB_MANIFEST], ids: [antwort.manifest] });
  assert.ok(manifestEv);
  assert.notEqual(manifestEv.pubkey, kp.pk, "nie unter dem Schlüssel des Knotens");
  const stuecke = await relay.query({ kinds: [KIND_BLOB_CHUNK], "#blob": [antwort.blob] });
  assert.ok(stuecke.length > 0 && stuecke.every((c) => c.pubkey === manifestEv.pubkey && getTag(c, "verschluesselt") === "1"));
  assert.ok(stuecke.every((c) => storage.haelt(getTag(c, "sha256")!)), "der Knoten hält jedes Stück selbst");
  assert.ok(!JSON.stringify([manifestEv, ...stuecke]).includes(antwort.schluessel.key), "der Schlüssel steht nur in der versiegelten Antwort");

  // Zusammengesetzt und entschlüsselt: das Bundle des Projekts
  const m = parseBlobManifest(manifestEv);
  const { bytes: chiffrat, complete } = await assembleBlob(m, new Map(stuecke.map((c) => [Number(getTag(c, "index")), c.content])));
  assert.ok(complete);
  const bundle = entschluesseleDatei(chiffrat, antwort.schluessel);
  assert.equal(bundle.length, antwort.bytes);
  const datei = join(mkdtempSync(join(tmpdir(), "pruef-")), "x.bundle");
  writeFileSync(datei, bundle);
  assert.match(git(join(o, "geheimes-projekt"), "bundle", "list-heads", datei), /refs\/heads\/main/);
  assert.ok(!log.join("\n").includes("geheimes-projekt"), "der Projektname nie im Log");
});
