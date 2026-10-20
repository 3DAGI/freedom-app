/**
 * Bildstrom für Programme ohne Web (VKg2a2): Bild und Programm in zwei Sandboxen – den Zugang zum TURN, den Tunnel und die
 * Antwort an die App sieht nur die Bild-Sandbox; das Programm teilt mit ihr nur den Socket des Bildschirms. Angebot und
 * Antwort nur mit Relay-Kandidaten, je Projekt ein Bild, höchstens zwei.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { connect, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  KIND_DVM_KNOTEN_CODE, LocalSigner, MemoryRelay, OutboxPool, baueCodeAuftrag, generateKeypair, getTag, istBildSdp,
  leseCodeAntwort, neueKopplung, openPrivateJobResponse, type CodeAktion,
} from "@freedomstack/protocol";
import { BILD_GRENZEN, BILD_IN_SANDBOX, BildStrom, WEB_DEV_START, bildBefehl, bildFehlt, browserArgumente } from "../src/bildstrom.js";
import { DEV_PORT } from "../src/dev-server.js";
import { BROWSER_ORTE } from "../src/mcp-katalog.js";
import { DvmProvider } from "../src/dvm-provider.js";
import { CodeAbgelehnt, ProjektAblage } from "../src/projekte.js";
import { pruefeSandbox, type sandboxDienst } from "../src/sandbox.js";
import { turnZugang } from "../src/turn.js";

const tmp = (n: string) => mkdtempSync(join(tmpdir(), `vkg2a2-${n}-`));
const FINGER = `a=fingerprint:sha-256 ${Array(32).fill("AB").join(":")}`;
const sdp = (...kandidaten: string[]) => ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", FINGER, ...kandidaten.map((k) => `a=${k}`), ""].join("\r\n");
const RELAY = "candidate:1 1 udp 33562623 203.0.113.9 49160 typ relay raddr 0.0.0.0 rport 0";
const ANGEBOT = sdp(RELAY);
const ANTWORT = sdp("candidate:4 1 UDP 337641727 203.0.113.9 49170 typ relay raddr 127.0.0.1 rport 9");
const TURN = { urls: ["turn:turn.example:3478?transport=tcp"], geheimnis: "g".repeat(40), gueltigSek: 600 };
const ZIEL = { host: "127.0.0.1", port: 9, tls: false };

function ablage(...projekte: string[]) {
  const a = new ProjektAblage(join(tmp("ablage"), "projekte"));
  for (const p of projekte) mkdirSync(a.ort(p), { recursive: true });
  return a;
}

test("VKg2a2: Programm – .freedom/start, sonst main.py (mit .venv), nur echte Dateien", () => {
  const a = ablage("start", "py", "venv", "nichts", "verweis", "ordner-verweis");
  mkdirSync(join(a.ort("start"), ".freedom"));
  writeFileSync(join(a.ort("start"), ".freedom", "start"), "python3 spiel.py\n");
  writeFileSync(join(a.ort("start"), "main.py"), "");
  assert.deepEqual(bildBefehl(a.ort("start")), ["/bin/sh", "/arbeit/.freedom/start"]);
  writeFileSync(join(a.ort("py"), "main.py"), "");
  assert.deepEqual(bildBefehl(a.ort("py")), ["python3", "/arbeit/main.py"]);
  writeFileSync(join(a.ort("venv"), "main.py"), "");
  mkdirSync(join(a.ort("venv"), ".venv", "bin"), { recursive: true });
  symlinkSync("/usr/bin/python3", join(a.ort("venv"), ".venv", "bin", "python3"));
  assert.deepEqual(bildBefehl(a.ort("venv")), ["/arbeit/.venv/bin/python3", "/arbeit/main.py"]);
  assert.equal(bildBefehl(a.ort("nichts")), null);
  symlinkSync(join(a.ort("py"), "main.py"), join(a.ort("verweis"), "main.py"));
  assert.equal(bildBefehl(a.ort("verweis")), null, "ein Verweis zählt nicht");
  symlinkSync(join(a.ort("start"), ".freedom"), join(a.ort("ordner-verweis"), ".freedom"));
  assert.equal(bildBefehl(a.ort("ordner-verweis")), null, "auch kein Ordner hinter einem Verweis");
});

test("VKg2c1: Web-Projekte mit Browser – Dev-Server, sonst index.html; Programme gehen vor, ohne Browser kein Web", () => {
  const a = ablage("dev", "seite", "beides", "py", "leer", "verweis");
  const web = { browser: "/usr/lib/chromium/chromium", breite: 800, hoehe: 600 };
  writeFileSync(join(a.ort("dev"), "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  writeFileSync(join(a.ort("dev"), "index.html"), "<p>");
  assert.deepEqual(bildBefehl(a.ort("dev"), web),
    ["/bin/sh", "-c", WEB_DEV_START, web.browser, ...browserArgumente(web, `http://127.0.0.1:${DEV_PORT}/`)]);
  writeFileSync(join(a.ort("seite"), "index.html"), "<p>");
  writeFileSync(join(a.ort("seite"), "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
  assert.deepEqual(bildBefehl(a.ort("seite"), web), [web.browser, ...browserArgumente(web, "file:///arbeit/index.html")]);
  writeFileSync(join(a.ort("py"), "main.py"), "");
  writeFileSync(join(a.ort("py"), "index.html"), "<p>");
  assert.deepEqual(bildBefehl(a.ort("py"), web), ["python3", "/arbeit/main.py"], "ein Programm geht vor");
  assert.equal(bildBefehl(a.ort("seite")), null, "ohne Browser kein Web");
  assert.equal(bildBefehl(a.ort("leer"), web), null);
  symlinkSync(join(a.ort("seite"), "index.html"), join(a.ort("verweis"), "index.html"));
  assert.equal(bildBefehl(a.ort("verweis"), web), null, "ein Verweis zählt nicht");
  const arg = browserArgumente(web, "file:///arbeit/index.html");
  for (const x of ["--no-sandbox", "--kiosk", "--window-size=800,600", "--user-data-dir=/tmp/chromium", "--disable-background-networking"]) assert.ok(arg.includes(x), x);
  assert.equal(arg.at(-1), "file:///arbeit/index.html");
});

test("VKg2c1: Dev-Server im Bild – erst `npm run dev` mit PORT und HOST, Chromium erst, wenn er antwortet", { timeout: 30_000 }, async () => {
  const d = tmp("devstart");
  // ein npm, das wie Vite nach einer Weile auf PORT lauscht, und ein Browser, der nur aufschreibt, womit er kam
  writeFileSync(join(d, "npm"), `#!/bin/sh\necho "$PORT $HOST $*" > "${d}/npm.txt"\nsleep 1\nexec python3 -m http.server "$PORT" --bind "$HOST"\n`);
  writeFileSync(join(d, "browser"), `#!/bin/sh\npython3 -c 'import urllib.request,sys; urllib.request.urlopen(sys.argv[1], timeout=5)' "$2" && echo "$*" > "${d}/browser.txt"\nkill 0\n`);
  for (const f of ["npm", "browser"]) chmodSync(join(d, f), 0o755);
  const sh = spawn("/bin/sh", ["-c", WEB_DEV_START, join(d, "browser"), "--kiosk", `http://127.0.0.1:${DEV_PORT}/`],
    { env: { PATH: `${d}:/usr/bin:/bin` }, stdio: "ignore", detached: true });
  await new Promise((r) => sh.once("close", r));
  try {
    process.kill(-sh.pid!);
  } catch { /* schon zu */ }
  assert.equal(readFileSync(join(d, "npm.txt"), "utf8"), `${DEV_PORT} 127.0.0.1 run dev\n`);
  assert.equal(readFileSync(join(d, "browser.txt"), "utf8"), `--kiosk http://127.0.0.1:${DEV_PORT}/\n`, "der Browser kam erst, als der Server antwortete");
});

