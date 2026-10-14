/**
 * Schritt 11.4a in der App: Repos in öffentlichen Räumen – die Karten zählen
 * Raum-Pfleger als Maintainer, die Einstellungen bieten nur Räume an, in denen
 * ich Repos pflegen darf, und speichern den Verweis in der Ankündigung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_ROLLE, baueRepoAnkuendigung, bauePatch, baueStatus, buildRoleGrant, buildRoles, buildSpace, generateKeypair, lesePatch, raumAdresse, signEvent,
  type NostrEvent,
} from "@freedomstack/protocol";
import { ankuendigungAusFeldern, privateRaumKarten, raumAuswahl, repoKarten } from "../src/repo-ansicht.js";

const besitzer = generateKeypair();
const pfleger = generateKeypair();
const gast = generateKeypair();
const autor = generateKeypair();
const SPACE = "werkstatt-ab12cd";
const ADRESSE = raumAdresse(besitzer.pk, SPACE);
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }) => signEvent(ev, k.sk);
const TEXT = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Test\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;

function raum(): NostrEvent[] {
  return [
    s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [] }, 1_790_000_000), besitzer),
    s(buildRoles(SPACE, besitzer.pk, [
      { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "repos_pflegen"] },
      { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben"] },
    ], 1_790_000_001), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, pfleger.pk, ["mod"], 1_790_000_002), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, gast.pk, ["mitglied"], 1_790_000_003), besitzer),
  ];
}

test("11.4a: Karte – Raum-Pfleger nehmen an wie Maintainer, Gäste nicht", () => {
  const ank = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], raum: ADRESSE }, besitzer.pk), besitzer);
  const patchEv = s(bauePatch({ repo: { eigentuemer: besitzer.pk, id: "app" }, text: TEXT }, autor.pk), autor);
  const status = s(baueStatus({ patch: lesePatch(patchEv), status: "angenommen", eigentuemer: besitzer.pk }, pfleger.pk), pfleger);

  const [mit] = repoKarten([ank], [], [patchEv], [status], pfleger.pk, raum());
  assert.equal(mit.raumBestaetigt, true);
  assert.equal(mit.zeilen[0].status, "angenommen", "der Status des Raum-Pflegers zählt");
  const [ohne] = repoKarten([ank], [], [patchEv], [status], pfleger.pk);
  assert.equal(ohne.raumBestaetigt, false, "ohne Raum-Struktur nicht bestätigt");
  assert.equal(ohne.zeilen[0].status, "offen");

  const [alsGast] = repoKarten([ank], [], [patchEv], [], gast.pk, raum());
  assert.deepEqual(alsGast.zeilen[0].aktionen, [], "ein Gast pflegt nicht");
  const [alsPfleger] = repoKarten([ank], [], [patchEv], [], pfleger.pk, raum());
  assert.deepEqual(alsPfleger.zeilen[0].aktionen, ["annehmen", "entwurf", "schliessen"]);
  const [ohneRaum] = repoKarten([s(baueRepoAnkuendigung({ id: "x", name: "x", klon: [] }, besitzer.pk), besitzer)], [], [], [], pfleger.pk, raum());
  assert.equal("raumBestaetigt" in ohneRaum, false, "Repos ohne Raum bleiben, wie sie sind");
});

test("11.4a: Auswahl – nur Räume, in denen ich Repos pflegen darf; Einstellungen speichern den Verweis", () => {
  assert.deepEqual(raumAuswahl(raum(), pfleger.pk), [{ adresse: ADRESSE, name: "Werkstatt" }]);
  assert.deepEqual(raumAuswahl(raum(), besitzer.pk), [{ adresse: ADRESSE, name: "Werkstatt" }], "der Besitzer darf alles");
  assert.deepEqual(raumAuswahl(raum(), gast.pk), [], "ohne Recht keine Auswahl");
  // Eine fremde Definition mit derselben Kennung ist ein anderer Raum – dort habe ich kein Recht
  const fremd = generateKeypair();
  const kopie = s(buildSpace({ spaceId: SPACE, name: "Kopie", ownerPubkey: fremd.pk, channels: [] }, 1_790_000_100), fremd);
  assert.deepEqual(raumAuswahl([...raum(), kopie], pfleger.pk), [{ adresse: ADRESSE, name: "Werkstatt" }]);

  const leer = { name: "", beschreibung: "", klon: "", web: "", maintainer: "", ersterCommit: "" };
  assert.equal(ankuendigungAusFeldern("app", { ...leer, raum: ` ${ADRESSE} ` }).raum, ADRESSE);
  assert.equal("raum" in ankuendigungAusFeldern("app", { ...leer, raum: "" }), false, "kein Raum → kein Verweis");
});

test("Verdrahtung (11.4a): Karten mit Raum-Struktur, Auswahl in den Einstellungen, neue Moderatoren pflegen Repos", () => {
  const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const repos = lies("shell/tabs/repos.ts");
  assert.match(repos, /karten = \[\.\.\.repoKarten\(ankuendigungen, bundles, patches, status, state\.keypair\?\.pk, await raumStruktur\(raumIds\)\),/);
  // Seit B-7: nach Kennungen gefragt, gewählt nur ein beigetretener Raum (Adresse oder Kennung von vor B-7)
  assert.match(repos, /const eintraege = oeffentlicheRaeume\(\);[\s\S]*return raumAuswahl\(await raumStruktur\(kennungen\), state\.keypair\.pk\)\s*\.filter\(\(r\) => eintraege\.includes\(r\.adresse\) \|\| eintraege\.includes\(kennungVon\(r\.adresse\) \?\? ""\)\);/);
  const seite = lies("shell/tabs/repo-seite.ts");
  assert.match(seite, /raum\.id = "repo-feld-raum";/);
  assert.match(seite, /ersterCommit: wert\("ersterCommit"\), raum: wert\("raum"\),/);
  // Seit B-20b stehen die Rechte der Moderatoren in MOD_RECHTE (dazu „kanaele_verwalten“)
  const raeume = lies("shell/tabs/raeume.ts");
  assert.match(raeume, /const MOD_RECHTE = \["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben", "repos_pflegen", "kanaele_verwalten"\] as const;/);
  assert.match(raeume, /\{ id: MOD_ROLLE, name: "Moderator", rank: 50, permissions: \[\.\.\.MOD_RECHTE\] \}, \/\/ kein UI-Text/);
});

test("11.5b: Karte – ein Agent im Raum setzt keinen Status, auch mit „repos_pflegen“; privat an seiner Karte erkannt", () => {
  const agent = generateKeypair();
  const mitAgent = [
    s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [] }, 1_790_000_000), besitzer),
    s(buildRoles(SPACE, besitzer.pk, [
      { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "repos_pflegen"] },
      { id: AGENT_ROLLE, name: "Agent", rank: 1, permissions: ["lesen", "schreiben", "threads"] },
    ], 1_790_000_001), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, agent.pk, [AGENT_ROLLE, "mod"], 1_790_000_002), besitzer),
  ];
  const ank = s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], raum: ADRESSE }, besitzer.pk), besitzer);
  const patchEv = s(bauePatch({ repo: { eigentuemer: besitzer.pk, id: "app" }, text: TEXT }, autor.pk), autor);
  const annahme = s(baueStatus({ patch: lesePatch(patchEv), status: "angenommen", eigentuemer: besitzer.pk }, agent.pk), agent);
  const [karte] = repoKarten([ank], [], [patchEv], [annahme], besitzer.pk, mitAgent);
  assert.equal(karte!.zeilen[0]!.status, "offen", "die Annahme des Agenten zählt nicht");
  assert.ok(!karte!.repo!.maintainer.includes(agent.pk), "der Agent pflegt nicht mit");
  // Privat: Agenten an ihrer Karte in der Gruppe (`agenten`)
  const innen = { ...ank, tags: [["space", "g"], ...ank.tags.filter((t) => t[0] !== "a"), ["maintainers", agent.pk]], sig: "" };
  const privat = (agenten?: string[]) => privateRaumKarten({ gruppe: "g", ankuendigungen: [innen], bundles: [], patches: [patchEv], status: [annahme], ...(agenten ? { agenten } : {}) }, besitzer.pk);
  assert.equal(privat()[0]!.zeilen[0]!.status, "angenommen", "Gegenprobe: ohne Agenten-Liste zählte er als Maintainer");
  assert.equal(privat([agent.pk])[0]!.zeilen[0]!.status, "offen");
});

test("Verdrahtung (11.5b): Agenten privater Räume aus ihren Karten an raumReposPrivat und an die Karten", () => {
  const raumRepos = readFileSync(new URL("../src/shell/raum-repos.ts", import.meta.url), "utf8");
  assert.match(raumRepos, /const agenten = raumAgentKarten\(stand\.ereignisse\)\.map\(\(k\) => k\.agent\);/);
  assert.match(raumRepos, /raumReposPrivat\(gruppe, stand\.ereignisse, zustand, \(pk\) => agenten\.includes\(pk\)\)/);
  const ansicht = readFileSync(new URL("../src/repo-ansicht.ts", import.meta.url), "utf8");
  assert.match(ansicht, /const istAgent = zustand \? istAgentIm\(zustand\) : istAgentPrivat;/);
  assert.match(ansicht, /patchStatus\(patch, repo, status, istAgent\)/);
});
