/**
 * VKk2b: Notebooks ausführen – der Motor ruft im Terminal `notebook_ausfuehren.py` neben der Brücke auf (in seiner Sandbox,
 * im Modus „fragen“ erst nach der Rückfrage von Hermes), mit dem Kernel der Distribution. Die Brücke nennt den Befehl nur,
 * wenn es ihn gibt. Der echte Test führt ein Notebook in bubblewrap aus (ohne Sandbox oder ipykernel: übersprungen).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { WERKZEUGE, alsJson, rufe, werkzeuge } from "../mcp/jupyter-bruecke.mjs";
import {
  JUPYTER_BRUECKE, JUPYTER_IN_SANDBOX, MCP_TEXT, NOTEBOOK_AUSFUEHREN_IN_SANDBOX, jupyterMcp, mcpAusUmgebung, notebooksAusfuehrbar,
} from "../src/mcp-katalog.js";
import { fuehreAus, pruefeSandbox } from "../src/sandbox.js";

test("VKk2b: mit Kernel nennt notebook_read den Befehl – ohne nicht, und das Log sagt, was fehlt", () => {
  assert.equal(werkzeuge(null), WERKZEUGE);
  const mit = werkzeuge(NOTEBOOK_AUSFUEHREN_IN_SANDBOX);
  assert.match(mit[0]!.description, /use the terminal: \/freedom\/mcp\/jupyter\/notebook_ausfuehren\.py <path>/);
  assert.deepEqual(mit.slice(1), WERKZEUGE.slice(1), "nur notebook_read nennt ihn");
  const o = { playwright: null, orte: [], node: "/usr/local/bin/node" };
  const ohne = mcpAusUmgebung({}, { ...o, notebooks: false });
  assert.ok("server" in ohne);
  assert.deepEqual(ohne.fehlt, ["mcp.playwright-fehlt", "mcp.browser-fehlt", "mcp.jupyter-kernel-fehlt"]);
  assert.deepEqual(ohne.server.at(-1)!.argumente, [`${JUPYTER_IN_SANDBOX}/jupyter-bruecke.mjs`, "/arbeit"]);
  const mitKernel = mcpAusUmgebung({}, { ...o, notebooks: true });
  assert.ok("server" in mitKernel);
  assert.deepEqual(mitKernel.fehlt, ["mcp.playwright-fehlt", "mcp.browser-fehlt"]);
  assert.deepEqual(mitKernel.server.at(-1)!.argumente.slice(2), [`--ausfuehren=${NOTEBOOK_AUSFUEHREN_IN_SANDBOX}`]);
  assert.deepEqual(jupyterMcp({ node: "/usr/local/bin/node", ausfuehren: true }).nurLesbar, jupyterMcp({ node: "/usr/local/bin/node" }).nurLesbar,
    "das Skript liegt schon im Ordner der Brücke");
  assert.match(MCP_TEXT["mcp.jupyter-kernel-fehlt"], /python3-ipykernel und python3-nbclient/);
  // neben der Brücke, ausführbar, mit der Python der Distribution
  const skript = join(JUPYTER_BRUECKE, "..", "notebook_ausfuehren.py");
  assert.ok((statSync(skript).mode & 0o111) !== 0, "ausführbar");
  assert.match(readFileSync(skript, "utf8"), /^#!\/usr\/bin\/python3\n/);
});

test("VKk2b: die Brücke nimmt als Befehl nur ein Skript mit absolutem Pfad – sonst kein Start", { timeout: 30_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-jupyter-"));
  const starte = (...argumente: string[]) => spawn(process.execPath, [JUPYTER_BRUECKE, d, ...argumente], { stdio: ["pipe", "pipe", "ignore"] });
  const ende = (k: ReturnType<typeof starte>) => new Promise<number | null>((f) => k.on("exit", (c) => f(c)));
  try {
    for (const falsch of [["--ausfuehren=relativ.py"], ["--ausfuehren=/x/y.sh"], ["--ausfuehren=/x/a b.py"], ["--anders"], [`--ausfuehren=${NOTEBOOK_AUSFUEHREN_IN_SANDBOX}`, "mehr"]]) {
      assert.equal(await ende(starte(...falsch)), 2, falsch.join(" "));
    }
    const k = starte(`--ausfuehren=${NOTEBOOK_AUSFUEHREN_IN_SANDBOX}`);
    const zeilen = createInterface({ input: k.stdout! })[Symbol.asyncIterator]();
    k.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    const liste = JSON.parse((await zeilen.next()).value as string) as { result: { tools: Array<{ name: string; description: string }> } };
    assert.deepEqual(liste.result.tools, werkzeuge(NOTEBOOK_AUSFUEHREN_IN_SANDBOX));
    k.kill();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKk2b: ipykernel und nbclient im Bild nur mit VIBECODEN=1, in der CI für den echten Test", () => {
  const lies = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  const docker = lies("docker/node.Dockerfile");
  const pakete = (m: RegExpExecArray | null) => (m?.[1] ?? "").trim().split(/\s+/).filter((p) => p !== "\\");
  const immer = pakete(/\nRUN apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  const vibecoden = pakete(/if \[ "\$VIBECODEN" = "1" \]; then \\\n\s+apt-get update && apt-get install -y --no-install-recommends ([^&]+)/.exec(docker));
  for (const p of ["python3-ipykernel", "python3-nbclient"]) {
    assert.ok(vibecoden.includes(p), p);
    assert.ok(!immer.includes(p), `${p} nicht im schlanken Bild`);
  }
  assert.match(lies(".github/workflows/ci.yml"), /apt-get install -y --no-install-recommends python3-ipykernel python3-nbclient\n\s+\/usr\/bin\/python3 -c "import nbclient, ipykernel"/);
});

const pruefung = await pruefeSandbox();
const ohne = (!pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`) || (!notebooksAusfuehrbar() && "python3-ipykernel und python3-nbclient fehlen");

test("VKk2b (bubblewrap, ipykernel): ein Notebook in der Sandbox ausführen – Ausgaben im Notebook, kein Netz, Halt beim Fehler", { skip: ohne, timeout: 180_000 }, async () => {
  const s = jupyterMcp({ ausfuehren: true });
  const d = mkdtempSync(join(tmpdir(), "freedom-notebook-"));
  try {
    rufe(d, "notebook_create", { path: "a.ipynb" });
    for (const quelle of [
      "import math\nprint(6 * 7)\nmath.pi",
      "import urllib.request\ntry:\n    urllib.request.urlopen('http://example.com', timeout=3)\n    print('NETZ')\nexcept Exception as e:\n    print('kein Netz', type(e).__name__)",
      "1/0",
      "print('danach')",
    ]) rufe(d, "cell_insert", { path: "a.ipynb", source: quelle });
    // wie der Motor im Terminal: das Skript aus dem Ordner der Brücke, nur lesbar in der Sandbox
    const lauf = () => fuehreAus([NOTEBOOK_AUSFUEHREN_IN_SANDBOX, "a.ipynb"], { arbeit: d, nurLesbar: s.nurLesbar });
    let r = await lauf();
    assert.equal(r.code, 1, r.ausgabe);
    assert.match(r.ausgabe, /stopped at cell 2 \(ZeroDivisionError\)/);
    const datei = readFileSync(join(d, "a.ipynb"), "utf8");
    assert.equal(alsJson(JSON.parse(datei)), datei, "nbformat schreibt Byte für Byte, wie die Brücke schreibt");
    let text = rufe(d, "notebook_read", { path: "a.ipynb" }).text;
    assert.match(text, /\[0\] code, run 1\nimport math\nprint\(6 \* 7\)\nmath\.pi\n→ output:\n42\n\n3\.14159/);
    assert.match(text, /kein Netz URLError/);
    assert.doesNotMatch(text, /^NETZ$/m, "die Sandbox hat kein Netz");
    assert.match(text, /\[2\] code, run 3\n1\/0\n→ output:\nZeroDivisionError: division by zero/);
    assert.match(text, /\[3\] code, not run\nprint\('danach'\)$/, "nach dem Fehler läuft nichts");
    // korrigiert und noch einmal: alle Zellen laufen, mit neuem Kernel
    rufe(d, "cell_edit", { path: "a.ipynb", index: 2, source: "1/1" });
    r = await lauf();
    assert.equal(r.code, 0, r.ausgabe);
    assert.match(r.ausgabe, /^ran 4 code cells – outputs saved/);
    text = rufe(d, "notebook_read", { path: "a.ipynb" }).text;
    assert.match(text, /\[3\] code, run 4\nprint\('danach'\)\n→ output:\ndanach$/);
    // falsch aufgerufen: nichts geändert
    const vorher = readFileSync(join(d, "a.ipynb"), "utf8");
    assert.equal((await fuehreAus([NOTEBOOK_AUSFUEHREN_IN_SANDBOX, "a.txt"], { arbeit: d, nurLesbar: s.nurLesbar })).code, 2);
    assert.equal((await fuehreAus([NOTEBOOK_AUSFUEHREN_IN_SANDBOX, "fehlt.ipynb"], { arbeit: d, nurLesbar: s.nurLesbar })).code, 2);
    assert.equal(readFileSync(join(d, "a.ipynb"), "utf8"), vorher);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
