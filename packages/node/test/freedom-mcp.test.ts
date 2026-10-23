/**
 * Freedom-MCP (VKd): Werkzeuge des Knotens für den Motor in der Sandbox – nur über die Brücke (`POST /mcp`), als
 * Streamable HTTP mit JSON-Antworten, wie der MCP-Client von Hermes (mcp 1.26) es liest: ohne Sitzungskennung, also nie
 * GET oder DELETE; Benachrichtigungen 202. Ausgeführt wird nur über die `ToolRegistry`; Fehler der Werkzeuge stehen im
 * Ergebnis, nur mit dem Fehlernamen. Lesen nur, was Auftrag oder Suche nennen (VKd-W1, Regel von `web_fetch` bei Claude).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KIND_DVM_BROWSER, KIND_DVM_WEB_SEARCH } from "@freedomstack/protocol";
import { CodeLaeufe } from "../src/code-motor.js";
import { LESE_FREIGABEN_MAX, LeseFreigaben, MCP_FASSUNGEN, MCP_ZEICHEN, McpProjekte, adressenIn, mcpAntwort } from "../src/freedom-mcp.js";
import { ProjektAblage } from "../src/projekte.js";
import { STARTSKRIPT, hermesHeim, hermesKonfiguration, hermesMotor } from "../src/hermes-motor.js";
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

/** Ein Zeichen für die Brücke (VKd2b1) – im Test fest, im Knoten aus `McpProjekte`. */
const Z = "ab".repeat(32);
const nurZ = (frei: LeseFreigaben, w: Pick<ToolRegistryLike, "run">) => (z: string) => (z === Z ? (n: unknown) => mcpAntwort(n, w, frei) : undefined);
type ToolRegistryLike = { run: (c: ToolCall) => Promise<ToolResult> };

test("VKd: initialize, ping, tools/list – Fassung ausgehandelt, genau zwei Werkzeuge mit Grenze", async () => {
  const w = attrappe();
  const frei = new LeseFreigaben();
  const init = await mcpAntwort(anfrage(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hermes", version: "0" } }), w, frei) as { result: { protocolVersion: string; capabilities: object; serverInfo: { name: string } } };
  assert.equal(init.result.protocolVersion, "2025-03-26", "eine bekannte Fassung zurück");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  const neu = await mcpAntwort(anfrage(2, "initialize", { protocolVersion: "2099-01-01" }), w, frei) as { result: { protocolVersion: string } };
  assert.equal(neu.result.protocolVersion, MCP_FASSUNGEN.at(-1), "unbekannt: die neueste");
  assert.deepEqual(await mcpAntwort(anfrage("p", "ping"), w, frei), { jsonrpc: "2.0", id: "p", result: {} });
  const liste = await mcpAntwort(anfrage(3, "tools/list"), w, frei) as { result: { tools: Array<{ name: string; inputSchema: { required: string[]; properties: Record<string, { maxLength: number }>; additionalProperties: boolean } }> } };
  assert.deepEqual(liste.result.tools.map((t) => [t.name, t.inputSchema.required]), [["web_search", ["query"]], ["read_page", ["url"]]]);
  for (const t of liste.result.tools) {
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(Object.values(t.inputSchema.properties)[0]!.maxLength, WERKZEUG_GRENZEN.eingabeZeichen);
  }
  assert.equal(w.gesehen.length, 0, "nichts davon führt ein Werkzeug aus");
});

test("VKd: tools/call nur über die Registry – Fehler im Ergebnis mit Namen, nie mit Text von außen", async () => {
  const w = attrappe();
  const frei = new LeseFreigaben();
  const r = await mcpAntwort(anfrage(4, "tools/call", { name: "web_search", arguments: { query: "bubblewrap seccomp" } }), w, frei);
  assert.deepEqual(r, { jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "Treffer für bubblewrap seccomp" }], isError: false } });
  frei.ausAuftrag("Baue eine Seite wie https://example.org/ und lies http://10.0.0.1/");
  await mcpAntwort(anfrage(5, "tools/call", { name: "read_page", arguments: { url: "https://example.org/" } }), w, frei);
  assert.deepEqual(w.gesehen, [
    { kind: KIND_DVM_WEB_SEARCH, name: "web_search", input: "bubblewrap seccomp" },
    { kind: KIND_DVM_BROWSER, name: "read_page", input: "https://example.org/" },
  ]);
  // ein Werkzeug sagt nein: Ergebnis mit isError, wie es die Registry liefert
  const nein = attrappe(async () => ({ ok: false, output: "private Adresse" }));
  assert.deepEqual(await mcpAntwort(anfrage(6, "tools/call", { name: "read_page", arguments: { url: "http://10.0.0.1/" } }), nein, frei),
    { jsonrpc: "2.0", id: 6, result: { content: [{ type: "text", text: "private Adresse" }], isError: true } });
  // ein Werkzeug wirft: nur der Fehlername, nie die Meldung (sie kann die Suchanfrage tragen)
  const wirft = { run: async () => { throw Object.assign(new Error("ECONNRESET https://suche?q=geheim"), { name: "SuchFehler" }); } };
  const f = await mcpAntwort(anfrage(7, "tools/call", { name: "web_search", arguments: { query: "geheim" } }), wirft, frei) as { result: { content: Array<{ text: string }>; isError: boolean } };
  assert.deepEqual([f.result.content[0]!.text, f.result.isError], ["error: SuchFehler", true]);
});