/** Statt bubblewrap: merkt sich, was gestartet würde, und spielt die Bild-Sandbox nach (`antworte`). */
function attrappe(antworte: (eingabe: { turn: string; angebot: string }) => string | null, o: { programmEndet?: boolean } = {}) {
  const starts: Array<{ befehl: readonly string[]; ort: Parameters<typeof sandboxDienst>[1]; beendet: boolean }> = [];
  const starte = ((befehl, ort) => {
    const eintrag = { befehl, ort, beendet: false };
    starts.push(eintrag);
    let fertig!: () => void;
    const ende = new Promise<void>((r) => { fertig = r; });
    const beende = () => { eintrag.beendet = true; fertig(); };
    if (!ort.mitEinAusgabe) {
      if (o.programmEndet) setTimeout(beende, 10);
      return { ende, beende };
    }
    const ein = new PassThrough(), aus = new PassThrough();
    void ende.then(() => aus.end());
    let text = "";
    ein.on("data", (b: Buffer) => {
      text += b.toString();
      if (!text.endsWith("\n")) return;
      // der Bildschirm steht: Socket im geteilten Ordner
      writeFileSync(join(ort.schreibbar!.find((s) => s.ziel === BILD_IN_SANDBOX.x11)!.quelle, "X99"), "");
      const z = antworte(JSON.parse(text));
      setTimeout(() => (z === null ? beende() : aus.write(`${z}\n`)), 30);
    });
    return { ende, beende, ein, aus };
  }) as typeof sandboxDienst;
  return { starte, starts };
}

