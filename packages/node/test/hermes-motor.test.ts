/**
 * Hermes als Motor in der Sandbox (VKc3): Das Modell erreicht er nur über die Brücke – einen Unix-Socket, hinter
 * dem nur `GET /v1/models` und `POST /v1/chat/completions` des eigenen Antriebs liegen; die Konfiguration schreibt
 * der Knoten je Projekt außerhalb des Repos und folgt dabei keinem Verweis. Die Tests mit echtem bubblewrap
 * überspringen sich nur, wenn `pruefeSandbox()` hier scheitert. Hermes selbst läuft hier nicht – den Motor ersetzt
 * ein Python-Einzeiler hinter demselben Startskript.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeLaeufe } from "../src/code-motor.js";
import { HERMES_ORDNER, STARTSKRIPT, hermesAusUmgebung, hermesHeim, hermesKonfiguration, hermesMotor } from "../src/hermes-motor.js";
import { BRUECKE_GRENZEN, BRUECKE_IN_SANDBOX, brueckenZiel, oeffneModellBruecke } from "../src/modell-bruecke.js";
import { ProjektAblage } from "../src/projekte.js";
import { fuehreAus, pruefeSandbox, sandboxArgumente } from "../src/sandbox.js";

const pruefung = await pruefeSandbox();
const ohne = !pruefung.ok && `Sandbox geht hier nicht (${pruefung.fall})`;
const tmp = (n: string) => mkdtempSync(join(tmpdir(), `vkc3-${n}-`));

/** Ein Antrieb auf 127.0.0.1, der jede Anfrage merkt und je Weg eine feste Antwort gibt (Strom in zwei Teilen). */
async function antriebAttrappe() {
  const gesehen: Array<{ methode: string; pfad: string; kopf: IncomingHttpHeaders; koerper: string }> = [];
  const server = createServer((req, res) => {
    let koerper = "";
    req.on("data", (b) => (koerper += b));
    req.on("end", () => {
      gesehen.push({ methode: req.method!, pfad: req.url!, kopf: req.headers, koerper });
      if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end('{"data":[{"id":"coder:7b"}]}');
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: eins\n\n");
      setTimeout(() => res.end("data: [DONE]\n\n"), 20);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { gesehen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, zu: () => server.close() };
}

/** Anfrage über den Socket der Brücke. */
function ueberSockel(sockel: string, methode: string, pfad: string, koerper?: string | Buffer, kopf: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; typ?: string }>((fertig, scheitern) => {
    const r = request({ socketPath: sockel, method: methode, path: pfad, headers: kopf }, (res) => {
      let text = "";
      res.on("data", (b) => (text += b));
      res.on("end", () => fertig({ status: res.statusCode!, text, typ: res.headers["content-type"] }));
    });
    r.on("error", scheitern);
    r.end(koerper);
  });
}

test("VKc3: Brücke – nur zwei Wege zum eigenen Antrieb, Schlüssel erst im Knoten, Kopfzeilen aus der Sandbox bleiben draußen", async () => {
  const a = await antriebAttrappe();
  const bruecke = await oeffneModellBruecke({ art: "openai", url: `${a.url}/v1`, schluessel: "geheim-des-antriebs-0123456789abcdef" });
  try {
    assert.equal((statSync(bruecke.ordner).mode & 0o777).toString(8), "700");
    const modelle = await ueberSockel(bruecke.sockel, "GET", "/v1/models");
    assert.deepEqual([modelle.status, modelle.text], [200, '{"data":[{"id":"coder:7b"}]}']);
    const strom = await ueberSockel(bruecke.sockel, "POST", "/v1/chat/completions", '{"model":"coder:7b"}', { authorization: "Bearer aus-der-sandbox", "x-weiter": "nein" });
    assert.deepEqual([strom.status, strom.typ, strom.text], [200, "text/event-stream", "data: eins\n\ndata: [DONE]\n\n"]);
    const post = a.gesehen.find((g) => g.methode === "POST")!;
    assert.equal(post.pfad, "/v1/chat/completions");
    assert.equal(post.koerper, '{"model":"coder:7b"}');
    assert.equal(post.kopf.authorization, "Bearer geheim-des-antriebs-0123456789abcdef");
    assert.equal(post.kopf["x-weiter"], undefined);
    // alles andere: nicht hier – nie ein anderer Pfad, nie eine andere Methode
    const vorher = a.gesehen.length;
    for (const [m, p] of [["GET", "/v1/chat/completions"], ["POST", "/v1/models"], ["GET", "/api/tags"], ["POST", "/v1/embeddings"], ["GET", "http://example.org/v1/models"], ["GET", "/v1/models/../../x"]]) {
      assert.equal((await ueberSockel(bruecke.sockel, m!, p!)).status, 404, `${m} ${p}`);
    }
    assert.equal(a.gesehen.length, vorher, "nichts davon erreicht den Antrieb");
    assert.deepEqual(await ueberSockel(bruecke.sockel, "POST", "/v1/chat/completions", Buffer.alloc(BRUECKE_GRENZEN.anfrageBytes + 1, 0x20)).then((r) => [r.status, r.text]), [413, "zu gross"]);
    assert.equal(a.gesehen.length, vorher, "auch das nicht");
  } finally {
    bruecke.schliesse();
    a.zu();
  }
  assert.ok(!existsSync(bruecke.ordner), "der Ordner des Sockets ist danach weg");
});

test("VKc3: Brücke – Ollama über seinen OpenAI-Weg, unerreichbar mit festem Text", async () => {
  assert.equal(brueckenZiel({ art: "ollama", url: "http://localhost:11434" }, "POST", "/v1/chat/completions"), "http://localhost:11434/v1/chat/completions");
  assert.equal(brueckenZiel({ art: "openai", url: "http://127.0.0.1:8000/v1" }, "GET", "/v1/models"), "http://127.0.0.1:8000/v1/models");
  assert.equal(brueckenZiel({ art: "ollama", url: "http://localhost:11434" }, "DELETE", "/v1/models"), null);
  const bruecke = await oeffneModellBruecke({ art: "ollama", url: "http://127.0.0.1:9" }, { fetchImpl: async () => { throw new Error("ECONNREFUSED 127.0.0.1:9 geheim"); } });
  try {
    assert.deepEqual(await ueberSockel(bruecke.sockel, "GET", "/v1/models").then((r) => [r.status, r.text]), [502, "Modell nicht erreichbar"]);
  } finally {
    bruecke.schliesse();
  }
});

test("VKc3: Umgebung – Hermes im venv, Modellname geprüft; ungültig hält den Start an, fehlend nur den Motor", () => {
  const venv = tmp("venv");
  assert.deepEqual(hermesAusUmgebung({ HERMES_ORDNER: venv }), { fehlt: `Hermes fehlt in ${venv} (bin/python, bin/hermes-acp) – Vibecoden ohne Motor` });
  mkdirSync(join(venv, "bin"));
  for (const d of ["python", "hermes-acp"]) writeFileSync(join(venv, "bin", d), "");
  assert.deepEqual(hermesAusUmgebung({ HERMES_ORDNER: `${venv}/` }), { hermes: { ordner: venv } });
  assert.deepEqual(hermesAusUmgebung({ HERMES_ORDNER: venv, CODE_MODELL: " qwen3-coder:30b " }), { hermes: { ordner: venv, modell: "qwen3-coder:30b" } });
  for (const falsch of ["hermes", "/opt/../etc", "/"]) assert.ok("ungueltig" in hermesAusUmgebung({ HERMES_ORDNER: falsch }), falsch);
  for (const falsch of ["a b", "-x", "x;rm", "ä".repeat(3)]) assert.ok("ungueltig" in hermesAusUmgebung({ HERMES_ORDNER: venv, CODE_MODELL: falsch }), falsch);
  assert.equal(HERMES_ORDNER, "/opt/hermes");
  if (!existsSync(join(HERMES_ORDNER, "bin", "hermes-acp"))) assert.ok("fehlt" in hermesAusUmgebung({}));
});

test("VKc3: Konfiguration – Modell nur über die Brücke, Freigaben manual, keine Nachinstallation; Home neben dem Projekt", () => {
  const k = JSON.parse(hermesKonfiguration("coder:7b"));
  assert.deepEqual(k.model, { provider: "custom", base_url: "http://127.0.0.1:8080/v1", default: "coder:7b", api_key: "bruecke" });
  assert.equal(k.approvals.mode, "manual", "nie smart – das fragte ein zweites Modell");
  assert.equal(k.security.allow_lazy_installs, false);
  assert.ok(!/openrouter|nous|portal/i.test(JSON.stringify(k)));
  assert.throws(() => hermesKonfiguration("x y"));
  const ablage = new ProjektAblage("/home/n/.freedom/projekte");
  assert.equal(hermesHeim(ablage, ablage.ort("app")), "/home/n/.freedom/hermes/app", "nie im Repo – sonst landeten Gedächtnis und Skills im Commit");
});

test("VKc3: Motor – Konfiguration vor jedem Start, nie durch einen Verweis; ohne Modell kein Start", () => {
  const ablage = new ProjektAblage(join(tmp("ablage"), "projekte"));
  mkdirSync(ablage.ort("app"), { recursive: true });
  const motor = (modell?: string) => hermesMotor({ hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: tmp("b") }, modell: () => modell, bwrap: "/gibt/es/nicht" });
  assert.throws(() => motor()(ablage.ort("app")), { name: "KeinModell" });
  motor("coder:7b")(ablage.ort("app")).beende();
  const datei = join(hermesHeim(ablage, ablage.ort("app")), ".hermes", "config.yaml");
  assert.equal(JSON.parse(readFileSync(datei, "utf8")).model.default, "coder:7b");
  assert.equal((statSync(datei).mode & 0o777).toString(8), "600");
  // Der Motor des letzten Laufs ersetzt die Datei durch einen Verweis – der Knoten schreibt nie dorthin
  const ziel = join(tmp("ziel"), "node-key");
  writeFileSync(ziel, "schluessel");
  rmSync(datei);
  symlinkSync(ziel, datei);
  motor("coder:7b")(ablage.ort("app")).beende();
  assert.equal(readFileSync(ziel, "utf8"), "schluessel");
  assert.equal(JSON.parse(readFileSync(datei, "utf8")).model.default, "coder:7b");
  // ein Verweis statt des Ordners: kein Start
  const heim2 = hermesHeim(ablage, ablage.ort("zwei"));
  symlinkSync(tmp("fremd"), heim2);
  assert.throws(() => motor("coder:7b")(ablage.ort("zwei")), { name: "HeimKaputt" });
});

test("VKc3: Sandbox – weitere Orte nur lesbar, nie über /arbeit", () => {
  const arbeit = tmp("arbeit");
  const a = sandboxArgumente({ arbeit, nurLesbar: [{ quelle: "/opt/hermes", ziel: "/opt/hermes" }, { quelle: "/b", ziel: "/bruecke" }] }, "/e");
  assert.ok(a.join(" ").includes("--ro-bind /opt/hermes /opt/hermes --ro-bind /b /bruecke"));
  assert.ok(a.indexOf("--ro-bind", a.indexOf(arbeit)) > a.indexOf(arbeit), "nach dem Arbeitsordner");
  for (const ziel of ["/arbeit", "/arbeit/x", "relativ", "/a/../arbeit"]) assert.throws(() => sandboxArgumente({ arbeit, nurLesbar: [{ quelle: "/b", ziel }] }, "/e"), ziel);
});

test("VKc3 (bubblewrap): durch die Brücke zum Modell – ohne Netz, Socket nur lesbar, Startskript reicht weiter", { skip: ohne }, async () => {
  const a = await antriebAttrappe();
  const bruecke = await oeffneModellBruecke({ art: "openai", url: `${a.url}/v1` });
  try {
    const holen = `import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}/v1/models", timeout=10).read().decode())`;
    const nurLesbar = [{ quelle: STARTSKRIPT, ziel: "/freedom/motor.py" }, { quelle: bruecke.ordner, ziel: BRUECKE_IN_SANDBOX.ordner }];
    const r = await fuehreAus(["python3", "/freedom/motor.py", BRUECKE_IN_SANDBOX.sockel, String(BRUECKE_IN_SANDBOX.port), "--", "python3", "-c", holen], { arbeit: tmp("arbeit"), nurLesbar });
    assert.deepEqual([r.code, r.ausgabe.trim()], [0, '{"data":[{"id":"coder:7b"}]}']);
    // der Antrieb direkt ist aus der Sandbox nicht erreichbar, und in den Ordner der Brücke schreibt sie nicht
    const direkt = `import urllib.request; urllib.request.urlopen("${a.url}/v1/models", timeout=3)`;
    assert.notEqual((await fuehreAus(["python3", "-c", direkt], { arbeit: tmp("arbeit"), nurLesbar })).code, 0);
    assert.notEqual((await fuehreAus(["/bin/sh", "-c", "echo x > /bruecke/neu"], { arbeit: tmp("arbeit"), nurLesbar })).code, 0);
  } finally {
    bruecke.schliesse();
    a.zu();
  }
});

test("VKc3: der Motor sieht das Projekt unter seinem Ort in der Sandbox", async () => {
  const ablage = new ProjektAblage(join(tmp("ort"), "projekte"));
  const { agent, PROTOCOL_VERSION } = await import("@agentclientprotocol/sdk");
  let cwd = "";
  const app = agent({ name: "attrappe" })
    .onRequest("initialize", () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest("session/new", ({ params }) => { cwd = params.cwd; return { sessionId: "s" }; })
    .onRequest("session/prompt", () => ({ stopReason: "end_turn" as const }));
  const l = new CodeLaeufe({ ablage, motor: () => ({ strom: app, beende: () => {}, ort: "/arbeit" }) });
  const e = await l.starte("a".repeat(64), { projekt: "app", text: "x", modus: "frei" }, () => {});
  assert.equal(e.ende, "fertig");
  assert.equal(cwd, "/arbeit");
});
