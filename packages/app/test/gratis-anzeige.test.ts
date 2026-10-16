/**
 * Schritt C-27: Den Gratis-Start sichtbar machen (Übergabe von Spur A, 09.10.). Im Browser prüft es der
 * Smoke-Test „gratis_anzeige“ (Angebote aus `scripts/gratis-probe.mts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const start = quelle("../src/shell/gratis-start.ts");

test("der Stand kommt nur aus dem Kontingent dieses Geräts – nichts neu zählen, nichts ins Netz, nichts merken", () => {
  const zeige = start.slice(start.indexOf("export function zeigeGratisStand"));
  assert.match(zeige, /const rest = kontingentRest\(geraeteKontingent\.stand\(\)\);/);
  assert.doesNotMatch(zeige.slice(0, zeige.indexOf("\n}\n")), /setItem|fetch|publish|buche/);
  // Nach jeder Gratis-Antwort neu, beim Öffnen des Agenten und beim Wechsel des Tarifs
  assert.match(start, /await geraeteKontingent\.buche\(tokensDerAntwort\(usage\)\)\.catch\(\(\) => undefined\);\n\s+zeigeGratisStand\(\);/);
  const app = quelle("../src/shell/app.ts");
  assert.match(app, /if \(name === "ai"\) \{[^}]*zeigeGratisStand\(\); \}/);
  assert.match(app, /\$\("#ai-tier"\)\.addEventListener\("change", zeigeGratisStand\);/);
});

test("nur in „Automatisch“ und „Free“; die Fairness-Regel steht dabei", () => {
  assert.match(start, /ziel\.hidden = tarif !== "auto" && tarif !== "free";/);
  setLang("de");
  assert.equal(t("agent.gratisHeute", { antworten: 14, max: 20, tokens: "12.000", maxTokens: "20.000" }), "Gratis heute: noch 14 von 20 Antworten, 12.000 von 20.000 Tokens");
  assert.match(t("agent.gratisRegel"), /^Eine Fairness-Regel je Gerät, keine Sperre/);
  assert.doesNotMatch(t("agent.gratisRegel") + t("agent.gratisHeute"), /garantiert|immer gratis|unbegrenzt/);
  setLang("en");
  assert.match(t("agent.gratisRegel"), /^A fairness rule per device, not a lock/);
  setLang("de");
});

test("C-49c: als Chip kurz, der ganze Satz samt Regel im Tooltip und für Vorleser", () => {
  setLang("de");
  assert.equal(t("agent.gratisChip", { antworten: 14, max: 20 }), "14/20 gratis");
  assert.equal(t("agent.gratisChipLeer"), "Gratis aufgebraucht");
  const zeige = start.slice(start.indexOf("export function zeigeGratisStand"), start.indexOf("\n}\n", start.indexOf("export function zeigeGratisStand")));
  assert.match(zeige, /ziel\.title = `\$\{satz\}\. \$\{t\("agent\.gratisRegel"\)\}`;/);
  assert.match(zeige, /ziel\.setAttribute\("aria-label", satz\);/);
  const html = quelle("../src/shell/index.html");
  const pille = html.slice(html.indexOf('<div class="pille-leiste">'), html.indexOf('<div class="composer-meta">'));
  assert.match(pille, /id="ai-gratis"/, "in der Eingabe, nicht mehr darunter");
});

test("„gratis“ in der Modellwahl nur, wo gratisAnbieter() den Provider nennt", () => {
  const wahl = quelle("../src/shell/tabs/modellwahl.ts");
  assert.match(wahl, /const gratis = new Set\(gratisAnbieter\(providers, MAX_POW_APP\)\.map\(\(p\) => p\.caps\.pubkey\)\);/);
  assert.match(wahl, /if \(gratis\.has\(p\.caps\.pubkey\)\) cur\.gratis \+= 1;/);
  assert.match(wahl, /if \(info\.gratis\) \{\n\s+const marke = el\("span", t\("agent\.mcGratis"\), "mc-gratis"\);/);
  // Seit C-49c ein Chip in der Eingabe statt einer Zeile darunter
  assert.match(quelle("../src/shell/index.html"), /<span id="ai-gratis" class="gratis-chip" hidden><\/span>/);
});
