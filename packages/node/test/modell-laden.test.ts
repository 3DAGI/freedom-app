/**
 * Schritt E9-3a: Modelle laden im Knoten. Ein Modell steht erst im Angebot,
 * wenn die Schichten, die Ollama geladen hat, genau die eines Manifests von
 * einem vertrauten Schlüssel sind – und nur, solange Ollama unter dem Namen
 * dasselbe hat. Ollama und die Registry sind hier Attrappen im Format der
 * echten (NDJSON von `/api/pull`, `/api/tags`, Docker-Manifest v2); gegen die
 * echte Registry prüft der MENSCH (aus dieser Umgebung nicht erreichbar).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEvent, buildModelManifest, generateKeypair, KIND_DVM_TEXT_GENERATION, leseOllamaName, MemoryRelay, ollamaDateien, OutboxPool, signEvent,
  type ModelFile, type NostrEvent, type Schicht,
} from "@freedomstack/protocol";
import {
  ladeModell, leseStand, leseWuensche, merkeWunsch, ModellDienst, offeneWuensche, ollamaPull, ollamaTags, registryDateien,
  type LaderHilfen,
} from "../src/modell-laden.js";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

const hex = (n: number) => n.toString(16).padStart(64, "0");
const KURATOR = generateKeypair(), FREMD = generateKeypair(), KNOTEN = generateKeypair();
const REGISTRY = {
  schemaVersion: 2,
  config: { digest: `sha256:${hex(9)}`, size: 487 },
  layers: [{ digest: `sha256:${hex(1)}`, size: 397_807_936 }, { digest: `sha256:${hex(2)}`, size: 1_482 }],
};
const DATEIEN = ollamaDateien(REGISTRY)!;
const SCHICHTEN: Schicht[] = [...REGISTRY.layers, REGISTRY.config].map((s) => ({ digest: s.digest, groesse: s.size }));
const NAME = "qwen2.5:0.5b";
const T = 1_800_000_000;
const manifest = (kp = KNOTEN, files: ModelFile[] = DATEIEN): NostrEvent =>
  signEvent(buildModelManifest({ modelId: NAME, name: "Qwen", files, upstream: `ollama:${NAME}`, publisherPubkey: kp.pk }, T), kp.sk);

/** Hilfen mit Zählern: was wurde gefragt, festgehalten, geladen. Vertraut ist bis E9-4 nur der eigene Schlüssel. */
function hilfen(teile: Partial<LaderHilfen> = {}) {
  const zaehler = { manifeste: 0, registry: 0, festhalten: [] as ModelFile[][], pull: 0 };
  const h: LaderHilfen = {
    manifeste: async () => { zaehler.manifeste++; return [manifest()]; },
    registry: async () => { zaehler.registry++; return DATEIEN; },
    festhalten: async (name, files) => { zaehler.festhalten.push(files); return signEvent(buildModelManifest({ modelId: name, name, files, upstream: `ollama:${name}`, publisherPubkey: KNOTEN.pk }, T), KNOTEN.sk); },
    pull: async (_name, fortschritt) => { zaehler.pull++; fortschritt(200_000_000); return SCHICHTEN; },
    tags: async () => [{ name: NAME, digest: "d1" }],
    speicherGb: 16,
    vertraut: new Set(),
    eigener: KNOTEN.pk,
    ...teile,
  };
  return { h, zaehler };
}

test("Laden: eigenes Manifest, passt, Registry gleich, Ollama lädt genau die Schichten → geprüft, mit Fingerabdruck", async () => {
  const { h, zaehler } = hilfen();
  const schritte: string[] = [];
  const r = await ladeModell(NAME, h, (s, g) => schritte.push(g === undefined ? s : `${s}:${g}`), () => T);
  assert.ok(r.ok);
  assert.deepEqual(r.modell, {
    name: NAME, manifest: manifest().id, herausgeber: KNOTEN.pk, dateien: 3, bytes: 397_807_936 + 1_482 + 487, ollama: "d1", geprueft: T,
  });
  assert.deepEqual(schritte, ["manifest", "vorpruefung", "laden:0", "laden:200000000", "pruefen"]);
  assert.deepEqual(zaehler, { manifeste: 1, registry: 1, festhalten: [], pull: 1 });
});

