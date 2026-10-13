/**
 * Schritt B-29c1a: Modelle von Hugging Face für Antriebe außer Ollama, geprüft
 * gegen ein Manifest von vertrauten Schlüsseln (Entwurf E9, V3; Quellen MENSCH
 * 12.10.2026). Nur safetensors, Konfiguration und Tokenizer – nie Pickle, nie Python.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { buildModelManifest, parseModelManifest, type ModelFile } from "../src/model-registry.js";
import { vertrautesManifest } from "../src/modell-ollama.js";
import {
  HF_DATEI, MAX_HF_DATEIEN, hfDateiAdresse, hfQuelle, hfStand, hfStandAdresse, leseHfName, pruefeDateien, vorpruefeHf,
} from "../src/modell-hf.js";

const T = 1_800_000_000;
const hex = (n: number, l = 64) => n.toString(16).padStart(l, "0");
const COMMIT = "a".repeat(40);
const KNOTEN = generateKeypair(), FREMD = generateKeypair();

/** Antwort von `/api/models/<repo>/revision/<rev>?blobs=true`, wie Hugging Face sie liefert (gekürzt). */
const antwort = {
  _id: "x", id: "Qwen/Qwen2.5-0.5B-Instruct", sha: COMMIT, private: false, gated: false,
  cardData: { license: "apache-2.0" },
  siblings: [
    { rfilename: ".gitattributes", size: 1519, blobId: hex(1, 40) },
    { rfilename: "README.md", size: 4917, blobId: hex(2, 40) },
    { rfilename: "LICENSE", size: 11343, blobId: hex(3, 40) },
    { rfilename: "config.json", size: 659, blobId: hex(4, 40) },
    { rfilename: "generation_config.json", size: 242, blobId: hex(5, 40) },
    { rfilename: "merges.txt", size: 1671853, blobId: hex(6, 40) },
    { rfilename: "model.safetensors", size: 988097824, blobId: hex(7, 40), lfs: { sha256: hex(70), size: 988097824, pointerSize: 135 } },
    { rfilename: "tokenizer.json", size: 7031645, blobId: hex(8, 40) },
    { rfilename: "tokenizer_config.json", size: 7305, blobId: hex(9, 40) },
    { rfilename: "vocab.json", size: 2776833, blobId: hex(10, 40) },
    // Nie: Pickle, Python, Unterordner
    { rfilename: "pytorch_model.bin", size: 988000000, blobId: hex(11, 40), lfs: { sha256: hex(110), size: 988000000, pointerSize: 135 } },
    { rfilename: "modeling_qwen.py", size: 50000, blobId: hex(12, 40) },
    { rfilename: "onnx/model.onnx", size: 900000000, blobId: hex(13, 40), lfs: { sha256: hex(130), size: 900000000, pointerSize: 135 } },
    { rfilename: "original/consolidated.safetensors", size: 900000000, blobId: hex(14, 40), lfs: { sha256: hex(140), size: 900000000, pointerSize: 135 } },
  ],
};
const ERLAUBT = ["config.json", "generation_config.json", "merges.txt", "model.safetensors", "tokenizer.json", "tokenizer_config.json", "vocab.json"];

/** Dateien eines festgehaltenen Manifests: die SHA-256 der kleinen hat, wer festhielt, selbst gerechnet. */
const dateien: ModelFile[] = antwort.siblings.filter((s) => ERLAUBT.includes(s.rfilename))
  .map((s, i) => ({ name: s.rfilename, sha256: s.lfs?.sha256 ?? hex(200 + i), sizeBytes: s.size }));
const manifest = (kp = KNOTEN, at = T, files = dateien, model = "Qwen/Qwen2.5-0.5B-Instruct", upstream = `hf:Qwen/Qwen2.5-0.5B-Instruct@${COMMIT}`): NostrEvent =>
  signEvent(buildModelManifest({ modelId: model, name: "Qwen 2.5 0.5B", files, upstream, publisherPubkey: kp.pk }, at), kp.sk);

