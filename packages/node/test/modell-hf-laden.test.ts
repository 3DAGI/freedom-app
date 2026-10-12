/**
 * Schritt B-29c1b: Der Knoten lädt Modelle von Hugging Face in einen Ordner,
 * geprüft gegen ein Manifest – für einen OpenAI-kompatiblen Antrieb, der das
 * Modell von dort liest. Im Angebot nur, solange der Antrieb es nennt und der
 * Ordner unverändert ist. Hugging Face ist eine Attrappe auf 127.0.0.1 im
 * Format der echten API (aus dieser Umgebung nicht erreichbar).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModelManifest, generateKeypair, signEvent, type ModelFile, type NostrEvent } from "@freedomstack/protocol";
import {
  type GeprueftesModell, type LaderHilfen, ModellDienst, ladeHfModell, leseStand, leseWuensche, merkeWunsch, modellOrdner,
} from "../src/modell-laden.js";
import { gitKennung, halteHfFest, hfOrdner, holeHfStand, ladeHfDatei, ordnerAbdruck, ordnerInhalt } from "../src/modell-hf.js";
import { pruefeModelle } from "../src/modell-pruefung.js";

const NAME = "Qwen/Qwen2.5-0.5B-Instruct";
const COMMIT = "d".repeat(40);
const T = 1_800_000_000;
const KNOTEN = generateKeypair(), FREMD = generateKeypair();
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const INHALT: Record<string, Buffer> = {
  "config.json": Buffer.from('{"architectures":["Qwen2ForCausalLM"]}'),
  "tokenizer.json": Buffer.from('{"version":"1.0"}'),
  "model.safetensors": Buffer.alloc(200_000, 3),
};

/** Hugging Face als Attrappe: Stand je Commit (`blobs=true`), Dateien unter `resolve/<commit>/`. */
function huggingface(liefere: Record<string, Buffer> = {}): Promise<{ url: string; schliessen: () => void; pfade: string[] }> {
  const pfade: string[] = [];
  const stand = {
    sha: COMMIT, cardData: { license: "apache-2.0" },
    siblings: Object.entries(INHALT).map(([n, b]) => (n.endsWith(".safetensors")
      ? { rfilename: n, size: b.length, blobId: "1".repeat(40), lfs: { sha256: sha(b), size: b.length } }
      : { rfilename: n, size: b.length, blobId: gitKennung(b) })),
  };
  const s = http.createServer((req, res) => {
    const pfad = req.url ?? "";
    pfade.push(pfad);
    if (pfad.startsWith("/api/models/Qwen/Qwen2.5-0.5B-Instruct/revision/")) return void res.end(JSON.stringify(stand));
    const m = /^\/Qwen\/Qwen2\.5-0\.5B-Instruct\/resolve\/([0-9a-f]{40})\/(.+)$/.exec(pfad);
    const b = m && m[1] === COMMIT ? liefere[m[2]!] ?? INHALT[m[2]!] : undefined;
    if (!b) { res.writeHead(404); return void res.end(); }
    res.end(b);
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, schliessen: () => { s.closeAllConnections(); s.close(); }, pfade })));
}

const DATEIEN: ModelFile[] = Object.entries(INHALT).map(([name, b]) => ({ name, sha256: sha(b), sizeBytes: b.length }));
const manifest = (kp = KNOTEN, files = DATEIEN, upstream = `hf:${NAME}@${COMMIT}`): NostrEvent =>
  signEvent(buildModelManifest({ modelId: NAME, name: NAME, files, upstream, publisherPubkey: kp.pk }, T), kp.sk);

