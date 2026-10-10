/**
 * KI-Antrieb wählbar (Sammlung B-29a, Anhang E): Ollama wie bisher oder ein
 * Dienst mit OpenAI-kompatibler Schnittstelle (vLLM, SGLang, TensorFold) – nur
 * auf diesem Rechner oder im Heimnetz. Werkzeuge, Swarm und Systemprompt gelten
 * für beide; nur der Aufruf unterscheidet sich.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OllamaBackend } from "../src/inference.js";
import { antriebAusUmgebung, antriebModelle, leseOpenAiModelle, lokaleAntriebAdresse } from "../src/ki-antrieb.js";
import type { ModellStand } from "../src/modell-laden.js";
import { MODELL_TEXT, pruefeModelle } from "../src/modell-pruefung.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** fetch durch eine Attrappe ersetzen – sie merkt sich jede Anfrage. */
async function mitAttrappe<T>(antworte: (url: string, init: RequestInit | undefined, nr: number) => Response, fn: () => Promise<T>) {
  const anfragen: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = [];
  const alt = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    anfragen.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return antworte(url, init, anfragen.length);
  }) as typeof fetch;
  try {
    return { wert: await fn(), anfragen };
  } finally {
    globalThis.fetch = alt;
  }
}

test("B-29a: KI_URL nur auf diesem Rechner oder im Heimnetz – ein Dienst im Internet ist kein Antrieb", () => {
  for (const [roh, erwartet] of [
    ["http://127.0.0.1:8000/v1", "http://127.0.0.1:8000/v1"],
    ["http://localhost:30000/v1/", "http://localhost:30000/v1"],
    ["http://192.168.1.20:8080/v1", "http://192.168.1.20:8080/v1"],
    ["http://10.0.0.7:8000/v1", "http://10.0.0.7:8000/v1"],
    ["http://[::1]:8000/v1", "http://[::1]:8000/v1"],
    ["http://vllm:8000/v1", "http://vllm:8000/v1"],
    ["http://gx10.local:8080/v1", "http://gx10.local:8080/v1"],
  ] as const) assert.equal(lokaleAntriebAdresse(roh), erwartet, roh);
  for (const roh of [
    "https://api.openai.com/v1", "http://8.8.8.8:8000/v1", "http://vllm.example.com/v1", "ftp://127.0.0.1/v1",
    "http://nutzer:geheim@127.0.0.1:8000/v1", "http://127.0.0.1:8000/v1?schluessel=x", "kein url", "http://[2001:db8::1]/v1",
  ]) assert.equal(lokaleAntriebAdresse(roh), undefined, roh);
});

test("B-29a: Wahl aus der Umgebung – Ollama wie bisher, OpenAI-kompatibel mit Vorgabe, sonst kein Start", () => {
  assert.deepEqual(antriebAusUmgebung({}), { antrieb: { art: "ollama", url: "http://localhost:11434" } });
  assert.deepEqual(antriebAusUmgebung({ OLLAMA_URL: "http://127.0.0.1:11435/" }).antrieb, { art: "ollama", url: "http://127.0.0.1:11435" });
  assert.deepEqual(antriebAusUmgebung({ KI_ANTRIEB: "openai" }).antrieb, { art: "openai", url: "http://127.0.0.1:8000/v1" }, "vLLM-Vorgabe");
  assert.deepEqual(antriebAusUmgebung({ KI_ANTRIEB: "OpenAI", KI_URL: "http://127.0.0.1:8080/v1", KI_SCHLUESSEL: " s3cret " }).antrieb,
    { art: "openai", url: "http://127.0.0.1:8080/v1", schluessel: "s3cret" });
  const fremd = antriebAusUmgebung({ KI_ANTRIEB: "openai", KI_URL: "https://api.openai.com/v1", KI_SCHLUESSEL: "s3cret" });
  assert.equal(fremd.antrieb, undefined);
  assert.match(fremd.grund!, /Heimnetz/);
  assert.ok(!fremd.grund!.includes("s3cret") && !fremd.grund!.includes("openai.com"), "Fehlertext ohne Schlüssel und Adresse");
  assert.match(antriebAusUmgebung({ KI_ANTRIEB: "llamacpp" }).grund!, /weder ollama noch openai/);
});

