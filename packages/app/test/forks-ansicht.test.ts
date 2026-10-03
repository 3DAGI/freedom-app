/**
 * Schritt C-20j3: Forks in der App – die Daten ohne DOM (`mitForks()`) und die
 * Verdrahtung: Forks per `#a` mitladen, forken nie das eigene Repo und nie
 * über ein eigenes gleicher Kennung, das Bundle nur als Verweis auf denselben
 * Blob.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baueRepoAnkuendigung, generateKeypair, leseRepoAnkuendigung, signEvent } from "@freedomstack/protocol";
import { mitForks, repoKarten } from "../src/repo-ansicht.js";

const eigentuemer = generateKeypair();
const forker = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("C-20j3: Forks an der Karte – Zahl beim Original, Weg zurück beim Fork, private und lokale zählen nicht", () => {
  const original = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [] }, eigentuemer.pk), eigentuemer, 100);
  const adresse = leseRepoAnkuendigung(original).adresse;
  const fork = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], forkVon: adresse }, forker.pk), forker, 200);
  const karten = repoKarten([original, fork], [], [], [], forker.pk);
  const mit = mitForks(karten);
  const o = mit.find((k) => k.eigentuemer === eigentuemer.pk)!;
  const f = mit.find((k) => k.eigentuemer === forker.pk)!;
  assert.deepEqual([o.forks, o.forkVonKarte], [[f.schluessel], undefined]);
  assert.deepEqual([f.forks, f.forkVonKarte], [[], o.schluessel]);
  const privat = mitForks(karten.map((k) => (k.eigentuemer === forker.pk ? { ...k, privatRaum: "g1" } : k)));
  assert.deepEqual(privat.find((k) => k.eigentuemer === eigentuemer.pk)!.forks, [], "ein Fork in einem privaten Raum zählt nicht");
  const ohneOriginal = mitForks(karten.filter((k) => k.eigentuemer === forker.pk));
  assert.equal(ohneOriginal[0]!.forkVonKarte, undefined, "steht das Original nicht in der Liste, gibt es keinen Weg dorthin");
});

test("Verdrahtung (C-20j3): Forks mitladen, nie das eigene Repo forken, keines ersetzen, Bundle nur als Verweis", () => {
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /pool\.query\(\{ kinds: \[KIND_REPO_ANKUENDIGUNG\], "#a": ersteAdressen\.slice\(0, 100\), limit: 100 \}\)/);
  assert.match(repos, /karten = mitForks\(mitSternen\(/);
  const ui = lies("shell/tabs/fork-ui.ts");
  assert.match(ui, /if \(!repo \|\| k\.privatRaum \|\| k\.lokal\) return null;/, "nur öffentliche Repos");
  assert.match(ui, /if \(state\.keypair && k\.eigentuemer !== state\.keypair\.pk\) zeile\.append\(knopf\(t\("repo\.forken"\)/, "nie das eigene Repo");
  assert.match(ui, /return eigene\.has\(id\) \? t\("repo\.forkGibtEs"/, "ein Fork ersetzt kein eigenes Repo gleicher Kennung");
  assert.match(ui, /forkVon: repo\.adresse/);
  assert.match(ui, /name: id, blobId: ref\.blobId, headSha: ref\.headSha, branch: ref\.branch, message: ref\.message,/, "derselbe Blob – nichts neu hochgeladen");
  assert.doesNotMatch(ui, /uploadBlob|uploadAnhang|innerHTML|localStorage|location|history\./);
  assert.match(lies("shell/tabs/repo-seite.ts"), /const fork = forkZeile\(k, \{ name: eigentuemerName, neuLaden: h\.neuLaden, zuRepo: h\.zuRepo, eigeneKennungen: h\.eigeneKennungen \}\);/);
});
