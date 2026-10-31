/**
 * B-31b: Kiwix als MCP-Server – Wikipedia & Co. ohne Internet. Die eigene Brücke (`mcp/kiwix-bruecke.mjs`) startet
 * `kiwix-serve` auf 127.0.0.1 und gibt dem Modell `search` und `read`; im Knoten nur in der Sandbox. Die echten Tests
 * bauen ein kleines ZIM mit `zimwriterfs` und laufen gegen `kiwix-serve` aus Debian (ohne beides: übersprungen).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { deflateSync } from "node:zlib";
import { KIWIX_GRENZEN, WERKZEUGE, alsText, istArtikelPfad, leseTreffer } from "../mcp/kiwix-bruecke.mjs";
import type { Stream } from "@agentclientprotocol/sdk";
import { hermesKonfiguration } from "../src/hermes-motor.js";
import { KIWIX_BRUECKE, KIWIX_SERVE, McpWerkzeuge, mcpAusDatei, starteMcpServer } from "../src/mcp-client.js";
import { KIWIX_IN_SANDBOX, MCP_TEXT, mcpAusUmgebung, type McpServer } from "../src/mcp-katalog.js";
import { pruefeSandbox, sandboxMotor } from "../src/sandbox.js";

test("B-31b: Pfade nur aus der Suche – Buch und Eintrag, nie .., Abfrage oder Steuerzeichen", () => {
  for (const gut of ["probe/Lora.html", "wikipedia_de_all/A/Berlin", "wikipedia_de/A/Café (Begriffsklärung)"]) assert.ok(istArtikelPfad(gut), gut);
  for (const falsch of ["Lora.html", "/probe/Lora.html", "probe/../etc/passwd", "probe/./x", "probe//x", "probe/x?pattern=a", "probe/x#a", "probe/a\\b", "probe/a\nb", "../x/y", 42, null]) {
    assert.ok(!istArtikelPfad(falsch), String(falsch));
  }
});

test("B-31b: Seiten als Text – ohne Skripte und Stile, Entitäten aufgelöst, Absätze als Leerzeilen", () => {
  const html = "<html><head><style>p{x}</style><script>alert(1)</script></head><body><h1>Mesh&shy;</h1><!-- weg --><p>A &amp; B &#x2014; &lt;C&gt;</p><p>Zweite&nbsp;Zeile<br>dritte</p><noscript>nein</noscript></body></html>";
  assert.equal(alsText(html), "Mesh&shy;\n\nA & B — <C>\n\nZweite Zeile\n\ndritte");
  assert.doesNotMatch(alsText("<p>x</p><script type=\"text/javascript\">geheim()</script ><p>y</p>"), /geheim/);
  assert.equal(alsText("&#0; &#xD800; &#1114112;"), "&#0; &#xD800; &#1114112;", "keine ungültigen Zeichen");
});

test("B-31b: Treffer der Suche – Titel, Auszug, Pfad; Fremdes und Kaputtes fällt weg, höchstens zehn", () => {
  const item = (titel: string, link: string, text = "Auszug") => `<item><title>${titel}</title><link>${link}</link><description><b>${text}</b>...</description><book><title>Buch</title></book></item>`;
  const xml = `<rss><channel><title>Search: x</title>${[
    item("Caf&#233;", "/content/wiki/A/Caf%C3%A9"),
    item("Außen", "https://example.org/x"),
    item("Hoch", "/content/wiki/../geheim"),
    item("Kaputt", "/content/wiki/%E0%A4%A"),
    ...Array.from({ length: 12 }, (_, i) => item(`T${i}`, `/content/wiki/A/T${i}`)),
  ].join("")}</channel></rss>`;
  const t = leseTreffer(xml);
  assert.deepEqual(t[0], { titel: "Café", auszug: "Auszug...", pfad: "wiki/A/Café" });
  assert.equal(t.length, KIWIX_GRENZEN.treffer);
  assert.ok(!t.some((x) => ["Außen", "Hoch", "Kaputt"].includes(x.titel)));
  assert.deepEqual(WERKZEUGE.map((w) => w.name), ["search", "read"]);
});

test("B-31b: mcp.json – „kiwix“ statt „befehl“ startet die eigene Brücke mit kiwix-serve; ZIM-Ordner nur lesbar, nie zu weit", () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-kiwix-json-"));
  const datei = join(d, "mcp.json");
  const heim = "/home/n";
  const mit = (inhalt: unknown) => { writeFileSync(datei, JSON.stringify(inhalt)); return mcpAusDatei(datei, heim, { node: "/usr/bin/node" }); };
  try {
    assert.deepEqual(mit({ server: { wiki: { kiwix: ["/daten/zim/wikipedia_de.zim", "/daten/zim/wiktionary.zim", "/opt/zim/x.zim"] } } }), {
      server: [{
        name: "wiki", befehl: ["/usr/bin/node", KIWIX_BRUECKE, KIWIX_SERVE, "/daten/zim/wikipedia_de.zim", "/daten/zim/wiktionary.zim", "/opt/zim/x.zim"],
        nurLesbar: [join(KIWIX_BRUECKE, ".."), "/daten/zim", "/opt/zim"], braucht: KIWIX_SERVE,
        zim: ["/daten/zim/wikipedia_de.zim", "/daten/zim/wiktionary.zim", "/opt/zim/x.zim"],
      }],
    });
    const falsch: Array<[string, unknown]> = [
      ["leer", { server: { wiki: { kiwix: [] } } }],
      ["kein ZIM", { server: { wiki: { kiwix: ["/daten/zim/wiki.txt"] } } }],
      ["relativ", { server: { wiki: { kiwix: ["zim/wiki.zim"] } } }],
      ["mit ..", { server: { wiki: { kiwix: ["/daten/../wiki.zim"] } } }],
      ["zu viele", { server: { wiki: { kiwix: Array.from({ length: 9 }, (_, i) => `/daten/z${i}.zim`) } } }],
      ["beides", { server: { wiki: { kiwix: ["/daten/wiki.zim"], befehl: ["/usr/bin/x"] } } }],
      ["in der Wurzel", { server: { wiki: { kiwix: ["/wiki.zim"] } } }],
      ["direkt im Home", { server: { wiki: { kiwix: ["/home/n/wiki.zim"] } } }],
      ["in ~/.freedom", { server: { wiki: { kiwix: ["/home/n/.freedom/wiki.zim"] } } }],
    ];
    for (const [fall, inhalt] of falsch) assert.ok("ungueltig" in mit(inhalt), fall);
    assert.equal(readFileSync(KIWIX_BRUECKE, "utf8").includes("console."), false, "die Brücke schreibt nichts ins Log");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("B-31b: verdrahtet – Docker-Bild, Installer (Pfade nur als Argument), CI und Doku", () => {
  const lies = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  assert.match(lies("docker/node.Dockerfile"), /apt-get install -y --no-install-recommends aria2 bubblewrap git kiwix-tools/);
  const sh = lies("scripts/install-freedom.sh");
  assert.match(sh, /\(umask 077; node -e "const z=process\.argv\[1\]\.split\(','\)[^"]*" "\$KIWIX_ZIM" > "\$STATE_DIR\/mcp\.json"\)/, "ZIM-Pfade nur als Argument an node");
  assert.match(sh, /if \[ -e "\$STATE_DIR\/mcp\.json" \]; then\n\s+warn/, "eine vorhandene mcp.json bleibt");
  assert.match(lies(".github/workflows/ci.yml"), /apt-get install -y --no-install-recommends kiwix-tools zim-tools/);
  assert.match(lies("docs/PROVIDER.md"), /"kiwix": \["\/daten\/zim\/wikipedia_de_all_nopic\.zim"\]/);
});

test("B-31b: ohne kiwix-serve startet der Server nicht – mit Namen, nichts gestartet", async () => {
  await assert.rejects(starteMcpServer({ name: "wiki", befehl: ["/usr/bin/node", KIWIX_BRUECKE], nurLesbar: [], braucht: "/gibt/es/nicht/kiwix-serve" }), { name: "ProgrammFehlt" });
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /s\.braucht === KIWIX_SERVE \? " \(Paket kiwix-tools\)"/, "das Log nennt das Paket");
});

/** Ein kleines ZIM mit drei Seiten (eine mit Skript) – nur mit zimwriterfs. */
function probeZim(d: string): string {
  const inhalt = join(d, "inhalt");
  mkdirSync(inhalt);
  const seite = (titel: string, text: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${titel}</title></head><body><h1>${titel}</h1><p>${text}</p></body></html>`;
  writeFileSync(join(inhalt, "index.html"), seite("Start", "Willkommen."));
  writeFileSync(join(inhalt, "Mesh.html"), seite("Mesh-Netz", "Ein Mesh-Netz verbindet Geräte direkt miteinander. LoRa reicht weit.<script>geheimeFunktion()</script>"));
  writeFileSync(join(inhalt, "Lora.html"), seite("LoRa", "LoRa ist eine Funktechnik mit großer Reichweite."));
  // 48×48 PNG (grau) – zimwriterfs verlangt ein Bild
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const block = (typ: string, daten: Buffer) => { const t = Buffer.concat([Buffer.from(typ), daten]); const l = Buffer.alloc(4); l.writeUInt32BE(daten.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(t)); return Buffer.concat([l, t, c]); };
  const kopf = Buffer.alloc(13); kopf.writeUInt32BE(48, 0); kopf.writeUInt32BE(48, 4); kopf.set([8, 2, 0, 0, 0], 8);
  const roh = Buffer.concat(Array.from({ length: 48 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(48 * 3, 0x80)])));
  writeFileSync(join(inhalt, "icon.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), block("IHDR", kopf), block("IDAT", deflateSync(roh)), block("IEND", Buffer.alloc(0))]));
  const zim = join(d, "probe.zim");
  const r = spawnSync("zimwriterfs", ["--welcome=index.html", "--illustration=icon.png", "--language=deu", "--title=Probe", "--description=Probe-Archiv",
    "--longDescription=Ein kleines Probe-Archiv für Tests", "--creator=Freedom", "--publisher=Freedom", "--name=probe", inhalt, zim], { stdio: "ignore" });
  assert.equal(r.status, 0, "zimwriterfs");
  return zim;
}

const hatKiwix = existsSync(KIWIX_SERVE) && spawnSync("zimwriterfs", ["--version"], { stdio: "ignore" }).status === 0;
const ohneKiwix = !hatKiwix && "kiwix-serve oder zimwriterfs fehlt (apt install kiwix-tools zim-tools)";

test("B-31b (kiwix-serve): die Brücke über stdio – initialize, Werkzeuge, suchen, lesen ohne Skript, falsche Pfade abgewiesen", { skip: ohneKiwix, timeout: 60_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-kiwix-"));
  const kind = spawn(process.execPath, [KIWIX_BRUECKE, KIWIX_SERVE, probeZim(d)], { stdio: ["pipe", "pipe", "pipe"] });
  const fehlerAusgabe: string[] = [];
  kind.stderr.on("data", (b: Buffer) => fehlerAusgabe.push(b.toString()));
  const antworten = new Map<number, (m: Record<string, unknown>) => void>();
  createInterface({ input: kind.stdout }).on("line", (z) => { const m = JSON.parse(z) as { id: number }; antworten.get(m.id)?.(m); });
  let nr = 0;
  const frage = (method: string, params: unknown = {}) => new Promise<Record<string, unknown>>((fertig) => {
    const id = ++nr;
    antworten.set(id, fertig);
    kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const rufe = async (name: string, args: unknown) => ((await frage("tools/call", { name, arguments: args })).result as { content: Array<{ text: string }>; isError: boolean });
  try {
    const init = (await frage("initialize", { protocolVersion: "2025-03-26", capabilities: {} })).result as { protocolVersion: string };
    assert.equal(init.protocolVersion, "2025-03-26");
    kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    assert.deepEqual(((await frage("tools/list")).result as { tools: Array<{ name: string }> }).tools.map((t) => t.name), ["search", "read"]);
    const suche = await rufe("search", { query: "LoRa" });
    assert.equal(suche.isError, false);
    assert.match(suche.content[0]!.text, /^1\. LoRa – .*\n {3}path: probe\/Lora\.html/);
    assert.match(suche.content[0]!.text, /path: probe\/Mesh\.html/);
    const lies = await rufe("read", { path: "probe/Mesh.html" });
    assert.match(lies.content[0]!.text, /Ein Mesh-Netz verbindet Geräte direkt miteinander\. LoRa reicht weit\./);
    assert.doesNotMatch(lies.content[0]!.text, /geheimeFunktion/, "kein Skript im Text");
    for (const [args, text] of [[{ path: "probe/../../etc/passwd" }, /^path: /], [{ path: "probe/Nichts.html" }, /^not found$/], [{ query: "" }, /^query: /]] as const) {
      const r = await rufe("query" in args ? "search" : "read", args);
      assert.equal(r.isError, true);
      assert.match(r.content[0]!.text, text);
    }
    assert.equal((await rufe("shell", {})).content[0]!.text, "unknown tool");
    assert.deepEqual(await frage("ping"), { jsonrpc: "2.0", id: nr, result: {} });
    assert.equal(((await frage("resources/list")).error as { code: number }).code, -32601);
  } finally {
    kind.stdin.end();
    await new Promise((r) => kind.once("exit", r));
    rmSync(d, { recursive: true, force: true });
  }
  assert.deepEqual(fehlerAusgabe, [], "nichts nach stderr – Fragen und Artikel sind Inhalt einer Anfrage");
});

test("B-31b (kiwix-serve): ohne kiwix-serve beantwortet die Brücke initialize mit einem Fehler", { skip: ohneKiwix, timeout: 60_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-kiwix-"));
  const kind = spawn(process.execPath, [KIWIX_BRUECKE, join(d, "kein-kiwix-serve"), probeZim(d)], { stdio: ["pipe", "pipe", "ignore"] });
  try {
    const zeile = await new Promise<string>((fertig) => {
      createInterface({ input: kind.stdout }).once("line", fertig);
      kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    });
    assert.equal((JSON.parse(zeile) as { error?: { code: number } }).error?.code, -32000);
  } finally {
    kind.stdin.end();
    await new Promise((r) => kind.once("exit", r));
    rmSync(d, { recursive: true, force: true });
  }
});

const pruefung = await pruefeSandbox();
const ohneSandbox = ohneKiwix || (!pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`);

test("B-31b (bubblewrap): Kiwix aus mcp.json in der Sandbox – das Modell sucht und liest ohne Netz", { skip: ohneSandbox, timeout: 90_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-kiwix-"));
  const zim = probeZim(join(d, "."));
  writeFileSync(join(d, "mcp.json"), JSON.stringify({ server: { wiki: { kiwix: [zim] } } }));
  const wahl = mcpAusDatei(join(d, "mcp.json"), "/home/niemand");
  assert.ok("server" in wahl);
  const s = await starteMcpServer(wahl.server[0]!);
  const kasten = new McpWerkzeuge();
  try {
    kasten.nimm("wiki", s.verbindung, s.werkzeuge);
    assert.deepEqual(kasten.schemas().map((w) => w.function.name), ["mcp__wiki__search", "mcp__wiki__read"]);
    assert.match(await kasten.fuehreAus("mcp__wiki__search", { query: "Funktechnik" }), /LoRa – .*path: probe\/Lora\.html/s);
    assert.match(await kasten.fuehreAus("mcp__wiki__read", { path: "probe/Lora.html" }), /LoRa ist eine Funktechnik mit großer Reichweite\./);
  } finally {
    kasten.schliesse();
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKd2a: Kiwix für den Motor – dieselben ZIM-Dateien wie aus mcp.json, Ordner nur lesbar, nur suchen und lesen", () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-kiwix-motor-"));
  try {
    const serve = join(d, "kiwix-serve");
    writeFileSync(serve, "");
    const zim = ["/daten/zim/wikipedia_de.zim", "/daten/zim/wiktionary.zim", "/opt/zim/x.zim", "/daten/zim/wikipedia_de.zim"];
    const wahl = mcpAusUmgebung({ MCP_BROWSER: "aus" }, { zim, kiwixServe: serve, node: "/usr/bin/node", heim: "/home/n" });
    assert.ok("server" in wahl);
    assert.deepEqual(wahl.fehlt, []);
    const s = wahl.server.find((x) => x.name === "kiwix")!;
    assert.deepEqual(s, {
      name: "kiwix", befehl: "/usr/bin/node",
      argumente: [`${KIWIX_IN_SANDBOX}/kiwix-bruecke.mjs`, serve, "/daten/zim/wikipedia_de.zim", "/daten/zim/wiktionary.zim", "/opt/zim/x.zim"],
      werkzeuge: ["search", "read"],
      nurLesbar: [{ quelle: join(KIWIX_BRUECKE, ".."), ziel: KIWIX_IN_SANDBOX }, { quelle: "/daten/zim", ziel: "/daten/zim" }, { quelle: "/opt/zim", ziel: "/opt/zim" }, { quelle: d, ziel: d }],
    } satisfies McpServer);
    assert.deepEqual([...s.werkzeuge], WERKZEUGE.map((w) => w.name), "genau die Werkzeuge der Brücke");
    // Node außerhalb von /usr: sein Präfix kommt nur lesbar hinein
    const mitNode = mcpAusUmgebung({ MCP_BROWSER: "aus" }, { zim: ["/daten/zim/w.zim"], kiwixServe: serve, node: "/opt/node22/bin/node", heim: "/home/n" });
    assert.ok("server" in mitNode && mitNode.server[0]!.nurLesbar.some((b) => b.quelle === "/opt/node22" && b.ziel === "/opt/node22"));
    // Hermes bekommt ihn neben Freedom-MCP, mit genau diesen Werkzeugen
    const k = JSON.parse(hermesKonfiguration("coder:7b", [s], "ab".repeat(32))) as { mcp_servers: Record<string, { command?: string; args?: string[]; tools?: { include?: string[] } }> };
    assert.deepEqual(Object.keys(k.mcp_servers), ["freedom", "kiwix"]);
    assert.deepEqual(k.mcp_servers.kiwix?.tools?.include, ["search", "read"]);
    assert.equal(k.mcp_servers.kiwix?.args?.[0], `${KIWIX_IN_SANDBOX}/kiwix-bruecke.mjs`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKd2a: ohne ZIM kein Kiwix, MCP_KIWIX=aus schaltet ab, ohne kiwix-serve läuft der Motor ohne; nie zu weit", () => {
  const serve = KIWIX_SERVE;
  const o = { kiwixServe: "/gibt/es/nicht/kiwix-serve", node: "/usr/bin/node", heim: "/home/n", playwright: null };
  // ohne ZIM-Dateien in mcp.json: kein Server, kein Hinweis
  assert.deepEqual(mcpAusUmgebung({ MCP_BROWSER: "aus", MCP_JUPYTER: "aus" }, { ...o, zim: [] }), { server: [], fehlt: [] });
  assert.deepEqual(mcpAusUmgebung({ MCP_BROWSER: "aus", MCP_JUPYTER: "aus" }, { ...o }), { server: [], fehlt: [] });
  // aus: nichts, auch ohne kiwix-serve
  assert.deepEqual(mcpAusUmgebung({ MCP_BROWSER: "aus", MCP_KIWIX: "aus", MCP_JUPYTER: "aus" }, { ...o, zim: ["/daten/zim/w.zim"] }), { server: [], fehlt: [] });
  // anderes als „aus“: kein Start – die ZIM-Dateien stehen nur in mcp.json
  for (const falsch of ["an", "/daten/zim/w.zim", "1"]) assert.ok("ungueltig" in mcpAusUmgebung({ MCP_BROWSER: "aus", MCP_KIWIX: falsch }, { ...o, zim: ["/daten/zim/w.zim"] }), falsch);
  // ohne kiwix-serve: der Motor läuft ohne, das Log nennt das Paket – der Browser bleibt davon unberührt
  const ohne = mcpAusUmgebung({ MCP_JUPYTER: "aus" }, { ...o, zim: ["/daten/zim/w.zim"], orte: [] });
  assert.deepEqual(ohne, { server: [], fehlt: ["mcp.playwright-fehlt", "mcp.browser-fehlt", "mcp.kiwix-fehlt"] });
  assert.match(MCP_TEXT["mcp.kiwix-fehlt"], /kiwix-tools/);
  // nie die Wurzel oder das Home einbinden – auch nicht über Node oder kiwix-serve
  if (existsSync(serve)) {
    for (const [fall, w] of [
      ["Node in der Wurzel", { node: "/bin/node", zim: ["/daten/zim/w.zim"] }],
      ["Node im Home", { node: "/home/n/bin/node", zim: ["/daten/zim/w.zim"] }],
      ["ZIM relativ", { node: "/usr/bin/node", zim: ["daten/w.zim"] }],
      ["ZIM mit ..", { node: "/usr/bin/node", zim: ["/daten/../w.zim"] }],
      ["ZIM in der Wurzel", { node: "/usr/bin/node", zim: ["/w.zim"] }],
    ] as const) assert.ok("ungueltig" in mcpAusUmgebung({ MCP_BROWSER: "aus" }, { ...o, kiwixServe: serve, ...w }), fall);
  }
  // verdrahtet: der Motor bekommt die ZIM-Dateien aus mcp.json
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /mcpAusUmgebung\(process\.env, \{ zim: mcpServerWahl\.server\.flatMap\(\(s\) => s\.zim \?\? \[\]\) \}\)/);
  assert.ok(main.indexOf("const mcpServerWahl = mcpAusDatei()") < main.indexOf("mcpAusUmgebung(process.env"), "mcp.json zuerst gelesen");
});

test("VKd2a (bubblewrap, kiwix-serve): Kiwix in der Sandbox des Motors – suchen und lesen ohne Netz", { skip: ohneSandbox, timeout: 90_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-kiwix-motor-"));
  const zim = probeZim(d);
  const wahl = mcpAusUmgebung({ MCP_BROWSER: "aus" }, { zim: [zim] });
  assert.ok("server" in wahl);
  const s = wahl.server[0]!;
  const projekt = mkdtempSync(join(tmpdir(), "freedom-kiwix-projekt-"));
  // wie Hermes: der Server als Kind in der Sandbox des Motors, MCP über stdio
  const m = sandboxMotor([s.befehl, ...s.argumente], { nurLesbar: s.nurLesbar })(projekt);
  const strom = m.strom as Stream;
  const schreiber = strom.writable.getWriter();
  const leser = strom.readable.getReader();
  let nr = 0;
  const frage = async (method: string, params: object): Promise<{ result?: Record<string, unknown>; error?: unknown }> => {
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
    assert.equal((init.result?.serverInfo as { name: string } | undefined)?.name, "freedom-kiwix", JSON.stringify(init.error));
    await schreiber.write({ jsonrpc: "2.0", method: "notifications/initialized" } as never);
    assert.deepEqual(((await frage("tools/list", {})).result?.tools as Array<{ name: string }>).map((t) => t.name), [...s.werkzeuge]);
    assert.match(text(await frage("tools/call", { name: "search", arguments: { query: "Funktechnik" } })), /LoRa – .*path: probe\/Lora\.html/s);
    assert.match(text(await frage("tools/call", { name: "read", arguments: { path: "probe/Lora.html" } })), /LoRa ist eine Funktechnik mit großer Reichweite\./);
  } finally {
    m.beende();
    rmSync(projekt, { recursive: true, force: true });
    rmSync(d, { recursive: true, force: true });
  }
});
