/**
 * Patch-Schreiber (11.5a2a, REPO-AGENTEN-ENTWURF V5): der Text wie `git format-patch`
 * – `git apply --check` nimmt ihn, `git am` ergibt genau den Commit aus der ersten
 * Zeile (Baum, Eltern, Autor, Nachricht wie git); Diff minimal, Grenzen und Fälle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ArbeitsDatei, type Arbeitskopie, PATCH_MAX_BYTES, arbeitskopie, lesePatchText, leseBundle, schreibePatch, zeilenDiff } from "../src/index.js";

const UMGEBUNG = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_EMAIL: "agent@freedom.invalid" };
/** git ohne Einstellungen des Rechners; der Committer heißt wie der Autor des Patches (`git am` nimmt ihn aus der Umgebung). */
const git = (dir: string, ...args: string[]) => gitAls("Prüfer Agent", dir, ...args);
const gitAls = (committer: string, dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, env: { ...UMGEBUNG, GIT_COMMITTER_NAME: committer } }).toString();
const enc = (s: string) => new TextEncoder().encode(s);
const ANGABEN = { name: "Prüfer Agent", mail: "agent@freedom.invalid", zeit: 1_790_000_000, betreff: "Liste ergänzt", beschreibung: "Zwei Zeilen dazu.\n\nUnd eine weg." };

/** Ein Repo mit allem, was vorkommt: Ordner, ausführbar, Verweis, Submodul, ohne Zeilenende, Umlaute, BOM. */
async function probeRepo(): Promise<{ repo: string; kopie: Arbeitskopie }> {
  const repo = mkdtempSync(join(tmpdir(), "patch-"));
  git(repo, "init", "-q");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "README.md"), "# Probe\n");
  writeFileSync(join(repo, "src", "liste.txt"), Array.from({ length: 40 }, (_, i) => `Zeile ${i + 1}`).join("\n") + "\n");
  writeFileSync(join(repo, "ohne-ende.txt"), "erste\nletzte ohne Zeilenende");
  writeFileSync(join(repo, "ä ö.txt"), "Grüße\n");
  writeFileSync(join(repo, "bom.txt"), "﻿mit BOM\n");
  writeFileSync(join(repo, "start.sh"), "#!/bin/sh\n");
  writeFileSync(join(repo, "weg.txt"), "kommt weg\n");
  symlinkSync("README.md", join(repo, "verweis"));
  git(repo, "add", ".");
  git(repo, "update-index", "--add", "--cacheinfo", `160000,${"cd".repeat(20)},modul`);
  git(repo, "commit", "-q", "-m", "erster");
  git(repo, "bundle", "create", "-q", "r.bundle", "HEAD", "main");
  return { repo, kopie: arbeitskopie(await leseBundle(new Uint8Array(readFileSync(join(repo, "r.bundle"))))) };
}

/** Den Patch in einem frischen Klon anwenden – erst prüfen, dann `git am` mit Committer = Autor und dessen Zeit. */
function wendeAn(repo: string, text: string, committer = "Prüfer Agent"): string {
  const klon = mkdtempSync(join(tmpdir(), "klon-"));
  git(klon, "clone", "-q", join(repo, "r.bundle"), ".");
  writeFileSync(join(klon, "p.patch"), text);
  git(klon, "apply", "--check", "p.patch");
  gitAls(committer, klon, "am", "-q", "--committer-date-is-author-date", "p.patch");
  return klon;
}

const aendere = (k: Arbeitskopie, aenderungen: Record<string, ArbeitsDatei | null>): ArbeitsDatei[] =>
  [...k.dateien.filter((d) => !(d.pfad in aenderungen)), ...Object.values(aenderungen).filter((d): d is ArbeitsDatei => d !== null)];
const datei = (pfad: string, inhalt: string, art: ArbeitsDatei["art"] = "datei"): ArbeitsDatei => ({ pfad, art, daten: enc(inhalt) });

