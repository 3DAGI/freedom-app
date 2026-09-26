/**
 * Schritt 8.7 – Abnahme: jedes Werkzeug hat einen Sandbox- und einen
 * SSRF-Test. Ohne Netz: Namensaufloesung und fremde Server sind nachgebildet
 * (austauschbares `aufloesen`, `fetch` im Test ersetzt, ein lokaler
 * ComfyUI-Ersatz fuer Bild und Video).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile, mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_DVM_BROWSER, KIND_DVM_FILE_IO, KIND_DVM_IMAGE_GEN, KIND_DVM_VIDEO_GEN, KIND_DVM_WEB_SEARCH,
} from "@freedomstack/protocol";
import {
  BrowserExecutor, FileIoExecutor, ImageGenExecutor, ToolRegistry, VideoGenExecutor, WERKZEUG_GRENZEN, WebSearchExecutor,
  type ToolExecutor,
} from "../src/tools.js";

const OEFFENTLICH = async () => ["93.184.215.14"];
const echtesFetch = globalThis.fetch;

/** fetch im Test ersetzen; merkt sich jede angefragte URL. */
function mitFetch(antwort: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  globalThis.fetch = (async (u: string | URL | Request) => {
    const url = String(u instanceof Request ? u.url : u);
    urls.push(url);
    return antwort(url);
  }) as typeof fetch;
  return { urls, zurueck: () => { globalThis.fetch = echtesFetch; } };
}

function registry(ex: ToolExecutor, grenzen = { zeitMs: 2000, zeitMsMedien: 12_000 }) {
  const r = new ToolRegistry(grenzen);
  r.register(ex);
  return r;
}

// ------------------------------------------------------------------ web_search

test("web_search SSRF: nur api.duckduckgo.com, die Anfrage waehlt kein Ziel; privat aufgeloest wird abgelehnt", async () => {
  const f = mitFetch(() => new Response(JSON.stringify({ Heading: "H", AbstractText: "A" }), { headers: { "content-type": "application/json" } }));
  try {
    const r = await registry(new WebSearchExecutor({ aufloesen: OEFFENTLICH })).run({ kind: KIND_DVM_WEB_SEARCH, name: "web_search", input: "x&url=http://169.254.169.254/@127.0.0.1" });
    assert.equal(r.ok, true);
    assert.equal(f.urls.length, 1);
    assert.equal(new URL(f.urls[0]!).hostname, "api.duckduckgo.com");
    assert.equal(new URL(f.urls[0]!).searchParams.get("q"), "x&url=http://169.254.169.254/@127.0.0.1", "als Text kodiert");
    const privat = await registry(new WebSearchExecutor({ aufloesen: async () => ["127.0.0.1"] })).run({ kind: KIND_DVM_WEB_SEARCH, name: "web_search", input: "x" });
    assert.equal(privat.ok, false);
    assert.match(privat.output, /privaten Bereich/);
    assert.equal(f.urls.length, 1, "kein zweiter Abruf");
  } finally { f.zurueck(); }
});

test("web_search Sandbox: riesige Antwort wird nicht ganz gelesen, haengende Antwort endet am Zeitlimit", async () => {
  let gelesen = 0;
  const f = mitFetch(() => new Response(new ReadableStream({
    pull(c) { gelesen += 65536; c.enqueue(new Uint8Array(65536).fill(123)); if (gelesen > 20_000_000) c.close(); },
  })));
  try {
    const r = await registry(new WebSearchExecutor({ aufloesen: OEFFENTLICH })).run({ kind: KIND_DVM_WEB_SEARCH, name: "web_search", input: "x" });
    assert.equal(r.ok, false);
    assert.ok(gelesen <= WERKZEUG_GRENZEN.abrufBytes + 3 * 65536, `gelesen ${gelesen}`);
  } finally { f.zurueck(); }
  const h = mitFetch(() => new Promise<Response>(() => undefined));
  try {
    const t0 = Date.now();
    const r = await registry(new WebSearchExecutor({ aufloesen: OEFFENTLICH }), { zeitMs: 300, zeitMsMedien: 300 }).run({ kind: KIND_DVM_WEB_SEARCH, name: "web_search", input: "x" });
    assert.equal(r.ok, false);
    assert.match(r.output, /zeitlimit/);
    assert.ok(Date.now() - t0 < 2000);
  } finally { h.zurueck(); }
});

// ------------------------------------------------------------------- file_io