test("Namen: genau org/repo nach den Regeln von Hugging Face; ein Host, ein Tag oder Unsinn gilt nicht", () => {
  assert.deepEqual(leseHfName("Qwen/Qwen2.5-0.5B-Instruct"), { org: "Qwen", repo: "Qwen2.5-0.5B-Instruct", voll: "Qwen/Qwen2.5-0.5B-Instruct" });
  assert.equal(leseHfName("meta-llama/Llama-3.1-8B")?.voll, "meta-llama/Llama-3.1-8B");
  for (const falsch of ["", "qwen", "a/b/c", "hf.co/Qwen/x", "Qwen/x:latest", "../x", "x/..", "-x/y", "x/y-", "x/y.", "a--b/c", "a/b..c", "mit leer/x", `x/${"y".repeat(97)}`]) {
    assert.equal(leseHfName(falsch), null, falsch);
  }
});

test("Adressen: Stand je Commit oder Zweig, Dateien nur am Commit und nur erlaubte Namen", () => {
  const n = leseHfName("Qwen/Qwen2.5-0.5B-Instruct")!;
  assert.equal(hfStandAdresse(n), "https://huggingface.co/api/models/Qwen/Qwen2.5-0.5B-Instruct/revision/main?blobs=true");
  assert.equal(hfStandAdresse(n, COMMIT), `https://huggingface.co/api/models/Qwen/Qwen2.5-0.5B-Instruct/revision/${COMMIT}?blobs=true`);
  for (const falsch of ["", "refs/pr/1", "../main", "a b", "-x"]) assert.equal(hfStandAdresse(n, falsch), null, falsch);
  assert.equal(hfDateiAdresse(n, COMMIT, "model.safetensors"), `https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/resolve/${COMMIT}/model.safetensors`);
  assert.equal(hfDateiAdresse(n, "main", "model.safetensors"), null, "nie an einem Zweig");
  for (const falsch of ["pytorch_model.bin", "modeling_qwen.py", "onnx/model.onnx", "../config.json", ".gitattributes"]) {
    assert.equal(hfDateiAdresse(n, COMMIT, falsch), null, falsch);
  }
  assert.equal(hfStandAdresse(n, "main", "http://127.0.0.1:9"), "http://127.0.0.1:9/api/models/Qwen/Qwen2.5-0.5B-Instruct/revision/main?blobs=true");
});

test("Stand lesen: Commit und nur erlaubte Dateien – SHA-256 nur bei LFS, Pickle, Python und Unterordner bleiben draußen", () => {
  const s = hfStand(antwort);
  assert.ok(s.ok);
  assert.equal(s.commit, COMMIT);
  assert.equal(s.lizenz, "apache-2.0");
  assert.deepEqual(s.dateien.map((d) => d.name), ERLAUBT);
  assert.deepEqual(s.dateien.find((d) => d.name === "model.safetensors"), { name: "model.safetensors", groesse: 988097824, git: hex(7, 40), sha256: hex(70) });
  assert.equal(s.dateien.find((d) => d.name === "config.json")!.sha256, undefined, "kleine Dateien: nur die Git-Kennung");
  assert.ok(s.dateien.every((d) => HF_DATEI.test(d.name) && !d.name.includes("/")));
  for (const name of ["pytorch_model.bin", "modeling_qwen.py", "README.md"]) assert.equal(HF_DATEI.test(name), false, name);
  // Eine leere Datei kennt kein Manifest – sie bleibt weg, statt alles abzuweisen
  const mitLeer = hfStand({ ...antwort, siblings: [...antwort.siblings, { rfilename: "added_tokens.json", size: 0, blobId: hex(15, 40) }] });
  assert.ok(mitLeer.ok && !mitLeer.dateien.some((d) => d.name === "added_tokens.json"));
  // Eine Lizenz mit seltsamen Zeichen wird nicht übernommen
  const s2 = hfStand({ ...antwort, cardData: { license: "other <b>" } });
  assert.ok(s2.ok && s2.lizenz === undefined);
});

