/**
 * Schritt 11.4c: Raum-Repos in der Oberfläche – im Raum eine Liste der Repos,
 * die bestätigt dazugehören, auf der Repo-Seite der Raum mit „Zum Raum“, im
 * Raum-Menü „Repo anlegen“ nur mit dem Recht „repos_pflegen“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baueRepoAnkuendigung, buildRoleGrant, buildRoles, buildSpace, generateKeypair, raumAdresse, signEvent, type NostrEvent } from "@freedomstack/protocol";
import { privateRaumKarten, repoKarten, reposImRaum } from "../src/repo-ansicht.js";

const besitzer = generateKeypair();
const gast = generateKeypair();
const SPACE = "werkstatt-ab12cd";
const ADRESSE = raumAdresse(besitzer.pk, SPACE);
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }) => signEvent(ev, k.sk);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function raum(): NostrEvent[] {
  return [
    s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [] }, 1_790_000_000), besitzer),
    s(buildRoles(SPACE, besitzer.pk, [{ id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben"] }], 1_790_000_001), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, gast.pk, ["mitglied"], 1_790_000_002), besitzer),
  ];
}
const ankuendigung = (von: typeof besitzer, id: string, adresse?: string) =>
  s(baueRepoAnkuendigung({ id, name: id, klon: [], ...(adresse ? { raum: adresse } : {}) }, von.pk), von);

test("11.4c: im Raum nur Repos, die bestätigt zu genau dieser Adresse gehören – mit dem Namen des Raums", () => {
  const fremd = generateKeypair();
  const andererRaum = raumAdresse(fremd.pk, SPACE); // gleiche Kennung, anderer Besitzer
  const karten = repoKarten([
    ankuendigung(besitzer, "app", ADRESSE),
    ankuendigung(gast, "gast-repo", ADRESSE), // Gast ohne „repos_pflegen“: ein bloßer Verweis
    ankuendigung(besitzer, "ohne-raum"),
    ankuendigung(fremd, "kopie", andererRaum),
  ], [], [], [], gast.pk, raum());
  assert.deepEqual(reposImRaum(karten, { adresse: ADRESSE }).map((k) => k.id), ["app"]);
  assert.deepEqual(reposImRaum(karten, { adresse: andererRaum }).map((k) => k.id), [], "ohne Struktur jenes Raums nicht bestätigt");
  assert.equal(karten.find((k) => k.id === "app")?.raumName, "Werkstatt");
  for (const id of ["gast-repo", "ohne-raum", "kopie"]) assert.equal(karten.find((k) => k.id === id)?.raumName, undefined, `${id}: kein Raum-Name`);
  // Ohne die Struktur des Raums (nicht geladen) gehört nichts dazu
  assert.deepEqual(reposImRaum(repoKarten([ankuendigung(besitzer, "app", ADRESSE)], [], [], [], gast.pk), { adresse: ADRESSE }), []);
});

test("11.4c: private Räume – nur die Karten dieser Gruppe, nie ein öffentliches Repo gleicher Kennung", () => {
  const offen = ankuendigung(besitzer, "app", ADRESSE);
  const innen = { ...ankuendigung(besitzer, "app"), tags: [["space", "gruppe1"], ...ankuendigung(besitzer, "app").tags], sig: "" };
  const karten = [
    ...repoKarten([offen], [], [], [], besitzer.pk, raum()),
    ...privateRaumKarten({ gruppe: "gruppe1", name: "Geheim", ankuendigungen: [innen], bundles: [], patches: [], status: [] }, besitzer.pk),
    ...privateRaumKarten({ gruppe: "gruppe2", ankuendigungen: [innen], bundles: [], patches: [], status: [] }, besitzer.pk),
  ];
  const g1 = reposImRaum(karten, { gruppe: "gruppe1" });
  assert.deepEqual(g1.map((k) => [k.privatRaum, k.raumName]), [["gruppe1", "Geheim"]]);
  assert.deepEqual(reposImRaum(karten, { gruppe: "gruppe2" }).map((k) => [k.privatRaum, k.raumName]), [["gruppe2", undefined]]);
  assert.deepEqual(reposImRaum(karten, { adresse: ADRESSE }).map((k) => k.privatRaum), [undefined], "öffentlich nur das öffentliche");
});

test("Verdrahtung (11.4c): Raum → Liste → Repo-Seite → „Zum Raum“; Anlegen im Raum nur mit Recht, öffentlich mit Verweis", () => {
  const raeume = lies("shell/tabs/raeume.ts");
  const repos = lies("shell/tabs/repos.ts");
  const seite = lies("shell/tabs/repo-seite.ts");
  const html = lies("shell/index.html");
  // Der offene Raum lädt seine Repos mit; die Liste folgt jedem Laden; ein Raumwechsel zeigt nie die des vorigen
  assert.match(raeume, /spacesUi\.messages = nachrichten;\s*\/\/ Repos dieses Raums \(11\.4c\)[^\n]*\n\s*const ziel = raumZiel\(\);\s*if \(ziel && "adresse" in ziel\) merkeRaumAdresse\(ziel\.adresse\);/);
  const art = raeume.slice(raeume.indexOf("function zeigeRaumArt"), raeume.indexOf("/** Wohin Repos dieses Raums"));
  assert.match(art, /getElementById\("space-repo-neu"\)\?\.classList\.toggle\("hidden", !repos\);/);
  assert.match(art, /zeigeRaumRepos\(\);\n\}/);
  assert.match(raeume, /beiReposGeladen\(zeigeRaumRepos\);/);
  assert.match(raeume, /if \(ziel && darfRepos\(\)\) void legeRepoImRaumAn\(ziel, name\);/);
  assert.match(raeume, /return darf\(state\.keypair\.pk, RAUM_REPO_RECHT, st\)|&& darf\(state\.keypair\.pk, RAUM_REPO_RECHT, st\);/);
  assert.match(raeume, /if \(spacesUi\.privat\) return darf\(spacesUi\.privat\.ich, RAUM_REPO_RECHT, spacesUi\.privat\.zustand\);/);
  // Liste nur als DOM mit textContent, Klick öffnet die Repo-Seite – die Adresse nennt nie das Repo (C.1a)
  const liste = raeume.slice(raeume.indexOf("function zeigeRaumRepos"), raeume.indexOf("export async function geheZuRaum"));
  assert.match(liste, /b\.addEventListener\("click", \(\) => oeffneRepo\(k\.schluessel\)\);/);
  assert.doesNotMatch(liste, /innerHTML|insertAdjacentHTML/);
  const oeffne = repos.slice(repos.indexOf("export function oeffneRepo"), repos.indexOf("/** Alle Beiträge"));
  assert.match(oeffne, /switchTab\("repos"\);/);
  assert.doesNotMatch(oeffne, /location|history/);
  // Repo-Seite: Raum nur als Text, unbestätigt als solcher, „Zum Raum“ schließt das Repo und öffnet den Raum
  const zeile = seite.slice(seite.indexOf("function raumZeile"), seite.indexOf("/** Klonen:"));
  assert.match(zeile, /if \(!k\.privatRaum && !k\.raumBestaetigt\) \{\s*zeile\.append\(el\("span", t\("repo\.raumUnbestaetigt"\), "muted"\)\);/);
  assert.doesNotMatch(zeile, /innerHTML/);
  assert.match(repos, /zumRaum: \(\) => \{\s*offenesRepo = null;\s*zeige\(\);\s*void geheZuRaum\(offen\);/);
  // Geladen werden nur Räume, die in dieser Sitzung offen waren – nie alle eigenen Räume auf einmal
  assert.match(repos, /"#a": \[\.\.\.raumAdressen\]\.slice\(0, 50\)/);
  assert.equal((repos.match(/raumAdressen\.add\(/g) ?? []).length, 1);
  assert.equal((raeume.match(/merkeRaumAdresse\(/g) ?? []).length, 1, "nur beim Öffnen eines öffentlichen Raums");
  // Anlegen aus dem Raum: öffentlich mit Verweis (a-Tag über baueRepoAnkuendigung), privat nur in die Gruppe, ohne „Wo“
  assert.match(repos, /\.\.\.\(raeume\.length && !imRaum \? \[\{ art: "wahl" as const, name: "wo"/);
  assert.match(repos, /const angaben = \{ id, name: id, klon, \.\.\.\(beschreibung \? \{ beschreibung \} : \{\}\), \.\.\.\(raum \? \{ raum \} : \{\}\) \};/);
  assert.match(repos, /const frage = gruppe \? "repo\.ankuendigenFrageRaum" : raum \? "repo\.ankuendigenFrageOeffentlich" : "repo\.ankuendigenFrage";/);
  // Menüpunkt und Abschnitt sind zu Beginn verborgen
  assert.match(html, /<button id="space-repo-neu" class="menue-punkt hidden" role="menuitem" type="button" data-i18n="raum\.repoAnlegen">/);
  assert.match(html, /<section id="raum-repos" class="raum-repos hidden" aria-labelledby="raum-repos-titel">/);
});
