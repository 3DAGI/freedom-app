/**
 * Schritt C-20h2: Reiter „Releases“ – die Daten ohne DOM (`mitIssues()` →
 * `releases`) und die Verdrahtung: laden nach Repo-Adresse, veröffentlichen
 * und zurückziehen nur Eigentümer und Maintainer, öffentlich signiert, privat
 * nur in die Gruppe, nur als Text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baueRepoAnkuendigung, baueRepoRelease, generateKeypair, signEvent, type NostrEvent } from "@freedomstack/protocol";
import { mitIssues, repoKarten } from "../src/repo-ansicht.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const ankuendigung = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 100);
const repo = { eigentuemer: eigentuemer.pk, id: "app" };
const leer: NostrEvent[] = [];

test("C-20h2: Releases an der Karte – nur Pfleger, neuestes zuerst, nie über die Grenze öffentlich/privat", () => {
  const eins = s(baueRepoRelease({ repo, version: "v1", titel: "Eins" }, eigentuemer.pk), eigentuemer, 200);
  const zwei = s(baueRepoRelease({ repo, version: "v2", titel: "Zwei", vorab: true }, maintainer.pk), maintainer, 210);
  const fremdes = s(baueRepoRelease({ repo, version: "v9", titel: "Fremd" }, fremd.pk), fremd, 220);
  const [karte] = repoKarten([ankuendigung], [], [], [], eigentuemer.pk);
  const [mit] = mitIssues([karte], { issues: leer, status: leer, kommentare: leer, releases: [eins, zwei, fremdes] }, [], eigentuemer.pk);
  assert.deepEqual(mit.releases?.map((r) => [r.version, r.vorab]), [["v2", true], ["v1", false]], "Fremde veröffentlichen keine Releases");
  const [ohne] = mitIssues([karte], { issues: leer, status: leer, kommentare: leer }, [], eigentuemer.pk);
  assert.deepEqual(ohne.releases, [], "ohne geladene Releases eine leere Liste");
  const [privat] = mitIssues([{ ...karte, privatRaum: "g1" }], { issues: leer, status: leer, kommentare: leer, releases: [eins] }, [], eigentuemer.pk);
  assert.deepEqual(privat.releases, [], "ein öffentliches Release nie an einem privaten Repo");
  const [gruppe] = mitIssues([{ ...karte, privatRaum: "g1" }], { issues: leer, status: leer, kommentare: leer },
    [{ gruppe: "g1", issues: leer, status: leer, kommentare: leer, releases: [eins] }], eigentuemer.pk);
  assert.deepEqual(gruppe.releases?.map((r) => r.version), ["v1"], "privat aus der eigenen Gruppe");
});

test("Verdrahtung (C-20h2): laden, Reiter, veröffentlichen und zurückziehen – öffentlich signiert, privat nur in die Gruppe", () => {
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /pool\.query\(\{ kinds: \[KIND_REPO_RELEASE\], "#a": adressen, limit: 300 \}\)/, "nach Repo-Adresse wie Issues");
  const seite = lies("shell/tabs/repo-seite.ts");
  assert.match(seite, /reiterKnopf\("releases", t\("repo\.releasesZahl", \{ n: k\.releases\?\.length \?\? 0 \}\)\)/);
  assert.match(seite, /reiter === "releases" \? releasesReiter\(k, eigentuemerName, h\.neuLaden\)/);
  const reiter = lies("shell/tabs/releases-reiter.ts");
  assert.match(reiter, /const pflegt = !!\(ich && k\.repo && darfAnnehmen\(k\.repo, ich\)\);/, "nur Eigentümer und Maintainer");
  assert.match(reiter, /if \(pflegt\) teile\.push\(knopf\(t\("repo\.neuesRelease"\)/);
  assert.match(reiter, /if \(k\.privatRaum\) await sendeInRaum\(k\.privatRaum, raumRepoRelease\(k\.privatRaum, angaben\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueRepoRelease\(angaben, state\.keypair\.pk\)\)\);/);
  assert.match(reiter, /if \(k\.privatRaum\) await sendeInRaum\(k\.privatRaum, raumRepoReleaseRueckzug\(k\.privatRaum, angaben\)\);\s*else await \(await ensurePool\(\)\)\.publish\(await signiere\(baueRepoReleaseRueckzug\(angaben, state\.keypair\.pk\)\)\);/);
  assert.match(reiter, /text: t\(k\.privatRaum \? "repo\.releaseHinweisRaum" : "repo\.releaseHinweis"\)/, "der Dialog sagt, wer es lesen kann");
  assert.match(reiter, /bundle: \{ blobId: ref\.blobId, schluessel \}/, "das Bundle von jetzt – nicht nur der ersetzbare Verweis");
  assert.match(reiter, /gefahr: true/, "Zurückziehen fragt nach");
  assert.doesNotMatch(reiter, /innerHTML|insertAdjacentHTML|location|history\.|localStorage/, "nur Text, nichts in die Adresse, nichts gemerkt");
});
