/**
 * Schritt 8.7: lokale Werkzeuge (App, eigener Browser) – je ein Sandbox- und
 * ein SSRF-Test. `fetch` ist im Test ersetzt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOKAL_MAX_BYTES, localBrowserFetch, localWebSearch, lokalesZielVerboten, runLocalTools } from "../src/local-tools.js";

const echt = globalThis.fetch;
function mitFetch(antwort: (url: string, init?: RequestInit) => Response) {
  const aufrufe: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    aufrufe.push({ url, init });
    return antwort(url, init);
  }) as typeof fetch;
  return { aufrufe, zurueck: () => { globalThis.fetch = echt; } };
}

test("browser_use lokal, SSRF: private und lokale Ziele werden nie abgerufen", async () => {
  const f = mitFetch(() => new Response("<p>nie</p>", { headers: { "content-type": "text/html" } }));
  try {
    for (const ziel of ["http://127.0.0.1:11434/api/tags", "http://localhost:8080", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data",
      "http://[::1]/", "http://[::ffff:10.0.0.1]/", "http://router.local/", "http://metadata.google.internal/", "file:///etc/passwd", "https://a:b@example.org/"]) {
      assert.ok(lokalesZielVerboten(ziel), ziel);
      const r = await localBrowserFetch(ziel);
      assert.equal(r.ok, false, ziel);
      assert.match(r.output, /abgelehnt/);
    }
    assert.equal(f.aufrufe.length, 0);
    assert.equal(lokalesZielVerboten("https://example.org/seite"), null);
  } finally { f.zurueck(); }
});

test("browser_use lokal, Sandbox: ohne Cookies und ohne Weiterleitungen, nur Text, begrenzt gelesen", async () => {
  let gelesen = 0;
  const f = mitFetch((url) => url.endsWith("/bild")
    ? new Response(new Uint8Array(8), { headers: { "content-type": "image/png" } })
    : new Response(new ReadableStream({ pull(c) { gelesen += 65536; c.enqueue(new TextEncoder().encode("<script>x()</script>" + "a".repeat(65516))); if (gelesen > 10_000_000) c.close(); } }), { headers: { "content-type": "text/html" } }));
  try {
    assert.match((await localBrowserFetch("https://example.org/bild")).output, /kein Text/);
    const r = await localBrowserFetch("https://example.org/lang");
    assert.equal(r.ok, true);
    assert.ok(r.output.length <= 3000);
    assert.ok(!r.output.includes("x()"));
    assert.ok(gelesen <= LOKAL_MAX_BYTES + 2 * 65536, `gelesen ${gelesen}`);
    assert.equal(f.aufrufe[1]!.init?.credentials, "omit");
    assert.equal(f.aufrufe[1]!.init?.redirect, "error");
  } finally { f.zurueck(); }
});

test("web_search lokal: SSRF – nur api.duckduckgo.com, die Anfrage waehlt kein Ziel; Sandbox – begrenzt gelesen", async () => {
  const f = mitFetch(() => new Response(JSON.stringify({ Answer: "42" }), { headers: { "content-type": "application/json" } }));
  try {
    const r = await localWebSearch("x&url=http://127.0.0.1/@169.254.169.254");
    assert.equal(r.output, "42");
    const u = new URL(f.aufrufe[0]!.url);
    assert.equal(u.hostname, "api.duckduckgo.com");
    assert.equal(u.searchParams.get("q"), "x&url=http://127.0.0.1/@169.254.169.254");
  } finally { f.zurueck(); }
  const g = mitFetch(() => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65536).fill(32)); } })));
  try {
    const r = await localWebSearch("x");
    assert.equal(r.ok, false, "endlose Antwort bricht ab statt den Speicher zu fuellen");
  } finally { g.zurueck(); }
});

test("andere Werkzeuge laufen lokal nicht", async () => {
  const f = mitFetch(() => new Response("nie"));
  try {
    const { outcomes } = await runLocalTools([{ kind: 5061, name: "file_io", input: "read /etc/passwd" }, { kind: 5070, name: "image_gen", input: "http://127.0.0.1/" }]);
    assert.ok(outcomes.every((o) => !o.ok && /lokal nicht verfuegbar/.test(o.output)));
    assert.equal(f.aufrufe.length, 0);
  } finally { f.zurueck(); }
});
