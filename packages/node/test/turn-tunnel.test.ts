/**
 * Tunnel zum TURN für den Bildstrom (VKg2a1): Die Sandbox erreicht den TURN nur über diesen Tunnel, und er lässt nur
 * eine UDP-Allokation mit Erlaubnissen zu den Relay-Adressen der App durch – sonst wäre ein Zugang ein Weg ins Internet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TUNNEL_GRENZEN, TurnFilter, oeffneTurnTunnel, relayAdressen, turnZiel } from "../src/turn-tunnel.js";
import { turnZugang } from "../src/turn.js";

const tmp = () => mkdtempSync(join(tmpdir(), "vkg2a1-"));
const COOKIE = Buffer.from([0x21, 0x12, 0xa4, 0x42]);

/** Eine STUN-Nachricht (RFC 8489): Methode, Klasse (0 Anfrage, 1 Hinweis, 2 Erfolg), Attribute. */
function stun(methode: number, klasse: number, attribute: Array<[number, Buffer]> = [], kennung = Buffer.alloc(12, 7)): Buffer {
  const typ = (methode & 0x000f) | ((methode & 0x0070) << 1) | ((methode & 0x0f80) << 2) | ((klasse & 1) << 4) | ((klasse & 2) << 7);
  const teile = attribute.map(([art, wert]) => {
    const a = Buffer.alloc(4 + ((wert.length + 3) & ~3));
    a.writeUInt16BE(art, 0);
    a.writeUInt16BE(wert.length, 2);
    wert.copy(a, 4);
    return a;
  });
  const koerper = Buffer.concat(teile);
  const kopf = Buffer.alloc(20);
  kopf.writeUInt16BE(typ, 0);
  kopf.writeUInt16BE(koerper.length, 2);
  COOKIE.copy(kopf, 4);
  kennung.copy(kopf, 8);
  return Buffer.concat([kopf, koerper]);
}

/** XOR-PEER-ADDRESS für IPv4 oder IPv6 (mit der Kennung der Nachricht). */
function gegenstelle(ip: string, port = 50_000, kennung = Buffer.alloc(12, 7)): [number, Buffer] {
  const v6 = ip.includes(":");
  const [links, rechts] = ip.split("::");
  const gruppen = rechts === undefined ? links!.split(":") : [...links!.split(":"), ...Array(8 - links!.split(":").length - rechts.split(":").length).fill("0"), ...rechts.split(":")];
  const roh = v6
    ? Buffer.from(gruppen.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]))
    : Buffer.from(ip.split(".").map(Number));
  const maske = Buffer.concat([COOKIE, kennung]);
  const wert = Buffer.alloc(4 + roh.length);
  wert[1] = v6 ? 2 : 1;
  wert.writeUInt16BE(port ^ 0x2112, 2);
  roh.forEach((b, i) => { wert[4 + i] = b ^ maske[i]!; });
  return [0x0012, wert];
}

const transport = (proto: number): [number, Buffer] => [0x0019, Buffer.from([proto, 0, 0, 0])];
const kanal = (nummer: number, daten: Buffer) => {
  const k = Buffer.alloc(4 + ((daten.length + 3) & ~3));
  k.writeUInt16BE(nummer, 0);
  k.writeUInt16BE(daten.length, 2);
  daten.copy(k, 4);
  return k;
};

test("VKg2a1: Ziel – erst TURN_INTERN, dann TCP, dann TLS, dann ohne Angabe", () => {
  assert.deepEqual(turnZiel(["turn:t.example:3478?transport=udp", "turn:t.example:3478?transport=tcp"]), { host: "t.example", port: 3478, tls: false });
  assert.deepEqual(turnZiel(["turn:t.example?transport=udp", "turns:t.example"]), { host: "t.example", port: 5349, tls: true });
  assert.deepEqual(turnZiel(["turn:t.example:3478?transport=udp", "turn:u.example:3479"]), { host: "u.example", port: 3479, tls: false });
  assert.deepEqual(turnZiel(["turn:t.example:3478?transport=udp"]), { host: "t.example", port: 3478, tls: false }, "coturn lauscht auch über TCP");
  assert.deepEqual(turnZiel(["turn:t.example:3478"], "127.0.0.1:3478"), { host: "127.0.0.1", port: 3478, tls: false });
  assert.deepEqual(turnZiel([], "[::1]:3478"), { host: "::1", port: 3478, tls: false });
  for (const falsch of ["127.0.0.1", "127.0.0.1:0", "127.0.0.1:70000", "a b:1", "http://x:1"]) assert.equal(turnZiel(["turn:t.example"], falsch), null, falsch);
  assert.equal(turnZiel(["http://t.example:3478", "turn:t.example:99999"]), null);
});

