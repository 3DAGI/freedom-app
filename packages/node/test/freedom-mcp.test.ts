/**
 * Freedom-MCP (VKd): Werkzeuge des Knotens für den Motor in der Sandbox – nur über die Brücke (`POST /mcp`), als
 * Streamable HTTP mit JSON-Antworten, wie der MCP-Client von Hermes (mcp 1.26) es liest: ohne Sitzungskennung, also nie
 * GET oder DELETE; Benachrichtigungen 202. Ausgeführt wird nur über die `ToolRegistry`; Fehler der Werkzeuge stehen im
 * Ergebnis, nur mit dem Fehlernamen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KIND_DVM_BROWSER, KIND_DVM_WEB_SEARCH } from "@freedomstack/protocol";
import { MCP_FASSUNGEN, mcpAntwort } from "../src/freedom-mcp.js";
import { STARTSKRIPT, hermesKonfiguration } from "../src/hermes-motor.js";
import { BRUECKE_GRENZEN, BRUECKE_IN_SANDBOX, oeffneModellBruecke } from "../src/modell-bruecke.js";
import { fuehreAus, pruefeSandbox } from "../src/sandbox.js";
import { WERKZEUG_GRENZEN, type ToolCall, type ToolResult } from "../src/tools.js";

const pruefung = await pruefeSandbox();
const ohne = !pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`;

/** Werkzeuge, die jeden Aufruf merken und eine feste Antwort geben. */
function attrappe(antwort: (c: ToolCall) => Promise<{ ok: boolean; output: string }> = async (c) => ({ ok: true, output: `Treffer für ${c.input}` })) {
  const gesehen: ToolCall[] = [];
  return { gesehen, run: async (c: ToolCall): Promise<ToolResult> => (gesehen.push(c), { name: c.name, durationMs: 0, ...(await antwort(c)) }) };
}

const anfrage = (id: unknown, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

test("VKd: initialize, ping, tools/list – Fassung ausgehandelt, genau zwei Werkzeuge mit Grenze", async () => {
  const w = attrappe();
  const init = await mcpAntwort(anfrage(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hermes", version: "0" } }), w) as { result: { protocolVersion: string; capabilities: object; serverInfo: { name: string } } };
  assert.equal(init.result.protocolVersion, "2025-03-26", "eine bekannte Fassung zurück");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  const neu = await mcpAntwort(anfrage(2, "initialize", { protocolVersion: "2099-01-01" }), w) as { result: { protocolVersion: string } };
  assert.equal(neu.result.protocolVersion, MCP_FASSUNGEN.at(-1), "unbekannt: die neueste");
  assert.deepEqual(await mcpAntwort(anfrage("p", "ping"), w), { jsonrpc: "2.0", id: "p", result: {} });
  const liste = await mcpAntwort(anfrage(3, "tools/list"), w) as { result: { tools: Array<{ name: string; inputSchema: { required: string[]; properties: Record<string, { maxLength: number }>; additionalProperties: boolean } }> } };
  assert.deepEqual(liste.result.tools.map((t) => [t.name, t.inputSchema.required]), [["web_search", ["query"]], ["read_page", ["url"]]]);
  for (const t of liste.result.tools) {
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(Object.values(t.inputSchema.properties)[0]!.maxLength, WERKZEUG_GRENZEN.eingabeZeichen);
  }
  assert.equal(w.gesehen.length, 0, "nichts davon führt ein Werkzeug aus");
});

test("VKd: tools/call nur über die Registry – Fehler im Ergebnis mit Namen, nie mit Text von außen", async () => {
  const w = attrappe();
  const r = await mcpAntwort(anfrage(4, "tools/call", { name: "web_search", arguments: { query: "bubblewrap seccomp" } }), w);
  assert.deepEqual(r, { jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "Treffer für bubblewrap seccomp" }], isError: false } });
  await mcpAntwort(anfrage(5, "tools/call", { name: "read_page", arguments: { url: "https://example.org/" } }), w);
  assert.deepEqual(w.gesehen, [
    { kind: KIND_DVM_WEB_SEARCH, name: "web_search", input: "bubblewrap seccomp" },
    { kind: KIND_DVM_BROWSER, name: "read_page", input: "https://example.org/" },
  ]);
  // ein Werkzeug sagt nein: Ergebnis mit isError, wie es die Registry liefert
  const nein = attrappe(async () => ({ ok: false, output: "private Adresse" }));
  assert.deepEqual(await mcpAntwort(anfrage(6, "tools/call", { name: "read_page", arguments: { url: "http://10.0.0.1/" } }), nein),
    { jsonrpc: "2.0", id: 6, result: { content: [{ type: "text", text: "private Adresse" }], isError: true } });
  // ein Werkzeug wirft: nur der Fehlername, nie die Meldung (sie kann die Suchanfrage tragen)
  const wirft = { run: async () => { throw Object.assign(new Error("ECONNRESET https://suche?q=geheim"), { name: "SuchFehler" }); } };
  const f = await mcpAntwort(anfrage(7, "tools/call", { name: "web_search", arguments: { query: "geheim" } }), wirft) as { result: { content: Array<{ text: string }>; isError: boolean } };
  assert.deepEqual([f.result.content[0]!.text, f.result.isError], ["error: SuchFehler", true]);
});

