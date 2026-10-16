/**
 * Arbeitskopie eines Repo-Auftrags (11.5a1, REPO-AGENTEN-ENTWURF V3/V4, W3a A):
 * der Baum am Kopf als Dateien – gleich wie git ihn auscheckt, Pfade nach den
 * Regeln aus V4, jeder Name einmal, alles begrenzt; Fremdes bricht mit Kennung ab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARBEITSKOPIE_GRENZEN, BundleFehler, type BundleFehlerArt, type GelesenesBundle, type GitObjekt, arbeitskopie, istRepoPfad, kopfCommit, leseBundle,
} from "../src/index.js";

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).toString();
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const text = (d: Uint8Array) => new TextDecoder().decode(d);

/** Ein Bundle von Hand: Objekte unter erfundenen Kennungen (`arbeitskopie()` rechnet nicht nach – das tut `leseBundle()`). */
let nr = 0;
const kennung = () => (++nr).toString(16).padStart(40, "0");
function bundle(objekte: Array<[string, GitObjekt]>, kopf: string): GelesenesBundle {
  return { version: 2, refs: [{ name: "HEAD", sha: kopf }], voraussetzungen: [], objekte: new Map(objekte) };
}
const blob = (inhalt: string | Uint8Array): GitObjekt => ({ art: "blob", daten: typeof inhalt === "string" ? new TextEncoder().encode(inhalt) : inhalt });
const baum = (...e: Array<[modus: string, name: string, sha: string]>): GitObjekt => ({
  art: "tree", daten: new Uint8Array(e.flatMap(([m, n, s]) => [...new TextEncoder().encode(`${m} ${n}\0`), ...Buffer.from(s, "hex")])),
});
const commit = (baumSha: string): GitObjekt => ({ art: "commit", daten: new TextEncoder().encode(`tree ${baumSha}\nauthor a <a@a> 1 +0000\n\nx\n`) });
/** Ein Commit auf einem Baum mit diesen Einträgen; weitere Objekte dazu. */
function mitBaum(eintraege: Array<[string, string, string]>, weitere: Array<[string, GitObjekt]> = []): GelesenesBundle {
  const t = kennung(), c = kennung();
  return bundle([[t, baum(...eintraege)], [c, commit(t)], ...weitere], c);
}
function art(f: () => unknown): BundleFehlerArt | "keiner" {
  try {
    f();
    return "keiner";
  } catch (e) {
    assert.ok(e instanceof BundleFehler, String(e));
    return e.art;
  }
}

test("11.5a1: Pfad-Regeln aus V4 – relativ, kein „..“, kein „.git“ in keinem Teil, keine Steuerzeichen", () => {
  for (const gut of ["a", "a/b.txt", "ä/ö.md", ".github/workflows/ci.yml", "x.git", ".gitignore", "a b/c", "a\\b"]) assert.ok(istRepoPfad(gut), gut);
  for (const boese of ["", "/a", "a/", "a//b", "./a", "a/./b", "..", "a/../b", ".git", ".git/config", "a/.GIT/x", "a/.Git", "a\nb", "a\u0000b", "a\u007fb", `${"x".repeat(256)}/a`, `${"ä".repeat(128)}`]) {
    assert.ok(!istRepoPfad(boese), JSON.stringify(boese));
  }
});

