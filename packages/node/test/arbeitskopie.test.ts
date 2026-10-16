/**
 * Arbeitsordner eines Repo-Auftrags (11.5a1, W3a A): neuer Ordner 0700, die
 * Arbeitskopie nur in einen leeren, echten Ordner, Dateien mit ihrem Modus,
 * Verweise zuletzt und als Verweis – nie ein Pfad durch einen Verweis hinaus.
 * Mit bubblewrap: der Agent liest die Arbeitskopie in der Sandbox (VKb).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARBEITSKOPIE_GRENZEN, type ArbeitsDatei, type Arbeitskopie, arbeitskopie, leseBundle, schreibePatch } from "@freedomstack/protocol";
import { arbeitsOrt, leseArbeitsordner, neuerArbeitsordner, schreibeArbeitskopie } from "../src/arbeitskopie.js";
import { fuehreAus, pruefeSandbox } from "../src/sandbox.js";

const d = (pfad: string, art: ArbeitsDatei["art"], inhalt: string): ArbeitsDatei => ({ pfad, art, daten: new TextEncoder().encode(inhalt) });
const kopie = (...dateien: ArbeitsDatei[]): Arbeitskopie => ({ commit: "0".repeat(40), dateien, module: [] });
const basis = () => mkdtempSync(join(tmpdir(), "arbeitsort-"));

test("11.5a1: Arbeitsordner – im Arbeitsspeicher, wo es ihn gibt, 0700, weg() löscht alles", () => {
  assert.equal(arbeitsOrt("/gibt/es/nicht"), tmpdir());
  if (existsSync("/dev/shm") && lstatSync("/dev/shm").isDirectory()) assert.equal(arbeitsOrt(), "/dev/shm");
  const { ordner, weg } = neuerArbeitsordner(basis());
  assert.equal(statSync(ordner).mode & 0o777, 0o700);
  schreibeArbeitskopie(ordner, kopie(d("a/b.txt", "datei", "x")));
  weg();
  assert.ok(!existsSync(ordner));
});

test("11.5a1: Arbeitskopie schreiben – Inhalte, Modi, Verweise als Verweis", () => {
  const { ordner } = neuerArbeitsordner(basis());
  schreibeArbeitskopie(ordner, kopie(
    d("liesmich", "verweis", "README.md"), d("README.md", "datei", "# Probe\n"), d("bin/start.sh", "ausfuehrbar", "#!/bin/sh\n"), d("src/tief/a.ts", "datei", "a"),
  ));
  assert.equal(readFileSync(join(ordner, "README.md"), "utf8"), "# Probe\n");
  assert.equal(statSync(join(ordner, "README.md")).mode & 0o111, 0);
  assert.equal(statSync(join(ordner, "bin/start.sh")).mode & 0o100, 0o100);
  assert.equal(readFileSync(join(ordner, "src/tief/a.ts"), "utf8"), "a");
  assert.ok(lstatSync(join(ordner, "liesmich")).isSymbolicLink());
  assert.equal(readlinkSync(join(ordner, "liesmich")), "README.md");
});

test("11.5a1: nur in einen leeren, echten Ordner; ungültige Pfade schreiben nichts; nie durch einen Verweis hinaus", () => {
  const voll = neuerArbeitsordner(basis()).ordner;
  writeFileSync(join(voll, "da"), "");
  assert.throws(() => schreibeArbeitskopie(voll, kopie(d("a", "datei", "x"))), /kein leerer Ordner/);
  // der Ordner selbst als Verweis
  const echt = neuerArbeitsordner(basis()).ordner, verweis = join(basis(), "verweis");
  symlinkSync(echt, verweis);
  assert.throws(() => schreibeArbeitskopie(verweis, kopie(d("a", "datei", "x"))), /kein leerer Ordner/);
  assert.ok(!existsSync(join(echt, "a")));
  for (const boese of ["../aussen", ".git/hooks/pre-commit", "/abs"]) {
    const o = neuerArbeitsordner(basis()).ordner;
    assert.throws(() => schreibeArbeitskopie(o, kopie(d("ok", "datei", "x"), d(boese, "datei", "x"))), /Pfad ungültig/, boese);
    assert.ok(!existsSync(join(o, "ok")), "nichts geschrieben");
  }
  // Verweis „a“ nach draußen und eine Datei „a/x“: die Datei zuerst, der Verweis scheitert – draußen landet nichts
  const aussen = mkdtempSync(join(tmpdir(), "aussen-"));
  const o = neuerArbeitsordner(basis()).ordner;
  assert.throws(() => schreibeArbeitskopie(o, kopie(d("a", "verweis", aussen), d("a/x", "datei", "geheim"))));
  assert.ok(!existsSync(join(aussen, "x")));
});

const sandbox = await pruefeSandbox();
test("11.5a1 mit VKb (bubblewrap): der Agent liest die Arbeitskopie in der Sandbox, der Verweis zeigt nur hinein", { skip: !sandbox.ok && `Sandbox geht hier nicht (${sandbox.ok ? "" : sandbox.fall})` }, async () => {
  const { ordner, weg } = neuerArbeitsordner(basis());
  try {
    schreibeArbeitskopie(ordner, kopie(d("README.md", "datei", "# Probe\n"), d("bin/start.sh", "ausfuehrbar", "#!/bin/sh\necho gestartet\n"), d("knoten", "verweis", "/home/user/.freedom/node-key")));
    const r = await fuehreAus(["/bin/sh", "-c", "cat README.md; ./bin/start.sh; cat knoten 2>/dev/null || echo verweis-leer"], { arbeit: ordner });
    assert.equal(r.code, 0);
    assert.equal(r.ausgabe, "# Probe\ngestartet\nverweis-leer\n");
  } finally {
    weg();
  }
});

const gitUmgebung = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_NAME: "Agent", GIT_COMMITTER_EMAIL: "agent@freedom.invalid" };
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", "-c", "core.quotePath=false", ...args], { cwd: dir, env: gitUmgebung }).toString();
const schreibe = (wurzel: string, dateien: Record<string, string>) => {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
};
const leer: Arbeitskopie = { commit: "0".repeat(40), dateien: [], module: [] };

test("11.5a2b: .gitignore wie git – dieselben Dateien wie `git add -A` und `git ls-files`", () => {
  const o = mkdtempSync(join(tmpdir(), "ignore-"));
  schreibe(o, {
    ".gitignore": "# Kommentar\nnode_modules/\n*.log\n!wichtig.log\n/nur-oben.txt\nbuild/\n**/cache\ndocs/**/*.tmp\n[Tt]emp*\n\\#raute\nleer\\ \nordner-nur/\nabc/**\n",
    "src/.gitignore": "*.gen.ts\n!keep.gen.ts\n/lokal\n",
    "a.txt": "", "x.log": "", "wichtig.log": "", "nur-oben.txt": "", "sub/nur-oben.txt": "", "node_modules/p/index.js": "", "build/out.js": "",
    "src/a.ts": "", "src/b.gen.ts": "", "src/keep.gen.ts": "", "src/lokal": "", "src/x/lokal": "", "deep/cache/c.txt": "", "cache": "",
    "docs/a/b/c.tmp": "", "docs/c.tmp": "", "docs/d.txt": "", "Temp1.txt": "", "temp2/x.txt": "", "#raute": "", "leer ": "", "ordner-nur": "",
    "x/ordner-nur/y.txt": "", "abc/d/e.txt": "", "abcd.txt": "", "ä/ö.txt": "",
  });
  git(o, "init", "-q");
  git(o, "add", "-A");
  const erwartet = git(o, "ls-files", "-z").split("\0").filter(Boolean).sort();
  const r = leseArbeitsordner(o, leer);
  assert.ok("dateien" in r, JSON.stringify(r));
  assert.deepEqual(r.dateien.map((d) => d.pfad).sort(), erwartet);
});

