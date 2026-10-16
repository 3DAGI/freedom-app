/**
 * Schritt C-38a (Nutzertest W-1, W-2, X-1 bis X-4): Kleinigkeiten in Währung und Settings. Im
 * Browser prüft es der Smoke-Test „geld_settings_klein“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";
import { sicherungInfo } from "../src/protokoll-texte.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const html = quelle("../src/shell/index.html");
const css = quelle("../src/shell/app.css");

test("Kopf der Seite Währung: „KI-Budget“ mit Einheit – eine Obergrenze, kein Guthaben; keine SOL-Zeile ohne Quelle", () => {
  assert.match(html, /<div class="nb-row"><span class="nb-label" data-i18n="waehr\.kopfBudget">KI-Budget<\/span><span class="nb-val" id="nb-sats">—<\/span><\/div>/);
  // Die SOL-Zeile las freedom.escrow.lamports – das schreibt nichts in der App
  assert.doesNotMatch(html, /id="nb-sol"/);
  assert.doesNotMatch(quelle("../src/shell/ui.ts"), /nb-sol|freedom\.escrow\.lamports/);
  setLang("de");
  assert.equal(t("waehr.kopfSats", { n: 100 }), "100 sats");
  assert.match(t("ein.budgetRest"), /eine Obergrenze, kein Guthaben/);
  setLang("en");
  assert.equal(t("waehr.kopfBudget"), "AI budget");
});

test("Häkchen-Sätze wie geschrieben; Kurs-Hinweis und Verbindungsstand mit Abstand", () => {
  // Seit C-42a stehen alle Etiketten in normaler Schreibung, 13 px – nie wieder Großbuchstaben
  assert.match(css, /label \{ font-size: 13px; font-weight: 500; color: var\(--text-muted\); display: block; margin-bottom: 4px; \}/);
  assert.doesNotMatch(css, /\nlabel \{[^}]*text-transform: uppercase/);
  assert.match(css, /label:has\(input\[type="checkbox"\]\), label:has\(input\[type="radio"\]\) \{ text-transform: none; letter-spacing: normal; \}/);
  assert.match(css, /#kurs-info:not\(:empty\) \{ margin-bottom: 8px; \}\n#sol-pubkey \{ margin-bottom: 8px; \}/);
});

test("Sicherheit: der Balken zeigt die erledigten Schritte an ihrer Stelle, der Satz darüber sagt, was „vorher“ heißt", () => {
  const settings = quelle("../src/shell/tabs/settings.ts");
  assert.match(settings, /s\.classList\.toggle\("on", !!schritte\[i\]\);/);
  assert.doesNotMatch(settings, /toggle\("on", i < erledigt\)/);
  setLang("de");
  assert.equal(t("set.lead"), "Alle fünf helfen nur, wenn sie vor einem Verlust oder Diebstahl des Geräts eingerichtet sind.");
  assert.ok(html.includes(`data-i18n="set.lead">${t("set.lead")}</p>`));
  // „erneut“ stimmt erst nach einer Prüfung
  assert.equal(t("set.erneutPruefen"), "jetzt prüfen");
  assert.ok(html.includes(`data-i18n="set.erneutPruefen">jetzt prüfen</button>`));
});

test("„heute“ statt „vor 0 Tag(en)“ – die Sicherung und der Zustand eines Repos", () => {
  setLang("de");
  const jetzt = 1_800_000_000;
  assert.match(sicherungInfo(2048, jetzt - 60, jetzt), /^Letzte Sicherung heute, 2 KB\. /);
  assert.match(sicherungInfo(2048, jetzt - 86400, jetzt), /^Letzte Sicherung vor 1 Tag\(en\), 2 KB\. /);
  setLang("en");
  assert.match(sicherungInfo(2048, jetzt - 60, jetzt), /^Last backup today, 2 KB\. /);
  setLang("de");
  assert.equal(t("earn.repoHeute"), "Heute etwas veröffentlicht.");
});