test("VKd: unbekannt, unvollständig, Stapel und Benachrichtigungen – nichts ausgeführt", async () => {
  const w = attrappe();
  const code = async (n: unknown) => ((await mcpAntwort(n, w)) as { error?: { code: number } } | null)?.error?.code ?? null;
  assert.equal(await code(anfrage(1, "tools/call", { name: "shell", arguments: { cmd: "ls" } })), -32602, "nur die eigenen Werkzeuge");
  assert.equal(await code(anfrage(2, "tools/call", { name: "web_search", arguments: {} })), -32602);
  assert.equal(await code(anfrage(3, "tools/call", { name: "web_search", arguments: { query: "  " } })), -32602);
  assert.equal(await code(anfrage(4, "tools/call", { name: "web_search", arguments: { query: 5 } })), -32602);
  assert.equal(await code(anfrage(5, "resources/list")), -32601);
  assert.equal(await code([anfrage(6, "ping")]), -32600, "keine Stapel seit 2025-06-18");
  assert.equal(await code({ id: 7, method: "ping" }), -32600, "ohne jsonrpc 2.0");
  assert.equal(await code(anfrage({ x: 1 }, "ping")), -32600, "Id nur Zahl oder Text");
  assert.equal(await code("ping"), -32600);
  assert.equal(await mcpAntwort({ jsonrpc: "2.0", method: "notifications/initialized" }, w), null, "Benachrichtigung: keine Antwort");
  assert.equal(await mcpAntwort({ jsonrpc: "2.0", method: "tools/call", params: { name: "web_search", arguments: { query: "x" } } }, w), null);
  assert.equal(w.gesehen.length, 0);
});

/** Anfrage über den Socket der Brücke. */
function ueberSockel(sockel: string, methode: string, pfad: string, koerper?: string | Buffer) {
  return new Promise<{ status: number; text: string; kopf: Record<string, string | string[] | undefined> }>((fertig, scheitern) => {
    const r = request({ socketPath: sockel, method: methode, path: pfad, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" } }, (res) => {
      let text = "";
      res.on("data", (b) => (text += b));
      res.on("end", () => fertig({ status: res.statusCode!, text, kopf: res.headers }));
    });
    r.on("error", scheitern);
    r.end(koerper);
  });
}

