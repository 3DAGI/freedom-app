/**
 * VKd2b2: Bilder für den Motor – `generate_image` über die eigene ComfyUI (nur dieser Rechner oder das Heimnetz), das PNG
 * in einem Ordner je Projekt, nur lesbar in dessen Sandbox. ComfyUI ist hier eine Attrappe mit derselben API
 * (`/system_stats`, `/prompt`, `/history/<id>`, `/view`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BILDER_GRENZEN, BILDER_IN_SANDBOX, bilderAusUmgebung, bilderOrdner, erzeugeBild } from "../src/bilder-motor.js";
import { mcpAntwort, LeseFreigaben } from "../src/freedom-mcp.js";
import { hermesMotor } from "../src/hermes-motor.js";
import { ProjektAblage } from "../src/projekte.js";
import type { ToolCall, ToolResult } from "../src/tools.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Eine ComfyUI zum Anfassen: merkt die Prompts, liefert `bild` unter `/view`. */
async function comfyAttrappe(bild: Buffer) {
  const prompts: string[] = [];
  const koerper = (q: IncomingMessage) => new Promise<string>((f) => { let s = ""; q.on("data", (c: Buffer) => (s += c)); q.on("end", () => f(s)); });
  const server = createServer(async (q, a) => {
    const url = new URL(q.url ?? "/", "http://x");
    if (url.pathname === "/system_stats") return void a.end("{}");
    if (url.pathname === "/prompt" && q.method === "POST") {
      const wf = JSON.parse(await koerper(q)) as { prompt: Record<string, { class_type: string; inputs: { text?: string } }> };
      prompts.push(wf.prompt["6"]!.inputs.text!);
      return void a.end(JSON.stringify({ prompt_id: "p1" }));
    }
    if (url.pathname === "/history/p1") return void a.end(JSON.stringify({ p1: { status: { completed: true }, outputs: { "9": { images: [{ filename: "freedom_00001_.png", subfolder: "", type: "output" }] } } } }));
    if (url.pathname === "/view" && url.searchParams.get("filename") === "freedom_00001_.png") {
      a.writeHead(200, { "content-type": "image/png" }); // ohne Länge: gestückelt, die Grenze gilt beim Lesen
      return void a.end(bild);
    }
    a.writeHead(404).end();
  });
  await new Promise<void>((f) => server.listen(0, "127.0.0.1", f));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, prompts, schliesse: () => server.close() };
}

test("VKd2b2: aus der Umgebung – ohne COMFYUI_URL keine Bilder, nur dieser Rechner oder das Heimnetz, Checkpoint geprüft", () => {
  assert.deepEqual(bilderAusUmgebung({}), {});
  assert.deepEqual(bilderAusUmgebung({ COMFYUI_URL: " " }), {});
  assert.deepEqual(bilderAusUmgebung({ COMFYUI_URL: "http://127.0.0.1:8188/" }), { dienst: { url: "http://127.0.0.1:8188" } });
  assert.deepEqual(bilderAusUmgebung({ COMFYUI_URL: "http://comfyui:8188", COMFYUI_CHECKPOINT: "sdxl/juggernaut.safetensors" }), { dienst: { url: "http://comfyui:8188", checkpoint: "sdxl/juggernaut.safetensors" } });
  for (const falsch of ["https://comfy.example.com", "http://user:pw@127.0.0.1:8188", "ftp://127.0.0.1", "http://8.8.8.8:8188", "kaputt"]) {
    assert.ok("ungueltig" in bilderAusUmgebung({ COMFYUI_URL: falsch }), falsch);
  }
  for (const falsch of ["../../etc/passwd", "a/../b.safetensors", "x\ny", "/abs.safetensors", "a".repeat(201)]) {
    assert.ok("ungueltig" in bilderAusUmgebung({ COMFYUI_URL: "http://127.0.0.1:8188", COMFYUI_CHECKPOINT: falsch }), falsch);
  }
  const ablage = new ProjektAblage("/home/n/.freedom/projekte");
  assert.equal(bilderOrdner(ablage, "app"), "/home/n/.freedom/bilder/app", "neben den Projekten, nie darin");
});