test("11.5a1: echtes Bundle von git – dieselben Dateien, Modi und Inhalte wie `git ls-tree`; Verweis als Text, Submodul unberührt", async () => {
  const repo = mkdtempSync(join(tmpdir(), "arbeitskopie-"));
  git(repo, "init", "-q");
  mkdirSync(join(repo, "bin"));
  mkdirSync(join(repo, "src", "tief"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "# Probe\n");
  writeFileSync(join(repo, "bin", "start.sh"), "#!/bin/sh\necho hallo\n");
  chmodSync(join(repo, "bin", "start.sh"), 0o755);
  writeFileSync(join(repo, "src", "tief", "a.ts"), "export const a = 1;\n");
  symlinkSync("../README.md", join(repo, "src", "liesmich"));
  git(repo, "add", ".");
  git(repo, "update-index", "--add", "--cacheinfo", `160000,${"ab".repeat(20)},modul`);
  git(repo, "commit", "-q", "-m", "erster");
  git(repo, "bundle", "create", "-q", "repo.bundle", "HEAD", "main");
  const b = await leseBundle(new Uint8Array(readFileSync(join(repo, "repo.bundle"))));
  const k = arbeitskopie(b);
  assert.equal(k.commit, git(repo, "rev-parse", "HEAD").trim());
  const erwartet = git(repo, "ls-tree", "-r", "HEAD").trim().split("\n").map((z) => z.split(/\s+/)).filter(([m]) => m !== "160000");
  const art = { "100644": "datei", "100755": "ausfuehrbar", "120000": "verweis" } as const;
  assert.deepEqual(k.dateien.map((d) => [d.pfad, d.art]).sort(), erwartet.map(([m, , , p]) => [p, art[m as keyof typeof art]]).sort());
  for (const d of k.dateien) assert.equal(text(d.daten), git(repo, "cat-file", "-p", `HEAD:${d.pfad}`), d.pfad);
  assert.equal(text(k.dateien.find((d) => d.pfad === "src/liesmich")!.daten), "../README.md");
  assert.deepEqual(k.module, [{ pfad: "modul", sha: "ab".repeat(20) }]);
  for (const d of k.dateien) assert.equal(d.sha, git(repo, "rev-parse", `HEAD:${d.pfad}`).trim(), `Kennung ${d.pfad}`);
});

test("11.5a1: Probe-Bundle aus dem Reiter „Code“ – Kopf wie `kopfCommit()`, drei Dateien", async () => {
  const b = await leseBundle(fixture("probe-v2.bundle"));
  const k = arbeitskopie(b);
  assert.equal(k.commit, kopfCommit(b));
  assert.deepEqual(k.dateien.map((d) => d.pfad).sort(), ["README.md", "bild.bin", "src/liste.txt"]);
  assert.ok(k.dateien.every((d) => d.art === "datei"));
});

test("11.5a1: feindlich – „.git“, doppelte Namen, fehlende Objekte, kaputte Verweise brechen ab", () => {
  const b1 = kennung();
  const ok = blob("x");
  for (const name of [".git", ".GIT", ".gIt"]) assert.equal(art(() => arbeitskopie(mitBaum([["100644", name, b1]], [[b1, ok]]))), "kaputt", name);
  const unter = kennung();
  assert.equal(art(() => arbeitskopie(mitBaum([["40000", ".git", unter]], [[unter, baum(["100644", "config", b1])], [b1, ok]]))), "kaputt", "Ordner .git");
  assert.equal(art(() => arbeitskopie(mitBaum([["100644", "a", b1], ["100644", "a", b1]], [[b1, ok]]))), "kaputt", "doppelt");
  assert.equal(art(() => arbeitskopie(mitBaum([["40000", "a", unter], ["100644", "a", b1]], [[unter, baum(["100644", "x", b1])], [b1, ok]]))), "kaputt", "Ordner und Datei gleich");
  assert.equal(art(() => arbeitskopie(mitBaum([["100644", "fehlt", kennung()]]))), "kaputt", "Blob fehlt");
  assert.equal(art(() => arbeitskopie(mitBaum([["40000", "ordner", kennung()]]))), "kaputt", "Baum fehlt");
  assert.equal(art(() => arbeitskopie(mitBaum([["100644", "a", unter]], [[unter, baum()]]))), "kaputt", "Blob ist ein Baum");
  for (const ziel of ["", "a\u0000b", "x".repeat(ARBEITSKOPIE_GRENZEN.verweis + 1)]) {
    assert.equal(art(() => arbeitskopie(mitBaum([["120000", "v", b1]], [[b1, blob(ziel)]]))), "kaputt", `Verweis ${ziel.length}`);
  }
  // Kopf: nur ein Commit aus dem Bundle
  assert.equal(art(() => arbeitskopie(bundle([], kennung()))), "kaputt");
  assert.equal(art(() => arbeitskopie(mitBaum([]), b1)), "kaputt");
  assert.deepEqual(arbeitskopie(mitBaum([])).dateien, [], "leerer Baum geht");
});

test("11.5a1: Grenzen – derselbe Ordner an vielen Stellen zählt je Stelle; Bytes und Tiefe begrenzt", () => {
  const g = { ...ARBEITSKOPIE_GRENZEN, dateien: 50, bytes: 1000, tiefe: 4 };
  // 10 × 10 Verweise auf denselben Ordner mit einer Datei: 100 Dateien aus vier Objekten
  const b1 = kennung(), t0 = kennung(), t1 = kennung();
  const zehn = (sha: string) => Array.from({ length: 10 }, (_, i) => ["40000", `o${i}`, sha] as [string, string, string]);
  const breit = mitBaum(zehn(t1), [[t1, baum(...zehn(t0))], [t0, baum(["100644", "f", b1])], [b1, blob("x")]]);
  assert.equal(art(() => arbeitskopie(breit, undefined, g)), "gross");
  assert.equal(arbeitskopie(breit, undefined, { ...g, dateien: 100 }).dateien.length, 100);
  // Bytes: zwei Stellen derselben 600 Bytes
  const gross = kennung();
  assert.equal(art(() => arbeitskopie(mitBaum([["100644", "a", gross], ["100644", "b", gross]], [[gross, blob("y".repeat(600))]]), undefined, g)), "gross");
  // Tiefe: Ordner in Ordnern
  let unten = kennung();
  const kette: Array<[string, GitObjekt]> = [[unten, baum(["100644", "f", b1])], [b1, blob("x")]];
  for (let i = 0; i < 5; i++) {
    const oben = kennung();
    kette.push([oben, baum(["40000", "d", unten])]);
    unten = oben;
  }
  assert.equal(art(() => arbeitskopie(mitBaum([["40000", "d", unten]], kette), undefined, g)), "gross");
  assert.equal(arbeitskopie(mitBaum([["40000", "d", unten]], kette), undefined, { ...g, tiefe: 8 }).dateien[0]!.pfad, "d/d/d/d/d/d/f");
});