test("VKg2a1: erlaubt sind nur die Relay-Adressen aus dem Angebot der App", () => {
  const sdp = [
    "v=0",
    "a=candidate:1 1 udp 2122260223 192.168.1.5 50000 typ host generation 0",
    "a=candidate:2 1 udp 1686052607 198.51.100.7 50001 typ srflx raddr 192.168.1.5 rport 50000",
    "a=candidate:3 1 udp 33562623 203.0.113.9 49160 typ relay raddr 0.0.0.0 rport 0",
    "a=candidate:4 1 udp 33562623 203.0.113.9 49161 typ relay raddr 0.0.0.0 rport 0",
    "a=candidate:5 1 udp 33562111 2001:db8::9 49162 typ relay raddr :: rport 0",
    "a=candidate:6 1 udp 33562111 turn.local 49163 typ relay raddr 0.0.0.0 rport 0",
  ].join("\r\n");
  assert.deepEqual(relayAdressen(sdp), ["203.0.113.9", "2001:db8::9"]);
  assert.deepEqual(relayAdressen("v=0\r\n"), []);
  const viele = Array.from({ length: 20 }, (_, i) => `a=candidate:${i} 1 udp 1 203.0.113.${i} 1 typ relay`).join("\n");
  assert.equal(relayAdressen(viele).length, TUNNEL_GRENZEN.adressen);
});

test("VKg2a1: Filter – UDP-Allokation, Erlaubnis und Kanal zur App gehen durch", () => {
  const f = new TurnFilter(["203.0.113.9", "2001:db8::9"]);
  const allocate = stun(0x003, 0, [transport(17)]);
  assert.deepEqual(f.nimm(allocate), allocate);
  for (const n of [
    stun(0x001, 0), stun(0x001, 1), stun(0x004, 0),
    stun(0x008, 0, [gegenstelle("203.0.113.9"), gegenstelle("2001:db8:0:0:0:0:0:9")]),
    stun(0x009, 0, [[0x000c, Buffer.from([0x40, 0x01, 0, 0])], gegenstelle("203.0.113.9")]),
    stun(0x006, 1, [gegenstelle("2001:db8::9"), [0x0013, Buffer.from("rtp")]]),
    kanal(0x4001, Buffer.from("srtp-paket")), kanal(0x7fff, Buffer.alloc(0)), // coturn nimmt Nummern wie RFC 5766
  ]) assert.deepEqual(f.nimm(n), n);
  // zerteilt und zusammen in einem Stück
  const zwei = Buffer.concat([kanal(0x4001, Buffer.from("abc")), stun(0x004, 0)]);
  assert.equal(f.nimm(zwei.subarray(0, 5))!.length, 0);
  assert.deepEqual(f.nimm(zwei.subarray(5)), zwei);
});