test("VKd2b2: ein Bild – Prompt an die eigene ComfyUI, PNG unter neuem Namen im Ordner des Projekts; Kaputtes nie", { timeout: 60_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "vkd2b2-"));
  const gut = await comfyAttrappe(PNG);
  const keinPng = await comfyAttrappe(Buffer.from("<html>nein</html>"));
  const zuGross = await comfyAttrappe(Buffer.concat([PNG, Buffer.alloc(BILDER_GRENZEN.bytes + 1 - PNG.length)]));
  try {
    const ordner = join(d, "bilder", "app");
    const r = await erzeugeBild({ url: gut.url }, ordner, "ein Logo mit einem Fuchs");
    assert.equal(r.ok, true, r.output);
    assert.deepEqual(gut.prompts, ["ein Logo mit einem Fuchs"]);
    const namen = readdirSync(ordner);
    assert.equal(namen.length, 1);
    assert.match(namen[0]!, /^bild-[0-9a-f]{12}\.png$/);
    assert.deepEqual(readFileSync(join(ordner, namen[0]!)), PNG);
    assert.equal(statSync(ordner).mode & 0o777, 0o700);
    assert.equal(statSync(join(ordner, namen[0]!)).mode & 0o777, 0o600);
    assert.match(r.output, new RegExp(`^Image saved: ${BILDER_IN_SANDBOX}/${namen[0]!.replace(".", "\\.")} `), "der Pfad, wie die Sandbox ihn sieht");
    // kein PNG, zu groß, ComfyUI fort, Prompt zu lang: nichts gespeichert, fester Text
    for (const [fall, url, prompt] of [["kein PNG", keinPng.url, "x"], ["zu groß", zuGross.url, "x"], ["fort", "http://127.0.0.1:9", "x"], ["zu lang", gut.url, "x".repeat(2001)]] as const) {
      const f = await erzeugeBild({ url }, join(d, "bilder", "spiel"), prompt);
      assert.equal(f.ok, false, fall);
      assert.match(f.output, /^(image generation (failed|not reachable \(ComfyUI\))|prompt: at most 2000 characters)$/, fall);
      assert.equal(existsSync(join(d, "bilder", "spiel")) ? readdirSync(join(d, "bilder", "spiel")).length : 0, 0, fall);
    }
  } finally {
    gut.schliesse();
    keinPng.schliesse();
    zuGross.schliesse();
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKd2b2: höchstens 50 Bilder je Projekt – die ältesten fallen heraus, fremde Dateien bleiben", { timeout: 60_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "vkd2b2-"));
  const c = await comfyAttrappe(PNG);
  try {
    const ordner = join(d, "app");
    mkdirSync(ordner, { recursive: true });
    for (let i = 0; i < BILDER_GRENZEN.jeProjekt; i++) {
      const n = join(ordner, `bild-${i.toString(16).padStart(12, "0")}.png`);
      writeFileSync(n, PNG);
      utimesSync(n, 1_000 + i, 1_000 + i);
    }
    writeFileSync(join(ordner, "notiz.txt"), "bleibt");
    assert.equal((await erzeugeBild({ url: c.url }, ordner, "noch eins")).ok, true);
    const da = readdirSync(ordner);
    assert.equal(da.filter((n) => n.endsWith(".png")).length, BILDER_GRENZEN.jeProjekt);
    assert.ok(!da.includes("bild-000000000000.png"), "das älteste ist weg");
    assert.ok(da.includes("bild-000000000001.png"));
    assert.ok(da.includes("notiz.txt"));
  } finally {
    c.schliesse();
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKd2b2: Freedom-MCP nennt generate_image nur mit Bildern – der Prompt geht an das Projekt, nie an die ToolRegistry", async () => {
  const gesehen: ToolCall[] = [];
  const w = { run: async (c: ToolCall): Promise<ToolResult> => (gesehen.push(c), { name: c.name, output: "x", ok: true, durationMs: 0 }) };
  const frei = new LeseFreigaben();
  const gefragt: string[] = [];
  const bild = async (p: string) => (gefragt.push(p), { ok: true, output: `Image saved: ${BILDER_IN_SANDBOX}/bild-000000000001.png` });
  const anfrage = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
  const namen = async (b?: typeof bild) => ((await mcpAntwort(anfrage(1, "tools/list"), w, frei, b)) as { result: { tools: Array<{ name: string; inputSchema: { required: string[] } }> } }).result.tools;
  assert.deepEqual((await namen()).map((t) => t.name), ["web_search", "read_page"]);
  const mit = await namen(bild);
  assert.deepEqual(mit.map((t) => t.name), ["web_search", "read_page", "generate_image"]);
  assert.deepEqual(mit[2]!.inputSchema.required, ["prompt"]);
  const ruf = (await mcpAntwort(anfrage(2, "tools/call", { name: "generate_image", arguments: { prompt: "ein Fuchs" } }), w, frei, bild)) as { result: { content: Array<{ text: string }>; isError: boolean } };
  assert.deepEqual([ruf.result.isError, ruf.result.content[0]!.text], [false, `Image saved: ${BILDER_IN_SANDBOX}/bild-000000000001.png`]);
  assert.deepEqual(gefragt, ["ein Fuchs"]);
  for (const args of [{}, { prompt: "  " }, { prompt: 7 }]) {
    assert.equal(((await mcpAntwort(anfrage(3, "tools/call", { name: "generate_image", arguments: args }), w, frei, bild)) as { error: { code: number } }).error.code, -32602, JSON.stringify(args));
  }
  assert.deepEqual(gefragt, ["ein Fuchs"], "ohne Prompt nichts gefragt");
  assert.equal(((await mcpAntwort(anfrage(4, "tools/call", { name: "generate_image", arguments: { prompt: "x" } }), w, frei)) as { error: { message: string } }).error.message, "unknown tool", "ohne Bilder gibt es das Werkzeug nicht");
  assert.deepEqual(gesehen, [], "nichts davon über die ToolRegistry");
});

