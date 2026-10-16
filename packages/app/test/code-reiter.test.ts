/**
 * Reiter „Code“ und „Commits“ (C.3c1, C.3c2, C-20c, C-20d): verdrahtet mit dem
 * Bundle-Leser aus dem Protokoll (`git-bundle.ts`, seit 11.5a1 dort) – laden auf
 * Knopfdruck, lesen nur im Speicher, zeigen nur Text. Den Leser selbst prüft
 * `protocol/test/git-bundle.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("C.3c1: verdrahtet – Reiter „Code“ lädt erst auf Knopfdruck, liest im Speicher, zeigt nur Text", () => {
  const code = readFileSync(new URL("../src/shell/tabs/code-reiter.ts", import.meta.url), "utf8");
  const seite = readFileSync(new URL("../src/shell/tabs/repo-seite.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /innerHTML/);
  // Seit B-2 über die Quelle des Bundles: aus dem Speichernetz über die Referenz oder vom Gerät
  assert.match(seite, /reiter === "code" \? codeReiter\(quelle, k\.name, \(\) => zeigeRepoSeite\(box, k, h, "code"\)\)/);
  assert.match(seite, /if \(!k\.lokal\) return k\.bundle \? netzQuelle\(k\.bundle\) : undefined;/);
  assert.match(code, /export const netzQuelle = \(ref: NostrEvent\): BundleQuelle => \(\{ id: ref\.id, hole: \(\) => holeBundle\(ref\) \}\);/);
  // Laden nur im Klick-Handler von „Code laden“ (seit C.3c2 geteilt mit „Commits“), dann lesen, Fehler als Kennung → Text
  const klick = code.slice(code.indexOf('laden.addEventListener("click"'), code.indexOf("return [hinweis, laden, fehler];"));
  assert.match(klick, /const bytes = await bundle\.hole\(\);/);
  assert.match(klick, /await leseBundle\(bytes\)/);
  assert.match(klick, /e instanceof BundleFehler \? t\(FEHLER\[e\.art\]\) : fehlerText\(e\)/);
  // README und Dateien nur als Text und nur, wenn sie Text sind (alsText: kein Nullbyte, gültiges UTF-8)
  assert.match(code, /el\("pre", inhalt\.slice\(0, TEXT_MAX\), "code-readme"\)/);
  assert.match(code, /el\("pre", text\.slice\(0, TEXT_MAX\), "code-datei"\)/);
});

test("C.3c2: verdrahtet – Reiter „Commits“, Ort im Code nur im Speicher, Einträge als Knöpfe", () => {
  const code = readFileSync(new URL("../src/shell/tabs/code-reiter.ts", import.meta.url), "utf8");
  const seite = readFileSync(new URL("../src/shell/tabs/repo-seite.ts", import.meta.url), "utf8");
  assert.match(seite, /reiterKnopf\("commits", t\("repo\.commits"\)\)/);
  assert.match(seite, /reiter === "commits" \? commitsReiter\(quelle, angenommen, \(\) => zeigeRepoSeite\(box, k, h, "commits"\)\)/);
  // Ohne Bundle: nur angenommene Patches mit ihren Commits aus dem geltenden Status
  assert.match(seite, /const angenommen = k\.zeilen\.filter\(\(z\) => z\.status === "angenommen"\)\.map\(\(z\) => \(\{ betreff: z\.patch\.betreff, commits: z\.commits \?\? \[\] \}\)\);/);
  assert.match(code, /const commits = commitsAb\(b, kopf, COMMITS_MAX \+ 1\);/);
  assert.match(code, /const ort = new Map<string, string\[\]>\(\);/);
  for (const [name, text] of [["code-reiter.ts", code], ["repo-seite.ts", seite]]) assert.doesNotMatch(text, /location\.hash|history\.(push|replace)State/, name);
  // Ordner und Dateien sind Knöpfe (Tastatur), Submodule nur Text
  assert.match(code, /knopf\(e\.art === "ordner" \? `\$\{e\.name\}\/` : e\.name, "code-eintrag", \(\) => geh\(\[\.\.\.pfad, e\.name\]\)\)/);
});

test("Verdrahtung (C-20c): Code und Commits zeigen den gewählten Stand – Wahl nur im Speicher, nie in der Adresse", () => {
  const code = readFileSync(new URL("../src/shell/tabs/code-reiter.ts", import.meta.url), "utf8");
  assert.match(code, /const refWahl = new Map<string, string>\(\);/);
  assert.match(code, /const kopf = stand\(b, id\)\.commit;/, "Reiter „Code“");
  assert.match(code, /const kopf = stand\(b, bundle\.id\)\.commit;\s*if \(!kopf\)[^\n]*\n\s*const commits = commitsAb\(b, kopf, COMMITS_MAX \+ 1\);/, "Reiter „Commits“");
  assert.match(code, /refWahl\.delete\(alt\);/, "vergessen, wenn das Bundle aus dem Speicher fällt");
  assert.doesNotMatch(code, /location\.hash|history\.(push|replace)State|localStorage/);
});

test("Verdrahtung (C-20d): Verlauf und Suche im Reiter „Code“ – nur im Speicher, Treffer öffnen die Datei", () => {
  const code = readFileSync(new URL("../src/shell/tabs/code-reiter.ts", import.meta.url), "utf8");
  assert.match(code, /const \{ eintraege, abgeschnitten \} = dateiVerlauf\(b, commit, pfad, COMMITS_MAX\);/);
  assert.match(code, /if \(vOffen\) teile\.push\(\.\.\.verlaufListe\(b, kopf, pfad\)\);/, "Verlauf des gewählten Stands");
  assert.match(code, /teile\.push\(\.\.\.suchFeld\(b, id, c!\.baum, kopf, geh, neu\)\);/, "Suche im ganzen Stand, aus jedem Ordner");
  assert.match(code, /s\.ergebnis = sucheImCode\(b, baum, s\.text\);/);
  assert.match(code, /"code-treffer-ort mono-sm", \(\) => geh\(x\.pfad\)\)/);
  assert.match(code, /const verlaufOffen = new Set<string>\(\);/);
  assert.doesNotMatch(code, /innerHTML|location\.hash|history\.(push|replace)State|localStorage/);
});
