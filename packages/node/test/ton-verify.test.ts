/**
 * Tests der TON-Verifikation (ton-verify.ts).
 *
 * Ohne Netz: Der toncenter-Aufruf wird durch einen lokalen HTTP-Server
 * simuliert, der vorbereitete Transaktionen liefert. Geprüft wird die
 * Kernlogik: Betrag exakt, Kommentar exakt, eingehend (keine out_msgs),
 * Replay-Schutz.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { nanoNachTon, tonNachNano, tonVerifier } from "../src/ton-verify.js";

/** Fake toncenter: liefert die übergebenen Transaktionen als getTransactions-Ergebnis. */
function fakeRpc(txs: unknown[], port = 0): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: txs }));
      });
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, stop: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function tx(o: { hash: string; value: string; text: string; outMsgs?: number }): unknown {
  return {
    hash: o.hash,
    lt: "1",
    utime: Math.floor(Date.now() / 1000),
    in_msg: { source: "EQAbc", value: o.value, decoded_body: { text: o.text } },
    out_msgs_count: o.outMsgs ?? 0,
  };
}

test("nano↔ton roundtrip", () => {
  assert.equal(tonNachNano(1), "1000000000");
  assert.equal(nanoNachTon("1000000000"), 1);
  assert.equal(nanoNachTon("1500000000"), 1.5);
});

test("passende Zahlung wird gefunden", async () => {
  const srv = await fakeRpc([tx({ hash: "h1", value: "2000000000", text: "freedom:ki-basis:ab12" })]);
  const verbraucht = new Set<string>();
  const v = tonVerifier({ apiKey: undefined, testnet: true, verbraucht });
  // Verifier spricht testnet.toncenter an — für den Test patchen wir fetch
  // auf unseren lokalen Server. Einfachster Weg: die URL überschreiben ist
  // nicht vorgesehen, daher prüfen wir nur die reine Vergleichslogik über
  // einen eigenen Durchlauf mit gemocktem fetch.
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: [
      tx({ hash: "h1", value: "2000000000", text: "freedom:ki-basis:ab12" }),
    ] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  try {
    const beleg = await v.pruefe("EQdepot", { nano: "2000000000", kommentar: "freedom:ki-basis:ab12" });
    assert.ok(beleg);
    assert.equal(beleg.hash, "h1");
    assert.equal(beleg.von, "EQAbc");
  } finally {
    globalThis.fetch = origFetch;
    await srv.stop();
  }
});

test("falscher Betrag wird abgelehnt", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: [tx({ hash: "h1", value: "1000000000", text: "freedom:x:y" })] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  try {
    const v = tonVerifier({ testnet: true });
    const beleg = await v.pruefe("EQdepot", { nano: "2000000000", kommentar: "freedom:x:y" });
    assert.equal(beleg, undefined);
  } finally { globalThis.fetch = origFetch; }
});

test("falscher Kommentar wird abgelehnt", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: [tx({ hash: "h1", value: "100", text: "freedom:ANDERER:nonce" })] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  try {
    const v = tonVerifier({ testnet: true });
    const beleg = await v.pruefe("EQdepot", { nano: "100", kommentar: "freedom:richtig:nonce" });
    assert.equal(beleg, undefined);
  } finally { globalThis.fetch = origFetch; }
});

test("ausgehende Transaktion (out_msgs) wird ignoriert", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: [tx({ hash: "h1", value: "100", text: "freedom:x:y", outMsgs: 1 })] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  try {
    const v = tonVerifier({ testnet: true });
    const beleg = await v.pruefe("EQdepot", { nano: "100", kommentar: "freedom:x:y" });
    assert.equal(beleg, undefined);
  } finally { globalThis.fetch = origFetch; }
});

test("Replay-Schutz: verbrauchte tx wird nicht erneut gefunden", async () => {
  const origFetch = globalThis.fetch;
  const antwort = () => new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: [tx({ hash: "h1", value: "100", text: "freedom:x:y" })] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  globalThis.fetch = (async () => antwort()) as typeof fetch;
  try {
    const v = tonVerifier({ testnet: true });
    const b1 = await v.pruefe("EQdepot", { nano: "100", kommentar: "freedom:x:y" });
    assert.ok(b1);
    v.verbrauche(b1);
    const b2 = await v.pruefe("EQdepot", { nano: "100", kommentar: "freedom:x:y" });
    assert.equal(b2, undefined);
  } finally { globalThis.fetch = origFetch; }
});
