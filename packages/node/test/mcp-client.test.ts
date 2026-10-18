/**
 * B-31a: eigener MCP-Client im Knoten (MC1-Größe B, 18.10.2026) – Server nur aus `~/.freedom/mcp.json`, nur in der
 * Sandbox, Werkzeuge in den Grenzen jedes Werkzeugs. Der echte Test startet eine Attrappe (Python) in bubblewrap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OllamaBackend } from "../src/inference.js";
import { McpWerkzeuge, mcpAusDatei, starteMcpServer, type McpVerbindung } from "../src/mcp-client.js";
import { pruefeSandbox } from "../src/sandbox.js";
import { WERKZEUG_GRENZEN } from "../src/tools.js";

const ATTRAPPE = fileURLToPath(new URL("./fixtures/mcp-attrappe.py", import.meta.url));

test("B-31a: mcp.json – ohne Datei keine Server, kaputt oder unzulässig heißt kein Start", () => {
  const d = mkdtempSync(join(tmpdir(), "freedom-mcp-json-"));
  const datei = join(d, "mcp.json");
  const heim = "/home/n";
  const mit = (inhalt: unknown) => { writeFileSync(datei, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt)); return mcpAusDatei(datei, heim); };
  try {
    assert.deepEqual(mcpAusDatei(join(d, "gibt-es-nicht.json"), heim), { server: [] });
    assert.deepEqual(mit({ server: { kiwix: { befehl: ["/usr/bin/python3", "/opt/mcp/kiwix.py"], nurLesbar: ["/opt/mcp", "/daten/zim"] } } }),
      { server: [{ name: "kiwix", befehl: ["/usr/bin/python3", "/opt/mcp/kiwix.py"], nurLesbar: ["/opt/mcp", "/daten/zim"] }] });
    assert.deepEqual(mit({ server: { a: { befehl: ["/opt/mcp/a/bin/server"] } } }), { server: [{ name: "a", befehl: ["/opt/mcp/a/bin/server"], nurLesbar: [] }] });
    const falsch: Array<[string, unknown]> = [
      ["kein JSON", "{"],
      ["server fehlt", {}],
      ["server als Liste", { server: [] }],
      ["Name groß", { server: { Kiwix: { befehl: ["/usr/bin/x"] } } }],
      ["Name zu lang", { server: { ["a".repeat(21)]: { befehl: ["/usr/bin/x"] } } }],
      ["Befehl fehlt", { server: { a: {} } }],
      ["Befehl relativ", { server: { a: { befehl: ["python3"] } } }],
      ["Befehl mit ..", { server: { a: { befehl: ["/usr/../bin/x"] } } }],
      ["Befehl leer", { server: { a: { befehl: [] } } }],
      ["Wurzel", { server: { a: { befehl: ["/usr/bin/x"], nurLesbar: ["/"] } } }],
      ["über dem Home", { server: { a: { befehl: ["/usr/bin/x"], nurLesbar: ["/home"] } } }],
      ["das Home", { server: { a: { befehl: ["/usr/bin/x"], nurLesbar: ["/home/n"] } } }],
      ["~/.freedom", { server: { a: { befehl: ["/usr/bin/x"], nurLesbar: ["/home/n/.freedom/zim"] } } }],
      ["Programm direkt im Home", { server: { a: { befehl: ["/home/n/server"] } } }],
      ["zu viele Server", { server: Object.fromEntries(["a", "b", "c", "d", "e"].map((n) => [n, { befehl: ["/usr/bin/x"] }])) }],
    ];
    for (const [fall, inhalt] of falsch) assert.ok("ungueltig" in mit(inhalt), fall);
    // ein Verweis auf ~/.freedom zählt wie ~/.freedom – auch als Ordner des Programms
    const echtesHeim = join(d, "heim");
    mkdirSync(join(echtesHeim, ".freedom"), { recursive: true });
    symlinkSync(join(echtesHeim, ".freedom"), join(d, "zim"));
    writeFileSync(datei, JSON.stringify({ server: { a: { befehl: ["/usr/bin/x"], nurLesbar: [join(d, "zim")] } } }));
    assert.ok("ungueltig" in mcpAusDatei(datei, echtesHeim), "Verweis auf ~/.freedom");
    writeFileSync(datei, JSON.stringify({ server: { a: { befehl: [join(d, "zim", "server")] } } }));
    assert.ok("ungueltig" in mcpAusDatei(datei, echtesHeim), "Programm hinter einem Verweis auf ~/.freedom");
    mkdirSync(join(d, "daten"));
    writeFileSync(datei, JSON.stringify({ server: { a: { befehl: ["/usr/bin/x"], nurLesbar: [join(d, "daten")] } } }));
    assert.ok("server" in mcpAusDatei(datei, echtesHeim), "ein echter Ordner daneben geht");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

/** Eine Verbindung ohne Server – für die Grenzen. */
function attrappe(rufe: McpVerbindung["rufe"], lebt = true): McpVerbindung {
  return { lebt, rufe, schliesse: () => {} } as unknown as McpVerbindung;
}

