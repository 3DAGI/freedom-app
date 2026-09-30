/**
 * Schritt 11.4a in der App: Repos in öffentlichen Räumen – die Karten zählen
 * Raum-Pfleger als Maintainer, die Einstellungen bieten nur Räume an, in denen
 * ich Repos pflegen darf, und speichern den Verweis in der Ankündigung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  baueRepoAnkuendigung, bauePatch, baueStatus, buildRoleGrant, buildRoles, buildSpace, generateKeypair, lesePatch, raumAdresse, signEvent,
  type NostrEvent,
} from "@freedomstack/protocol";
import { ankuendigungAusFeldern, raumAuswahl, repoKarten } from "../src/repo-ansicht.js";

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
  assert.match(lies("shell/tabs/raeume.ts"), /permissions: \["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben", "repos_pflegen"\] \},/);
});
