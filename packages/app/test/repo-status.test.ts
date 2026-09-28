/**
 * Schritt C.3b2: Status eines Patches mit Begründung – wer was tun darf
 * (`patchAktionen()`, nur was `patchStatus()` auch zählt), die Begründung
 * und die Commits des geltenden Status; nie aus Events, die nicht zählen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  baueRepoAnkuendigung, bauePatch, baueStatus, generateKeypair, leseRepoAnkuendigung, lesePatch, patchStatus, signEvent, type NostrEvent, type PatchStatus,
} from "@freedomstack/protocol";
import { AKTION_STATUS, type PatchAktion, patchAktionen, patchZeilen } from "../src/repo-ansicht.js";

const eigen = generateKeypair(), helfer = generateKeypair(), autor = generateKeypair(), fremd = generateKeypair();
const repo = leseRepoAnkuendigung(signEvent(baueRepoAnkuendigung({ id: "demo", name: "Demo", klon: [], maintainer: [helfer.pk] }, eigen.pk), eigen.sk));
const text = `From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] X\n\n---\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n`;
const patchEv = signEvent({ ...bauePatch({ repo, text }, autor.pk), created_at: 10 }, autor.sk);
const patch = lesePatch(patchEv);
const status = (kp: typeof eigen, s: PatchStatus, zeit: number, extra: { notiz?: string; commits?: string[] } = {}): NostrEvent =>
  signEvent({ ...baueStatus({ patch, status: s, eigentuemer: eigen.pk, ...extra }, kp.pk), created_at: zeit }, kp.sk);

test("C.3b2: wer was darf – Maintainer, Autor, Fremde; angenommen ist endgültig", () => {
  const darf = (s: PatchStatus, ich: string | undefined, von?: string) => patchAktionen({ status: s, ...(von ? { von } : {}) }, repo, autor.pk, ich);
  for (const m of [eigen.pk, helfer.pk]) {
    assert.deepEqual(darf("offen", m), ["annehmen", "entwurf", "schliessen"]);
    assert.deepEqual(darf("entwurf", m), ["annehmen", "wiederOeffnen", "schliessen"]);
    assert.deepEqual(darf("geschlossen", m, autor.pk), ["wiederOeffnen"]);
    assert.deepEqual(darf("angenommen", m), []);
  }
  assert.deepEqual(darf("offen", autor.pk), ["entwurf", "zurueckziehen"]);
  assert.deepEqual(darf("entwurf", autor.pk), ["wiederOeffnen", "zurueckziehen"]);
  assert.deepEqual(darf("geschlossen", autor.pk, autor.pk), ["wiederOeffnen"], "selbst zurückgezogen");
  assert.deepEqual(darf("geschlossen", autor.pk, helfer.pk), [], "vom Maintainer geschlossen – die App achtet das");
  assert.deepEqual(darf("angenommen", autor.pk), []);
  for (const s of ["offen", "entwurf", "geschlossen", "angenommen"] as const) {
    assert.deepEqual(darf(s, fremd.pk, fremd.pk), [], `Fremde: ${s}`);
    assert.deepEqual(darf(s, undefined), [], `ohne Schlüssel: ${s}`);
  }
});

test("C.3b2: jede angebotene Aktion setzt einen Status, den patchStatus() von diesem Absender auch zählt", () => {
  const ziele: Record<PatchAktion, PatchStatus> = { annehmen: "angenommen", entwurf: "entwurf", wiederOeffnen: "offen", schliessen: "geschlossen", zurueckziehen: "geschlossen" };
  assert.deepEqual(AKTION_STATUS, ziele);
  for (const [kp, von] of [[eigen, eigen.pk], [helfer, helfer.pk], [autor, autor.pk]] as const) {
    for (const vorher of ["offen", "entwurf", "geschlossen"] as const) {
      const vorherEv = status(von === autor.pk ? autor : helfer, vorher, 20);
      const st = patchStatus(patch, repo, [vorherEv]);
      for (const a of patchAktionen(st, repo, autor.pk, von)) {
        const nachher = patchStatus(patch, repo, [vorherEv, status(kp, AKTION_STATUS[a], 30)]);
        assert.equal(nachher.status, AKTION_STATUS[a], `${a} von ${von === autor.pk ? "Autor" : "Maintainer"} nach ${vorher}`);
      }
    }
  }
});

test("C.3b2: Begründung und Commits nur aus dem geltenden Status – nicht aus Events, die nicht zählen", () => {
  const angenommen = status(helfer, "angenommen", 20, { notiz: "  Danke!\nSauber.  ", commits: ["c".repeat(40)] });
  const fremdZu = signEvent({ ...baueStatus({ patch, status: "geschlossen", eigentuemer: eigen.pk, notiz: "<b>weg damit</b>" }, fremd.pk), created_at: 30 }, fremd.sk);
  const [z] = patchZeilen(repo, [patchEv], [angenommen, fremdZu], eigen.pk);
  assert.equal(z!.status, "angenommen");
  assert.equal(z!.statusVon, helfer.pk);
  assert.equal(z!.statusZeit, 20);
  assert.equal(z!.notiz, "Danke!\nSauber.");
  assert.deepEqual(z!.commits, ["c".repeat(40)]);
  assert.deepEqual(z!.aktionen, []);
  // Ohne Status: offen, keine Angaben; Riesen-Begründung wird gekürzt
  const [ohne] = patchZeilen(repo, [patchEv], [], autor.pk);
  assert.deepEqual([ohne!.status, ohne!.statusVon, ohne!.notiz, ohne!.commits], ["offen", undefined, undefined, undefined]);
  const riese = status(autor, "entwurf", 40, { notiz: "x".repeat(5000) });
  assert.equal(patchZeilen(repo, [patchEv], [riese], autor.pk)[0]!.notiz!.length, 1000);
});

test("C.3b2: verdrahtet – ein Dialog je Aktion mit Begründung, Angaben nur als Text", () => {
  const seite = readFileSync(new URL("../src/shell/tabs/repo-seite.ts", import.meta.url), "utf8");
  const setze = seite.slice(seite.indexOf("async function setzeStatus("), seite.indexOf("function statusAngaben("));
  assert.match(setze, /\{ art: "textarea", name: "notiz", label: t\("repo\.begruendung"\) \}/);
  assert.match(setze, /\.\.\.\(notiz \? \{ notiz \} : \{\}\)/);
  assert.doesNotMatch(setze, /bestaetige\(/, "keine zweite Rückfrage");
  const angaben = seite.slice(seite.indexOf("function statusAngaben("), seite.indexOf("/** Mitwirkende (38056)"));
  assert.match(angaben, /el\("p", z\.notiz, "patch-notiz"\)/);
  assert.doesNotMatch(angaben, /innerHTML/);
  assert.match(seite, /status: statusAngaben\(offen\),/);
});