const abgelehnt = (fall: string) => (e: unknown) => e instanceof CodeAbgelehnt && e.fall === fall;

test("VKg2a2: zwei Sandboxen – Zugang, Tunnel und Antwort nur im Bild, das Programm sieht nur den Bildschirm", async () => {
  const a = ablage("spiel");
  writeFileSync(join(a.ort("spiel"), "main.py"), "");
  let eingabe: { turn: string; angebot: string } | undefined;
  const { starte, starts } = attrappe((e) => { eingabe = e; return JSON.stringify({ antwort: ANTWORT }); });
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte });
  assert.equal(await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), ANTWORT);
  assert.equal(starts.length, 2);
  const [bild, programm] = starts as [typeof starts[0], typeof starts[0]];
  assert.deepEqual(bild.befehl, ["python3", "/freedom/motor.py", "/bild/turn.sock", "3478", "--", "python3", "/freedom/bild.py", "640", "480"]);
  assert.equal(bild.ort.mitEinAusgabe, true);
  assert.ok(bild.ort.nurLesbar!.some((s) => s.ziel === BILD_IN_SANDBOX.ordner && existsSync(join(s.quelle, "turn.sock"))), "der Tunnel nur in der Bild-Sandbox");
  assert.notEqual(bild.ort.arbeit, a.ort("spiel"), "das Projekt nicht in der Bild-Sandbox");
  assert.match(eingabe!.turn, /^turn:\/\/\d+%3A[A-Za-z0-9_-]+:[A-Za-z0-9%]+@127\.0\.0\.1:3478\?transport=tcp$/);
  assert.equal(eingabe!.angebot, ANGEBOT);
  assert.deepEqual(programm.befehl, ["/usr/bin/env", "DISPLAY=:99", "python3", "/arbeit/main.py"]);
  assert.equal(programm.ort.arbeit, a.ort("spiel"));
  assert.equal(programm.ort.mitEinAusgabe, undefined, "keine Ein- und Ausgabe für Code des Projekts");
  assert.deepEqual(programm.ort.nurLesbar!.map((s) => s.ziel), [BILD_IN_SANDBOX.x11], "nur der Socket des Bildschirms");
  assert.equal(programm.ort.schreibbar, undefined);
  assert.equal(b.hat("spiel"), true);
  assert.equal(b.beende("spiel"), true);
  assert.equal(bild.beendet && programm.beendet, true);
  assert.equal(b.beende("spiel"), false);
});

