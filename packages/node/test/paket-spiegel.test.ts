/**
 * Pakete über die Brücke (VKd3): npm und pip im Motor holen nur von der festen Liste, nur per GET, über die Brücke des
 * Knotens; Adressen in Paketlisten und Index zeigen danach auf die Brücke; Grenzen je Abruf und je Stunde.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermesHeim, hermesMotor, paketKonfiguration } from "../src/hermes-motor.js";
import { BRUECKE_IN_SANDBOX, oeffneModellBruecke } from "../src/modell-bruecke.js";
import { PAKET_GRENZEN, type PaketAbruf } from "../src/pakete.js";
import { SPIEGEL_GRENZEN, SpiegelKonto, beantworteSpiegel, spiegelZiel } from "../src/paket-spiegel.js";
import { ProjektAblage } from "../src/projekte.js";

const BASIS = `http://127.0.0.1:${BRUECKE_IN_SANDBOX.port}`;
const tmp = (n: string) => mkdtempSync(join(tmpdir(), `vkd3-${n}-`));

test("VKd3: Ziele – nur npm und PyPI von der Liste, nur Pfade aus Namen, Versionen und Dateinamen", () => {
  assert.deepEqual(spiegelZiel("/npm/react"), { url: "https://registry.npmjs.org/react", registry: "npm", art: "paketliste" });
  assert.deepEqual(spiegelZiel("/npm/@vitejs%2fplugin-react"), { url: "https://registry.npmjs.org/@vitejs%2fplugin-react", registry: "npm", art: "paketliste" });
  assert.deepEqual(spiegelZiel("/npm/@esbuild/linux-arm64/-/linux-arm64-0.25.0.tgz"),
    { url: "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.25.0.tgz", registry: "npm", art: "archiv" });
  assert.deepEqual(spiegelZiel("/pypi/simple/requests/"), { url: "https://pypi.org/simple/requests/", registry: "pypi", art: "index" });
  assert.deepEqual(spiegelZiel("/pypi/files/packages/f9/9b/requests-2.32.3-py3-none-any.whl"),
    { url: "https://files.pythonhosted.org/packages/f9/9b/requests-2.32.3-py3-none-any.whl", registry: "pypi", art: "archiv" });
  for (const falsch of [
    undefined, "", "/", "/npm/", "/npm", "/v1/models", "/mcp", "/npm/../v1/models", "/npm/a/../../x", "/npm/%2e%2e/x", "/npm/a//b",
    "/npm/react?write=true", "/npm/react#x", "/npm/a\\b", "/pypi/simple/", "/pypi/files/", "/pypi/json/requests", "/npm/a b",
    "/npm/http://boese.example/", `/npm/${"a".repeat(SPIEGEL_GRENZEN.pfad)}`, "//registry.npmjs.org/react",
  ]) assert.equal(spiegelZiel(falsch), null, String(falsch));
});

/** Registry-Attrappe: merkt jeden Abruf; je Adresse eine Antwort. */
function registry(antworten: Record<string, { status: number; text?: string; bytes?: number }>) {
  const gesehen: string[] = [];
  const abruf: PaketAbruf = async (url) => {
    gesehen.push(url);
    const a = antworten[url];
    if (!a) return new Response("nicht da", { status: 404 });
    return new Response(a.bytes ? new Uint8Array(a.bytes) : (a.text ?? ""), { status: a.status });
  };
  return { gesehen, abruf };
}

function ueberSockel(sockel: string, methode: string, pfad: string) {
  return new Promise<{ status: number; text: string; typ?: string }>((fertig, scheitern) => {
    const r = request({ socketPath: sockel, method: methode, path: pfad }, (res) => {
      let text = "";
      res.on("data", (b) => (text += b));
      res.on("end", () => fertig({ status: res.statusCode!, text, typ: res.headers["content-type"] }));
    });
    r.on("error", scheitern);
    r.end();
  });
}

