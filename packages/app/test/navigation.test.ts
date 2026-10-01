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
    for (const unterseite of [undefined, "verlauf", "modelle", "details", "a1b2"]) {
      assert.match(adresseFuer({ seite, ...(unterseite ? { unterseite } : {}) }), /^#\/[a-z]+(\/(verlauf|modelle|details))?$/);
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

test("C-16: Relay-Stand ehrlich – „verbunden“ nur aus dem Getter, nie die Zahl im Pool dafür ausgeben (B5, E8)", () => {
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    assert.match(t("nav.relaysVerbunden", { verbunden: 3, n: 8 }), /^3 .*8 /, "beide Zahlen");
  }
  setLang("de");
  assert.equal(t("nav.relaysVerbunden", { verbunden: 0, n: 8 }), "0 von 8 Relays verbunden");
  setLang("en");
  const ui = readFileSync(new URL("../src/shell/ui.ts", import.meta.url), "utf8");
  // Verbunden zählt nur, was der Relay selbst meldet (WebSocketRelay.verbunden, offene Leitung)
  assert.match(ui, /verbunden = Array\.isArray\(r\) \? r\.filter\(\(x\) => \(x as \{ verbunden\?: unknown \}\)\.verbunden === true\)\.length : 0;/);
  assert.match(ui, /classList\.toggle\("on", verbunden > 0 && netzDa\(\)\)/, "der Punkt leuchtet nur mit offener Verbindung");
  const ws = readFileSync(new URL("../../protocol/src/ws-relay.ts", import.meta.url), "utf8");
  assert.match(ws, /get verbunden\(\): boolean \{\s*return this\.ws !== null && this\.ws\.readyState === WebSocket\.OPEN;\s*\}/);
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

test("C.6b: das rechte Feld des Agenten unter 1200 px als eigene Ebene – Adresse, Knöpfe, Ebene", () => {
  assert.deepEqual(zielAusAdresse("#/agent/details"), { seite: "ai", unterseite: "details" });
  assert.equal(adresseFuer({ seite: "ai", unterseite: "details" }), "#/agent/details");
  assert.equal(zielAusAdresse("#/chat/details"), null);
  // Der Knopf steht bei „Verlauf“ und „Modelle“, „‹ Zurück“ im Feld selbst
  const leiste = html.slice(html.indexOf('<div class="agent-mobil-leiste'), html.indexOf("</div>", html.indexOf('<div class="agent-mobil-leiste')));
  assert.match(leiste, /<button id="agent-zu-details" class="ghost" type="button">/);
  const feld = html.slice(html.indexOf('<aside class="agent-panel"'), html.indexOf("</aside>", html.indexOf('<aside class="agent-panel"')));
  assert.match(feld, /<button id="agent-panel-zurueck"[^>]*data-i18n-aria="nav\.zurueckAria"/);
  const nav = readFileSync(new URL("../src/shell/navigation.ts", import.meta.url), "utf8");
  assert.match(nav, /if \(unterseite === "details"\) \{\n\s+layout\.dataset\.sicht = "details";\n\s+return;/);
  assert.match(nav, /getElementById\("agent-zu-details"\)\?\.addEventListener\("click", \(\) => gehe\(\{ seite: "ai", unterseite: "details" \}, oeffne\)\);/);
  assert.match(nav, /getElementById\("agent-panel-zurueck"\)\?\.addEventListener\("click", \(\) => zurueck\(oeffne\)\);/);
  const block = css.slice(css.indexOf("/* ---------- Agent (C.6b)"));
  assert.match(block, /@media \(max-width: 1199px\) \{[^}]*\}[\s\S]*\.agent-layout\[data-sicht="details"\] \.agent-panel \{ display: flex;/);
  assert.match(block, /@media \(min-width: 860px\) and \(max-width: 1199px\) \{\n\s+#agent-zu-verlauf, #agent-zu-modelle \{ display: none; \}/);
});

test("C.6b: B16 – die Knöpfe für Nachfolge, Modelle und Abzeichen verdrahtet nur app.ts, nicht jede Antwort", () => {
  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  for (const id of ["succ-setup", "succ-heartbeat", "models-refresh", "models-seed", "models-publish", "badge-create"]) {
    assert.doesNotMatch(agent, new RegExp(`\\$\\("#${id}"\\)`), id);
    assert.equal((app.match(new RegExp(`\\$\\("#${id}"\\)`, "g")) ?? []).length, 1, id);
  }
  // Was die Antwort zeigen soll, frischt sie weiter auf
  const antwort = agent.slice(agent.indexOf("async function handleAnswer"), agent.indexOf("function resetSendBtn"));
  for (const f of ["zeigeNachfolge()", "zeigeModelle()", "zeigeMitwirkende()"]) assert.ok(antwort.includes(`void ${f};`), f);
});
