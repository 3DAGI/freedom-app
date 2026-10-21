/**
 * Pakete für Repo-Aufträge (11.5c3, `docs/REPO-AGENTEN-ENTWURF.md` W6a „So“, P3).
 *
 * Beweist:
 *  - `paket_holen <npm|pypi> <name> <version>` führt der Knoten aus, nie die Sandbox: Adresse und Prüfsumme zurück,
 *    sonst nur die Kennung; ohne Freigabe (privat) ist die Zeile ein gewöhnlicher Befehl
 *  - npm und pip in der Sandbox sind nur mit Freigabe auf `/pakete` eingestellt, die Aufgabe nennt es
 *  - mit bubblewrap: was die Sperrdateien des Bundles nennen, liegt vor dem ersten Schritt nur lesbar in `/pakete`, pip
 *    installiert ohne Netz daraus, ein neues Paket ist danach dort; beide Ordner sind am Ende weg
 *  - Scheitert das Holen, läuft der Auftrag ohne Pakete – das Modell und das Ergebnis erfahren die Kennung
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leseBundle } from "@freedomstack/protocol";
import { PaketAbgelehnt, type PaketAbruf } from "../src/pakete.js";
import { ENDE_MARKE, PAKETE_IN_SANDBOX, bearbeiteRepo, repoLauf, sandboxPlattform, type RepoNachricht } from "../src/repo-lauf.js";
import { fuehreAus, pruefeSandbox, type SandboxErgebnis } from "../src/sandbox.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bash = (befehl: string) => `THOUGHT: weiter.\n\n\`\`\`bash\n${befehl}\n\`\`\``;
const ok = (ausgabe = ""): SandboxErgebnis => ({ code: 0, ausgabe, gekuerzt: false, zeitUm: false });

/** Modell nach Drehbuch, das sich merkt, was es bei jedem Schritt zu lesen bekam. */
function drehbuch(antworten: string[]) {
  const gesehen: RepoNachricht[][] = [];
  return {
    gesehen,
    modell: async (n: readonly RepoNachricht[]) => {
      gesehen.push([...n]);
      const text = antworten[gesehen.length - 1];
      if (text === undefined) throw new Error("Drehbuch zu Ende");
      return { text, tokens: 10 };
    },
  };
}
const letzte = (n: RepoNachricht[]) => n[n.length - 1]!.content;

