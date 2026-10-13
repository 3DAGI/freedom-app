/**
 * Schritt C-35 (Nutzertest R-1, R-3, R-4, R-7): Kleinigkeiten in Räumen. Im Browser prüfen der
 * Smoke-Test „privatraum“ (Einladung mit Name und Absender) und „raum“ (Kanalkopf am Handy).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang, t } from "../src/i18n.js";

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const css = quelle("../src/shell/app.css");

test("Einladung: Name aus der Gruppe und Absender gleich in der Leiste – bis der Raum einmal offen war", () => {
  assert.match(quelle("../src/shell/mls-konto.ts"), /const name = mls\.name\(gruppe\)\.trim\(\);\n\s+if \(name\) return \{ gruppe, partner: null, name \};/);
  assert.match(quelle("../src/shell/tabs/posteingang.ts"), /merkeEinladung\(r\.gruppe, r\.name \?\? "", e\.von\);/);
  // Die Leiste führt private Räume unter „mls:<Gruppe>“ – mit der bloßen Gruppe fände sie nichts
  assert.match(raeume, /if \(name\) privatNamen\.set\(PRIVAT \+ gruppe, name\);\n\s+eingeladenVon\.set\(PRIVAT \+ gruppe, von\);/);
  assert.match(raeume, /b\.title = von \? t\("komm\.raumEingeladen", \{ raum: name, name: kontaktName\(von\) \}\) : name;/);
  assert.match(raeume, /privatNamen\.set\(spaceId, raum\.zustand\.space\.name\);\n\s+eingeladenVon\.delete\(spaceId\);/, "geöffnet: kein Hinweis mehr");
  setLang("de");
  assert.equal(t("komm.raumEingeladen", { raum: "Werkstatt", name: "~Ada" }), "Werkstatt – Einladung von ~Ada");
  assert.equal(t("komm.einladungRaum", { raum: "Werkstatt", name: "~Ada" }), "Einladung in „Werkstatt“ von ~Ada – in der Raumleiste");
});

test("Umfrage: „Du“ statt des eigenen Schlüssels, Antworten wie geschrieben, Balken erst nach der eigenen Stimme", () => {
  assert.match(raeume, /zeigePlanung\(planung, spacesUi\.privat, channelId, nameVon, /);
  const ui = quelle("../src/shell/raum-planung-ui.ts");
  assert.match(ui, /const ergebnis = !!u\.meine\?\.length \|\| u\.beendet;/);
  assert.match(ui, /balken\.style\.width = `\$\{ergebnis \? prozent\[i\] : 0\}%`;/);
  assert.match(css, /\.planung-option, \.planung-antwort \{ text-transform: none; letter-spacing: normal; font-weight: 400; \}/);
});

test("Mitglieder: ganze Namen umgebrochen; Profilnamen nur in offenen Räumen", () => {
  assert.match(css, /\.member-row \.mitglied-name \{ flex: 1; min-width: 0; overflow-wrap: anywhere; \}/);
  assert.doesNotMatch(css, /\.mitglied-name \{[^}]*text-overflow: ellipsis/);
  // Privat nennte die Abfrage den Relays, wer zur Gruppe gehört
  assert.match(raeume, /if \(!privat\) void ladeFremdeProfilNamen\(zeilen\.map\(\(m\) => m\.pk\)\)\.then\(\(neu\) => \{ if \(neu\) void zeigeMitglieder\(\); \}\);/);
  const kontakte = quelle("../src/shell/tabs/kontakte.ts");
  assert.match(kontakte, /for \(const pk of fehlt\) fremdeProfile\.set\(pk, null\);/, "je Schlüssel nur einmal gefragt – kein Neuzeichnen ohne Ende");
  assert.match(raeume, /return profil \? `~\$\{profil\}` : pkShort\(pk\);/);
});

test("Kanalkopf am Handy: die Art des Kanals in eigener Zeile", () => {
  assert.match(css, /@media \(max-width: 1023px\) \{\n  \.channel-head \{ flex-wrap: wrap; row-gap: 2px; \}\n  #channel-privacy \{ order: 10; flex-basis: 100%; \}\n\}/);
});
