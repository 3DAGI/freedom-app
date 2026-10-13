/**
 * Schritt B-29c2b: Modelle im Schwarm – mit echtem aria2c (übersprungen, wenn
 * es fehlt; die CI installiert es). Zwei Knoten und ein kleiner Tracker auf
 * 127.0.0.1, DHT aus: Knoten A teilt den Freedom-Torrent aus seinem geprüften
 * Ordner, Knoten B holt über den Magnet nur die Dateien des Manifests, prüft
 * jede SHA-256 und legt sie in seinen Modellordner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModelManifest, generateKeypair, parseModelManifest, signEvent, type Magnet, type ModelFile } from "@freedomstack/protocol";
import { Aria2, aria2Konfiguration, starteAria2, torrentAusUmgebung, type LaufendesAria2 } from "../src/aria2.js";
import { holeUndTeile, teileModell, waehleDateien } from "../src/modell-schwarm.js";
import { bencode, baueModellTorrent, stueckGroesse, torrentName } from "../src/torrent.js";

const COMMIT = "c".repeat(40);
const KP = generateKeypair();
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const INHALT: Record<string, Buffer> = {
  "config.json": Buffer.from('{"architectures":["Qwen2ForCausalLM"],"hidden_size":896}'),
  "tokenizer.json": Buffer.from(JSON.stringify({ model: { vocab: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`t${i}`, i])) } })),
  "model.safetensors": Buffer.from(Array.from({ length: 700_000 }, (_, i) => (i * 7919) % 251)),
};
const DATEIEN: ModelFile[] = Object.entries(INHALT).map(([name, b]) => ({ name, sha256: sha(b), sizeBytes: b.length }));
const manifest = (files = DATEIEN) => parseModelManifest(signEvent(buildModelManifest({ modelId: "Qwen/Qwen2.5-0.5B-Instruct", name: "Qwen", files, upstream: `hf:Qwen/Qwen2.5-0.5B-Instruct@${COMMIT}`, publisherPubkey: KP.pk }), KP.sk));
const ort = () => mkdtempSync(join(tmpdir(), "schwarm-"));
function legeAn(ordner: string) {
  mkdirSync(ordner, { recursive: true });
  for (const [n, b] of Object.entries(INHALT)) writeFileSync(join(ordner, n), b);
}
const hatAria2 = (() => { try { execFileSync("aria2c", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("Bencode: Zahlen, Bytes, Listen, Wörterbücher mit sortierten Schlüsseln; Unsinn wirft", () => {
  assert.equal(bencode({ b: 1, a: ["x", Buffer.from([0, 255])], "ä": "ü" }).toString("latin1"), "d1:al1:x2:\u0000ÿe1:bi1e2:Ã¤2:Ã¼e");
  assert.throws(() => bencode(1.5), { name: "BencodeFehler" });
  assert.equal(stueckGroesse(1e6), 256 * 1024);
  assert.equal(stueckGroesse(2e9), 4 * 1024 * 1024);
  assert.equal(stueckGroesse(20e9), 16 * 1024 * 1024);
});

test("Freedom-Torrent: aus dem Manifest bestimmt – zwei Knoten bauen dieselbe Kennung; eine abweichende Datei wirft", async () => {
  const a = ort(), b = ort();
  legeAn(a); legeAn(b);
  const ta = await baueModellTorrent(manifest(), a);
  const tb = await baueModellTorrent(manifest([...DATEIEN].reverse()), b);
  assert.equal(ta.infohash, tb.infohash, "gleiche Bytes, gleiche Kennung");
  assert.equal(ta.name, COMMIT);
  assert.equal(torrentName(manifest()), COMMIT);
  assert.equal(ta.magnet, `magnet:?xt=urn:btih:${ta.infohash}`);
  assert.ok(ta.datei.includes(Buffer.from("https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/resolve/")), "Web-Seed von Hugging Face");
  if (hatAria2) {
    writeFileSync(join(a, "x.torrent"), ta.datei);
    const zeigt = execFileSync("aria2c", ["-S", join(a, "x.torrent")]).toString();
    assert.match(zeigt, new RegExp(`Info Hash: ${ta.infohash}`), "aria2 liest dieselbe Kennung");
  }
  writeFileSync(join(b, "config.json"), Buffer.from(INHALT["config.json"]!.toString().replace("896", "897")));
  await assert.rejects(baueModellTorrent(manifest(), b), { name: "DateiAnders" });
});

test("Auswahl im Torrent: Name in der obersten oder zweiten Ebene, Größe gleich – sonst fehlt oder anders", () => {
  const m = manifest();
  const d = (index: number, path: string, length: number) => ({ index: String(index), path, length: String(length), completedLength: "0", selected: "true" });
  const r = waehleDateien(m, [
    d(1, "/s/x/README.md", 10), d(2, "/s/x/config.json", INHALT["config.json"]!.length), d(3, "/s/x/onnx/model.safetensors", 1),
    d(4, "/s/x/model.safetensors", 700_000), d(5, "/s/x/tokenizer.json", INHALT["tokenizer.json"]!.length),
  ], "/s");
  assert.deepEqual([...r.treffer.keys()].sort(), ["config.json", "model.safetensors", "tokenizer.json"]);
  assert.equal(r.treffer.get("model.safetensors")!.index, "4", "nicht die aus dem Unterordner");
  const falsch = waehleDateien(m, [d(1, "/s/x/config.json", 1), d(2, "/s/x/model.safetensors", 700_000)], "/s");
  assert.deepEqual([falsch.anders, falsch.fehlt], [1, 1]);
});

test("Umgebung und Konfiguration: nur mit TORRENT=1, Ports geprüft; das Geheimnis nur in der Datei, RPC nur lokal", () => {
  assert.deepEqual(torrentAusUmgebung({}, "/o"), {});
  assert.deepEqual(torrentAusUmgebung({ TORRENT: "1" }, "/o").einstellung, { ordner: "/o", rpcPort: 6800, btPort: 6881, hochladenKbs: 0 });
  assert.equal(torrentAusUmgebung({ TORRENT: "1", TORRENT_PORT: "80" }, "/o").einstellung, undefined);
  assert.match(torrentAusUmgebung({ TORRENT: "1", TORRENT_PORT: "6800" }, "/o").grund ?? "", /gleich/);
  assert.match(torrentAusUmgebung({ TORRENT: "1", TORRENT_HOCHLADEN_KBS: "viel" }, "/o").grund ?? "", /ungültig/);
  const k = aria2Konfiguration({ ordner: "/o", rpcPort: 6800, btPort: 6881, hochladenKbs: 500 }, "g".repeat(64));
  assert.match(k, /^rpc-listen-all=false$/m);
  assert.match(k, /^rpc-secret=g{64}$/m);
  assert.match(k, /^seed-ratio=0\.0$/m);
  assert.match(k, /^max-overall-upload-limit=500K$/m);
  assert.match(k, /^bt-remove-unselected-file=true$/m);
  assert.match(k, /^dht-entry-point=router\.bittorrent\.com:6881$/m, "Einstieg ins DHT, sonst findet ein neuer Knoten niemanden");
  assert.match(k, /^dht-file-path=\/o\/dht\.dat$/m);
  const mitTracker = torrentAusUmgebung({ TORRENT: "1", TORRENT_TRACKER: "udp://tracker.pirateface.co:6969/announce", TORRENT_DHT_EINSTIEG: "dht.transmissionbt.com:6881" }, "/o").einstellung!;
  assert.deepEqual(mitTracker.tracker, ["udp://tracker.pirateface.co:6969/announce"]);
  assert.match(aria2Konfiguration(mitTracker, "g"), /^bt-tracker=udp:\/\/tracker\.pirateface\.co:6969\/announce$/m);
  assert.match(aria2Konfiguration(mitTracker, "g"), /^dht-entry-point=dht\.transmissionbt\.com:6881$/m);
  assert.match(torrentAusUmgebung({ TORRENT: "1", TORRENT_TRACKER: "udp://127.0.0.1:1" }, "/o").grund ?? "", /lokale/);
  assert.match(torrentAusUmgebung({ TORRENT: "1", TORRENT_DHT_EINSTIEG: "x y" }, "/o").grund ?? "", /host:port/);
  const quelle = readFileSync(new URL("../src/aria2.ts", import.meta.url), "utf8");
  assert.match(quelle, /spawn\(e\.befehl \?\? "aria2c", \[`--conf-path=\$\{konf\}`\]/, "das Geheimnis nie auf der Befehlszeile");
  assert.match(quelle, /writeFileSync\(konf, aria2Konfiguration\(e, geheimnis\), \{ mode: 0o600 \}\)/);
  assert.doesNotMatch(quelle, /console\./, "nichts ins Log");
});

test("aria2-Antworten: Fehler nur mit Kennung, nie mit dem Text von aria2", async () => {
  const a = new Aria2({ url: "http://x/jsonrpc", geheimnis: "g", holen: async () => new Response(JSON.stringify({ id: "1", error: { code: 1, message: "Unauthorized geheim" } })) });
  await assert.rejects(a.rufe("getVersion"), (e: Error & { code?: number }) => e.name === "Aria2Fehler" && e.code === 1 && !e.message.includes("geheim"));
  const b = new Aria2({ url: "http://x/jsonrpc", geheimnis: "g", holen: async () => new Response("kein json") });
  await assert.rejects(b.rufe("getVersion"), { name: "Aria2Fehler" });
});

/** Freie Ports für aria2 (RPC und BitTorrent). */
async function freierPort(): Promise<number> {
  return new Promise((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
}
/** Ein kleiner HTTP-Tracker (BEP-3, kompakte Antwort) – merkt sich je Kennung, wer sich meldet. */
function tracker(): Promise<{ url: string; schliessen: () => void }> {
  const peers = new Map<string, Map<string, Buffer>>();
  const s = http.createServer((req, res) => {
    const roh = (req.url ?? "").split("?")[1] ?? "";
    const teil = (k: string) => roh.split("&").find((x) => x.startsWith(`${k}=`))?.slice(k.length + 1);
    // Beide aria2 kodieren die Kennung gleich – als Schlüssel reicht der rohe Wert
    const kennung = teil("info_hash") ?? "";
    const port = Number(teil("port"));
    const liste = peers.get(kennung) ?? new Map<string, Buffer>();
    const eintrag = Buffer.alloc(6);
    eintrag.writeUInt8(127, 0); eintrag.writeUInt8(0, 1); eintrag.writeUInt8(0, 2); eintrag.writeUInt8(1, 3); eintrag.writeUInt16BE(port, 4);
    liste.set(String(port), eintrag);
    peers.set(kennung, liste);
    const andere = [...liste.entries()].filter(([p]) => p !== String(port)).map(([, b]) => b);
    res.end(bencode({ interval: 2, "min interval": 1, peers: Buffer.concat(andere) }));
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}/announce`, schliessen: () => { s.closeAllConnections(); s.close(); } })));
}
async function knoten(): Promise<LaufendesAria2> {
  return starteAria2({ ordner: ort(), rpcPort: await freierPort(), btPort: await freierPort(), hochladenKbs: 0, dht: false });
}

test("Schwarm (echtes aria2c): A teilt den Freedom-Torrent, B holt über den Magnet, prüft und legt nur Geprüftes in den Modellordner", { skip: !hatAria2 && "aria2c fehlt", timeout: 120_000 }, async () => {
  const t = await tracker();
  const a = await knoten(), b = await knoten();
  try {
    const m = manifest();
    const ordnerA = join(ort(), "Qwen", "Qwen2.5-0.5B-Instruct");
    legeAn(ordnerA);
    const geteilt = await teileModell(a.aria2, m, { ordner: ordnerA, schwarm: join(ort(), ".schwarm") }, [t.url]);
    assert.equal((await teileModell(a.aria2, m, { ordner: ordnerA, schwarm: join(ort(), ".schwarm") }, [t.url])).gid, geteilt.gid, "nicht zweimal");
    const magnet: Magnet = { infohash: geteilt.infohash, tracker: [t.url], webSeeds: [], link: `${geteilt.magnet}&tr=${encodeURIComponent(t.url)}` };
    const ordnerB = join(ort(), "Qwen", "Qwen2.5-0.5B-Instruct");
    const stand: number[] = [];
    const r = await holeUndTeile(b.aria2, magnet, m, { ordner: ordnerB, schwarm: join(ort(), ".schwarm") }, { taktMs: 200, stillMs: 60_000, fortschritt: (n) => stand.push(n) });
    assert.deepEqual(r, { ok: true, gid: (r as { gid: string }).gid, infohash: geteilt.infohash });
    assert.deepEqual(readdirSync(ordnerB).sort(), ["config.json", "model.safetensors", "tokenizer.json"]);
    for (const [n, inhalt] of Object.entries(INHALT)) assert.deepEqual(readFileSync(join(ordnerB, n)), inhalt, n);
    assert.equal(stand.at(-1), m.totalBytes);
    // B teilt weiter: aria2 meldet den Torrent als aktiv
    assert.ok((await b.aria2.aktive()).some((s) => s.infoHash === geteilt.infohash), "B teilt weiter");
  } finally {
    a.stoppe(); b.stoppe(); t.schliessen();
  }
});

test("Schwarm (echtes aria2c): Bytes, die nicht zum Manifest passen, kommen nie in den Modellordner", { skip: !hatAria2 && "aria2c fehlt", timeout: 120_000 }, async () => {
  const t = await tracker();
  const a = await knoten(), b = await knoten();
  try {
    // A teilt eine andere Fassung (eine Datei anders) unter demselben Namen
    const ordnerA = join(ort(), "m");
    legeAn(ordnerA);
    const andere = Buffer.from(INHALT["config.json"]!.toString().replace("896", "897"));
    writeFileSync(join(ordnerA, "config.json"), andere);
    const mA = manifest(DATEIEN.map((f) => (f.name === "config.json" ? { ...f, sha256: sha(andere) } : f)));
    const geteilt = await teileModell(a.aria2, mA, { ordner: ordnerA, schwarm: join(ort(), ".s") }, [t.url]);
    const magnet: Magnet = { infohash: geteilt.infohash, tracker: [t.url], webSeeds: [], link: `${geteilt.magnet}&tr=${encodeURIComponent(t.url)}` };
    // B erwartet die echte Fassung
    const ordnerB = join(ort(), "b");
    const schwarmB = join(ort(), ".s");
    const r = await holeUndTeile(b.aria2, magnet, manifest(), { ordner: ordnerB, schwarm: schwarmB }, { taktMs: 200, stillMs: 60_000 });
    assert.deepEqual(r, { ok: false, fall: "datei.summe", werte: { anzahl: 1 } });
    assert.equal(existsSync(ordnerB), false, "nichts im Modellordner");
    assert.equal(existsSync(join(schwarmB, geteilt.infohash)), false, "die Ablage ist weg");
  } finally {
    a.stoppe(); b.stoppe(); t.schliessen();
  }
});

test("Schwarm (echtes aria2c): wer die Dateien schon geprüft hat (etwa von Hugging Face), lädt nichts und teilt sofort", { skip: !hatAria2 && "aria2c fehlt", timeout: 120_000 }, async () => {
  const t = await tracker();
  const a = await knoten(), c = await knoten();
  try {
    const m = manifest();
    const ordnerA = join(ort(), "a");
    legeAn(ordnerA);
    const geteilt = await teileModell(a.aria2, m, { ordner: ordnerA, schwarm: join(ort(), ".s") }, [t.url]);
    const ordnerC = join(ort(), "c");
    legeAn(ordnerC);
    const vorher = statSync(join(ordnerC, "model.safetensors")).ino;
    const magnet: Magnet = { infohash: geteilt.infohash, tracker: [t.url], webSeeds: [], link: `${geteilt.magnet}&tr=${encodeURIComponent(t.url)}` };
    const r = await holeUndTeile(c.aria2, magnet, m, { ordner: ordnerC, schwarm: join(ort(), ".s") }, { taktMs: 200, stillMs: 60_000 });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(statSync(join(ordnerC, "model.safetensors")).ino, vorher, "die geprüfte Datei bleibt, wie sie war");
    assert.ok((await c.aria2.aktive()).some((s) => s.infoHash === geteilt.infohash));
  } finally {
    a.stoppe(); c.stoppe(); t.schliessen();
  }
});
