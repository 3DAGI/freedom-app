/**
 * Schritt C.3b1: Diff-Leser für Patches aus `git format-patch` – ohne DOM,
 * auch gegen feindliche Eingaben: nie eine Ausnahme, alles begrenzt,
 * Zeilennummern nur aus geprüften Köpfen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DIFF_GRENZEN, leseDiff } from "../src/diff-ansicht.js";

const SHA = "a".repeat(40);
const patch = (rumpf: string, nachricht = "Erklärt, warum.\n\nZweiter Absatz.") =>
  `From ${SHA} Mon Sep 17 00:00:00 2001\nFrom: Ada <ada@example.org>\nDate: Mon, 28 Sep 2026 10:00:00 +0200\n`
  + `Subject: [PATCH] Hammer\n schärfen\n\n${nachricht}\n---\n hammer.txt | 2 +-\n 1 file changed\n\n${rumpf}-- \n2.43.0\n`;

test("C.3b1: Kopf, Nachricht, Datei mit Abschnitt und Zeilennummern", () => {
  const d = leseDiff(patch(
    "diff --git a/hammer.txt b/hammer.txt\nindex 1..2 100644\n--- a/hammer.txt\n+++ b/hammer.txt\n"
    + "@@ -3,4 +3,5 @@ werkzeug\n eins\n-stumpf\n+scharf\n+sehr scharf\n zwei\n drei\n",
  ));
  assert.equal(d.autor, "Ada <ada@example.org>");
  assert.equal(d.datum, "Mon, 28 Sep 2026 10:00:00 +0200");
  assert.equal(d.nachricht, "Erklärt, warum.\n\nZweiter Absatz.");
  assert.equal(d.gekuerzt, false);
  assert.deepEqual([d.plus, d.minus, d.dateien.length], [2, 1, 1]);
  const [f] = d.dateien;
  assert.deepEqual([f!.alt, f!.neu, f!.art, f!.binaer], ["hammer.txt", "hammer.txt", "geaendert", false]);
  assert.equal(f!.abschnitte[0]!.kopf, "@@ -3,4 +3,5 @@ werkzeug");
  assert.deepEqual(f!.abschnitte[0]!.zeilen, [
    { art: "kontext", text: "eins", alt: 3, neu: 3 },
    { art: "weg", text: "stumpf", alt: 4 },
    { art: "neu", text: "scharf", neu: 4 },
    { art: "neu", text: "sehr scharf", neu: 5 },
    { art: "kontext", text: "zwei", alt: 5, neu: 6 },
    { art: "kontext", text: "drei", alt: 6, neu: 7 },
  ]);
  // Die Signatur „-- “ nach dem Diff ist keine entfernte Zeile
  assert.ok(!f!.abschnitte[0]!.zeilen.some((z) => z.text.includes("2.43")));
});

test("C.3b1: neu, gelöscht, umbenannt, binär, ohne Zeilenende, CRLF, mehrere Abschnitte", () => {
  const d = leseDiff(patch([
    "diff --git a/neu.md b/neu.md\nnew file mode 100644\n--- /dev/null\n+++ b/neu.md\n@@ -0,0 +1,2 @@\n+# Titel\n+Text\n\\ No newline at end of file\n",
    "diff --git a/alt.md b/alt.md\ndeleted file mode 100644\n--- a/alt.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-weg\n",
    "diff --git a/a.txt b/b.txt\nsimilarity index 90%\nrename from a.txt\nrename to b.txt\n",
    "diff --git a/bild.png b/bild.png\nBinary files a/bild.png and b/bild.png differ\n",
    "diff --git a/x.c b/x.c\n--- a/x.c\n+++ b/x.c\n@@ -1,2 +1,2 @@\n-a\n+b\n c\n@@ -10 +10 @@ f()\n-d\n+e\n",
  ].join("").replace(/\n/g, "\r\n")));
  assert.deepEqual(d.dateien.map((f) => [f.alt, f.neu, f.art, f.binaer, f.plus, f.minus, f.abschnitte.length]), [
    ["neu.md", "neu.md", "neu", false, 2, 0, 1],
    ["alt.md", "alt.md", "geloescht", false, 0, 1, 1],
    ["a.txt", "b.txt", "umbenannt", false, 0, 0, 0],
    ["bild.png", "bild.png", "geaendert", true, 0, 0, 0],
    ["x.c", "x.c", "geaendert", false, 2, 2, 2],
  ]);
  assert.deepEqual(d.dateien[0]!.abschnitte[0]!.zeilen.at(-1), { art: "hinweis", text: "No newline at end of file" });
  assert.deepEqual(d.dateien[4]!.abschnitte[1]!.zeilen, [{ art: "weg", text: "d", alt: 10 }, { art: "neu", text: "e", neu: 10 }]);
});

test("C.3b1: feindlich – Unfug, Riesenzahlen, falsche Zählung, Diff im Diff; nie eine Ausnahme", () => {
  for (const roh of ["", "kein patch", "\u0000\u0000", "diff --git", "@@ -1 +1 @@\n-a\n+b", "diff --git a/x b/x\n@@ -a,b +c,d @@\n-a"]) {
    const d = leseDiff(roh);
    assert.ok(Array.isArray(d.dateien), JSON.stringify(roh));
    assert.equal(d.dateien.reduce((n, f) => n + f.abschnitte.length, 0), 0, JSON.stringify(roh));
  }
  // Riesige Zeilennummern: der Abschnitt fällt weg
  const riese = leseDiff(patch("diff --git a/x b/x\n@@ -99999999,1 +1,1 @@\n-a\n+b\n"));
  assert.equal(riese.dateien[0]!.abschnitte.length, 0);
  // Der Kopf verspricht mehr Zeilen, als kommen: der Abschnitt endet beim ersten Unpassenden
  // (ohne Signatur – „-- “ wäre bei falscher Zählung von einer entfernten Zeile „- “ nicht zu unterscheiden)
  const kurz = leseDiff("diff --git a/x b/x\n@@ -1,5 +1,5 @@\n-a\n+b\nhallo\n@@ -9 +9 @@\n-c\n+d\n");
  assert.deepEqual(kurz.dateien[0]!.abschnitte.map((a) => a.zeilen.map((z) => z.art)), [["weg", "neu"], ["weg", "neu"]]);
  // Mehr „+“ als der Kopf zulässt: der Überschuss zählt nicht
  const mehr = leseDiff(patch("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n+c\n+d\n"));
  assert.equal(mehr.plus, 1);
  // Eine hinzugefügte Zeile „diff --git …“ ist Inhalt, keine neue Datei
  const innen = leseDiff(patch("diff --git a/x b/x\n@@ -0,0 +1,2 @@\n+diff --git a/böse b/böse\n+<img src=x onerror=alert(1)>\n"));
  assert.equal(innen.dateien.length, 1);
  assert.deepEqual(innen.dateien[0]!.abschnitte[0]!.zeilen.map((z) => z.text), ["diff --git a/böse b/böse", "<img src=x onerror=alert(1)>"]);
});

test("C.3b1: Grenzen – Dateien, Zeilen und Zeichen; darüber „gekürzt“", () => {
  const viele = leseDiff(patch(Array.from({ length: DIFF_GRENZEN.dateien + 5 }, (_, n) => `diff --git a/f${n} b/f${n}\n@@ -1 +1 @@\n-a\n+b\n`).join("")));
  assert.equal(viele.dateien.length, DIFF_GRENZEN.dateien);
  assert.equal(viele.gekuerzt, true);
  const n = DIFF_GRENZEN.zeilen + 100;
  const lang = leseDiff(patch(`diff --git a/x b/x\n@@ -0,0 +1,${n} @@\n${"+z\n".repeat(n)}`));
  assert.equal(lang.dateien[0]!.abschnitte[0]!.zeilen.length, DIFF_GRENZEN.zeilen);
  assert.equal(lang.gekuerzt, true);
  const breit = leseDiff(patch(`diff --git a/x b/x\n@@ -0,0 +1 @@\n+${"w".repeat(50_000)}\n`, "n".repeat(50_000)));
  assert.equal(breit.dateien[0]!.abschnitte[0]!.zeilen[0]!.text.length, DIFF_GRENZEN.zeichen);
  assert.equal(breit.nachricht.length, DIFF_GRENZEN.zeichen);
  assert.equal(breit.gekuerzt, false);
});

test("C.3b1: verdrahtet – Patch-Seite nur DOM, Vorschau geprüft vor dem Senden, Patch nur im Speicher", () => {
  const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const seite = quelle("../src/shell/tabs/patch-seite.ts");
  const repo = quelle("../src/shell/tabs/repo-seite.ts");
  const repos = quelle("../src/shell/tabs/repos.ts");
  assert.doesNotMatch(seite, /innerHTML/);
  assert.match(seite, /const diff = leseDiff\(p\.text\);/);
  // Zeichen statt nur Farbe
  assert.match(seite, /const ZEICHEN: Record<DiffZeile\["art"\], string> = \{ kontext: " ", neu: "\+", weg: "−", hinweis: "\\\\" \};/);
  // Offener Patch und Vorschau nur im Speicher, nie in der Adresse
  assert.match(repo, /let offenerPatch: string \| null = null;/);
  assert.doesNotMatch(repo, /location\.hash|history\.(push|replace)State/);
  // Vorschau erst nach lesePatchText(), senden nur aus der Vorschau, danach neu laden
  assert.match(repo, /vorschau = \{ schluessel: k\.schluessel, text, \.\.\.lesePatchText\(text\) \};/);
  assert.match(repo, /if \(await h\.patchSenden\(repo, v\.text\)\) \{\n\s+vorschau = null;\n\s+await h\.neuLaden\(\);/);
  assert.match(repos, /await \(await ensurePool\(\)\)\.publish\(await signiere\(bauePatch\(\{ repo: r, text \}, state\.keypair\.pk\)\)\);/);
  assert.doesNotMatch(quelle("../src/shell/index.html"), /nip34-patch-datei/);
});
