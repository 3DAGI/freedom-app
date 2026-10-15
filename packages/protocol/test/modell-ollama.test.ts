/**
 * Schritt E9-3a: Modelle über Ollama laden, geprüft gegen ein Manifest von
 * vertrauten Schlüsseln (Entwurf E9, V3 A). Die Registry liefert die Summen,
 * Ollama prüft die Bytes dagegen – und diese Bausteine prüfen, dass es genau
 * die Summen des Manifests sind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { buildModelManifest, parseModelManifest, KIND_MODEL_MANIFEST, type ModelFile } from "../src/model-registry.js";
import {
  leseOllamaName, ollamaDateien, ollamaQuelle, pruefeSchichten, registryAdresse, vertrautesManifest, MAX_SCHICHTEN,
} from "../src/modell-ollama.js";

const T = 1_800_000_000;
const hex = (n: number) => n.toString(16).padStart(64, "0");
const KURATOR = generateKeypair(), ZWEITER = generateKeypair(), FREMD = generateKeypair(), KNOTEN = generateKeypair();

/** Ein Manifest der Registry im Docker-Format v2, wie Ollama es lädt. */
const registry = {
  schemaVersion: 2,
  mediaType: "application/vnd.docker.distribution.manifest.v2+json",
  config: { mediaType: "application/vnd.docker.container.image.v1+json", digest: `sha256:${hex(9)}`, size: 487 },
  layers: [
    { mediaType: "application/vnd.ollama.image.model", digest: `sha256:${hex(1)}`, size: 397_807_936 },
    { mediaType: "application/vnd.ollama.image.template", digest: `sha256:${hex(2)}`, size: 1_482 },
    { mediaType: "application/vnd.ollama.image.license", digest: `sha256:${hex(3)}`, size: 11_343 },
  ],
};
const dateien = ollamaDateien(registry)!;
const schichten = [...registry.layers, registry.config].map((s) => ({ digest: s.digest, groesse: s.size }));

const manifest = (kp = KURATOR, at = T, files: ModelFile[] = dateien, model = "qwen2.5:0.5b", upstream = "ollama:qwen2.5:0.5b"): NostrEvent =>
  signEvent(buildModelManifest({ modelId: model, name: "Qwen 2.5 0.5B", files, upstream, publisherPubkey: kp.pk }, at), kp.sk);

test("Ollama-Namen: mit und ohne Tag und Namensraum, so wie /api/tags sie nennt; ein Host oder Unsinn gilt nicht", () => {
  assert.deepEqual(leseOllamaName("qwen2.5:0.5b"), { ns: "library", name: "qwen2.5", tag: "0.5b", voll: "qwen2.5:0.5b" });
  assert.equal(leseOllamaName("qwen2.5")?.voll, "qwen2.5:latest");
  assert.equal(leseOllamaName("library/qwen2.5:7b")?.voll, "qwen2.5:7b");
  assert.equal(leseOllamaName("nutzer/modell:q4_K_M")?.voll, "nutzer/modell:q4_K_M");
  for (const falsch of ["", "hf.co/nutzer/modell:Q4", "a:b:c", "../x", "x/..", "mit leer", "-x", "x:", ":tag", "x/y/z"]) {
    assert.equal(leseOllamaName(falsch), null, falsch);
  }
  assert.equal(registryAdresse(leseOllamaName("nutzer/modell:q4_K_M")!), "https://registry.ollama.ai/v2/nutzer/modell/manifests/q4_K_M");
  assert.equal(registryAdresse(leseOllamaName("qwen2.5")!), "https://registry.ollama.ai/v2/library/qwen2.5/manifests/latest");
});

test("Quelle: nur upstream ollama:<Name> und nur, wenn er der Modellname ist", () => {
  const m = (model: string, upstream = "") => parseModelManifest(manifest(KURATOR, T, dateien, model, upstream));
  assert.equal(ollamaQuelle(m("qwen2.5:0.5b", "ollama:qwen2.5:0.5b"))?.voll, "qwen2.5:0.5b");
  assert.equal(ollamaQuelle(m("qwen2.5:latest", "ollama:qwen2.5"))?.voll, "qwen2.5:latest", "ohne Tag ist latest");
  assert.equal(ollamaQuelle(m("qwen2.5:0.5b", "ollama:qwen2.5:7b")), null, "ein anderes Modell als der Name");
  assert.equal(ollamaQuelle(m("qwen2.5:0.5b", "hf:Qwen/Qwen2.5-0.5B")), null);
  assert.equal(ollamaQuelle(m("qwen2.5:0.5b")), null, "ohne Quelle");
});