test("VKd2b2: der Motor bindet nur den Bilder-Ordner seines Projekts ein – nur lesbar, angelegt vor dem Start", async () => {
  const d = mkdtempSync(join(tmpdir(), "vkd2b2-"));
  try {
    const protokoll = join(d, "argumente");
    const bwrap = join(d, "bwrap");
    writeFileSync(bwrap, `#!/bin/sh\nprintf '%s\\n' "$@" >> ${protokoll}\necho --- >> ${protokoll}\n`, { mode: 0o755 });
    const ablage = new ProjektAblage(join(d, "projekte"));
    for (const p of ["app", "spiel"]) mkdirSync(ablage.ort(p), { recursive: true });
    const start = hermesMotor({ hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: join(d, "b") }, modell: () => "coder:7b", bwrap, bilder: (p) => bilderOrdner(ablage, p) });
    // nacheinander: erst beenden, wenn die Attrappe aufgeschrieben hat
    for (const [i, p] of ["app", "spiel"].entries()) {
      const m = start(ablage.ort(p));
      for (let k = 0; k < 250 && (!existsSync(protokoll) || readFileSync(protokoll, "utf8").split("---").length < i + 2); k++) await new Promise((f) => setTimeout(f, 20));
      m.beende();
    }
    const [app, spiel] = readFileSync(protokoll, "utf8").split("---\n").map((t) => t.split("\n"));
    const gebunden = (a: string[]) => a.flatMap((x, j) => (x === "--ro-bind" && a[j + 2] === BILDER_IN_SANDBOX ? [a[j + 1]] : []));
    assert.deepEqual(gebunden(app!), [bilderOrdner(ablage, "app")]);
    assert.deepEqual(gebunden(spiel!), [bilderOrdner(ablage, "spiel")]);
    assert.ok(!app!.some((x, j) => x === "--bind" && app![j + 2] === BILDER_IN_SANDBOX), "nie schreibbar");
    for (const p of ["app", "spiel"]) assert.equal(statSync(bilderOrdner(ablage, p)).mode & 0o777, 0o700);
    // ohne Bilder kein Ordner, keine Bindung
    const ohne = hermesMotor({ hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: join(d, "b") }, modell: () => "coder:7b", bwrap });
    mkdirSync(ablage.ort("leer"), { recursive: true });
    ohne(ablage.ort("leer")).beende();
    assert.equal(existsSync(bilderOrdner(ablage, "leer")), false);
    // verdrahtet: main.ts liest COMFYUI_URL, gibt Freedom-MCP die Bilder des Projekts und dem Motor den Ordner
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    assert.match(main, /const bilderWahl = bilderAusUmgebung\(process\.env\);/);
    assert.match(main, /const bild = p && bilder \? \(prompt: string\) => erzeugeBild\(bilder, bilderOrdner\(projekte, p\.projekt\), prompt\) : undefined;/);
    assert.match(main, /\.\.\.\(bilder \? \{ bilder: \(p: string\) => bilderOrdner\(projekte, p\) \} : \{\}\)/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
