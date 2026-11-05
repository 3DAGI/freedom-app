/**
 * Pakete über die Brücke (VKd3): npm und pip im Motor holen nur von der festen Liste, nur per GET, über die Brücke des
 * Knotens; Adressen in Paketlisten und Index zeigen danach auf die Brücke; Grenzen je Abruf und je Stunde. Seit VKh1
 * dazu Maven für Gradle (Google Maven, Maven Central): die Echttests bauen mit echtem Gradle in der Sandbox und
 * überspringen sich nur ohne Sandbox, Gradle oder Java – und ohne das Repository (Google Maven ist hier gesperrt, in
 * der CI erreichbar).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ANDROID_PLUGIN_FASSUNG, STARTSKRIPT, hermesHeim, hermesMotor, paketKonfiguration } from "../src/hermes-motor.js";
import { BRUECKE_IN_SANDBOX, oeffneModellBruecke } from "../src/modell-bruecke.js";
import { PAKET_GRENZEN, holeOderFehlt, type PaketAbruf } from "../src/pakete.js";
import { MAVEN_REPOS, SPIEGEL_GRENZEN, SpiegelKonto, beantworteSpiegel, spiegelZiel } from "../src/paket-spiegel.js";
import { ProjektAblage } from "../src/projekte.js";
import { fuehreAus, pruefeSandbox } from "../src/sandbox.js";

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

// ---------------------------------------------------------------------------------------------------------------------
// VKh1: Maven für Gradle über denselben Spiegel – Google Maven und Maven Central, Archive als Strom

test("VKh1: Ziele – Maven nur von Google Maven und Maven Central, nur Archive, POMs, Metadaten und Prüfsummen", () => {
  const central = (r: string) => ({ url: `https://repo.maven.apache.org/maven2/${r}`, registry: "maven", art: "archiv" });
  assert.deepEqual(spiegelZiel("/maven/central/com/google/code/gson/gson/2.11.0/gson-2.11.0.jar"), central("com/google/code/gson/gson/2.11.0/gson-2.11.0.jar"));
  assert.deepEqual(spiegelZiel("/maven/google/androidx/annotation/annotation-jvm/1.9.1/annotation-jvm-1.9.1.module"),
    { url: "https://dl.google.com/dl/android/maven2/androidx/annotation/annotation-jvm/1.9.1/annotation-jvm-1.9.1.module", registry: "maven", art: "archiv" });
  for (const r of [
    "org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml", "a/b/1.0/b-1.0.pom.sha1", "a/b/1.0/b-1.0.jar.asc", "a/b/1.0/b-1.0.aar",
    "a/b/1.0/b-1.0-sources.jar.sha256", "a/b/1.0/b-1.0.klib", "a/b/1.0+x/b-1.0+x.zip", "a/b/1.0/b-1.0.module.md5",
  ]) assert.deepEqual(spiegelZiel(`/maven/central/${r}`), central(r), r);
  for (const falsch of [
    "/maven/", "/maven/central/", "/maven/central/a/b", "/maven/jcenter/a/b/1.0/b-1.0.jar", "/maven/central/a/../b/1.0/b.jar",
    "/maven/central/a/%2e%2e/b/1.0/b.jar", "/maven/central/a/b/1.0/", "/maven/central/a/b/1.0/b-1.0.exe", "/maven/central/a/b/1.0/b.sh",
    "/maven/central/a/b/1.0/maven-metadata.xml.bak", "/maven/central/a@b/c/1.0/c.jar", "/maven/central//b/1.0/b.jar",
    "/maven/central/a/b/1.0/b.jar?x=1", "/maven/central/a/b/./b.jar", "/maven/central/a/b/1.0/.jar", "/maven/google/a/b/1.0/b%2fx.jar",
    "/maven/central/https://boese.example/b.jar", "/maven/repo1/a/b/1.0/b.jar", "/maven/central/a/b/1.0/b~1.jar",
  ]) assert.equal(spiegelZiel(falsch), null, falsch);
});

test("VKh1: über die Brücke – Maven unverändert und als Strom, Länge nur, wenn sie stimmt; zu groß bricht ab", async () => {
  const pom = "<project><repositories><repository><url>https://repo.maven.apache.org/maven2/</url></repository></repositories></project>";
  const gesehen: string[] = [];
  const antworten: Record<string, () => Response> = {
    "https://repo.maven.apache.org/maven2/a/b/1.0/b-1.0.pom": () => new Response(pom, { status: 200, headers: { "content-length": String(pom.length) } }),
    "https://dl.google.com/dl/android/maven2/a/b/1.0/b-1.0.aar": () => new Response(new Uint8Array(70_000).fill(7), { status: 200 }),
    "https://repo.maven.apache.org/maven2/a/b/1.0/b-1.0.jar": () => new Response("entpackt", { status: 200, headers: { "content-length": "3", "content-encoding": "gzip" } }),
    "https://repo.maven.apache.org/maven2/a/riesig/1.0/riesig-1.0.jar": () =>
      new Response("klein", { status: 200, headers: { "content-length": String(SPIEGEL_GRENZEN.bytesJe.maven + 1) } }),
    "https://registry.npmjs.org/riesig/-/riesig-1.0.0.tgz": () => new Response(new Uint8Array(SPIEGEL_GRENZEN.bytesJe.npm + 1), { status: 200 }),
    // viele Stücke: Gegendruck der Sandbox in jeder Runde, ohne dass Zuhörer liegen bleiben
    "https://repo.maven.apache.org/maven2/a/stuecke/1.0/stuecke-1.0.jar": () => {
      let i = 0;
      return new Response(new ReadableStream<Uint8Array>({ pull: (c) => (i++ < 60 ? c.enqueue(new Uint8Array(65_536).fill(i)) : c.close()) }), { status: 200 });
    },
  };
  const abruf: PaketAbruf = async (url) => {
    gesehen.push(url);
    return antworten[url]?.() ?? new Response("nicht da", { status: 404 });
  };
  const konto = new SpiegelKonto();
  const bruecke = await oeffneModellBruecke({ art: "openai", url: "http://127.0.0.1:9/v1" }, {
    spiegel: (req, res) => beantworteSpiegel(req, res, { basis: BASIS, paket: { tor: null, abruf }, konto }),
  });
  try {
    const p = await ueberSockelKopf(bruecke.sockel, "GET", "/maven/central/a/b/1.0/b-1.0.pom");
    assert.deepEqual([p.status, p.typ, p.laenge, p.text], [200, "application/octet-stream", String(pom.length), pom], "POM unverändert, mit Länge");
    const aar = await ueberSockelKopf(bruecke.sockel, "GET", "/maven/google/a/b/1.0/b-1.0.aar");
    assert.deepEqual([aar.status, aar.laenge, aar.bytes.length, aar.bytes.every((b) => b === 7)], [200, undefined, 70_000, true], "ohne Länge als Strom");
    const jar = await ueberSockelKopf(bruecke.sockel, "GET", "/maven/central/a/b/1.0/b-1.0.jar");
    assert.deepEqual([jar.status, jar.laenge, jar.text], [200, undefined, "entpackt"], "gepackt: die Länge gälte für andere Bytes");
    const warnungen: string[] = [];
    const merke = (w: Error) => warnungen.push(w.name);
    process.on("warning", merke);
    const stuecke = await ueberSockelKopf(bruecke.sockel, "GET", "/maven/central/a/stuecke/1.0/stuecke-1.0.jar");
    await new Promise((r) => setImmediate(r));
    process.off("warning", merke);
    assert.deepEqual([stuecke.status, stuecke.bytes.length, stuecke.bytes[0], stuecke.bytes.at(-1), warnungen], [200, 60 * 65_536, 1, 60, []]);
    const kopf = await ueberSockelKopf(bruecke.sockel, "HEAD", "/maven/central/a/b/1.0/b-1.0.pom");
    assert.deepEqual([kopf.status, kopf.laenge, kopf.text], [200, String(pom.length), ""]);
    assert.deepEqual(await ueberSockelKopf(bruecke.sockel, "GET", "/maven/central/a/b/2.0/b-2.0.jar").then((x) => [x.status, x.text]), [404, "gibt es nicht"]);
    assert.deepEqual(await ueberSockelKopf(bruecke.sockel, "GET", "/maven/central/a/riesig/1.0/riesig-1.0.jar").then((x) => [x.status, x.text]), [413, "zu gross"]);
    // ohne Länge erst im Strom zu groß: abgebrochen, nie als ganzes Archiv
    const halb = await ueberSockelKopf(bruecke.sockel, "GET", "/npm/riesig/-/riesig-1.0.0.tgz").catch((e: Error) => e);
    assert.ok(halb instanceof Error || !halb.vollstaendig, "abgebrochen");
    for (const pfad of ["/maven/central/a/b/1.0/b-1.0.exe", "/maven/jcenter/a/b/1.0/b-1.0.jar"]) {
      assert.equal((await ueberSockelKopf(bruecke.sockel, "GET", pfad)).status, 404, pfad);
    }
    assert.ok(gesehen.every((u) => u.startsWith(MAVEN_REPOS.google) || u.startsWith(MAVEN_REPOS.central) || u.startsWith("https://registry.npmjs.org/")));
    assert.ok(!gesehen.some((u) => u.endsWith(".exe") || u.includes("jcenter")), "Abgewiesenes erreicht keine Registry");
  } finally {
    bruecke.schliesse();
  }
});

/** Wie `ueberSockel`, dazu Länge, Bytes und ob die Antwort sauber zu Ende kam. */
function ueberSockelKopf(sockel: string, methode: string, pfad: string) {
  return new Promise<{ status: number; text: string; bytes: Buffer; typ?: string; laenge?: string; vollstaendig: boolean }>((fertig, scheitern) => {
    const r = request({ socketPath: sockel, method: methode, path: pfad }, (res) => {
      const teile: Buffer[] = [];
      res.on("data", (b: Buffer) => teile.push(b));
      res.on("error", scheitern);
      res.on("close", () => {
        const bytes = Buffer.concat(teile);
        fertig({ status: res.statusCode!, text: bytes.toString("utf8"), bytes, typ: res.headers["content-type"], laenge: res.headers["content-length"], vollstaendig: res.complete });
      });
    });
    r.on("error", scheitern);
    r.end();
  });
}