test("Stand lesen: kaputte Formen und Repos ohne safetensors oder ohne config.json weist er ab", () => {
  const mit = (siblings: unknown[]) => hfStand({ ...antwort, siblings });
  const gute = antwort.siblings.filter((s) => ERLAUBT.includes(s.rfilename));
  for (const falsch of [null, 7, {}, { ...antwort, sha: "main" }, { ...antwort, sha: COMMIT.toUpperCase() }, { ...antwort, siblings: "x" }]) {
    assert.deepEqual(hfStand(falsch), { ok: false, fall: "hf.form" });
  }
  for (const kaputt of [
    { rfilename: "x.json", size: -1, blobId: hex(1, 40) },
    { rfilename: "x.json", size: 1.5, blobId: hex(1, 40) },
    { rfilename: "x.json", size: 10, blobId: "zz" },
    { rfilename: "x.safetensors", size: 10, blobId: hex(1, 40), lfs: { sha256: "AB".repeat(32), size: 10 } },
    { rfilename: "x.safetensors", size: 10, blobId: hex(1, 40), lfs: { sha256: hex(1), size: 11 } },
    { rfilename: "x.safetensors", size: 10, blobId: hex(1, 40), lfs: null },
  ]) assert.deepEqual(mit([...gute, kaputt]), { ok: false, fall: "hf.form" }, JSON.stringify(kaputt));
  assert.deepEqual(mit([...gute, gute[0]]), { ok: false, fall: "hf.form" }, "derselbe Name zweimal");
  const viele = Array.from({ length: MAX_HF_DATEIEN }, (_, i) => ({ rfilename: `model-${i}.safetensors`, size: 10, blobId: hex(i, 40), lfs: { sha256: hex(i), size: 10 } }));
  assert.deepEqual(mit([...gute, ...viele]), { ok: false, fall: "hf.form" }, "zu viele Dateien");
  assert.deepEqual(mit(gute.filter((s) => s.rfilename !== "model.safetensors").concat(antwort.siblings.filter((s) => s.rfilename === "pytorch_model.bin"))), { ok: false, fall: "hf.ohneGewichte" }, "nur Pickle");
  assert.deepEqual(mit(gute.filter((s) => s.rfilename !== "config.json")), { ok: false, fall: "hf.ohneGewichte" });
});

test("Quelle: nur hf:<Kennung>@<Commit>, gleich dem Modellnamen, und nur erlaubte Dateien im Manifest", () => {
  const m = (model: string, upstream: string, files = dateien) => parseModelManifest(manifest(KNOTEN, T, files, model, upstream));
  assert.deepEqual(hfQuelle(m("Qwen/Qwen2.5-0.5B-Instruct", `hf:Qwen/Qwen2.5-0.5B-Instruct@${COMMIT}`)), { name: leseHfName("Qwen/Qwen2.5-0.5B-Instruct"), commit: COMMIT });
  assert.equal(hfQuelle(m("Qwen/Qwen2.5-0.5B-Instruct", "hf:Qwen/Qwen2.5-0.5B-Instruct@main")), null, "ein Zweig kann sich ändern");
  assert.equal(hfQuelle(m("Qwen/Qwen2.5-0.5B-Instruct", `hf:Qwen/Andere@${COMMIT}`)), null);
  assert.equal(hfQuelle(m("Qwen/Qwen2.5-0.5B-Instruct", "ollama:qwen2.5:0.5b")), null);
  assert.equal(hfQuelle(m("Qwen/Qwen2.5-0.5B-Instruct", `hf:Qwen/Qwen2.5-0.5B-Instruct@${COMMIT}`, [...dateien, { name: "pytorch_model.bin", sha256: hex(1), sizeBytes: 5 }])), null, "Pickle im Manifest");
  assert.equal(hfQuelle(m("Qwen/Qwen2.5-0.5B-Instruct", `hf:Qwen/Qwen2.5-0.5B-Instruct@${COMMIT}`, [...dateien, { name: "../x.json", sha256: hex(1), sizeBytes: 5 }])), null, "Pfad aus dem Ordner");
});

