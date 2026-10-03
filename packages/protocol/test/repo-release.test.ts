/**
 * Schritt C-20h1: Releases von Repos – NIP-51-Satz (Kind 30063) je Version
 * mit Titel, Notizen und dem Bundle genau dieser Version. Streng gelesen; es
 * zählen nur Eigentümer und Maintainer, je Version die neueste Aussage, ein
 * Rückzug blendet die Version aus. In privaten Räumen nur als inneres Event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { ProtokollFehler } from "../src/fehler.js";
import { baueRepoAnkuendigung, leseRepoAnkuendigung } from "../src/nip34.js";
import {
  KIND_REPO_RELEASE, REPO_RELEASE_GRENZEN, baueRepoRelease, baueRepoReleaseRueckzug, gueltigeReleaseVersion, leseRepoRelease, neuestesRepoRelease,
  repoReleasesZu,
} from "../src/repo-release.js";
import { KIND_RELEASE_MANIFEST } from "../src/release.js";
import { RAUM_REPO_ARTEN, raumRepoRelease, raumReposPrivat } from "../src/raum-repo.js";
import { gruppenRaum } from "../src/raum-gruppe.js";
import { regelRaumRepoPrivat } from "../src/leak-rules.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const repo = leseRepoAnkuendigung(s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 100));
const schluessel = { alg: "aes-gcm" as const, key: "1".repeat(64), nonce: "2".repeat(24), ox: "3".repeat(64) };
const bundle = { blobId: "4".repeat(64), schluessel };
const kennung = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof ProtokollFehler ? e.kennung : "anderer Fehler"; }
  return "kein Fehler";
};

test("C-20h1: Release bauen und lesen – Version, Titel, Notizen, Commit, Bundle dieser Version, Vorabversion", () => {
  const ev = s(baueRepoRelease({ repo, version: "v1.0", titel: " Erste Version ", notizen: "**Neu:** alles", commit: "c".repeat(40), bundle, vorab: true }, eigentuemer.pk), eigentuemer, 200);
  assert.equal(ev.kind, KIND_REPO_RELEASE);
  assert.notEqual(KIND_REPO_RELEASE, KIND_RELEASE_MANIFEST, "nicht das Release-Manifest der App");
  assert.deepEqual(ev.tags.slice(0, 5), [["d", "app@v1.0"], ["a", repo.adresse], ["p", eigentuemer.pk], ["version", "v1.0"], ["title", "Erste Version"]]);
  const r = leseRepoRelease(ev);
  assert.deepEqual([r.version, r.titel, r.notizen, r.commit, r.bundle, r.vorab, r.zurueckgezogen, r.repoAdresse],
    ["v1.0", "Erste Version", "**Neu:** alles", "c".repeat(40), bundle, true, false, repo.adresse]);
  const ohne = leseRepoRelease(s(baueRepoRelease({ repo, version: "release/2.0-rc.1", titel: "Zwei" }, eigentuemer.pk), eigentuemer, 210));
  assert.deepEqual([ohne.commit, ohne.bundle, ohne.vorab, ohne.notizen], [undefined, undefined, false, ""]);
});

test("C-20h1: Negativfälle beim Bauen – Version, Titel, Größe, Commit, Bundle, Repo", () => {
  const gut = { repo, version: "v1", titel: "T" };
  for (const v of ["", "-v1", "v 1", "v1..2", "v1\n", "ä1", "x".repeat(101)]) assert.equal(gueltigeReleaseVersion(v), false, v);
  assert.equal(gueltigeReleaseVersion("x".repeat(100)), true);
  assert.equal(kennung(() => baueRepoRelease({ ...gut, version: "v1..2" }, eigentuemer.pk)), "release-version");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, titel: "  " }, eigentuemer.pk)), "release-titel");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, titel: "a\u0007b" }, eigentuemer.pk)), "release-titel");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, titel: "x".repeat(201) }, eigentuemer.pk)), "release-titel");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, notizen: "x".repeat(REPO_RELEASE_GRENZEN.notizen + 1) }, eigentuemer.pk)), "release-gross");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, commit: "abc" }, eigentuemer.pk)), "release-commit");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, bundle: { ...bundle, blobId: "zz" } }, eigentuemer.pk)), "release-bundle");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, bundle: { ...bundle, schluessel: { ...schluessel, key: "1" } } }, eigentuemer.pk)), "release-bundle");
  assert.equal(kennung(() => baueRepoRelease({ ...gut, repo: { eigentuemer: "x", id: "app" } }, eigentuemer.pk)), "release-repo");
  assert.equal(kennung(() => baueRepoRelease(gut, eigentuemer.pk)), "kein Fehler");
});

test("C-20h1: streng lesen – fremde Events mit kaputten Feldern fallen heraus, ein kaputtes Bundle nur für sich", () => {
  const ev = s(baueRepoRelease({ repo, version: "v1", titel: "T", bundle, commit: "c".repeat(40) }, eigentuemer.pk), eigentuemer, 200);
  const mit = (tags: string[][]) => ({ ...ev, tags }) as NostrEvent;
  const ersetze = (name: string, neu: string[]) => ev.tags.map((t) => (t[0] === name ? neu : t));
  assert.throws(() => leseRepoRelease({ ...ev, kind: 30064 }), /Kein Release/);
  assert.throws(() => leseRepoRelease(mit(ersetze("d", ["d", "anderes@v1"]))), /Version oder Repo/, "d passt nicht zu a und version");
  assert.throws(() => leseRepoRelease(mit(ersetze("a", ["a", `30618:${eigentuemer.pk}:app`]))), /Version oder Repo/);
  assert.throws(() => leseRepoRelease(mit(ersetze("version", ["version", "v 1"]))), /Version oder Repo/);
  assert.throws(() => leseRepoRelease(mit(ev.tags.filter((t) => t[0] !== "title"))), /Titel/);
  const kaputt = leseRepoRelease(mit(ersetze("aes-gcm", ["aes-gcm", "1", "2", "3"])));
  assert.equal(kaputt.bundle, undefined, "ohne gültigen Schlüssel kein Bundle");
  assert.equal(leseRepoRelease(mit(ersetze("commit", ["commit", "xyz"]))).commit, undefined);
});

test("C-20h1: Liste – nur Eigentümer und Maintainer, je Version die neueste, Rückzug blendet aus, neuestes ohne Vorab", () => {
  const rel = (k: typeof eigentuemer, version: string, titel: string, zeit: number, vorab = false) =>
    s(baueRepoRelease({ repo, version, titel, ...(vorab ? { vorab } : {}) }, k.pk), k, zeit);
  const events = [
    rel(eigentuemer, "v1", "Eins", 200),
    rel(maintainer, "v1", "Eins (korrigiert)", 210),
    rel(fremd, "v9", "Fremd", 300),
    rel(eigentuemer, "v2", "Zwei", 220),
    rel(eigentuemer, "v3-rc", "Drei, Vorschau", 230, true),
    s(baueRepoRelease({ repo: { eigentuemer: eigentuemer.pk, id: "anderes" }, version: "v5", titel: "Woanders" }, eigentuemer.pk), eigentuemer, 240),
  ];
  const liste = repoReleasesZu(repo, events);
  assert.deepEqual(liste.map((r) => [r.version, r.titel]), [["v3-rc", "Drei, Vorschau"], ["v2", "Zwei"], ["v1", "Eins (korrigiert)"]]);
  assert.equal(neuestesRepoRelease(liste)?.version, "v2", "eine Vorabversion ist nie das neueste Release");
  const zurueck = s(baueRepoReleaseRueckzug({ repo, version: "v2" }, maintainer.pk), maintainer, 250);
  assert.deepEqual(leseRepoRelease(zurueck).zurueckgezogen, true);
  assert.deepEqual(repoReleasesZu(repo, [...events, zurueck]).map((r) => r.version), ["v3-rc", "v1"]);
  const fremderRueckzug = s(baueRepoReleaseRueckzug({ repo, version: "v1" }, fremd.pk), fremd, 260);
  assert.deepEqual(repoReleasesZu(repo, [...events, fremderRueckzug]).map((r) => r.version), ["v3-rc", "v2", "v1"], "Fremde ziehen nichts zurück");
  assert.equal(neuestesRepoRelease([]), undefined);
});

test("C-20h1: im privaten Raum nur als inneres Event – Pfleger veröffentlichen, die Liste kommt aus raumReposPrivat()", () => {
  const admin = eigentuemer.pk;
  let n = 0;
  const innen = (von: string, x: { art: number; tags: string[][]; text: string }) =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: x.art, tags: x.tags, text: x.text, zeit: 1_790_000_000 + n });
  const ank = innen(admin, { art: 30617, tags: [["space", "g"], ["d", "app"], ["name", "App"]], text: "" });
  const gut = innen(admin, raumRepoRelease("g", { repo: { eigentuemer: admin, id: "app" }, version: "v1", titel: "Eins", bundle }));
  const vonMitglied = innen(fremd.pk, raumRepoRelease("g", { repo: { eigentuemer: admin, id: "app" }, version: "v2", titel: "Nicht von Pflegern" }));
  assert.ok(RAUM_REPO_ARTEN.includes(gut.art) && gut.tags[0]![0] === "space" && gut.tags[0]![1] === "g");
  const zustand = gruppenRaum("g", [ank, gut, vonMitglied], { admins: [admin], mitglieder: [admin, fremd.pk] }).zustand;
  const r = raumReposPrivat("g", [ank, gut, vonMitglied], zustand);
  const liste = repoReleasesZu(leseRepoAnkuendigung(r.ankuendigungen[0]!), r.releases);
  assert.deepEqual(liste.map((x) => [x.version, x.bundle?.blobId]), [["v1", bundle.blobId]], "nur von Pflegern");
});

test("raum-repo-privat (C-20h1): ein offenes Release eines Repos aus einem privaten Raum ist ein Leck, sein Bundle-Schlüssel auch", () => {
  const offen = s(baueRepoRelease({ repo, version: "v1", titel: "T", bundle }, eigentuemer.pk), eigentuemer, 200);
  assert.deepEqual(regelRaumRepoPrivat([offen], { repoIds: ["app"], schluessel: [] }).map((f) => f.detail), ["Repo eines privaten Raums offen (Kind 30063)"]);
  assert.deepEqual(regelRaumRepoPrivat([offen], { repoIds: [], schluessel: [schluessel.key] }).map((f) => f.detail), ["Bundle-Schlüssel sichtbar (Kind 30063)"]);
});