test("VKh1: Motor – Init-Skript für Gradle im Home, vor jedem Start neu, nie durch einen Verweis", () => {
  const k = paketKonfiguration();
  assert.ok(k.gradle.includes(`def spiegel = "${BASIS}/maven"`));
  for (const ort of ["dl.google.com/dl/android/maven2", "repo.maven.apache.org/maven2", "plugins.gradle.org/m2"]) assert.ok(k.gradle.includes(`"${ort}"`), ort);
  assert.ok(k.gradle.includes("allowInsecureProtocol = true") && k.gradle.includes("beforeSettings") && k.gradle.includes("allprojects"));
  const ablage = new ProjektAblage(join(tmp("ablage"), "projekte"));
  mkdirSync(ablage.ort("app"), { recursive: true });
  const motor = hermesMotor({ hermes: { ordner: "/opt/hermes" }, ablage, bruecke: { ordner: tmp("b") }, modell: () => "coder:7b", bwrap: "/gibt/es/nicht" });
  const heim = hermesHeim(ablage, ablage.ort("app"));
  const datei = join(heim, ".gradle", "init.d", "freedom-spiegel.gradle");
  const start = () => { try { motor(ablage.ort("app")).beende(); } catch { /* bwrap fehlt – geschrieben ist vorher */ } };
  start();
  assert.equal(readFileSync(datei, "utf8"), k.gradle);
  assert.equal((statSync(datei).mode & 0o777).toString(8), "600");
  writeFileSync(datei, "// vom Agenten geändert");
  start();
  assert.equal(readFileSync(datei, "utf8"), k.gradle, "vor jedem Start neu");
  // init.d durch einen Verweis ersetzt: kein Start, nichts außerhalb geschrieben
  const fremd = tmp("fremd");
  rmSync(join(heim, ".gradle", "init.d"), { recursive: true });
  symlinkSync(fremd, join(heim, ".gradle", "init.d"));
  assert.throws(() => motor(ablage.ort("app")), { name: "HeimKaputt" });
  assert.deepEqual(readdirSync(fremd), []);
});

