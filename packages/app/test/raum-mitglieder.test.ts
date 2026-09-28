/**
 * Schritt C.2d1: Mitglieder mit Rollen und einem Menü je Mitglied; mobil
 * (bis 1100 px) als eigene Ebene samt Meldungen (B3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const menue = quelle("../src/shell/menue.ts");
const html = quelle("../src/shell/index.html");
const css = quelle("../src/shell/app.css");
const abschnitt = (von: string, bis: string) => raeume.slice(raeume.indexOf(von), raeume.indexOf(bis));

test("C.2d1: Mitgliederliste nur aus DOM und textContent – Namen, Rollen als Marken, Gründer hervorgehoben", () => {
  const liste = abschnitt("async function zeigeMitglieder", "/** Was ich mit einem Mitglied tun darf");
  assert.doesNotMatch(liste, /innerHTML|pkShort|escapeHtml/);
  assert.match(liste, /const name = el\("span", nameVon\(m\.pk\), "mitglied-name"\);/);
  assert.match(liste, /\.\.\.m\.rollen\.map\(\(r\) => el\("span", r, m\.gruender \? "msg-role rolle-gruender" : "msg-role"\)\)/);
  // Privat: Moderatoren sind die Admins der Gruppe und zeigen nur „Moderator“
  assert.match(liste, /const eigene = privat\.admins\.includes\(pk\) \? \[t\("komm\.moderatorRolle"\)\]/);
  // Der Knopf je Mitglied trägt eine Beschriftung mit dem Namen und öffnet ein Menü
  assert.match(liste, /b\.setAttribute\("aria-label", t\("raum\.mitgliedMenue", \{ name: nameVon\(m\.pk\) \}\)\);/);
  assert.match(liste, /oeffneMenueAn\(b, punkte, /);
});

test("C.2d1: Menü je Mitglied nur mit dem, was ich darf – nie für mich selbst, nie für den Gründer, privat nur als Moderator", () => {
  const aktionen = abschnitt("function mitgliedAktionen", "/** Mitglieder als eigene Ebene");
  assert.match(aktionen, /if \(!ich \|\| pk === ich\) return \[\];/);
  assert.match(aktionen, /if \(!raum\.admins\.includes\(raum\.ich\)\) return \[\];/);
  assert.match(aktionen, /if \(gruender\) return \[\];/);
  // Privat über MLS: Moderator per Commit, Entfernen nach Rückfrage – nie offene Sperr-Events
  assert.match(aktionen, /setzeModeratoren\(raum, istMod \? andere : \[\.\.\.andere, pk\]\)/);
  assert.match(aktionen, /await bestaetige\(\{ titel: t\("raum\.ausRaumEntfernen"\), text: t\("raum\.entfernenText", \{ name: nameVon\(pk\) \}\), ok: t\("komm\.entfernen"\), gefahr: true \}\)/);
  assert.match(aktionen, /entferneAusRaum\(raum, pk\)/);
  const privat = aktionen.slice(aktionen.indexOf("if (raum) {"), aktionen.indexOf("if (gruender)"));
  assert.doesNotMatch(privat, /moderiere\(|buildBan|buildHide/);
  // Offen nach meinen Rechten im Raum
  assert.match(aktionen, /if \(can\(ich, "rollen_vergeben", st\)\) punkte\.push\(\{ text: t\("raum\.rolleTitel"\), tun: \(\) => void moderiere\("grant", pk\) \}\);/);
  assert.match(aktionen, /if \(can\(ich, "moderieren", st\)\) punkte\.push\(\{ text: t\("raum\.sperren"\), gefahr: true, tun: \(\) => void moderiere\("ban", pk, pk\) \}\);/);
  // Sperren aus der Liste bietet nur „sperren“ an – ausblenden gehört zu einer Nachricht
  assert.match(raeume, /\.\.\.\(aktion === "hide" \? \[\{ wert: "hide", text: t\("raum\.ausblenden"\) \}\] : \[\]\),/);
});

test("C.2d1: schwebendes Menü – entsteht beim Öffnen, räumt seine Horcher weg, Fokus zurück zum Knopf", () => {
  const schwebend = menue.slice(menue.indexOf("export function oeffneMenueAn"));
  assert.match(schwebend, /offenesMenue\?\.\(\);/, "höchstens eins offen");
  assert.match(schwebend, /b\.textContent = p\.text;/, "Punkte nur als Text");
  assert.match(schwebend, /menue\.remove\(\);\s*document\.removeEventListener\("click", daneben, true\);/);
  assert.match(schwebend, /if \(fokusZumKnopf && knopf\.isConnected\) knopf\.focus\(\);/);
  assert.match(schwebend, /menueTasten\(menue, \(\) => knoepfe, schliesse\);/, "dieselbe Tastatur wie das Raum-Menü");
});

test("C.2d1 (B3): bis 1100 px Mitglieder und Meldungen als Ebene – Knopf im Kanal nennt offene Meldungen", () => {
  assert.match(html, /<button id="kanal-mitglieder" class="ghost mini kanal-mitglieder" type="button" data-i18n="komm\.mitglieder">/);
  assert.match(html, /<button id="mitglieder-zu" class="ghost icon-btn mitglieder-zu" type="button" aria-label="Mitglieder schließen" data-i18n-aria="raum\.mitgliederSchliessen">/);
  // Die Meldungen stehen weiter in der Spalte der Mitglieder – die Ebene macht sie mobil erreichbar
  const spalte = html.slice(html.indexOf('<aside class="member-col">'), html.indexOf("</aside>", html.indexOf('<aside class="member-col">')));
  assert.match(spalte, /id="raum-meldungen"/);
  assert.match(css, /@media \(max-width: 1100px\) \{[^}]*\.kanal-mitglieder, \.mitglieder-zu \{ display: inline-flex; width: auto; \}\s*\.comm-space-inner\.mitglieder-offen \.member-col \{ display: block;/);
  assert.match(raeume, /knopf\.textContent = liste\.length \? t\("raum\.mitgliederMeldungen", \{ n: liste\.length \}\) : t\("komm\.mitglieder"\);/);
  setLang("de");
  assert.equal(t("raum.mitgliederMeldungen", { n: 2 }), "Mitglieder · 2 Meldung(en)");
  setLang("en");
  // Thread und Mitglieder schließen einander aus
  assert.match(raeume, /if \(offen\) document\.querySelector\("\.comm-space-inner"\)\?\.classList\.remove\("mitglieder-offen"\);/);
  assert.match(raeume, /if \(an && spacesUi\.thread\) \{\s*spacesUi\.thread = null;/);
});