test("B-31a: Werkzeuge fürs Modell – Name mit Server, Grenzen wie jedes Werkzeug, Fehler nur als feste Texte", async () => {
  const aufrufe: string[] = [];
  const kasten = new McpWerkzeuge({ zeitMs: 50 });
  kasten.nimm("wiki", attrappe(async (name, args) => {
    aufrufe.push(name);
    if (name === "suche") return { text: `treffer zu ${String(args.q)} ${"x".repeat(WERKZEUG_GRENZEN.ausgabeZeichen)}`, fehler: false };
    if (name === "kaputt") return { text: "intern: /home/n/geheim", fehler: true };
    if (name === "langsam") throw Object.assign(new Error("Zeit um"), { name: "McpZeit" });
    throw Object.assign(new Error("Server beendet: /pfad"), { name: "McpBeendet" });
  }), [
    { name: "suche", beschreibung: "Sucht im Wiki.", schema: { type: "object", properties: { q: { type: "string" } } } },
    { name: "kaputt", beschreibung: "", schema: { type: "object" } },
    { name: "langsam", beschreibung: "", schema: { type: "object" } },
    { name: "weg", beschreibung: "", schema: { type: "object" } },
  ]);
  kasten.nimm("tot", attrappe(async () => ({ text: "", fehler: false }), false), [{ name: "x", beschreibung: "", schema: { type: "object" } }]);
  // mcp__ + 20 + __ + 40 = 67 Zeichen – OpenAI-kompatible Dienste nehmen höchstens 64
  kasten.nimm("a".repeat(20), attrappe(async () => ({ text: "", fehler: false })), [
    { name: "b".repeat(40), beschreibung: "", schema: { type: "object" } },
    { name: "b".repeat(37), beschreibung: "", schema: { type: "object" } },
  ]);
  assert.ok(!kasten.kennt(`mcp__${"a".repeat(20)}__${"b".repeat(40)}`), "Name über 64 Zeichen bleibt weg");
  assert.ok(kasten.kennt(`mcp__${"a".repeat(20)}__${"b".repeat(37)}`), "64 Zeichen gehen");
  assert.equal(`mcp__${"a".repeat(20)}__${"b".repeat(37)}`.length, 64);
  assert.deepEqual(kasten.schemas().map((s) => s.function.name), ["mcp__wiki__suche", "mcp__wiki__kaputt", "mcp__wiki__langsam", "mcp__wiki__weg", `mcp__${"a".repeat(20)}__${"b".repeat(37)}`], "ein beendeter Server bietet nichts an");
  assert.deepEqual(kasten.schemas()[0]!.function.parameters, { type: "object", properties: { q: { type: "string" } } });
  const treffer = await kasten.fuehreAus("mcp__wiki__suche", { q: "Linz" });
  assert.ok(treffer.startsWith("treffer zu Linz"));
  assert.equal(treffer.length, WERKZEUG_GRENZEN.ausgabeZeichen, "Ausgabe gekürzt");
  assert.equal(await kasten.fuehreAus("mcp__wiki__kaputt", {}), "Fehler des Werkzeugs: intern: /home/n/geheim");
  assert.equal(await kasten.fuehreAus("mcp__wiki__langsam", {}), "Zeitlimit 0 s überschritten");
  assert.equal(await kasten.fuehreAus("mcp__wiki__weg", {}), "Werkzeug nicht erreichbar", "nie der Text des Fehlers");
  assert.equal(await kasten.fuehreAus("mcp__tot__x", {}), "Werkzeug nicht erreichbar");
  assert.equal(await kasten.fuehreAus("mcp__wiki__gibtsnicht", {}), "Werkzeug unbekannt");
  const vorher = aufrufe.length;
  assert.match(await kasten.fuehreAus("mcp__wiki__suche", { q: "x".repeat(WERKZEUG_GRENZEN.eingabeZeichen) }), /Eingabe zu lang/);
  assert.equal(aufrufe.length, vorher, "zu lange Eingaben erreichen den Server nicht");
});