// --- Echttests mit Gradle in der Sandbox -----------------------------------------------------------------------------

const sandbox = await pruefeSandbox();
/** Gradle für die Echttests: `GRADLE_TEST`, sonst `/opt/gradle` oder `gradle` im PATH – samt Ordner, falls außerhalb von /usr. */
function findeGradle(): { gradle: string; nurLesbar: Array<{ quelle: string; ziel: string }> } | null {
  const kandidaten = [process.env.GRADLE_TEST, "/opt/gradle/bin/gradle", ...(process.env.PATH ?? "").split(":").filter(Boolean).map((d) => join(d, "gradle"))];
  for (const k of kandidaten) {
    if (!k || !existsSync(k)) continue;
    const echt = realpathSync(k);
    const ordner = dirname(dirname(echt));
    return { gradle: echt, nurLesbar: echt.startsWith("/usr/") ? [] : [{ quelle: ordner, ziel: ordner }] };
  }
  return null;
}
const gradle = findeGradle();
const hatJava = existsSync("/usr/bin/java");
const ohneGradle = (!sandbox.ok && `Sandbox geht hier nicht (${sandbox.fall})`) || (!gradle && "Gradle fehlt") || (!hatJava && "Java fehlt");
/** Erreicht der Knoten das Repository? Eine kleine Datei, wie der Spiegel sie holt. */
async function erreichbar(url: string): Promise<boolean> {
  try {
    return (await holeOderFehlt(url, "maven", 1024 * 1024, { tor: null })) !== null;
  } catch {
    return false;
  }
}
const centralDa = !ohneGradle && await erreichbar(`${MAVEN_REPOS.central}com/google/code/gson/gson/2.11.0/gson-2.11.0.pom`);
const googleDa = !ohneGradle && await erreichbar(`${MAVEN_REPOS.google}androidx/annotation/annotation-jvm/1.9.1/annotation-jvm-1.9.1.pom`);