test("B-29a: OpenAI-kompatibel – Systemprompt, Werkzeuge, Grenze und Schlüssel gehen mit, Tokens aus `usage`", async () => {
  const { wert, anfragen } = await mitAttrappe(() => new Response(JSON.stringify({
    choices: [{ message: { content: "Antwort" } }], usage: { prompt_tokens: 11, completion_tokens: 7 },
  })), () => new OllamaBackend("http://127.0.0.1:8000/v1", "nemotron", { antrieb: "openai", schluessel: "s3cret" })
    .complete({ jobId: "j", prompt: "Frage", model: "qwen3.8:27b", maxTokens: 300 }));
  assert.deepEqual({ output: wert.output, model: wert.model, p: wert.promptTokens, c: wert.completionTokens },
    { output: "Antwort", model: "qwen3.8:27b", p: 11, c: 7 });
  assert.equal(anfragen.length, 1);
  assert.equal(anfragen[0]!.url, "http://127.0.0.1:8000/v1/chat/completions");
  assert.equal((anfragen[0]!.init!.headers as Record<string, string>).authorization, "Bearer s3cret");
  const body = anfragen[0]!.body!;
  assert.equal(body.model, "qwen3.8:27b");
  assert.equal(body.max_tokens, 300);
  assert.equal(body.stream, false);
  assert.equal((body.messages as Array<{ role: string }>)[0]!.role, "system");
  assert.deepEqual((body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name), ["web_search", "image_gen", "video_gen"]);
  // Gratis ohne Werkzeuge (A-14): auch hier keine
  const ohne = await mitAttrappe(() => new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] })),
    () => new OllamaBackend("http://127.0.0.1:8000/v1", "m", { antrieb: "openai" }).complete({ jobId: "j", prompt: "F", ohneWerkzeuge: true }));
  assert.equal(ohne.anfragen[0]!.body!.tools, undefined);
  assert.equal((ohne.anfragen[0]!.init!.headers as Record<string, string>).authorization, undefined, "ohne Schlüssel keine Kopfzeile");
});