test("Dateien aus dem Manifest der Registry: Schichten und Konfiguration, benannt wie die Blobs bei Ollama; falsche Form → null", () => {
  assert.deepEqual(dateien.map((f) => f.name), [hex(1), hex(2), hex(3), hex(9)].map((h) => `sha256-${h}`));
  assert.equal(dateien[0]!.sizeBytes, 397_807_936);
  assert.equal(parseModelManifest(manifest()).totalBytes, 397_807_936 + 1_482 + 11_343 + 487);
  const ohne = { ...registry, config: undefined };
  assert.equal(ollamaDateien(ohne)!.length, 3, "ohne Konfiguration nur die Schichten");
  const mit = (aenderung: object) => ollamaDateien({ ...registry, ...aenderung });
  assert.equal(mit({ schemaVersion: 1 }), null);
  assert.equal(mit({ layers: [] }), null);
  assert.equal(mit({ layers: [{ digest: "sha256:zz", size: 1 }] }), null);
  assert.equal(mit({ layers: [{ digest: `sha512:${hex(1)}`, size: 1 }] }), null);
  assert.equal(mit({ layers: [{ digest: `sha256:${hex(1)}`, size: 0 }] }), null);
  assert.equal(mit({ layers: [{ digest: `sha256:${hex(1)}`, size: "5" }] }), null);
  assert.equal(mit({ layers: Array.from({ length: MAX_SCHICHTEN + 1 }, (_, i) => ({ digest: `sha256:${hex(i + 1)}`, size: 1 })) }), null);
  assert.equal(ollamaDateien(null), null);
  assert.equal(ollamaDateien("text"), null);
});

test("Schichten prüfen: genau die Dateien des Manifests – fremde, fehlende, andere Größe und kaputte Summen fallen auf", () => {
  const m = parseModelManifest(manifest());
  assert.deepEqual(pruefeSchichten(m, schichten), { ok: true, dateien: 4, bytes: m.totalBytes });
  // Ollama meldet Fortschritt je Schicht mehrmals – dieselbe Schicht doppelt stört nicht
  assert.equal(pruefeSchichten(m, [...schichten, schichten[0]!]).ok, true);
  assert.deepEqual(pruefeSchichten(m, [...schichten, { digest: `sha256:${hex(4)}`, groesse: 10 }]), { ok: false, fall: "schicht.fremd", werte: { anzahl: 1 } });
  assert.deepEqual(pruefeSchichten(m, schichten.slice(1)), { ok: false, fall: "schicht.fehlt", werte: { anzahl: 1 } });
  assert.deepEqual(pruefeSchichten(m, [{ ...schichten[0]!, groesse: 1 }, ...schichten.slice(1)]), { ok: false, fall: "schicht.groesse", werte: { anzahl: 1 } });
  assert.deepEqual(pruefeSchichten(m, [{ digest: hex(1), groesse: 1 }, ...schichten.slice(1)]), { ok: false, fall: "schicht.form", werte: { anzahl: 1 } });
  assert.equal(pruefeSchichten(m, []).ok, false, "nichts geladen ist nichts geprüft");
  // Ein Manifest mit anderen Dateinamen (kein Ollama-Manifest) passt nie
  const gguf = parseModelManifest(manifest(KURATOR, T, dateien.map((f, i) => ({ ...f, name: `teil-${i}.gguf` }))));
  assert.equal(pruefeSchichten(gguf, schichten).ok, false);
});