/** Hilfen wie in `main.ts`, mit Hugging Face aus der Attrappe und einem Antrieb, der `namen` bedient. */
function hilfen(basis: string, hfUrl: string, o: { manifeste?: NostrEvent[]; namen?: string[] | null } = {}) {
  const veroeffentlicht: NostrEvent[] = [];
  const h: LaderHilfen = {
    manifeste: async () => o.manifeste ?? [manifest()],
    registry: async () => { throw new Error("nicht über Ollama"); },
    festhalten: async (name, files, upstream, license) => {
      const ev = signEvent(buildModelManifest({ modelId: name, name, files, upstream, license, publisherPubkey: KNOTEN.pk }, T), KNOTEN.sk);
      veroeffentlicht.push(ev);
      return ev;
    },
    pull: async () => { throw new Error("nicht über Ollama"); },
    tags: async () => [],
    speicherGb: 16,
    vertraut: new Set(),
    eigener: KNOTEN.pk,
    hf: {
      basis,
      stand: (n, rev) => holeHfStand(n, rev, hfUrl),
      halteFest: (n) => halteHfFest(n, "main", hfUrl),
      ladeDatei: (n, commit, ordner, f, fortschritt) => ladeHfDatei(n, commit, ordner, f, { basis: hfUrl, fortschritt }),
      inhalt: ordnerInhalt,
      abdruck: ordnerAbdruck,
      ordner: (n) => hfOrdner(basis, n),
      antrieb: async () => { if (o.namen === null) throw new Error("stumm"); return o.namen ?? [NAME]; },
    },
  };
  return { h, veroeffentlicht };
}
const ort = () => mkdtempSync(join(tmpdir(), "hf-laden-"));

test("Laden: eigenes Manifest, Vorprüfung am Commit, jede Datei geprüft in den Ordner → geprüft, mit Fingerabdruck des Ordners", async () => {
  const hf = await huggingface();
  const basis = join(ort(), "modelle");
  try {
    const { h } = hilfen(basis, hf.url);
    const schritte: string[] = [];
    const r = await ladeHfModell(NAME, h, (s) => schritte.push(s), () => T);
    assert.ok(r.ok, JSON.stringify(r));
    const ordner = join(basis, "Qwen", "Qwen2.5-0.5B-Instruct");
    assert.deepEqual(r.modell, {
      name: NAME, manifest: manifest().id, herausgeber: KNOTEN.pk, dateien: 3, bytes: 200_000 + INHALT["config.json"]!.length + INHALT["tokenizer.json"]!.length,
      ollama: "", geprueft: T, quelle: "hf", ordner, abdruck: ordnerAbdruck(ordner),
    });
    assert.deepEqual(readdirSync(ordner).sort(), ["config.json", "model.safetensors", "tokenizer.json"]);
    assert.deepEqual([...new Set(schritte)], ["manifest", "vorpruefung", "laden", "pruefen"]);
    assert.ok(hf.pfade.some((p) => p.includes(`/revision/${COMMIT}?blobs=true`)), "Vorprüfung am Commit des Manifests, nicht an main");
  } finally { hf.schliessen(); }
});

test("Laden: Festhalten (--aus-hf) signiert, was Hugging Face am Commit nennt – mit Herkunft und Lizenz", async () => {
  const hf = await huggingface();
  try {
    const { h, veroeffentlicht } = hilfen(join(ort(), "m"), hf.url, { manifeste: [] });
    const r = await ladeHfModell(NAME, h, () => {}, () => T, true);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(veroeffentlicht.length, 1);
    const tags = veroeffentlicht[0]!.tags;
    assert.deepEqual(tags.find((t) => t[0] === "upstream"), ["upstream", `hf:${NAME}@${COMMIT}`]);
    assert.deepEqual(tags.find((t) => t[0] === "license"), ["license", "apache-2.0"]);
    assert.deepEqual(tags.filter((t) => t[0] === "file").map((t) => t[1]), ["config.json", "tokenizer.json", "model.safetensors"]);
  } finally { hf.schliessen(); }
});

