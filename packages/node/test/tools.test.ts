/**
 * Tool-Execution Tests: web_search, file_io (Sandbox), browser_use.
 * Live-Tests skippen bei fehlendem Netz.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WebSearchExecutor,
  FileIoExecutor,
  BrowserExecutor,
  ToolRegistry,
  defaultToolRegistry,
} from "../src/tools.js";
import { KIND_DVM_WEB_SEARCH, KIND_DVM_FILE_IO, KIND_DVM_BROWSER } from "@freedomstack/protocol";

test("FileIoExecutor: read/write in Sandbox, blockiert Escape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freedom-test-"));
  try {
    await writeFile(join(dir, "hello.txt"), "inhalt123", "utf8");
    const ex = new FileIoExecutor(dir);

    const rd = await ex.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read hello.txt" });
    assert.ok(rd.ok);
    assert.equal(rd.output, "inhalt123");

    const wr = await ex.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "write neu.txt abc" });
    assert.ok(wr.ok);
    assert.ok(wr.output.includes("neu.txt"));

    // Sandbox-Escape blockiert
    const esc = await ex.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read ../../etc/passwd" });
    assert.equal(esc.ok, false, "Escape blockiert");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("A-29: file_io je Auftrag getrennt – ein Auftrag sieht nie, was ein anderer schrieb; aufgeräumt wird je Auftrag", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freedom-auftrag-"));
  const a = "a".repeat(64), b = "b".repeat(64);
  try {
    await writeFile(join(dir, "geteilt.txt"), "vom betreiber", "utf8");
    const r = defaultToolRegistry(dir);
    const io = (auftrag: string | undefined, input: string) => r.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input, ...(auftrag !== undefined ? { auftrag } : {}) });
    assert.ok((await io(a, "write notiz.txt geheim von a")).ok);
    assert.equal((await io(a, "read notiz.txt")).output, "geheim von a", "derselbe Auftrag liest, was er schrieb");
    const fremd = await io(b, "read notiz.txt");
    assert.equal(fremd.ok, false, "ein anderer Auftrag sieht die Datei nicht");
    assert.equal((await io(b, "read ../" + a + "/notiz.txt")).ok, false, "auch nicht über den Nachbarordner");
    assert.equal((await io(a, "read geteilt.txt")).ok, false, "der Workspace selbst ist für Aufträge nicht sichtbar");
    assert.deepEqual((await readdir(dir)).sort(), [a, b, "geteilt.txt"].sort());
    // ungültige Auftrags-Id: kein Ordner, kein Zugriff
    const kaputt = await io("../x", "write x.txt y");
    assert.equal(kaputt.ok, false);
    assert.match(kaputt.output, /ungueltiger auftrag/);
    await r.vergiss("../x");
    await r.vergiss(a);
    assert.deepEqual((await readdir(dir)).sort(), [b, "geteilt.txt"].sort(), "nur der Ordner von a ist weg");
    await r.vergiss(b);
    assert.deepEqual(await readdir(dir), ["geteilt.txt"]);
    assert.equal((await io(a, "read notiz.txt")).ok, false, "nach dem Aufräumen ist nichts mehr da");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WebSearchExecutor: kann kind handhaben (Format)", () => {
  const ex = new WebSearchExecutor();
  assert.ok(ex.canHandle(KIND_DVM_WEB_SEARCH));
  assert.ok(!ex.canHandle(KIND_DVM_FILE_IO));
});

test("ToolRegistry: findet Executor pro kind, Fehler bei unbekanntem", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freedom-reg-"));
  try {
    const r = defaultToolRegistry(dir);
    // file_io lokal (kein Netz noetig)
    await writeFile(join(dir, "a.txt"), "x", "utf8");
    const res = await r.run({ kind: KIND_DVM_FILE_IO, name: "file_io", input: "read a.txt" });
    assert.ok(res.ok);
    // unbekanntes kind
    const bad = await r.run({ kind: 9999, name: "unknown", input: "x" });
    assert.equal(bad.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WebSearchExecutor: live DuckDuckGo (skip ohne Netz)", async (t) => {
  const ex = new WebSearchExecutor();
  try {
    const res = await ex.run({ kind: KIND_DVM_WEB_SEARCH, name: "web_search", input: "nostr protocol" });
    assert.ok(res.durationMs > 0);
    assert.ok(res.output.length > 0);
  } catch {
    t.skip("kein Netz");
  }
});

test("BrowserExecutor: live HTTP-Fetch + Text-Extraktion (skip ohne Netz)", async (t) => {
  const ex = new BrowserExecutor();
  try {
    const res = await ex.run({ kind: KIND_DVM_BROWSER, name: "browser_use", input: "https://example.com" });
    assert.ok(res.ok);
    assert.ok(res.output.toLowerCase().includes("example domain"));
    assert.ok(!res.output.includes("<"), "HTML gestrippt");
  } catch {
    t.skip("kein Netz");
  }
});
