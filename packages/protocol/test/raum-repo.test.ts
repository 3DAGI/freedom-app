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

// ------------------------------------------------------------ 11.4b: private Räume

test("11.4b: innere Events – NIP-34-Bausteine mit Raum, ohne Verweis auf einen öffentlichen Raum", async () => {
  const { raumRepoAnkuendigung, raumRepoBundle, raumRepoPatch, raumRepoStatus, RAUM_REPO_ARTEN } = await import("../src/raum-repo.js");
  const a = raumRepoAnkuendigung("gruppe1", { id: "app", name: "App", klon: [], raum: ADRESSE, maintainer: [pfleger.pk] });
  assert.equal(a.art, 30617);
  assert.deepEqual(a.tags[0], ["space", "gruppe1"]);
  assert.ok(!a.tags.some((t) => t[0] === "a"), "privat nie mit Verweis auf einen öffentlichen Raum");
  const b = raumRepoBundle("gruppe1", { name: "app", blobId: "b".repeat(64), headSha: "c".repeat(40), branch: "main", message: "m", version: 2, schluessel: { alg: "aes-gcm", key: "5a".repeat(32), nonce: "6b".repeat(12), ox: "7c".repeat(32) } });
  assert.equal(b.art, 38042);
  assert.ok(b.tags.some((t) => t[0] === "aes-gcm"), "der Schlüssel reist nur hier – in der Gruppe");
  const text = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] T\n\n---\ndiff --git a/a b/a\n`;
  const p = raumRepoPatch("gruppe1", { repo: { eigentuemer: besitzer.pk, id: "app" }, text });
  assert.equal(p.art, 1617);
  assert.equal(p.text, text);
  const st = raumRepoStatus("gruppe1", { patch: { id: "d".repeat(64), autor: pfleger.pk, repoAdresse: `30617:${besitzer.pk}:app` }, status: "geschlossen", eigentuemer: besitzer.pk });
  assert.equal(st.art, 1632);
  assert.ok([a, b, p, st].every((x) => RAUM_REPO_ARTEN.includes(x.art) && x.tags[0][0] === "space"));
});

test("11.4b: Repos des privaten Raums – nur von Pflegern angekündigt, Pfleger als Maintainer, Status nach ihnen", async () => {
  const { gruppenRaum } = await import("../src/raum-gruppe.js");
  const { raumRepoAnkuendigung, raumRepoPatch, raumRepoStatus, raumReposPrivat } = await import("../src/raum-repo.js");
  const admin = besitzer.pk;
  let n = 0;
  const innen = (von: string, s: { art: number; tags: string[][]; text: string }, zeit = 1_790_000_000 + n) =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: s.art, tags: s.tags, text: s.text, zeit });
  const text = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] T\n\n---\ndiff --git a/a b/a\n`;
  const ank = innen(admin, raumRepoAnkuendigung("g", { id: "app", name: "App", klon: [] }));
  const vomGast = innen(mitglied.pk, raumRepoAnkuendigung("g", { id: "gast", name: "Gast", klon: [] }));
  const anderswo = innen(admin, raumRepoAnkuendigung("anderer-raum", { id: "x", name: "X", klon: [] }));
  const patch = innen(mitglied.pk, raumRepoPatch("g", { repo: { eigentuemer: admin, id: "app" }, text }));
  const zu = innen(pfleger.pk, raumRepoStatus("g", { patch: { id: patch.id, autor: mitglied.pk, repoAdresse: `30617:${admin}:app` }, status: "angenommen", eigentuemer: admin }));
  const alle = [ank, vomGast, anderswo, patch, zu];

  const ohneRecht = gruppenRaum("g", alle, { admins: [admin], mitglieder: [admin, pfleger.pk, mitglied.pk] }).zustand;
  const r1 = raumReposPrivat("g", alle, ohneRecht);
  assert.deepEqual(r1.ankuendigungen.map((e) => e.tags.find((t) => t[0] === "d")?.[1]), ["app"], "nur vom Admin, nur aus diesem Raum");
  const repo1 = leseRepoAnkuendigung(r1.ankuendigungen[0]);
  assert.equal(repo1.eigentuemer, admin);
  assert.deepEqual(repo1.maintainer, [], "ohne Zuweisung pflegt nur der Admin");
  const gelesen = lesePatch(r1.patches[0]);
  assert.equal(patchStatus(gelesen, repo1, r1.status).status, "offen", "der Status eines Nicht-Pflegers zählt nicht");

  const rollen = innen(admin, { art: 34701, tags: [["space", "g"], ["role", "pflege", "Pflege", "lesen|schreiben|repos_pflegen", "40", ""]], text: "" });
  const zuweisung = innen(admin, { art: 34702, tags: [["space", "g"], ["p", pfleger.pk], ["role", "pflege"]], text: "" });
  const mitRecht = gruppenRaum("g", [...alle, rollen, zuweisung], { admins: [admin], mitglieder: [admin, pfleger.pk, mitglied.pk] }).zustand;
  const r2 = raumReposPrivat("g", alle, mitRecht);
  const repo2 = leseRepoAnkuendigung(r2.ankuendigungen[0]);
  assert.deepEqual(repo2.maintainer, [pfleger.pk], "mit „repos_pflegen“ pflegt er mit");
  assert.equal(patchStatus(gelesen, repo2, r2.status).status, "angenommen");
});