test("11.5c3: paket_holen führt der Knoten aus – Adresse und Prüfsumme, sonst nur die Kennung; npm und pip auf /pakete", async () => {
  const geholt: string[][] = [];
  const hole = async (registry: string, name: string, version: string) => {
    geholt.push([registry, name, version]);
    if (name === "kaputt") throw new PaketAbgelehnt("paket-version");
    if (name === "fremd") throw new Error("Text der Registry, der nie hinaus darf");
    return [{ url: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, pruefsumme: "sha512-QUJD" }];
  };
  const befehle: string[] = [];
  const m = drehbuch([
    bash("paket_holen npm left-pad 1.3.0"), bash("paket_holen pypi kaputt 1"), bash("paket_holen npm fremd 1.0.0"),
    bash("npm ci"), bash(`printf '%s\\n' ${ENDE_MARKE} 'fertig'`),
  ]);
  const r = await repoLauf({
    aufgabe: "x", modell: m.modell, pakete: { hole },
    fuehre: async (b) => { befehle.push(b[2]!); return ok(b[2]!.includes(ENDE_MARKE) ? `${ENDE_MARKE}\nfertig\n` : ""); },
  });
  assert.equal(r.ende, "fertig");
  assert.deepEqual(geholt, [["npm", "left-pad", "1.3.0"], ["pypi", "kaputt", "1"], ["npm", "fremd", "1.0.0"]]);
  assert.equal(befehle.length, 2, "paket_holen nie in der Sandbox");
  assert.match(letzte(m.gesehen[1]!), /<returncode>0<\/returncode>\n<output>\nhttps:\/\/registry\.npmjs\.org\/left-pad\/-\/left-pad-1\.3\.0\.tgz sha512-QUJD\n<\/output>/);
  assert.match(letzte(m.gesehen[2]!), /<returncode>1<\/returncode>\n<output>\npaket_holen: paket-version\n<\/output>/);
  assert.match(letzte(m.gesehen[3]!), /paket_holen: paket-netz/, "fremder Fehlertext nie zum Modell");
  assert.doesNotMatch(letzte(m.gesehen[3]!), /Text der Registry/);
  for (const b of befehle) assert.match(b.split("\n")[0]!, /npm_config_cache=\/pakete\/npm npm_config_offline=true npm_config_ignore_scripts=true .*PIP_NO_INDEX=1 PIP_FIND_LINKS=\/pakete\/pypi/);
  assert.match(m.gesehen[0]![1]!.content, /## Packages\n\nThe packages listed in package-lock\.json and requirements\.txt \(with --hash\) were downloaded/);
  assert.match(m.gesehen[0]![1]!.content, /`paket_holen npm <name> <exact-version>`/);

  // Ohne Freigabe (privater Raum): keine Pakete, die Zeile ist ein gewöhnlicher Befehl in der Sandbox
  const ohne: string[] = [];
  const m2 = drehbuch([bash("paket_holen npm left-pad 1.3.0"), bash(`printf '%s\\n' ${ENDE_MARKE} 'x'`)]);
  await repoLauf({ aufgabe: "x", modell: m2.modell, fuehre: async (b) => { ohne.push(b[2]!); return ok(ohne.length === 2 ? `${ENDE_MARKE}\nx\n` : "bash: paket_holen: command not found\n"); } });
  assert.match(ohne[0]!, /\npaket_holen npm left-pad 1\.3\.0$/);
  for (const b of ohne) assert.doesNotMatch(b, /npm_config|PIP_NO_INDEX|PIP_FIND_LINKS|\/pakete/);
  assert.doesNotMatch(m2.gesehen[0]![1]!.content, /Packages|paket_holen|\/pakete/);

  // Konnten die Pakete der Sperrdatei nicht geholt werden, sagt die Aufgabe es mit der Kennung
  const m3 = drehbuch([bash(`printf '%s\\n' ${ENDE_MARKE} 'x'`)]);
  await repoLauf({ aufgabe: "x", modell: m3.modell, pakete: { hole, fehlt: "paket-pruefsumme" }, fuehre: async () => ok(`${ENDE_MARKE}\nx\n`) });
  assert.match(m3.gesehen[0]![1]!.content, /could not all be downloaded \(paket-pruefsumme\); do not rely on them/);
});

/** Ein kleinstes Rad (`py3-none-any`), gebaut mit zipfile – ohne Netz und ohne Werkzeuge. */
function rad(ordner: string, name: string, version: string, wert: number): { datei: string; bytes: Uint8Array } {
  const datei = `${name}-${version}-py3-none-any.whl`;
  execFileSync("python3", ["-I", "-c", `
import sys, zipfile
n, v, w = sys.argv[2], sys.argv[3], sys.argv[4]
info = n + "-" + v + ".dist-info/"
dateien = {n + "/__init__.py": "WERT = " + w + "\\n", info + "METADATA": "Metadata-Version: 2.1\\nName: " + n + "\\nVersion: " + v + "\\n",
  info + "WHEEL": "Wheel-Version: 1.0\\nGenerator: test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n"}
with zipfile.ZipFile(sys.argv[1], "w") as z:
    for k, t in dateien.items(): z.writestr(k, t)
    z.writestr(info + "RECORD", "".join(k + ",,\\n" for k in dateien) + info + "RECORD,,\\n")
`, join(ordner, datei), name, version, String(wert)]);
  return { datei, bytes: new Uint8Array(readFileSync(join(ordner, datei))) };
}

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], {
  cwd: dir, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
});

