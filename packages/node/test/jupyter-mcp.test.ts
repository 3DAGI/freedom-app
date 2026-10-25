/**
 * VKk2a: Jupyter-Notebooks für den Motor – die eigene Brücke (`mcp/jupyter-bruecke.mjs`) liest und ändert Zellen, nur unter
 * dem Projekt, und schreibt Byte für Byte wie nbformat (Referenz aus `scripts/jupyter-referenz.py`). Ausgeführt wird
 * nichts. Der echte Test startet sie in bubblewrap und spricht MCP über stdio mit ihr – wie Hermes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Stream } from "@agentclientprotocol/sdk";
import { NB_GRENZEN, WERKZEUGE, alsJson, ausgabenText, neueZelle, neuesNotebook, notebookTeile, rufe, zeilen } from "../mcp/jupyter-bruecke.mjs";
import { CodeLaeufe } from "../src/code-motor.js";
import { hermesHeim, hermesKonfiguration, hermesMotor } from "../src/hermes-motor.js";
import { JUPYTER_BRUECKE, JUPYTER_IN_SANDBOX, jupyterMcp, mcpAusUmgebung } from "../src/mcp-katalog.js";
import { ProjektAblage } from "../src/projekte.js";
import { pruefeSandbox, sandboxMotor } from "../src/sandbox.js";

const REF = JSON.parse(readFileSync(new URL("./fixtures/jupyter-referenz.json", import.meta.url), "utf8")) as {
  neu: string; zellen: { zellen: Array<{ art: "code" | "markdown" | "raw"; id: string; quelle: string }>; text: string };
  ausgaben: string; geaendert: { index: number; quelle: string; text: string };
};
const ordner = () => mkdtempSync(join(tmpdir(), "freedom-jupyter-"));
type Nb = { cells: Array<Record<string, unknown>>; nbformat_minor: number };
const lies = (d: string, n = "a.ipynb") => JSON.parse(readFileSync(join(d, n), "utf8")) as Nb;

test("VKk2a: geschrieben wie nbformat 5.11.1 – neues Notebook, neue Zellen, unverändert gelesen und geschrieben", () => {
  assert.equal(alsJson(neuesNotebook()), REF.neu);
  const nb = neuesNotebook();
  nb.cells = REF.zellen.zellen.map((z) => neueZelle(z.art, z.quelle, z.id));
  assert.equal(alsJson(nb), REF.zellen.text);
  assert.equal(alsJson(JSON.parse(REF.ausgaben)), REF.ausgaben, "ein fremdes Notebook bleibt Byte für Byte, wie es war");
  assert.deepEqual(zeilen(""), []);
  assert.deepEqual(zeilen("a\r\nb\n\nc"), ["a\r\n", "b\n", "\n", "c"]);
});

test("VKk2a: eine Code-Zelle ändern – wie nbformat: Kennung und Metadaten bleiben, Ausgaben und Zählung weg", () => {
  const d = ordner();
  try {
    writeFileSync(join(d, "a.ipynb"), REF.ausgaben);
    const r = rufe(d, "cell_edit", { path: "a.ipynb", index: REF.geaendert.index, source: REF.geaendert.quelle });
    assert.deepEqual(r, { text: "changed cell 1 (code)", fehler: false });
    assert.equal(readFileSync(join(d, "a.ipynb"), "utf8"), REF.geaendert.text);
    assert.deepEqual(readdirSync(d), ["a.ipynb"], "keine Zwischendatei bleibt liegen");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKk2a: anlegen, einfügen, ändern, löschen – Kennungen neu und eindeutig, nie eine Datei ersetzt", () => {
  const d = ordner();
  try {
    mkdirSync(join(d, "nb"));
    assert.equal(rufe(d, "notebook_create", { path: "nb/a.ipynb" }).fehler, false);
    assert.equal(readFileSync(join(d, "nb", "a.ipynb"), "utf8"), REF.neu);
    assert.deepEqual(rufe(d, "notebook_create", { path: "nb/a.ipynb" }), { text: "file exists", fehler: true });
    assert.deepEqual(rufe(d, "notebook_create", { path: "fehlt/a.ipynb" }), { text: "no such folder", fehler: true });
    assert.match(rufe(d, "cell_insert", { path: `${d}/nb/a.ipynb`, source: "print(1)\n" }).text, /inserted cell 0 \(code\)/, "auch mit dem Pfad unter der Wurzel");
    rufe(d, "cell_insert", { path: "nb/a.ipynb", index: 0, type: "markdown", source: "# Titel" });
    rufe(d, "cell_insert", { path: "nb/a.ipynb", source: "x" });
    let nb = lies(join(d, "nb"));
    assert.deepEqual(nb.cells.map((z) => z.cell_type), ["markdown", "code", "code"]);
    const ids = nb.cells.map((z) => z.id as string);
    assert.ok(ids.every((i) => /^[0-9a-f]{8}$/.test(i)) && new Set(ids).size === 3, ids.join());
    assert.deepEqual(nb.cells[1]!.source, ["print(1)\n"]);
    // die Art wechseln: aus Markdown wird Code mit leeren Ausgaben, die Kennung bleibt
    assert.equal(rufe(d, "cell_edit", { path: "nb/a.ipynb", index: 0, source: "y = 2", type: "code" }).fehler, false);
    nb = lies(join(d, "nb"));
    assert.deepEqual(nb.cells[0], { cell_type: "code", execution_count: null, id: ids[0], metadata: {}, outputs: [], source: ["y = 2"] });
    assert.match(rufe(d, "cell_delete", { path: "nb/a.ipynb", index: 2 }).text, /has 2 cells/);
    assert.deepEqual(lies(join(d, "nb")).cells.map((z) => z.id), ids.slice(0, 2));
    // ältere Notebooks (4.4) bekommen keine Kennungen
    writeFileSync(join(d, "alt.ipynb"), JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 4 }));
    chmodSync(join(d, "alt.ipynb"), 0o600);
    rufe(d, "cell_insert", { path: "alt.ipynb", source: "z" });
    assert.ok(!("id" in lies(d, "alt.ipynb").cells[0]!));
    assert.equal(statSync(join(d, "alt.ipynb")).mode & 0o777, 0o600, "die Rechte der Datei bleiben");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKk2a: nur Notebooks im Projekt – kein .., keine versteckten Ordner, keinem Verweis folgen", () => {
  for (const gut of ["a.ipynb", "nb/a b.ipynb", "/arbeit/x/ä.ipynb"]) assert.ok(notebookTeile("/arbeit", gut), gut);
  for (const falsch of ["", "a.py", "../a.ipynb", "x/../a.ipynb", "./a.ipynb", ".git/a.ipynb", "x/.ipynb_checkpoints/a.ipynb", "/etc/a.ipynb",
    "/arbeitx/a.ipynb", "a\\b.ipynb", "a\nb.ipynb", "x//a.ipynb", `${"x".repeat(NB_GRENZEN.pfadZeichen)}.ipynb`, 42, null]) {
    assert.equal(notebookTeile("/arbeit", falsch), null, String(falsch));
  }
  const d = ordner();
  const draussen = ordner();
  try {
    writeFileSync(join(draussen, "b.ipynb"), REF.neu);
    symlinkSync(join(draussen, "b.ipynb"), join(d, "verweis.ipynb"));
    symlinkSync(draussen, join(d, "ordner"));
    assert.deepEqual(rufe(d, "notebook_read", { path: "verweis.ipynb" }), { text: "not a notebook file", fehler: true });
    assert.deepEqual(rufe(d, "cell_insert", { path: "ordner/b.ipynb", source: "x" }), { text: "no such folder", fehler: true });
    assert.deepEqual(rufe(d, "notebook_create", { path: "verweis.ipynb" }), { text: "file exists", fehler: true });
    assert.equal(readFileSync(join(draussen, "b.ipynb"), "utf8"), REF.neu, "draußen unverändert");
    assert.match(rufe(d, "notebook_read", { path: "../b.ipynb" }).text, /^path:/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(draussen, { recursive: true, force: true });
  }
});

test("VKk2a: Falsches mit festen Texten – Nummer, Art, Länge, Format, Größe, unbekanntes Werkzeug", () => {
  const d = ordner();
  try {
    writeFileSync(join(d, "a.ipynb"), REF.ausgaben);
    const vorher = readFileSync(join(d, "a.ipynb"), "utf8");
    assert.deepEqual(rufe(d, "cell_edit", { path: "a.ipynb", index: 4, source: "x" }), { text: "index: 0 to 3", fehler: true });
    assert.deepEqual(rufe(d, "cell_insert", { path: "a.ipynb", index: 5, source: "x" }), { text: "index: 0 to 4", fehler: true });
    assert.deepEqual(rufe(d, "cell_delete", { path: "a.ipynb", index: 1.5 }), { text: "index: 0 to 3", fehler: true });
    assert.deepEqual(rufe(d, "cell_insert", { path: "a.ipynb", type: "html", source: "x" }), { text: "type: code, markdown or raw", fehler: true });
    assert.match(rufe(d, "cell_insert", { path: "a.ipynb", source: "x".repeat(NB_GRENZEN.quelleZeichen + 1) }).text, /^source:/);
    assert.deepEqual(rufe(d, "cell_insert", { path: "a.ipynb" }), { text: "source: text up to 100000 characters", fehler: true });
    assert.deepEqual(rufe(d, "run_cell", { path: "a.ipynb", index: 0 }), { text: "unknown tool", fehler: true }, "ausgeführt wird nichts");
    assert.equal(readFileSync(join(d, "a.ipynb"), "utf8"), vorher, "nichts geschrieben");
    writeFileSync(join(d, "v3.ipynb"), JSON.stringify({ worksheets: [], metadata: {}, nbformat: 3, nbformat_minor: 0 }));
    assert.deepEqual(rufe(d, "notebook_read", { path: "v3.ipynb" }), { text: "only nbformat 4 notebooks are supported", fehler: true });
    writeFileSync(join(d, "kaputt.ipynb"), "{");
    assert.deepEqual(rufe(d, "notebook_read", { path: "kaputt.ipynb" }), { text: "not valid JSON", fehler: true });
    writeFileSync(join(d, "gross.ipynb"), "");
    truncateSync(join(d, "gross.ipynb"), NB_GRENZEN.dateiBytes + 1);
    assert.deepEqual(rufe(d, "notebook_read", { path: "gross.ipynb" }), { text: "notebook too large", fehler: true });
    assert.deepEqual(rufe(d, "notebook_read", { path: "fehlt.ipynb" }), { text: "no such notebook", fehler: true });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKk2a: lesen – Ausgaben als Text, Medien nur benannt, ohne Farbcodes; lange Notebooks in Teilen", () => {
  const d = ordner();
  try {
    writeFileSync(join(d, "a.ipynb"), REF.ausgaben);
    const t = rufe(d, "notebook_read", { path: "a.ipynb" }).text;
    assert.match(t, /^a\.ipynb: 4 cells, nbformat 4\.5, kernel python3\n\n\[0\] markdown\n## Auswertung/);
    assert.match(t, /\[1\] code, run 3\nprint\('hallo'\)\n1 \+ 1\n→ output:\nhallo\n\nstderr: Warnung\n\n2\n\[text\/html\]/);
    assert.match(t, /<Figure size 640x480>\n\[image\/png\]/);
    assert.doesNotMatch(t, /iVBOR|\x1b/, "keine Bilddaten, keine Farbcodes");
    assert.equal(ausgabenText([{ output_type: "error", ename: "E", evalue: "x", traceback: ["\x1b[0;31mE\x1b[0m: x", "zeile 2"] }]), "E: x\nzeile 2");
    // viele lange Zellen: erst ein Teil, dann weiter ab der genannten Zelle
    const nb = neuesNotebook();
    nb.cells = Array.from({ length: 40 }, (_, i) => neueZelle("code", `# ${i}\n${"x".repeat(1_000)}`, `0000${String(i).padStart(4, "0")}`));
    writeFileSync(join(d, "lang.ipynb"), alsJson(nb));
    const erst = rufe(d, "notebook_read", { path: "lang.ipynb" }).text;
    const weiter = Number(/continue with start=(\d+)\]$/.exec(erst)?.[1]);
    assert.ok(weiter > 5 && weiter < 40 && erst.length <= NB_GRENZEN.textZeichen + 200, `${weiter} ${erst.length}`);
    assert.match(rufe(d, "notebook_read", { path: "lang.ipynb", start: weiter }).text, new RegExp(`\\[${weiter}\\] code, not run\\n# ${weiter}\\n`));
    assert.deepEqual(rufe(d, "notebook_read", { path: "lang.ipynb", start: 40 }), { text: "start: 0 to 39", fehler: true });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKk2a: über stdio – initialize, Werkzeuge, anlegen und lesen; nie etwas nach stderr", { timeout: 30_000 }, async () => {
  const d = ordner();
  const kind = spawn(process.execPath, [JUPYTER_BRUECKE, d], { stdio: ["pipe", "pipe", "pipe"] });
  let fehlerAusgabe = "";
  kind.stderr.on("data", (b: Buffer) => { fehlerAusgabe += b.toString(); });
  const antworten = createInterface({ input: kind.stdout })[Symbol.asyncIterator]();
  let nr = 0;
  const frage = async (method: string, params: object = {}) => {
    kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++nr, method, params })}\n`);
    return JSON.parse((await antworten.next()).value as string) as { result?: Record<string, unknown>; error?: { code: number } };
  };
  try {
    const init = await frage("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.deepEqual(init.result?.serverInfo, { name: "freedom-jupyter", version: "1" });
    assert.equal(init.result?.protocolVersion, "2025-06-18");
    kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    assert.deepEqual(((await frage("tools/list")).result?.tools as Array<{ name: string }>).map((w) => w.name), WERKZEUGE.map((w) => w.name));
    assert.deepEqual((await frage("tools/call", { name: "notebook_create", arguments: { path: "a.ipynb" } })).result, { content: [{ type: "text", text: "created a.ipynb (empty, Python 3 kernel)" }], isError: false });
    await frage("tools/call", { name: "cell_insert", arguments: { path: "a.ipynb", source: "print('hi')" } });
    assert.match(((await frage("tools/call", { name: "notebook_read", arguments: { path: "a.ipynb" } })).result?.content as Array<{ text: string }>)[0]!.text, /\[0\] code, not run\nprint\('hi'\)/);
    assert.equal((await frage("tools/call", { name: "notebook_read", arguments: { path: "../a.ipynb" } })).result?.isError, true);
    assert.equal((await frage("resources/list")).error?.code, -32601);
    assert.equal(fehlerAusgabe, "");
  } finally {
    kind.kill();
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKk2a: für den Motor – von selbst dabei, MCP_JUPYTER=aus schaltet ab, Brücke nur lesbar, nie zu weit", () => {
  const s = jupyterMcp({ node: "/usr/local/bin/node" });
  assert.deepEqual(s, {
    name: "jupyter", befehl: "/usr/local/bin/node", argumente: [`${JUPYTER_IN_SANDBOX}/jupyter-bruecke.mjs`, "/arbeit"],
    werkzeuge: ["notebook_read", "notebook_create", "cell_insert", "cell_edit", "cell_delete"], beimFragen: ["notebook_read"],
    nurLesbar: [{ quelle: join(JUPYTER_BRUECKE, ".."), ziel: JUPYTER_IN_SANDBOX }],
  });
  assert.deepEqual(jupyterMcp({ node: "/opt/node22/bin/node" }).nurLesbar.map((b) => b.ziel), [JUPYTER_IN_SANDBOX, "/opt/node22"]);
  for (const node of ["/bin/node", "/home/n/bin/node"]) assert.throws(() => jupyterMcp({ node, heim: "/home/n" }), { name: "OrdnerZuWeit" }, node);
  const o = { playwright: null, orte: [], node: "/usr/local/bin/node" };
  const wahl = mcpAusUmgebung({}, o);
  assert.ok("server" in wahl && wahl.server.at(-1)?.name === "jupyter");
  assert.deepEqual(mcpAusUmgebung({ MCP_JUPYTER: "aus" }, o), { server: [], fehlt: ["mcp.playwright-fehlt", "mcp.browser-fehlt"] });
  for (const falsch of ["an", "1", "/opt/jupyter"]) assert.ok("ungueltig" in mcpAusUmgebung({ MCP_JUPYTER: falsch }, o), falsch);
  assert.ok("ungueltig" in mcpAusUmgebung({}, { ...o, node: "/home/n/bin/node", heim: "/home/n" }));
  // Hermes bekommt genau die Werkzeuge der Brücke
  const k = JSON.parse(hermesKonfiguration("coder:7b", [s], "ab".repeat(32))) as { mcp_servers: Record<string, { tools?: { include?: string[] } }> };
  assert.deepEqual(k.mcp_servers.jupyter?.tools?.include, WERKZEUGE.map((w) => w.name));
});

test("VKk2a: im Modus „fragen“ nur lesen – ändern geht dort über Hermes, der vorher fragt; „frei“ alles", async () => {
  const d = ordner();
  try {
    // statt bubblewrap ein Skript, das nichts tut – geprüft wird die config.yaml, die der Knoten vor dem Start schreibt
    const bwrap = join(d, "bwrap");
    writeFileSync(bwrap, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const ablage = new ProjektAblage(join(d, "projekte"));
    mkdirSync(ablage.ort("app"), { recursive: true });
    const s = jupyterMcp({ node: "/usr/local/bin/node" });
    assert.ok(s.beimFragen?.every((w) => s.werkzeuge.includes(w)));
    const start = hermesMotor({ hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: join(d, "b") }, modell: () => "coder:7b", bwrap, mcp: [s] });
    const werkzeuge = (lauf?: { modus: "fragen" | "frei" }) => {
      start(ablage.ort("app"), lauf).beende();
      const k = JSON.parse(readFileSync(join(hermesHeim(ablage, ablage.ort("app")), ".hermes", "config.yaml"), "utf8")) as { mcp_servers: Record<string, { tools: { include: string[] } }> };
      return k.mcp_servers.jupyter!.tools.include;
    };
    assert.deepEqual(werkzeuge({ modus: "fragen" }), ["notebook_read"]);
    assert.deepEqual(werkzeuge({ modus: "frei" }), WERKZEUGE.map((w) => w.name));
    assert.deepEqual(werkzeuge(), ["notebook_read"], "ohne Angabe wie „fragen“");
    // der Lauf gibt seinen Modus an den Motor
    const gesehen: unknown[] = [];
    const l = new CodeLaeufe({ ablage, motor: (_o, lauf) => { gesehen.push(lauf); throw new Error("kein Motor"); } });
    await l.starte("a".repeat(64), { projekt: "app", text: "x", modus: "fragen" }, () => {});
    await l.starte("b".repeat(64), { projekt: "app", text: "x", modus: "frei" }, () => {});
    assert.deepEqual(gesehen, [{ modus: "fragen" }, { modus: "frei" }]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

const pruefung = await pruefeSandbox();

test("VKk2a (bubblewrap): die Brücke in der Sandbox des Motors – schreibt ins Projekt, nie hinaus", { skip: !pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`, timeout: 60_000 }, async () => {
  const wahl = mcpAusUmgebung({ MCP_BROWSER: "aus" }, {});
  assert.ok("server" in wahl);
  const s = wahl.server.find((x) => x.name === "jupyter")!;
  const projekt = ordner();
  mkdirSync(join(projekt, ".git"));
  // wie Hermes: der Server als Kind in der Sandbox des Motors, MCP über stdio
  const m = sandboxMotor([s.befehl, ...s.argumente], { nurLesbar: s.nurLesbar })(projekt);
  const strom = m.strom as Stream;
  const schreiber = strom.writable.getWriter();
  const leser = strom.readable.getReader();
  let nr = 0;
  const frage = async (method: string, params: object): Promise<{ result?: Record<string, unknown> }> => {
    const id = ++nr;
    await schreiber.write({ jsonrpc: "2.0", id, method, params } as never);
    for (;;) {
      const { value, done } = await leser.read();
      if (done) throw new Error("Server beendet");
      if ((value as { id?: number }).id === id) return value as { result?: Record<string, unknown> };
    }
  };
  const text = (r: { result?: Record<string, unknown> }) => ((r.result?.content ?? []) as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
  try {
    const init = await frage("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "freedom-test", version: "1" } });
    assert.equal((init.result?.serverInfo as { name: string } | undefined)?.name, "freedom-jupyter");
    assert.match(text(await frage("tools/call", { name: "notebook_create", arguments: { path: "/arbeit/a.ipynb" } })), /^created a\.ipynb/);
    await frage("tools/call", { name: "cell_insert", arguments: { path: "a.ipynb", type: "markdown", source: "# Probe" } });
    assert.match(text(await frage("tools/call", { name: "notebook_read", arguments: { path: "a.ipynb" } })), /\[0\] markdown\n# Probe/);
    assert.deepEqual(lies(projekt).cells[0]!.source, ["# Probe"], "auf dem Rechner im Projekt");
    assert.match(text(await frage("tools/call", { name: "notebook_create", arguments: { path: ".git/b.ipynb" } })), /^path:/);
    assert.ok(!existsSync(join(projekt, ".git", "b.ipynb")));
  } finally {
    m.beende();
    rmSync(projekt, { recursive: true, force: true });
  }
});