test("Laden: ohne eigenes Manifest (ein Kurator zählt bis E9-4 nicht), zu groß oder abweichende Registry – Ollama lädt nichts", async () => {
  for (const [teile, fall] of [
    [{ manifeste: async () => [manifest(FREMD)] }, "manifest.keins"],
    [{ manifeste: async () => [manifest(KURATOR)] }, "manifest.keins"],
    [{ manifeste: async () => [manifest(KNOTEN, DATEIEN.slice(1))], registry: async () => DATEIEN }, "registry.anders"],
    [{ speicherGb: 0.4 }, "passt.nicht"],
  ] as Array<[Partial<LaderHilfen>, string]>) {
    const { h, zaehler } = hilfen(teile);
    const r = await ladeModell(NAME, h, () => {});
    assert.ok(!r.ok && r.fall === fall, fall);
    assert.equal(zaehler.pull, 0, `${fall}: kein Download`);
  }
  const zuGross = await ladeModell(NAME, hilfen({ speicherGb: 0.4 }).h, () => {});
  assert.deepEqual(zuGross, { ok: false, fall: "passt.nicht", werte: { brauchtGb: 1, hatGb: 0 } });
});

test("Laden: ohne Registry entscheidet die Prüfung danach; fremde Schichten, Abbruch und fehlender Eintrag → nicht angeboten", async () => {
  const ohne = hilfen({ registry: async () => { throw new Error("nicht erreichbar"); } });
  assert.equal((await ladeModell(NAME, ohne.h, () => {})).ok, true, "Vorprüfung nicht möglich: geladen und danach geprüft");
  const fremd = await ladeModell(NAME, hilfen({ pull: async () => [...SCHICHTEN, { digest: `sha256:${hex(5)}`, groesse: 9 }] }).h, () => {});
  assert.deepEqual(fremd, { ok: false, fall: "schicht.fremd", werte: { anzahl: 1 } });
  const abbruch = await ladeModell(NAME, hilfen({ pull: async () => { throw Object.assign(new Error("geheimer Text der Registry"), { name: "OllamaFehler" }); } }).h, () => {});
  assert.deepEqual(abbruch, { ok: false, fall: "ollama.laden", werte: { fehler: "OllamaFehler" } }, "nur der Fehlername");
  const weg = await ladeModell(NAME, hilfen({ tags: async () => [] }).h, () => {});
  assert.deepEqual(weg, { ok: false, fall: "ollama.fehlt" });
});

test("Festhalten (--aus-registry): eigenes Manifest aus dem, was die Registry jetzt nennt – ohne Registry oder Veröffentlichung nichts", async () => {
  const gut = hilfen();
  const r = await ladeModell(NAME, gut.h, () => {}, () => T, true);
  assert.ok(r.ok && r.modell.herausgeber === KNOTEN.pk);
  assert.deepEqual(gut.zaehler.festhalten, [DATEIEN], "festgehalten genau die Dateien der Registry");
  assert.equal(gut.zaehler.manifeste, 0, "nicht über die Relays gesucht");
  assert.equal(gut.zaehler.registry, 1, "die Registry nur einmal gefragt");
  // Danach lädt Ollama, und die Schichten müssen trotzdem passen
  const anders = await ladeModell(NAME, hilfen({ pull: async () => SCHICHTEN.slice(1) }).h, () => {}, () => T, true);
  assert.deepEqual(anders, { ok: false, fall: "schicht.fehlt", werte: { anzahl: 1 } });
  const ohne = hilfen({ registry: async () => null });
  assert.deepEqual(await ladeModell(NAME, ohne.h, () => {}, () => T, true), { ok: false, fall: "registry.nichtErreichbar" });
  assert.deepEqual([ohne.zaehler.festhalten.length, ohne.zaehler.pull], [0, 0]);
  const stumm = hilfen({ festhalten: async () => { throw Object.assign(new Error("relay sagt nein"), { name: "PublishFehler" }); } });
  assert.deepEqual(await ladeModell(NAME, stumm.h, () => {}, () => T, true), { ok: false, fall: "manifest.nichtVeroeffentlicht", werte: { fehler: "PublishFehler" } });
  assert.equal(stumm.zaehler.pull, 0);
});