test("VKg2a2: Ablehnungen – fremde Kandidaten, kein Programm, Fehler im Bild, Programm endet, zu viele", async () => {
  const a = ablage("spiel", "leer", "zwei", "drei");
  for (const p of ["spiel", "zwei", "drei"]) writeFileSync(join(a.ort(p), "main.py"), "");
  const ok = attrappe(() => JSON.stringify({ antwort: ANTWORT }));
  const b = new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: ok.starte });
  for (const falsch of [sdp("candidate:1 1 udp 2122260223 192.168.1.5 50000 typ host"), sdp(), "kein sdp"]) {
    await assert.rejects(b.starte("spiel", falsch, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-fehler"));
  }
  await assert.rejects(b.starte("leer", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-kein-programm"));
  assert.equal(ok.starts.length, 0, "nichts gestartet");

  for (const [name, antwort] of [["fehler", JSON.stringify({ fehler: "gstreamer" })], ["host-kandidat", JSON.stringify({ antwort: sdp("candidate:1 1 udp 1 10.0.0.2 5 typ host") })], ["kaputt", "{"], ["ende", null]] as const) {
    const x = attrappe(() => antwort);
    await assert.rejects(new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: x.starte }).starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-fehler"), name);
    assert.ok(x.starts.every((s) => s.beendet), `${name}: alles beendet`);
  }
  const endet = attrappe(() => null, { programmEndet: true });
  await assert.rejects(new BildStrom(a, { turn: TURN, ziel: ZIEL, starte: endet.starte }).starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-bild-fehler"));

  // je Projekt eins – ein neues Angebot ersetzt das alte; auf dem Knoten höchstens zwei
  await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 });
  await b.starte("spiel", ANGEBOT, { breite: 640, hoehe: 480 });
  assert.equal(ok.starts.filter((s) => s.beendet).length, 2, "das erste Bild samt Programm beendet");
  await b.starte("zwei", ANGEBOT, { breite: 640, hoehe: 480 });
  assert.equal(BILD_GRENZEN.gesamt, 2);
  await assert.rejects(b.starte("drei", ANGEBOT, { breite: 640, hoehe: 480 }), abgelehnt("code-zu-viele"));
  b.beendeAlle();
  assert.equal(b.hat("spiel") || b.hat("zwei"), false);
});