test("VKg2a1: Filter – alles andere schließt den Tunnel", () => {
  const faelle: Array<[string, Buffer]> = [
    ["Allocate über TCP (RFC 6062)", stun(0x003, 0, [transport(6)])],
    ["Allocate ohne Transport", stun(0x003, 0)],
    ["Connect", stun(0x00a, 0, [gegenstelle("203.0.113.9")])],
    ["ConnectionBind", stun(0x00b, 0)],
    ["Erlaubnis an eine fremde Adresse", stun(0x008, 0, [gegenstelle("203.0.113.9"), gegenstelle("8.8.8.8")])],
    ["Kanal an eine fremde Adresse", stun(0x009, 0, [gegenstelle("198.51.100.1")])],
    ["Send an eine fremde IPv6", stun(0x006, 1, [gegenstelle("2001:db8::10")])],
    ["Erlaubnis ohne Gegenstelle", stun(0x008, 0)],
    ["Refresh mit Gegenstelle", stun(0x004, 0, [gegenstelle("203.0.113.9")])],
    ["Antwort vom Client", stun(0x001, 2)],
    ["Allocate als Hinweis", stun(0x003, 1, [transport(17)])],
    ["falsches Cookie", Buffer.concat([stun(0x001, 0).subarray(0, 4), Buffer.alloc(16)])],
    ["Länge nicht durch vier teilbar", (() => { const b = stun(0x001, 0, [[0x8022, Buffer.from("abcd")]]); b.writeUInt16BE(6, 2); return b.subarray(0, 26); })()],
    ["Attribut länger als die Nachricht", (() => { const b = stun(0x001, 0, [[0x8022, Buffer.from("abcd")]]); b.writeUInt16BE(40, 22); return b; })()],
    ["weder STUN noch ChannelData", Buffer.from([0xc0, 0x00, 0x00, 0x04, 1, 2, 3, 4])],
    ["TLS statt TURN (Kopf wie STUN, ohne Cookie)", Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f])],
  ];
  for (const [name, nachricht] of faelle) {
    const f = new TurnFilter(["203.0.113.9", "2001:db8::9"]);
    assert.equal(f.nimm(nachricht), null, name);
    assert.equal(nachricht.length, nachricht[0]! >> 6 === 0 && nachricht.length >= 20 ? 20 + nachricht.readUInt16BE(2) : nachricht.length, `${name}: als Ganzes gebaut`);
    assert.equal(f.nimm(stun(0x001, 0)), null, `${name}: danach bleibt er zu`);
  }
});

/** Ein Stand-in für den TURN: merkt sich, was ankommt, und schickt „ok“ zurück. */
async function falscherTurn(): Promise<{ server: Server; port: number; angekommen: Buffer[] }> {
  const angekommen: Buffer[] = [];
  const server = createServer((s) => s.on("data", (d: Buffer) => { angekommen.push(d); s.write("ok"); }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as AddressInfo).port, angekommen };
}

const ueberSockel = (sockel: string) => new Promise<Socket>((r, f) => { const s = connect(sockel, () => r(s)); s.once("error", f); });
const geschlossen = (s: Socket) => new Promise<void>((r) => (s.destroyed ? r() : s.once("close", () => r())));

test("VKg2a1: Tunnel – Socket nur für den Knoten, Erlaubtes geht durch, Verbotenes schließt beide Seiten", async () => {
  const turn = await falscherTurn();
  const sockel = join(tmp(), "turn.sock");
  await assert.rejects(oeffneTurnTunnel({ sockel, ziel: { host: "127.0.0.1", port: turn.port, tls: false }, erlaubt: [] }));
  const tunnel = await oeffneTurnTunnel({ sockel, ziel: { host: "127.0.0.1", port: turn.port, tls: false }, erlaubt: ["203.0.113.9"] });
  assert.equal(statSync(sockel).mode & 0o777, 0o600);

  const gut = await ueberSockel(sockel);
  const antwort = new Promise<string>((r) => gut.once("data", (d) => r(d.toString())));
  gut.write(stun(0x003, 0, [transport(17)]));
  assert.equal(await antwort, "ok");
  assert.deepEqual(Buffer.concat(turn.angekommen), stun(0x003, 0, [transport(17)]));

  const boese = await ueberSockel(sockel);
  boese.write(stun(0x008, 0, [gegenstelle("8.8.8.8")]));
  await geschlossen(boese);
  assert.equal(tunnel.verstoesse, 1);
  assert.equal(turn.angekommen.length, 1, "die verbotene Erlaubnis kam nie beim TURN an");

  // höchstens TUNNEL_GRENZEN.verbindungen zugleich
  const weitere = await Promise.all(Array.from({ length: TUNNEL_GRENZEN.verbindungen }, () => ueberSockel(sockel)));
  await geschlossen(weitere.at(-1)!);
  assert.equal(weitere.slice(0, -1).every((s) => !s.destroyed), true);

  await tunnel.schliesse();
  await Promise.all([gut, ...weitere].map(geschlossen));
  turn.server.close();
});

const hat = (p: string) => new Promise<boolean>((r) => execFile(p, ["-h"], (e) => r(!e || (e as NodeJS.ErrnoException).code !== "ENOENT")));
const ohneCoturn = !((await hat("turnserver")) && (await hat("turnutils_uclient")) && (await hat("turnutils_peer"))) && "coturn fehlt (turnserver, turnutils_uclient, turnutils_peer)";

