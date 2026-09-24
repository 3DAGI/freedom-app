/**
 * Tests fuer den Modell-Katalog.
 *
 * Der Katalog beantwortet zwei Fragen: Ist diese Datei echt, und ist das
 * Modell noch ladbar. Beide duerfen nicht schoenfaerben — eine falsche
 * Zusage kostet den Provider zwanzig Gigabyte Download.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildModelManifest, parseModelManifest, buildModelSeed, parseModelSeed,
  buildRegistry, verifyFile, fitsOnDevice, modelsAtRisk,
  KIND_MODEL_MANIFEST, ModelFile,
} from "../src/model-registry.js";

const NOW = 1_800_000_000;
const HERAUSGEBER = generateKeypair();
const h = (n: number) => n.toString(16).padStart(64, "0");

const dateien: ModelFile[] = [
  { name: "model-00001.gguf", sha256: h(1), sizeBytes: 4_000_000_000, blobId: "b1" },
  { name: "model-00002.gguf", sha256: h(2), sizeBytes: 3_000_000_000, blobId: "b2" },
];

const manifest = (id = "qwen-7b-q4", at = NOW) =>
  signEvent(buildModelManifest({
    modelId: id, name: "Qwen 7B", quant: "Q4_K_M", paramsB: 7,
    files: dateien, upstream: "hf:Qwen/Qwen2.5-7B", license: "apache-2.0",
    publisherPubkey: HERAUSGEBER.pk,
  }, at), HERAUSGEBER.sk);

const seed = (id: string, files: string[], at = NOW, kp = generateKeypair()) =>
  signEvent(buildModelSeed(id, kp.pk, files, "eu", at), kp.sk);

const alleDateien = dateien.map((f) => f.name);

// ------------------------------------------------------------- Format

test("Manifest: Roundtrip mit Pruefsummen und Herkunft", () => {
  const m = parseModelManifest(manifest());
  assert.equal(m.modelId, "qwen-7b-q4");
  assert.equal(m.files.length, 2);
  assert.equal(m.totalBytes, 7_000_000_000);
  assert.equal(m.quant, "Q4_K_M");
  // Herkunft ist pruefbar dokumentiert, nicht bloss behauptet.
  assert.match(m.upstream!, /^hf:/);
  assert.equal(m.license, "apache-2.0");
});

test("Dateien ohne gueltige Pruefsumme fallen raus", () => {
  // Man koennte sie laden, aber nicht feststellen, ob es die richtige ist.
  const ev = signEvent(buildEvent(HERAUSGEBER.pk, KIND_MODEL_MANIFEST, [
    ["model", "x"], ["name", "X"],
    ["file", "gut.gguf", h(3), "100"],
    ["file", "schlecht.gguf", "keine-pruefsumme", "100"],
  ], ""), HERAUSGEBER.sk);
  assert.equal(parseModelManifest(ev).files.length, 1);
});

test("Manifest ganz ohne pruefbare Dateien wird abgelehnt", () => {
  const ev = signEvent(buildEvent(HERAUSGEBER.pk, KIND_MODEL_MANIFEST, [["model", "x"]], ""), HERAUSGEBER.sk);
  assert.throws(() => parseModelManifest(ev), /ohne prüfbare Dateien/);
});

test("Seed: Teilbestaende sind erlaubt", () => {
  // Wer nur die Haelfte hat, traegt trotzdem bei.
  const s = parseModelSeed(seed("qwen-7b-q4", [alleDateien[0]]));
  assert.equal(s.files.length, 1);
  assert.equal(s.region, "eu");
});

// ------------------------------------------------------------- Katalog

test("Vollstaendiges Modell mit vielen Seedern gilt als gut", () => {
  const evs = [manifest(), ...Array.from({ length: 5 }, () => seed("qwen-7b-q4", alleDateien))];
  const r = buildRegistry(evs, { nowSecs: NOW });
  assert.equal(r.models[0].availability, "gut");
  assert.equal(r.models[0].seeders, 5);
});

test("Ein einziger Seeder ist gefaehrdet, nicht 'gut'", () => {
  const r = buildRegistry([manifest(), seed("qwen-7b-q4", alleDateien)], { nowSecs: NOW });
  assert.equal(r.models[0].availability, "gefaehrdet");
  assert.match(r.models[0].note, /Verschwindet er/);
});

test("DER wichtige Fall: viele Seeder, aber eine Datei fehlt allen", () => {
  // Zwanzig Seeder sehen bestens aus — das Modell ist trotzdem nicht ladbar.
  // Eine reine Seeder-Zaehlung wuerde das verschweigen.
  const evs = [manifest(), ...Array.from({ length: 20 }, () => seed("qwen-7b-q4", [alleDateien[0]]))];
  const r = buildRegistry(evs, { nowSecs: NOW });
  assert.equal(r.models[0].seeders, 20);
  assert.equal(r.models[0].availability, "gefaehrdet");
  assert.deepEqual(r.models[0].missingFiles, [alleDateien[1]]);
  assert.match(r.models[0].note, /nicht ladbar/);
});

test("Teilbestaende ergaenzen sich zu einem vollstaendigen Modell", () => {
  const evs = [
    manifest(),
    seed("qwen-7b-q4", [alleDateien[0]]),
    seed("qwen-7b-q4", [alleDateien[1]]),
  ];
  const r = buildRegistry(evs, { nowSecs: NOW });
  assert.equal(r.models[0].missingFiles.length, 0);
  assert.equal(r.models[0].availability, "knapp");
});

test("Ohne Seeder gilt das Modell als weg", () => {
  const r = buildRegistry([manifest()], { nowSecs: NOW });
  assert.equal(r.models[0].availability, "weg");
  assert.match(r.models[0].note, /Niemand haelt|Niemand hält/);
});

test("Veraltete Seed-Meldungen zaehlen nicht", () => {
  const r = buildRegistry([manifest(), seed("qwen-7b-q4", alleDateien, NOW - 60 * 86400)], { nowSecs: NOW });
  assert.equal(r.models[0].seeders, 0);
});

test("Seeds fuer unbekannte Modelle werden gezaehlt, nicht uebernommen", () => {
  const r = buildRegistry([manifest(), seed("gibt-es-nicht", ["a"])], { nowSecs: NOW });
  assert.equal(r.models.length, 1);
  assert.equal(r.unknownSeeds, 1);
});

test("Neueres Manifest ersetzt das aeltere", () => {
  const r = buildRegistry([manifest("m1", NOW - 1000), manifest("m1", NOW)], { nowSecs: NOW });
  assert.equal(r.models.length, 1);
  assert.equal(r.models[0].manifest.createdAt, NOW);
});

test("Gefaehrdete Modelle lassen sich gezielt finden", () => {
  const evs = [
    manifest("gut", NOW), ...Array.from({ length: 5 }, () => seed("gut", alleDateien)),
    manifest("schwach", NOW), seed("schwach", alleDateien),
  ];
  const r = modelsAtRisk(buildRegistry(evs, { nowSecs: NOW }).models);
  assert.equal(r.length, 1);
  assert.equal(r[0].manifest.modelId, "schwach");
});

// ------------------------------------------------------------- Pruefung

test("Manipulierte Datei faellt auf — egal von wem sie kam", () => {
  const m = parseModelManifest(manifest());
  const gut = verifyFile(m, alleDateien[0], h(1));
  assert.equal(gut.ok, true);

  const boese = verifyFile(m, alleDateien[0], h(999));
  assert.equal(boese.ok, false);
  assert.match(boese.message, /nicht verwenden/);
});

test("Unbekannte Datei wird nicht stillschweigend akzeptiert", () => {
  const m = parseModelManifest(manifest());
  assert.equal(verifyFile(m, "fremde.gguf", h(1)).ok, false);
});

// ------------------------------------------------------------- Hardware

test("Passt-Pruefung warnt VOR dem Download, nicht danach", () => {
  const m = parseModelManifest(manifest());
  const zuKlein = fitsOnDevice(m, 6);
  assert.equal(zuKlein.fits, false);
  assert.match(zuKlein.note, /quantisierte Fassung/);

  assert.equal(fitsOnDevice(m, 16).fits, true);
});

test("Passt-Pruefung rechnet Reserve fuer den Cache ein", () => {
  // Genau die Gewichtsgroesse zu nehmen waere zu optimistisch: Beim ersten
  // langen Kontext geht dem Provider der Speicher aus.
  const m = parseModelManifest(manifest());
  assert.ok(fitsOnDevice(m, 7).neededGb > 7);
  assert.equal(fitsOnDevice(m, 7).fits, false);
});