test("VKd: unbekannt, unvollständig, Stapel und Benachrichtigungen – nichts ausgeführt", async () => {
  const w = attrappe();
  const frei = new LeseFreigaben();
  const code = async (n: unknown) => ((await mcpAntwort(n, w, frei)) as { error?: { code: number } } | null)?.error?.code ?? null;
  assert.equal(await code(anfrage(1, "tools/call", { name: "shell", arguments: { cmd: "ls" } })), -32602, "nur die eigenen Werkzeuge");
  assert.equal(await code(anfrage(2, "tools/call", { name: "web_search", arguments: {} })), -32602);
  assert.equal(await code(anfrage(3, "tools/call", { name: "web_search", arguments: { query: "  " } })), -32602);
  assert.equal(await code(anfrage(4, "tools/call", { name: "web_search", arguments: { query: 5 } })), -32602);
  assert.equal(await code(anfrage(5, "resources/list")), -32601);
  assert.equal(await code([anfrage(6, "ping")]), -32600, "keine Stapel seit 2025-06-18");
  assert.equal(await code({ id: 7, method: "ping" }), -32600, "ohne jsonrpc 2.0");
  assert.equal(await code(anfrage({ x: 1 }, "ping")), -32600, "Id nur Zahl oder Text");
  assert.equal(await code("ping"), -32600);
  assert.equal(await mcpAntwort({ jsonrpc: "2.0", method: "notifications/initialized" }, w, frei), null, "Benachrichtigung: keine Antwort");
  assert.equal(await mcpAntwort({ jsonrpc: "2.0", method: "tools/call", params: { name: "web_search", arguments: { query: "x" } } }, w, frei), null);
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

test("VKd: Brücke – POST /mcp/<zeichen> im Knoten, nie zum Antrieb; GET 405, kaputtes JSON 400, zu groß 413, ohne MCP nicht hier", async () => {
  const w = attrappe();
  const frei = new LeseFreigaben();
  let zumAntrieb = 0;
  const fetchImpl = (async () => (zumAntrieb++, new Response("{}"))) as typeof fetch;
  const bruecke = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { fetchImpl, mcp: nurZ(frei, w) });
  try {
    const liste = await ueberSockel(bruecke.sockel, "POST", `/mcp/${Z}`, JSON.stringify(anfrage(1, "tools/list")));
    assert.equal(liste.status, 200);
    assert.match(String(liste.kopf["content-type"]), /^application\/json/);
    assert.equal(JSON.parse(liste.text).result.tools.length, 2);
    const ruf = await ueberSockel(bruecke.sockel, "POST", `/mcp/${Z}`, JSON.stringify(anfrage(2, "tools/call", { name: "web_search", arguments: { query: "x" } })));
    assert.equal(JSON.parse(ruf.text).result.content[0].text, "Treffer für x");
    const note = await ueberSockel(bruecke.sockel, "POST", `/mcp/${Z}`, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    assert.deepEqual([note.status, note.text], [202, ""]);
    const get = await ueberSockel(bruecke.sockel, "GET", `/mcp/${Z}`);
    assert.deepEqual([get.status, get.kopf.allow], [405, "POST"]);
    assert.equal((await ueberSockel(bruecke.sockel, "DELETE", `/mcp/${Z}`)).status, 405);
    assert.deepEqual(await ueberSockel(bruecke.sockel, "POST", `/mcp/${Z}`, "{kein json").then((r) => [r.status, r.text]), [400, "kein JSON"]);
    assert.equal((await ueberSockel(bruecke.sockel, "POST", `/mcp/${Z}`, Buffer.alloc(BRUECKE_GRENZEN.mcpBytes + 1, 0x20))).status, 413);
    assert.equal((await ueberSockel(bruecke.sockel, "POST", `/mcp/${Z}/../../v1/models`, "{}")).status, 404, "nur genau /mcp/<zeichen>");
    // ohne Zeichen, mit fremdem oder falsch geschriebenem: nicht hier – nichts gelesen, nichts ausgeführt
    for (const pfad of ["/mcp", "/mcp/", `/mcp/${"cd".repeat(32)}`, `/mcp/${Z.toUpperCase()}`, `/mcp/${Z}0`, `/mcp/${Z}?x=1`]) {
      assert.equal((await ueberSockel(bruecke.sockel, "POST", pfad, JSON.stringify(anfrage(9, "tools/list")))).status, 404, pfad);
    }
    // die Form prüft die Brücke selbst, bevor sie nachschlägt – auch wenn das Nachschlagen alles nähme
    const gefragt: string[] = [];
    const offen = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { fetchImpl, mcp: (z) => (gefragt.push(z), (n) => mcpAntwort(n, w, frei)) });
    try {
      for (const pfad of ["/mcp", "/mcp/", `/mcp/${Z.toUpperCase()}`, `/mcp/${Z}0`, `/mcp/${Z}/x`, `/mcp/${Z}?x=1`]) {
        assert.equal((await ueberSockel(offen.sockel, "POST", pfad, JSON.stringify(anfrage(9, "tools/list")))).status, 404, pfad);
      }
      assert.deepEqual(gefragt, []);
      assert.equal((await ueberSockel(offen.sockel, "POST", `/mcp/${Z}`, JSON.stringify(anfrage(9, "tools/list")))).status, 200);
      assert.deepEqual(gefragt, [Z]);
    } finally {
      offen.schliesse();
    }
    assert.equal(zumAntrieb, 0, "nichts davon erreicht den Antrieb");
    assert.equal(w.gesehen.length, 1);
  } finally {
    bruecke.schliesse();
  }
  const ohneMcp = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { fetchImpl });
  try {
    assert.equal((await ueberSockel(ohneMcp.sockel, "POST", `/mcp/${Z}`, JSON.stringify(anfrage(1, "tools/list")))).status, 404);
  } finally {
    ohneMcp.schliesse();
  }
});