test("11.5a2b: bekannte Dateien bleiben, auch ignoriert; .git, Submodule und Sonderdateien nie; Verweise als Text", () => {
  const o = mkdtempSync(join(tmpdir(), "ordner-"));
  schreibe(o, { ".gitignore": "build/\n*.log\n", "build/keep.js": "bekannt", "build/neu.js": "neu", "alt.log": "bekannt", "neu.log": "", ".git/config": "[core]", ".GIT/x": "", "modul/datei": "" });
  symlinkSync("/etc/passwd", join(o, "passwd"));
  symlinkSync("/etc", join(o, "etc"));
  execFileSync("mkfifo", [join(o, "fifo")]);
  const alt: Arbeitskopie = { commit: "0".repeat(40), dateien: [d("build/keep.js", "datei", "x"), d("alt.log", "datei", "x")], module: [{ pfad: "modul", sha: "ab".repeat(20) }] };
  const r = leseArbeitsordner(o, alt);
  assert.ok("dateien" in r);
  const nach = new Map(r.dateien.map((x) => [x.pfad, x]));
  assert.deepEqual([...nach.keys()].sort(), [".gitignore", "alt.log", "build/keep.js", "etc", "passwd"]);
  assert.equal(nach.get("passwd")!.art, "verweis");
  assert.equal(new TextDecoder().decode(nach.get("passwd")!.daten), "/etc/passwd", "der Text des Verweises, nie die Datei");
  assert.equal(nach.get("etc")!.art, "verweis");
});