test("B-31a: die Agenten-Schleife bietet MCP-Werkzeuge an und gibt ihr Ergebnis dem Modell zurück", async () => {
  const kasten = new McpWerkzeuge();
  kasten.nimm("wiki", attrappe(async (_n, args) => ({ text: `Linz liegt an der Donau (${String(args.q)})`, fehler: false })),
    [{ name: "suche", beschreibung: "Sucht im Wiki.", schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }]);
  const backend = new OllamaBackend("http://127.0.0.1:1", "test:1b");
  backend.mcp = kasten;
  const anfragen: Array<{ messages: Array<{ role: string; content?: string }>; tools?: Array<{ function: { name: string } }> }> = [];
  const alt = globalThis.fetch;
  globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
    anfragen.push(JSON.parse(String(init?.body)));
    const erste = anfragen.length === 1;
    return new Response(JSON.stringify({
      message: erste
        ? { role: "assistant", content: "", tool_calls: [{ function: { name: "mcp__wiki__suche", arguments: { q: "Linz" } } }] }
        : { role: "assistant", content: "An der Donau." },
      prompt_eval_count: 1, eval_count: 1,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const r = await backend.complete({ jobId: "j", prompt: "Wo liegt Linz?" });
    assert.equal(r.output, "An der Donau.");
  } finally {
    globalThis.fetch = alt;
  }
  assert.ok(anfragen[0]!.tools!.some((t) => t.function.name === "mcp__wiki__suche"));
  assert.match(anfragen[0]!.messages[0]!.content!, /mcp__wiki__suche/, "der Systemprompt nennt das Werkzeug");
  assert.ok(anfragen[1]!.messages.some((m) => m.role === "tool" && m.content === "Linz liegt an der Donau (Linz)"));
  // ohne Werkzeuge (gratis, G1) auch keine von MCP
  globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
    anfragen.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message: { role: "assistant", content: "ok" } }), { status: 200 });
  }) as typeof fetch;
  try {
    await backend.complete({ jobId: "j2", prompt: "x", ohneWerkzeuge: true });
  } finally {
    globalThis.fetch = alt;
  }
  assert.equal(anfragen.at(-1)!.tools, undefined);
});

test("B-31a: verdrahtet – main.ts startet die Server aus mcp.json nur mit Sandbox und gibt sie der Agenten-Schleife", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const mcpServerWahl = mcpAusDatei\(\);\n\s+if \("ungueltig" in mcpServerWahl\) \{\n[^\n]+\n\s+process\.exit\(1\);/, "ungültig → kein Start");
  assert.match(main, /const sandbox = await pruefeSandbox\(\);\n\s+if \(!sandbox\.ok\) console\.log\(`\[werkzeuge\] MCP-Server aus/, "ohne Sandbox kein Server");
  assert.match(main, /await starteMcpServer\(s\)/);
  assert.match(main, /if \(kasten\.anzahl > 0\) backend\.mcp = kasten;/);
  const modul = readFileSync(new URL("../src/mcp-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(modul, /console\./, "das Modul schreibt nichts ins Log – Werkzeug-Ein- und Ausgaben sind Inhalt einer Anfrage");
  assert.doesNotMatch(modul, /from "node:child_process"/, "Server nur über sandboxMotor()");
  assert.match(readFileSync(new URL("../src/pruefen.ts", import.meta.url), "utf8"), /mcpAusDatei\(\)/);
});

const pruefung = await pruefeSandbox();
const ohne = (!pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`) || (!existsSync("/usr/bin/python3") && "python3 fehlt");

test("B-31a (bubblewrap): ein echter Server in der Sandbox – Seiten, unzulässige Namen weg, kein Netz, Zeitlimit", { skip: ohne, timeout: 60_000 }, async () => {
  const s = await starteMcpServer({ name: "test", befehl: ["/usr/bin/python3", ATTRAPPE], nurLesbar: [dirname(ATTRAPPE)] });
  const kasten = new McpWerkzeuge({ zeitMs: 1500 });
  try {
    assert.deepEqual(s.werkzeuge.map((w) => w.name), ["echo", "lang", "kaputt", "schlaf", "netz", "bild"], "beide Seiten, ohne den unzulässigen Namen");
    kasten.nimm("test", s.verbindung, s.werkzeuge);
    assert.equal(await kasten.fuehreAus("mcp__test__echo", { text: "hallo" }), "hallo");
    assert.equal((await kasten.fuehreAus("mcp__test__lang", {})).length, WERKZEUG_GRENZEN.ausgabeZeichen);
    assert.equal(await kasten.fuehreAus("mcp__test__kaputt", {}), "Fehler des Werkzeugs: geht nicht");
    assert.equal(await kasten.fuehreAus("mcp__test__bild", {}), "vorher\n[image]");
    assert.equal(await kasten.fuehreAus("mcp__test__netz", {}), "kein-netz", "die Sandbox hat kein Netz");
    assert.equal(await kasten.fuehreAus("mcp__test__schlaf", {}), "Zeitlimit 2 s überschritten");
  } finally {
    kasten.schliesse();
  }
  assert.equal(await kasten.fuehreAus("mcp__test__echo", { text: "x" }), "Werkzeug nicht erreichbar");
  assert.deepEqual(kasten.schemas(), [], "ein beendeter Server bietet nichts mehr an");
});