/**
 * Ein Java-Projekt bauen und starten, wie es der Agent täte: Gradle in der Sandbox ohne Netz, das Init-Skript aus
 * `paketKonfiguration()` im Home, die Brücke über `freedom_motor.py` – wie im Motor.
 */
async function baueMitGradle(
  dateien: Record<string, string>, spiegel: Parameters<typeof beantworteSpiegel>[2], befehl = ["run"],
  mehr: { nurLesbar?: Array<{ quelle: string; ziel: string }>; zeitMs?: number; rechenzeitSek?: number } = {},
) {
  const arbeit = tmp("gradle");
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(arbeit, pfad)), { recursive: true });
    writeFileSync(join(arbeit, pfad), inhalt);
  }
  const home = tmp("home");
  mkdirSync(join(home, ".gradle", "init.d"), { recursive: true });
  writeFileSync(join(home, ".gradle", "init.d", "freedom-spiegel.gradle"), paketKonfiguration().gradle);
  const bruecke = await oeffneModellBruecke({ art: "openai", url: "http://127.0.0.1:9/v1" }, { spiegel: (req, res) => beantworteSpiegel(req, res, spiegel) });
  try {
    const nurLesbar = [
      ...gradle!.nurLesbar, ...(mehr.nurLesbar ?? []), { quelle: STARTSKRIPT, ziel: "/freedom/motor.py" }, { quelle: bruecke.ordner, ziel: BRUECKE_IN_SANDBOX.ordner },
    ];
    const ergebnis = await fuehreAus(
      ["python3", "/freedom/motor.py", BRUECKE_IN_SANDBOX.sockel, String(BRUECKE_IN_SANDBOX.port), "--",
        gradle!.gradle, "--no-daemon", "--console=plain", "-q", "--project-dir", "/arbeit", ...befehl],
      { arbeit, home, nurLesbar, ...(mehr.rechenzeitSek ? { rechenzeitSek: mehr.rechenzeitSek } : {}) }, mehr.zeitMs ?? 300_000,
    );
    return { ...ergebnis, arbeit, home };
  } finally {
    bruecke.schliesse();
  }
}

const JAVA_PROJEKT = (repos: string, abhaengigkeit: string, code: string) => ({
  "settings.gradle": 'rootProject.name = "probe"\n',
  "build.gradle": `plugins { id "application" }\nrepositories { ${repos} }\ndependencies { implementation "${abhaengigkeit}" }\napplication { mainClass = "Probe" }\n`,
  "src/main/java/Probe.java": code,
});

