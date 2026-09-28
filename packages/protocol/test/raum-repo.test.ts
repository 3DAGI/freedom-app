/**
 * Schritt 11.4a: Repos in öffentlichen Räumen – Verweis in der Ankündigung,
 * Rechte aus den Raum-Rollen. Ein Repo gehört nur zum Raum, wenn der
 * Ankündigende dort „repos_pflegen“ hat; dann pflegen es alle mit diesem Recht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { baueRepoAnkuendigung, baueStatus, darfAnnehmen, lesePatch, leseRepoAnkuendigung, patchStatus, bauePatch } from "../src/nip34.js";
import { buildRoleGrant, buildRoles, buildSpace, leseRaumAdresse, raumAdresse } from "../src/spaces.js";
import { mitRaumRechten, raumZustandFuer } from "../src/raum-repo.js";

const besitzer = generateKeypair();
const pfleger = generateKeypair();
const mitglied = generateKeypair();
const fremd = generateKeypair();
const SPACE = "werkstatt-ab12cd";
const ADRESSE = raumAdresse(besitzer.pk, SPACE);
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }) => signEvent(ev, k.sk);

function raum(): NostrEvent[] {
  return [
    s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [] }, 1_790_000_000), besitzer),
    s(buildRoles(SPACE, besitzer.pk, [
      { id: "pflege", name: "Pflege", rank: 40, permissions: ["lesen", "schreiben", "repos_pflegen"] },
      { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben"] },
    ], 1_790_000_001), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, pfleger.pk, ["pflege"], 1_790_000_002), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, mitglied.pk, ["mitglied"], 1_790_000_003), besitzer),
  ];
}
const repoVon = (k: { pk: string; sk: Uint8Array }, raumA = ADRESSE) =>
  leseRepoAnkuendigung(s(baueRepoAnkuendigung({ id: "app", name: "App", klon: ["https://git.example/app.git"], raum: raumA }, k.pk), k));

test("11.4a: Raum-Adresse – an den Besitzer gebunden, streng gelesen", () => {
  assert.equal(ADRESSE, `34700:${besitzer.pk}:space:${SPACE}`);
  assert.deepEqual(leseRaumAdresse(ADRESSE), { besitzer: besitzer.pk, spaceId: SPACE });
  for (const x of ["34700:abc:space:x", `30617:${besitzer.pk}:space:x`, `34700:${besitzer.pk}:x`, `34700:${besitzer.pk}:space:a b`, 7, null]) {
    assert.equal(leseRaumAdresse(x), null, String(x));
  }
  assert.throws(() => raumAdresse("kein-schluessel", SPACE));
  assert.throws(() => baueRepoAnkuendigung({ id: "app", name: "App", klon: [], raum: "irgendwas" }, besitzer.pk), /öffentlicher Raum/);
  const r = repoVon(pfleger);
  assert.equal(r.raum, ADRESSE, "Tag „a“ gelesen");
  assert.equal(leseRepoAnkuendigung({ ...s(baueRepoAnkuendigung({ id: "x", name: "x", klon: [] }, pfleger.pk), pfleger), tags: [["d", "x"], ["a", "30617:kaputt"]] }).raum, undefined);
});

test("11.4a: gehört zum Raum nur mit Recht – dann pflegen es alle mit „repos_pflegen“", () => {
  const zustand = raumZustandFuer(ADRESSE, raum());
  assert.ok(zustand);
  const vomPfleger = mitRaumRechten(repoVon(pfleger), zustand);
  assert.equal(vomPfleger.raumBestaetigt, true);
  assert.deepEqual(new Set(vomPfleger.maintainer), new Set([besitzer.pk]), "der Besitzer pflegt mit, der Eigentümer ist es ohnehin");
  assert.equal(darfAnnehmen(vomPfleger, mitglied.pk), false, "ohne Recht nicht");

  const vomBesitzer = mitRaumRechten(repoVon(besitzer), zustand);
  assert.equal(vomBesitzer.raumBestaetigt, true);
  assert.deepEqual(vomBesitzer.maintainer, [pfleger.pk]);

  const vomMitglied = mitRaumRechten(repoVon(mitglied), zustand);
  assert.equal(vomMitglied.raumBestaetigt, false, "ohne „repos_pflegen“ gehört das Repo nicht zum Raum");
  assert.deepEqual(vomMitglied.maintainer, [], "und bekommt keine Pfleger");
  assert.equal(mitRaumRechten(repoVon(fremd), zustand).raumBestaetigt, false);
  const anderer = mitRaumRechten(repoVon(pfleger, raumAdresse(fremd.pk, SPACE)), zustand);
  assert.equal(anderer.raumBestaetigt, false, "Adresse eines anderen Besitzers passt nicht zum Zustand");
});

test("11.4a: Raum-Zustand nur aus der Definition des Besitzers aus der Adresse", () => {
  const unterschoben = s(buildSpace({ spaceId: SPACE, name: "Übernommen", ownerPubkey: fremd.pk, channels: [] }, 1_790_000_100), fremd);
  const rollen = s(buildRoles(SPACE, fremd.pk, [{ id: "alle", name: "alle", rank: 99, permissions: ["repos_pflegen"] }], 1_790_000_101), fremd);
  const zustand = raumZustandFuer(ADRESSE, [...raum(), unterschoben, rollen]);
  assert.equal(zustand?.ownerPubkey, besitzer.pk, "eine neuere Definition eines anderen zählt nicht");
  assert.equal(zustand?.space?.name, "Werkstatt");
  assert.equal(mitRaumRechten(repoVon(fremd), zustand).raumBestaetigt, false);
  assert.equal(raumZustandFuer(ADRESSE, []), undefined, "ohne Definition kein Zustand");
  assert.equal(raumZustandFuer("kaputt", raum()), undefined);
});

test("11.4a: Patch-Status zählt Raum-Pfleger – nach Entzug nicht mehr", () => {
  const autor = generateKeypair();
  const repo = repoVon(besitzer);
  const text = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Test\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;
  const patchEv = s(bauePatch({ repo, text }, autor.pk), autor);
  const patch = lesePatch(patchEv);
  const angenommen = s(baueStatus({ patch, status: "angenommen", eigentuemer: repo.eigentuemer }, pfleger.pk), pfleger);
  const mitRaum = mitRaumRechten(repo, raumZustandFuer(ADRESSE, raum()));
  assert.equal(patchStatus(patch, repo, [angenommen]).status, "offen", "ohne Raum zählt der Pfleger nicht");
  assert.equal(patchStatus(patch, mitRaum, [angenommen]).status, "angenommen", "mit Raum-Recht zählt er");
  const entzogen = [...raum(), s(buildRoleGrant(SPACE, besitzer.pk, pfleger.pk, ["mitglied"], 1_790_000_200), besitzer)];
  assert.equal(patchStatus(patch, mitRaumRechten(repo, raumZustandFuer(ADRESSE, entzogen)), [angenommen]).status, "offen", "Rechte gelten, wie der Raum sie jetzt vergibt");
});