test("VKg2a2: über den Knoten – Angebot und Antwort nur versiegelt, ohne Bild code-bild-aus, bild-ende", async () => {
  const relay = new MemoryRelay(`mem://bild-${randomBytes(4).toString("hex")}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair(), k = neueKopplung(kp.pk);
  const a = ablage("spiel");
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    besitzer: () => [k.geheimnis], projekte: a,
  }, pool);
  const frage = async (aktion: CodeAktion) => {
    const s = new LocalSigner(generateKeypair().sk);
    await pool.publish((await baueCodeAuftrag({ sitzung: s, kopplung: k, aktion })).wrap);
    await provider.pollOnce();
    return (await Promise.all((await relay.query({ kinds: [1059], "#p": [s.publicKey()] })).map((w) => openPrivateJobResponse(w, s))))
      .flatMap((x) => (x.ok ? [x.response] : []));
  };
  const bild: CodeAktion = { aktion: "bild", projekt: "spiel", sdp: ANGEBOT, breite: 1280, hoehe: 720 };
  assert.equal(getTag((await frage(bild)).find((r) => r.kind === 7000)!, "fall"), "code-bild-aus");
  const gesehen: unknown[] = [];
  (provider as unknown as { cfg: { bild?: unknown } }).cfg.bild = {
    starte: async (...x: unknown[]) => { gesehen.push(x); return ANTWORT; },
    beende: (p: string) => p === "spiel",
  };
  const an = leseCodeAntwort((await frage(bild)).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "bild");
  assert.deepEqual(an, { aktion: "bild", sdp: ANTWORT });
  assert.deepEqual(gesehen, [["spiel", ANGEBOT, { breite: 1280, hoehe: 720 }]]);
  const ende = leseCodeAntwort((await frage({ aktion: "bild-ende", projekt: "spiel" })).find((r) => r.kind === KIND_DVM_KNOTEN_CODE + 1000)!.content, "bild-ende");
  assert.deepEqual(ende, { aktion: "bild-ende", ok: true });
  assert.equal((await relay.query({ kinds: [7000, KIND_DVM_KNOTEN_CODE + 1000] })).length, 0, "nie offen");
});

// --- Ende zu Ende: echtes bubblewrap, Xvfb, GStreamer und coturn ---------------------------------------------------

const pruefung = await pruefeSandbox();
const hat = (p: string) => new Promise<boolean>((r) => execFile(p, ["-h"], (e) => r(!e || (e as NodeJS.ErrnoException).code !== "ENOENT")));
/** Ein Python mit PyGObject, GStreamer und python-xlib – je nach Rechner nicht `python3` (hier 3.11 ohne gi). */
let python: string | undefined;
for (const p of ["/usr/bin/python3", "/usr/bin/python3.12", "/usr/bin/python3.11"]) {
  if (existsSync(p) && (await bildFehlt(p)) === null) {
    python = p;
    break;
  }
}
const ohne = !pruefung.ok ? `Sandbox geht hier nicht (${pruefung.fall})`
  : !python ? "GStreamer, PyGObject, python-xlib oder Xvfb fehlen"
  : !((await hat("turnserver"))) ? "coturn fehlt" : false;

const freierPort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return p;
};

/** Ein echtes coturn auf 127.0.0.1 mit freien Ports – `fn` bekommt Zugang und Ziel, danach endet es. */
async function mitCoturn(fn: (turn: { urls: string[]; geheimnis: string; gueltigSek: number }, port: number) => Promise<void>): Promise<void> {
  const ordner = tmp("e2e");
  const geheimnis = randomBytes(32).toString("hex");
  const turnPort = await freierPort();
  const relay = 49_300 + Math.floor(Math.random() * 500) * 10;
  writeFileSync(join(ordner, "turnserver.conf"), [
    "listening-ip=127.0.0.1", `listening-port=${turnPort}`, "relay-ip=127.0.0.1", `min-port=${relay}`, `max-port=${relay + 9}`,
    "realm=freedom", "use-auth-secret", `static-auth-secret=${geheimnis}`, "fingerprint", "no-cli", "no-tls", "no-dtls",
    "allow-loopback-peers", "log-file=/dev/null", "",
  ].join("\n"));
  const coturn = spawn("turnserver", ["-c", join(ordner, "turnserver.conf"), "--no-stdout-log"], { stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) {
      if (await new Promise<boolean>((r) => { const s = connect(turnPort, "127.0.0.1", () => { s.destroy(); r(true); }); s.once("error", () => r(false)); })) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn({ urls: [`turn:127.0.0.1:${turnPort}?transport=tcp`], geheimnis, gueltigSek: 600 }, turnPort);
  } finally {
    coturn.kill();
  }
}

/**
 * Die App spielt `fixtures/bild/empfaenger.py`: Angebot, Antwort vom Knoten (`starte`), Bilder zählen, Eingaben schicken
 * (mit `farbe` erst, wenn das Bild sie zeigt). Bis `gewirkt()` gilt, wartet der Test – mit Frist, nie eine feste Pause;
 * unter Last kommen Eingaben später an. Zurück die Bilder, die Farbe am Ende und die Zeit bis zur Antwort.
 */
async function empfange(turn: { urls: string[]; geheimnis: string; gueltigSek: number }, turnPort: number, eingaben: unknown[],
  starte: (angebot: string) => Promise<string>, gewirkt: (farbe: number[] | null) => boolean, farbe?: number[]):
  Promise<{ bilder: number; farbe: number[] | null; antwortMs: number }> {
  const z = turnZugang(turn);
  const app = spawn(python!, [new URL("./fixtures/bild/empfaenger.py", import.meta.url).pathname,
    `turn://${encodeURIComponent(z.nutzer)}:${encodeURIComponent(z.passwort)}@127.0.0.1:${turnPort}`, JSON.stringify(eingaben),
    ...(farbe ? [JSON.stringify(farbe)] : [])], { stdio: ["pipe", "pipe", "ignore"] });
  const zeilen: Array<Record<string, unknown>> = [];
  let rest = "";
  const warteAuf = (schluessel: string) => new Promise<Record<string, unknown>>((r) => {
    const sieh = () => { const z = zeilen.find((x) => schluessel in x); if (z) r(z); else setTimeout(sieh, 50); };
    sieh();
  });
  app.stdout.on("data", (d: Buffer) => {
    rest += d.toString();
    for (let i = rest.indexOf("\n"); i >= 0; i = rest.indexOf("\n")) { zeilen.push(JSON.parse(rest.slice(0, i))); rest = rest.slice(i + 1); }
  });
  const angebot = (await warteAuf("angebot")).angebot as string;
  assert.ok(istBildSdp(angebot));
  const t0 = Date.now();
  const antwort = await starte(angebot);
  const antwortMs = Date.now() - t0;
  assert.ok(istBildSdp(antwort), "die Antwort nur mit Relay-Kandidaten");
  app.stdin.write(`${JSON.stringify({ antwort })}\n`);
  const letzteFarbe = () => ([...zeilen].reverse().find((z) => "farbe" in z)?.farbe ?? null) as number[] | null;
  for (const bis = Date.now() + 40_000; !gewirkt(letzteFarbe()) && !zeilen.some((z) => "fertig" in z) && Date.now() < bis;) {
    await new Promise((r) => setTimeout(r, 100));
  }
  app.stdin.write(`${JSON.stringify({ ende: true })}\n`);
  const ende = await warteAuf("fertig");
  return { bilder: ende.fertig as number, farbe: ende.farbe as number[] | null, antwortMs };
}

