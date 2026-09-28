/**
 * Schritt C.2d2: Kanal anlegen – offen als neue Definition des Gründers,
 * privat als Definition in die Gruppe (nur Moderatoren); Menüpunkte nach
 * Rechten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  type Channel, type InneresEvent, type InneresSenden, buildSpace, buildSpaceState, generateKeypair, gruppenRaum,
  raumDefinition, signEvent,
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

test("C.2d2: offen – die neue Definition des Gründers gilt und trägt den Kanal; nur der Gründer legt an", () => {
  const ich = generateKeypair();
  const alt: Channel[] = [{ id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 }];
  const T = 1_790_000_000;
  const erste = signEvent(buildSpace({ spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: ich.pk, channels: alt }, T), ich.sk);
  const kanal: Channel = { id: kanalKennung("Technik", alt.map((c) => c.id)), name: "Technik", privacy: "offen", writeRoles: ["mod"], position: 1 };
  // wie legeKanalAn() in raeume.ts
  const neu = signEvent(buildSpace({ spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: ich.pk, channels: [...alt, kanal] }, T + 5), ich.sk);
  const st = buildSpaceState("werkstatt", [erste, neu]);
  assert.deepEqual(st.space?.channels.map((c) => [c.id, c.writeRoles]), [["allgemein", []], ["technik", ["mod"]]]);
  const anlegen = raeume.slice(raeume.indexOf("async function legeKanalAn"), raeume.indexOf("/** Kanäle mit Ungelesenem."));
  assert.match(anlegen, /else if \(space\.ownerPubkey === state\.keypair\.pk\) \{/, "offen nur als Gründer");
  assert.match(anlegen, /channels: \[\.\.\.space\.channels, kanal\],/, "die alten Kanäle bleiben");
  assert.match(anlegen, /privacy: raum \? "verschluesselt" : "offen",/);
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
  for (const id of ["space-mods", "space-kanal-neu"]) assert.match(art, new RegExp(`getElementById\\("${id}"\\)\\?\\.classList\\.toggle\\("hidden", !verwalten\\);`));
  const wechsel = raeume.slice(raeume.indexOf("async function oeffneRaum"), raeume.indexOf("spacesUi.spaceId = spaceId;"));
  assert.match(wechsel, /spacesUi\.state = null;\s*spacesUi\.privat = null;\s*spacesUi\.messages = \[\];/);
});
