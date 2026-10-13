/**
 * Schritt E10b1: Kopfgelder am Issue – zeigen, aussetzen, Stand setzen. Im Browser prüft es der
 * Smoke-Test „kopfgeld“ (Repo, Issue und fremdes Kopfgeld aus `scripts/kopfgeld-probe.mts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";
import { kopfgeldBetrag } from "../src/shell/tabs/kopfgeld-ui.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const ui = quelle("../src/shell/tabs/kopfgeld-ui.ts");

test("Betrag nur in den zugesagten Währungen – nichts umgerechnet", () => {
  setLang("de");
  assert.equal(kopfgeldBetrag({ msat: 21_000 }), "21 sats");
  assert.equal(kopfgeldBetrag({ lamports: 50_000_000 }), "0,05 SOL");
  assert.equal(kopfgeldBetrag({ msat: 500_000, lamports: 10_000_000 }), "500 sats + 0,01 SOL");
});

test("der Stand nur aus kopfgelderZuIssue(), gesetzt nur vom Geldgeber über signiere()", () => {
  assert.match(ui, /\.query\(\{ kinds: \[KIND_KOPFGELD\], "#e": \[z\.issue\.id\], limit: 200 \}\)/);
  assert.match(ui, /const kopfgelder = kopfgelderZuIssue\(events, z\.issue\.id\);/);
  assert.match(ui, /if \(state\.keypair\?\.pk === kg\.geldgeber\) \{/, "Knöpfe nur für den Geldgeber");
  assert.match(ui, /await \(await ensurePool\(\)\)\.publish\(await signiere\(baueKopfgeld\(k\)\)\);/);
  // Vergeben nur an Beteiligte, nie an sich selbst
  assert.match(ui, /\.filter\(\(pk\) => pk !== kg\.geldgeber\)/);
  assert.doesNotMatch(ui, /innerHTML/);
});

test("nur an öffentlichen Issues – nicht im privaten Raum, nicht für Repos nur auf diesem Gerät", () => {
  const issues = quelle("../src/shell/tabs/issues-reiter.ts");
  assert.match(issues, /if \(k\.repo && !k\.privatRaum && !k\.lokal\) teile\.push\(kopfgeldKarte\(z, k, name\)\);/);
  setLang("de");
  // Ehrlich: zugesagt und selbst gezahlt, nichts verwahrt, nichts von selbst
  assert.match(t("kopf.hinweis"), /^Öffentlich und mit deinem Schlüssel signiert\. /);
  assert.match(t("kopf.hinweis"), /niemand verwahrt etwas, und nichts wird von selbst gezahlt/);
  assert.doesNotMatch(t("kopf.erledigt"), /bezahl/i, "bezahlt wird erst mit E10b2 per Klick");
  setLang("en");
  assert.equal(t("kopf.titel"), "Bounties");
});
