/**
 * Dev-Server der Vorschau (VKg1c): nur mit Skript `dev` in einer echten `package.json`, in der Sandbox ohne Netz, erreichbar
 * nur über den Socket im eigenen Ordner; höchstens drei, nach Leerlauf beendet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_GRENZEN, DEV_IN_SANDBOX, DEV_PORT, DevServer, devBefehl } from "../src/dev-server.js";
import { ProjektAblage } from "../src/projekte.js";
import { pruefeSandbox, sandboxArgumente } from "../src/sandbox.js";

const pruefung = await pruefeSandbox();
const ohne = !pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`;
const tmp = (n: string) => mkdtempSync(join(tmpdir(), `vkg1c-${n}-`));

function ablage(...projekte: string[]) {
  const a = new ProjektAblage(join(tmp("ablage"), "projekte"));
  for (const p of projekte) mkdirSync(a.ort(p), { recursive: true });
  return a;
}

test("VKg1c: Befehl – nur mit Skript dev in einer echten package.json", () => {
  const a = ablage("app", "ohne", "verweis", "kaputt", "gross");
  writeFileSync(join(a.ort("app"), "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build" } }));
  assert.deepEqual(devBefehl(a.ort("app")), ["npm", "run", "dev"]);
  writeFileSync(join(a.ort("ohne"), "package.json"), JSON.stringify({ scripts: { build: "vite build", dev: " " } }));
  assert.equal(devBefehl(a.ort("ohne")), null);
  symlinkSync(join(a.ort("app"), "package.json"), join(a.ort("verweis"), "package.json"));
  assert.equal(devBefehl(a.ort("verweis")), null, "ein Verweis zählt nicht");
  writeFileSync(join(a.ort("kaputt"), "package.json"), "{ kein json");
  assert.equal(devBefehl(a.ort("kaputt")), null);
  writeFileSync(join(a.ort("gross"), "package.json"), JSON.stringify({ scripts: { dev: "vite" }, x: "a".repeat(DEV_GRENZEN.paketBytes) }));
  assert.equal(devBefehl(a.ort("gross")), null);
  assert.equal(devBefehl(a.ort("app") + "-gibt-es-nicht"), null);
});

test("VKg1c: Sandbox – der Ordner des Sockets schreibbar, nie über /arbeit", () => {
  const a = sandboxArgumente({ arbeit: "/p", schreibbar: [{ quelle: "/tmp/dev", ziel: DEV_IN_SANDBOX.ordner }] }, "/etc-x");
  const i = a.indexOf("/tmp/dev");
  assert.deepEqual(a.slice(i - 1, i + 2), ["--bind", "/tmp/dev", "/vorschau"]);
  for (const ziel of ["/arbeit", "/arbeit/x", "relativ", "/a/../b"]) {
    assert.throws(() => sandboxArgumente({ arbeit: "/p", schreibbar: [{ quelle: "/tmp/dev", ziel }] }, "/etc-x"), /Ziel ungültig/, ziel);
  }
});

/** Ein Dev-Server als Attrappe: lauscht am Socket im Ordner, den der Knoten schreibbar einbindet. */
function attrappe() {
  const gestartet: Array<{ befehl: readonly string[]; beendet: boolean }> = [];
  const starte = (befehl: readonly string[], ort: { schreibbar?: ReadonlyArray<{ quelle: string }> }) => {
    const eintrag = { befehl, beendet: false };
    gestartet.push(eintrag);
    const server = createServer((s) => s.end("HTTP/1.0 200 OK\r\n\r\nhallo"));
    server.listen(join(ort.schreibbar![0]!.quelle, "dev.sock"));
    let ende!: () => void;
    const p = new Promise<void>((r) => (ende = r));
    return { ende: p, beende: () => { eintrag.beendet = true; server.close(() => ende()); } };
  };
  return { gestartet, starte };
}

