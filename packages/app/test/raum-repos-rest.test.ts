/**
 * Raum-Repos, Rest aus 11.4c (Schritt C-15, Sammlung C-15): „Zum Raum“ in
 * einen öffentlichen Raum, dem man nicht beigetreten ist, bietet dort
 * „Diesem Raum beitreten“; „Wo“ beim Ankündigen bietet auch öffentliche Räume
 * mit `repos_pflegen`; beim Start lädt die Repo-Liste nicht mehr (vorher
 * zweimal, wenn der erste Raum öffentlich war).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("C-15: „Diesem Raum beitreten“ nur in offenen Räumen, denen man nicht beigetreten ist", () => {
  const html = quelle("../src/shell/index.html");
  assert.match(html, /<button id="space-hier-beitreten" class="ghost hidden" type="button" data-i18n="raum\.hierBeitreten">/);
  const raeume = quelle("../src/shell/tabs/raeume.ts");
  // Beigetreten: dieselbe Adresse oder eine bloße Kennung von vor B-7
  assert.match(raeume, /return oeffentlicheRaeume\(\)\.some\(\(e\) => e === spaceId \|\| \(!istAdresse\(e\) && kennungVon\(e\) === k\)\);/);
  assert.match(raeume, /document\.getElementById\("space-hier-beitreten"\)\?\.classList\.toggle\("hidden", privat \|\| beigetreten\(spaceId\)\);/);
  // Beitreten über denselben Weg wie das Menü (B-7), dann Leiste und Knopf neu
  assert.match(raeume, /if \(!id \|\| istPrivat\(id\) \|\| !raumBeitreten\(id\)\) return;\s*zeigeRaumArt\(id\);\s*void zeigeRaumLeiste\(\);/);
  setLang("de");
  assert.equal(t("raum.hierBeitreten"), "Diesem Raum beitreten");
  setLang("en");
});

test("C-15: „Wo“ bietet auch öffentliche Räume mit repos_pflegen – die Adresse wird zum Verweis", () => {
  const repos = quelle("../src/shell/tabs/repos.ts");
  const an = repos.slice(repos.indexOf("async function kuendigeAn("), repos.indexOf("export function wireNip34("));
  assert.match(an, /const oeffentlich = imRaum \? \[\] : await meineRepoRaeume\(\)\.catch\(\(\) => \[\]\);/);
  assert.match(an, /\.\.\.oeffentlich\.map\(\(r\) => \(\{ wert: OEFFENTLICH \+ r\.adresse, text: t\("repo\.oeffentlicherRaum", \{ name: r\.name \}\) \}\)\)/);
  assert.match(an, /const raum = imRaum && "adresse" in imRaum \? imRaum\.adresse : gewaehlt\?\.adresse;/);
  assert.match(an, /raum: imRaum\?\.name \?\? gewaehlt\?\.name \?\? ""/, "die Rückfrage nennt den Raum");
  // meineRepoRaeume() wählt nur beigetretene Räume, in denen ich das Recht habe (raumAuswahl, 11.4a)
  assert.match(repos, /return raumAuswahl\(await raumStruktur\(kennungen\), state\.keypair\.pk\)/);
});

test("C-15: beim Start lädt die Repo-Liste nicht – erst die Seite Repos oder ein Raum", () => {
  const repos = quelle("../src/shell/tabs/repos.ts");
  assert.doesNotMatch(repos.slice(repos.indexOf("export function wireNip34(")), /ladeNip34Repos\(/);
  assert.match(repos, /export function merkeRaumAdresse\(adresse: string\): void \{\s*if \(raumAdressen\.has\(adresse\)\) return;\s*raumAdressen\.add\(adresse\);\s*void ladeNip34Repos\(\);/);
  assert.match(quelle("../src/shell/app.ts"), /if \(name === "repos"\) void import\("\.\/tabs\/repos\.js"\)\.then\(\(m\) => m\.ladeNip34Repos\(\{ privat: true \}\)\);/);
  assert.match(quelle("../../../scripts/smoke_test.py"), /erg\[groesse\]\["beitreten"\] = \{"schon": schon, "nicht": nicht_beigetreten, "wieder": wieder\}/);
});