/** Ein Repo mit `requirements.txt` als gelesenes Bundle; die Registry als Attrappe, die jede Anfrage merkt. */
async function aufbau(o: { falscheSumme?: boolean } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "repo-pakete-"));
  const alt = rad(repo, "freedom_probe", "1.0.0", 42), neu = rad(repo, "neu_probe", "2.0.0", 7);
  const u = (d: string) => `https://files.pythonhosted.org/packages/ab/cd/${d}`;
  const summe = o.falscheSumme ? "0".repeat(64) : sha256(alt.bytes);
  writeFileSync(join(repo, "requirements.txt"), `freedom_probe==1.0.0 --hash=sha256:${summe}\n`);
  git(repo, "init", "-q");
  git(repo, "add", "requirements.txt");
  git(repo, "commit", "-q", "-m", "erster");
  git(repo, "bundle", "create", "-q", "r.bundle", "HEAD", "main");
  const bundle = await leseBundle(new Uint8Array(readFileSync(join(repo, "r.bundle"))));
  const inhalt: Record<string, Uint8Array | string> = {
    "https://pypi.org/pypi/freedom-probe/1.0.0/json": JSON.stringify({ urls: [{ url: u(alt.datei), filename: alt.datei, digests: { sha256: sha256(alt.bytes) } }] }),
    [u(alt.datei)]: alt.bytes,
    "https://pypi.org/pypi/neu-probe/2.0.0/json": JSON.stringify({ urls: [{ url: u(neu.datei), filename: neu.datei, digests: { sha256: sha256(neu.bytes) } }] }),
    [u(neu.datei)]: neu.bytes,
  };
  const gefragt: string[] = [];
  const abruf: PaketAbruf = async (url) => {
    gefragt.push(url);
    const w = inhalt[url];
    return w === undefined ? new Response("nicht da", { status: 404 }) : new Response(typeof w === "string" ? w : w.slice());
  };
  return { bundle, abruf, gefragt, neu, u };
}

const sandbox = await pruefeSandbox();
const ohneSandbox = !sandbox.ok && `Sandbox geht hier nicht (${sandbox.ok ? "" : sandbox.fall})`;

test("11.5c3 mit bubblewrap: Pakete der Sperrdatei nur lesbar in /pakete, pip installiert ohne Netz, paket_holen legt dazu", { skip: ohneSandbox }, async () => {
  const basis = mkdtempSync(join(tmpdir(), "repo-pakete-basis-"));
  const a = await aufbau();
  const m = drehbuch([
    bash(`ls ${PAKETE_IN_SANDBOX}/pypi; touch ${PAKETE_IN_SANDBOX}/x 2>/dev/null || echo nur-lesbar`),
    // pip fehlt manchem System – dann sagt der Befehl es, und der Test prüft das Installieren nicht
    bash("python3 -m pip --version >/dev/null 2>&1 || { echo ohne-pip; exit 0; }; pip_t=/tmp/t; python3 -m pip install -q --target $pip_t --require-hashes -r requirements.txt && PYTHONPATH=$pip_t python3 -c 'import freedom_probe; print(\"WERT\", freedom_probe.WERT)'"),
    bash("paket_holen pypi neu_probe 2.0.0"),
    bash(`ls ${PAKETE_IN_SANDBOX}/pypi`),
    bash(`printf '%s\\n' ${ENDE_MARKE} 'nichts'`),
  ]);
  const r = await bearbeiteRepo({
    aufgabe: "x", modell: m.modell, bundle: a.bundle, basis, angaben: { name: "Agent", mail: "a@agent.freedom.invalid", zeit: 1_700_000_000, betreff: "x" },
    paketHolen: { tor: null, abruf: a.abruf, plattform: { cpu: "x64" } },
  });
  assert.equal(r.ende, "fertig");
  assert.equal(r.pakete, undefined, "alles geholt");
  assert.match(letzte(m.gesehen[1]!), /freedom_probe-1\.0\.0-py3-none-any\.whl\nnur-lesbar/, "vor dem ersten Schritt da, nur lesbar");
  const pip = letzte(m.gesehen[2]!);
  assert.ok(/ohne-pip/.test(pip) || /WERT 42/.test(pip), pip);
  assert.match(letzte(m.gesehen[3]!), new RegExp(`${a.u(a.neu.datei).replace(/[.]/g, "\\.")} sha256:${sha256(a.neu.bytes)}`));
  assert.match(letzte(m.gesehen[4]!), /neu_probe-2\.0\.0-py3-none-any\.whl/, "das neue Paket liegt danach in /pakete");
  // Nur GET von der Liste, nur was Sperrdatei und paket_holen nannten
  assert.deepEqual(a.gefragt.map((x) => new URL(x).host), ["pypi.org", "files.pythonhosted.org", "pypi.org", "files.pythonhosted.org"]);
  assert.deepEqual(readdirSync(basis), [], "Arbeitsordner und Zwischenspeicher gelöscht");
});

