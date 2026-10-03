/**
 * Schritt C-20i2: Labels ändern und Zuständige in der App – die Daten ohne DOM
 * (`mitIssues()`: Stand ersetzt die t-Tags, `patchLabels`) und die
 * Verdrahtung: laden nach Ziel, ändern nur Eigentümer und Maintainer,
 * öffentlich signiert, privat nur in die Gruppe, nur als Text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_ISSUE, KIND_PATCH, baueIssue, baueLabelStand, bauePatch, baueRepoAnkuendigung, generateKeypair, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { filtereIssues, issueLabels, mitIssues, repoKarten } from "../src/repo-ansicht.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const autorin = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const ankuendigung = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 100);
const repo = { eigentuemer: eigentuemer.pk, id: "app" };
const leer: NostrEvent[] = [];

test("C-20i2: Stand ersetzt die Labels des Issues, Zuständige kommen dazu – Fremde zählen nicht, nie über die Grenze", () => {
  const issue = s(baueIssue({ repo, betreff: "Hammer", text: "t", labels: ["bug"] }, autorin.pk), autorin, 200);
  const ohneStand = s(baueIssue({ repo, betreff: "Säge", text: "t", labels: ["wartung"] }, autorin.pk), autorin, 205);
  const text = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] T\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;
  const patch = s(bauePatch({ repo: { ...repo }, text }, autorin.pk), autorin, 210);
  const labels = [
    s(baueLabelStand({ ziel: { id: issue.id, kind: KIND_ISSUE }, art: "labels", werte: ["ui", "dringend"] }, maintainer.pk), maintainer, 220),
    s(baueLabelStand({ ziel: { id: issue.id, kind: KIND_ISSUE }, art: "zustaendig", werte: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 221),
    s(baueLabelStand({ ziel: { id: issue.id, kind: KIND_ISSUE }, art: "labels", werte: ["spam"] }, fremd.pk), fremd, 300),
    s(baueLabelStand({ ziel: { id: patch.id, kind: KIND_PATCH }, art: "labels", werte: ["review"] }, eigentuemer.pk), eigentuemer, 222),
  ];
  const [karte] = repoKarten([ankuendigung], [], [patch], [], autorin.pk);
  const [mit] = mitIssues([karte], { issues: [issue, ohneStand], status: leer, kommentare: leer, labels }, [], autorin.pk);
  const z = mit.issues!.find((x) => x.issue.id === issue.id)!;
  assert.deepEqual([z.issue.labels, z.zustaendige], [["ui", "dringend"], [maintainer.pk]]);
  assert.deepEqual(mit.issues!.find((x) => x.issue.id === ohneStand.id)!.issue.labels, ["wartung"], "ohne Stand gelten die t-Tags");
  assert.deepEqual(issueLabels(mit.issues!).map((l) => l.label).sort(), ["dringend", "ui", "wartung"], "der Label-Filter (C-20e) folgt dem Stand");
  assert.deepEqual(filtereIssues(mit.issues!, "offen", "ui").map((x) => x.issue.betreff), ["Hammer"]);
  assert.deepEqual(mit.patchLabels?.[patch.id], { labels: ["review"], zustaendige: [] });
  const [privat] = mitIssues([{ ...karte, privatRaum: "g1" }], { issues: leer, status: leer, kommentare: leer, labels }, [], autorin.pk);
  assert.deepEqual(privat.patchLabels?.[patch.id], { labels: [], zustaendige: [] }, "ein öffentliches Label nie an einem privaten Patch");
});

test("Verdrahtung (C-20i2): laden nach Ziel, Leiste auf Issue- und Patch-Seite, ändern nur Pfleger – öffentlich signiert, privat nur in die Gruppe", () => {
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /pool\.query\(\{ kinds: \[KIND_LABEL\], "#e": wurzeln, limit: 1000 \}\)/);
  assert.match(repos, /releases: await releasesLaden, labels \}, privat, state\.keypair\?\.pk\);/);
  const ui = lies("shell/tabs/labels-ui.ts");
  assert.match(ui, /if \(a\.privatRaum\) await sendeInRaum\(a\.privatRaum, raumRepoLabels\(a\.privatRaum, angaben\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueLabelStand\(angaben, state\.keypair\.pk\)\)\);/);
  assert.match(ui, /if \(a\.darf && state\.keypair\) \{/, "ohne Recht keine Knöpfe");
  assert.match(ui, /hinweis = \(a: LabelAngaben\) => t\(a\.privatRaum \? "repo\.labelHinweisRaum" : "repo\.labelHinweis"\)/);
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|location|history\.|localStorage/);
  for (const datei of ["shell/tabs/issues-reiter.ts", "shell/tabs/repo-seite.ts"]) {
    assert.match(lies(datei), /darf: !!state\.keypair && darfAnnehmen\(repo, state\.keypair\.pk\)/, `${datei}: nur Eigentümer und Maintainer`);
  }
  assert.match(lies("shell/tabs/patch-seite.ts"), /if \(p\.labels\) teile\.push\(p\.labels\);/);
});
