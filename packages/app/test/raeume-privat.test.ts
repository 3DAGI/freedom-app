/**
 * Schritt 2.3b: private Räume in der App – Liste nur im Tresor, Einladung in
 * eine Gruppe zu mehreren wird ein Raum, der Raumstand geht nach jeder
 * Einladung erneut hinaus, offene Räume tragen den Hinweis sichtbar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const kom = quelle("../src/shell/tabs/kommunikation.ts");
const raum = quelle("../src/shell/raum-mls.ts");
const html = quelle("../src/shell/index.html");

test("2.3b: Liste privater Räume nur im Tresor – nie in freedom.spaces (localStorage)", () => {
  assert.match(quelle("../src/shell/tresor.ts"), /const GEHEIM_FEST = \[[^\]]*"freedom\.raeume\.privat"/);
  assert.match(raum, /await geheim\.setItem\(LS_PRIVATE_RAEUME, /);
  assert.doesNotMatch(raum, /localStorage/);
  // raumBeitreten schreibt nur offene Räume zurück – sonst landeten private im Klartext
  assert.match(kom, /function raumBeitreten\(id: string\): void \{\s*const alle = new Set\(oeffentlicheRaeume\(\)\);/);
});

test("2.3b: Einladung in eine Gruppe zu mehreren wird ein privater Raum; nach dem Einladen geht der Raumstand erneut hinaus", () => {
  assert.match(kom, /if \(!r\.partner\) \{\s*\/\/ Eine Gruppe zu mehreren: ein privater Raum \(2\.3b\)\s*await merkePrivatenRaum\(r\.gruppe\);/);
  const einladen = raum.slice(raum.indexOf("export async function ladeInPrivatenRaum"));
  assert.match(einladen, /const r = await mlsLadeEin\(raum\.gruppe, pk\);\s*if \(r !== "eingeladen"\) return r;/);
  assert.match(einladen, /raumDefinition\(raum\.gruppe, /);
  assert.match(einladen, /raumRollen\(raum\.gruppe, rollen\)/);
  assert.match(einladen, /raumZuweisung\(raum\.gruppe, wer, eigene\)/);
});

test("2.3b: Moderatoren privater Räume nur per Commit (mlsSetzeAdmins) – nie ein öffentliches Moderatoren-Event", () => {
  const mods = kom.slice(kom.indexOf("async function ernenneModeratoren"), kom.indexOf("export async function wireSpacesTab"));
  const privat = mods.slice(0, mods.indexOf("const st = spacesUi.state"));
  assert.match(privat, /if \(await setzeModeratoren\(raum, mods\)\)/);
  assert.doesNotMatch(privat, /buildModeratorList|signiere\(/);
  assert.match(raum, /return mlsSetzeAdmins\(raum\.gruppe, neu\);/);
});

test("2.3b: offener Raum trägt den Hinweis sichtbar; Raumnamen nur als textContent", () => {
  assert.match(html, /id="space-oeffentlich" class="mono-sm warn hidden" data-i18n="komm\.oeffentlichHinweis">Öffentlicher Raum – jeder kann mitlesen/);
  assert.match(kom, /document\.getElementById\("space-oeffentlich"\)\?\.classList\.toggle\("hidden", privat\);/);
  assert.match(html, /id="space-create"[^>]*>Raum anlegen \(privat\)</);
  assert.match(kom, /b\.textContent = istPrivat\(id\) \?/);
});

test("2.3c/8.5: Moderation privater Räume nur über MLS – löschen, entfernen; nie öffentliche Ausblend- oder Sperr-Events", () => {
  const aktion = kom.slice(kom.indexOf("async function raumAktion"), kom.indexOf("/** Meldungen zum offenen Raum"));
  assert.match(aktion, /ok = await loescheImRaum\(raum, id\);/);
  assert.match(aktion, /ok = await entferneAusRaum\(raum, autor\);/);
  assert.match(aktion, /await meldeImRaum\(raum, id, autor, grund as MeldeGrund, notiz\)/);
  assert.doesNotMatch(aktion, /buildHide|buildBan|signiere\(|pool\.publish/);
  assert.match(raum, /return mlsSendeEvent\(raum\.gruppe, raumLoeschung\(id, raum\.admins\.includes\(raum\.ich\)\)\);/);
  assert.match(raum, /return mlsEntferne\(raum\.gruppe, pk\);/);
  // Der alte Moderationsknopf erscheint in privaten Räumen weiter nicht
  assert.match(kom, /const modKnopf = darfModerieren && !spacesUi\.privat && /);
});

test("8.5: Meldungen versiegelt nur an die Moderatoren, an ihren Posteingang; beim Moderator nur im Speicher", () => {
  const melden = raum.slice(raum.indexOf("export async function meldeImRaum"), raum.indexOf("/** Erledigte Meldungen"));
  assert.match(melden, /await baueRaumMeldung\(\{ von: state\.signer, moderatoren: raum\.admins, /);
  assert.match(melden, /const ziele = await posteingangVon\(an\)/);
  assert.match(melden, /await veroeffentlicheAn\(w, ziele\)/);
  assert.doesNotMatch(melden, /mlsSendeEvent|sendenEvent/, "nie in die Gruppe – die anderen Mitglieder erführen es");
  assert.match(kom, /\?\? \(await alsPruefauftrag\(w\)\) \?\? \(await alsRaumMeldung\(w\)\);/);
  assert.match(raum, /const offeneMeldungen = new Map<string, RaumMeldung>\(\);/);
  assert.match(raum, /if \(!raum\.admins\.includes\(raum\.ich\)\) return \[\];/, "nur Moderatoren sehen Meldungen");
  assert.match(raum, /await geheim\.setItem\(LS_MELDUNGEN_ERLEDIGT, /);
  assert.match(quelle("../src/shell/tresor.ts"), /const GEHEIM_FEST = \[[^\]]*"freedom\.raeume\.meldungen\.erledigt"/);
});