test("Laden: fremdes Manifest, andere Dateien bei Hugging Face, falsche Bytes, fremde Datei im Ordner – nie im Angebot", async () => {
  const hf = await huggingface();
  try {
    const fall = async (o: Parameters<typeof hilfen>[2], vorher?: (basis: string) => void) => {
      const basis = join(ort(), "m");
      vorher?.(basis);
      const r = await ladeHfModell(NAME, hilfen(basis, hf.url, o).h, () => {}, () => T);
      return r.ok ? "ok" : r.fall;
    };
    assert.equal(await fall({ manifeste: [manifest(FREMD)] }), "manifest.keins", "bis E9-4 nur der eigene Schlüssel");
    assert.equal(await fall({ manifeste: [manifest(KNOTEN, DATEIEN, "ollama:qwen2.5:0.5b")] }), "manifest.keineQuelle");
    const groesser = DATEIEN.map((f) => (f.name === "config.json" ? { ...f, sizeBytes: f.sizeBytes + 1 } : f));
    assert.equal(await fall({ manifeste: [manifest(KNOTEN, groesser)] }), "hf.anders", "Vorprüfung: Hugging Face nennt eine andere Größe");
    // Die Vorprüfung kennt die Summe kleiner Dateien nicht – die Prüfung beim Laden fängt sie
    const andereSumme = DATEIEN.map((f) => (f.name === "tokenizer.json" ? { ...f, sha256: "e".repeat(64) } : f));
    assert.equal(await fall({ manifeste: [manifest(KNOTEN, andereSumme)] }), "hf.laden");
    assert.equal(await fall({}, (basis) => {
      const ordner = join(basis, "Qwen", "Qwen2.5-0.5B-Instruct");
      ladeVorher(ordner, "pytorch_model.bin");
    }), "datei.fremd", "eine fremde Datei läse der Antrieb mit");
  } finally { hf.schliessen(); }
  const falsch = await huggingface({ "model.safetensors": Buffer.alloc(200_000, 4) });
  try {
    const basis = join(ort(), "m");
    const r = await ladeHfModell(NAME, hilfen(basis, falsch.url).h, () => {}, () => T);
    assert.deepEqual(r, { ok: false, fall: "hf.laden", werte: { fehler: "DateiAnders" } });
    assert.equal(existsSync(join(basis, "Qwen", "Qwen2.5-0.5B-Instruct", "model.safetensors")), false, "nichts Falsches unter dem Namen");
  } finally { falsch.schliessen(); }
});
function ladeVorher(ordner: string, name: string) {
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, name), "x");
}

test("Dienst: Wunsch von Hugging Face → geprüft und im Angebot, solange der Antrieb es nennt und der Ordner unverändert ist", async () => {
  const hf = await huggingface();
  const o = ort();
  const dateien = { stand: join(o, "stand.json"), wunsch: join(o, "wunsch.json") };
  try {
    const basis = join(o, "modelle");
    const namen = [NAME];
    const { h } = hilfen(basis, hf.url, { namen });
    const dienst = new ModellDienst(h, dateien, () => {}, () => T);
    merkeWunsch(dateien.wunsch, "qwen2.5:0.5b", T - 2);
    merkeWunsch(dateien.wunsch, NAME, T - 1, true, "hf");
    assert.equal(await dienst.arbeite(), true);
    assert.equal(await dienst.arbeite(), false, "der Ollama-Wunsch wartet – dieser Antrieb lädt nur von Hugging Face");
    assert.deepEqual(await dienst.imAngebot(), [NAME]);
    const m = leseStand(dateien.stand).modelle[0]!;
    // Der Antrieb nennt es nicht mehr → raus
    namen.length = 0;
    assert.deepEqual(await dienst.imAngebot(), []);
    namen.push(NAME);
    assert.deepEqual(await dienst.imAngebot(), [NAME]);
    // Eine Datei im Ordner geändert (gleiche Größe, andere Zeit) → raus, bis neu geprüft
    const datei = join(m.ordner!, "config.json");
    utimesSync(datei, new Date(), new Date(Date.now() + 5_000));
    assert.deepEqual(await dienst.imAngebot(), []);
  } finally { hf.schliessen(); }
});

test("Dienst: ein Ollama-Knoten lädt keine Wünsche von Hugging Face; ein HF-Modell bietet er nicht an", async () => {
  const o = ort();
  const dateien = { stand: join(o, "stand.json"), wunsch: join(o, "wunsch.json") };
  const { h } = hilfen(join(o, "m"), "http://127.0.0.1:9");
  const { hf: _ohne, ...ollamaHilfen } = h;
  const dienst = new ModellDienst(ollamaHilfen, dateien, () => {}, () => T);
  merkeWunsch(dateien.wunsch, NAME, T, true, "hf");
  assert.equal(await dienst.arbeite(), false);
  writeFileSync(dateien.stand, JSON.stringify({ modelle: [hfModell(join(o, "x"))], ergebnisse: [] }));
  assert.deepEqual(await dienst.imAngebot(), []);
});

