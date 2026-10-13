/**
 * Schritt C-36 (Nutzertest G-1, G-2, G-3, G-5): Kleinigkeiten bei den Repos. Im Browser prüfen
 * der Smoke-Test „raum“ (Ankündigen mit einer Rückfrage, Mitwirkende nur bei der Liste) und
 * „privatraum“ (Repo im privaten Raum).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const repos = quelle("../src/shell/tabs/repos.ts");
const html = quelle("../src/shell/index.html");
const an = repos.slice(repos.indexOf("async function kuendigeAn("), repos.indexOf("export const legeRepoImRaumAn"));

test("ein Weg zum Anlegen: „Repo ankündigen“ – den Code lädt man danach auf der Repo-Seite hoch", () => {
  assert.doesNotMatch(html, /git-repo-publish|git-bundle-file|git-repo-name/);
  assert.doesNotMatch(repos, /git-repo-publish|git-bundle-file/);
  setLang("de");
  assert.match(t("repo.angekuendigt", { id: "x" }), /auf seiner Seite unter „Einstellungen“ hoch$/);
});

test("eine Rückfrage statt zwei: was geschieht, steht im Dialog", () => {
  assert.doesNotMatch(an, /bestaetige\(/);
  assert.match(an, /text: hinweis,/);
  setLang("de");
  // Alle vier Wege in einem Satz – öffentlich, öffentlicher Raum, privater Raum, nur dieses Gerät
  const satz = t("repo.ankuendigenHinweis");
  for (const teil of ["Öffentlich:", "öffentlichen Raum", "privaten Raum", "Nur dieses Gerät"]) assert.ok(satz.includes(teil), teil);
  assert.equal(t("repo.hinweisPrivat", { raum: "Werkstatt" }), "Im privaten Raum „Werkstatt“ – nur Mitglieder sehen es, verschlüsselt (MLS), auch den Schlüssel der Bundles.");
});

test("private Räume in der Wahl als solche erkennbar – wie öffentliche ihren Zusatz tragen", () => {
  assert.match(an, /text: p\.name \? t\("repo\.privaterRaumName", \{ name: p\.name \}\) : t\("repo\.privaterRaum"\)/);
  setLang("de");
  assert.equal(t("repo.privaterRaumName", { name: "Werkstatt" }), "Werkstatt (privater Raum)");
  assert.equal(t("repo.oeffentlicherRaum", { name: "Werkstatt" }), "Werkstatt (öffentlicher Raum)");
});

test("die Mitwirkenden des Projekts nur bei der Liste – die Repo-Seite hat ihren eigenen Reiter", () => {
  assert.match(html, /<div id="repos-mitwirkende" class="card">/);
  assert.match(repos, /document\.getElementById\("repos-mitwirkende"\)\?\.classList\.toggle\("hidden", !!offen\);/);
});
