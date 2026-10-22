/**
 * Schritt B-38b3b1: Whisper-Modelle über ein Manifest (Entwurf `docs/SPRACHE-ENTWURF.md` V4, SP-W4 C) – genau eine
 * Datei `ggml-<name>.bin` aus dem Repo von whisper.cpp an einem Commit, gewählt wie andere Modelle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { buildModelManifest, parseModelManifest, type ModelFile } from "../src/model-registry.js";
import { HF_DATEI, hfQuelle, hfStandAdresse } from "../src/modell-hf.js";
import { vertrautesManifest } from "../src/modell-ollama.js";
import {
  GGML_KENNUNG, WHISPER_DATEI, WHISPER_HF, WHISPER_MAX_BYTES, WHISPER_VORGABE, istGgml, leseWhisperName, whisperDatei,
  whisperDateiAdresse, whisperKennung, whisperQuelle, whisperStand,
} from "../src/modell-whisper.js";

const T = 1_800_000_000;
const hex = (n: number, l = 64) => n.toString(16).padStart(l, "0");
const COMMIT = "5359861c739e955e79d9a303bcbc70fb988958b1";
const KNOTEN = generateKeypair(), KURATOR = generateKeypair();

/** Antwort von `/api/models/ggerganov/whisper.cpp/revision/<rev>?blobs=true` (gekürzt, Werte erfunden, Form wie dort). */
const antwort = {
  _id: "x", id: "ggerganov/whisper.cpp", sha: COMMIT, cardData: { license: "mit" },
  siblings: [
    { rfilename: ".gitattributes", size: 1477, blobId: hex(1, 40) },
    { rfilename: "README.md", size: 2600, blobId: hex(2, 40) },
    { rfilename: "ggml-base.bin", size: 147_951_465, blobId: hex(3, 40), lfs: { sha256: hex(30), size: 147_951_465, pointerSize: 134 } },
    { rfilename: "ggml-base.en.bin", size: 147_964_211, blobId: hex(4, 40), lfs: { sha256: hex(40), size: 147_964_211, pointerSize: 134 } },
    { rfilename: "ggml-base-encoder.mlmodelc.zip", size: 37_922_638, blobId: hex(5, 40), lfs: { sha256: hex(50), size: 37_922_638, pointerSize: 133 } },
    { rfilename: "ggml-large-v3-turbo-q5_0.bin", size: 574_041_195, blobId: hex(6, 40), lfs: { sha256: hex(60), size: 574_041_195, pointerSize: 134 } },
    { rfilename: "ggml-large-v3.bin", size: 3_095_033_483, blobId: hex(7, 40), lfs: { sha256: hex(70), size: 3_095_033_483, pointerSize: 135 } },
  ],
};
const TURBO: ModelFile = { name: "ggml-large-v3-turbo-q5_0.bin", sha256: hex(60), sizeBytes: 574_041_195 };
const manifest = (o: { kp?: typeof KNOTEN; at?: number; model?: string; files?: ModelFile[]; upstream?: string } = {}): NostrEvent => {
  const kp = o.kp ?? KNOTEN;
  return signEvent(buildModelManifest({
    modelId: o.model ?? "whisper:large-v3-turbo-q5_0", name: "Whisper large-v3-turbo q5_0", files: o.files ?? [TURBO],
    upstream: "upstream" in o ? o.upstream : `hf:ggerganov/whisper.cpp@${COMMIT}`, license: "MIT", publisherPubkey: kp.pk,
  }, o.at ?? T), kp.sk);
};

test("Namen: wie whisper.cpp sie schreibt, mit oder ohne Vorsatz; Kennung und Datei daraus", () => {
  for (const name of ["base", "small.en", "large-v3-turbo-q5_0", "tiny.en-q8_0", WHISPER_VORGABE.gpu, WHISPER_VORGABE.cpu]) {
    assert.equal(leseWhisperName(name), name, name);
    assert.equal(leseWhisperName(whisperKennung(name)), name, `whisper:${name}`);
    assert.ok(WHISPER_DATEI.test(whisperDatei(name)), whisperDatei(name));
  }
  assert.equal(whisperKennung("base"), "whisper:base");
  assert.equal(whisperDatei("large-v3-turbo-q5_0"), "ggml-large-v3-turbo-q5_0.bin");
  for (const falsch of ["", "Base", "a/b", "../base", "base..en", ".base", "base.", "-base", "base bin", "whisper:", "whisper:whisper:base", `${"a".repeat(49)}`]) {
    assert.equal(leseWhisperName(falsch), null, falsch);
  }
  assert.deepEqual(WHISPER_VORGABE, { gpu: "large-v3-turbo-q5_0", cpu: "base" }, "SP-W4 C");
  // Die Regel „nie Pickle“ für Hugging Face bleibt: `.bin` gibt es nur auf diesem Weg
  assert.equal(HF_DATEI.test("ggml-base.bin"), false);
  for (const falsch of ["ggml-base.en.bin.zip", "ggml-base-encoder.mlmodelc.zip", "pytorch_model.bin", "ggml-Base.bin", "x/ggml-base.bin"]) {
    assert.equal(WHISPER_DATEI.test(falsch), false, falsch);
  }
});

