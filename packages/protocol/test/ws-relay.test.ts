/**
 * WebSocketRelay-Test gegen einen echten lokalen Nostr-Test-Relay.
 *
 * Der Test startet einen minimalen NIP-01-Relay-Server (rohes WebSocket,
 * in-memory Store) und prueft publish + query durch die Leitung —
 * dasselbe Interface wie MemoryRelay, aber echtes Protokoll.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { createHash } from "node:crypto";
import {
  generateKeypair,
  signEvent,
  buildEvent,
  verifyEvent,
  WebSocketRelay,
  NostrEvent,
} from "../src/index.js";

// -- Minimaler NIP-01-Test-Relay (kein Framework, rohe WS-Frames) -----------

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key: string): string {
  return createHash("sha1").update(key + WS_MAGIC).digest("base64");
}

function encodeFrame(payload: string): Buffer {
  const data = Buffer.from(payload);
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

function decodeFrames(buf: Buffer): string[] {
  const out: string[] = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const masked = (buf[off + 1] & 0x80) !== 0;
    let len = buf[off + 1] & 0x7f;
    let pos = off + 2;
    if (len === 126) { len = buf.readUInt16BE(pos); pos += 2; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
    const mask = masked ? buf.subarray(pos, pos + 4) : null;
    if (masked) pos += 4;
    if (pos + len > buf.length) break;
    const data = buf.subarray(pos, pos + len);
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    out.push(data.toString());
    off = pos + len;
  }
  return out;
}

class TestRelayServer {
  private http: Server;
  private store: NostrEvent[] = [];
  private sockets = new Set<import("node:net").Socket>();
  port = 0;

  constructor(private censorKinds: number[] = []) {
    this.http = createServer();
    this.http.on("upgrade", (req, socket) => {
      const sock = socket as import("node:net").Socket;
      const key = req.headers["sec-websocket-key"]!;
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
      );
      this.sockets.add(sock);
      sock.on("data", (buf) => this.onData(sock, Buffer.from(buf)));
      sock.on("close", () => this.sockets.delete(sock));
      sock.on("error", () => this.sockets.delete(sock));
    });
  }

  private onData(socket: import("node:net").Socket, buf: Buffer): void {
    for (const text of decodeFrames(buf)) {
      let msg: unknown[];
      try { msg = JSON.parse(text); } catch { continue; }
      const [type, ...rest] = msg;
      if (type === "EVENT") {
        const ev = rest[0] as NostrEvent;
        if (this.censorKinds.includes(ev.kind)) {
          socket.write(encodeFrame(JSON.stringify(["OK", ev.id, false, "blocked: kind censored"])));
          continue;
        }
        const ok = verifyEvent(ev);
        if (ok && !this.store.some((e) => e.id === ev.id)) this.store.push(ev);
        socket.write(encodeFrame(JSON.stringify(["OK", ev.id, ok, ok ? "" : "invalid: sig"])));
      } else if (type === "REQ") {
        const [subId, filter] = rest as [string, { kinds?: number[]; authors?: string[] }];
        for (const ev of this.store) {
          if (filter?.kinds && !filter.kinds.includes(ev.kind)) continue;
          if (filter?.authors && !filter.authors.includes(ev.pubkey)) continue;
          socket.write(encodeFrame(JSON.stringify(["EVENT", subId, ev])));
        }
        socket.write(encodeFrame(JSON.stringify(["EOSE", subId])));
      }
    }
  }

  async start(): Promise<void> {
    await new Promise<void>((res) => this.http.listen(0, "127.0.0.1", res));
    this.port = (this.http.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((res) => this.http.close(() => res()));
  }
}

// ---------------------------------------------------------------- Tests ----

let server: TestRelayServer;

before(async () => {
  server = new TestRelayServer();
  await server.start();
});

after(async () => {
  await server.stop();
});

test("WebSocketRelay: publish + query durch die echte Leitung", async () => {
  const relay = new WebSocketRelay(`ws://127.0.0.1:${server.port}`);
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 1, [], "hello freedomstack"), kp.sk);

  await relay.publish(ev);

  const found = await relay.query({ kinds: [1] });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, ev.id);
  assert.equal(found[0].content, "hello freedomstack");
  relay.close();
});

test("WebSocketRelay: query mit Autor-Filter", async () => {
  const relay = new WebSocketRelay(`ws://127.0.0.1:${server.port}`);
  const a = generateKeypair();
  const b = generateKeypair();
  await relay.publish(signEvent(buildEvent(a.pk, 5050, [["i", "x"]], ""), a.sk));
  await relay.publish(signEvent(buildEvent(b.pk, 5050, [["i", "y"]], ""), b.sk));

  const onlyA = await relay.query({ kinds: [5050], authors: [a.pk] });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].pubkey, a.pk);
  relay.close();
});

test("WebSocketRelay: Relay-Ablehnung wirft Fehler", async () => {
  const censoring = new TestRelayServer([9999]);
  await censoring.start();
  const relay = new WebSocketRelay(`ws://127.0.0.1:${censoring.port}`, { timeoutMs: 2000 });
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 9999, [], "zensiert"), kp.sk);
  await assert.rejects(() => relay.publish(ev), /lehnte Event/);
  relay.close();
  await censoring.stop();
});

test("WebSocketRelay: OutboxPool-Kompatibilitaet (Multi-Relay)", async () => {
  const { OutboxPool, MemoryRelay } = await import("../src/index.js");
  const wsRelay = new WebSocketRelay(`ws://127.0.0.1:${server.port}`);
  const mem = new MemoryRelay("mem://backup");
  const pool = new OutboxPool([wsRelay, mem], { minAcks: 2 });

  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, 38010, [["work_type", "ai_job"]], ""), kp.sk);
  const report = await pool.publish(ev);
  assert.equal(report.accepted.length, 2, "beide Relays acken");
  wsRelay.close();
});