test("Manifest wählen mit hfQuelle: dieselben Regeln wie für Ollama – nur vertraute Schlüssel, eine Ollama-Quelle gilt hier nicht", () => {
  const w = vertrautesManifest([manifest(FREMD, T + 9), manifest()], "Qwen/Qwen2.5-0.5B-Instruct", new Set(), KNOTEN.pk, hfQuelle);
  assert.ok(w.ok);
  assert.equal(w.quelle.commit, COMMIT);
  assert.equal(w.manifest.publisherPubkey, KNOTEN.pk);
  const ollama = manifest(KNOTEN, T, dateien, "Qwen/Qwen2.5-0.5B-Instruct", "ollama:Qwen/Qwen2.5-0.5B-Instruct");
  assert.deepEqual(vertrautesManifest([ollama], "Qwen/Qwen2.5-0.5B-Instruct", new Set(), KNOTEN.pk, hfQuelle), { ok: false, fall: "manifest.keineQuelle" });
  assert.deepEqual(vertrautesManifest([manifest(FREMD)], "Qwen/Qwen2.5-0.5B-Instruct", new Set(), KNOTEN.pk, hfQuelle), { ok: false, fall: "manifest.keins" });
});

test("Dateien prüfen: je Name dieselbe Summe und Größe – fremde, falsche, fehlende fallen auf", () => {
  const m = parseModelManifest(manifest());
  const alle = dateien.map((f) => ({ name: f.name, sha256: f.sha256, groesse: f.sizeBytes }));
  assert.deepEqual(pruefeDateien(m, alle), { ok: true, dateien: dateien.length, bytes: m.totalBytes });
  assert.deepEqual(pruefeDateien(m, alle.map((d) => ({ ...d, sha256: d.sha256.toUpperCase() }))).ok, true, "Großbuchstaben in der eigenen Summe");
  assert.deepEqual(pruefeDateien(m, [...alle, { name: "x.json", sha256: hex(1), groesse: 1 }]), { ok: false, fall: "datei.fremd", werte: { anzahl: 1 } });
  assert.deepEqual(pruefeDateien(m, alle.map((d, i) => (i === 0 ? { ...d, sha256: hex(999) } : d))), { ok: false, fall: "datei.summe", werte: { anzahl: 1 } });
  assert.deepEqual(pruefeDateien(m, alle.map((d, i) => (i === 0 ? { ...d, groesse: d.groesse + 1 } : d))), { ok: false, fall: "datei.groesse", werte: { anzahl: 1 } });
  assert.deepEqual(pruefeDateien(m, alle.slice(2)), { ok: false, fall: "datei.fehlt", werte: { anzahl: 2 } });
});

test("Vorprüfung: Hugging Face am Commit nennt dieselben Namen, Größen und LFS-Summen – sonst wird nichts geladen", () => {
  const m = parseModelManifest(manifest());
  const s = hfStand(antwort);
  assert.ok(s.ok);
  assert.equal(vorpruefeHf(m, s).ok, true);
  const anders = (aendern: (x: (typeof antwort.siblings)[number]) => object) => {
    const t = hfStand({ ...antwort, siblings: antwort.siblings.map((x) => (x.rfilename === "model.safetensors" ? aendern(x) : x)) });
    assert.ok(t.ok);
    return vorpruefeHf(m, t);
  };
  assert.equal(anders((x) => ({ ...x, lfs: { ...x.lfs, sha256: hex(71) } })).ok, false, "andere LFS-Summe");
  assert.equal(anders((x) => ({ ...x, size: 5, lfs: { ...x.lfs, size: 5 } })).ok, false, "andere Größe");
  const ohne = hfStand({ ...antwort, siblings: antwort.siblings.filter((x) => x.rfilename !== "vocab.json") });
  assert.ok(ohne.ok);
  assert.deepEqual(vorpruefeHf(m, ohne), { ok: false, fall: "datei.fehlt", werte: { anzahl: 1 } });
  const mehr = hfStand({ ...antwort, siblings: [...antwort.siblings, { rfilename: "neu.json", size: 3, blobId: hex(20, 40) }] });
  assert.ok(mehr.ok);
  assert.deepEqual(vorpruefeHf(m, mehr), { ok: false, fall: "datei.fremd", werte: { anzahl: 1 } });
});