test("VKg1c: höchstens drei, je Projekt einer, nach Leerlauf beendet – ohne Skript keiner", async () => {
  let jetzt = 1_000_000;
  const a = ablage("a", "b", "c", "d", "ohne");
  const t = attrappe();
  const dev = new DevServer(a, { jetzt: () => jetzt, starte: t.starte, befehl: (o) => (o.endsWith("ohne") ? null : ["npm", "run", "dev"]) });
  assert.equal(await dev.sockel("ohne"), null);
  const sa = await dev.sockel("a");
  assert.ok(sa && existsSync(sa));
  assert.equal(await dev.sockel("a"), sa, "derselbe");
  assert.ok(await dev.sockel("b"));
  assert.ok(await dev.sockel("c"));
  assert.equal(await dev.sockel("d"), null, "kein Platz mehr");
  assert.equal(t.gestartet.length, 3);
  assert.deepEqual(t.gestartet[0]!.befehl.slice(0, 5), ["python3", "/freedom/motor.py", "--zurueck", DEV_IN_SANDBOX.sockel, String(DEV_PORT)]);
  assert.deepEqual(t.gestartet[0]!.befehl.slice(5), ["--", "/usr/bin/env", `PORT=${DEV_PORT}`, "HOST=127.0.0.1", "npm", "run", "dev"]);
  jetzt += DEV_GRENZEN.leerlaufMs - 1;
  await dev.sockel("a"); // a war gerade dran
  jetzt += 2;
  dev.raeumeAuf();
  assert.deepEqual(t.gestartet.map((g) => g.beendet), [false, true, true], "nur die ohne Anfrage");
  assert.equal(dev.hat("a"), true);
  dev.beendeAlle();
  assert.equal(dev.hat("a"), false);
  assert.ok(t.gestartet.every((g) => g.beendet));
});

test("VKg1c (bubblewrap): Dev-Server in der Sandbox, erreichbar nur über den Socket; endet mit beende()", { skip: ohne }, async () => {
  const a = ablage("app");
  writeFileSync(join(a.ort("app"), "seite.html"), "<h1>live</h1>");
  const dev = new DevServer(a, { befehl: () => ["python3", "-m", "http.server", String(DEV_PORT), "--bind", "127.0.0.1"] });
  try {
    const sockel = await dev.sockel("app");
    assert.ok(sockel, "der Server antwortet");
    const antwort = await new Promise<string>((fertig, scheitern) => {
      const r = request({ socketPath: sockel!, path: "/seite.html", headers: { host: "localhost" } }, (res) => {
        let t = "";
        res.on("data", (b) => (t += b));
        res.on("end", () => fertig(t));
      });
      r.on("error", scheitern);
      r.end();
    });
    assert.equal(antwort, "<h1>live</h1>");
  } finally {
    dev.beendeAlle();
  }
});