test("VKh1 (Gradle): Plugins und Bibliotheken nur über den Spiegel – nie das Portal, nie ein Repository daneben", { skip: ohneGradle }, async () => {
  const gesehen: string[] = [];
  const abruf: PaketAbruf = async (url) => (gesehen.push(url), new Response("nicht da", { status: 404 }));
  const r = await baueMitGradle({
    "settings.gradle": 'pluginManagement { repositories { gradlePluginPortal() } }\nrootProject.name = "probe"\n',
    "build.gradle": 'plugins { id "org.freedom.probe" version "1.0" }\n',
  }, { basis: BASIS, paket: { tor: null, abruf }, konto: new SpiegelKonto() }, ["help"]);
  assert.notEqual(r.code, 0, "das Plugin gibt es nicht");
  const marker = "org/freedom/probe/org.freedom.probe.gradle.plugin/1.0/org.freedom.probe.gradle.plugin-1.0.pom";
  assert.ok(gesehen.includes(`${MAVEN_REPOS.google}${marker}`) && gesehen.includes(`${MAVEN_REPOS.central}${marker}`), gesehen.join("\n"));
  assert.ok(gesehen.every((u) => u.startsWith(MAVEN_REPOS.google) || u.startsWith(MAVEN_REPOS.central)), gesehen.join("\n"));
  // Gradle nennt die Orte, die es fragte: die beiden aus dem Init-Skript und das Portal – umgelenkt auf Maven Central
  assert.match(r.ausgabe, new RegExp(`FreedomGoogle\\(${BASIS}/maven/google/\\)`));
  assert.match(r.ausgabe, new RegExp(`Gradle Central Plugin Repository\\(${BASIS}/maven/central/\\)`));
  const orte = r.ausgabe.split("Searched in the following repositories:")[1]?.split("* Try:")[0] ?? "";
  assert.deepEqual([...orte.matchAll(/\((\w+:[^)]*)\)/g)].map((m) => m[1]), [`${BASIS}/maven/google/`, `${BASIS}/maven/central/`, `${BASIS}/maven/central/`]);
});

test("VKh1 (Gradle): eine Bibliothek von Maven Central – gebaut und gestartet in der Sandbox ohne Netz", { skip: ohneGradle || (!centralDa && "Maven Central nicht erreichbar") }, async () => {
  const konto = new SpiegelKonto();
  const r = await baueMitGradle(JAVA_PROJEKT("mavenCentral()", "com.google.code.gson:gson:2.11.0",
    'public class Probe { public static void main(String[] a) { System.out.println("WERT " + new com.google.gson.Gson().toJson(java.util.Map.of("gruen", 1))); } }\n'),
  { basis: BASIS, paket: { tor: null }, konto });
  assert.deepEqual([r.code, r.ausgabe.trim().split("\n").at(-1)], [0, 'WERT {"gruen":1}'], r.ausgabe);
});

// wie ein Android-Projekt: androidx braucht dazu kotlin-stdlib von Maven Central
test("VKh1 (Gradle): eine Bibliothek von Google Maven – gebaut in der Sandbox ohne Netz", { skip: ohneGradle || (!googleDa && "Google Maven nicht erreichbar") }, async () => {
  const r = await baueMitGradle(JAVA_PROJEKT("google(); mavenCentral()", "androidx.annotation:annotation:1.9.1",
    'public class Probe { @androidx.annotation.NonNull static String wert() { return "WERT gruen"; } public static void main(String[] a) { System.out.println(wert()); } }\n'),
  { basis: BASIS, paket: { tor: null }, konto: new SpiegelKonto() });
  assert.deepEqual([r.code, r.ausgabe.trim().split("\n").at(-1)], [0, "WERT gruen"], r.ausgabe);
});

/** Ein Android-SDK für den Echttest (VKh2b): das des Runners (`ANDROID_HOME`) oder das aus dem Bild – mit Plattform und Build-Tools. */
function findeSdk(): string | null {
  for (const d of [process.env.ANDROID_TEST_SDK, process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, "/usr/lib/android-sdk"]) {
    if (d && existsSync(join(d, "platforms", "android-36")) && existsSync(join(d, "build-tools", "36.0.0"))) return realpathSync(d);
  }
  return null;
}
const sdk = findeSdk();