test("11.5a2a: Diff minimal und vollständig – beide Seiten lassen sich zurückgewinnen", () => {
  const ops = zeilenDiff(["a\n", "b\n", "c\n", "d\n"], ["a\n", "x\n", "c\n", "d\n", "e\n"])!;
  assert.deepEqual(ops, [[" ", "a\n"], ["-", "b\n"], ["+", "x\n"], [" ", "c\n"], [" ", "d\n"], ["+", "e\n"]]);
  assert.deepEqual(zeilenDiff([], []), []);
  assert.equal(zeilenDiff(Array.from({ length: 50 }, (_, i) => `${i}`), [], 10), null, "über der Grenze");
});

test("11.5a2a: echte Änderungen – git apply nimmt den Patch, git am ergibt denselben Commit", async () => {
  const { repo, kopie } = await probeRepo();
  const liste = Array.from({ length: 40 }, (_, i) => `Zeile ${i + 1}`);
  liste[2] = "Zeile 3 geändert";
  liste.splice(30, 1);
  liste.push("neu am Ende");
  const neu = aendere(kopie, {
    "src/liste.txt": datei("src/liste.txt", liste.join("\n") + "\n"),
    "ohne-ende.txt": datei("ohne-ende.txt", "erste\nletzte jetzt mit Zeilenende\n"),
    "ä ö.txt": datei("ä ö.txt", "Grüße aus Köln\n"),
    "bom.txt": datei("bom.txt", "﻿mit BOM\nund mehr\n"),
    "start.sh": { ...datei("start.sh", "#!/bin/sh\n"), art: "ausfuehrbar" },
    "weg.txt": null,
    "verweis": datei("verweis", "src/liste.txt", "verweis"),
    "src/neu/datei.ts": datei("src/neu/datei.ts", "export const neu = true;\n"),
    "leer.txt": datei("leer.txt", ""),
  });
  const p = await schreibePatch(kopie, neu, ANGABEN);
  assert.ok(p.ok, JSON.stringify(p));
  assert.deepEqual(p.geaendert, ["bom.txt", "leer.txt", "ohne-ende.txt", "src/liste.txt", "src/neu/datei.ts", "start.sh", "verweis", "weg.txt", "ä ö.txt"]);
  assert.deepEqual(lesePatchText(p.text), { commit: p.commit, betreff: "Liste ergänzt" });
  assert.match(p.text, /^diff --git "a\/\\303\\244 \\303\\266.txt" "b\/\\303\\244 \\303\\266.txt"$/m, "Pfad gequotet wie git");
  assert.match(p.text, /^Subject: \[PATCH\] =\?UTF-8\?q\?Liste_erg=C3=A4nzt\?=$/m);
  const klon = wendeAn(repo, p.text);
  assert.equal(git(klon, "rev-parse", "HEAD").trim(), p.commit, "derselbe Commit wie git");
  assert.equal(git(klon, "log", "-1", "--format=%an <%ae>%n%B"), "Prüfer Agent <agent@freedom.invalid>\nListe ergänzt\n\nZwei Zeilen dazu.\n\nUnd eine weg.\n\n");
  assert.equal(git(klon, "ls-tree", "HEAD", "modul").split(/\s+/)[2], "cd".repeat(20), "Submodul unberührt");
  assert.equal(readFileSync(join(klon, "bom.txt"), "utf8"), "﻿mit BOM\nund mehr\n");
});

