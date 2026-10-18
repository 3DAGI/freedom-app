/**
 * VKk1: Browser für den Motor – Playwright MCP aus `playwright-core` (Apache-2.0, schon optionale Abhängigkeit des
 * Knotens) in der Sandbox. Der echte Test startet den Server in bubblewrap und spricht MCP über stdio mit ihm – wie
 * Hermes; Hermes selbst läuft hier nicht (Fremdcode, `hermes-motor.test.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stream } from "@agentclientprotocol/sdk";
import { hermesHeim, hermesKonfiguration, hermesMotor } from "../src/hermes-motor.js";
import { BROWSER_ORTE, hermesMcpEintrag, MCP_TEXT, mcpAusUmgebung, PLAYWRIGHT_IN_SANDBOX, PLAYWRIGHT_WERKZEUGE, playwrightMcp, playwrightOrdner } from "../src/mcp-katalog.js";
import { ProjektAblage } from "../src/projekte.js";
import { pruefeSandbox, sandboxMotor } from "../src/sandbox.js";

const ordner = () => mkdtempSync(join(tmpdir(), "freedom-mcp-"));

test("VKk1: aus der Umgebung – aus, ungültig heißt kein Start, fehlt heißt ohne Browser", () => {
  const d = ordner();
  const browser = join(d, "chromium");
  writeFileSync(browser, "");
  try {
    assert.deepEqual(mcpAusUmgebung({ MCP_BROWSER: "aus" }, { playwright: "/pw" }), { server: [], fehlt: [] });
    for (const falsch of ["chromium", "/gibt/es/nicht", `${d}/../${d.split("/").at(-1)}/chromium`, d]) {
      assert.ok("ungueltig" in mcpAusUmgebung({ MCP_BROWSER: falsch }, { playwright: "/pw" }), falsch);
    }
    assert.deepEqual(mcpAusUmgebung({}, { playwright: null, orte: [browser] }), { server: [], fehlt: ["mcp.playwright-fehlt"] });
    assert.deepEqual(mcpAusUmgebung({}, { playwright: "/pw", orte: ["/gibt/es/nicht"] }), { server: [], fehlt: ["mcp.browser-fehlt"] });
    const gefunden = mcpAusUmgebung({}, { playwright: "/pw", orte: ["/gibt/es/nicht", browser] });
    assert.ok("server" in gefunden && gefunden.server.length === 1 && gefunden.fehlt.length === 0);
    assert.ok(gefunden.server[0]!.argumente.includes(browser));
    const gewaehlt = mcpAusUmgebung({ MCP_BROWSER: browser }, { playwright: "/pw", orte: [] });
    assert.ok("server" in gewaehlt && gewaehlt.server[0]!.argumente.includes(browser));
    for (const f of ["mcp.playwright-fehlt", "mcp.browser-fehlt"] as const) assert.match(MCP_TEXT[f], /der Motor läuft ohne/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKk1: der Server – ohne Kopf, Profil im Speicher, Ausgaben im tmpfs; nur lesbar, was außerhalb von /usr liegt", () => {
  const s = playwrightMcp({ playwright: "/app/node_modules/playwright-core", browser: "/usr/lib/chromium/chromium", node: "/usr/local/bin/node" });
  assert.equal(s.befehl, "/usr/local/bin/node");
  assert.deepEqual(s.argumente, [`${PLAYWRIGHT_IN_SANDBOX}/lib/entry/mcp.js`, "--headless", "--isolated", "--no-sandbox",
    "--executable-path", "/usr/lib/chromium/chromium", "--output-dir", "/tmp/playwright-mcp"]);
  // nie Fähigkeiten über die Grundausstattung hinaus, nie Dateien außerhalb des Projekts, nie ein Port
  assert.ok(!s.argumente.some((a) => /^--(caps|allow-unrestricted-file-access|port|host|cdp-endpoint|extension|unsafe)/.test(a)));
  assert.deepEqual(s.nurLesbar.filter((b) => b.ziel !== "/etc/fonts"), [{ quelle: "/app/node_modules/playwright-core", ziel: PLAYWRIGHT_IN_SANDBOX }]);
  const aussen = playwrightMcp({ playwright: "/pw", browser: "/opt/google/chrome/chrome", node: "/opt/node22/bin/node" });
  assert.deepEqual(aussen.nurLesbar.filter((b) => b.ziel !== "/etc/fonts").map((b) => b.ziel), [PLAYWRIGHT_IN_SANDBOX, "/opt/google/chrome", "/opt/node22"]);
  for (const b of aussen.nurLesbar) assert.ok(!b.ziel.startsWith("/arbeit"));
  for (const falsch of ["relativ/chrome", "/opt/../etc/chrome"]) assert.throws(() => playwrightMcp({ playwright: "/pw", browser: falsch, node: "/usr/bin/node" }));
  // nie die Wurzel, das Home oder darüber – darin läge ~/.freedom mit dem Schlüssel des Knotens
  const heim = "/home/n";
  for (const [browser, node] of [["/chrome", "/usr/bin/node"], ["/home/n/chrome", "/usr/bin/node"], ["/home/chrome", "/usr/bin/node"], ["/usr/lib/chromium/chromium", "/bin/node"], ["/usr/lib/chromium/chromium", "/home/n/bin/node"]] as const) {
    assert.throws(() => playwrightMcp({ playwright: "/pw", browser, node, heim }), { name: "OrdnerZuWeit" }, `${browser} ${node}`);
  }
  assert.deepEqual(playwrightMcp({ playwright: "/pw", browser: "/home/n/.cache/ms-playwright/chromium-1/chrome-linux/chrome", node: "/home/n/.nvm/v22/bin/node", heim })
    .nurLesbar.filter((b) => b.ziel !== "/etc/fonts").map((b) => b.ziel), [PLAYWRIGHT_IN_SANDBOX, "/home/n/.cache/ms-playwright/chromium-1/chrome-linux", "/home/n/.nvm/v22"]);
});

test("VKk1: Hermes bekommt den Browser nur mit erlaubten Werkzeugen – nie browser_run_code_unsafe", () => {
  const s = playwrightMcp({ playwright: "/pw", browser: "/usr/lib/chromium/chromium", node: "/usr/local/bin/node" });
  const k = JSON.parse(hermesKonfiguration("qwen3:8b", [s])) as { mcp_servers: Record<string, Record<string, unknown>> };
  assert.deepEqual(Object.keys(k.mcp_servers), ["freedom", "browser"]);
  assert.deepEqual(k.mcp_servers.browser, hermesMcpEintrag(s));
  const werkzeuge = (k.mcp_servers.browser!.tools as { include: string[] }).include;
  assert.deepEqual(werkzeuge, [...PLAYWRIGHT_WERKZEUGE]);
  assert.ok(!(werkzeuge as string[]).includes("browser_run_code_unsafe"));
  assert.deepEqual(k.mcp_servers.browser!.env, {}, "keine Variable des Knotens");
  // ohne Server bleibt die Konfiguration wie bisher
  assert.deepEqual(Object.keys((JSON.parse(hermesKonfiguration("qwen3:8b")) as { mcp_servers: object }).mcp_servers), ["freedom"]);
});

test("VKk1: der Motor bindet ein, was der Server braucht – nur lesbar – und nennt ihn in config.yaml", async () => {
  const d = ordner();
  try {
    // statt bubblewrap ein Skript, das seine Argumente aufschreibt
    const protokoll = join(d, "argumente");
    const bwrap = join(d, "bwrap");
    writeFileSync(bwrap, `#!/bin/sh\nprintf '%s\\n' "$@" > ${protokoll}\n`, { mode: 0o755 });
    const ablage = new ProjektAblage(join(d, "projekte"));
    mkdirSync(ablage.ort("app"), { recursive: true });
    const s = playwrightMcp({ playwright: "/pw", browser: "/opt/google/chrome/chrome", node: "/opt/node22/bin/node" });
    const m = hermesMotor({ hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: join(d, "b") }, modell: () => "coder:7b", bwrap, mcp: [s] })(ablage.ort("app"));
    for (let i = 0; i < 250 && !existsSync(protokoll); i++) await new Promise((f) => setTimeout(f, 20));
    const a = readFileSync(protokoll, "utf8").split("\n");
    for (const b of s.nurLesbar) {
      const i = a.findIndex((x, j) => x === "--ro-bind" && a[j + 1] === b.quelle && a[j + 2] === b.ziel);
      assert.ok(i > 0, `${b.quelle} → ${b.ziel}`);
    }
    assert.ok(!a.some((x, j) => x === "--bind" && a[j + 2] !== "/home/agent" && a[j + 2] !== "/arbeit"), "schreibbar bleiben nur Home und Projekt");
    const k = JSON.parse(readFileSync(join(hermesHeim(ablage, ablage.ort("app")), ".hermes", "config.yaml"), "utf8")) as { mcp_servers: Record<string, { command?: string }> };
    assert.equal(k.mcp_servers.browser?.command, "/opt/node22/bin/node");
    m.beende();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

/** Ein Browser für den echten Test: wie der Knoten, dazu das Chromium von Playwright, wo es installiert ist. */
function testBrowser(): string | undefined {
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const vonPlaywright = pw && existsSync(pw)
    ? readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).map((d) => join(pw, d, "chrome-linux", "chrome"))
    : [];
  return [process.env.MCP_TEST_BROWSER, ...BROWSER_ORTE, ...vonPlaywright].find((p) => p && existsSync(p));
}