/** Ein Android-Projekt wie das, das der Agent baut: eine Activity, das Plugin in `ANDROID_PLUGIN_FASSUNG`, compileSdk 36. */
const ANDROID_PROJEKT = (eigenschaften: string) => ({
  "settings.gradle": 'rootProject.name = "probe"\n',
  "gradle.properties": `org.gradle.jvmargs=-Xmx2g\n${eigenschaften}`,
  "local.properties": `sdk.dir=${sdk}\n`,
  "build.gradle": [
    `plugins { id "com.android.application" version "${ANDROID_PLUGIN_FASSUNG}" }`,
    "repositories { google(); mavenCentral() }",
    "android {",
    '  namespace = "org.freedom.probe"',
    "  compileSdk = 36",
    '  defaultConfig { applicationId = "org.freedom.probe"; minSdk = 24; targetSdk = 36; versionCode = 1; versionName = "1" }',
    "}",
    "",
  ].join("\n"),
  "src/main/AndroidManifest.xml": [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '  <application android:label="Probe">',
    '    <activity android:name=".Probe" android:exported="true">',
    '      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>',
    "    </activity>",
    "  </application>",
    "</manifest>",
    "",
  ].join("\n"),
  "src/main/java/org/freedom/probe/Probe.java": [
    "package org.freedom.probe;",
    "public class Probe extends android.app.Activity {",
    "  @Override protected void onCreate(android.os.Bundle b) {",
    "    super.onCreate(b);",
    "    android.widget.TextView t = new android.widget.TextView(this);",
    '    t.setText("Freedom");',
    "    setContentView(t);",
    "  }",
    "}",
    "",
  ].join("\n"),
});

/** Das APK bauen und prüfen; `nurLesbar` kommt zum SDK dazu (etwa das eigene aapt2). Gibt das Home von Gradle zurück. */
async function baueApk(eigenschaften = "", nurLesbar: Array<{ quelle: string; ziel: string }> = []) {
  const r = await baueMitGradle(ANDROID_PROJEKT(eigenschaften), { basis: BASIS, paket: { tor: null }, konto: new SpiegelKonto() }, ["assembleDebug"], {
    // ein SDK außerhalb von /usr nur lesbar dazu; das Android-Plugin rechnet länger als die Grenze für einen Befehl
    nurLesbar: [...(sdk!.startsWith("/usr/") ? [] : [{ quelle: sdk!, ziel: sdk! }]), ...nurLesbar], zeitMs: 900_000, rechenzeitSek: 3600,
  });
  assert.equal(r.code, 0, r.ausgabe);
  const apk = join(r.arbeit, "build", "outputs", "apk", "debug", "probe-debug.apk");
  const eintraege = execFileSync("unzip", ["-Z1", apk], { encoding: "utf8" }).split("\n");
  assert.ok(eintraege.includes("AndroidManifest.xml") && eintraege.includes("classes.dex"), eintraege.join(", "));
  return r.home;
}
/** Hat Gradle aapt2 aus Maven geholt (das Programm von Google, nur x86-64)? */
const aapt2AusMaven = (home: string) => existsSync(join(home, ".gradle", "caches", "modules-2", "files-2.1", "com.android.tools.build", "aapt2"));

test("VKh2b (Gradle): ein APK mit dem Android-Plugin – gebaut in der Sandbox ohne Netz, das SDK nur lesbar", {
  skip: ohneGradle || (!sdk && "Android-SDK mit android-36 und build-tools 36.0.0 fehlt") || (!googleDa && "Google Maven nicht erreichbar"),
}, async () => {
  // ohne Umweg nimmt das Plugin aapt2 aus Maven – die Gegenprobe zu VKh3
  assert.ok(aapt2AusMaven(await baueApk()), "aapt2 aus Maven");
});

// --- aapt2 aus den Quellen (VKh3) ------------------------------------------------------------------------------------

