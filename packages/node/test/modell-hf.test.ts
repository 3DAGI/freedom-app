/**
 * Schritt B-29c1a: Gewichte von Hugging Face in einen Ordner laden, geprüft
 * gegen ein Manifest. Hugging Face ist aus dieser Umgebung nicht erreichbar –
 * eine Attrappe auf 127.0.0.1 antwortet wie die echte API (Stand je Commit mit
 * `blobs=true`, Dateien unter `resolve/<commit>/`, LFS über eine Weiterleitung).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leseHfName, type ModelFile } from "@freedomstack/protocol";
import { gitKennung, halteHfFest, hfOrdner, holeHfStand, ladeHfDatei, summeDerDatei } from "../src/modell-hf.js";

const COMMIT = "c".repeat(40);
const NAME = leseHfName("Qwen/Qwen2.5-0.5B-Instruct")!;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const config = Buffer.from(JSON.stringify({ architectures: ["Qwen2ForCausalLM"], hidden_size: 896 }));
const tokenizer = Buffer.from(JSON.stringify({ version: "1.0", model: { type: "BPE" } }));
const gewichte = Buffer.alloc(300_000, 7);
const inhalt: Record<string, Buffer> = { "config.json": config, "tokenizer.json": tokenizer, "model.safetensors": gewichte };
const stand = (aendern: Partial<Record<string, Buffer>> = {}) => ({
  id: NAME.voll, sha: COMMIT, cardData: { license: "apache-2.0" },
  siblings: [
    { rfilename: "README.md", size: 10, blobId: "1".repeat(40) },
    { rfilename: "config.json", size: config.length, blobId: gitKennung(aendern["config.json"] ?? config) },
    { rfilename: "tokenizer.json", size: tokenizer.length, blobId: gitKennung(tokenizer) },
    { rfilename: "model.safetensors", size: gewichte.length, blobId: "2".repeat(40), lfs: { sha256: sha(gewichte), size: gewichte.length, pointerSize: 135 } },
    { rfilename: "pytorch_model.bin", size: 5, blobId: "3".repeat(40), lfs: { sha256: "4".repeat(64), size: 5, pointerSize: 135 } },
  ],
});
const MANIFEST_DATEIEN: ModelFile[] = Object.entries(inhalt).map(([name, b]) => ({ name, sha256: sha(b), sizeBytes: b.length }));
const datei = (name: string) => MANIFEST_DATEIEN.find((f) => f.name === name)!;

interface Attrappe { url: string; schliessen: () => void; pfade: string[] }
/** Hugging Face als Attrappe; `liefere` kann einzelne Dateien ersetzen. */
function huggingface(o: { liefere?: Record<string, Buffer>; status?: number; standJson?: unknown; weiter?: string; stehen?: boolean } = {}): Promise<Attrappe> {
  const pfade: string[] = [];
  const s = http.createServer((req, res) => {
    const pfad = req.url ?? "";
    pfade.push(pfad);
    if (o.status) { res.writeHead(o.status); return void res.end("Zugang nur mit Anmeldung – fremder Text"); }
    if (pfad === `/api/models/${NAME.org}/${NAME.repo}/revision/main?blobs=true` || pfad === `/api/models/${NAME.org}/${NAME.repo}/revision/${COMMIT}?blobs=true`) {
      return void res.end(JSON.stringify(o.standJson ?? stand()));
    }
    const m = /^\/Qwen\/Qwen2\.5-0\.5B-Instruct\/resolve\/([0-9a-f]{40})\/(.+)$/.exec(pfad);
    if (m && m[1] === COMMIT) {
      const name = decodeURIComponent(m[2]!);
      // Große Dateien leitet Hugging Face an seinen Speicher weiter (LFS)
      if (name.endsWith(".safetensors")) { res.writeHead(302, { location: o.weiter ?? `/speicher/${name}` }); return void res.end(); }
      const b = o.liefere?.[name] ?? inhalt[name];
      return void res.end(b);
    }
    if (pfad.startsWith("/speicher/")) {
      const b = o.liefere?.["model.safetensors"] ?? gewichte;
      res.writeHead(200, { "content-length": String(b.length) });
      if (o.stehen) return void res.write(b.subarray(0, 1000)); // schickt nichts mehr
      for (let i = 0; i < b.length; i += 65_536) res.write(b.subarray(i, i + 65_536));
      return void res.end();
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, schliessen: () => { s.closeAllConnections(); s.close(); }, pfade })));
}
const ordner = () => join(mkdtempSync(join(tmpdir(), "hf-")), "modelle", NAME.org, NAME.repo);