test("Dienst: Wunsch → geprüft und im Angebot; anderer Fingerabdruck bei Ollama → raus; jeder Wunsch nur einmal", async () => {
  const ort = mkdtempSync(join(tmpdir(), "modell-"));
  const dateien = { stand: join(ort, "modelle.json"), wunsch: join(ort, "modell-wunsch.json") };
  let tags = [{ name: NAME, digest: "d1" }];
  const { h, zaehler } = hilfen({ tags: async () => tags });
  let jetzt = 1_800_000_000;
  const log: string[] = [];
  const d = new ModellDienst(h, dateien, (z) => log.push(z), () => jetzt);
  assert.equal(await d.arbeite(), false, "ohne Wunsch nichts");
  assert.equal(merkeWunsch(dateien.wunsch, "qwen2.5:0.5b", jetzt - 10), NAME);
  assert.equal(await d.arbeite(), true);
  assert.deepEqual(await d.imAngebot(), [NAME]);
  assert.equal(statSync(dateien.stand).mode & 0o777, 0o600);
  assert.equal(statSync(dateien.wunsch).mode & 0o777, 0o600);
  assert.equal(leseStand(dateien.stand).laeuft, undefined, "nach dem Laden läuft nichts mehr");
  // Derselbe Wunsch wird nicht noch einmal geladen
  jetzt += 60;
  assert.equal(await d.arbeite(), false);
  assert.equal(zaehler.pull, 1);
  // Unter demselben Namen etwas anderes bei Ollama: nicht mehr im Angebot
  tags = [{ name: NAME, digest: "d2" }];
  assert.deepEqual(await d.imAngebot(), []);
  assert.deepEqual(d.angebot, []);
  // Neu festgehalten (--aus-registry): der Dienst reicht den Wunsch so weiter, danach wieder im Angebot
  jetzt += 60;
  merkeWunsch(dateien.wunsch, NAME, jetzt, true);
  assert.equal(await d.arbeite(), true);
  assert.equal(zaehler.festhalten.length, 1);
  assert.deepEqual(await d.imAngebot(), [NAME], "geprüft mit dem neuen Fingerabdruck");
  // Ollama nicht erreichbar: nichts Geprüftes im Angebot (nicht bestätigen, was man nicht sieht)
  const tot = new ModellDienst(hilfen({ tags: async () => { throw new Error("weg"); } }).h, dateien, () => {}, () => jetzt);
  assert.deepEqual(await tot.imAngebot(), []);
  // Ins Log nur Name und Kennung
  assert.ok(log.every((z) => z.startsWith(`[modell] ${NAME}:`)), log.join("\n"));
});

test("Dienst: ein gescheiterter Wunsch bleibt gescheitert, bis er neu vorgemerkt wird; nie zwei Ladevorgänge zugleich", async () => {
  const ort = mkdtempSync(join(tmpdir(), "modell-"));
  const dateien = { stand: join(ort, "modelle.json"), wunsch: join(ort, "modell-wunsch.json") };
  let freigabe!: () => void;
  const warten = new Promise<void>((r) => { freigabe = r; });
  const { h, zaehler } = hilfen({ manifeste: async () => [manifest(FREMD)] });
  let jetzt = 1_800_000_000;
  const d = new ModellDienst(h, dateien, () => {}, () => jetzt);
  merkeWunsch(dateien.wunsch, NAME, jetzt);
  assert.equal(await d.arbeite(), false);
  const s = leseStand(dateien.stand);
  assert.deepEqual(s.ergebnisse.map((e) => [e.name, e.fall]), [[NAME, "manifest.keins"]]);
  assert.deepEqual(offeneWuensche(leseWuensche(dateien.wunsch), s), []);
  // Neu vorgemerkt (später): wieder offen
  jetzt += 120;
  merkeWunsch(dateien.wunsch, NAME, jetzt);
  const langsam = new ModellDienst({ ...hilfen().h, pull: async (_n, f) => { f(1); await warten; return SCHICHTEN; } }, dateien, () => {}, () => jetzt);
  const erster = langsam.arbeite();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(leseStand(dateien.stand).laeuft?.schritt, "laden", "Fortschritt steht im Stand");
  assert.equal(await langsam.arbeite(), false, "zweiter Aufruf während des Ladens");
  freigabe();
  assert.equal(await erster, true);
  assert.equal(zaehler.pull, 0);
});

