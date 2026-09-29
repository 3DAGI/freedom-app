/**
 * Schritt C-17b1: Reiter „Issues“ – die Zeilen ohne DOM (`issueZeilen()`,
 * `mitIssues()`) und die Verdrahtung: laden, anlegen (öffentlich signiert,
 * privat nur in die Gruppe), zeigen nur als Text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_ISSUE, baueIssue, baueIssueStatus, baueKommentar, baueRepoAnkuendigung, generateKeypair, leseRepoAnkuendigung, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { issueFilterVon, issueZeilen, mitIssues, privateRaumKarten, repoKarten } from "../src/repo-ansicht.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const autorin = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const ankuendigung = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 100);
const repo = leseRepoAnkuendigung(ankuendigung);
const issue = (von: typeof autorin, betreff: string, zeit: number, id = "app") =>
  s(baueIssue({ repo: { eigentuemer: eigentuemer.pk, id }, betreff, text: "t" }, von.pk), von, zeit);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("C-17b1: Issue-Zeilen – nur dieses Repo, jedes einmal, neuestes zuerst, Status und wer ihn ändern darf", () => {
  const alt = issue(autorin, "Alt", 200);
  const neu = issue(fremd, "Neu", 300);
  const anderesRepo = issue(autorin, "Woanders", 400, "anderes");
  const kaputt = s({ kind: KIND_ISSUE, pubkey: fremd.pk, created_at: 500, tags: [["a", repo.adresse]], content: "ohne Betreff" }, fremd, 500);
  const zu = s(baueIssueStatus({ issue: { id: alt.id, autor: autorin.pk, repoAdresse: repo.adresse }, status: "erledigt", eigentuemer: eigentuemer.pk }, maintainer.pk), maintainer, 250);
  const fremderStatus = s(baueIssueStatus({ issue: { id: neu.id, autor: fremd.pk, repoAdresse: repo.adresse }, status: "geschlossen", eigentuemer: eigentuemer.pk }, autorin.pk), autorin, 350);
  const k1 = s(baueKommentar({ wurzel: { id: alt.id, autor: autorin.pk, kind: KIND_ISSUE }, text: "zweiter" }, fremd.pk), fremd, 220);
  const k2 = s(baueKommentar({ wurzel: { id: alt.id, autor: autorin.pk, kind: KIND_ISSUE }, text: "erster" }, maintainer.pk), maintainer, 210);

  const zeilen = issueZeilen(repo, [alt, neu, anderesRepo, kaputt, alt], [zu, fremderStatus], [k1, k2], autorin.pk);
  assert.deepEqual(zeilen.map((z) => z.issue.betreff), ["Neu", "Alt"], "nur dieses Repo, doppelt einmal, Unfug nicht, neuestes zuerst");
  assert.deepEqual(zeilen.map((z) => z.status), ["offen", "erledigt"], "der Status einer Fremden zählt nicht");
  assert.deepEqual(zeilen[1].kommentare.map((k) => k.text), ["erster", "zweiter"]);
  assert.deepEqual(zeilen.map((z) => z.darfStatus), [false, true], "die Autorin darf ihr eigenes Issue schließen, nicht fremde");
  assert.deepEqual(issueZeilen(repo, [neu], [], [], maintainer.pk).map((z) => z.darfStatus), [true], "Maintainer dürfen");
  assert.deepEqual(issueZeilen(repo, [neu], [], [], undefined).map((z) => z.darfStatus), [false], "ohne Identität nichts");
  assert.deepEqual(["offen", "erledigt", "geschlossen"].map((x) => issueFilterVon(x as never)), ["offen", "geschlossen", "geschlossen"]);
});

test("C-17b1: mitIssues – öffentliche Issues nie an einem privaten Repo gleicher Adresse, private nur aus ihrer Gruppe", () => {
  const oeffentlich = issue(autorin, "Öffentlich", 200);
  const innen = { ...issue(autorin, "Privat", 210), tags: [["space", "g1"], ...issue(autorin, "Privat", 210).tags], sig: "" };
  const privAnk = { ...ankuendigung, tags: [["space", "g1"], ...ankuendigung.tags], sig: "" };
  const karten = [
    ...repoKarten([ankuendigung], [], [], [], autorin.pk),
    ...privateRaumKarten({ gruppe: "g1", ankuendigungen: [privAnk], bundles: [], patches: [], status: [] }, autorin.pk),
    ...repoKarten([], [s({ kind: 38042, pubkey: fremd.pk, created_at: 1, tags: [["d", "nur-bundle"]], content: "" }, fremd, 1)], [], [], autorin.pk),
  ];
  const leer: NostrEvent[] = [];
  const mit = mitIssues(karten, { issues: [oeffentlich], status: leer, kommentare: leer }, [{ gruppe: "g1", issues: [innen], status: leer, kommentare: leer }], autorin.pk);
  assert.deepEqual(mit.map((k) => (k.issues ?? []).map((z) => z.issue.betreff)), [["Öffentlich"], ["Privat"], []]);
  assert.deepEqual(mit.map((k) => k.offeneIssues), [1, 1, undefined], "eine Karte nur mit Bundle bleibt, wie sie ist");
  const ohneGruppe = mitIssues(karten, { issues: [oeffentlich], status: leer, kommentare: leer }, [], autorin.pk);
  assert.deepEqual(ohneGruppe[1].issues, [], "ohne die Daten der Gruppe nichts – nie die öffentlichen");
});

test("Verdrahtung (C-17b1): laden, Reiter, anlegen – öffentlich signiert, privat nur in die Gruppe, nur als Text", () => {
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /pool\.query\(\{ kinds: \[KIND_ISSUE\], "#a": adressen, limit: 300 \}\)/);
  assert.match(repos, /pool\.query\(\{ kinds: \[KIND_KOMMENTAR\], "#E": wurzeln, limit: 1000 \}\)/);
  assert.match(repos, /karten = mitIssues\(karten, \{ issues, status: issueStatus, kommentare \}, privat, state\.keypair\?\.pk\);/);
  const seite = lies("shell/tabs/repo-seite.ts");
  assert.match(seite, /reiterKnopf\("commits", t\("repo\.commits"\)\),\s*reiterKnopf\("issues", t\("repo\.issuesZahl", \{ n: k\.offeneIssues \?\? 0 \}\)\), reiterKnopf\("patches"/);
  assert.match(seite, /export const vergissReiter = \(\): void => \{\s*vergissIssue\(\);/);
  const reiter = lies("shell/tabs/issues-reiter.ts");
  assert.match(reiter, /if \(k\.privatRaum\) await sendeInRaum\(k\.privatRaum, raumRepoIssue\(k\.privatRaum, angaben\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueIssue\(angaben, state\.keypair\.pk\)\)\);/);
  assert.match(reiter, /text: t\(k\.privatRaum \? "repo\.issueHinweisRaum" : "repo\.issueHinweis"\)/, "der Dialog sagt, wer es lesen kann");
  assert.doesNotMatch(reiter, /innerHTML|insertAdjacentHTML|location|history\./, "nur Text, nichts in die Adresse");
});

test("C-17c: Kommentare an Patches – an der Karte je Patch, nie über die Grenze öffentlich/privat", async () => {
  const { KIND_PATCH, bauePatch } = await import("@freedomstack/protocol");
  const text = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] T\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;
  const patch = s(bauePatch({ repo: { eigentuemer: eigentuemer.pk, id: "app" }, text }, autorin.pk), autorin, 200);
  const kommentar = s(baueKommentar({ wurzel: { id: patch.id, autor: autorin.pk, kind: KIND_PATCH }, text: "Sieht gut aus" }, maintainer.pk), maintainer, 210);
  const [karte] = repoKarten([ankuendigung], [], [patch], [], autorin.pk);
  const leer: NostrEvent[] = [];
  const [mit] = mitIssues([karte], { issues: leer, status: leer, kommentare: [kommentar] }, [], autorin.pk);
  assert.deepEqual(mit.patchKommentare?.[patch.id]?.map((k) => k.text), ["Sieht gut aus"]);
  const privat = { ...karte, privatRaum: "g1" };
  const [ohne] = mitIssues([privat], { issues: leer, status: leer, kommentare: [kommentar] }, [], autorin.pk);
  assert.deepEqual(ohne.patchKommentare?.[patch.id], [], "ein öffentlicher Kommentar nie an einem privaten Patch");
});

test("Verdrahtung (C-17b2, C-17c): kommentieren und Status – öffentlich signiert, privat nur in die Gruppe", () => {
  const disk = lies("shell/tabs/diskussion.ts");
  assert.match(disk, /if \(d\.privatRaum\) await sendeInRaum\(d\.privatRaum, raumRepoKommentar\(d\.privatRaum, angaben\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueKommentar\(angaben, state\.keypair\.pk\)\)\);/);
  assert.match(disk, /t\(d\.privatRaum \? "repo\.kommentarHinweisRaum" : "repo\.kommentarHinweis"\)/, "unter dem Feld steht, wer mitliest");
  assert.match(disk, /if \(state\.keypair\) teile\.push\(kommentarFeld\(d\)\);/, "ohne Identität kein Feld");
  assert.doesNotMatch(disk, /innerHTML|insertAdjacentHTML/);
  const reiter = lies("shell/tabs/issues-reiter.ts");
  assert.match(reiter, /if \(z\.darfStatus && k\.repo\) \{/, "Status nur für Autorin, Eigentümer, Maintainer");
  assert.match(reiter, /if \(k\.privatRaum\) await sendeInRaum\(k\.privatRaum, raumRepoIssueStatus\(k\.privatRaum, angaben\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueIssueStatus\(angaben, state\.keypair\.pk\)\)\);/);
  assert.match(reiter, /wurzel: \{ id: z\.issue\.id, autor: z\.issue\.autor, kind: KIND_ISSUE \}, kommentare: z\.kommentare/);
  const seite = lies("shell/tabs/repo-seite.ts");
  assert.match(seite, /wurzel: \{ id: offen\.patch\.id, autor: offen\.patch\.autor, kind: KIND_PATCH \}, kommentare: k\.patchKommentare\?\.\[offen\.patch\.id\] \?\? \[\]/);
  assert.match(lies("shell/tabs/patch-seite.ts"), /teile\.push\(\.\.\.bloecke, \.\.\.\(p\.unten \?\? \[\]\)\);/, "die Vorschau hat keine Diskussion");
});
