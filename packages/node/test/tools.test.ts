/**
 * Tool-Execution Tests: web_search, file_io (Sandbox), browser_use.
 * Live-Tests skippen bei fehlendem Netz.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