/**
 * aapt2 aus `scripts/aapt2-bauen.sh` (`AAPT2_TEST`; die CI baut es auf x86-64 und ARM64). Mit `AAPT2_TEST_PFLICHT=1` ist der
 * Test rot, statt sich zu überspringen, wenn etwas fehlt; mit `AAPT2_APK_PFLICHT=1` ebenso der Bau eines APK (nur x86-64:
 * android-36 gibt es nur mit dem SDK von Google).
 */
const aapt2 = process.env.AAPT2_TEST && existsSync(process.env.AAPT2_TEST) ? realpathSync(process.env.AAPT2_TEST) : null;
/** android.jar zum Verlinken: android-36 aus dem SDK, android-23 aus Debian/Ubuntu (libandroid-23-java, aus den Quellen gebaut). */
const androidJars = [sdk && join(sdk, "platforms", "android-36", "android.jar"), "/usr/lib/android-sdk/platforms/android-23/android.jar"]
  .filter((j): j is string => !!j && existsSync(j));
const ohneAapt2 = (!sandbox.ok && `Sandbox geht hier nicht (${sandbox.fall})`) || (!aapt2 && "AAPT2_TEST fehlt (scripts/aapt2-bauen.sh)")
  || (androidJars.length === 0 && "kein android.jar");

test("VKh3 (aapt2): aus den Quellen, statisch – übersetzt und verlinkt Ressourcen in der Sandbox ohne Netz", {
  skip: process.env.AAPT2_TEST_PFLICHT === "1" ? false : ohneAapt2,
}, async () => {
  assert.equal(ohneAapt2, false, `AAPT2_TEST_PFLICHT: ${ohneAapt2}`);
  for (const jar of androidJars) {
    const arbeit = tmp("aapt2");
    mkdirSync(join(arbeit, "res", "values"), { recursive: true });
    writeFileSync(join(arbeit, "res", "values", "strings.xml"), '<resources><string name="name">Freedom</string></resources>\n');
    // das Thema kommt aus android.jar – verlinkt heißt: aapt2 hat dessen Ressourcen gelesen
    writeFileSync(join(arbeit, "AndroidManifest.xml"), '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.freedom.probe">'
      + '<application android:label="@string/name" android:theme="@android:style/Theme.Material"/></manifest>\n');
    const r = await fuehreAus(["sh", "-c", [
      "/freedom/aapt2 version",
      "/freedom/aapt2 compile res/values/strings.xml -o .",
      "/freedom/aapt2 link -I /freedom/android.jar --manifest AndroidManifest.xml -o probe.apk values_strings.arsc.flat",
      "/freedom/aapt2 dump badging probe.apk",
    ].join(" && ")], { arbeit, nurLesbar: [{ quelle: aapt2!, ziel: "/freedom/aapt2" }, { quelle: jar, ziel: "/freedom/android.jar" }] });
    assert.equal(r.code, 0, `${jar}\n${r.ausgabe}`);
    assert.match(r.ausgabe, /Android Asset Packaging Tool \(aapt\) 2\./);
    assert.match(r.ausgabe, /application-label:'Freedom'/);
    const eintraege = execFileSync("unzip", ["-Z1", join(arbeit, "probe.apk")], { encoding: "utf8" }).split("\n");
    assert.ok(eintraege.includes("AndroidManifest.xml") && eintraege.includes("resources.arsc"), eintraege.join(", "));
  }
});

const ohneApk = ohneGradle || (!sdk && "Android-SDK mit android-36 und build-tools 36.0.0 fehlt") || (!googleDa && "Google Maven nicht erreichbar")
  || (!aapt2 && "AAPT2_TEST fehlt (scripts/aapt2-bauen.sh)");
test("VKh3 (Gradle): ein APK mit dem eigenen aapt2 – über android.aapt2FromMavenOverride, nichts aus Maven", {
  skip: process.env.AAPT2_APK_PFLICHT === "1" ? false : ohneApk,
}, async () => {
  assert.equal(ohneApk, false, `AAPT2_APK_PFLICHT: ${ohneApk}`);
  const home = await baueApk(`android.aapt2FromMavenOverride=${aapt2}\n`, aapt2!.startsWith("/usr/") ? [] : [{ quelle: aapt2!, ziel: aapt2! }]);
  assert.equal(aapt2AusMaven(home), false, "aapt2 kam aus Maven, nicht aus den Quellen");
});
