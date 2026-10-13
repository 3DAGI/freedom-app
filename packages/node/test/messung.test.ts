/**
 * Durchsatz messen (Sammlung B-29b): dasselbe Modell bei einer und bei N
 * gleichzeitigen Anfragen – über denselben Weg wie echte Anfragen, ohne
 * Werkzeuge, Fehler nur mit Namen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type InferenceRequest, OllamaBackend } from "../src/inference.js";
import { MESS_FRAGEN, anfragenFuer, leseMessWunsch, messTabelle, missStufe, werteAus } from "../src/messung.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("B-29b: Aufruf – Stufen sortiert und ohne Doppelte, Vorgaben, alles Ungültige mit Grund", () => {
  assert.deepEqual(leseMessWunsch([]).wunsch, { gleichzeitig: [1, 4], tokens: 256 });
  assert.deepEqual(leseMessWunsch(["--gleichzeitig", "8,1,4,4", "--anfragen", "20", "--tokens", "512", "--modell", "Qwen/Qwen2.5-7B-Instruct"]).wunsch,
    { gleichzeitig: [1, 4, 8], anfragen: 20, tokens: 512, modell: "Qwen/Qwen2.5-7B-Instruct" });
  for (const args of [
    ["--gleichzeitig"], ["--parallel", "4"], ["--gleichzeitig", "0"], ["--gleichzeitig", "65"], ["--gleichzeitig", "1,a"],
    ["--gleichzeitig", "1,2,3,4,5,6,7,8,9"], ["--gleichzeitig", "-1"], ["--anfragen", "0"], ["--anfragen", "513"],
    ["--tokens", "8"], ["--tokens", "5000"], ["--tokens", "2.5"],
  ]) assert.ok(leseMessWunsch(args).grund, args.join(" "));
  assert.deepEqual([1, 4, 8].map((n) => anfragenFuer({}, n)), [4, 8, 16], "doppelt so viele wie gleichzeitig, mindestens 4");
  assert.equal(anfragenFuer({ anfragen: 3 }, 8), 3);
});

test("B-29b: höchstens N zugleich, alle gestellt – ohne Werkzeuge, mit Modell und Grenze, Fragen wechseln", async () => {
  for (const [gleichzeitig, anfragen, erwartet] of [[4, 10, 4], [8, 3, 3], [1, 5, 1]] as const) {
    const gesehen: InferenceRequest[] = [];
    let laufend = 0;
    let hoechstens = 0;
    const backend = {
      async complete(req: InferenceRequest) {
        gesehen.push(req);
        hoechstens = Math.max(hoechstens, ++laufend);
        await new Promise((r) => setImmediate(r));
        laufend--;
        return { output: "x", model: req.model!, promptTokens: 3, completionTokens: 10, durationMs: 1 };
      },
    };
    const s = await missStufe(backend, { modell: "m", gleichzeitig, anfragen, tokens: 64 });
    assert.equal(hoechstens, erwartet, `${gleichzeitig} gleichzeitig`);
    assert.equal(gesehen.length, anfragen);
    assert.equal(s.dauern.length, anfragen);
    assert.equal(s.tokens, 10 * anfragen);
    assert.ok(gesehen.every((r) => r.ohneWerkzeuge === true && r.model === "m" && r.maxTokens === 64 && !r.swarm && !r.history));
    assert.deepEqual(gesehen.map((r) => r.prompt), Array.from({ length: anfragen }, (_, i) => MESS_FRAGEN[i % MESS_FRAGEN.length]));
  }
});

test("B-29b: Fehler nur mit Namen – nie die Meldung (sie kann die Frage tragen)", async () => {
  let nr = 0;
  const backend = {
    async complete(req: InferenceRequest) {
      if (nr++ % 2) throw Object.assign(new Error(`Antrieb sagt: ${req.prompt} Mein Kontostand`), { name: "TimeoutError" });
      return { output: "x", model: "m", promptTokens: 1, completionTokens: 5, durationMs: 1 };
    },
  };
  const s = await missStufe(backend, { modell: "m", gleichzeitig: 2, anfragen: 4, tokens: 64 });
  assert.deepEqual(s.fehler, ["TimeoutError", "TimeoutError"]);
  assert.equal(s.dauern.length, 2);
  const tabelle = messTabelle("openai", "m", [werteAus(s)], s.fehler);
  assert.match(tabelle, /Fehler \(nur Namen\): TimeoutError$/);
  assert.ok(!tabelle.includes("Kontostand") && !JSON.stringify(s).includes("Kontostand"));
});

test("B-29b: Auswertung – Tokens je Sekunde über die Wanduhr, Median und p95; ohne Tokens keine erfundene Zahl", () => {
  const a = werteAus({ gleichzeitig: 4, anfragen: 4, ms: 2000, dauern: [4000, 1000, 3000, 2000], tokens: 400, ohneTokens: 0, fehler: [] });
  assert.deepEqual(a, { gleichzeitig: 4, fertig: 4, fehler: 0, tokensJeSek: 200, antwortenJeMin: 120, medianSek: 2, p95Sek: 4 });
  const ohne = werteAus({ gleichzeitig: 1, anfragen: 2, ms: 1000, dauern: [500, 500], tokens: 10, ohneTokens: 1, fehler: [] });
  assert.equal(ohne.tokensJeSek, undefined, "ein Antrieb ohne Zahl – nicht aus dem Rest hochrechnen");
  const leer = werteAus({ gleichzeitig: 2, anfragen: 2, ms: 10, dauern: [], tokens: 0, ohneTokens: 0, fehler: ["TypeError", "TypeError"] });
  assert.deepEqual([leer.fertig, leer.fehler, leer.tokensJeSek, leer.medianSek], [0, 2, undefined, 0]);
  // Faktor gegen die erste Stufe – über Tokens, wenn alle sie haben, sonst über Antworten je Minute
  const t = messTabelle("ollama", "qwen", [{ ...a, gleichzeitig: 1, tokensJeSek: 100 }, { ...a, tokensJeSek: 250 }]);
  assert.match(t, /^Antrieb ollama, Modell qwen\n/);
  assert.match(t.split("\n")[3]!, /^\s+4\s+4\/4\s+250,0\s+120,0\s+2,00\s+4,00\s+2,50×$/);
  const gemischt = messTabelle("openai", "m", [{ ...a, gleichzeitig: 1, antwortenJeMin: 30 }, { ...ohne, gleichzeitig: 4, antwortenJeMin: 90 }]);
  assert.match(gemischt.split("\n")[3]!, /–\s+90,0\s.*3,00×$/);
  assert.match(gemischt, /Antworten je Minute/);
});

test("B-29b: durch den echten Antrieb – OpenAI-kompatibel und Ollama, je Anfrage ohne Werkzeuge", async () => {
  const alt = globalThis.fetch;
  const koerper: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      koerper.push({ url, ...JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(url.endsWith("/chat/completions")
        ? { choices: [{ message: { content: "Antwort" } }], usage: { prompt_tokens: 20, completion_tokens: 50 } }
        : { message: { content: "Antwort" }, prompt_eval_count: 20, eval_count: 40 }));
    }) as typeof fetch;
    const openai = await missStufe(new OllamaBackend("http://127.0.0.1:8000/v1", "m", { antrieb: "openai" }), { modell: "m", gleichzeitig: 3, anfragen: 6, tokens: 128 });
    assert.deepEqual([openai.dauern.length, openai.tokens, openai.fehler], [6, 300, []]);
    const ollama = await missStufe(new OllamaBackend("http://127.0.0.1:11434", "m"), { modell: "m", gleichzeitig: 2, anfragen: 2, tokens: 128 });
    assert.deepEqual([ollama.dauern.length, ollama.tokens], [2, 80]);
  } finally {
    globalThis.fetch = alt;
  }
  assert.equal(koerper.length, 8);
  assert.ok(koerper.slice(0, 6).every((k) => k.url === "http://127.0.0.1:8000/v1/chat/completions" && k.tools === undefined && k.max_tokens === 128));
  assert.ok(koerper.slice(6).every((k) => k.url === "http://127.0.0.1:11434/api/chat" && k.tools === undefined));
});

test("B-29b: Verdrahtung – npm run messen nimmt den Antrieb des Knotens, wärmt auf, gibt keine Antworten aus", () => {
  assert.equal(JSON.parse(quelle("../package.json")).scripts.messen, "node --import tsx src/messen.ts");
  const messen = quelle("../src/messen.ts");
  assert.match(messen, /const \{ antrieb, grund: antriebGrund \} = antriebAusUmgebung\(process\.env\);/);
  assert.match(messen, /new OllamaBackend\(antrieb\.url, modell, \{ antrieb: antrieb\.art, schluessel: antrieb\.schluessel \}\)/);
  assert.match(messen, /const warm = await missStufe\(backend, \{ modell, gleichzeitig: 1, anfragen: 1/);
  assert.match(messen, /const stufe = await missStufe\(backend, \{ modell, gleichzeitig: n, anfragen, tokens: wunsch\.tokens \}\);/);
  assert.doesNotMatch(messen, /\.output|schluessel\}|KI_SCHLUESSEL/, "weder Antworten noch Schlüssel auf den Bildschirm");
  assert.doesNotMatch(quelle("../src/messung.ts"), /console\./, "der Baustein schreibt nichts selbst");
});