test("Wunsch: nur Namen wie bei Ollama; --aus-registry bleibt gemerkt", () => {
  const ort = mkdtempSync(join(tmpdir(), "modell-"));
  const datei = join(ort, "w.json");
  assert.equal(merkeWunsch(datei, "qwen2.5", 1), "qwen2.5:latest");
  assert.equal(merkeWunsch(datei, "hf.co/nutzer/x:Q4"), null);
  assert.equal(merkeWunsch(datei, "../../etc"), null);
  merkeWunsch(datei, "qwen2.5:latest", 5);
  assert.deepEqual(leseWuensche(datei), [{ name: "qwen2.5:latest", seit: 5 }], "derselbe Name ersetzt den älteren Wunsch");
  merkeWunsch(datei, "qwen2.5", 6, true);
  assert.deepEqual(leseWuensche(datei), [{ name: "qwen2.5:latest", seit: 6, ausRegistry: true }]);
  // Eine kaputte oder fremde Datei bricht nichts ab
  writeFileSync(datei, JSON.stringify([null, 5, { name: 7, seit: 1 }, { name: "x:1" }, { name: "x y", seit: 1 }, { name: "x:1", seit: 2, ausRegistry: "ja" }]));
  assert.deepEqual(leseWuensche(datei), [{ name: "x:1", seit: 2 }], "nur true zählt als Festhalten");
  writeFileSync(datei, "{kaputt");
  assert.deepEqual(leseWuensche(datei), []);
  writeFileSync(datei, JSON.stringify({ modelle: [{ name: 5 }, null], laeuft: { name: 1 }, ergebnisse: "x" }));
  assert.deepEqual(leseStand(datei), { modelle: [], laeuft: undefined, ergebnisse: [] });
});

/** Ollama-Attrappe: `/api/pull` als NDJSON in Stücken, `/api/tags`. */
function ollama(zeilen: object[], ende = true): Promise<{ url: string; schliessen: () => void; anfragen: unknown[] }> {
  const anfragen: unknown[] = [];
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: NAME, model: NAME, digest: "abc", size: 1 }, { name: 5 }] }));
      anfragen.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const text = zeilen.map((z) => JSON.stringify(z)).join("\n") + (ende ? "\n" : "");
      // In ungeraden Stücken – Zeilen dürfen über Paketgrenzen gehen
      for (let i = 0; i < text.length; i += 37) res.write(text.slice(i, i + 37));
      res.end();
    });
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, schliessen: () => s.close(), anfragen })));
}

test("Ollama: /api/pull liefert die Schichten mit Größe, auch aus dem Zwischenspeicher; Fehler und Abbruch ohne fremden Text", async () => {
  const d = (n: number) => `sha256:${hex(n)}`;
  const o = await ollama([
    { status: "pulling manifest" },
    { status: "pulling 000000000001", digest: d(1), total: 1000, completed: 0 },
    { status: "pulling 000000000001", digest: d(1), total: 1000, completed: 600 },
    { status: "pulling 000000000002", digest: d(2), total: 20, completed: 20 },
    { status: "pulling 000000000001", digest: d(1), total: 1000, completed: 1000 },
    { status: "verifying sha256 digest" }, { status: "writing manifest" }, { status: "success" },
  ]);
  const fortschritt: number[] = [];
  const schichten = await ollamaPull(o.url, NAME, (g) => fortschritt.push(g));
  assert.deepEqual(schichten, [{ digest: d(1), groesse: 1000 }, { digest: d(2), groesse: 20 }]);
  assert.deepEqual(fortschritt, [0, 600, 620, 1020]);
  assert.deepEqual(o.anfragen, [{ model: NAME, stream: true }]);
  assert.deepEqual(await ollamaTags(o.url), [{ name: NAME, digest: "abc" }], "unbrauchbare Einträge fallen weg");
  o.schliessen();

  const fehler = await ollama([{ status: "pulling manifest" }, { error: "pull model manifest: file does not exist" }]);
  await assert.rejects(ollamaPull(fehler.url, NAME, () => {}), (e: Error) => e.name === "OllamaFehler" && !e.message.includes("manifest"));
  fehler.schliessen();
  const ohneErfolg = await ollama([{ status: "pulling manifest" }, { status: "pulling 1", digest: d(1), total: 5, completed: 1 }], false);
  await assert.rejects(ollamaPull(ohneErfolg.url, NAME, () => {}), { name: "OllamaAbbruch" });
  ohneErfolg.schliessen();
});

