/**
 * Schritt C-38b (Nutzertest V-1): Verdienen ohne Knoten unter dem Schlüssel. Im Browser prüft es
 * der Smoke-Test „ohne_knoten“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const html = quelle("../src/shell/index.html");
const ui = quelle("../src/shell/verdienst-ui.ts");

test("ohne Angebot unter dem Schlüssel: ein Hinweis statt der SOL-Texte für Betreiber", () => {
  // Erst das Angebot, dann der Hinweis – vor der Frage nach dem Zahlkanal
  assert.match(ui, /if \(ohne\) ohne\.hidden = !!angebot;\n\s+if \(!angebot\) return melde\(t\("earn\.solKeinKnoten"\)\);\n\s+if \(!angebot\.kanal\) return melde\(t\("earn\.solKeinKanal"\)\);/);
  // Der SOL-Teil (mit ZAHLKANAL=1 und „Dein Knoten hat …“) steht hinter dem Hinweis und fällt mit ihm weg
  assert.match(html, /<p id="earn-ohne-knoten" class="mono-sm" hidden>.*<div class="nur-mit-knoten"><h4[^>]*data-i18n="earn\.sol">/s);
  assert.match(quelle("../src/shell/app.css"), /#earn-ohne-knoten:not\(\[hidden\]\) ~ \.nur-mit-knoten \{ display: none; \}/);
  const sol = html.slice(html.indexOf('<div class="nur-mit-knoten">'), html.indexOf('<button id="earn-refresh"'));
  assert.match(sol, /data-i18n="earn\.solHinweis"/);
  assert.match(sol, /id="earn-sol-status"/);
});

test("der Hinweis führt zum Einrichten und nennt den anderen Weg (Schlüssel oben eintragen)", () => {
  assert.match(ui, /\$\("#earn-zum-hosten"\)\?\.addEventListener\("click", \(\) => \$<HTMLElement>\('\[data-subtab-group="earn"\] \[data-subtab="host"\]'\)\?\.click\(\)\);/);
  setLang("de");
  assert.match(t("earn.ohneKnoten"), /^Unter diesem Schlüssel ist kein Knoten zu finden/);
  assert.match(t("earn.ohneKnoten"), /trag ihn oben ein\.$/);
  assert.doesNotMatch(t("earn.ohneKnoten") + t("earn.solKeinKnoten"), /ZAHLKANAL|NODE_SOL_ADDRESS/);
  assert.equal(t("earn.zumHosten"), "Knoten einrichten");
  setLang("en");
  assert.equal(t("earn.solKeinKnoten"), "No node under this key.");
});