test("VKg2a2/a3: Ende zu Ende – Bild über den TURN, Tasten und Klick kommen im Programm an, nur aus der eigenen Sandbox", { skip: ohne, timeout: 90_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("spiel");
    copyFileSync(new URL("./fixtures/bild/taster.py", import.meta.url), join(a.ort("spiel"), "taster.py"));
    const b = new BildStrom(a, {
      turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python,
      befehl: () => [python!, "/arbeit/taster.py", "/arbeit/tasten.txt"],
    });
    try {
      // Buchstabe, Großbuchstabe ohne Umschalttaste (Handy), Zeichen ohne Taste, Enter, Klick; dann Unsinn, der nichts tut
      const eingaben = [
        { t: "kd", s: "h" }, { t: "ku", s: "h" }, { t: "kd", s: "A" }, { t: "ku", s: "A" }, { t: "kd", s: "ä" }, { t: "ku", s: "ä" },
        { t: "kd", s: "Enter" }, { t: "ku", s: "Enter" }, { t: "d", x: 0.5, y: 0.25, k: 1 }, { t: "u", x: 0.5, y: 0.25, k: 1 },
        { t: "kd", s: "<script>" }, { t: "d", x: 2, y: -1, k: 9 }, { t: "x" }, "kein objekt", { t: "kd", s: "x".repeat(300) },
      ];
      const datei = join(a.ort("spiel"), "tasten.txt");
      const e = await empfange(turn, turnPort, eingaben, (angebot) => b.starte("spiel", angebot, { breite: 640, hoehe: 480 }),
        () => existsSync(datei) && readFileSync(datei, "utf8").includes("klick"), [255, 255, 255]); // weiß: das Fenster des Programms steht
      console.log(`[bild] Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder empfangen, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(e.bilder >= 20, `Bilder angekommen (${e.bilder})`);
      const tasten = readFileSync(datei, "utf8");
      assert.match(tasten, /^bereit\ntaste h\n(taste 0xffe1\n)?taste A\ntaste (adiaeresis|ä)\ntaste \r\nklick 1 320 120\n$/, tasten);
      assert.equal(b.beende("spiel"), true);
    } finally {
      b.beendeAlle();
    }
  });
});

/** Ein Chromium für den echten Test: wie der Knoten, dazu das von Playwright, wo es installiert ist. */
function testBrowser(): string | undefined {
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const vonPlaywright = pw && existsSync(pw)
    ? readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).map((d) => join(pw, d, "chrome-linux", "chrome"))
    : [];
  return [process.env.MCP_TEST_BROWSER, ...BROWSER_ORTE, ...vonPlaywright].find((p) => p && existsSync(p));
}
const browser = testBrowser();

test("VKg2c1: Ende zu Ende – eine Web-Seite in Chromium im Bild, ein Klick über den Datenkanal ändert sie", { skip: ohne || (!browser && "kein Chromium"), timeout: 90_000 }, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("seite");
    writeFileSync(join(a.ort("seite"), "index.html"),
      "<!doctype html><body style='margin:0;height:100vh;background:#00c000' onclick=\"document.body.style.background='#c00000'\"></body>");
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, browser: browser! });
    try {
      const klick = [{ t: "d", x: 0.5, y: 0.5, k: 1 }, { t: "u", x: 0.5, y: 0.5, k: 1 }];
      // vorher grün (darauf wartet der Empfänger), nach dem Klick rot
      const rot = (f: number[] | null) => !!f && f[0]! > 150 && f[1]! < 60 && f[2]! < 60;
      const e = await empfange(turn, turnPort, klick, (angebot) => b.starte("seite", angebot, { breite: 640, hoehe: 480 }), rot, [0, 192, 0]);
      console.log(`[bild] Chromium: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(e.bilder >= 20, `Bilder angekommen (${e.bilder})`);
      assert.ok(rot(e.farbe), `nach dem Klick rot (${JSON.stringify(e.farbe)})`);
    } finally {
      b.beendeAlle();
    }
  });
});