const hfModell = (ordner: string): GeprueftesModell => ({
  name: NAME, manifest: "a".repeat(64), herausgeber: KNOTEN.pk, dateien: 3, bytes: 9, ollama: "", geprueft: T, quelle: "hf", ordner, abdruck: "b".repeat(64),
});

test("Wunsch und Stand: Kennungen wie bei Hugging Face nur mit quelle hf; kaputte Einträge fallen weg", () => {
  const o = ort();
  const w = join(o, "w.json");
  assert.equal(merkeWunsch(w, NAME, 1, true, "hf"), NAME);
  assert.equal(merkeWunsch(w, "qwen2.5:0.5b", 2, false, "hf"), null, "kein Ollama-Name als Kennung bei Hugging Face");
  assert.equal(merkeWunsch(w, "a/b/c", 2, false, "hf"), null);
  assert.deepEqual(leseWuensche(w), [{ name: NAME, seit: 1, ausRegistry: true, quelle: "hf" }]);
  writeFileSync(w, JSON.stringify([{ name: NAME, seit: 3 }, { name: "x:1", seit: 4, quelle: "hf" }, { name: NAME, seit: 5, quelle: "hf" }]));
  assert.deepEqual(leseWuensche(w), [{ name: NAME, seit: 5, quelle: "hf" }], "ohne quelle gilt der Name als Ollama-Name – und der passt nicht");
  const s = join(o, "s.json");
  writeFileSync(s, JSON.stringify({ modelle: [hfModell("/m"), { ...hfModell("/m"), abdruck: 5 }, { ...hfModell("/m"), quelle: undefined }, { ...hfModell("/m"), name: "x:1" }], ergebnisse: [{ name: NAME, fall: "hf.laden", zeit: 1 }] }));
  const stand = leseStand(s);
  assert.deepEqual(stand.modelle, [hfModell("/m")]);
  assert.equal(stand.ergebnisse.length, 1);
  assert.equal(modellOrdner({ HOME: "/h" }), join("/h", ".freedom", "modelle"));
  assert.equal(modellOrdner({ HOME: "/h", MODELL_ORDNER: " /daten/modelle " }), "/daten/modelle");
});

test("Selbstprüfung: mit OpenAI-kompatiblem Antrieb ist ein HF-Modell geprüft – fehlt es beim Antrieb oder änderte sich der Ordner, nicht", () => {
  const stand = { modelle: [hfModell("/m")], ergebnisse: [] };
  const faelle = (ollama: Array<{ name: string; digest: string }> | null, unveraendert = true, antrieb: "openai" | "ollama" = "openai") =>
    pruefeModelle({ angeboten: [], stand, wuensche: [], ollama, antrieb, ordnerUnveraendert: () => unveraendert }).map((b) => b.fall);
  assert.deepEqual(faelle([{ name: NAME, digest: "" }]), ["modell.geprueft"]);
  assert.deepEqual(faelle([]), ["modell.fehltBeimAntrieb"]);
  assert.deepEqual(faelle(null), ["modell.antriebStumm"]);
  assert.deepEqual(faelle([{ name: NAME, digest: "" }], false), ["modell.ordnerVeraendert"]);
  assert.deepEqual(faelle([{ name: NAME, digest: "" }], true, "ollama"), ["modell.nurAntrieb"], "Ollama bedient es nicht");
  // Wünsche: je Quelle, was dieser Antrieb laden kann
  const w = (quelle?: "hf") => pruefeModelle({ angeboten: [], stand: { modelle: [], ergebnisse: [] }, wuensche: [{ name: NAME, seit: 1, ...(quelle ? { quelle } : {}) }], ollama: [], antrieb: "openai" })[0]!.fall;
  assert.equal(w("hf"), "modell.wartet");
  assert.equal(w(), "modell.ladenNurOllama");
  assert.equal(pruefeModelle({ angeboten: [], stand: { modelle: [], ergebnisse: [] }, wuensche: [{ name: NAME, seit: 1, quelle: "hf" }], ollama: [], antrieb: "ollama" })[0]!.fall, "modell.ladenNurAntrieb");
});

