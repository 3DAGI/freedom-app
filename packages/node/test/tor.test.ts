/**
 * Schritt 8.2c: Relays über Tor. Eine SOCKS5-Attrappe steht vor einem lokalen
 * Relay. Geprüft wird: Der Hostname geht an den Proxy (Adresstyp 3) und wird
 * nie lokal aufgelöst; wss läuft mit TLS und Servername über den Tunnel;
 * ohne erreichbaren Proxy entsteht keine direkte Verbindung; Fehler des
 * Proxys werden zu festen Texten; ungültiges TOR_SOCKS verhindert den Start.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { WebSocketRelay } from "@freedomstack/protocol";
import { socksVerbinde, torAusUmgebung, torWebSocket } from "../src/tor.js";

/** SOCKS5-Attrappe: nimmt nur „ohne Anmeldung“, löst jeden Namen auf 127.0.0.1 auf (wie Tor ins Netz). */
async function socksAttrappe(p: { antwort?: number; methode?: number } = {}) {
  const gesehen: { atyp: number; host: string; port: number }[] = [];
  const server = net.createServer((c) => {
    let stufe = 0;
    let buf = Buffer.alloc(0);
    const lies = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stufe === 0) {
        if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
        c.write(Buffer.from([5, p.methode ?? 0]));
        if (p.methode) return void c.end();
        buf = buf.subarray(2 + buf[1]!);
        stufe = 1;
      }
      if (buf.length < 5 || buf.length < 5 + buf[4]! + 2) return;
      const n = buf[4]!;
      gesehen.push({ atyp: buf[3]!, host: buf.subarray(5, 5 + n).toString(), port: buf.readUInt16BE(5 + n) });
      c.removeListener("data", lies);
      if (p.antwort) return void c.end(Buffer.from([5, p.antwort, 0, 1, 0, 0, 0, 0, 0, 0]));
      const ziel = net.connect(buf.readUInt16BE(5 + n), "127.0.0.1", () => {
        c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        c.pipe(ziel);
        ziel.pipe(c);
      });
      ziel.on("error", () => c.destroy());
      c.on("error", () => ziel.destroy());
    };
    c.on("data", lies);
    c.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { gesehen, server, proxy: { host: "127.0.0.1", port: (server.address() as AddressInfo).port } };
}

/** Ein Relay, das jede Anfrage leer beantwortet und mitzählt, wer sich verbindet. */
async function relayAttrappe() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(wss, "listening");
  let verbindungen = 0;
  wss.on("connection", (c) => {
    verbindungen++;
    c.on("message", (m) => {
      const d = JSON.parse(String(m)) as unknown[];
      if (d[0] === "REQ") c.send(JSON.stringify(["EOSE", d[1]]));
    });
  });
  return { wss, port: (wss.address() as AddressInfo).port, verbindungen: () => verbindungen };
}

test("Relay über Tor: Der Name geht an den Proxy, der Knoten löst ihn nie selbst auf", async () => {
  const s = await socksAttrappe();
  const r = await relayAttrappe();
  // relay.test gibt es nicht – aufgelöst wird es nur vom Proxy
  const relay = new WebSocketRelay(`ws://relay.test:${r.port}`, { verbinde: torWebSocket(s.proxy), autoReconnect: false, timeoutMs: 5_000 });
  try {
    assert.deepEqual(await relay.query({ kinds: [1] }), []);
    assert.deepEqual(s.gesehen, [{ atyp: 3, host: "relay.test", port: r.port }]);
    assert.equal(r.verbindungen(), 1);
  } finally {
    relay.close();
    r.wss.close();
    s.server.close();
  }
});

