/**
 * VKd2c: Sprache für den Motor – `transcribe_audio` über Freedom-MCP, nur mit Whisper. Der Knoten liest die WAV-Datei selbst
 * aus dem Ordner des Projekts (nur eine echte Datei, begrenzt, genau die Form von `pruefeWav()`), Whisper läuft in der Sandbox
 * (hier ein nachgebautes `whisper-cli` in echtem bubblewrap).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPRACHE_GRENZEN, baueWav, type SpracheWahl } from "@freedomstack/protocol";
import { LeseFreigaben, mcpAntwort } from "../src/freedom-mcp.js";
import { pruefeSandbox } from "../src/sandbox.js";
import { TON_BYTES, TON_FORM, leseTonImProjekt, tonPfad, transkribiereImProjekt } from "../src/sprache-motor.js";
import type { ToolCall, ToolResult } from "../src/tools.js";
import { SpracheAbgelehnt, Whisper } from "../src/whisper.js";

const sinus = (sekunden: number) => baueWav(Int16Array.from({ length: sekunden * SPRACHE_GRENZEN.abtastrate }, (_, i) => Math.round(9000 * Math.sin(i / 7))));

test("VKd2c: Pfade im Projekt – relativ oder unter /arbeit, nie absolut woanders, nie .., nie versteckt", () => {
  assert.deepEqual(tonPfad("aufnahme.wav"), ["aufnahme.wav"]);
  assert.deepEqual(tonPfad(" ton/notiz.wav "), ["ton", "notiz.wav"]);
  assert.deepEqual(tonPfad("/arbeit/ton/notiz.wav"), ["ton", "notiz.wav"]);
  for (const p of ["", "/etc/passwd", "../x.wav", "ton/../../x.wav", ".git/x.wav", "ton/.versteckt.wav", "ton//x.wav", "ton/", "a\\b.wav", "a\0.wav", "/arbeit/", "x".repeat(501)]) {
    assert.equal(tonPfad(p), null, JSON.stringify(p));
  }
  assert.equal(TON_BYTES, 44 + 120 * 16_000 * 2, "Kopf und der längste erlaubte Ton");
  assert.equal(TON_FORM, "WAV, 16 kHz, mono, 16-bit PCM, at most 120 seconds");
});

test("VKd2c: den Ton liest der Knoten nur als echte Datei im Projekt – kein Verweis, kein Ordner, kein FIFO, begrenzt, genau die Form", () => {
  const d = mkdtempSync(join(tmpdir(), "vkd2c-"));
  try {
    const ort = join(d, "projekt");
    mkdirSync(join(ort, "ton"), { recursive: true });
    const gut = sinus(1);
    writeFileSync(join(ort, "ton", "notiz.wav"), gut);
    writeFileSync(join(d, "draussen.wav"), gut);
    const ok = leseTonImProjekt(ort, "ton/notiz.wav");
    assert.ok("ton" in ok && Buffer.from(ok.ton).equals(Buffer.from(gut)));
    assert.ok("ton" in leseTonImProjekt(ort, "/arbeit/ton/notiz.wav"));
    // Verweise: auf die Datei, auf einen Ordner im Pfad – der Agent legt sie in der Sandbox an, auch auf ~/.freedom
    symlinkSync(join(d, "draussen.wav"), join(ort, "verweis.wav"));
    symlinkSync(d, join(ort, "ordner"));
    mkdirSync(join(ort, "leer.wav"));
    execFileSync("mkfifo", [join(ort, "fifo.wav")]);
    writeFileSync(join(ort, "text.wav"), "kein Ton");
    writeFileSync(join(ort, "lang.wav"), Buffer.alloc(TON_BYTES + 1));
    const anders = Buffer.from(sinus(1));
    anders.writeUInt32LE(44_100, 24); // andere Abtastrate
    writeFileSync(join(ort, "anders.wav"), anders);
    writeFileSync(join(ort, "still.wav"), baueWav(new Int16Array(0)));
    const fehlt = "no such audio file in the project (symbolic links are not followed)";
    for (const [pfad, text] of [
      ["verweis.wav", fehlt], ["ordner/draussen.wav", fehlt], ["leer.wav", fehlt], ["fifo.wav", fehlt], ["gibts-nicht.wav", fehlt],
      ["text.wav", `not the required form – ${TON_FORM}`], ["anders.wav", `not the required form – ${TON_FORM}`],
      ["lang.wav", `audio too long – ${TON_FORM}`], ["still.wav", "the audio file is empty"],
      ["../draussen.wav", "path: a file in the project, e.g. audio/note.wav (no hidden parts, no ..)"],
    ] as const) {
      assert.deepEqual(leseTonImProjekt(ort, pfad), { fehler: text }, pfad);
    }
    assert.deepEqual(leseTonImProjekt(join(d, "fehlt"), "ton/notiz.wav"), { fehler: fehlt }, "ohne Projektordner");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VKd2c: Freedom-MCP nennt transcribe_audio nur mit Whisper – Pfad und Sprache gehen an das Projekt, nie an die ToolRegistry", async () => {
  const gesehen: ToolCall[] = [];
  const w = { run: async (c: ToolCall): Promise<ToolResult> => (gesehen.push(c), { name: c.name, output: "x", ok: true, durationMs: 0 }) };
  const frei = new LeseFreigaben();
  const gefragt: Array<[string, SpracheWahl]> = [];
  const ton = async (pfad: string, sprache: SpracheWahl) => (gefragt.push([pfad, sprache]), { ok: true, output: "Hallo Welt" });
  const anfrage = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
  type Liste = { result: { tools: Array<{ name: string; description: string; inputSchema: { required: string[]; properties: Record<string, { enum?: string[] }> } }> } };
  const namen = async (t?: typeof ton) => ((await mcpAntwort(anfrage(1, "tools/list"), w, frei, undefined, t)) as Liste).result.tools;
  assert.deepEqual((await namen()).map((t) => t.name), ["web_search", "read_page"]);
  const mit = await namen(ton);
  assert.deepEqual(mit.map((t) => t.name), ["web_search", "read_page", "transcribe_audio"]);
  assert.deepEqual(mit[2]!.inputSchema.required, ["path"]);
  assert.deepEqual(mit[2]!.inputSchema.properties.language!.enum, ["de", "en", "auto"]);
  assert.ok(mit[2]!.description.includes(TON_FORM), "die verlangte Form steht in der Beschreibung");
  const ruf = async (id: number, args: unknown) => mcpAntwort(anfrage(id, "tools/call", { name: "transcribe_audio", arguments: args }), w, frei, undefined, ton);
  const r = (await ruf(2, { path: "ton/notiz.wav" })) as { result: { content: Array<{ text: string }>; isError: boolean } };
  assert.deepEqual([r.result.isError, r.result.content[0]!.text], [false, "Hallo Welt"]);
  await ruf(3, { path: "/arbeit/b.wav", language: "de" });
  assert.deepEqual(gefragt, [["ton/notiz.wav", "auto"], ["/arbeit/b.wav", "de"]], "ohne Angabe rät Whisper die Sprache");
  for (const args of [{}, { path: " " }, { path: 7 }, { path: "a.wav", language: "fr" }, null]) {
    assert.equal(((await ruf(4, args)) as { error: { code: number } }).error.code, -32602, JSON.stringify(args));
  }
  assert.equal(gefragt.length, 2, "ohne gültige Angaben nichts gefragt");
  assert.equal(((await mcpAntwort(anfrage(5, "tools/call", { name: "transcribe_audio", arguments: { path: "a.wav" } }), w, frei)) as { error: { message: string } }).error.message,
    "unknown tool", "ohne Whisper gibt es das Werkzeug nicht");
  assert.deepEqual(gesehen, [], "nichts davon über die ToolRegistry");
});

/** Ein `whisper-cli` zum Prüfen – prüft die Argumente, liest den Ton und schreibt den Text (Sprache „auto“). */
function attrappe(ordner: string): string {
  const cli = join(ordner, "whisper-cli");
  writeFileSync(cli, [
    "#!/bin/sh",
    `[ "$*" = "-m /modell/whisper.bin -f /arbeit/ton.wav -l auto -t 1 -nt -np -otxt -of /arbeit/text -ng" ] || exit 7`,
    `[ "$(head -c 4 /arbeit/ton.wav)" = "RIFF" ] || exit 8`,
    `printf ' Hallo aus dem Projekt. \\n' > /arbeit/text.txt`, "",
  ].join("\n"));
  chmodSync(cli, 0o755);
  return cli;
}

