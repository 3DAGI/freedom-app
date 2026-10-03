/**
 * Schritt C-20g2: Reviews an Patches in der App – die Daten ohne DOM
 * (`mitIssues()` → `patchReviews`, Neuigkeiten) und die Verdrahtung:
 * öffentlich signiert, privat nur in die Gruppe, nur als Text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_PATCH, baueBewertung, baueKommentar, bauePatch, baueRepoAnkuendigung, baueZeilenKommentar, generateKeypair, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { mitIssues, repoKarten } from "../src/repo-ansicht.js";
import { neuigkeiten } from "../src/repo-neuigkeiten.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const autorin = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const ankuendigung = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 100);
const text = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] T\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;
const patch = s(bauePatch({ repo: { eigentuemer: eigentuemer.pk, id: "app" }, text }, autorin.pk), autorin, 200);
const bezug = { id: patch.id, autor: autorin.pk, kind: KIND_PATCH };
const leer: NostrEvent[] = [];

test("C-20g2: Reviews an der Karte je Patch – getrennt von der Diskussion, nie über die Grenze öffentlich/privat", () => {
  const kommentar = s(baueKommentar({ wurzel: bezug, text: "Allgemein" }, fremd.pk), fremd, 210);
  const anZeile = s(baueZeilenKommentar({ patch: bezug, zeile: { pfad: "a", seite: "neu", zeile: 1 }, text: "Warum y?" }, maintainer.pk), maintainer, 220);
  const gut = s(baueBewertung({ patch: bezug, bewertung: "genehmigt" }, maintainer.pk), maintainer, 230);
  const aendern = s(baueBewertung({ patch: bezug, bewertung: "aenderungen", text: "Bitte Test" }, fremd.pk), fremd, 240);
  const selbst = s(baueBewertung({ patch: bezug, bewertung: "genehmigt" }, autorin.pk), autorin, 250);
  const [karte] = repoKarten([ankuendigung], [], [patch], [], autorin.pk);
  const [mit] = mitIssues([karte], { issues: leer, status: leer, kommentare: [kommentar, anZeile, gut, aendern, selbst] }, [], autorin.pk);
  assert.deepEqual(mit.patchKommentare?.[patch.id]?.map((k) => k.text), ["Allgemein"], "Review-Teile stehen nicht in der Diskussion");
  const r = mit.patchReviews?.[patch.id];
  assert.deepEqual(r?.zeilen.map((k) => [k.text, k.zeile.pfad, k.zeile.seite, k.zeile.zeile]), [["Warum y?", "a", "neu", 1]]);
  assert.deepEqual(r?.bewertungen.map((b) => [b.autor, b.bewertung, b.maintainer, b.text]),
    [[maintainer.pk, "genehmigt", true, ""], [fremd.pk, "aenderungen", false, "Bitte Test"]], "die eigene Bewertung der Autorin zählt nicht");
  const [privat] = mitIssues([{ ...karte, privatRaum: "g1" }], { issues: leer, status: leer, kommentare: [anZeile, gut] }, [], autorin.pk);
  assert.deepEqual(privat.patchReviews?.[patch.id], { zeilen: [], bewertungen: [] }, "ein öffentliches Review nie an einem privaten Patch");
  const [gruppe] = mitIssues([{ ...karte, privatRaum: "g1" }], { issues: leer, status: leer, kommentare: [] },
    [{ gruppe: "g1", issues: leer, status: leer, kommentare: [anZeile, gut] }], autorin.pk);
  assert.equal(gruppe.patchReviews?.[patch.id]?.zeilen.length, 1, "privat aus der eigenen Gruppe");
  assert.equal(gruppe.patchReviews?.[patch.id]?.bewertungen.length, 1);
});

test("C-20g2: Neuigkeiten zählen Reviews anderer mit, eigene nie", () => {
  const anZeile = s(baueZeilenKommentar({ patch: bezug, zeile: { pfad: "a", seite: "alt", zeile: 1 }, text: "x weg?" }, maintainer.pk), maintainer, 300);
  const gut = s(baueBewertung({ patch: bezug, bewertung: "genehmigt" }, fremd.pk), fremd, 310);
  const [karte] = repoKarten([ankuendigung], [], [patch], [], autorin.pk);
  const [mit] = mitIssues([karte], { issues: leer, status: leer, kommentare: [anZeile, gut] }, [], autorin.pk);
  assert.equal(neuigkeiten(mit, 250, autorin.pk).kommentare, 2);
  assert.equal(neuigkeiten(mit, 305, autorin.pk).kommentare, 1);
  assert.equal(neuigkeiten(mit, 250, fremd.pk).kommentare, 1, "die eigene Bewertung ist nie neu");
});

test("Verdrahtung (C-20g2): Review auf der Patch-Seite – öffentlich signiert, privat nur in die Gruppe, nur als Text", () => {
  const ui = lies("shell/tabs/review-ui.ts");
  assert.match(ui, /if \(r\.privatRaum\) await sendeInRaum\(r\.privatRaum, raumRepoZeilenKommentar\(r\.privatRaum, k\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueZeilenKommentar\(k, state\.keypair!\.pk\)\)\);/);
  assert.match(ui, /if \(r\.privatRaum\) await sendeInRaum\(r\.privatRaum, raumRepoBewertung\(r\.privatRaum, b\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueBewertung\(b, state\.keypair!\.pk\)\)\);/);
  assert.match(ui, /t\(r\.privatRaum \? "repo\.kommentarHinweisRaum" : "repo\.kommentarHinweis"\)/, "der Dialog sagt, wer mitliest");
  assert.match(ui, /if \(ich && ich !== r\.patch\.autor\) \{/, "die Autorin bewertet den eigenen Patch nicht");
  assert.match(ui, /\.\.\.\(ich \? \{ kommentieren: /, "ohne Identität keine Knöpfe an den Zeilen");
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|location|history\.|publish\(\w+\)/, "nur Text, nichts in die Adresse, nie unsigniert");
  const seite = lies("shell/tabs/repo-seite.ts");
  assert.match(seite, /review: reviewAnsicht\(\{\s*patch: \{ id: offen\.patch\.id, autor: offen\.patch\.autor, kind: KIND_PATCH \}, review: k\.patchReviews\?\.\[offen\.patch\.id\]/);
  assert.match(seite, /\.\.\.\(k\.privatRaum \? \{ privatRaum: k\.privatRaum \} : \{\}\),\s*\}\),\s*\/\/ Diskussion unter dem Patch/, "privat geht das Review nur in die Gruppe");
  const patchSeite = lies("shell/tabs/patch-seite.ts");
  assert.match(patchSeite, /an\.setAttribute\("aria-pressed", "false"\);/, "Knöpfe an den Zeilen erst auf Wunsch");
  assert.match(patchSeite, /b\.setAttribute\("aria-label", t\(bezug\.seite === "alt" \? "review\.ortAlt" : "review\.ort"/, "der Knopf „+“ hat einen Namen für Vorleser");
});
