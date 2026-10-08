/**
 * Schritt B-22 (MENSCH 08.10.): Wer einem öffentlichen Raum beitritt, schreibt
 * in den Kanälen, die das erlauben – wie „@everyone“ bei Discord. Neue offene
 * Räume bekommen die Rolle für alle (`JEDER_ROLLE`); der Gründer schaltet sie im
 * Raum-Menü um. Beschränkte Kanäle (#ankündigungen) und Verwaltungsrechte
 * bleiben bei Rollen mit Rang.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  JEDER_RECHTE, JEDER_ROLLE, baueRaumKanal, buildRoles, buildSpace, can, canWriteTo, generateKeypair, raumAdresse,
  raumZustandFuer, signEvent, type Channel, type Role,
} from "@freedomstack/protocol";
import { setLang, t } from "../src/i18n.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const html = quelle("../src/shell/index.html");

const T = 1_800_000_000;
const GRUENDER = generateKeypair(), BEIGETRETEN = generateKeypair();
const KENNUNG = "kiel-makers-ab12cd";
const adresse = raumAdresse(GRUENDER.pk, KENNUNG);
const kanaele: Channel[] = [
  { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 },
  { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 1 },
];
const mod: Role = { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben", "repos_pflegen", "kanaele_verwalten"] };
const mitglied: Role = { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben", "threads"] };
const jeder: Role = { id: JEDER_ROLLE, name: "Jeder", rank: 0, permissions: [...JEDER_RECHTE] };
const raum = signEvent(buildSpace({ spaceId: KENNUNG, name: "Kiel Makers", ownerPubkey: GRUENDER.pk, channels: kanaele }, T), GRUENDER.sk);
const rollen = (liste: Role[], at: number) => signEvent(buildRoles(KENNUNG, GRUENDER.pk, liste, at), GRUENDER.sk);

test("B-22: neuer offener Raum – Beigetretene schreiben in #allgemein, nicht in #ankündigungen", () => {
  const st = raumZustandFuer(adresse, [raum, rollen([mod, mitglied, jeder], T + 1)], T + 100)!;
  const [allgemein, ank] = st.space!.channels;
  assert.equal(canWriteTo(BEIGETRETEN.pk, allgemein!, st), true);
  assert.equal(canWriteTo(BEIGETRETEN.pk, ank!, st), false);
  // Verwalten bleibt bei Rollen: ein Kanal-Event des Beigetretenen zählt nicht
  assert.equal(can(BEIGETRETEN.pk, "kanaele_verwalten", st), false);
  const fremderKanal = signEvent(baueRaumKanal(BEIGETRETEN.pk, adresse, { id: "spam", name: "spam", privacy: "offen", writeRoles: [], position: 9 }, T + 50), BEIGETRETEN.sk);
  const mitKanal = raumZustandFuer(adresse, [raum, rollen([mod, mitglied, jeder], T + 1), fremderKanal], T + 100)!;
  assert.deepEqual(mitKanal.space!.channels.map((c) => c.id), ["allgemein", "ankuendigungen"]);
});

test("B-22: zurückgeschaltet (neuere Rollenliste ohne „jeder“) – wieder nur mit Rolle; ältere Räume ohne „jeder“ bleiben zu", () => {
  const zu = raumZustandFuer(adresse, [raum, rollen([mod, mitglied, jeder], T + 1), rollen([mod, mitglied], T + 2)], T + 100)!;
  assert.equal(canWriteTo(BEIGETRETEN.pk, zu.space!.channels[0]!, zu), false);
  const alt = raumZustandFuer(adresse, [raum, rollen([mod, mitglied], T + 1)], T + 100)!;
  assert.equal(canWriteTo(BEIGETRETEN.pk, alt.space!.channels[0]!, alt), false);
  // Eine Rollenliste mit „jeder“ von jemand anderem öffnet nichts
  const fremd = signEvent(buildRoles(KENNUNG, BEIGETRETEN.pk, [jeder], T + 3), BEIGETRETEN.sk);
  const st = raumZustandFuer(adresse, [raum, rollen([mod, mitglied], T + 1), fremd], T + 100)!;
  assert.equal(canWriteTo(BEIGETRETEN.pk, st.space!.channels[0]!, st), false);
});

test("B-22 verdrahtet: Anlegen mit der Rolle für alle, Menüpunkt nur für den Gründer, Umschalten behält die übrigen Rollen", () => {
  const anlegen = raeume.slice(raeume.indexOf("await pool.publish(await signiere(buildRoles(spaceId, state.keypair.pk, ["), raeume.indexOf("// Gemerkt und weitergegeben wird die Adresse (B-7)"));
  assert.match(anlegen, /\{ id: JEDER_ROLLE, name: "Jeder", rank: 0, permissions: \[\.\.\.JEDER_RECHTE\] \}, \/\/ kein UI-Text/);
  assert.match(html, /<button id="space-schreiben" class="menue-punkt hidden" role="menuitem" type="button" data-i18n="raum\.schreibenAlle">/);
  const art = raeume.slice(raeume.indexOf("function zeigeRaumArt"), raeume.indexOf("/** Wohin Repos dieses Raums gehören"));
  assert.match(art, /getElementById\("space-schreiben"\)\?\.classList\.toggle\("hidden", privat \|\| !gruender\);/);
  const schalter = raeume.slice(raeume.indexOf("async function stelleSchreibrechtEin"), raeume.indexOf("export async function wireSpacesTab"));
  assert.match(schalter, /if \(!kennung \|\| !raumSt\?\.space \|\| raumSt\.ownerPubkey !== state\.keypair\.pk\) return;/, "nur der Gründer");
  assert.match(schalter, /const rollen = \[\.\.\.raumSt\.roles\.values\(\)\]\.filter\(\(r\) => r\.id !== JEDER_ROLLE\);/, "übrige Rollen bleiben");
  assert.match(schalter, /buildRoles\(kennung, state\.keypair\.pk, rollen\)/);
  assert.doesNotMatch(schalter, /buildRoleGrant/, "keine Zuweisungen – die Rolle gilt für alle");
  assert.match(raeume, /schreiben\.onclick = \(\) => void stelleSchreibrechtEin\(\);/);
  // Moderatoren ernennen veröffentlicht die Rollenliste neu – die Rolle für alle bleibt darin
  assert.match(raeume, /buildRoles\(kennung, ich, \[mod, \.\.\.\[\.\.\.raumSt\.roles\.values\(\)\]\.filter\(\(r\) => r\.id !== MOD_ROLLE\)\]\)/);
});

test("B-22 Texte: Hinweis sagt, wie man schreiben darf; Warnung beim Anlegen nennt das Mitschreiben", () => {
  const hinweis = raeume.slice(raeume.indexOf("// Schreibrecht: Wer nicht darf"), raeume.indexOf("merkeLesestand(channelId);"));
  assert.match(hinweis, /const nurMitRolle = !spacesUi\.privat && \(kanal as Channel\)\.writeRoles\.length === 0 && !\(st as SpaceState\)\.roles\?\.has\(JEDER_ROLLE\);/);
  assert.match(hinweis, /t\(nurMitRolle \? "raum\.nurMitRolle" : "komm\.nurRollen"\)/);
  setLang("de");
  try {
    assert.match(t("raum.nurMitRolle"), /kann ihn für alle öffnen/);
    assert.match(t("komm.oeffentlichWarnung"), /Wer beitritt, schreibt in #allgemein mit/);
    assert.match(t("raum.schreibenText"), /#ankündigungen bleibt bei den Moderatoren/);
  } finally {
    setLang("en");
  }
  assert.match(t("raum.schreibenText"), /#ankündigungen stays with the moderators/, "Kanalnamen sind Daten – auch auf Englisch");
});