test("VKd: Brücke – POST /mcp im Knoten, nie zum Antrieb; GET 405, kaputtes JSON 400, zu groß 413, ohne MCP nicht hier", async () => {
  const w = attrappe();
  let zumAntrieb = 0;
  const fetchImpl = (async () => (zumAntrieb++, new Response("{}"))) as typeof fetch;
  const bruecke = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { fetchImpl, mcp: (n) => mcpAntwort(n, w) });
  try {
    const liste = await ueberSockel(bruecke.sockel, "POST", "/mcp", JSON.stringify(anfrage(1, "tools/list")));
    assert.equal(liste.status, 200);
    assert.match(String(liste.kopf["content-type"]), /^application\/json/);
    assert.equal(JSON.parse(liste.text).result.tools.length, 2);
    const ruf = await ueberSockel(bruecke.sockel, "POST", "/mcp", JSON.stringify(anfrage(2, "tools/call", { name: "web_search", arguments: { query: "x" } })));
    assert.equal(JSON.parse(ruf.text).result.content[0].text, "Treffer für x");
    const note = await ueberSockel(bruecke.sockel, "POST", "/mcp", JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    assert.deepEqual([note.status, note.text], [202, ""]);
    const get = await ueberSockel(bruecke.sockel, "GET", "/mcp");
    assert.deepEqual([get.status, get.kopf.allow], [405, "POST"]);
    assert.equal((await ueberSockel(bruecke.sockel, "DELETE", "/mcp")).status, 405);
    assert.deepEqual(await ueberSockel(bruecke.sockel, "POST", "/mcp", "{kein json").then((r) => [r.status, r.text]), [400, "kein JSON"]);
    assert.equal((await ueberSockel(bruecke.sockel, "POST", "/mcp", Buffer.alloc(BRUECKE_GRENZEN.mcpBytes + 1, 0x20))).status, 413);
    assert.equal((await ueberSockel(bruecke.sockel, "POST", "/mcp/../v1/models", "{}")).status, 404, "nur genau /mcp");
    assert.equal(zumAntrieb, 0, "nichts davon erreicht den Antrieb");
    assert.equal(w.gesehen.length, 1);
  } finally {
    bruecke.schliesse();
  }
  const ohneMcp = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { fetchImpl });
  try {
    assert.equal((await ueberSockel(ohneMcp.sockel, "POST", "/mcp", JSON.stringify(anfrage(1, "tools/list")))).status, 404);
  } finally {
    ohneMcp.schliesse();
  }
});

test("VKd: Hermes findet Freedom-MCP über die Konfiguration – dieselbe Brücke, kein anderer Server", () => {
  const k = JSON.parse(hermesKonfiguration("coder:7b"));
  assert.deepEqual(k.mcp_servers, { freedom: { url: `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/mcp` } });
  // verdrahtet: main.ts gibt der Brücke Freedom-MCP mit den Werkzeugen des Knotens
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /oeffneModellBruecke\(antrieb, \{ mcp: \(n\) => mcpAntwort\(n, werkzeuge\) \}\)/);
  assert.match(main, /werkzeuge\.register\(new WebSearchExecutor\(\)\);\n\s+werkzeuge\.register\(new BrowserExecutor\(\)\);/);
});

test("VKd (bubblewrap): aus der Sandbox über das Startskript an Freedom-MCP – ohne Netz", { skip: ohne }, async () => {
  const w = attrappe();
  const bruecke = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { mcp: (n) => mcpAntwort(n, w) });
  try {
    const nachricht = JSON.stringify(anfrage(1, "tools/call", { name: "web_search", arguments: { query: "aus der sandbox" } }));
    const holen = `import urllib.request; r = urllib.request.Request("http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/mcp", data=${JSON.stringify(nachricht)}.encode(), headers={"content-type": "application/json"}); print(urllib.request.urlopen(r, timeout=10).read().decode())`;
    const nurLesbar = [{ quelle: STARTSKRIPT, ziel: "/freedom/motor.py" }, { quelle: bruecke.ordner, ziel: BRUECKE_IN_SANDBOX.ordner }];
    const r = await fuehreAus(["python3", "/freedom/motor.py", BRUECKE_IN_SANDBOX.sockel, String(BRUECKE_IN_SANDBOX.port), "--", "python3", "-c", holen], { arbeit: mkdtempSync(join(tmpdir(), "vkd-")), nurLesbar });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.ausgabe).result.content[0].text, "Treffer für aus der sandbox");
    assert.deepEqual(w.gesehen.map((c) => c.input), ["aus der sandbox"]);
  } finally {
    bruecke.schliesse();
  }
});
