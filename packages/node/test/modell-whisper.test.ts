/**
 * Schritt B-38b3b2: Der Knoten lädt das Modell für Text aus Sprache geprüft – Wunsch über `npm run modell -- --whisper`,
 * Manifest wie bei anderen Modellen, genau eine Datei `ggml-<name>.bin` aus dem Repo von whisper.cpp, SHA-256 beim Laden,
 * Kennung `ggml` danach. Mit jedem Antrieb, nie im Angebot für KI. Hugging Face ist eine Attrappe auf 127.0.0.1 im Format
 * der echten API (aus dieser Umgebung nicht erreichbar).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModelManifest, generateKeypair, signEvent, type ModelFile, type NostrEvent } from "@freedomstack/protocol";
import { type LaderHilfen, ModellDienst, leseStand, leseWuensche, merkeWunsch, quellName } from "../src/modell-laden.js";
import { dateiAbdruck, gepruefterWhisper, holeWhisperStand, ladeWhisperDatei, ladeWhisperModell } from "../src/modell-whisper.js";
import { pruefeModelle } from "../src/modell-pruefung.js";

const COMMIT = "c".repeat(40);
const T = 1_800_000_000;
const KNOTEN = generateKeypair(), KURATOR = generateKeypair();
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// Wie ein Modell von whisper.cpp: Kennung `lmgg`, dann Bytes; „boese“ ist eine Pickle-Datei unter demselben Muster
const INHALT: Record<string, Buffer> = {
  "ggml-tiny.bin": Buffer.concat([Buffer.from([0x6c, 0x6d, 0x67, 0x67]), Buffer.alloc(100_000, 7)]),
  "ggml-boese.bin": Buffer.concat([Buffer.from([0x80, 0x02]), Buffer.alloc(50_000, 1)]),
};
const datei = (n: string): ModelFile => ({ name: n, sha256: sha(INHALT[n]!), sizeBytes: INHALT[n]!.length });

/** Hugging Face als Attrappe: Stand des Repos von whisper.cpp (`blobs=true`), Dateien unter `resolve/<commit>/`. */
function huggingface(liefere: Record<string, Buffer> = {}): Promise<{ url: string; schliessen: () => void; pfade: string[] }> {
  const pfade: string[] = [];
  const stand = {
    sha: COMMIT, cardData: { license: "mit" },
    siblings: [
      { rfilename: "README.md", size: 2600, blobId: "1".repeat(40) },
      ...Object.entries(INHALT).map(([n, b]) => ({ rfilename: n, size: b.length, blobId: "2".repeat(40), lfs: { sha256: sha(b), size: b.length } })),
    ],
  };
  const s = http.createServer((req, res) => {
    const pfad = req.url ?? "";
    pfade.push(pfad);
    if (pfad.startsWith("/api/models/ggerganov/whisper.cpp/revision/")) return void res.end(JSON.stringify(stand));
    const m = /^\/ggerganov\/whisper\.cpp\/resolve\/([0-9a-f]{40})\/(.+)$/.exec(pfad);
    const b = m && m[1] === COMMIT ? liefere[m[2]!] ?? INHALT[m[2]!] : undefined;
    if (!b) { res.writeHead(404); return void res.end(); }
    res.end(b);
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, schliessen: () => { s.closeAllConnections(); s.close(); }, pfade })));
}

const manifest = (o: { kp?: typeof KNOTEN; name?: string; files?: ModelFile[]; upstream?: string } = {}): NostrEvent => {
  const name = o.name ?? "tiny";
  return signEvent(buildModelManifest({
    modelId: `whisper:${name}`, name: `Whisper ${name}`, files: o.files ?? [datei(`ggml-${name}.bin`)],
    upstream: o.upstream ?? `hf:ggerganov/whisper.cpp@${COMMIT}`, publisherPubkey: (o.kp ?? KNOTEN).pk,
  }, T), (o.kp ?? KNOTEN).sk);
};