test("Registry: feste Adresse, keine Weiterleitung, Antwort begrenzt; fremde Form → null", async () => {
  const echt = globalThis.fetch;
  const gefragt: Array<{ url: string; init?: RequestInit }> = [];
  let antwort: () => Response = () => new Response(JSON.stringify(REGISTRY));
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => { gefragt.push({ url: String(url), init }); return antwort(); }) as typeof fetch;
  try {
    assert.deepEqual(await registryDateien(leseOllamaName(NAME)!), DATEIEN);
    assert.equal(gefragt[0]!.url, "https://registry.ollama.ai/v2/library/qwen2.5/manifests/0.5b");
    assert.equal(gefragt[0]!.init?.redirect, "error");
    assert.equal((gefragt[0]!.init?.headers as Record<string, string>).accept, "application/vnd.docker.distribution.manifest.v2+json");
    antwort = () => new Response("x".repeat(300 * 1024));
    assert.equal(await registryDateien(leseOllamaName(NAME)!), null, "zu groß");
    antwort = () => new Response("{}", { status: 401 });
    assert.equal(await registryDateien(leseOllamaName(NAME)!), null);
    antwort = () => new Response(JSON.stringify({ schemaVersion: 1 }));
    assert.equal(await registryDateien(leseOllamaName(NAME)!), null);
  } finally {
    globalThis.fetch = echt;
  }
});

class Merker implements InferenceBackend {
  modelle: Array<string | undefined> = [];
  name(): string { return "m"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.modelle.push(req.model);
    return { output: "ok", model: req.model ?? "standard", promptTokens: 1, completionTokens: 1, durationMs: 1 };
  }
}

test("Provider: ein geprüftes Modell aus dem Angebot wird angenommen, ein nicht angebotenes nicht", async () => {
  const pool = new OutboxPool([new MemoryRelay("mem://modell-laden")], { minAcks: 1 });
  const backend = new Merker();
  const kunde = generateKeypair();
  const p = new DvmProvider({
    keypair: generateKeypair(), lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    freeTokensPerPubkeyPerDay: 1_000_000, modelle: () => ["standard:1", NAME],
  }, pool, backend);
  for (const m of [NAME, "fremd:1"]) {
    await pool.publish(signEvent(buildEvent(kunde.pk, KIND_DVM_TEXT_GENERATION, [["i", "frage", "text"], ["param", "model", m]], ""), kunde.sk));
    await p.pollOnce();
  }
  // Ein nicht angebotener Wunsch wird nie angenommen – seit B-41 antwortet dann das erste angebotene Modell, nie das
  // Standardmodell des Backends außerhalb des Angebots (Lauf 2 des lokalen Agenten)
  assert.deepEqual(backend.modelle, [NAME, "standard:1"]);
});

test("Verdrahtet: main.ts lädt über den Dienst und bietet Geprüftes an; npm run modell verbindet sich mit keinem Relay", () => {
  const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const main = quelle("../src/main.ts");
  assert.match(main, /vertraut: new Set\(\),\n    eigener: keypair\.pk,/, "bis E9-4 nur der eigene Schlüssel");
  assert.match(main, /festhalten: async \(name, files\) => \{\n      const ev = signEvent\(buildModelManifest\(\{ modelId: name, name, files, upstream: `ollama:\$\{name\}`, publisherPubkey: keypair\.pk \}\), keypair\.sk\);\n      await pool\.publish\(ev\);/);
  assert.doesNotMatch(main, /MODELL_HERAUSGEBER/);
  assert.match(main, /manifeste: \(name\) => pool\.query\(\{ kinds: \[KIND_MODEL_MANIFEST\], "#d": \[`model:\$\{name\}`\], limit: 100 \}\)/);
  assert.match(main, /\.\.\.gepruefteModelle,\n  \]\)\];/);
  assert.match(main, /modelle: angebotModelle,/);
  // Seit B-41 fragt das Angebot dazwischen Ollama, welche Modelle es hat (`nurBeiOllama()`)
  assert.match(main, /gepruefteModelle = await modellDienst\.imAngebot\(\);\n    ollamaNamen = await ollamaTags\(ollamaUrl\)[^\n]*\n    const models = angebotModelle\(\);/, "jedes Angebot frisch geprüft");
  assert.match(main, /if \(await modellDienst\.arbeite\(\)\.catch\(\(\) => false\)\) await pool\.publish\(\(await baueAngebot\(\)\)\.ev\)/);
  assert.match(quelle("../src/dvm-provider.ts"), /const offeredModels = this\.cfg\.modelle\?\.\(\) \?\?/);
  const cli = quelle("../src/modell.ts");
  assert.doesNotMatch(cli, /WebSocketRelay|OutboxPool|fetch\(/, "Relay-Verbindungen nur in main.ts (Tor)");
  assert.match(quelle("../package.json"), /"modell": "node --import tsx src\/modell\.ts"/);
});
