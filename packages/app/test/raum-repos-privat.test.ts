/**
 * Schritt 11.4b2: Repos privater Räume in der App – eigene Karten (nie mit
 * einem öffentlichen Repo gleicher Kennung vermischt), und jede Aktion an
 * ihnen geht nur in die MLS-Gruppe: Ankündigen, Einstellungen, Patch, Status,
 * neue Version. Ohne Gruppe bleibt es beim öffentlichen Weg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baueRepoAnkuendigung, generateKeypair, signEvent } from "@freedomstack/protocol";
import { privateRaumKarten, repoKarten } from "../src/repo-ansicht.js";

test("11.4b2: Karten privater Räume – eigener Schlüssel je Raum, Aktionen markiert", () => {
  const k = generateKeypair();
  const oeffentlich = signEvent(baueRepoAnkuendigung({ id: "app", name: "App", klon: [] }, k.pk), k.sk);
  const innen = { ...oeffentlich, tags: [["space", "gruppe1"], ...oeffentlich.tags], sig: "" };
  const privat = privateRaumKarten({ gruppe: "gruppe1", ankuendigungen: [innen], bundles: [], patches: [], status: [] }, k.pk);
  const offen = repoKarten([oeffentlich], [], [], [], k.pk);
  assert.equal(privat[0]?.privatRaum, "gruppe1");
  assert.equal(offen[0]?.privatRaum, undefined);
  assert.notEqual(privat[0]?.schluessel, offen[0]?.schluessel, "gleiche Kennung, trotzdem zwei Karten");
  assert.equal(privat[0]?.schluessel, `mls:gruppe1:${k.pk}:app`);
});

test("Verdrahtung (11.4b2): jede Aktion an einem privaten Repo nur über sendeInRaum – nie publish", () => {
  const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /privat = await privateRaumRepos\(\)\.catch\(\(\) => \[\]\);/);
  assert.match(repos, /\.\.\.privat\.flatMap\(\(p\) => privateRaumKarten\(p, state\.keypair\?\.pk\)\)/);
  assert.match(repos, /if \(gruppe\) await sendeInRaum\(gruppe, raumRepoBundle\(gruppe, angaben\)\);\s*else await pool\.publish/);
  assert.match(repos, /if \(gruppe\) await sendeInRaum\(gruppe, raumRepoPatch\(gruppe, \{ repo: r, text \}\)\);\s*else await/);
  assert.match(repos, /if \(gruppe\) await sendeInRaum\(gruppe, raumRepoAnkuendigung\(gruppe, angaben\)\);\s*else await/);
  assert.match(repos, /const raeume = privat\.filter\(\(p\) => p\.darfPflegen\);/, "anlegen nur, wo ich pflegen darf");
  const seite = lies("shell/tabs/repo-seite.ts");
  assert.match(seite, /if \(k\.privatRaum\) await sendeInRaum\(k\.privatRaum, raumRepoStatus\(k\.privatRaum, angaben\)\);\s*else await/);
  assert.match(seite, /if \(k\.privatRaum\) await sendeInRaum\(k\.privatRaum, raumRepoAnkuendigung\(k\.privatRaum, angaben\)\);\s*else await/);
  assert.match(seite, /void h\.hochladen\(f, k\.id, k\.privatRaum\)/);
  assert.match(seite, /vorschauSeite\(repo, h, neu, k\.privatRaum\)/);
  assert.match(seite, /await h\.patchSenden\(repo, v\.text, gruppe\)/);
  assert.match(seite, /if \(!k\.privatRaum\) einstellungRaum\(form, r, h\);/, "privat nie mit Verweis auf einen öffentlichen Raum");
  const raum = lies("shell/raum-repos.ts");
  assert.match(raum, /if \(!\(await mlsSendeEvent\(gruppe, s\)\)\) throw new Error\(t\("repo\.nichtInRaum"\)\);/, "scheitert laut – kein Ausweichen aufs Relay");
  assert.match(raum, /if \(gruppen\.length === 0 \|\| mlsGesperrt\(\)\) return \[\];/, "ohne private Räume lädt die Engine nicht");
});