async function mitWorkspace<T>(fn: (ws: string, draussen: string) => Promise<T>): Promise<T> {
  const basis = await mkdtemp(join(tmpdir(), "freedom-wz-"));
  const ws = join(basis, "ws");
  const draussen = join(basis, "draussen");
  await mkdir(ws);
  await mkdir(draussen);
  await writeFile(join(draussen, "geheim.txt"), "Betreiber-Geheimnis");
  try { return await fn(ws, draussen); } finally { await rm(basis, { recursive: true, force: true }); }
}

test("file_io Sandbox: kein Weg aus dem Workspace ueber Symlinks, Groessen begrenzt, nur Dateien", async () => {
  await mitWorkspace(async (ws, draussen) => {
    await symlink(join(draussen, "geheim.txt"), join(ws, "link.txt"));
    await symlink(draussen, join(ws, "ordner"));
    const r = registry(new FileIoExecutor(ws));
    const lauf = (input: string) => r.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input });
    for (const input of ["read link.txt", "read ordner/geheim.txt", "write link.txt boese", "write ordner/neu.txt boese"]) {
      const x = await lauf(input);
      assert.equal(x.ok, false, input);
      assert.ok(!x.output.includes("Betreiber-Geheimnis"), input);
    }
    assert.equal(await readFile(join(draussen, "geheim.txt"), "utf8"), "Betreiber-Geheimnis", "draussen unveraendert");
    assert.match((await lauf(`write gross.txt ${"x".repeat(WERKZEUG_GRENZEN.eingabeZeichen)}`)).output, /eingabe zu lang/, "abgelehnt, nicht halb geschrieben");
    await writeFile(join(ws, "riesig.txt"), "y".repeat(WERKZEUG_GRENZEN.dateiBytes + 1));
    assert.match((await lauf("read riesig.txt")).output, /zu gross/);
    await mkdir(join(ws, "unter"));
    assert.match((await lauf("read unter")).output, /keine datei/);
    assert.equal((await lauf("write ok.txt hallo")).ok, true);
    assert.equal((await lauf("read ok.txt")).output, "hallo");
  });
});

test("file_io SSRF: eine URL als Pfad wird nie abgerufen", async () => {
  await mitWorkspace(async (ws) => {
    const f = mitFetch(() => new Response("nie"));
    try {
      const r = await registry(new FileIoExecutor(ws)).run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read http://169.254.169.254/latest/meta-data" });
      assert.equal(r.ok, false);
      assert.equal(f.urls.length, 0);
    } finally { f.zurueck(); }
  });
});

// --------------------------------------------------------------- browser_use

test("browser_use SSRF: private Ziele, Metadaten, Weiterleitung nach innen, Zugangsdaten – alles abgelehnt", async () => {
  const f = mitFetch((url) => url.startsWith("https://umleitung.example")
    ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1:11434/api/tags" } })
    : new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }));
  try {
    const r = registry(new BrowserExecutor(undefined, { aufloesen: OEFFENTLICH }));
    for (const input of ["http://127.0.0.1:11434/api/tags", "http://169.254.169.254/latest/meta-data", "http://[::1]:8080/", "file:///etc/passwd", "https://nutzer:pw@example.org/", "https://umleitung.example/"]) {
      const x = await r.run({ kind: KIND_DVM_BROWSER, name: "browser_use", input });
      assert.equal(x.ok, false, input);
    }
    assert.ok(!f.urls.some((u) => /127\.0\.0\.1|169\.254|\[::1\]/.test(u)), "nie nach innen abgerufen");
    const privatAufgeloest = registry(new BrowserExecutor(undefined, { aufloesen: async () => ["10.0.0.5"] }));
    assert.equal((await privatAufgeloest.run({ kind: KIND_DVM_BROWSER, name: "browser_use", input: "https://intern.example/" })).ok, false);
  } finally { f.zurueck(); }
});

test("browser_use Sandbox: nur Text, begrenzt gelesen und gekuerzt, Skripte entfernt", async () => {
  const f = mitFetch((url) => url.endsWith("/bild")
    ? new Response(new Uint8Array(10), { headers: { "content-type": "image/png" } })
    : new Response(`<script>alert(1)</script><p>${"Wort ".repeat(500_000)}</p>`, { headers: { "content-type": "text/html; charset=utf-8" } }));
  try {
    const r = registry(new BrowserExecutor(undefined, { aufloesen: OEFFENTLICH }));
    const bild = await r.run({ kind: KIND_DVM_BROWSER, name: "browser_use", input: "https://example.org/bild" });
    assert.equal(bild.ok, false);
    assert.match(bild.output, /kein Text/);
    const text = await r.run({ kind: KIND_DVM_BROWSER, name: "browser_use", input: "https://example.org/lang" });
    assert.equal(text.ok, true);
    assert.ok(text.output.length <= WERKZEUG_GRENZEN.ausgabeZeichen);
    assert.ok(!text.output.includes("alert"));
  } finally { f.zurueck(); }
});