test("Adressen: Stand wie bei Hugging Face, die Datei nur am Commit und nur aus dem Repo von whisper.cpp", () => {
  assert.equal(WHISPER_HF.voll, "ggerganov/whisper.cpp");
  assert.equal(hfStandAdresse(WHISPER_HF), "https://huggingface.co/api/models/ggerganov/whisper.cpp/revision/main?blobs=true");
  assert.equal(whisperDateiAdresse(COMMIT, "large-v3-turbo-q5_0"),
    `https://huggingface.co/ggerganov/whisper.cpp/resolve/${COMMIT}/ggml-large-v3-turbo-q5_0.bin`);
  assert.equal(whisperDateiAdresse(COMMIT, "base", "http://127.0.0.1:9"), `http://127.0.0.1:9/ggerganov/whisper.cpp/resolve/${COMMIT}/ggml-base.bin`);
  for (const [commit, name] of [["main", "base"], [COMMIT.slice(1), "base"], [COMMIT.toUpperCase(), "base"], [COMMIT, "whisper:base"], [COMMIT, "../base"], [COMMIT, "a/b"], [COMMIT, ""]]) {
    assert.equal(whisperDateiAdresse(commit!, name!), null, `${commit} ${name}`);
  }
});

test("Stand von Hugging Face: genau die eine Datei mit LFS-Summe und Größe, Commit und Lizenz – sonst eine Kennung", () => {
  assert.deepEqual(whisperStand(antwort, "large-v3-turbo-q5_0"), { ok: true, commit: COMMIT, datei: TURBO, lizenz: "mit" });
  assert.deepEqual(whisperStand(antwort, "base"), { ok: true, commit: COMMIT, datei: { name: "ggml-base.bin", sha256: hex(30), sizeBytes: 147_951_465 }, lizenz: "mit" },
    "nie ggml-base.en.bin oder das Core-ML-Archiv dazu");
  assert.deepEqual(whisperStand(antwort, "medium"), { ok: false, fall: "whisper.fehlt" });
  const mit = (aendere: (s: (typeof antwort.siblings)[number]) => object) =>
    ({ ...antwort, siblings: antwort.siblings.map((s) => (s.rfilename === TURBO.name ? aendere(s) : s)) });
  const form = { ok: false, fall: "whisper.form" };
  for (const [was, j] of [
    ["ohne Commit", { ...antwort, sha: undefined }],
    ["Zweig statt Commit", { ...antwort, sha: "main" }],
    ["ohne Liste", { ...antwort, siblings: "x" }],
    ["keine Antwort", null],
    ["ohne LFS (keine Summe vorher)", mit(({ lfs: _l, ...s }) => s)],
    ["LFS ohne Summe", mit((s) => ({ ...s, lfs: { size: s.size } }))],
    ["Summe kein Hex", mit((s) => ({ ...s, lfs: { ...s.lfs, sha256: "Z".repeat(64) } }))],
    ["LFS-Größe anders", mit((s) => ({ ...s, lfs: { ...s.lfs, size: s.size + 1 } }))],
    ["Größe 0", mit((s) => ({ ...s, size: 0, lfs: { ...s.lfs, size: 0 } }))],
    ["Größe als Text", mit((s) => ({ ...s, size: String(s.size) }))],
    ["zu groß", mit((s) => ({ ...s, size: WHISPER_MAX_BYTES + 1, lfs: { ...s.lfs, size: WHISPER_MAX_BYTES + 1 } }))],
    ["doppelt", { ...antwort, siblings: [...antwort.siblings, antwort.siblings[5]] }],
  ] as const) {
    assert.deepEqual(whisperStand(j, "large-v3-turbo-q5_0"), form, was);
  }
  assert.equal((whisperStand({ ...antwort, cardData: { license: "MIT <script>" } }, "base") as { lizenz?: string }).lizenz, undefined, "Lizenz nur als Kennung");
});