test("Git-Kennung: wie `git hash-object` (SHA-1 über „blob <Länge>\\0“ und Inhalt)", () => {
  assert.equal(gitKennung(Buffer.from("")), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  assert.equal(gitKennung(Buffer.from("hallo\n")), "4cf5aa5f9a644263dbe3d6e78bcbef45487a802c");
  assert.equal(hfOrdner("/basis", NAME), join("/basis", "Qwen", "Qwen2.5-0.5B-Instruct"));
});

test("Stand holen: Commit und erlaubte Dateien; gesperrt, fehlt, kaputt und zu groß nur mit Namen, nie mit Text von Hugging Face", async () => {
  const hf = await huggingface();
  try {
    const s = await holeHfStand(NAME, "main", hf.url);
    assert.ok(s.ok);
    assert.equal(s.commit, COMMIT);
    assert.deepEqual(s.dateien.map((d) => d.name), ["config.json", "tokenizer.json", "model.safetensors"]);
    assert.deepEqual(await holeHfStand(NAME, "refs/pr/1", hf.url), { ok: false, fall: "hf.form" });
  } finally { hf.schliessen(); }
  for (const [status, name] of [[401, "HfGesperrt"], [403, "HfGesperrt"], [404, "HfFehlt"], [500, "HfAntwort"]] as const) {
    const x = await huggingface({ status });
    try {
      await assert.rejects(holeHfStand(NAME, "main", x.url), (e: Error) => e.name === name && !e.message.includes("fremd"));
    } finally { x.schliessen(); }
  }
  const kaputt = await huggingface({ standJson: { sha: "main", siblings: [] } });
  try { assert.deepEqual(await holeHfStand(NAME, "main", kaputt.url), { ok: false, fall: "hf.form" }); } finally { kaputt.schliessen(); }
  const riesig = await huggingface({ standJson: { ...stand(), padding: "x".repeat(3 * 1024 * 1024) } });
  try { assert.deepEqual(await holeHfStand(NAME, "main", riesig.url), { ok: false, fall: "hf.form" }); } finally { riesig.schliessen(); }
});

test("Festhalten: LFS-Summe von Hugging Face, kleine Dateien erst gegen ihre Git-Kennung geprüft und selbst gerechnet", async () => {
  const hf = await huggingface();
  try {
    const f = await halteHfFest(NAME, "main", hf.url);
    assert.ok(f.ok);
    assert.equal(f.commit, COMMIT);
    assert.equal(f.lizenz, "apache-2.0");
    assert.deepEqual(f.dateien, ["config.json", "tokenizer.json", "model.safetensors"].map(datei), "in der Reihenfolge von Hugging Face");
    // Die großen Gewichte lädt das Festhalten nicht – nur die kleinen Dateien, am Commit
    assert.deepEqual(hf.pfade.filter((p) => p.includes("/resolve/")).sort(), [`/Qwen/Qwen2.5-0.5B-Instruct/resolve/${COMMIT}/config.json`, `/Qwen/Qwen2.5-0.5B-Instruct/resolve/${COMMIT}/tokenizer.json`]);
  } finally { hf.schliessen(); }
  // Liefert Hugging Face andere Bytes als seine eigene Git-Kennung sagt: kein Manifest
  const falsch = await huggingface({ liefere: { "config.json": Buffer.from('{"hidden_size":1}') } });
  try { assert.deepEqual(await halteHfFest(NAME, "main", falsch.url), { ok: false, fall: "hf.anders" }); } finally { falsch.schliessen(); }
  const mehr = await huggingface({ liefere: { "config.json": Buffer.concat([config, Buffer.from(" ")]) } });
  try { assert.deepEqual(await halteHfFest(NAME, "main", mehr.url), { ok: false, fall: "hf.anders" }); } finally { mehr.schliessen(); }
});

test("Laden: über die Weiterleitung in den Ordner, SHA-256 beim Laden, erst danach unter dem Namen; zweites Mal nichts geladen", async () => {
  const hf = await huggingface();
  const ziel = ordner();
  try {
    const stand: number[] = [];
    assert.equal(await ladeHfDatei(NAME, COMMIT, ziel, datei("model.safetensors"), { basis: hf.url, fortschritt: (b) => stand.push(b) }), "geladen");
    assert.equal(await summeDerDatei(join(ziel, "model.safetensors")), sha(gewichte));
    assert.equal(stand.at(-1), gewichte.length);
    assert.equal(statSync(join(ziel, "model.safetensors")).mode & 0o777, 0o644, "der Antrieb (anderer Dienst) muss lesen können");
    assert.equal(await ladeHfDatei(NAME, COMMIT, ziel, datei("config.json"), { basis: hf.url }), "geladen");
    assert.deepEqual(readFileSync(join(ziel, "config.json")), config);
    const vorher = hf.pfade.length;
    assert.equal(await ladeHfDatei(NAME, COMMIT, ziel, datei("model.safetensors"), { basis: hf.url }), "vorhanden");
    assert.equal(hf.pfade.length, vorher, "nichts geladen");
    // Eine veränderte Datei im Ordner wird neu geladen
    writeFileSync(join(ziel, "config.json"), Buffer.alloc(config.length, 32));
    assert.equal(await ladeHfDatei(NAME, COMMIT, ziel, datei("config.json"), { basis: hf.url }), "geladen");
    assert.deepEqual(readFileSync(join(ziel, "config.json")), config);
    assert.deepEqual(readdirSync(ziel).sort(), ["config.json", "model.safetensors"], "kein Bruchstück übrig");
  } finally { hf.schliessen(); }
});

test("Laden: falsche Bytes, zu viele Bytes, stehende Leitung – abgebrochen, kein Bruchstück, keine Datei unter dem Namen", async () => {
  const anders = Buffer.from(gewichte); anders[1234] = 8;
  for (const [liefere, fehler] of [[anders, "DateiAnders"], [Buffer.concat([gewichte, Buffer.alloc(10)]), "DateiZuGross"], [gewichte.subarray(0, 1000), "DateiAnders"]] as const) {
    const hf = await huggingface({ liefere: { "model.safetensors": liefere } });
    const ziel = ordner();
    try {
      await assert.rejects(ladeHfDatei(NAME, COMMIT, ziel, datei("model.safetensors"), { basis: hf.url }), (e: Error) => e.name === fehler);
      assert.deepEqual(readdirSync(ziel), [], fehler);
    } finally { hf.schliessen(); }
  }
  const steht = await huggingface({ stehen: true });
  const ziel = ordner();
  try {
    await assert.rejects(ladeHfDatei(NAME, COMMIT, ziel, datei("model.safetensors"), { basis: steht.url, stillMs: 200 }), (e: Error) => e.name === "HfStill");
    assert.deepEqual(readdirSync(ziel), []);
  } finally { steht.schliessen(); }
  const gesperrt = await huggingface({ status: 401 });
  try {
    await assert.rejects(ladeHfDatei(NAME, COMMIT, ordner(), datei("config.json"), { basis: gesperrt.url }), (e: Error) => e.name === "HfGesperrt");
  } finally { gesperrt.schliessen(); }
});

test("Laden: nur Namen aus dem Ordner (kein Pfad, kein Pickle), nur am Commit, keine Weiterleitung von https zu http", async () => {
  const ziel = ordner();
  for (const name of ["../config.json", "pytorch_model.bin", "modeling.py", "unter/model.safetensors"]) {
    await assert.rejects(ladeHfDatei(NAME, COMMIT, ziel, { name, sha256: "0".repeat(64), sizeBytes: 1 }), (e: Error) => e.name === "DateiName", name);
  }
  await assert.rejects(ladeHfDatei(NAME, "main", ziel, datei("config.json")), (e: Error) => e.name === "DateiName");
  assert.equal(existsSync(ziel), false, "nichts angelegt");
  // https → http: die Antwort einer Weiterleitung nennt ein anderes Schema
  const holen = async (url: string) => Object.defineProperty(new Response(gewichte), "url", { value: url.replace("https:", "http:") });
  await assert.rejects(ladeHfDatei(NAME, COMMIT, ziel, datei("model.safetensors"), { holen }), (e: Error) => e.name === "HfWeiterleitung");
});