test("wss über Tor: TLS mit dem Servernamen läuft durch den Tunnel", async () => {
  const s = await socksAttrappe();
  let hallo: Buffer = Buffer.alloc(0);
  const ziel = net.createServer((c) => c.once("data", (d: Buffer) => { hallo = Buffer.from(d); c.destroy(); }));
  ziel.listen(0, "127.0.0.1");
  await once(ziel, "listening");
  const port = (ziel.address() as AddressInfo).port;
  const relay = new WebSocketRelay(`wss://relay.test:${port}`, { verbinde: torWebSocket(s.proxy), autoReconnect: false, timeoutMs: 5_000 });
  try {
    await assert.rejects(relay.query({ kinds: [1] }));
    assert.deepEqual(s.gesehen, [{ atyp: 3, host: "relay.test", port }]);
    assert.equal(hallo[0], 0x16, "TLS-Handshake (ClientHello)");
    assert.ok(hallo.includes(Buffer.from("relay.test")), "Servername (SNI) = Hostname");
  } finally {
    relay.close();
    ziel.close();
    s.server.close();
  }
});

test("kein Ausweg: Ist der Proxy nicht erreichbar, verbindet der Knoten nicht direkt", async () => {
  const r = await relayAttrappe();
  const tot = net.createServer();
  tot.listen(0, "127.0.0.1");
  await once(tot, "listening");
  const port = (tot.address() as AddressInfo).port;
  tot.close();
  await once(tot, "close");
  const relay = new WebSocketRelay(`ws://127.0.0.1:${r.port}`, { verbinde: torWebSocket({ host: "127.0.0.1", port }), autoReconnect: false, timeoutMs: 3_000 });
  try {
    await assert.rejects(relay.query({ kinds: [1] }));
    assert.equal(r.verbindungen(), 0, "keine Verbindung am Proxy vorbei");
  } finally {
    relay.close();
    r.wss.close();
  }
});

test("Antworten des Proxys werden zu festen Texten", async () => {
  const abgelehnt = await socksAttrappe({ antwort: 5 });
  await assert.rejects(socksVerbinde(abgelehnt.proxy, { host: "relay.test", port: 443 }), { name: "SocksFehler", message: "Verbindung abgelehnt" });
  abgelehnt.server.close();
  const anmeldung = await socksAttrappe({ methode: 0xff });
  await assert.rejects(socksVerbinde(anmeldung.proxy, { host: "relay.test", port: 443 }), /verlangt eine Anmeldung/);
  anmeldung.server.close();
  await assert.rejects(socksVerbinde({ host: "127.0.0.1", port: 9 }, { host: "", port: 443 }), /Hostname ungültig/);
  await assert.rejects(socksVerbinde({ host: "127.0.0.1", port: 9 }, { host: "relay.test", port: 0 }), /Port ungültig/);
});

test("TOR_SOCKS: ohne → kein Tor, ungültig → Grund (kein Start), verdrahtet in main.ts", () => {
  assert.deepEqual(torAusUmgebung({}), {});
  assert.deepEqual(torAusUmgebung({ TOR_SOCKS: "127.0.0.1:9050" }), { proxy: { host: "127.0.0.1", port: 9050 } });
  assert.deepEqual(torAusUmgebung({ TOR_SOCKS: "tor:9050" }), { proxy: { host: "tor", port: 9050 } });
  assert.deepEqual(torAusUmgebung({ TOR_SOCKS: "[::1]:9150" }), { proxy: { host: "::1", port: 9150 } });
  for (const w of ["9050", "127.0.0.1", "127.0.0.1:0", "127.0.0.1:70000", "socks5://127.0.0.1:9050"]) {
    assert.match(torAusUmgebung({ TOR_SOCKS: w }).grund ?? "", /TOR_SOCKS ungültig/, w);
  }
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const block = main.slice(main.indexOf("if (torGrund) {"), main.indexOf("if (torProxy) console.log"));
  assert.match(block, /console\.error\(`\[tor\] \$\{torGrund\}[^`]*`\);\n\s+process\.exit\(1\);\n\s+\}/, "ungültig → kein Start");
  // Seit 11.3d2a eine benannte Fabrik – auch Relays privater Räume entstehen nur dort
  assert.match(main, /const relayAn = \(url: string\) => new WebSocketRelay\(url, \{ verbinde \}\);/);
  assert.match(main, /relayUrls\.map\(\(url\) => relayAn\(url\)\)/);
  assert.equal((main.match(/new WebSocketRelay\(/g) ?? []).length, 1, "sonst entstünden Verbindungen am Proxy vorbei");
});
