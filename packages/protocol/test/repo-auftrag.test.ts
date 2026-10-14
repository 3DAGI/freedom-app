/**
 * Repo-Aufträge an Agenten (11.5b, Entwurf `docs/REPO-AGENTEN-ENTWURF.md` V1, V6):
 * die Erwähnung zeigt mit genau einem Tag auf ein Repo des Raums; das Repo muss zum
 * Raum gehören; Agenten pflegen nie und setzen keinen Status.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ROLLE, baueRepoAnkuendigung, bauePatch, baueStatus, buildRoleGrant, buildRoles, buildSpace, generateKeypair, istAgentIm,
  lesePatch, leseRepoAnkuendigung, leseRepoAuftrag, mitRaumRechten, patchStatus, raumAdresse, raumZustandFuer, repoAdresse,
  repoAuftragTags, repoImOffenenRaum, repoImPrivatenRaum, signEvent, type NostrEvent,
} from "../src/index.js";
import { gruppenRaum } from "../src/raum-gruppe.js";
import { raumRepoAnkuendigung, raumRepoPatch, raumRepoStatus, raumReposPrivat } from "../src/raum-repo.js";

const besitzer = generateKeypair(), pfleger = generateKeypair(), agent = generateKeypair(), autor = generateKeypair();
const SPACE = "werkstatt-ab12cd";
const ADRESSE = raumAdresse(besitzer.pk, SPACE);
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }) => signEvent(ev, k.sk);
const ISSUE = "ab".repeat(32);

/** Raum mit Pflege-Rolle; der Agent hat neben „agent“ sogar „repos_pflegen“ – er pflegt trotzdem nie. */
function raum(): NostrEvent[] {
  return [
    s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [] }, 1_790_000_000), besitzer),
    s(buildRoles(SPACE, besitzer.pk, [
      { id: "pflege", name: "Pflege", rank: 40, permissions: ["lesen", "schreiben", "repos_pflegen"] },
      { id: AGENT_ROLLE, name: "Agent", rank: 1, permissions: ["lesen", "schreiben", "threads"] },
    ], 1_790_000_001), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, pfleger.pk, ["pflege"], 1_790_000_002), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, agent.pk, [AGENT_ROLLE, "pflege"], 1_790_000_003), besitzer),
  ];
}
const ankuendigung = (k: { pk: string; sk: Uint8Array }, raumA = ADRESSE, zeit?: number) => {
  const ev = baueRepoAnkuendigung({ id: "app", name: "App", klon: ["https://git.example/app.git"], raum: raumA }, k.pk);
  return s(zeit ? { ...ev, created_at: zeit } : ev, k);
};
const PATCH_TEXT = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Test\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;

test("11.5b: Tags der Erwähnung – genau ein Repo, höchstens ein Issue, sonst kein Auftrag", () => {
  const repo = repoAdresse(pfleger.pk, "app");
  assert.deepEqual(repoAuftragTags({ repo }), [["a", repo, "", "repo"]]);
  assert.deepEqual(leseRepoAuftrag(repoAuftragTags({ repo, issue: ISSUE })), { repo, issue: ISSUE });
  // Andere a-Tags (Raum-Adresse, Fork) und e-Tags (Antwort) zählen nicht
  const mitAnderen = [["a", ADRESSE], ["e", "cd".repeat(32), "", "reply"], ["a", repoAdresse(autor.pk, "x"), "", "fork"], ...repoAuftragTags({ repo })];
  assert.deepEqual(leseRepoAuftrag(mitAnderen), { repo });
  for (const tags of [
    [],
    [["a", repo]],
    [["a", repo, "", "repo"], ["a", repoAdresse(autor.pk, "zwei"), "", "repo"]],
    [["a", repo, "", "repo"], ["e", ISSUE, "", "issue"], ["e", "cd".repeat(32), "", "issue"]],
    [["a", ADRESSE, "", "repo"]],
    [["a", `30617:${pfleger.pk}:a b`, "", "repo"]],
    [["a", repo, "", "repo"], ["e", "AB".repeat(32), "", "issue"]],
  ]) assert.equal(leseRepoAuftrag(tags), null, JSON.stringify(tags).slice(0, 120));
  assert.throws(() => repoAuftragTags({ repo: ADRESSE }), /ungültig/);
  assert.throws(() => repoAuftragTags({ repo, issue: "x" }), /ungültig/);
});

test("11.5b: offener Raum – nur ein bestätigtes Repo genau dieses Raums, nie eines vom Agenten", () => {
  const zustand = raumZustandFuer(ADRESSE, raum())!;
  const istAgent = istAgentIm(zustand);
  const anks = [ankuendigung(pfleger), ankuendigung(agent), ankuendigung(autor), ankuendigung(besitzer, raumAdresse(autor.pk, SPACE))];
  const ok = repoImOffenenRaum({ auftrag: { repo: repoAdresse(pfleger.pk, "app") }, raum: ADRESSE, ankuendigungen: anks, zustand, istAgent });
  assert.ok(ok.ok);
  assert.deepEqual(new Set(ok.repo.maintainer), new Set([besitzer.pk]), "der Agent pflegt nicht mit, obwohl er „repos_pflegen“ hat");
  for (const [repo, warum] of [
    [repoAdresse(agent.pk, "app"), "vom Agenten angekündigt"],
    [repoAdresse(autor.pk, "app"), "ohne „repos_pflegen“"],
    [repoAdresse(besitzer.pk, "app"), "verweist auf einen anderen Raum"],
    [repoAdresse(pfleger.pk, "fehlt"), "unbekannt"],
  ] as const) {
    assert.deepEqual(repoImOffenenRaum({ auftrag: { repo }, raum: ADRESSE, ankuendigungen: anks, zustand, istAgent }), { ok: false, fall: "agent-repo-fremd" }, warum);
  }
  // Gegenprobe: ohne die Prüfung auf Agenten gälte das Repo des Agenten
  assert.ok(repoImOffenenRaum({ auftrag: { repo: repoAdresse(agent.pk, "app") }, raum: ADRESSE, ankuendigungen: anks, zustand }).ok);
  // Die neueste Ankündigung zählt – hat sie den Raum verlassen, ist es kein Repo des Raums mehr
  const spaeter = ankuendigung(pfleger, raumAdresse(autor.pk, SPACE), 4_000_000_000);
  assert.deepEqual(repoImOffenenRaum({ auftrag: { repo: repoAdresse(pfleger.pk, "app") }, raum: ADRESSE, ankuendigungen: [...anks, spaeter], zustand, istAgent }),
    { ok: false, fall: "agent-repo-fremd" });
});