test("11.5a2a: Betreff und Beschreibung, die git sonst anders läse – Vorspann, Trenner, Diff-Zeilen, Mbox-Zeilen", async () => {
  const { repo, kopie } = await probeRepo();
  const neu = aendere(kopie, { "README.md": datei("README.md", "# Probe\n\nmehr\n") });
  const p = await schreibePatch(kopie, neu, {
    ...ANGABEN, name: 'Böse "Name", <x@y>', betreff: "[WIP] Re: README  ergänzt\nzweite Zeile",
    beschreibung: "oben\n---\ndiff --git a/x b/x\nFrom 1234 Mon\n-- \nunten   \n\n\n\nEnde\r\n",
  });
  assert.ok(p.ok, JSON.stringify(p));
  const klon = wendeAn(repo, p.text, "Böse Name x y");
  assert.equal(git(klon, "rev-parse", "HEAD").trim(), p.commit);
  assert.equal(git(klon, "log", "-1", "--format=%an%n%B"), "Böse Name x y\nREADME ergänzt zweite Zeile\n\noben\n ---\n diff --git a/x b/x\n From 1234 Mon\n --\nunten\n\nEnde\n\n");
});

test("11.5a2a: Art gewechselt (Datei ↔ Verweis) wie git als Löschen und Anlegen; nur der Modus geändert", async () => {
  const { repo, kopie } = await probeRepo();
  const neu = aendere(kopie, { "verweis": datei("verweis", "jetzt eine Datei\n"), "README.md": datei("README.md", "src", "verweis") });
  const p = await schreibePatch(kopie, neu, ANGABEN);
  assert.ok(p.ok);
  assert.equal((p.text.match(/^diff --git a\/verweis b\/verweis$/gm) ?? []).length, 2);
  assert.equal(git(wendeAn(repo, p.text), "rev-parse", "HEAD").trim(), p.commit);
  const nurModus = await schreibePatch(kopie, aendere(kopie, { "start.sh": { ...datei("start.sh", "#!/bin/sh\n"), art: "ausfuehrbar" } }), ANGABEN);
  assert.ok(nurModus.ok);
  assert.match(nurModus.text, /^old mode 100644\nnew mode 100755\n(?!index)/m);
  assert.equal(git(wendeAn(repo, nurModus.text), "rev-parse", "HEAD").trim(), nurModus.commit);
});

test("11.5a2a: kein Patch – ohne Änderung, binär, zu groß, ungültige Angaben oder Pfade", async () => {
  const { kopie } = await probeRepo();
  assert.deepEqual(await schreibePatch(kopie, kopie.dateien, ANGABEN), { ok: false, fall: "patch.keine-aenderung" });
  const binaer = new Uint8Array([1, 0, 2]);
  assert.deepEqual(await schreibePatch(kopie, [...kopie.dateien, { pfad: "bild.bin", art: "datei", daten: binaer }], ANGABEN), { ok: false, fall: "patch.binaer" });
  assert.deepEqual(await schreibePatch(kopie, aendere(kopie, { "README.md": { pfad: "README.md", art: "datei", daten: new Uint8Array([0xff, 0xfe, 0x0a]) } }), ANGABEN), { ok: false, fall: "patch.binaer" }, "kein UTF-8");
  const viel = Array.from({ length: 3000 }, (_, i) => `eine ziemlich lange Zeile Nummer ${i}`).join("\n") + "\n";
  assert.ok(enc(viel).length > PATCH_MAX_BYTES);
  assert.deepEqual(await schreibePatch(kopie, [...kopie.dateien, datei("gross.txt", viel)], ANGABEN), { ok: false, fall: "patch.gross" });
  for (const falsch of [{ mail: "keine-mail" }, { betreff: "  [PATCH] " }, { name: "<>" }, { zeit: -1 }]) {
    assert.deepEqual(await schreibePatch(kopie, [...kopie.dateien, datei("x", "y\n")], { ...ANGABEN, ...falsch }), { ok: false, fall: "patch.angaben" }, JSON.stringify(falsch));
  }
  for (const pfad of [".git/config", "../aussen", "a//b"]) {
    assert.deepEqual(await schreibePatch(kopie, [...kopie.dateien, datei(pfad, "y\n")], ANGABEN), { ok: false, fall: "patch.angaben" }, pfad);
  }
  assert.deepEqual(await schreibePatch(kopie, [...kopie.dateien, datei("x", "1\n"), datei("x", "2\n")], ANGABEN), { ok: false, fall: "patch.angaben" }, "doppelt");
});