/**
 * npm und node sieht die Sandbox nur, wenn sie wirklich unter `/usr` liegen (im Docker-Bild `/usr/local`) – ein Verweis
 * nach `/opt` zählt nicht. Auf Rechnern mit Node anderswo überspringt sich der Test.
 */
const unterUsr = (namen: string[]) => namen.some((p) => existsSync(p) && realpathSync(p).startsWith("/usr/"));
const npmInSandbox = unterUsr(["/usr/local/bin/npm", "/usr/bin/npm"]) && unterUsr(["/usr/local/bin/node", "/usr/bin/node"]);

test("VKg2c1: Ende zu Ende – ein Web-Projekt mit Dev-Server in Chromium im Bild, ein Klick ändert es", {
  skip: ohne || (!browser && "kein Chromium") || (!npmInSandbox && "npm nicht unter /usr (in der Sandbox nicht sichtbar)"), timeout: 120_000,
}, async () => {
  await mitCoturn(async (turn, turnPort) => {
    const a = ablage("app");
    // wie Vite: lauscht auf PORT und HOST aus der Umgebung
    writeFileSync(join(a.ort("app"), "package.json"), JSON.stringify({ scripts: { dev: "node server.mjs" } }));
    writeFileSync(join(a.ort("app"), "server.mjs"), [
      "import { createServer } from 'node:http';",
      "createServer((_q, a) => a.end(\"<!doctype html><body style='margin:0;height:100vh;background:#00c000' onclick=\\\"document.body.style.background='#c00000'\\\"></body>\"))",
      "  .listen(Number(process.env.PORT), process.env.HOST);",
    ].join("\n"));
    const b = new BildStrom(a, { turn, ziel: { host: "127.0.0.1", port: turnPort, tls: false }, python, browser: browser! });
    try {
      const klick = [{ t: "d", x: 0.5, y: 0.5, k: 1 }, { t: "u", x: 0.5, y: 0.5, k: 1 }];
      const rot = (f: number[] | null) => !!f && f[0]! > 150 && f[1]! < 60 && f[2]! < 60;
      const e = await empfange(turn, turnPort, klick, (angebot) => b.starte("app", angebot, { breite: 640, hoehe: 480 }), rot, [0, 192, 0]);
      console.log(`[bild] Dev-Server: Antwort nach ${e.antwortMs} ms, ${e.bilder} Bilder, Farbe zuletzt ${JSON.stringify(e.farbe)}`);
      assert.ok(rot(e.farbe), `nach dem Klick rot (${JSON.stringify(e.farbe)})`);
    } finally {
      b.beendeAlle();
    }
  });
});
