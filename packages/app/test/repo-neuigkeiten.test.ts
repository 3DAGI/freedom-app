/**
 * Schritt C-20f: Neuigkeiten in Repos – wer beteiligt ist, was neu ist (von
 * anderen, nach dem letzten Blick), die gemerkte Liste und ihr Abgleich; dazu
 * die Verdrahtung: gemerkt nur im Tresor (`geheim`), nie in localStorage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_ISSUE, baueIssue, baueKommentar, baueRepoAnkuendigung, bauePatch, generateKeypair, signEvent,
} from "@freedomstack/protocol";
import { mitIssues, repoKarten } from "../src/repo-ansicht.js";
import { GESEHEN_MAX, beteiligt, gesehenAbgleichen, leseGesehen, neuGesamt, neuigkeiten } from "../src/repo-neuigkeiten.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const fremd = generateKeypair();
const zuschauer = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const repoRef = { eigentuemer: eigentuemer.pk, id: "app" };
const patchText = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] T\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;

function karte(ich: string) {
  const ank = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 100);
  const altesIssue = s(baueIssue({ repo: repoRef, betreff: "alt", text: "" }, fremd.pk), fremd, 200);
  const neuesIssue = s(baueIssue({ repo: repoRef, betreff: "neu", text: "" }, fremd.pk), fremd, 400);
  const eigenesIssue = s(baueIssue({ repo: repoRef, betreff: "meins", text: "" }, maintainer.pk), maintainer, 450);
  const patch = s(bauePatch({ repo: repoRef, text: patchText }, fremd.pk), fremd, 410);
  const k1 = s(baueKommentar({ wurzel: { id: altesIssue.id, autor: fremd.pk, kind: KIND_ISSUE }, text: "später" }, fremd.pk), fremd, 420);
  const k2 = s(baueKommentar({ wurzel: { id: altesIssue.id, autor: fremd.pk, kind: KIND_ISSUE }, text: "vorher" }, fremd.pk), fremd, 250);
  const [k] = repoKarten([ank], [], [patch], [], ich);
  return mitIssues([k!], { issues: [altesIssue, neuesIssue, eigenesIssue], status: [], kommentare: [k1, k2] }, [], ich)[0]!;
}

test("C-20f: beteiligt – Eigentümer, Maintainer, Autor eines Beitrags; Zuschauer und ohne Identität nicht", () => {
  assert.equal(beteiligt(karte(eigentuemer.pk), eigentuemer.pk), true);
  assert.equal(beteiligt(karte(maintainer.pk), maintainer.pk), true);
  assert.equal(beteiligt(karte(fremd.pk), fremd.pk), true, "hat Issues, Patch und Kommentare geschrieben");
  assert.equal(beteiligt(karte(zuschauer.pk), zuschauer.pk), false);
  assert.equal(beteiligt(karte(zuschauer.pk), undefined), false);
});

test("C-20f: neuigkeiten – nur nach dem letzten Blick und nur von anderen", () => {
  const k = karte(maintainer.pk);
  assert.deepEqual(neuigkeiten(k, 300, maintainer.pk), { issues: 1, patches: 1, kommentare: 1 }, "das eigene Issue zählt nicht");
  assert.equal(neuGesamt(neuigkeiten(k, 300, maintainer.pk)), 3);
  assert.deepEqual(neuigkeiten(k, 1000, maintainer.pk), { issues: 0, patches: 0, kommentare: 0 });
  assert.deepEqual(neuigkeiten(k, 0, fremd.pk), { issues: 1, patches: 0, kommentare: 0 }, "nur das Issue des Maintainers ist für den Fremden neu");
});

test("C-20f: gemerkte Liste – Unfug fällt heraus; Abgleich beginnt bei jetzt, verliert nichts, bleibt begrenzt", () => {
  assert.deepEqual(leseGesehen('{"a:b":5,"x":-1,"y":"7","z":1.5}'), { "a:b": 5 });
  for (const roh of [null, "", "kaputt", "[1,2]", "null", "7"]) assert.deepEqual(leseGesehen(roh), {}, String(roh));
  assert.deepEqual(leseGesehen(JSON.stringify({ ["k".repeat(301)]: 1 })), {});
  const k = karte(maintainer.pk);
  const erst = gesehenAbgleichen({}, [k], maintainer.pk, 500);
  assert.deepEqual(erst, { gesehen: { [k.schluessel]: 500 }, geaendert: true }, "neu beteiligt: ab jetzt, nicht alles neu");
  assert.deepEqual(gesehenAbgleichen({ [k.schluessel]: 300 }, [k], maintainer.pk, 500), { gesehen: { [k.schluessel]: 300 }, geaendert: false }, "Gemerktes bleibt");
  assert.deepEqual(gesehenAbgleichen({}, [k], zuschauer.pk, 500), { gesehen: {}, geaendert: false }, "unbeteiligt: nichts gemerkt");
  assert.deepEqual(gesehenAbgleichen({ "weg:repo": 9 }, [], maintainer.pk, 500).gesehen, { "weg:repo": 9 }, "nicht geladen heißt nicht vergessen");
  const voll = Object.fromEntries(Array.from({ length: GESEHEN_MAX + 5 }, (_, i) => [`r:${i}`, i]));
  const begrenzt = gesehenAbgleichen(voll, [], maintainer.pk, 500);
  assert.equal(Object.keys(begrenzt.gesehen).length, GESEHEN_MAX);
  assert.equal(begrenzt.gesehen["r:0"], undefined, "die ältesten fallen zuerst");
  assert.equal(begrenzt.geaendert, true);
});

test("Verdrahtung (C-20f): gemerkt nur im Tresor, gesehen beim Öffnen, Filter „Neu“", () => {
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /gesehen \?\?= leseGesehen\(geheim\.getItem\(LS_REPOS_GESEHEN\)\);/);
  assert.match(repos, /geheim\.setItem\(LS_REPOS_GESEHEN, JSON\.stringify\(g\)\);/);
  assert.doesNotMatch(repos, /localStorage/, "nie im Klartext");
  assert.match(lies("shell/tresor.ts"), /const GEHEIM_FEST = \[[^\]]*"freedom\.repos\.gesehen"/, "im Tresor wie die anderen Geheimnisse");
  assert.equal((repos.match(/gesehenJetzt\((k\.)?schluessel\);/g) ?? []).length, 2, "Karte und oeffneRepo() merken den Blick");
  assert.match(repos, /const abgleich = gesehenAbgleichen\(gesehenVon\(\), karten, state\.keypair\?\.pk, jetztSek\(\)\);/);
  assert.match(repos, /nurNeu = b\.dataset\.filter === "neu";/);
  assert.match(lies("shell/index.html"), /data-filter="neu" aria-pressed="false" data-i18n="repo\.neu"/);
});
