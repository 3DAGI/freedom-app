/**
 * Schritt C.3a: Eine Liste statt zwei – Ankündigung (30617) und Bundle-Verweis
 * (38042) desselben Eigentümers mit derselben Kennung ergeben eine Karte; die
 * Repo-Seite mit Klonen, Bundle, Patches und Dialogen statt prompt().
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  baueRepoAnkuendigung, bauePatch, buildGitRepoRef, generateKeypair, leseRepoAnkuendigung, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { filtereKarten, repoKarten } from "../src/repo-ansicht.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const eigen = generateKeypair(), fremd = generateKeypair(), helfer = generateKeypair();
const ank = (id: string, zeit: number, kp = eigen, beschreibung?: string, maintainer = [helfer.pk]): NostrEvent =>
  signEvent({ ...baueRepoAnkuendigung({ id, name: id, klon: ["https://example.org/x.git"], maintainer, ...(beschreibung ? { beschreibung } : {}) }, kp.pk), created_at: zeit }, kp.sk);
const bundle = (name: string, zeit: number, kp = eigen): NostrEvent =>
  signEvent({ ...buildGitRepoRef({ name, blobId: "b".repeat(64), headSha: "local", branch: "main", message: "m", version: zeit }, kp.pk), created_at: zeit }, kp.sk);
const patchText = `From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Fix\n\n---\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n`;

test("C.3a: Ankündigung und Bundle desselben Eigentümers mit derselben Kennung sind eine Karte – fremde Bundles nicht", () => {
  const k = repoKarten([ank("demo", 10)], [bundle("demo", 20), bundle("demo", 30), bundle("demo", 40, fremd), bundle("nur-bundle", 5)], [], [], undefined);
  const demo = k.find((x) => x.schluessel === `${eigen.pk}:demo`)!;
  assert.ok(demo.repo, "mit Ankündigung");
  assert.equal(demo.bundle?.created_at, 30, "das neueste eigene Bundle");
  assert.equal(demo.zuletzt, 30);
  const fremdesBundle = k.find((x) => x.schluessel === `${fremd.pk}:demo`)!;
  assert.equal(fremdesBundle.repo, undefined, "ein Bundle mit gleichem Namen von jemand anderem ist ein eigenes Repo");
  assert.equal(k.find((x) => x.id === "nur-bundle")?.repo, undefined, "Repos nur mit Bundle gibt es auch");
  assert.deepEqual(k.map((x) => x.zuletzt), [40, 30, 5], "zuletzt aktiv zuerst");
});

test("C.3a: offene Patches gezählt; Suche nur lokal über Name, Kennung, Beschreibung; „Meine“ = Eigentümer oder Maintainer", () => {
  const a = ank("werkstatt", 10, eigen, "Werkzeug für Räume");
  const repo = leseRepoAnkuendigung(a);
  const autor = generateKeypair();
  const p = signEvent({ ...bauePatch({ repo, text: patchText }, autor.pk), created_at: 50 }, autor.sk);
  const k = repoKarten([a, ank("anderes", 5, fremd, undefined, [])], [], [p], [], undefined);
  const w = k.find((x) => x.id === "werkstatt")!;
  assert.equal(w.offen, 1);
  assert.equal(w.zuletzt, 50, "ein Patch zählt als Aktivität");
  assert.deepEqual(filtereKarten(k, "RÄUME", false, undefined).map((x) => x.id), ["werkstatt"], "ohne Groß/klein, auch in der Beschreibung");
  assert.deepEqual(filtereKarten(k, "", true, helfer.pk).map((x) => x.id), ["werkstatt"], "Maintainer zählt als „Meine“");
  assert.deepEqual(filtereKarten(k, "", true, fremd.pk).map((x) => x.id), ["anderes"]);
  assert.deepEqual(filtereKarten(k, "", true, undefined), [], "ohne Schlüssel keine eigenen");
});

test("C.3a: Bundle-Verweise mit fehlender oder überlanger Kennung fallen heraus", () => {
  const ohne = signEvent({ pubkey: eigen.pk, created_at: 1, kind: 38042, tags: [["blob", "x"]], content: "" }, eigen.sk);
  const lang = bundle("x".repeat(101), 2);
  assert.deepEqual(repoKarten([], [ohne, lang], [], [], undefined), []);
});

test("C.3a: Seite verdrahtet – nur DOM, Adresse ohne Kennung, Dialoge statt prompt()/confirm()", () => {
  const liste = quelle("../src/shell/tabs/repos.ts");
  const seite = quelle("../src/shell/tabs/repo-seite.ts");
  const html = quelle("../src/shell/index.html");
  const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [datei, s] of [["repos.ts", liste], ["repo-seite.ts", seite]] as const) {
    assert.doesNotMatch(ohneKommentare(s), /innerHTML|\b(prompt|confirm|alert)\(/, datei);
    assert.doesNotMatch(s, /location\.hash|history\.(push|replace)State/, `${datei}: offenes Repo nur im Speicher`);
  }
  assert.match(liste, /karten = repoKarten\(ankuendigungen, bundles, patches, status, state\.keypair\?\.pk\);/);
  // Annehmen mit optionalem Commit (SHA-1 geprüft); seit C.3b2 jede Aktion ein Dialog mit Begründung, Schließen/Zurückziehen rot
  assert.match(seite, /pruefe: \(w\) => \{ const c = String\(w\.commit \?\? ""\)\.trim\(\)\.toLowerCase\(\); return !c \|\| SHA1\.test\(c\) \? null : t\("repo\.keinSha1"\); \},/);
  assert.match(seite, /gefahr: aktion === "schliessen" \|\| aktion === "zurueckziehen",/);
  assert.match(seite, /const ev = baueStatus\(\{ patch, status: AKTION_STATUS\[aktion\], eigentuemer: k\.repo\.eigentuemer,/);
  // Bundle laden: verschlüsselt geladen, mit dem Schlüssel aus der Referenz entschlüsselt
  assert.match(seite, /const bytes = ref\.schluessel \? await oeffneAnhang\(res\.bytes, ref\.schluessel\) : res\.bytes;/);
  // Eine Liste statt zwei (B10): die alten Listen sind weg
  for (const alt of ['id="git-repo-list"', 'id="nip34-liste"', 'id="nip34-id"', 'id="nip34-klon"']) assert.ok(!html.includes(alt), alt);
  assert.doesNotMatch(quelle("../src/shell/tabs/agent-netz.ts"), /export async function loadGitRepos/);
});