test("VKd2c: Ende zu Ende – eine WAV im Projekt wird in der Sandbox zu Text, das Projekt bleibt, wie es war; Ablehnungen nur als feste Texte", async (t) => {
  if (!(await pruefeSandbox()).ok) return t.skip("bubblewrap geht hier nicht");
  const d = mkdtempSync(join(tmpdir(), "vkd2c-echt-"));
  const basis = mkdtempSync(join(tmpdir(), "vkd2c-arbeit-"));
  try {
    const modell = join(d, "ggml.bin");
    writeFileSync(modell, "modell");
    const ort = join(d, "projekt");
    mkdirSync(join(ort, "ton"), { recursive: true });
    writeFileSync(join(ort, "ton", "notiz.wav"), sinus(1));
    const whisper = new Whisper({ cli: attrappe(d), modell, gpu: false, threads: 1, fristSek: 20 }, basis);
    assert.deepEqual(await transkribiereImProjekt(whisper, ort, "ton/notiz.wav", "auto"), { ok: true, output: "Hallo aus dem Projekt." });
    assert.deepEqual(readdirSync(ort), ["ton"], "nichts dazugekommen");
    assert.deepEqual(readdirSync(join(ort, "ton")), ["notiz.wav"]);
    assert.deepEqual(readdirSync(basis), [], "Ton und Text sind nach dem Auftrag weg");
    // was die Attrappe nicht durchlässt („de“ statt „auto“), endet als fester Text – nie der Fehler selbst
    assert.deepEqual(await transkribiereImProjekt(whisper, ort, "ton/notiz.wav", "de"), { ok: false, output: "speech recognition failed" });
    // belegt und zu lang: feste Texte
    const belegt = { transkribiere: async () => { throw new SpracheAbgelehnt("sprache-belegt"); } };
    assert.deepEqual(await transkribiereImProjekt(belegt, ort, "ton/notiz.wav", "auto"), { ok: false, output: "speech recognition is busy – try again in a minute" });
    const zeit = { transkribiere: async () => { throw new SpracheAbgelehnt("sprache-zeit"); } };
    assert.deepEqual(await transkribiereImProjekt(zeit, ort, "ton/notiz.wav", "auto"), { ok: false, output: "speech recognition took too long" });
    const fremd = { transkribiere: async () => { throw new Error("/home/x/geheim.wav kaputt"); } };
    assert.deepEqual(await transkribiereImProjekt(fremd, ort, "ton/notiz.wav", "auto"), { ok: false, output: "speech recognition failed" });
    // ein Ton ohne Sprache: kein leerer Text
    const leer = { transkribiere: async () => "" };
    assert.deepEqual(await transkribiereImProjekt(leer, ort, "ton/notiz.wav", "auto"), { ok: true, output: "(no speech recognized)" });
    // eine falsche Datei erreicht Whisper nie
    let gerufen = 0;
    const zaehlt = { transkribiere: async () => (gerufen++, "x") };
    writeFileSync(join(ort, "text.wav"), "kein Ton");
    assert.equal((await transkribiereImProjekt(zaehlt, ort, "text.wav", "auto")).ok, false);
    assert.equal(gerufen, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(basis, { recursive: true, force: true });
  }
});

test("VKd2c: verdrahtet – main.ts gibt transcribe_audio nur mit bereitem Whisper und dem Ordner des Projekts", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const w = sprache\?\.bereit\(\) \? sprache : undefined;/);
  assert.match(main, /transkribiereImProjekt\(w, projekte\.ort\(p\.projekt\), pfad, spr\)/);
  assert.match(main, /mcpAntwort\(n, werkzeuge, p\.freigaben, bild, ton\)/);
});
