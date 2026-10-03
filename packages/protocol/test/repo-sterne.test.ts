/**
 * Schritt C-20j1: Forks, Sterne und Beobachten – Fork als eigene Ankündigung
 * mit `["a", <original>, "", "fork"]`, Stern als Reaktion (NIP-25) und
 * Löschung (NIP-09), Beobachten als NIP-51-Liste nur mit verschlüsselten
 * Einträgen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { ProtokollFehler } from "../src/fehler.js";
import { baueRepoAnkuendigung, leseRepoAnkuendigung, repoAdresse } from "../src/nip34.js";
import {
  BEOBACHTEN_MAX, KIND_GIT_REPOS, STERN, baueBeobachtungsListe, baueStern, baueSternWeg, beobachtungsInhalt, eigeneBeobachtungsListe, forksVon,
  leseBeobachtungsInhalt, sterneZu,
} from "../src/repo-sterne.js";
import { regelRaumRepoPrivat } from "../src/leak-rules.js";

const eigentuemer = generateKeypair();
const forker = generateKeypair();
const fan = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const original = leseRepoAnkuendigung(s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], ersterCommit: "c".repeat(40) }, eigentuemer.pk), eigentuemer, 100));
const kennung = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof ProtokollFehler ? e.kennung : "anderer Fehler"; }
  return "kein Fehler";
};

test("C-20j1: Fork – eigene Ankündigung mit Verweis auf das Original, gelesen nur mit Marke, nie auf sich selbst", () => {
  const ev = s(baueRepoAnkuendigung({ id: "app", name: "App (Fork)", klon: [], ersterCommit: original.ersterCommit, forkVon: original.adresse }, forker.pk), forker, 200);
  assert.deepEqual(ev.tags.find((t) => t[0] === "a"), ["a", original.adresse, "", "fork"]);
  const fork = leseRepoAnkuendigung(ev);
  assert.deepEqual([fork.forkVon, fork.raum, fork.ersterCommit], [original.adresse, undefined, "c".repeat(40)]);
  assert.deepEqual(forksVon(original.adresse, [original, fork]), [fork.adresse]);
  assert.equal(kennung(() => baueRepoAnkuendigung({ id: "app", name: "x", klon: [], forkVon: "30617:zz:app" }, forker.pk)), "repo-fork");
  assert.equal(kennung(() => baueRepoAnkuendigung({ id: "app", name: "x", klon: [], forkVon: repoAdresse(forker.pk, "app") }, forker.pk)), "repo-fork", "nie ein Fork von sich selbst");
  const ohneMarke = { ...ev, tags: ev.tags.map((t) => (t[0] === "a" ? ["a", original.adresse] : t)) } as NostrEvent;
  assert.equal(leseRepoAnkuendigung(ohneMarke).forkVon, undefined, "ein bloßes a-Tag ist kein Fork");
  const selbst = { ...ev, tags: ev.tags.map((t) => (t[0] === "a" ? ["a", repoAdresse(forker.pk, "app"), "", "fork"] : t)) } as NostrEvent;
  assert.equal(leseRepoAnkuendigung(selbst).forkVon, undefined);
});

test("C-20j1: Sterne – je Person einer, gelöschte zählen nicht, nur genau an dieses Repo", () => {
  const stern = s(baueStern(original, fan.pk), fan, 200);
  assert.deepEqual([stern.kind, stern.content, stern.tags], [7, STERN, [["a", original.adresse], ["p", eigentuemer.pk], ["k", "30617"]]]);
  const zweiter = s(baueStern(original, fan.pk), fan, 210);
  const vonForker = s(baueStern(original, forker.pk), forker, 220);
  const anderes = s(baueStern({ eigentuemer: eigentuemer.pk, id: "anderes" }, fan.pk), fan, 230);
  const like = s({ ...baueStern(original, fan.pk), content: "+" }, fan, 240);
  assert.deepEqual(sterneZu(original.adresse, [stern, zweiter, vonForker, anderes, like], fan.pk), { anzahl: 2, von: [fan.pk, forker.pk], eigener: zweiter.id });
  const weg = s(baueSternWeg(vonForker.id, forker.pk), forker, 250);
  assert.deepEqual(weg.tags, [["e", vonForker.id], ["k", "7"]]);
  assert.equal(sterneZu(original.adresse, [stern, vonForker, weg]).anzahl, 1, "gelöscht zählt nicht, auch wenn das Relay ihn noch liefert");
  const fremdeLoeschung = s(baueSternWeg(stern.id, forker.pk), forker, 260);
  assert.equal(sterneZu(original.adresse, [stern, fremdeLoeschung]).anzahl, 1, "nur der eigene Stern lässt sich löschen");
  assert.equal(kennung(() => baueStern({ eigentuemer: "x", id: "app" }, fan.pk)), "stern-repo");
  assert.equal(kennung(() => baueSternWeg("x", fan.pk)), "stern-repo");
});

test("C-20j1: Beobachten – nur verschlüsselte Einträge, streng gelesen, keine offene Liste", () => {
  const inhalt = beobachtungsInhalt([original.adresse, original.adresse]);
  assert.deepEqual(JSON.parse(inhalt), [["a", original.adresse]]);
  assert.deepEqual(leseBeobachtungsInhalt(inhalt), [original.adresse]);
  assert.deepEqual(leseBeobachtungsInhalt('[["a","30617:x:y"],["p","z"],"kaputt",["a",' + JSON.stringify(original.adresse) + "]]"), [original.adresse]);
  assert.deepEqual(leseBeobachtungsInhalt("kein json"), []);
  assert.equal(kennung(() => beobachtungsInhalt(["30617:x:y"])), "beobachten-liste");
  assert.equal(kennung(() => beobachtungsInhalt(Array.from({ length: BEOBACHTEN_MAX + 1 }, (_, i) => repoAdresse(eigentuemer.pk, `r${i}`)))), "beobachten-liste");
  const liste = s(baueBeobachtungsListe("CHIFFRAT", fan.pk), fan, 200);
  assert.deepEqual([liste.kind, liste.tags, liste.content], [KIND_GIT_REPOS, [], "CHIFFRAT"], "keine offenen Tags");
  const offen = s({ ...baueBeobachtungsListe("x", fan.pk), tags: [["a", original.adresse]] }, fan, 300);
  assert.equal(eigeneBeobachtungsListe(fan.pk, [liste, offen])?.id, liste.id, "eine Liste mit offenen Einträgen gilt nicht als eigene private");
  assert.equal(eigeneBeobachtungsListe(forker.pk, [liste]), undefined);
});

test("raum-repo-privat (C-20j1): Stern, offene Repo-Liste oder Fork zu einem Repo aus einem privaten Raum sind ein Leck", () => {
  const stern = s(baueStern(original, fan.pk), fan, 200);
  const liste = s({ ...baueBeobachtungsListe("x", fan.pk), tags: [["a", original.adresse]] }, fan, 210);
  const fork = s(baueRepoAnkuendigung({ id: "kopie", name: "K", klon: [], forkVon: original.adresse }, forker.pk), forker, 220);
  assert.deepEqual(regelRaumRepoPrivat([stern, liste, fork], { repoIds: ["app"], schluessel: [] }).map((f) => f.detail),
    ["Repo eines privaten Raums offen (Kind 7)", "Repo eines privaten Raums offen (Kind 10018)", "Repo eines privaten Raums offen (Kind 30617)"]);
  assert.deepEqual(regelRaumRepoPrivat([s(baueBeobachtungsListe("x", fan.pk), fan, 230)], { repoIds: ["app"], schluessel: [] }), [], "verschlüsselt ist kein Leck");
});