test("11.5a2b: Grenzen und Unlesbares – kein halber Stand", () => {
  const o = mkdtempSync(join(tmpdir(), "grenze-"));
  schreibe(o, Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.txt`, "x"])));
  assert.deepEqual(leseArbeitsordner(o, leer, { ...ARBEITSKOPIE_GRENZEN, dateien: 20 }), { fall: "patch.gross" });
  assert.deepEqual(leseArbeitsordner(o, leer, { ...ARBEITSKOPIE_GRENZEN, bytes: 10 }), { fall: "patch.gross" });
  schreibe(o, { "a/b/c/d/e.txt": "" });
  assert.deepEqual(leseArbeitsordner(o, leer, { ...ARBEITSKOPIE_GRENZEN, tiefe: 2 }), { fall: "patch.gross" });
  const verweis = join(mkdtempSync(join(tmpdir(), "v-")), "ordner");
  symlinkSync(o, verweis);
  assert.deepEqual(leseArbeitsordner(verweis, leer), { fall: "patch.ordner" }, "der Ordner selbst als Verweis");
  assert.deepEqual(leseArbeitsordner(join(o, "gibt-es-nicht"), leer), { fall: "patch.ordner" });
});

test("11.5a2b: Ende zu Ende – Bundle, Arbeitsordner, Änderungen des Agenten, Patch; git am ergibt denselben Commit", async () => {
  const repo = mkdtempSync(join(tmpdir(), "e2e-"));
  git(repo, "init", "-q");
  schreibe(repo, { ".gitignore": "node_modules/\ndist/\n", "README.md": "# Probe\n", "src/a.ts": "export const a = 1;\n", "weg.txt": "weg\n" });
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "erster");
  git(repo, "bundle", "create", "-q", "r.bundle", "HEAD", "main");
  const kopie = arbeitskopie(await leseBundle(new Uint8Array(readFileSync(join(repo, "r.bundle")))));
  const { ordner, weg } = neuerArbeitsordner(basis());
  try {
    schreibeArbeitskopie(ordner, kopie);
    // was ein Agent in der Sandbox tut: ändern, anlegen, löschen, bauen, git init, Verweis nach draußen
    schreibe(ordner, { "src/a.ts": "export const a = 2;\n", "src/b.ts": "export const b = 1;\n", "node_modules/x/i.js": "x", "dist/a.js": "x", ".git/config": "[core]\n\tfsmonitor = boese\n" });
    rmSync(join(ordner, "weg.txt"));
    symlinkSync("/etc/passwd", join(ordner, "src/schluessel"));
    const gelesen = leseArbeitsordner(ordner, kopie);
    assert.ok("dateien" in gelesen);
    const p = await schreibePatch(kopie, gelesen.dateien, { name: "Agent", mail: "agent@freedom.invalid", zeit: 1_790_000_000, betreff: "a erhöht, b neu" });
    assert.ok(p.ok, JSON.stringify(p));
    assert.deepEqual(p.geaendert, ["src/a.ts", "src/b.ts", "src/schluessel", "weg.txt"]);
    assert.doesNotMatch(p.text, /node_modules|dist\/a\.js|fsmonitor|root:/);
    assert.match(p.text, /^\+\/etc\/passwd$/m);
    const klon = mkdtempSync(join(tmpdir(), "klon-"));
    git(klon, "clone", "-q", join(repo, "r.bundle"), ".");
    writeFileSync(join(klon, "p.patch"), p.text);
    git(klon, "am", "-q", "--committer-date-is-author-date", "p.patch");
    assert.equal(git(klon, "rev-parse", "HEAD").trim(), p.commit);
  } finally {
    weg();
  }
});
