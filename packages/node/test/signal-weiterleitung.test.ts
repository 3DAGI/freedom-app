/**
 * Signalverbindung zum Gruppenanruf über den eigenen Knoten (B-34e1, LK5 A): Zeichen nur für den Besitzer, nur für das
 * genannte Ziel und bis zum Ablauf; der Relay reicht `/signal/…` zum SFU weiter – ohne Kopfzeilen des Browsers, Rahmen
 * unverändert, auch was der SFU sofort schickt; alles andere bleibt Nostr.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import net, { type AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { WebSocket, WebSocketServer } from "ws";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_DVM_SIGNAL, LocalSigner, MemoryRelay, OutboxPool, SIGNAL_GRENZEN, baueSignalAnfrage, baueStatusAuftrag,
  buildJobRequest, buildPrivateJobRequest, generateKeypair, leseKnotenStatus, leseSignalZugang, neueKopplung, openPrivateJobResponse,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { RelayRole } from "../src/relay-role.js";
import { SIGNAL_WEITER, SignalWeiterleitung, direktVerbinden, type SignalVerbinde } from "../src/signal-weiterleitung.js";
import { torWsVerbindung } from "../src/tor.js";
import { socksAttrappe } from "./socks-attrappe.js";

const JETZT = 1_790_000_000;

async function freierPort(): Promise<number> {
  const s = net.createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = (s.address() as AddressInfo).port;
  await new Promise((ok) => s.close(ok));
  return p;
}

/** Ein SFU zum Prüfen: merkt sich Pfad und Kopfzeilen, schickt sofort einen Binärrahmen und spiegelt alles zurück. */
async function sfuAttrappe(o: { status?: number } = {}) {
  const gesehen: { url: string; kopf: IncomingMessage["headers"] }[] = [];
  const http = createServer((_req, res) => res.end());
  const wss = new WebSocketServer({ noServer: true });
  const offen = new Set<WebSocket>();
  http.on("upgrade", (req, socket, head) => {
    gesehen.push({ url: req.url ?? "", kopf: req.headers });
    if (o.status) return void socket.end(`HTTP/1.1 ${o.status} Nein\r\nContent-Length: 13\r\n\r\ninvalid token`);
    wss.handleUpgrade(req, socket, head, (ws) => {
      offen.add(ws);
      ws.on("close", () => offen.delete(ws));
      ws.send(Buffer.from([0x0a, 0x01, 0xff]), { binary: true });
      ws.on("message", (d, binaer) => ws.send(d, { binary: binaer }));
    });
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const port = (http.address() as AddressInfo).port;
  return { gesehen, port, offen, zu: () => { for (const ws of offen) ws.terminate(); http.close(); } };
}

/** Wie `direktVerbinden`, aber `wss://sfu.test` landet bei der Attrappe (ohne TLS). */
const zurAttrappe = (port: number): SignalVerbinde => (url, o) => direktVerbinden(url.replace(/^wss:\/\/sfu\.test(:\d+)?/, `ws://127.0.0.1:${port}`), o);

async function mitRelay(signal: SignalWeiterleitung, fn: (basis: string) => Promise<void>): Promise<void> {
  const port = await freierPort();
  const r = new RelayRole({ port, retentionDays: 7, maxEventBytes: 64_000, signal });
  await r.start();
  try {
    await fn(`ws://127.0.0.1:${port}`);
  } finally {
    r.stop();
  }
}

/** Verbinden wie der Browser – mit Herkunft, Cookie und Browserkennung, die nicht weiter dürfen. */
function browser(url: string): Promise<{ ws: WebSocket; erste: Promise<{ d: Buffer; binaer: boolean }> }> {
  return new Promise((ok, fehler) => {
    const ws = new WebSocket(url, { headers: { Origin: "https://app.example", Cookie: "geheim=1", "User-Agent": "Browser/1.0" } });
    const erste = new Promise<{ d: Buffer; binaer: boolean }>((r) => ws.once("message", (d, binaer) => r({ d: d as Buffer, binaer })));
    ws.once("open", () => ok({ ws, erste }));
    ws.once("unexpected-response", (_q, res) => fehler(new Error(`status ${res.statusCode}`)));
    ws.once("error", fehler);
  });
}

test("B-34e1: Zeichen – höchstens einen Tag, nie für einen vergangenen Ablauf, höchstens 16 zugleich", () => {
  let jetzt = JETZT;
  const w = new SignalWeiterleitung({ verbinde: direktVerbinden, pruefeZiel: async () => true, jetzt: () => jetzt });
  const z = w.vergib("wss://sfu.test", JETZT + 3600)!;
  assert.match(z.zeichen, /^[0-9a-f]{64}$/);
  assert.equal(z.bis, JETZT + 3600);
  assert.equal(w.vergib("wss://sfu.test", JETZT + 10 * 86_400)!.bis, JETZT + SIGNAL_GRENZEN.hoechstensSek, "höchstens einen Tag");
  assert.equal(w.vergib("wss://sfu.test", JETZT), null, "Ablauf jetzt: keines");
  assert.notEqual(w.vergib("wss://sfu.test", JETZT + 60)!.zeichen, w.vergib("wss://sfu.test", JETZT + 60)!.zeichen, "jedes Mal neu");
  const viele = Array.from({ length: SIGNAL_WEITER.zeichen + 3 }, () => w.vergib("wss://sfu.test", JETZT + 60)!.zeichen);
  assert.equal(new Set(viele).size, viele.length);
  jetzt += 120;
  assert.ok(w.vergib("wss://sfu.test", jetzt + 60));
});

test("B-34e1: der Relay reicht /signal/… zum SFU weiter – Pfad und Anfrage, keine Kopfzeilen des Browsers, Rahmen unverändert", async () => {
  const sfu = await sfuAttrappe();
  const geprueft: string[] = [];
  const w = new SignalWeiterleitung({ verbinde: zurAttrappe(sfu.port), pruefeZiel: async (z) => (geprueft.push(z), true) });
  const { zeichen } = w.vergib("wss://sfu.test:7880", Math.floor(Date.now() / 1000) + 600)!;
  try {
    await mitRelay(w, async (basis) => {
      const b = await browser(`${basis}/signal/${zeichen}/rtc/v1?access_token=eyJ.a.b&join_request=SGFsbG8`);
      const erste = await b.erste;
      assert.deepEqual([...erste.d], [0x0a, 0x01, 0xff], "was der SFU sofort schickt, kommt an");
      assert.equal(erste.binaer, true);
      assert.deepEqual(geprueft, ["wss://sfu.test:7880"]);
      assert.equal(sfu.gesehen[0]!.url, "/rtc/v1?access_token=eyJ.a.b&join_request=SGFsbG8");
      const kopf = sfu.gesehen[0]!.kopf;
      assert.equal(kopf.host, `127.0.0.1:${sfu.port}`);
      assert.ok(!kopf.origin && !kopf.cookie && !kopf["user-agent"] && !kopf["x-forwarded-for"], JSON.stringify(kopf));
      const echo = new Promise<{ d: Buffer; binaer: boolean }>((r) => b.ws.once("message", (d, binaer) => r({ d: d as Buffer, binaer })));
      b.ws.send(Buffer.from([1, 2, 3, 0]), { binary: true });
      const e = await echo;
      assert.deepEqual([...e.d], [1, 2, 3, 0]);
      assert.equal(e.binaer, true);
      assert.equal(w.offeneVerbindungen, 1);
      // v0-Pfad (Rückfall von livekit-client) geht auch
      const v0 = await browser(`${basis}/signal/${zeichen}/rtc?access_token=x`);
      await v0.erste;
      assert.equal(sfu.gesehen[1]!.url, "/rtc?access_token=x");
      // Schließt der Browser, schließt die Weiterleitung den SFU
      const zu = once(b.ws, "close");
      b.ws.close(1000);
      await zu;
      const bis = Date.now() + 2000;
      while (sfu.offen.size > 1 && Date.now() < bis) await new Promise((r) => setTimeout(r, 10));
      assert.equal(sfu.offen.size, 1);
      v0.ws.close();
      // Nostr läuft weiter auf demselben Port
      const nostr = new WebSocket(basis);
      const [msg] = await once(nostr, "message");
      assert.equal(JSON.parse(String(msg))[0], "AUTH");
      nostr.close();
    });
  } finally {
    sfu.zu();
  }
});

test("B-34e1: abgelehnt – unbekanntes oder abgelaufenes Zeichen, verbotenes Ziel, SFU sagt nein oder ist weg, zu viele Verbindungen", async () => {
  const sfu = await sfuAttrappe();
  const nein = await sfuAttrappe({ status: 401 });
  let erlaubt = true;
  let jetzt = Math.floor(Date.now() / 1000);
  const w = new SignalWeiterleitung({
    verbinde: (url, o) => direktVerbinden(url.replace("wss://sfu.test", `ws://127.0.0.1:${sfu.port}`).replace("wss://nein.test", `ws://127.0.0.1:${nein.port}`).replace("wss://weg.test", "ws://127.0.0.1:1"), o),
    pruefeZiel: async () => erlaubt, jetzt: () => jetzt,
  });
  const gut = w.vergib("wss://sfu.test", jetzt + 600)!.zeichen;
  const kurz = w.vergib("wss://sfu.test", jetzt + 5)!.zeichen;
  const abgelehnt = w.vergib("wss://nein.test", jetzt + 600)!.zeichen;
  const weg = w.vergib("wss://weg.test", jetzt + 600)!.zeichen;
  try {
    await mitRelay(w, async (basis) => {
      const status = (pfad: string) => browser(`${basis}${pfad}`).then((b) => (b.ws.close(), "offen"), (e: Error) => e.message);
      assert.equal(await status(`/signal/${"0".repeat(64)}/rtc/v1`), "status 404", "unbekannt");
      assert.equal(await status(`/signal/${gut}/rtc/v1/validate`), "status 404", "anderer Pfad");
      assert.equal(await status(`/signal/${abgelehnt}/rtc/v1?access_token=x`), "status 502", "SFU antwortet 401 – nichts davon an den Browser");
      assert.equal(await status(`/signal/${weg}/rtc/v1`), "status 502", "SFU nicht erreichbar");
      erlaubt = false;
      assert.equal(await status(`/signal/${gut}/rtc/v1`), "status 403", "Ziel verboten (ohne Tor private Adresse)");
      erlaubt = true;
      jetzt += 10;
      assert.equal(await status(`/signal/${kurz}/rtc/v1`), "status 404", "abgelaufen");
      // je Zeichen höchstens zwei zugleich
      const a = await browser(`${basis}/signal/${gut}/rtc/v1`);
      const b = await browser(`${basis}/signal/${gut}/rtc/v1`);
      assert.equal(await status(`/signal/${gut}/rtc/v1`), "status 503");
      assert.equal(w.offeneVerbindungen, SIGNAL_WEITER.jeZeichen);
      a.ws.close();
      b.ws.close();
      assert.equal(nein.gesehen.length, 1);
    });
  } finally {
    sfu.zu();
    nein.zu();
  }
});

test("B-34e1: mit Tor geht die Verbindung zum SFU durch den Proxy – den Namen löst Tor auf", async () => {
  const s = await socksAttrappe();
  const sfu = await sfuAttrappe();
  const w = new SignalWeiterleitung({ verbinde: torWsVerbindung(s.proxy), pruefeZiel: async () => true });
  // ws:// nur im Test – im Knoten kommt nur wss:// an (`leseSignalAnfrage()`)
  const { zeichen } = w.vergib(`ws://sfu.test:${sfu.port}`, Math.floor(Date.now() / 1000) + 600)!;
  try {
    await mitRelay(w, async (basis) => {
      const b = await browser(`${basis}/signal/${zeichen}/rtc/v1?access_token=x`);
      await b.erste;
      assert.deepEqual(s.gesehen, [{ atyp: 3, host: "sfu.test", port: sfu.port }]);
      b.ws.close();
    });
  } finally {
    sfu.zu();
    s.server.close();
  }
});

async function aufbau(mitSignal = true) {
  const relay = new MemoryRelay(`mem://signal-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const k = neueKopplung(kp.pk);
  const signal = mitSignal ? new SignalWeiterleitung({ verbinde: direktVerbinden, pruefeZiel: async () => true }) : undefined;
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], signal,
    status: () => ({ fassung: "0.1.0", seit: 1, rollen: ["relay", "signal"], modelle: [], relay: null }),
  }, pool);
  return { relay, pool, kp, k, provider };
}

const antworten = async (relay: MemoryRelay, s: LocalSigner) =>
  (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s)))).flatMap((a) => (a.ok ? [a.response] : []));

test("B-34e1: der Besitzer bekommt ein Zeichen – versiegelt, nie im Log, zählt nicht als Auftrag", async () => {
  const { relay, pool, k, provider } = await aufbau();
  const s = new LocalSigner(generateKeypair().sk);
  const bis = Math.floor(Date.now() / 1000) + 900;
  await pool.publish((await baueSignalAnfrage({ sitzung: s, kopplung: k, ziel: "wss://sfu.example.org", bis })).wrap);
  const log: string[] = [];
  const alt = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  let jobs;
  try {
    jobs = await provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.outputPreview, "Weiterleitung zum Gruppenanruf an den Besitzer");
  const a = (await antworten(relay, s)).find((r) => r.kind === KIND_DVM_SIGNAL + 1000);
  const z = leseSignalZugang(a!.content);
  assert.ok(z, a!.content);
  assert.equal(z.bis, bis);
  assert.ok(!log.join("\n").includes(z.zeichen), "Zeichen nie im Log");
  assert.equal((await relay.query({ kinds: [KIND_DVM_SIGNAL + 1000] })).length, 0, "nie offen");
  const st = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueStatusAuftrag({ sitzung: st, kopplung: k })).wrap);
  await provider.pollOnce();
  const status = leseKnotenStatus((await antworten(relay, st)).find((r) => r.kind === KIND_DVM_KNOTEN_STATUS + 1000)!.content)!;
  assert.deepEqual(status.rollen, ["relay", "signal"]);
  assert.deepEqual(status.auftraege, { erledigt: 0, gratis: 0, abgelehnt: 0 });
});

test("B-34e1: ohne Nachweis, fremd, ungültiges Ziel, vergangener Anruf oder ohne Relay kein Zeichen – feste Rückmeldung", async () => {
  const { relay, pool, kp, k, provider } = await aufbau();
  const bis = Math.floor(Date.now() / 1000) + 900;
  const fremd = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueSignalAnfrage({ sitzung: fremd, kopplung: neueKopplung(kp.pk), ziel: "wss://sfu.example.org", bis })).wrap);
  const ohne = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({ kind: KIND_DVM_SIGNAL, customerPubkey: ohne.publicKey(), input: JSON.stringify({ ziel: "wss://sfu.example.org", bis }), bidMsat: 0, providerPubkey: kp.pk });
  await pool.publish((await buildPrivateJobRequest({ request: kern, sessionSigner: ohne, providerPk: kp.pk })).wrap);
  // mit Nachweis, aber ein Ziel im Heimnetz über ws:// (an `baueSignalAnfrage()` vorbei)
  const { mitBesitzerNachweis } = await import("@freedomstack/protocol");
  const heim = new LocalSigner(generateKeypair().sk);
  const falsch = mitBesitzerNachweis(buildJobRequest({ kind: KIND_DVM_SIGNAL, customerPubkey: heim.publicKey(), input: JSON.stringify({ ziel: "ws://192.168.1.2:7880", bis }), bidMsat: 0, providerPubkey: kp.pk }), k);
  await pool.publish((await buildPrivateJobRequest({ request: falsch, sessionSigner: heim, providerPk: kp.pk })).wrap);
  const spaet = new LocalSigner(generateKeypair().sk);
  await pool.publish((await baueSignalAnfrage({ sitzung: spaet, kopplung: k, ziel: "wss://sfu.example.org", bis: Math.floor(Date.now() / 1000) - 60 })).wrap);
  assert.equal((await provider.pollOnce()).length, 0);
  for (const [s, text] of [[fremd, "Weiterleitung nur für den Besitzer"], [ohne, "Weiterleitung nur für den Besitzer"], [heim, "Anfrage ungültig"], [spaet, "Anruf vorbei"]] as const) {
    const r = await antworten(relay, s);
    assert.ok(!r.some((x) => x.kind === KIND_DVM_SIGNAL + 1000));
    assert.ok(r.some((x) => x.kind === 7000 && x.content.includes(text)), text);
  }
  const leer = await aufbau(false);
  const s = new LocalSigner(generateKeypair().sk);
  await leer.pool.publish((await baueSignalAnfrage({ sitzung: s, kopplung: leer.k, ziel: "wss://sfu.example.org", bis })).wrap);
  await leer.provider.pollOnce();
  assert.ok((await antworten(leer.relay, s)).some((x) => x.kind === 7000 && x.content.includes("keine Weiterleitung")));
});

test("B-34e1: main.ts – nur mit eigenem Relay, mit Tor über den Proxy, ohne Tor nur öffentliche Ziele, an Provider und Relay", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const signal = process\.env\.RELAY_ENABLED === "1"\n\s+\? new SignalWeiterleitung\(\{\n\s+verbinde: torProxy \? torWsVerbindung\(torProxy\) : direktVerbinden,\n\s+pruefeZiel: async \(ziel\) => !!torProxy \|\| \(await checkUrlSafe\(ziel\.replace\(\/\^wss:\/, "https:"\)\)\)\.allowed,/);
  assert.match(main, /livekit,\n\s+signal,\n/);
  assert.match(main, /app: appGeladen\?\.ok \? appGeladen\.app : undefined,\n\s+signal,\n\s+\}\);\n\s+await relayRole\.start\(\);\n\s+statusRollen\.add\("relay"\);\n\s+if \(signal\) \{\n\s+statusRollen\.add\("signal"\);/);
  // keine zweite Verbindung zum SFU am Tor vorbei
  const quelle = readFileSync(new URL("../src/signal-weiterleitung.ts", import.meta.url), "utf8");
  assert.equal(quelle.match(/new WebSocket\(/g)?.length, 1, "nur `direktVerbinden`");
  assert.match(quelle, /this\.o\.verbinde\(url, /);
});