test("VKd3: über die Brücke – Paketliste und Index auf die Brücke umgeschrieben, Archive unverändert; sonst feste Absagen", async () => {
  const paketliste = JSON.stringify({ name: "react", versions: { "19.1.0": { dist: { tarball: "https://registry.npmjs.org/react/-/react-19.1.0.tgz", integrity: "sha512-x" } } } });
  const index = '<a href="https://files.pythonhosted.org/packages/f9/9b/requests-2.32.3-py3-none-any.whl#sha256=ab">requests</a>';
  const r = registry({
    "https://registry.npmjs.org/react": { status: 200, text: paketliste },
    "https://registry.npmjs.org/react/-/react-19.1.0.tgz": { status: 200, text: "https://registry.npmjs.org/ bleibt im Archiv" },
    "https://pypi.org/simple/requests/": { status: 200, text: index },
    "https://registry.npmjs.org/riesig": { status: 200, bytes: PAKET_GRENZEN.bytesJe + 1 },
    "https://registry.npmjs.org/kaputt": { status: 500 },
  });
  const konto = new SpiegelKonto();
  const bruecke = await oeffneModellBruecke({ art: "openai", url: "http://127.0.0.1:9/v1" }, {
    spiegel: (req, res) => beantworteSpiegel(req, res, { basis: BASIS, paket: { tor: null, abruf: r.abruf }, konto }),
  });
  try {
    const liste = await ueberSockel(bruecke.sockel, "GET", "/npm/react");
    assert.equal(liste.status, 200);
    assert.equal(liste.typ, "application/json");
    assert.equal(JSON.parse(liste.text).versions["19.1.0"].dist.tarball, `${BASIS}/npm/react/-/react-19.1.0.tgz`);
    const archiv = await ueberSockel(bruecke.sockel, "GET", "/npm/react/-/react-19.1.0.tgz");
    assert.deepEqual([archiv.status, archiv.typ, archiv.text], [200, "application/octet-stream", "https://registry.npmjs.org/ bleibt im Archiv"]);
    const pip = await ueberSockel(bruecke.sockel, "GET", "/pypi/simple/requests/");
    assert.equal(pip.text, `<a href="${BASIS}/pypi/files/packages/f9/9b/requests-2.32.3-py3-none-any.whl#sha256=ab">requests</a>`);
    assert.deepEqual(await ueberSockel(bruecke.sockel, "GET", "/npm/gibt-es-nicht").then((x) => [x.status, x.text]), [404, "gibt es nicht"]);
    assert.deepEqual(await ueberSockel(bruecke.sockel, "GET", "/npm/riesig").then((x) => [x.status, x.text]), [413, "zu gross"]);
    assert.deepEqual(await ueberSockel(bruecke.sockel, "GET", "/npm/kaputt").then((x) => [x.status, x.text]), [502, "Registry nicht erreichbar"]);
    const vorher = r.gesehen.length;
    for (const [m, p] of [["PUT", "/npm/react"], ["POST", "/npm/-/npm/v1/security/advisories/bulk"], ["GET", "/npm/../v1/models"], ["GET", "/pypi/json/requests"]]) {
      assert.ok([404, 405].includes((await ueberSockel(bruecke.sockel, m!, p!)).status), `${m} ${p}`);
    }
    assert.equal(r.gesehen.length, vorher, "nichts davon erreicht eine Registry");
    assert.ok(r.gesehen.every((u) => u.startsWith("https://registry.npmjs.org/") || u.startsWith("https://pypi.org/simple/")));
  } finally {
    bruecke.schliesse();
  }
  // ohne Spiegel: Pakete wie jeder andere Weg nicht hier
  const ohne = await oeffneModellBruecke({ art: "openai", url: "http://127.0.0.1:9/v1" });
  try {
    assert.equal((await ueberSockel(ohne.sockel, "GET", "/npm/react")).status, 404);
  } finally {
    ohne.schliesse();
  }
});

test("VKd3: Grenze je Stunde – danach 429, nach der Stunde wieder frei", () => {
  let jetzt = 1_000_000;
  const konto = new SpiegelKonto(() => jetzt);
  for (let i = 0; i < SPIEGEL_GRENZEN.anfragenJeStunde; i++) assert.ok(konto.darf());
  assert.equal(konto.darf(), false);
  jetzt += 3_600_000;
  assert.ok(konto.darf());
  konto.zaehle(SPIEGEL_GRENZEN.bytesJeStunde);
  assert.equal(konto.darf(), false, "auch nach Bytes");
});

test("VKd3: Motor – .npmrc und pip.conf auf die Brücke, vor jedem Start neu, nie durch einen Verweis", () => {
  const k = paketKonfiguration();
  assert.equal(k.npmrc, `registry=${BASIS}/npm/\naudit=false\nfund=false\nupdate-notifier=false\n`);
  assert.equal(k.pip, `[global]\nindex-url = ${BASIS}/pypi/simple/\ntrusted-host = 127.0.0.1\ndisable-pip-version-check = true\n`);
  const ablage = new ProjektAblage(join(tmp("ablage"), "projekte"));
  mkdirSync(ablage.ort("app"), { recursive: true });
  const motor = hermesMotor({ hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: tmp("b") }, modell: () => "coder:7b", bwrap: "/gibt/es/nicht" });
  const heim = hermesHeim(ablage, ablage.ort("app"));
  const start = () => { try { motor(ablage.ort("app")).beende(); } catch { /* bwrap fehlt – geschrieben ist vorher */ } };
  start();
  assert.equal(readFileSync(join(heim, ".npmrc"), "utf8"), k.npmrc);
  assert.equal(readFileSync(join(heim, ".config", "pip", "pip.conf"), "utf8"), k.pip);
  assert.equal((statSync(join(heim, ".npmrc")).mode & 0o777).toString(8), "600");
  // der Motor ersetzt .npmrc durch einen Verweis auf den Schlüssel des Knotens – der Knoten schreibt nie dorthin
  const ziel = join(tmp("ziel"), "node-key");
  writeFileSync(ziel, "schluessel");
  rmSync(join(heim, ".npmrc"));
  symlinkSync(ziel, join(heim, ".npmrc"));
  start();
  assert.equal(readFileSync(ziel, "utf8"), "schluessel");
  assert.equal(readFileSync(join(heim, ".npmrc"), "utf8"), k.npmrc);
  // ein Verweis statt des Ordners .config: kein Start
  rmSync(join(heim, ".config"), { recursive: true });
  symlinkSync(tmp("fremd"), join(heim, ".config"));
  assert.throws(() => motor(ablage.ort("app")), { name: "HeimKaputt" });
});