/** Hilfen wie in `main.ts` – mit Ollama als Antrieb (kein `hf`), Whisper aus der Attrappe. */
function hilfen(ordner: string, hfUrl: string, o: { manifeste?: NostrEvent[]; frei?: string[]; ohneWhisper?: true } = {}) {
  const veroeffentlicht: NostrEvent[] = [];
  const h: LaderHilfen = {
    manifeste: async () => o.manifeste ?? [manifest()],
    registry: async () => { throw new Error("nicht über Ollama"); },
    festhalten: async (name, files, upstream, license) => {
      const ev = signEvent(buildModelManifest({ modelId: name, name, files, upstream, license, publisherPubkey: KNOTEN.pk }, T), KNOTEN.sk);
      veroeffentlicht.push(ev);
      return ev;
    },
    pull: async () => { throw new Error("nie über Ollama"); },
    tags: async () => [{ name: "qwen2.5:0.5b", digest: "d".repeat(64) }],
    speicherGb: 16,
    freigaben: async () => new Set(o.frei ?? []),
    eigener: KNOTEN.pk,
    ...(o.ohneWhisper ? {} : {
      whisper: {
        ordner,
        stand: (name, rev) => holeWhisperStand(name, rev, hfUrl),
        ladeDatei: (commit, name, ziel, f, fortschritt) => ladeWhisperDatei(commit, name, ziel, f, { basis: hfUrl, fortschritt }),
        abdruck: dateiAbdruck,
      },
    }),
  };
  return { h, veroeffentlicht };
}
const ort = () => mkdtempSync(join(tmpdir(), "whisper-laden-"));

test("Datei laden: nur am Commit, SHA-256 beim Laden, danach die Kennung ggml – Pickle unter dem Namen wird gelöscht", async () => {
  const hf = await huggingface();
  const ordner = join(ort(), "whisper");
  try {
    assert.deepEqual(await holeWhisperStand("tiny", "main", hf.url), { ok: true, commit: COMMIT, datei: datei("ggml-tiny.bin"), lizenz: "mit" });
    assert.deepEqual(await holeWhisperStand("medium", "main", hf.url), { ok: false, fall: "whisper.fehlt" });
    const stand: number[] = [];
    assert.equal(await ladeWhisperDatei(COMMIT, "tiny", ordner, datei("ggml-tiny.bin"), { basis: hf.url, fortschritt: (b) => stand.push(b) }), "geladen");
    assert.deepEqual(readFileSync(join(ordner, "ggml-tiny.bin")), INHALT["ggml-tiny.bin"]);
    assert.equal(stand.at(-1), INHALT["ggml-tiny.bin"]!.length);
    assert.equal(await ladeWhisperDatei(COMMIT, "tiny", ordner, datei("ggml-tiny.bin"), { basis: hf.url }), "vorhanden");
    // Die Summe stimmt, die Kennung nicht: gelöscht, kein Bruchstück
    await assert.rejects(ladeWhisperDatei(COMMIT, "boese", ordner, datei("ggml-boese.bin"), { basis: hf.url }), (e: Error) => e.name === "KeinGgml");
    assert.equal(existsSync(join(ordner, "ggml-boese.bin")), false);
    assert.equal(existsSync(join(ordner, "ggml-boese.bin.teil")), false);
    // Falscher Name, Zweig, falsche Summe
    await assert.rejects(ladeWhisperDatei(COMMIT, "tiny", ordner, { ...datei("ggml-tiny.bin"), name: "ggml-base.bin" }, { basis: hf.url }), (e: Error) => e.name === "DateiName");
    await assert.rejects(ladeWhisperDatei("main", "tiny", ordner, datei("ggml-tiny.bin"), { basis: hf.url }), (e: Error) => e.name === "DateiName");
    await assert.rejects(ladeWhisperDatei(COMMIT, "../tiny", ordner, datei("ggml-tiny.bin"), { basis: hf.url }), (e: Error) => e.name === "DateiName");
    const neu = join(ort(), "w");
    await assert.rejects(ladeWhisperDatei(COMMIT, "tiny", neu, { ...datei("ggml-tiny.bin"), sha256: "e".repeat(64) }, { basis: hf.url }), (e: Error) => e.name === "DateiAnders");
    assert.equal(existsSync(join(neu, "ggml-tiny.bin")), false);
    assert.ok(hf.pfade.every((p) => !p.includes("/resolve/main/")), "nie an einem Zweig");
  } finally { hf.schliessen(); }
});