test("11.5c3 mit bubblewrap: Pakete nicht zu holen – der Auftrag läuft ohne sie, Modell und Ergebnis kennen die Kennung", { skip: ohneSandbox }, async () => {
  const basis = mkdtempSync(join(tmpdir(), "repo-pakete-basis-"));
  const a = await aufbau({ falscheSumme: true });
  const m = drehbuch([bash(`ls ${PAKETE_IN_SANDBOX}/pypi 2>&1 | head -1`), bash(`printf '%s\\n' ${ENDE_MARKE} 'nichts'`)]);
  const r = await bearbeiteRepo({
    aufgabe: "x", modell: m.modell, bundle: a.bundle, basis, angaben: { name: "Agent", mail: "a@agent.freedom.invalid", zeit: 1_700_000_000, betreff: "x" },
    paketHolen: { tor: null, abruf: a.abruf, plattform: { cpu: "x64" } },
  });
  assert.equal(r.ende, "fertig");
  assert.equal(r.pakete, "paket-pruefsumme");
  assert.match(m.gesehen[0]![1]!.content, /could not all be downloaded \(paket-pruefsumme\)/);
  assert.doesNotMatch(letzte(m.gesehen[1]!), /freedom_probe/, "nichts mit falscher Summe abgelegt");
  assert.deepEqual(readdirSync(basis), []);

  // Ohne Freigabe holt der Knoten nichts, und die Sandbox hat kein /pakete
  const b = await aufbau();
  const m2 = drehbuch([bash(`ls ${PAKETE_IN_SANDBOX} 2>&1`), bash(`printf '%s\\n' ${ENDE_MARKE} 'nichts'`)]);
  const r2 = await bearbeiteRepo({
    aufgabe: "x", modell: m2.modell, bundle: b.bundle, basis, angaben: { name: "Agent", mail: "a@agent.freedom.invalid", zeit: 1_700_000_000, betreff: "x" },
  });
  assert.equal(r2.pakete, undefined);
  assert.deepEqual(b.gefragt, []);
  assert.match(letzte(m2.gesehen[1]!), /No such file or directory/);
});

test("11.5c3 mit bubblewrap: die Plattform für Räder ist die Python-Fassung in der Sandbox", { skip: ohneSandbox }, async () => {
  const p = await sandboxPlattform();
  assert.equal(p.cpu, process.arch);
  const innen = await fuehreAus(["python3", "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { arbeit: mkdtempSync(join(tmpdir(), "repo-pakete-py-")) });
  const [haupt, neben] = innen.ausgabe.trim().split(" ");
  assert.equal(p.python, `cp${haupt}${neben}`);
  // Ohne bubblewrap gibt es keine Fassung – dann nur reine Räder und Quellarchive
  assert.deepEqual(await sandboxPlattform({ bwrap: "/gibt/es/nicht" }), { cpu: process.arch });
  assert.match(quelle("../src/main.ts"), /repo: \{ pakete: \{ tor: torProxy \?\? null, plattform: await sandboxPlattform\(\) \} \}/);
});
