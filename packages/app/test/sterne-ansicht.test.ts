/**
 * Schritt C-20j2: Sterne und Beobachten in der App – die Daten ohne DOM
 * (`mitSternen()`, Neuigkeiten für beobachtete Repos) und die Verdrahtung:
 * Stern öffentlich nur nach Rückfrage, Beobachten nur verschlüsselt und nur
 * nach frischem Lesen der eigenen Liste.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baueRepoAnkuendigung, baueStern, baueSternWeg, generateKeypair, signEvent } from "@freedomstack/protocol";
import { mitSternen, repoKarten } from "../src/repo-ansicht.js";
import { beteiligt } from "../src/repo-neuigkeiten.js";

const eigentuemer = generateKeypair();
const ich = generateKeypair();
const fan = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const ankuendigung = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [] }, eigentuemer.pk), eigentuemer, 100);
const repo = { eigentuemer: eigentuemer.pk, id: "app" };

test("C-20j2: Sterne und Beobachten an der Karte – nur öffentliche Repos, eigener Stern erkannt, gelöschte zählen nicht", () => {
  const meiner = s(baueStern(repo, ich.pk), ich, 200);
  const vonFan = s(baueStern(repo, fan.pk), fan, 210);
  const weg = s(baueSternWeg(vonFan.id, fan.pk), fan, 220);
  const [karte] = repoKarten([ankuendigung], [], [], [], ich.pk);
  const adresse = karte.repo!.adresse;
  const [mit] = mitSternen([karte], [meiner, vonFan, weg], ich.pk, new Set([adresse]));
  assert.deepEqual([mit.sterne, mit.beobachtet], [{ anzahl: 1, eigener: meiner.id }, true]);
  const [ohne] = mitSternen([karte], [], ich.pk, new Set());
  assert.deepEqual([ohne.sterne, ohne.beobachtet], [{ anzahl: 0 }, false]);
  const [privat] = mitSternen([{ ...karte, privatRaum: "g1" }], [meiner], ich.pk, new Set([adresse]));
  assert.deepEqual([privat.sterne, privat.beobachtet], [undefined, undefined], "private Repos haben keine Sterne");
  const [lokal] = mitSternen([{ ...karte, lokal: {} }], [meiner], ich.pk, new Set([adresse]));
  assert.equal(lokal.sterne, undefined);
  assert.equal(beteiligt(mit, ich.pk), true, "Beobachtete Repos melden Neues wie eigene");
  assert.equal(beteiligt(ohne, ich.pk), false);
});

test("Verdrahtung (C-20j2): Stern nur nach Rückfrage, Beobachten nur verschlüsselt und nach frischem Lesen", () => {
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /pool\.query\(\{ kinds: \[KIND_REAKTION\], "#a": adressen, limit: 1000 \}\)/);
  assert.match(repos, /pool\.query\(\{ kinds: \[KIND_LOESCHUNG\], "#e": sterne\.map\(\(e\) => e\.id\), limit: 1000 \}\)/);
  assert.match(repos, /mitSternen\(karten, \[\.\.\.sterne, \.\.\.loeschungen\], state\.keypair\?\.pk, await beobachtetLaden\)/);
  const ui = lies("shell/tabs/repo-sterne-ui.ts");
  assert.match(ui, /if \(!eigener && !\(await bestaetige\(\{ titel: t\("repo\.sternFrage"/, "ein Stern ist öffentlich – erst fragen");
  assert.match(ui, /const neu = new Set\(await ladeBeobachtet\(pool, true\)\);/, "vor dem Schreiben frisch und streng lesen – sonst überschriebe man eine fremde Fassung");
  assert.match(ui, /catch \(e\) \{\s*if \(streng\) throw e;\s*\}/, "scheitert das Entschlüsseln, wird nicht geschrieben");
  assert.match(ui, /const chiffrat = await signer\.nip44Encrypt\(ich, beobachtungsInhalt\(\[\.\.\.neu\]\)\);\s*await pool\.publish\(await signiere\(baueBeobachtungsListe\(chiffrat, ich\)\)\);/);
  assert.match(ui, /if \(!repo \|\| k\.privatRaum \|\| k\.lokal\) return null;/, "nur öffentliche Repos");
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|location|history\.|localStorage/, "nichts davon liegt im Klartext auf dem Gerät");
  assert.match(lies("shell/tabs/repo-seite.ts"), /const folgen = sternUndBeobachten\(k, h\.neuLaden\);/);
});