const pruefung = await pruefeSandbox();
const browser = testBrowser();
const playwright = playwrightOrdner();
const ohne = (!pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`) || (!playwright && "playwright-core fehlt")
  || (!browser && "kein Chromium") || (!existsSync("/usr/bin/python3") && "python3 fehlt");

test("VKk1 (bubblewrap, Chromium): der Browser in der Sandbox – sieht Seiten aus der Sandbox, nie das Netz des Rechners", { skip: ohne, timeout: 120_000 }, async () => {
  const s = playwrightMcp({ playwright: playwright!, browser: browser! });
  const projekt = ordner();
  writeFileSync(join(projekt, "index.html"), "<h1 id=t>roh</h1><button onclick=\"t.textContent='geklickt'\">Knopf</button><script>t.textContent='aus JS '+(1+2)</script>");
  // ein Server auf dem Rechner – aus der Sandbox nicht erreichbar
  const draussen = createServer((_q, a) => a.end("<h1>draussen</h1>"));
  await new Promise<void>((f) => draussen.listen(0, "127.0.0.1", f));
  const port = (draussen.address() as { port: number }).port;
  // wie der Agent: ein Server in der Sandbox (Hermes startet ihn im Terminal), daneben der MCP-Server
  const start = sandboxMotor(["/bin/sh", "-c", 'python3 -m http.server 8000 --bind 127.0.0.1 >/dev/null 2>&1 & exec "$@"', "sh", s.befehl, ...s.argumente], { nurLesbar: s.nurLesbar });
  const m = start(projekt);
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
    assert.equal((init.result?.serverInfo as { name: string }).name, "Playwright");
    await schreiber.write({ jsonrpc: "2.0", method: "notifications/initialized" } as never);
    // die Liste zum Erlauben passt zur gepinnten Fassung: alles außer dem Werkzeug für beliebigen Code
    const namen = ((await frage("tools/list", {})).result?.tools as Array<{ name: string }>).map((t) => t.name);
    for (const w of PLAYWRIGHT_WERKZEUGE) assert.ok(namen.includes(w), w);
    assert.deepEqual(namen.filter((n) => !(PLAYWRIGHT_WERKZEUGE as readonly string[]).includes(n)), ["browser_run_code_unsafe"]);
    // eine Seite aus der Sandbox – JavaScript läuft, Klicks wirken
    let seite = "";
    for (let i = 0; i < 50 && !seite.includes("aus JS 3"); i++) {
      seite = text(await frage("tools/call", { name: "browser_navigate", arguments: { url: "http://127.0.0.1:8000/" } }));
      if (!seite.includes("aus JS 3")) await new Promise((f) => setTimeout(f, 100)); // der Server in der Sandbox startet noch
    }
    const bild = text(await frage("tools/call", { name: "browser_snapshot", arguments: {} }));
    assert.match(bild, /heading "aus JS 3"/);
    const ref = /button "Knopf" \[ref=([a-z0-9]+)\]/.exec(bild)?.[1];
    assert.ok(ref, bild);
    assert.doesNotMatch(text(await frage("tools/call", { name: "browser_click", arguments: { element: "Knopf", target: ref } })), /Error/);
    assert.match(text(await frage("tools/call", { name: "browser_snapshot", arguments: {} })), /heading "geklickt"/);
    // nichts hinaus: weder der Rechner (eigener Netz-Namensraum) noch das Internet
    assert.match(text(await frage("tools/call", { name: "browser_navigate", arguments: { url: `http://127.0.0.1:${port}/` } })), /ERR_CONNECTION_REFUSED|Error/);
    assert.doesNotMatch(text(await frage("tools/call", { name: "browser_snapshot", arguments: {} })), /draussen/);
    assert.match(text(await frage("tools/call", { name: "browser_navigate", arguments: { url: "https://example.com/" } })), /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Error/);
  } finally {
    m.beende();
    draussen.close();
    rmSync(projekt, { recursive: true, force: true });
  }
});