test("VKd: Hermes findet Freedom-MCP über die Konfiguration – dieselbe Brücke, kein anderer Server", () => {
  const k = JSON.parse(hermesKonfiguration("coder:7b", [], Z));
  assert.deepEqual(k.mcp_servers, { freedom: { url: `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/mcp/${Z}` } });
  // ohne Zeichen kein Freedom-MCP (VKd2b1), nie eines in anderer Form
  assert.deepEqual(JSON.parse(hermesKonfiguration("coder:7b")).mcp_servers, {});
  for (const falsch of ["", "ab", Z.toUpperCase(), `${Z}/../x`, `${Z}0`]) assert.throws(() => hermesKonfiguration("coder:7b", [], falsch), falsch);
  // verdrahtet: main.ts gibt der Brücke Freedom-MCP mit den Werkzeugen des Knotens, je Projekt unter seinem Zeichen
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  // seit VKd3 dazu der Spiegel für Pakete an derselben Brücke
  assert.match(main, /oeffneModellBruecke\(antrieb, \{\s*mcp: \(zeichen\) => \{\s*const freigaben = mcpProjekte\.zu\(zeichen\);\s*return freigaben && \(\(n\) => mcpAntwort\(n, werkzeuge, freigaben\)\);\s*\},\s*spiegel: \(req, res\) => beantworteSpiegel\(req, res, \{/);
  assert.match(main, /beimAuftrag: \(t, p\) => mcpProjekte\.freigaben\(p\)\.ausAuftrag\(t\)/);
  assert.match(main, /mcpZeichen: \(p\) => mcpProjekte\.zeichen\(p\)/);
  assert.match(main, /werkzeuge\.register\(new WebSearchExecutor\(\)\);\n\s+werkzeuge\.register\(new BrowserExecutor\(\)\);/);
});

test("VKd (bubblewrap): aus der Sandbox über das Startskript an Freedom-MCP – ohne Netz", { skip: ohne }, async () => {
  const w = attrappe();
  const frei = new LeseFreigaben();
  const bruecke = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { mcp: nurZ(frei, w) });
  try {
    const nachricht = JSON.stringify(anfrage(1, "tools/call", { name: "web_search", arguments: { query: "aus der sandbox" } }));
    const holen = `import urllib.request; r = urllib.request.Request("http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/mcp/${Z}", data=${JSON.stringify(nachricht)}.encode(), headers={"content-type": "application/json"}); print(urllib.request.urlopen(r, timeout=10).read().decode())`;
    const nurLesbar = [{ quelle: STARTSKRIPT, ziel: "/freedom/motor.py" }, { quelle: bruecke.ordner, ziel: BRUECKE_IN_SANDBOX.ordner }];
    const r = await fuehreAus(["python3", "/freedom/motor.py", BRUECKE_IN_SANDBOX.sockel, String(BRUECKE_IN_SANDBOX.port), "--", "python3", "-c", holen], { arbeit: mkdtempSync(join(tmpdir(), "vkd-")), nurLesbar });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.ausgabe).result.content[0].text, "Treffer für aus der sandbox");
    assert.deepEqual(w.gesehen.map((c) => c.input), ["aus der sandbox"]);
  } finally {
    bruecke.schliesse();
  }
});

test("VKd-W1: Adressen im Text – mit Klammern darin, ohne Satzzeichen und Anker am Ende, nur http und https", () => {
  assert.deepEqual(adressenIn("Lies https://de.wikipedia.org/wiki/Python_(Programmiersprache). Und (siehe https://example.org/a?b=1#oben)."), [
    "https://de.wikipedia.org/wiki/Python_(Programmiersprache)", "https://example.org/a?b=1",
  ]);
  assert.deepEqual(adressenIn("ftp://x.org/ und javascript:alert(1) und mailto:a@b.c"), []);
  assert.deepEqual(adressenIn("Python: Sprache (https://en.wikipedia.org/wiki/Python_(programming_language))"), ["https://en.wikipedia.org/wiki/Python_(programming_language)"]);
});

test("VKd-W1: read_page nur für Adressen aus dem Auftrag oder der Suche – nie selbst gebaut, nie aus gelesenen Seiten", async () => {
  const w = attrappe(async (c) => ({ ok: true, output: c.name === "web_search" ? "Bubblewrap: Sandbox (https://github.com/containers/bubblewrap)" : "Seite mit Link https://boese.example/?daten=" }));
  const frei = new LeseFreigaben();
  const lies = async (url: string) => (await mcpAntwort(anfrage(1, "tools/call", { name: "read_page", arguments: { url } }), w, frei)) as { result: { content: Array<{ text: string }>; isError: boolean } };
  // selbst gebaut, etwa mit Inhalt des Projekts in der Anfrage: nicht gelesen, der Motor erfährt warum
  const nein = await lies("https://angreifer.example/?code=geheim");
  assert.deepEqual([nein.result.isError, nein.result.content[0]!.text], [true, "not allowed: read_page only reads URLs from the task or from web_search results"]);
  assert.equal(w.gesehen.length, 0, "nichts geladen");
  // aus dem Auftrag des Besitzers: gelesen – genau diese Adresse, nicht eine mit anderer Anfrage
  frei.ausAuftrag("Baue eine Startseite im Stil von https://example.org/vorlage");
  assert.equal((await lies("https://example.org/vorlage")).result.isError, false);
  assert.equal((await lies("https://example.org/vorlage#teil")).result.isError, false, "der Anker geht nicht hinaus");
  assert.equal((await lies("https://example.org/vorlage?daten=geheim")).result.isError, true);
  // aus einem Ergebnis der Suche: gelesen
  await mcpAntwort(anfrage(2, "tools/call", { name: "web_search", arguments: { query: "bubblewrap" } }), w, frei);
  assert.equal((await lies("https://github.com/containers/bubblewrap")).result.isError, false);
  // ein Link aus einer gelesenen Seite gibt nichts frei (Claude seit Juli 2026)
  assert.equal((await lies("https://boese.example/?daten=")).result.isError, true);
  assert.deepEqual(w.gesehen.map((c) => c.input), ["https://example.org/vorlage", "https://example.org/vorlage#teil", "bubblewrap", "https://github.com/containers/bubblewrap"]);
  // begrenzt: die ältesten fallen heraus
  for (let i = 0; i < LESE_FREIGABEN_MAX; i++) frei.ausSuche(`https://seite${i}.example/`);
  assert.equal(frei.darf("https://example.org/vorlage"), false);
  assert.equal(frei.darf(`https://seite${LESE_FREIGABEN_MAX - 1}.example/`), true);
});

test("VKd-W1: CodeLaeufe gibt den Text jedes Auftrags vor dem Start an die Freigaben", async () => {
  const ablage = new ProjektAblage(join(mkdtempSync(join(tmpdir(), "vkd-w1-")), "projekte"));
  const gesehen: string[][] = [];
  const l = new CodeLaeufe({ ablage, beimAuftrag: (t, p) => gesehen.push([t, p]), motor: () => { throw new Error("kein Motor"); } });
  await l.starte("a".repeat(64), { projekt: "app", text: "Wie https://example.org/ bitte", modus: "fragen" }, () => {});
  await l.starte("b".repeat(64), { projekt: "spiel", text: "Und https://example.org/b", modus: "fragen" }, () => {});
  assert.deepEqual(gesehen, [["Wie https://example.org/ bitte", "app"], ["Und https://example.org/b", "spiel"]], "mit dem Projekt (VKd2b1)");
});

test("VKd2b1: Freedom-MCP je Projekt – eigenes Zeichen, Lese-Freigaben nur im Projekt des Auftrags", async () => {
  const projekte = new McpProjekte();
  const a = projekte.zeichen("app");
  const b = projekte.zeichen("spiel");
  assert.match(a, MCP_ZEICHEN);
  assert.match(b, MCP_ZEICHEN);
  assert.notEqual(a, b);
  assert.equal(projekte.zeichen("app"), a, "je Projekt dasselbe, solange der Knoten läuft");
  assert.notEqual(new McpProjekte().zeichen("app"), a, "nach einem Neustart ein neues");
  assert.equal(projekte.zu(a), projekte.freigaben("app"));
  for (const falsch of ["cd".repeat(32), a.toUpperCase(), `${a}0`, a.slice(1), ""]) assert.equal(projekte.zu(falsch), undefined, falsch);
  // eine Adresse aus dem Auftrag von „app“ liest nur „app“ – „spiel“ nicht, auch nicht über die Brücke
  const w = attrappe();
  projekte.freigaben("app").ausAuftrag("Baue es wie https://example.org/vorlage");
  const bruecke = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, {
    mcp: (z) => { const f = projekte.zu(z); return f && ((n) => mcpAntwort(n, w, f)); },
  });
  try {
    const lies = async (z: string) => JSON.parse((await ueberSockel(bruecke.sockel, "POST", `/mcp/${z}`, JSON.stringify(anfrage(1, "tools/call", { name: "read_page", arguments: { url: "https://example.org/vorlage" } })))).text).result.isError;
    assert.equal(await lies(b), true, "nicht im anderen Projekt");
    assert.equal(await lies(a), false, "im eigenen Projekt");
    assert.deepEqual(w.gesehen.map((c) => c.input), ["https://example.org/vorlage"]);
  } finally {
    bruecke.schliesse();
  }
});

