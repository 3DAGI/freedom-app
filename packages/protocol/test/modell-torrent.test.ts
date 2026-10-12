/**
 * Schritt B-29c2a: Modelle über BitTorrent im eigenen Netz. „Ich halte vor“
 * (38058) nennt Magnet-Link und Inhalts-Kennung; Magnete sind Fremdtext und
 * werden streng gelesen. Geprüft wird immer gegen das Manifest – die Wahl der
 * Magnete braucht kein Vertrauen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import { buildModelManifest, buildModelSeed, parseModelManifest, parseModelSeed, type ModelFile } from "../src/model-registry.js";
import { MAGNET_GRENZEN, inhaltsKennung, leseMagnet, magnetQuellen } from "../src/modell-torrent.js";

const T = 1_800_000_000;
const H = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
const A = generateKeypair(), B = generateKeypair(), C = generateKeypair();
const hex = (n: number) => n.toString(16).padStart(64, "0");
const DATEIEN: ModelFile[] = [
  { name: "config.json", sha256: hex(1), sizeBytes: 600 },
  { name: "model.safetensors", sha256: hex(2), sizeBytes: 988_097_824 },
];
const manifest = (files = DATEIEN, kp = A) => parseModelManifest(signEvent(buildModelManifest({ modelId: "Qwen/Qwen2.5-0.5B-Instruct", name: "Qwen", files, upstream: `hf:Qwen/Qwen2.5-0.5B-Instruct@${"a".repeat(40)}`, publisherPubkey: kp.pk }, T), kp.sk));

test("Magnet lesen: Kennung als Hex oder Base32, Tracker und Web-Seeds geprüft, neu gebaut", () => {
  const m = leseMagnet(`magnet:?xt=urn:btih:${H.toUpperCase()}&dn=Qwen2.5&tr=udp%3A%2F%2Ftracker.pirateface.co%3A6969%2Fannounce&tr=https%3A%2F%2Ft.example.org%2Fannounce&ws=https%3A%2F%2Fhuggingface.co%2FQwen%2FQwen2.5-0.5B-Instruct%2Fresolve%2Fmain%2F`);
  assert.ok(m);
  assert.equal(m.infohash, H);
  assert.deepEqual(m.tracker, ["udp://tracker.pirateface.co:6969/announce", "https://t.example.org/announce"]);
  assert.deepEqual(m.webSeeds, ["https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/resolve/main/"]);
  assert.equal(m.link, `magnet:?xt=urn:btih:${H}&tr=${encodeURIComponent(m.tracker[0]!)}&tr=${encodeURIComponent(m.tracker[1]!)}&ws=${encodeURIComponent(m.webSeeds[0]!)}`);
  assert.ok(!m.link.includes("dn="), "der Name aus dem Link geht nicht weiter");
  // Base32 (32 Zeichen) wird zu Hex – dieselbe Kennung
  assert.equal(leseMagnet("magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK")?.infohash, H);
  // Hybrid (v1 + v2): die v2-Kennung bleibt unbeachtet
  assert.equal(leseMagnet(`magnet:?xt=urn:btih:${H}&xt=urn:btmh:1220${"b".repeat(64)}`)?.infohash, H);
});

test("Magnet lesen: falsche Formen, zwei Kennungen, lokale oder private Hosts, fremde Schemata und Übergröße fallen weg", () => {
  for (const falsch of [
    "", "magnet:", `http://x/?xt=urn:btih:${H}`, "magnet:?xt=urn:btih:zz", `magnet:?xt=urn:btih:${H}0`, `magnet:?xt=urn:btmh:1220${"b".repeat(64)}`,
    `magnet:?xt=urn:btih:${H}&xt=urn:btih:${"d".repeat(40)}`, `magnet:?xt=urn:btih:${H}&tr=${"x".repeat(MAGNET_GRENZEN.laenge)}`,
  ]) assert.equal(leseMagnet(falsch), null, falsch.slice(0, 60));
  const m = leseMagnet(`magnet:?xt=urn:btih:${H}` + [
    "tr=udp%3A%2F%2F127.0.0.1%3A6969", "tr=http%3A%2F%2F192.168.1.5%2Fa", "tr=udp%3A%2F%2Flocalhost%3A1", "tr=udp%3A%2F%2Fnas.local%3A1",
    "tr=http%3A%2F%2F%5B%3A%3A1%5D%2Fa", "tr=ftp%3A%2F%2Fx.example.org", "tr=https%3A%2F%2Fu%3Ap%40x.example.org", "tr=udp%3A%2F%2Fohnepunkt%3A1",
    "ws=http%3A%2F%2Fcdn.example.org%2F", "ws=https%3A%2F%2F10.0.0.1%2F", "xs=https%3A%2F%2Fx.example.org%2Fa.torrent", "as=https%3A%2F%2Fx.example.org%2Fa",
  ].map((x) => `&${x}`).join(""));
  assert.ok(m);
  assert.deepEqual(m.tracker, []);
  assert.deepEqual(m.webSeeds, []);
  assert.equal(m.link, `magnet:?xt=urn:btih:${H}`, "xs und as kommen nie in den Link");
  const viele = leseMagnet(`magnet:?xt=urn:btih:${H}` + Array.from({ length: 15 }, (_, i) => `&tr=udp%3A%2F%2Ft${i}.example.org%3A1`).join(""));
  assert.equal(viele?.tracker.length, MAGNET_GRENZEN.tracker);
});

test("Inhalts-Kennung: gleich für dieselben Dateien, gleich wer festhielt und in welcher Reihenfolge; anders bei anderer Summe oder Größe", () => {
  const k = inhaltsKennung(manifest());
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(inhaltsKennung(manifest([...DATEIEN].reverse(), B)), k);
  assert.notEqual(inhaltsKennung(manifest([DATEIEN[0]!, { ...DATEIEN[1]!, sizeBytes: 1 }])), k);
  assert.notEqual(inhaltsKennung(manifest([DATEIEN[0]!, { ...DATEIEN[1]!, sha256: hex(3) }])), k);
});

test("„Ich halte vor“ mit Magnet und Inhalt: gebaut und gelesen; ältere Meldungen ohne bleiben gültig", () => {
  const inhalt = inhaltsKennung(manifest());
  const ev = signEvent(buildModelSeed("Qwen/Qwen2.5-0.5B-Instruct", A.pk, ["config.json"], undefined, T, { magnet: `magnet:?xt=urn:btih:${H}`, inhalt }), A.sk);
  assert.deepEqual(ev.tags.slice(-2), [["magnet", `magnet:?xt=urn:btih:${H}`], ["inhalt", inhalt]]);
  const s = parseModelSeed(ev);
  assert.equal(s.magnet, `magnet:?xt=urn:btih:${H}`);
  assert.equal(s.inhalt, inhalt);
  const alt = parseModelSeed(signEvent(buildModelSeed("x", A.pk, ["a"], "eu", T), A.sk));
  assert.equal(alt.magnet, undefined);
  assert.equal(alt.inhalt, undefined);
  assert.equal(alt.region, "eu");
  // Eine kaputte Inhalts-Kennung wird nicht übernommen
  const kaputt = signEvent(buildModelSeed("x", A.pk, ["a"], undefined, T, { magnet: "egal", inhalt: "XYZ" }), A.sk);
  assert.equal(parseModelSeed(kaputt).inhalt, undefined);
});

test("Magnet-Quellen: nur diese Fassung, nur gültig signiert und gültige Magnete, je Knoten die neueste, meistgemeldete zuerst", () => {
  const m = manifest();
  const inhalt = inhaltsKennung(m);
  const seed = (kp: typeof A, magnet: string, at = T, i = inhalt, model = m.modelId) =>
    signEvent(buildModelSeed(model, kp.pk, ["config.json", "model.safetensors"], undefined, at, { magnet, inhalt: i }), kp.sk);
  const anderer = "e".repeat(40);
  const events = [
    seed(A, `magnet:?xt=urn:btih:${H}&tr=udp%3A%2F%2Ftracker.pirateface.co%3A6969`, T - 10),
    seed(A, `magnet:?xt=urn:btih:${anderer}`, T - 20), // älter von A – zählt nicht
    seed(B, `magnet:?xt=urn:btih:${H}`),
    seed(C, `magnet:?xt=urn:btih:${anderer}`),
    seed(generateKeypair(), `magnet:?xt=urn:btih:${"f".repeat(40)}`, T, "0".repeat(64)), // andere Fassung
    seed(generateKeypair(), `magnet:?xt=urn:btih:${"f".repeat(40)}`, T, inhalt, "anderes/modell"),
    seed(generateKeypair(), "magnet:?xt=urn:btih:kaputt"),
    seed(generateKeypair(), `magnet:?xt=urn:btih:${"9".repeat(40)}`, T - 15 * 24 * 3600), // zu alt
    { ...seed(generateKeypair(), `magnet:?xt=urn:btih:${"8".repeat(40)}`), sig: "0".repeat(128) }, // falsch signiert
  ];
  const q = magnetQuellen(events, m, T);
  assert.deepEqual(q.map((x) => [x.magnet.infohash, x.seeder]), [[H, 2], [anderer, 1]]);
  assert.deepEqual(q[0]!.magnet.tracker, ["udp://tracker.pirateface.co:6969"], "der erste gemeldete Link je Torrent");
  assert.deepEqual(magnetQuellen([], m, T), []);
});