const freierPort = async (udp = false): Promise<number> => {
  if (udp) {
    const { createSocket } = await import("node:dgram");
    const s = createSocket("udp4");
    await new Promise<void>((r) => s.bind(0, "127.0.0.1", r));
    const p = s.address().port;
    s.close();
    return p;
  }
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return p;
};

/** Mit echtem coturn: der Client (TCP) über den Tunnel – an die erlaubte Gegenstelle kommen alle Pakete, an eine andere keins. */
test("VKg2a1: echter coturn – Kanäle und Send zur erlaubten Gegenstelle, nichts zu einer anderen", { skip: ohneCoturn }, async () => {
  const ordner = tmp();
  const geheimnis = "a".repeat(64);
  const [turnPort, peerPort] = [await freierPort(), await freierPort(true)];
  const relay = 49_000 + Math.floor(Math.random() * 1000) * 10;
  writeFileSync(join(ordner, "turnserver.conf"), [
    "listening-ip=127.0.0.1", `listening-port=${turnPort}`, "relay-ip=127.0.0.1", `min-port=${relay}`, `max-port=${relay + 9}`,
    "realm=freedom", "use-auth-secret", `static-auth-secret=${geheimnis}`, "fingerprint", "no-cli", "no-tls", "no-dtls",
    "allow-loopback-peers", "log-file=/dev/null", "",
  ].join("\n"));
  const coturn = spawn("turnserver", ["-c", join(ordner, "turnserver.conf"), "--no-stdout-log"], { stdio: "ignore" });
  const peer = spawn("turnutils_peer", ["-L", "127.0.0.1", "-p", String(peerPort)], { stdio: "ignore" });
  try {
    // erst wenn coturn lauscht
    for (let i = 0; i < 50; i++) {
      if (await new Promise<boolean>((r) => { const s = connect(turnPort, "127.0.0.1", () => { s.destroy(); r(true); }); s.once("error", () => r(false)); })) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const lauf = async (erlaubt: string[], art: string[]) => {
      const sockel = join(mkdtempSync(join(ordner, "t-")), "turn.sock");
      const tunnel = await oeffneTurnTunnel({ sockel, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, erlaubt });
      // turnutils spricht TCP – davor ein Weiterreicher wie freedom_motor.py in der Sandbox
      const vorn = createServer((k) => { const z = connect(sockel); k.pipe(z); z.pipe(k); k.on("error", () => z.destroy()); z.on("error", () => k.destroy()); });
      await new Promise<void>((r) => vorn.listen(0, "127.0.0.1", r));
      const z = turnZugang({ urls: [`turn:127.0.0.1:${turnPort}`], geheimnis, gueltigSek: 600 });
      const ausgabe = await new Promise<string>((r) => execFile("turnutils_uclient", [
        "-t", ...art, "-e", "127.0.0.1", "-r", String(peerPort), "-u", z.nutzer, "-w", z.passwort, "-n", "5", "-c",
        "-p", String((vorn.address() as AddressInfo).port), "127.0.0.1",
      ], { timeout: 20_000 }, (_e, out, err) => r(`${out}${err}`)));
      vorn.close();
      const v = tunnel.verstoesse;
      await tunnel.schliesse();
      return { verloren: ausgabe.match(/Total lost packets (\d+)/)?.[1], empfangen: Number([...ausgabe.matchAll(/tot_recv_bytes ~ (\d+)/g)].at(-1)?.[1] ?? 0), verstoesse: v };
    };
    for (const art of [[], ["-s"]]) {
      const ok = await lauf(["127.0.0.1"], art);
      assert.equal(ok.verloren, "0", `alle Pakete zurück (${art.join("") || "Kanäle"})`);
      assert.equal(ok.empfangen, 500);
      assert.equal(ok.verstoesse, 0);
      const fremd = await lauf(["192.0.2.77"], art);
      assert.equal(fremd.empfangen, 0, `nichts an eine Gegenstelle, die die App nicht nennt (${art.join("") || "Kanäle"})`);
      assert.ok(fremd.verstoesse >= 1);
    }
  } finally {
    coturn.kill();
    peer.kill();
  }
});