test("11.5b: patchStatus – ein Agent setzt keinen Status, weder als Pfleger noch am eigenen Patch", () => {
  const zustand = raumZustandFuer(ADRESSE, raum())!;
  const istAgent = istAgentIm(zustand);
  const repo = mitRaumRechten(leseRepoAnkuendigung(ankuendigung(pfleger)), zustand);
  const vonAutor = lesePatch(s(bauePatch({ repo, text: PATCH_TEXT }, autor.pk), autor));
  const vomAgenten = lesePatch(s(bauePatch({ repo, text: PATCH_TEXT }, agent.pk), agent));
  const status = (patch: typeof vonAutor, art: "angenommen" | "geschlossen" | "entwurf", k: { pk: string; sk: Uint8Array }, zeit: number) =>
    s({ ...baueStatus({ patch, status: art, eigentuemer: repo.eigentuemer }, k.pk), created_at: zeit }, k);
  const annahmeAgent = status(vonAutor, "angenommen", agent, 1_790_000_100);
  assert.equal(patchStatus(vonAutor, repo, [annahmeAgent]).status, "angenommen", "Gegenprobe: ohne istAgent zählte er als Pfleger");
  assert.equal(patchStatus(vonAutor, repo, [annahmeAgent], istAgent).status, "offen");
  const eigener = status(vomAgenten, "entwurf", agent, 1_790_000_100);
  assert.equal(patchStatus(vomAgenten, repo, [eigener]).status, "entwurf", "ohne istAgent zählt der Autor");
  assert.equal(patchStatus(vomAgenten, repo, [eigener], istAgent).status, "offen", "auch am eigenen Patch nicht");
  const annahmePfleger = status(vonAutor, "angenommen", pfleger, 1_790_000_050);
  assert.deepEqual(patchStatus(vonAutor, repo, [annahmePfleger, annahmeAgent], istAgent).von, pfleger.pk, "der Mensch mit Recht zählt");
});

test("11.5b: privater Raum – Agenten pflegen nicht, auch als Admin; ihr Status zählt nicht", () => {
  let n = 0;
  const innen = (von: string, x: { art: number; tags: string[][]; text: string }) =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: x.art, tags: x.tags, text: x.text, zeit: 1_790_000_000 + n });
  const admin = besitzer.pk;
  const vomAdmin = innen(admin, raumRepoAnkuendigung("g", { id: "app", name: "App", klon: [] }));
  const vomAgenten = innen(agent.pk, raumRepoAnkuendigung("g", { id: "agent-repo", name: "Agent", klon: [] }));
  const patch = innen(autor.pk, raumRepoPatch("g", { repo: { eigentuemer: admin, id: "app" }, text: PATCH_TEXT }));
  const annahme = innen(agent.pk, raumRepoStatus("g", { patch: { id: patch.id, autor: autor.pk, repoAdresse: repoAdresse(admin, "app") }, status: "angenommen", eigentuemer: admin }));
  const ereignisse = [vomAdmin, vomAgenten, patch, annahme];
  const zustand = gruppenRaum("g", ereignisse, { admins: [admin, agent.pk], mitglieder: [admin, agent.pk, autor.pk] }).zustand;
  const istAgent = (pk: string) => pk === agent.pk;

  const ok = repoImPrivatenRaum({ auftrag: { repo: repoAdresse(admin, "app") }, raumId: "g", ereignisse, zustand, istAgent });
  assert.ok(ok.ok);
  assert.deepEqual(ok.repo.maintainer, [], "der Agent ist Admin, pflegt aber nicht mit");
  assert.deepEqual(repoImPrivatenRaum({ auftrag: { repo: repoAdresse(agent.pk, "agent-repo") }, raumId: "g", ereignisse, zustand, istAgent }),
    { ok: false, fall: "agent-repo-fremd" }, "ein Agent kündigt keine Repos an");
  assert.ok(repoImPrivatenRaum({ auftrag: { repo: repoAdresse(agent.pk, "agent-repo") }, raumId: "g", ereignisse, zustand }).ok, "Gegenprobe ohne istAgent");
  assert.deepEqual(repoImPrivatenRaum({ auftrag: { repo: repoAdresse(admin, "app") }, raumId: "anderer", ereignisse, zustand, istAgent }),
    { ok: false, fall: "agent-repo-fremd" }, "aus einem anderen Raum");

  const r = raumReposPrivat("g", ereignisse, zustand, istAgent);
  const repo = leseRepoAnkuendigung(r.ankuendigungen[0]!);
  assert.equal(patchStatus(lesePatch(r.patches[0]!), repo, r.status, istAgent).status, "offen");
});