test("B-29a: Werkzeug-Runde OpenAI-kompatibel – Argumente als JSON-Text, Antwort mit `tool_call_id`", async () => {
  const aufruf = { id: "call_1", type: "function", function: { name: "unbekannt_x", arguments: "{\"a\":\"b\"}" } };
  const { wert, anfragen } = await mitAttrappe((_u, _i, nr) => new Response(JSON.stringify(nr === 1
    ? { choices: [{ message: { content: null, tool_calls: [aufruf] } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }
    : { choices: [{ message: { content: "fertig" } }], usage: { prompt_tokens: 5, completion_tokens: 4 } })),
  () => new OllamaBackend("http://127.0.0.1:8000/v1", "m", { antrieb: "openai" }).complete({ jobId: "j", prompt: "F" }));
  assert.equal(wert.output, "fertig");
  assert.deepEqual([wert.promptTokens, wert.completionTokens], [8, 6]);
  const zweite = anfragen[1]!.body!.messages as Array<Record<string, unknown>>;
  assert.deepEqual(zweite.slice(-2), [
    { role: "assistant", content: "", tool_calls: [aufruf] },
    { role: "tool", tool_call_id: "call_1", content: "Unbekanntes Tool: unbekannt_x" },
  ]);
});

test("B-29a: Fehler des Dienstes nur mit Status, nie mit seinem Text; erreichbar über `/models`", async () => {
  const fehler = await mitAttrappe(() => new Response("interner Fehler mit Frage: Mein Kontostand", { status: 500 }),
    () => new OllamaBackend("http://127.0.0.1:8000/v1", "m", { antrieb: "openai" }).complete({ jobId: "j", prompt: "Mein Kontostand" }).catch((e: Error) => e));
  assert.ok(fehler.wert instanceof Error);
  assert.equal(fehler.wert.message, "KI-Antrieb HTTP 500");
  const da = await mitAttrappe(() => new Response(JSON.stringify({ data: [] })),
    () => new OllamaBackend("http://127.0.0.1:8000/v1", "m", { antrieb: "openai", schluessel: "k" }).available());
  assert.equal(da.wert, true);
  assert.equal(da.anfragen[0]!.url, "http://127.0.0.1:8000/v1/models");
  assert.equal(new OllamaBackend("http://127.0.0.1:8000/v1", "m", { antrieb: "openai", schluessel: "k" }).name(), "openai(m)", "ohne Schlüssel im Namen");
  assert.equal(new OllamaBackend("http://x", "m").name(), "ollama(m)");
});

test("B-29a: Strom OpenAI-kompatibel – ein Stück, ohne Denkspur wie bei Ollama", async () => {
  const stuecke: string[] = [];
  const { wert, anfragen } = await mitAttrappe(() => new Response(JSON.stringify({
    choices: [{ message: { content: "<think>erst überlegen</think>\nAntwort" } }], usage: { prompt_tokens: 2, completion_tokens: 9 },
  })), () => new OllamaBackend("http://127.0.0.1:8000/v1", "m", { antrieb: "openai" }).stream({ jobId: "j", prompt: "F", maxTokens: 50 }, (t) => stuecke.push(t)));
  assert.equal(wert.output, "Antwort");
  assert.deepEqual(stuecke, ["Antwort"], "die Denkspur geht auch nicht als Zwischenstand hinaus");
  assert.equal(anfragen[0]!.url, "http://127.0.0.1:8000/v1/chat/completions");
  assert.equal(anfragen[0]!.body!.max_tokens, 50);
  assert.deepEqual([wert.promptTokens, wert.completionTokens], [2, 9]);
});

test("B-29a: Modelle des Antriebs – OpenAI-kompatibel nur Kennungen aus `/models`, ohne Fingerabdruck", async () => {
  assert.deepEqual(leseOpenAiModelle({ data: [{ id: "Qwen/Qwen3-8B" }, { id: "Qwen/Qwen3-8B" }, { id: "" }, { id: "a\u0007b" }, { id: 5 }, null, { id: "nemotron" }] }),
    ["Qwen/Qwen3-8B", "nemotron"]);
  assert.deepEqual(leseOpenAiModelle({ data: "x" }), []);
  assert.equal(leseOpenAiModelle({ data: Array.from({ length: 500 }, (_, i) => ({ id: `m${i}` })) }).length, 200);
  const { wert, anfragen } = await mitAttrappe(() => new Response(JSON.stringify({ data: [{ id: "nemotron" }] })),
    () => antriebModelle({ art: "openai", url: "http://127.0.0.1:8080/v1", schluessel: "k" }));
  assert.deepEqual(wert, [{ name: "nemotron", digest: "" }]);
  assert.equal((anfragen[0]!.init!.headers as Record<string, string>).authorization, "Bearer k");
  await assert.rejects(mitAttrappe(() => new Response("", { status: 401 }), () => antriebModelle({ art: "openai", url: "http://127.0.0.1:8080/v1" })));
});

test("B-29a: Selbstprüfung mit OpenAI-kompatiblem Antrieb – geprüft nur über Ollama, Wünsche warten auf Ollama", () => {
  const stand: ModellStand = {
    modelle: [{ name: "qwen3.8:27b", manifest: "a", herausgeber: "b", dateien: 4, bytes: 1, ollama: "sha256:x", geprueft: 1 }],
    ergebnisse: [],
  };
  const kurz = (bs: ReturnType<typeof pruefeModelle>) => bs.map((b) => `${b.stufe} ${b.name} ${b.fall}`);
  assert.deepEqual(kurz(pruefeModelle({ angeboten: ["nemotron", "llama4"], stand, wuensche: [{ name: "gemma4:12b", seit: 1 }], ollama: [{ name: "nemotron", digest: "" }], antrieb: "openai" })), [
    "hinweis qwen3.8:27b modell.nurOllama", "hinweis nemotron modell.ungeprueftAntrieb", "fehler llama4 modell.fehltBeimAntrieb", "hinweis gemma4:12b modell.ladenNurOllama",
  ]);
  assert.deepEqual(kurz(pruefeModelle({ angeboten: ["llama4"], stand: { modelle: [], ergebnisse: [] }, wuensche: [], ollama: [], antrieb: "openai" })),
    ["fehler llama4 modell.antriebKenntKeins"]);
  assert.deepEqual(kurz(pruefeModelle({ angeboten: ["llama4"], stand: { modelle: [], ergebnisse: [] }, wuensche: [], ollama: null, antrieb: "openai" })),
    ["hinweis llama4 modell.antriebStumm"]);
  for (const f of ["modell.nurOllama", "modell.ungeprueftAntrieb", "modell.fehltBeimAntrieb", "modell.antriebKenntKeins", "modell.antriebStumm", "modell.ladenNurOllama"]) assert.ok(MODELL_TEXT[f], f);
});

test("B-29a: Verdrahtung – main wählt den Antrieb, startet sonst nicht, lädt geprüft nur mit Ollama; der Schlüssel nie ins Log", () => {
  const main = quelle("../src/main.ts");
  assert.match(main, /const antriebWahl = antriebAusUmgebung\(process\.env\);\n  if \(!antriebWahl\.antrieb\) \{\n    console\.error\(`\[ki\] \$\{antriebWahl\.grund\} – der Knoten startet nicht`\);\n    process\.exit\(1\);/);
  assert.match(main, /const backend = new OllamaBackend\(antrieb\.url, undefined, \{ antrieb: antrieb\.art, schluessel: antrieb\.schluessel \}\);/);
  assert.match(main, /tags: mitOllama \? \(\) => ollamaTags\(ollamaUrl\) : async \(\) => \[\],/, "geprüft im Angebot nur, was der Antrieb bedient");
  assert.match(main, /if \(mitOllama\) \{\n    void modellTakt\(\);/);
  for (const z of main.split("\n").filter((x) => /console\.(log|warn|error)/.test(x))) assert.doesNotMatch(z, /schluessel|KI_SCHLUESSEL/, z);
  const pruefen = quelle("../src/pruefen.ts");
  assert.match(pruefen, /const \{ antrieb, grund \} = antriebAusUmgebung\(process\.env\);/);
  assert.match(pruefen, /ollama: await antriebModelle\(antrieb\)\.catch\(\(\) => null\), antrieb: antrieb\.art,/);
});
