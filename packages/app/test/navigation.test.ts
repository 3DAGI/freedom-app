/**
 * Schritt C.1a: Rahmen und Navigation. Die Adresse nennt nur Seiten, nie eine
 * Kennung; jede Seite hat einen Knopf und einen Bereich; mobil stehen
 * Verdienen, Profil und Settings unter „Mehr“; der Relay-Stand sagt nicht
 * „verbunden“, wo die App nur den Pool zählt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEITEN, type Seite, UNTER_MEHR, adresseFuer, zielAusAdresse } from "../src/shell/navigation.js";
import { setLang, t } from "../src/i18n.js";

const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/shell/app.css", import.meta.url), "utf8");
const seiten = Object.keys(SEITEN) as Seite[];

test("C.1a: Adresse ↔ Seite, hin und zurück, auch mit Unterseite des Agenten", () => {
  for (const seite of seiten) assert.deepEqual(zielAusAdresse(adresseFuer({ seite })), { seite });
  assert.equal(adresseFuer({ seite: "comm" }), "#/chat");
  assert.equal(adresseFuer({ seite: "ai", unterseite: "verlauf" }), "#/agent/verlauf");
  assert.deepEqual(zielAusAdresse("#/agent/modelle"), { seite: "ai", unterseite: "modelle" });
  // Unbekannte Unterseiten fallen weg statt in die Adresse zu wandern
  assert.equal(adresseFuer({ seite: "comm", unterseite: "verlauf" }), "#/chat");
});

test("C.1a: keine Kennung in der Adresse – was nicht genau eine bekannte Seite ist, gilt nicht", () => {
  for (const falsch of [
    "", "#", "#/", "#chat", "#/Chat", "#/unbekannt", "#/chat/", "#/agent/xyz",
    `#/chat/${"ab".repeat(32)}`, "#/chat/npub1abc", "#/chat?id=1", "#/raum/mls", "#/chat/verlauf/1",
  ]) assert.equal(zielAusAdresse(falsch), null, falsch);
  // Was die App selbst schreibt, besteht nur aus Seitennamen
  for (const seite of seiten) {
    for (const unterseite of [undefined, "verlauf", "modelle", "a1b2"]) {
      assert.match(adresseFuer({ seite, ...(unterseite ? { unterseite } : {}) }), /^#\/[a-z]+(\/(verlauf|modelle))?$/);
    }
  }
});

test("C.1a: jede Seite hat einen Knopf in der Navigation und einen Bereich; mobil steht der Rest unter „Mehr“", () => {
  for (const seite of seiten) {
    assert.match(html, new RegExp(`<button data-tab="${seite}"`), `Knopf für ${seite}`);
    assert.match(html, new RegExp(`<section id="page-${seite}" class="tab-page">`), `Bereich für ${seite}`);
  }
  const mehrTeil = [...html.matchAll(/<button data-tab="(\w+)" class="nav-mehr-teil"/g)].map((m) => m[1]);
  assert.deepEqual(mehrTeil, [...UNTER_MEHR], "mobil ausgeblendet = unter „Mehr“");
  const zeilen = [...html.matchAll(/data-geh="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(zeilen, [...UNTER_MEHR], "„Mehr“ führt zu jeder ausgeblendeten Seite");
  assert.match(html, /id="lang-btn-mehr"/, "Sprache mobil erreichbar (B4)");
  assert.match(app, /\{ btnId: "#lang-btn-mehr", menuId: "#lang-menu-mehr" \}/);
});

test("C.1a: verdrahtet – switchTab zieht Adresse und „Mehr“ nach, der Start folgt der Adresse", () => {
  assert.match(app, /seiteGezeigt\(name\);\n\}/, "am Ende von switchTab()");
  assert.match(app, /switchTab\(startSeite\(\)\);/);
  assert.match(app, /wireNavigation\(\(seite\) => switchTab\(seite\)\);/);
  // Die Kopfzeile exportiert nicht mehr per Klick den Schlüssel und importiert nicht
  assert.doesNotMatch(app, /\$\("#ident"\)\.onclick = exportIdentity/);
  assert.doesNotMatch(html, /id="btn-import"/);
});

test("C.1a: Desktop-Raster – Leiste links über die volle Höhe, Hinweise und Seite rechts (B1)", () => {
  const raster = css.slice(css.indexOf("Rahmen (Schritt C.1a)"));
  assert.match(raster, /#app \{ display: grid;/);
  assert.match(raster, /#app > nav \{ grid-column: 1; grid-row: 1 \/ -1; \}/);
  assert.match(raster, /#app > #offline-hinweis, #app > #onboarding-bar, #app > #backup-warn \{ grid-column: 2; \}/);
  assert.match(raster, /#app > main \{ grid-column: 2;/);
});

test("C.1a: Relay-Stand ehrlich – „im Pool“, nie „verbunden“ (B5)", () => {
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    assert.doesNotMatch(`${t("relaysTitle")} ${t("nav.relaysImPool", { n: 8 })}`, /verbunden|connected/i);
    assert.match(t("nav.relaysImPool", { n: 8 }), /^8 /);
  }
  setLang("en");
});

/** Inhalt eines Bereichs `#page-<name>` aus index.html. */
const bereich = (name: string): string => {
  const a = html.indexOf(`<section id="page-${name}"`);
  assert.ok(a >= 0, name);
  return html.slice(a, html.indexOf("</section>", a));
};

test("C.1b: reines Verschieben – jeder Block steht genau einmal, auf seiner neuen Seite", () => {
  const ziele: Record<string, string[]> = {
    // seit C.3a eine Liste (repos-karten) statt git-repo-list und nip34-liste, dazu die Repo-Seite
    repos: ["repos-karten", "repo-seite", "git-repo-publish", "nip34-ankuendigen", "contrib-list"],
    netz: ["coverage-list", "coverage-join", "coverage-leave", "mesh-connect", "mesh-queue", "offline-caps"],
    earn: ["trust-fill", "trust-xp", "referral-link"],
    profile: ["badge-list", "nb-import"],
  };
  for (const [seite, ids] of Object.entries(ziele)) {
    for (const id of ids) {
      assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} genau einmal`);
      assert.ok(bereich(seite).includes(`id="${id}"`), `${id} auf ${seite}`);
    }
  }
  // Die alten Reiter sind weg
  for (const alt of ['data-subpane="agent:repos"', 'data-subpane="earn:map"', 'data-subpane="settings:mesh"', 'data-subtab="mesh"><span']) {
    assert.ok(!html.includes(alt), alt);
  }
  assert.match(app, /if \(name === "netz"\) \{ void ladeAbdeckung\(\); void zeigeMeshWeg\(\); \}/);
});