test("Quelle eines Manifests: whisper:<name>, hf:ggerganov/whisper.cpp@<Commit>, genau ggml-<name>.bin", () => {
  assert.deepEqual(whisperQuelle(parseModelManifest(manifest())), { name: "large-v3-turbo-q5_0", commit: COMMIT, datei: { ...TURBO, blobId: undefined } });
  const nie = (o: Parameters<typeof manifest>[0], was: string) => assert.equal(whisperQuelle(parseModelManifest(manifest(o))), null, was);
  nie({ model: "large-v3-turbo-q5_0" }, "ohne Vorsatz – wäre ein Name bei Ollama");
  nie({ model: "whisper:base" }, "Datei passt nicht zum Namen");
  nie({ model: "whisper:../x" }, "Name ungültig");
  nie({ upstream: "hf:ggerganov/whisper.cpp@main" }, "Zweig statt Commit");
  nie({ upstream: `hf:jemand/whisper.cpp@${COMMIT}` }, "anderes Repo");
  nie({ upstream: `ollama:whisper@${COMMIT}` }, "andere Quelle");
  nie({ upstream: undefined }, "ohne Herkunft");
  nie({ files: [TURBO, { name: "ggml-base.bin", sha256: hex(30), sizeBytes: 1 }] }, "zwei Dateien");
  nie({ files: [{ ...TURBO, name: "pytorch_model.bin" }] }, "Pickle");
  nie({ files: [{ ...TURBO, sizeBytes: WHISPER_MAX_BYTES + 1 }] }, "zu groß");
  // Und umgekehrt: Ein Whisper-Manifest ist kein Modell von Hugging Face für einen Antrieb
  assert.equal(hfQuelle(parseModelManifest(manifest())), null);
});

test("Gewählt wie andere Modelle: das eigene oder freigegebene, bei Streit keins – mit whisperQuelle()", () => {
  const kennung = whisperKennung("large-v3-turbo-q5_0");
  const eigen = manifest();
  const w = vertrautesManifest([eigen], kennung, new Set(), KNOTEN.pk, whisperQuelle);
  assert.ok(w.ok && w.id === eigen.id && w.quelle.datei.sha256 === hex(60));
  // Ein fremdes nur über einen abonnierten Katalog (Freigabe seiner Id)
  const fremd = manifest({ kp: KURATOR });
  assert.deepEqual(vertrautesManifest([fremd], kennung, new Set(), KNOTEN.pk, whisperQuelle), { ok: false, fall: "manifest.keins" });
  assert.ok(vertrautesManifest([fremd], kennung, new Set([fremd.id]), KNOTEN.pk, whisperQuelle).ok);
  // Zwei freigegebene mit verschiedenen Bytes: keine Wahl
  const anders = manifest({ kp: generateKeypair(), files: [{ ...TURBO, sha256: hex(61) }] });
  assert.deepEqual(vertrautesManifest([fremd, anders], kennung, new Set([fremd.id, anders.id]), KNOTEN.pk, whisperQuelle),
    { ok: false, fall: "manifest.uneinig", werte: { herausgeber: 2 } });
  // Ein eigenes, das keine Whisper-Quelle nennt, gilt nicht als Whisper-Modell
  const ohne = manifest({ upstream: "hf:ggerganov/whisper.cpp@main", at: T + 1 });
  assert.deepEqual(vertrautesManifest([ohne], kennung, new Set(), KNOTEN.pk, whisperQuelle), { ok: false, fall: "manifest.keineQuelle" });
});

test("Kennung am Anfang der Datei: ggml von whisper.cpp ja, Pickle, GGUF oder zu kurz nein", () => {
  assert.deepEqual([...GGML_KENNUNG], [0x6c, 0x6d, 0x67, 0x67]);
  // So beginnt `models/for-tests-ggml-tiny.bin` aus whisper.cpp v1.9.5 (gemessen): 6c 6d 67 67 99 ca 00 00
  assert.equal(istGgml(Uint8Array.of(0x6c, 0x6d, 0x67, 0x67, 0x99, 0xca, 0x00, 0x00)), true);
  const zahl = new Uint8Array(4);
  new DataView(zahl.buffer).setUint32(0, 0x67676d6c, true);
  assert.equal(istGgml(zahl), true, "die Zahl aus convert-pt-to-ggml.py, Kleinendian");
  for (const [was, kopf] of [
    ["Pickle", Uint8Array.of(0x80, 0x02, 0x63, 0x6f)],
    ["Pickle (Zip von PyTorch)", Uint8Array.of(0x50, 0x4b, 0x03, 0x04)],
    ["GGUF", new TextEncoder().encode("GGUF")],
    ["Großendian", Uint8Array.of(0x67, 0x67, 0x6d, 0x6c)],
    ["zu kurz", Uint8Array.of(0x6c, 0x6d, 0x67)],
    ["leer", new Uint8Array(0)],
  ] as const) {
    assert.equal(istGgml(kopf), false, was);
  }
});