test("VKd2b1: der Motor schreibt das Zeichen seines Projekts in config.yaml – nie das eines anderen", async () => {
  const d = mkdtempSync(join(tmpdir(), "vkd2b1-"));
  try {
    // statt bubblewrap ein Skript, das nichts tut
    const bwrap = join(d, "bwrap");
    writeFileSync(bwrap, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const ablage = new ProjektAblage(join(d, "projekte"));
    for (const p of ["app", "spiel"]) mkdirSync(ablage.ort(p), { recursive: true });
    const projekte = new McpProjekte();
    const gefragt: string[] = [];
    const start = hermesMotor({
      hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: join(d, "b") }, modell: () => "coder:7b", bwrap,
      mcpZeichen: (p) => (gefragt.push(p), projekte.zeichen(p)),
    });
    for (const p of ["app", "spiel"]) start(ablage.ort(p)).beende();
    const url = (p: string) => (JSON.parse(readFileSync(join(hermesHeim(ablage, ablage.ort(p)), ".hermes", "config.yaml"), "utf8")) as { mcp_servers: { freedom: { url: string } } }).mcp_servers.freedom.url;
    assert.deepEqual(gefragt, ["app", "spiel"], "mit dem Namen des Projekts");
    assert.equal(url("app"), `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/mcp/${projekte.zeichen("app")}`);
    assert.equal(url("spiel"), `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/mcp/${projekte.zeichen("spiel")}`);
    assert.ok(!readFileSync(join(hermesHeim(ablage, ablage.ort("spiel")), ".hermes", "config.yaml"), "utf8").includes(projekte.zeichen("app")));
    assert.ok(existsSync(join(d, "bwrap")));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