/** Ein Dev-Server am Socket: antwortet mit dem, was ankam; WebSocket als Echo nach dem Handschlag. */
async function echoDev() {
  const { createServer: httpServer } = await import("node:http");
  const ordner = tmp("echo");
  const sockel = join(ordner, "dev.sock");
  const server = httpServer((req, res) => {
    let koerper = "";
    req.on("data", (b) => (koerper += b));
    req.on("end", () => {
      res.writeHead(201, { "content-type": "application/json", "set-cookie": "app=1" });
      res.end(JSON.stringify({ methode: req.method, pfad: req.url, host: req.headers.host, origin: req.headers.origin ?? null, cookie: req.headers.cookie ?? null, referer: req.headers.referer ?? null, koerper }));
    });
  });
  server.on("upgrade", (req, s) => {
    s.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Host: ${req.headers.host}\r\nX-Origin: ${req.headers.origin}\r\nX-Cookie: ${req.headers.cookie ?? "-"}\r\n\r\n`);
    s.on("data", (b: Buffer) => s.write(Buffer.concat([Buffer.from("echo:"), b])));
  });
  await new Promise<void>((r) => server.listen(sockel, r));
  return { sockel, zu: () => server.close() };
}

test("VKg1c: Vorschau leitet an den Dev-Server – jede Methode, Host und Origin lokal, ohne das eigene Cookie; WebSocket für Hot Reload", async () => {
  const { VORSCHAU_COOKIE, VorschauServer } = await import("../src/vorschau.js");
  const { connect } = await import("node:net");
  const a = ablage("app", "statisch");
  writeFileSync(join(a.ort("statisch"), "index.html"), "<h1>Dateien</h1>");
  const echo = await echoDev();
  const v = new VorschauServer(a, { basis: "http://knoten.example:3603", port: 0, host: "127.0.0.1" });
  v.nutzeDev({ sockel: async (p: string) => (p === "app" ? echo.sockel : null) });
  const port = await v.starte();
  const zeichen = (p: string) => new URL(v.adresse(p)).pathname.slice(1, -1);
  const hole = (pfad: string, cookie: string, methode = "GET", koerper?: string) =>
    new Promise<{ status: number; kopf: Record<string, unknown>; text: string }>((fertig, scheitern) => {
      const r = request({ host: "127.0.0.1", port, path: pfad, method: methode, agent: false, headers: { cookie, origin: "http://knoten.example:3603", referer: "http://knoten.example:3603/geheim" } }, (res) => {
        let t = "";
        res.on("data", (b) => (t += b));
        res.on("end", () => fertig({ status: res.statusCode!, kopf: res.headers, text: t }));
      });
      r.on("error", scheitern);
      r.end(koerper);
    });
  try {
    const cookie = `app=0; ${VORSCHAU_COOKIE}=${zeichen("app")}`;
    const r = await hole("/api/zaehler?x=1", cookie, "POST", '{"n":1}');
    assert.equal(r.status, 201);
    assert.deepEqual(r.kopf["set-cookie"], ["app=1"], "Cookies der App bleiben");
    assert.deepEqual(JSON.parse(r.text), { methode: "POST", pfad: "/api/zaehler?x=1", host: "localhost:5173", origin: "http://localhost:5173", cookie: "app=0", referer: null, koerper: '{"n":1}' });
    // ohne Dev-Server: die Dateien wie bisher, und nur lesen
    const stat = `${VORSCHAU_COOKIE}=${zeichen("statisch")}`;
    assert.equal((await hole("/", stat)).text, "<h1>Dateien</h1>");
    assert.equal((await hole("/", stat, "POST")).status, 405);
    // WebSocket: nur mit Cookie, Kopfzeilen wie bei HTTP, danach in beide Richtungen
    const ws = (mitCookie: string) => new Promise<string>((fertig) => {
      const s = connect(port, "127.0.0.1");
      let t = "";
      s.on("connect", () => s.write(`GET /?token=t HTTP/1.1\r\nHost: knoten.example:3603\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: http://knoten.example:3603\r\nCookie: ${mitCookie}\r\n\r\n`));
      s.on("data", (b) => {
        t += b;
        if (t.includes("\r\n\r\n") && !t.includes("echo:")) s.write("hallo");
        if (t.includes("echo:hallo")) s.destroy();
      });
      s.on("close", () => fertig(t));
      s.on("error", () => fertig(t));
    });
    const offen = await ws(cookie);
    assert.match(offen, /^HTTP\/1.1 101/);
    assert.match(offen, /X-Host: localhost:5173\r\nX-Origin: http:\/\/localhost:5173\r\nX-Cookie: app=0\r\n/);
    assert.match(offen, /echo:hallo$/);
    assert.equal(await ws(`${VORSCHAU_COOKIE}=${"ab".repeat(32)}`), "", "ohne gültiges Cookie zu");
    assert.equal(await ws(stat), "", "ohne Dev-Server zu");
  } finally {
    await v.schliesse();
    echo.zu();
  }
});