// ------------------------------------------------------- image_gen, video_gen

/** Lokaler ComfyUI-Ersatz: merkt sich Pfade und Workflows. */
async function comfy(): Promise<{ url: string; pfade: string[]; workflows: unknown[]; zu: () => Promise<void> }> {
  const pfade: string[] = [];
  const workflows: unknown[] = [];
  const srv: Server = createServer((req, res) => {
    pfade.push(req.url ?? "");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/system_stats") return void res.end("{}");
      if (req.url === "/prompt") { workflows.push(JSON.parse(body)); return void res.end(JSON.stringify({ prompt_id: "p1" })); }
      if (req.url === "/history/p1") return void res.end(JSON.stringify({ p1: { status: { completed: true }, outputs: { "9": { images: [{ filename: "bild_1.png" }], videos: [{ filename: "film_1.mp4" }] } } } }));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const a = srv.address() as { port: number };
  return { url: `http://127.0.0.1:${a.port}`, pfade, workflows, zu: () => new Promise((r) => srv.close(() => r())) };
}

test("image_gen/video_gen SSRF: die Eingabe waehlt kein Ziel, die interne Adresse geht nicht an den Kunden", async () => {
  const c = await comfy();
  try {
    for (const [ex, kind] of [[new ImageGenExecutor(c.url), KIND_DVM_IMAGE_GEN], [new VideoGenExecutor(c.url), KIND_DVM_VIDEO_GEN]] as const) {
      const r = await registry(ex).run({ kind, name: "medien", input: "http://169.254.169.254/latest/meta-data | seconds=2" });
      assert.equal(r.ok, true, r.output);
      assert.ok(!r.output.includes("127.0.0.1") && !r.output.includes(c.url), `interne Adresse im Ergebnis: ${r.output}`);
    }
    assert.ok(c.pfade.every((p) => p.startsWith("/")), "nur der konfigurierte ComfyUI-Dienst wurde gefragt");
    assert.ok(JSON.stringify(c.workflows).includes("169.254.169.254"), "die URL ist nur Text im Prompt");
    const ohne = await registry(new ImageGenExecutor()).run({ kind: KIND_DVM_IMAGE_GEN, name: "image_gen", input: "x" });
    assert.match(ohne.output, /nicht konfiguriert/);
  } finally { await c.zu(); }
});

test("image_gen/video_gen Sandbox: zu langer Prompt abgelehnt, Videolaenge begrenzt, Zeitlimit fuer Medien", async () => {
  const c = await comfy();
  try {
    const lang = "Himmel ".repeat(2000);
    const r = await registry(new ImageGenExecutor(c.url)).run({ kind: KIND_DVM_IMAGE_GEN, name: "image_gen", input: lang });
    assert.match(r.output, /eingabe zu lang/);
    assert.equal(c.workflows.length, 0, "nichts an ComfyUI geschickt");
    const v = await registry(new VideoGenExecutor(c.url)).run({ kind: KIND_DVM_VIDEO_GEN, name: "video_gen", input: "Wolken | seconds=999 | res=4000p" });
    assert.match(v.output, /Video \(10s, 1280x720/, "hoechstens 10 s, hoechstens 720p");
  } finally { await c.zu(); }
  // Ein ComfyUI, das nie antwortet: Zeitlimit fuer Medien greift
  const stumm = createServer(() => undefined);
  await new Promise<void>((r) => stumm.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(stumm.address() as { port: number }).port}`;
    const t0 = Date.now();
    const r = await registry(new ImageGenExecutor(url), { zeitMs: 300, zeitMsMedien: 500 }).run({ kind: KIND_DVM_IMAGE_GEN, name: "image_gen", input: "x" });
    assert.equal(r.ok, false);
    assert.ok(Date.now() - t0 < 5000);
  } finally {
    stumm.closeAllConnections();
    await new Promise<void>((r) => stumm.close(() => r()));
  }
});