test("Abdruck der Datei: ändert sich mit Inhalt oder Zeit; ein Verweis oder eine fehlende Datei hat keinen", () => {
  const o = ort();
  const d = join(o, "ggml-tiny.bin");
  writeFileSync(d, INHALT["ggml-tiny.bin"]!);
  const a = dateiAbdruck(d);
  assert.match(a ?? "", /^100004:\d+:\d+$/);
  assert.equal(dateiAbdruck(d), a);
  utimesSync(d, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
  assert.notEqual(dateiAbdruck(d), a);
  symlinkSync(d, join(o, "verweis.bin"));
  assert.equal(dateiAbdruck(join(o, "verweis.bin")), null);
  assert.equal(dateiAbdruck(join(o, "fehlt.bin")), null);
  assert.equal(dateiAbdruck(o), null, "ein Ordner ist keine Datei");
});

test("Laden im Knoten: mit Ollama als Antrieb, Wunsch --whisper --aus-hf, festgehalten, geprüft – nie im Angebot für KI", async () => {
  const hf = await huggingface();
  const basis = ort();
  const dateien = { stand: join(basis, "modelle.json"), wunsch: join(basis, "wunsch.json") };
  try {
    const { h, veroeffentlicht } = hilfen(join(basis, "whisper"), hf.url, { manifeste: [] });
    assert.equal(merkeWunsch(dateien.wunsch, "tiny", T, true, "whisper"), "whisper:tiny");
    assert.deepEqual(leseWuensche(dateien.wunsch), [{ name: "whisper:tiny", seit: T, ausRegistry: true, quelle: "whisper" }]);
    const log: string[] = [];
    const dienst = new ModellDienst(h, dateien, (z) => log.push(z), () => T);
    assert.equal(await dienst.arbeite(), true);
    // Festgehalten: genau die eine Datei, Herkunft am Commit, Lizenz aus Hugging Face
    assert.equal(veroeffentlicht.length, 1);
    const tags = veroeffentlicht[0]!.tags;
    assert.deepEqual(tags.find((t) => t[0] === "d"), ["d", "model:whisper:tiny"]);
    assert.deepEqual(tags.find((t) => t[0] === "upstream"), ["upstream", `hf:ggerganov/whisper.cpp@${COMMIT}`]);
    assert.deepEqual(tags.find((t) => t[0] === "license"), ["license", "mit"]);
    assert.deepEqual(tags.filter((t) => t[0] === "file").map((t) => t[1]), ["ggml-tiny.bin"]);
    const stand = leseStand(dateien.stand);
    const pfad = join(basis, "whisper", "ggml-tiny.bin");
    assert.deepEqual(stand.modelle, [{
      name: "whisper:tiny", manifest: veroeffentlicht[0]!.id, herausgeber: KNOTEN.pk, dateien: 1, bytes: 100_004, ollama: "", geprueft: T,
      quelle: "whisper", datei: pfad, abdruck: dateiAbdruck(pfad),
    }]);
    assert.ok(log.includes("[modell] whisper:tiny: geprüft, für Text aus Sprache"), log.join("\n"));
    // Nie im Angebot für KI – auch nicht, wenn Ollama zufällig ein Modell gleichen Namens hätte
    assert.deepEqual(await dienst.imAngebot(), []);
    // Selbstprüfung: geprüft, solange die Datei unverändert ist
    const befund = (unveraendert: boolean) => pruefeModelle({
      angeboten: [], stand: leseStand(dateien.stand), wuensche: leseWuensche(dateien.wunsch), ollama: [], antrieb: "ollama",
      dateiUnveraendert: () => unveraendert,
    }).map((b) => `${b.stufe} ${b.name} ${b.fall}`);
    assert.deepEqual(befund(true), ["ok whisper:tiny modell.whisper"]);
    assert.deepEqual(befund(false), ["fehler whisper:tiny modell.whisperVeraendert"]);
    assert.equal(await dienst.arbeite(), false, "nichts mehr offen");
  } finally { hf.schliessen(); }
});

test("Laden im Knoten: Manifest nur eigenes oder aus einem Katalog, Vorprüfung am Commit, Pickle nie – mit Kennung", async () => {
  const hf = await huggingface();
  try {
    const fall = async (o: Parameters<typeof hilfen>[2], name = "tiny") => {
      const r = await ladeWhisperModell(name, hilfen(join(ort(), "w"), hf.url, o).h, () => {}, () => T);
      return r.ok ? "ok" : r.fall;
    };
    assert.equal(await fall({}), "ok");
    assert.equal(await fall({ manifeste: [manifest({ kp: KURATOR })] }), "manifest.keins", "ein fremdes nur mit Freigabe aus einem Katalog");
    assert.equal(await fall({ manifeste: [manifest({ kp: KURATOR })], frei: [manifest({ kp: KURATOR }).id] }), "ok");
    assert.equal(await fall({ manifeste: [manifest({ upstream: `hf:jemand/whisper.cpp@${COMMIT}` })] }), "manifest.keineQuelle");
    const pfadeVorher = hf.pfade.length;
    assert.equal(await fall({ manifeste: [manifest({ files: [{ ...datei("ggml-tiny.bin"), sizeBytes: 100_005 }] })] }), "whisper.anders");
    assert.ok(hf.pfade.slice(pfadeVorher).every((p) => !p.includes("/resolve/")), "bei anderer Datei am Commit wird nichts geladen");
    assert.equal(await fall({ manifeste: [manifest({ name: "boese" })] }, "boese"), "whisper.keinGgml");
    assert.equal(await fall({}, "../x"), "whisper.form");
    assert.equal(await fall({ ohneWhisper: true }), "whisper.form");
    // Ohne Hugging Face: kein Festhalten
    const stumm = await ladeWhisperModell("tiny", hilfen(join(ort(), "w"), "http://127.0.0.1:9").h, () => {}, () => T, true);
    assert.deepEqual(stumm.ok ? "ok" : [stumm.fall, Object.keys(stumm.werte ?? {})], ["whisper.nichtErreichbar", ["fehler"]]);
  } finally { hf.schliessen(); }
});

test("Wünsche und Stand: whisper:<name> mit Vorsatz, ohne Whisper-Weg bleibt der Wunsch liegen, Kaputtes fällt weg", async () => {
  const basis = ort();
  const w = join(basis, "wunsch.json");
  assert.equal(quellName("whisper", "large-v3-turbo-q5_0"), "whisper:large-v3-turbo-q5_0");
  assert.equal(quellName("whisper", "whisper:base"), "whisper:base");
  for (const falsch of ["Base", "a/b", "../x", ""]) assert.equal(merkeWunsch(w, falsch, T, false, "whisper"), null, falsch);
  assert.equal(merkeWunsch(w, "base", T, false, "whisper", "magnet:?xt=urn:btih:" + "a".repeat(40)), null, "kein Magnet für Whisper");
  assert.equal(merkeWunsch(w, "base", T, false, "whisper"), "whisper:base");
  // Ein Knoten ohne Whisper-Weg lässt den Wunsch liegen
  const dateien = { stand: join(basis, "modelle.json"), wunsch: w };
  const ohne = new ModellDienst(hilfen(join(basis, "x"), "http://127.0.0.1:9", { ohneWhisper: true }).h, dateien, () => {}, () => T);
  assert.equal(await ohne.arbeite(), false);
  assert.deepEqual(leseStand(dateien.stand).ergebnisse, []);
  // Stand streng: ein Whisper-Eintrag ohne Datei oder mit fremdem Namen gilt nicht
  mkdirSync(basis, { recursive: true });
  const eintrag = { manifest: "m", herausgeber: KNOTEN.pk, dateien: 1, bytes: 1, ollama: "", geprueft: T, quelle: "whisper", abdruck: "1:2:3" };
  writeFileSync(dateien.stand, JSON.stringify({
    modelle: [{ ...eintrag, name: "whisper:base", datei: "/x/ggml-base.bin" }, { ...eintrag, name: "whisper:tiny" }, { ...eintrag, name: "qwen2.5:0.5b", datei: "/x" }],
    ergebnisse: [],
  }));
  assert.deepEqual(leseStand(dateien.stand).modelle.map((m) => m.name), ["whisper:base"]);
});

test("B-38b3b3: das geprüfte Modell für Whisper – das zuletzt geprüfte mit unveränderter Datei, sonst keins", () => {
  const m = (name: string, geprueft: number, abdruck: string, quelle?: "whisper" | "hf") => ({
    name, manifest: "m", herausgeber: KNOTEN.pk, dateien: 1, bytes: 1, ollama: "", geprueft, abdruck,
    ...(quelle === "hf" ? { quelle, ordner: `/m/${name}` } : quelle ? { quelle, datei: `/w/${name}.bin` } : {}),
  });
  const abdrucke: Record<string, string> = { "/w/whisper:base.bin": "a", "/w/whisper:large-v3-turbo-q5_0.bin": "b", "/m/Qwen/Q": "c" };
  const stand = (...modelle: ReturnType<typeof m>[]) => ({ modelle, ergebnisse: [] });
  const nimm = (s: ReturnType<typeof stand>) => gepruefterWhisper(s, (d) => abdrucke[d] ?? null);
  const base = m("whisper:base", T, "a", "whisper"), turbo = m("whisper:large-v3-turbo-q5_0", T + 5, "b", "whisper");
  assert.equal(nimm(stand(base, turbo)), "/w/whisper:large-v3-turbo-q5_0.bin", "das zuletzt geprüfte");
  assert.equal(nimm(stand(base, { ...turbo, abdruck: "verändert" })), "/w/whisper:base.bin", "eine veränderte Datei zählt nicht");
  assert.equal(nimm(stand({ ...base, abdruck: "x" })), null);
  assert.equal(nimm(stand(m("Qwen/Q", T + 9, "c", "hf"), m("qwen2.5:0.5b", T + 9, "c"))), null, "andere Modelle nie");
  assert.equal(nimm(stand()), null);
});
