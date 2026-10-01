/**
 * Schritt C.2d2: Kanal anlegen – privat als Definition in die Gruppe (nur
 * Moderatoren), offen seit B-20b als Kanal-Event (34703) von jedem mit
 * „kanaele_verwalten“; Menüpunkte nach Rechten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  type Channel, type InneresEvent, type InneresSenden, baueRaumKanal, buildRoleGrant, buildRoles, buildSpace, can, generateKeypair,
  gruppenRaum, raumAdresse, raumDefinition, raumZustandFuer, signEvent,
} from "@freedomstack/protocol";
import { kanalKennung } from "../src/raum-verlauf.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const raumMls = quelle("../src/shell/raum-mls.ts");
const html = quelle("../src/shell/index.html");

test("C.2d2: Kennung eines Kanals – aus dem Namen, kurz, eindeutig, ohne Sonderzeichen", () => {
  assert.equal(kanalKennung("Technik & Co", []), "technik-co");
  assert.equal(kanalKennung("Ankündigungen", []), "ankuendigungen");
  assert.equal(kanalKennung("  Große Straße  ", []), "grosse-strasse");
  assert.equal(kanalKennung("🎉🎉", []), "kanal", "ohne Buchstaben");
  assert.equal(kanalKennung("allgemein", ["allgemein", "allgemein-2"]), "allgemein-3");
  const lang = kanalKennung("ein sehr langer Name für einen Kanal", []);
  assert.ok(lang.length <= 24 && !lang.endsWith("-"), lang);
  for (const boese of ['"><img src=x>', "../../etc", "a\u0000b", "<script>"]) assert.match(kanalKennung(boese, []), /^[a-z0-9-]+$/);
});

test("B-20b: offen – ein Kanal-Event an die Adresse; legt an, wer „kanaele_verwalten“ hat, nicht nur der Gründer", () => {
  const [ich, mod, mitglied] = [generateKeypair(), generateKeypair(), generateKeypair()];
  const alt: Channel[] = [{ id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 }];
  const T = 1_790_000_000;
  const adresse = raumAdresse(ich.pk, "werkstatt");
  // wie legeRaumAn() in raeume.ts: Moderatoren verwalten Kanäle
  const rechte = raeume.slice(raeume.indexOf("const MOD_RECHTE"), raeume.indexOf("interface SpaceUiState"));
  assert.match(rechte, /"kanaele_verwalten"/);
  const raum = [
    signEvent(buildSpace({ spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: ich.pk, channels: alt }, T), ich.sk),
    signEvent(buildRoles("werkstatt", ich.pk, [
      { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "moderieren", "kanaele_verwalten"] },
      { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben"] },
    ], T), ich.sk),
    signEvent(buildRoleGrant("werkstatt", ich.pk, mod.pk, ["mod"], T + 1), ich.sk),
    signEvent(buildRoleGrant("werkstatt", ich.pk, mitglied.pk, ["mitglied"], T + 1), ich.sk),
  ];
  const vorher = raumZustandFuer(adresse, raum, T + 100)!;
  assert.ok(can(mod.pk, "kanaele_verwalten", vorher) && !can(mitglied.pk, "kanaele_verwalten", vorher));
  // wie legeKanalAn() in raeume.ts
  const kanal: Channel = { id: kanalKennung("Technik", alt.map((c) => c.id)), name: "Technik", privacy: "offen", writeRoles: ["mod"], position: 1 };
  const vomMod = signEvent(baueRaumKanal(mod.pk, adresse, kanal, T + 5), mod.sk);
  const vomMitglied = signEvent(baueRaumKanal(mitglied.pk, adresse, { ...kanal, id: "spam", name: "spam", writeRoles: [] }, T + 6), mitglied.sk);
  const st = raumZustandFuer(adresse, [...raum, vomMod, vomMitglied], T + 100)!;
  assert.deepEqual(st.space?.channels.map((c) => [c.id, c.writeRoles]), [["allgemein", []], ["technik", ["mod"]]]);
  const anlegen = raeume.slice(raeume.indexOf("async function legeKanalAn"), raeume.indexOf("/** Kanäle mit Ungelesenem."));
  assert.match(anlegen, /else if \(ziel && "adresse" in ziel && darf\(state\.keypair\.pk, "kanaele_verwalten", st\)\) \{/, "offen mit dem Recht");
  assert.match(anlegen, /publish\(await signiere\(baueRaumKanal\(state\.keypair\.pk, ziel\.adresse, kanal\)\)\)/, "ein Kanal-Event, keine neue Definition");
  assert.doesNotMatch(anlegen, /buildSpace\(/);
  assert.match(anlegen, /privacy: raum \? "verschluesselt" : "offen",/);
  assert.match(anlegen, /position: Math\.max\(-1, \.\.\.space\.channels\.map\(\(c\) => c\.position\)\) \+ 1,/, "hinter dem letzten Kanal");
  // Die Abfrage des Raums holt die Kanal-Events mit
  assert.match(raeume, /kinds: \[KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_RAUM_KANAL\], "#space": \[kennung\]/);
});

test("C.2d2: privat – die Definition mit dem neuen Kanal geht in die Gruppe, gilt nur von Moderatoren", () => {
  const RAUM = "d".repeat(64);
  const [ADMIN, ANNA] = ["1", "3"].map((c) => c.repeat(64)) as [string, string];
  const alt: Channel[] = [{ id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 }];
  const kanal: Channel = { id: "technik", name: "Technik", privacy: "verschluesselt", writeRoles: [], position: 1 };
  let n = 0;
  const ev = (von: string, s: InneresSenden): InneresEvent =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: s.art, tags: s.tags, text: s.text, zeit: 1000 + n });
  const basis = ev(ADMIN, raumDefinition(RAUM, { name: "Werkstatt", kanaele: alt }));
  // wie legePrivatenKanalAn() in raum-mls.ts
  const vomAdmin = ev(ADMIN, raumDefinition(RAUM, { name: "Werkstatt", kanaele: [...alt, kanal] }));
  const r = gruppenRaum(RAUM, [basis, vomAdmin], { admins: [ADMIN], mitglieder: [ADMIN, ANNA] });
  assert.deepEqual(r.zustand.space?.channels.map((c) => c.id), ["allgemein", "technik"]);
  const vonAnna = ev(ANNA, raumDefinition(RAUM, { name: "Werkstatt", kanaele: [...alt, { ...kanal, id: "fremd" }] }));
  const r2 = gruppenRaum(RAUM, [basis, vonAnna], { admins: [ADMIN], mitglieder: [ADMIN, ANNA] });
  assert.deepEqual(r2.zustand.space?.channels.map((c) => c.id), ["allgemein"], "von einem Mitglied verworfen");
  const privat = raumMls.slice(raumMls.indexOf("export function legePrivatenKanalAn"), raumMls.indexOf("/** Moderatoren ernennen"));
  assert.match(privat, /if \(!sp \|\| !raum\.admins\.includes\(raum\.ich\)\) return Promise\.resolve\(false\);/);
  assert.match(privat, /mlsSendeEvent\(raum\.gruppe, raumDefinition\(raum\.gruppe, \{ name: sp\.name, beschreibung: sp\.description, kanaele: \[\.\.\.sp\.channels, kanal\] \}\)\)/);
});

test("C.2d2: Menüpunkte nach Rechten; ein Raumwechsel zeigt nie Rechte des vorigen Raums", () => {
  assert.match(html, /<button id="space-kanal-neu" class="menue-punkt hidden" role="menuitem" type="button" data-i18n="raum\.kanalAnlegen">/);
  assert.match(html, /<button id="space-mods" class="menue-punkt hidden" role="menuitem"/);
  const art = raeume.slice(raeume.indexOf("function zeigeRaumArt"), raeume.indexOf("/** Kanal anlegen (C.2d2)"));
  assert.match(art, /const verwalten = privat \? moderator : gruender;/);
  assert.match(art, /const kanaele = privat \? moderator : darfKanaele\(\);/, "offen: Kanäle mit dem Recht (B-20b)");
  assert.match(art, /getElementById\("space-mods"\)\?\.classList\.toggle\("hidden", !verwalten\);/);
  assert.match(art, /getElementById\("space-kanal-neu"\)\?\.classList\.toggle\("hidden", !kanaele\);/);
  assert.match(raeume, /function darfKanaele\(\): boolean \{[^}]*darf\(state\.keypair\.pk, "kanaele_verwalten", st\);/);
  const wechsel = raeume.slice(raeume.indexOf("async function oeffneRaum"), raeume.indexOf("spacesUi.spaceId = spaceId;"));
  assert.match(wechsel, /spacesUi\.state = null;\s*spacesUi\.privat = null;\s*spacesUi\.messages = \[\];/);
});

test("B-20b: Moderatoren offener Räume über die Rolle „mod“ – nie mehr die Liste 34550, die dort nicht zählt", () => {
  const mods = raeume.slice(raeume.indexOf("async function ernenneModeratoren"), raeume.indexOf("export async function wireSpacesTab"));
  const offen = mods.slice(mods.indexOf("const st = spacesUi.state"));
  assert.doesNotMatch(offen, /buildModeratorList|regeln/, "keine Moderatorenliste, keine Regeln, die niemand sieht");
  assert.match(offen, /if \(st\?\.ownerPubkey !== state\.keypair\.pk\) \{\s*toast\(t\("komm\.nurGruender"\), true\);/, "nur der Gründer");
  // Schlüssel als npub oder Hex, sonst meldet sich der Dialog
  assert.match(offen, /pruefe: \(w\) => \(eintraege\(w\)\.every\(\(x\) => schluesselAusEingabe\(x, decodeNpub\)\) \? null : t\("komm\.keinSchluessel"\)\),/);
  // Erst die Rolle mit allen Rechten (ältere Räume), dann die Zuweisungen; Abgesetzte verlieren nur „mod“
  assert.match(offen, /if \(!rolle \|\| MOD_RECHTE\.some\(\(p\) => !rolle\.permissions\.includes\(p\)\)\) \{/);
  assert.ok(offen.indexOf("buildRoles(kennung, ich,") < offen.indexOf("buildRoleGrant(kennung, ich, pk,"));
  assert.match(offen, /buildRoleGrant\(kennung, ich, pk, \[\.\.\.\(raumSt\.grants\.get\(pk\) \?\? \[\]\), MOD_ROLLE\]\)/);
  assert.match(offen, /buildRoleGrant\(kennung, ich, pk, \(raumSt\.grants\.get\(pk\) \?\? \[\]\)\.filter\(\(r\) => r !== MOD_ROLLE\)\)/);

  // So gebaut, zählt es: der Ernannte moderiert und verwaltet Kanäle, der Abgesetzte nicht mehr
  const [ich, anna, bo] = [generateKeypair(), generateKeypair(), generateKeypair()];
  const T = 1_790_000_000;
  const adresse = raumAdresse(ich.pk, "werkstatt");
  const altRolle = { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "moderieren"] as ("lesen" | "schreiben" | "moderieren")[] };
  const raum = [
    signEvent(buildSpace({ spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: ich.pk, channels: [] }, T), ich.sk),
    signEvent(buildRoles("werkstatt", ich.pk, [altRolle], T), ich.sk),
    signEvent(buildRoleGrant("werkstatt", ich.pk, bo.pk, ["mod"], T), ich.sk),
  ];
  const vorher = raumZustandFuer(adresse, raum, T + 100)!;
  assert.ok(!can(bo.pk, "kanaele_verwalten", vorher), "ältere Rolle ohne Kanäle");
  const MOD_RECHTE = ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben", "repos_pflegen", "kanaele_verwalten"] as const;
  const neu = [
    signEvent(buildRoles("werkstatt", ich.pk, [{ ...altRolle, permissions: [...new Set([...altRolle.permissions, ...MOD_RECHTE])] }], T + 10), ich.sk),
    signEvent(buildRoleGrant("werkstatt", ich.pk, anna.pk, ["mod"], T + 10), ich.sk),
    signEvent(buildRoleGrant("werkstatt", ich.pk, bo.pk, [], T + 10), ich.sk),
  ];
  const nachher = raumZustandFuer(adresse, [...raum, ...neu], T + 100)!;
  assert.ok(can(anna.pk, "moderieren", nachher) && can(anna.pk, "kanaele_verwalten", nachher));
  assert.ok(!can(bo.pk, "moderieren", nachher), "abgesetzt");
});