test("Schwarm (B-29c2c): erst Magnete aus dem Netz, dann der des Betreibers (Pirate Face) – gelingt einer, lädt Hugging Face nichts; danach geteilt", async () => {
  const hf = await huggingface();
  const basis = join(ort(), "m");
  try {
    const { h } = hilfen(basis, hf.url);
    const versucht: string[] = [];
    const geteilt: string[] = [];
    const ausNetz = { infohash: "1".repeat(40), tracker: [], webSeeds: [], link: `magnet:?xt=urn:btih:${"1".repeat(40)}` };
    h.hf!.schwarm = {
      quellen: async () => [ausNetz],
      hole: async (mg, m, ordner) => {
        versucht.push(mg.infohash);
        if (mg.infohash === ausNetz.infohash) return { ok: false, fall: "torrent.still" };
        // Der Magnet des Betreibers: legt die geprüften Dateien in den Ordner wie `holeUndTeile()`
        mkdirSync(ordner, { recursive: true });
        for (const f of m.files) writeFileSync(join(ordner, f.name), INHALT[f.name]!);
        return { ok: true };
      },
      teile: async (m) => { geteilt.push(m.modelId); return "f".repeat(40); },
    };
    const pf = `magnet:?xt=urn:btih:${"2".repeat(40)}&tr=udp%3A%2F%2Ftracker.pirateface.co%3A6969`;
    const vorher = hf.pfade.filter((p) => p.includes("/resolve/")).length;
    const r = await ladeHfModell(NAME, h, () => {}, () => T, false, pf);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(versucht, ["1".repeat(40), "2".repeat(40)], "erst das Netz, dann Pirate Face");
    assert.equal(hf.pfade.filter((p) => p.includes("/resolve/")).length, vorher, "Hugging Face lud nichts");
    assert.deepEqual(geteilt, [NAME]);
    assert.equal(r.modell.torrent, "f".repeat(40));
  } finally { hf.schliessen(); }
});

test("Schwarm (B-29c2c): scheitern alle Magnete, lädt Hugging Face direkt; ein Fehler beim Teilen hält das Modell nicht auf", async () => {
  const hf = await huggingface();
  try {
    const { h } = hilfen(join(ort(), "m"), hf.url);
    h.hf!.schwarm = {
      quellen: async () => { throw new Error("Relays stumm"); },
      hole: async () => ({ ok: false }),
      teile: async () => { throw new Error("aria2 weg"); },
    };
    const r = await ladeHfModell(NAME, h, () => {}, () => T, false, `magnet:?xt=urn:btih:${"3".repeat(40)}`);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.modell.torrent, undefined);
    assert.ok(hf.pfade.some((p) => p.includes("/resolve/")), "Hugging Face lud");
  } finally { hf.schliessen(); }
});

test("Wunsch mit Magnet (B-29c2c): nur für Hugging Face und nur gültig; gemerkt wird der neu gebaute Link", () => {
  const w = join(ort(), "w.json");
  assert.equal(merkeWunsch(w, NAME, 1, false, "hf", `magnet:?xt=urn:btih:${"A".repeat(40)}&dn=x&xs=https%3A%2F%2Fevil.example.org%2Fa`), NAME);
  assert.deepEqual(leseWuensche(w), [{ name: NAME, seit: 1, quelle: "hf", magnet: `magnet:?xt=urn:btih:${"a".repeat(40)}` }]);
  assert.equal(merkeWunsch(w, NAME, 2, false, "hf", "magnet:?xt=urn:btih:kaputt"), null, "ungültig – nichts vorgemerkt");
  assert.equal(merkeWunsch(w, "qwen2.5:0.5b", 2, false, "ollama", `magnet:?xt=urn:btih:${"a".repeat(40)}`), null, "nicht über Ollama");
  writeFileSync(w, JSON.stringify([{ name: NAME, seit: 3, quelle: "hf", magnet: "magnet:?xt=urn:btih:zz" }]));
  assert.deepEqual(leseWuensche(w), [{ name: NAME, seit: 3, quelle: "hf" }], "ein kaputter Magnet in der Datei fällt weg");
});