test("Manifest wählen: das eigene oder ein von Katalogen freigegebenes, das eigene geht vor, bei Streit keine Wahl (E9-4)", () => {
  const anders = dateien.map((f, i) => (i === 0 ? { ...f, sha256: hex(7), name: `sha256-${hex(7)}` } : f));
  const [kurator, zweiter, kuratorAnders, zweiterAnders] = [manifest(KURATOR), manifest(ZWEITER, T + 5), manifest(KURATOR, T + 1, anders), manifest(ZWEITER, T, anders)];
  const wahl = (evs: NostrEvent[], frei: NostrEvent[]) => vertrautesManifest(evs, "qwen2.5:0.5b", new Set(frei.map((e) => e.id)), KNOTEN.pk);
  // Ohne Freigabe zählt kein fremdes – auch nicht als einziges, auch nicht vom Kurator selbst
  assert.deepEqual(wahl([manifest(FREMD)], []), { ok: false, fall: "manifest.keins" });
  assert.deepEqual(wahl([kurator], []), { ok: false, fall: "manifest.keins" }, "ein Schlüssel allein gibt nichts frei – nur die Id im Katalog");
  const ok = wahl([manifest(FREMD), kurator], [kurator]);
  assert.ok(ok.ok && ok.manifest.publisherPubkey === KURATOR.pk && ok.id === kurator.id && ok.quelle.voll === "qwen2.5:0.5b");
  // Freigegeben ist genau die Id: ein neueres Manifest desselben Autors zählt nicht
  const ohneFreigabe = wahl([kuratorAnders, kurator], [kurator]);
  assert.ok(ohneFreigabe.ok && ohneFreigabe.id === kurator.id);
  // Zwei freigegebene mit denselben Dateien: das neueste
  const beide = wahl([kurator, zweiter], [kurator, zweiter]);
  assert.ok(beide.ok && beide.manifest.publisherPubkey === ZWEITER.pk);
  // Zwei freigegebene mit verschiedenen Dateien: keine Wahl – auch vom selben Autor
  assert.deepEqual(wahl([kurator, zweiterAnders], [kurator, zweiterAnders]), { ok: false, fall: "manifest.uneinig", werte: { herausgeber: 2 } });
  assert.deepEqual(wahl([kurator, kuratorAnders], [kurator, kuratorAnders]), { ok: false, fall: "manifest.uneinig", werte: { herausgeber: 2 } });
  // Das eigene Manifest löst den Streit und braucht keine Freigabe
  const eigen = wahl([kurator, zweiterAnders, manifest(KNOTEN, T - 100, anders)], [kurator, zweiterAnders]);
  assert.ok(eigen.ok && eigen.manifest.publisherPubkey === KNOTEN.pk);
  // Vom eigenen gilt das neueste
  const neuestes = wahl([manifest(KNOTEN, T - 50, anders), manifest(KNOTEN, T)], []);
  assert.ok(neuestes.ok && neuestes.manifest.files[0]!.sha256 === dateien[0]!.sha256);
});

test("Manifest wählen: Signatur, Adresse und Name müssen stimmen; ohne Ollama-Quelle keine Wahl", () => {
  const wahl = (evs: NostrEvent[], kennung = "qwen2.5:0.5b") => vertrautesManifest(evs, kennung, new Set(evs.map((e) => e.id)), KNOTEN.pk);
  const echt = manifest();
  assert.deepEqual(wahl([{ ...echt, tags: echt.tags.map((t) => (t[0] === "file" && t[2] === hex(1) ? [t[0], t[1]!, hex(5), t[3]!, ""] : t)) }]), { ok: false, fall: "manifest.keins" }, "nachträglich geänderte Summe: Signatur falsch");
  assert.deepEqual(wahl([echt], "qwen2.5:7b"), { ok: false, fall: "manifest.keins" }, "ein anderes Modell");
  // d-Tag und Modellname müssen zusammenpassen
  const verschoben = signEvent(buildEvent(KURATOR.pk, KIND_MODEL_MANIFEST, echt.tags.map((t) => (t[0] === "d" ? ["d", "model:qwen2.5:7b"] : t)), "", T), KURATOR.sk);
  assert.deepEqual(wahl([verschoben], "qwen2.5:7b"), { ok: false, fall: "manifest.keins" });
  assert.deepEqual(wahl([manifest(KURATOR, T, dateien, "qwen2.5:0.5b", "hf:Qwen/Qwen2.5-0.5B")]), { ok: false, fall: "manifest.keineQuelle" });
});
