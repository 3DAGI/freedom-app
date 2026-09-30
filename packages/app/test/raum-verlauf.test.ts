/**
 * Schritt C.2b2: Verlauf gruppiert mit Namen, Aktionen an Nachrichten,
 * Raum-Menü; Rauminfo in der Sprache der Oberfläche (B17).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privacyInfo } from "@freedomstack/protocol";
import { GRUPPE_ABSTAND, gruppiereVerlauf } from "../src/raum-verlauf.js";
import { kanalVertraulichkeit } from "../src/protokoll-texte.js";
import { setLang } from "../src/i18n.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const raeume = quelle("../src/shell/tabs/raeume.ts");
const menue = quelle("../src/shell/menue.ts");
const html = quelle("../src/shell/index.html");

const A = "a".repeat(64);
const B = "b".repeat(64);
const T = 1_790_000_000;
/** Tag in UTC – unabhängig von der Zeitzone der Testmaschine. */
const utcTag = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const n = (autor: string, createdAt: number, id = `${autor[0]}${createdAt}`) => ({ id, authorPubkey: autor, createdAt });
const form = (liste: ReturnType<typeof n>[]) =>
  gruppiereVerlauf(liste, utcTag).map((g) => [g.autor[0], g.neuerTag, g.nachrichten.map((m) => m.id)]);

test("C.2b2: derselbe Absender innerhalb von fünf Minuten steht unter einem Kopf", () => {
  assert.equal(GRUPPE_ABSTAND, 300);
  const tag = T - (T % 86400) + 3600; // 01:00 UTC, weit weg von Mitternacht
  assert.deepEqual(form([n(A, tag), n(A, tag + 60), n(A, tag + 360), n(A, tag + 660)]), [
    ["a", true, [`a${tag}`, `a${tag + 60}`, `a${tag + 360}`, `a${tag + 660}`]],
  ], "jeweils höchstens fünf Minuten zum vorigen – auch wenn der erste länger her ist");
  assert.deepEqual(form([n(A, tag), n(A, tag + 300), n(A, tag + 601)]), [
    ["a", true, [`a${tag}`, `a${tag + 300}`]],
    ["a", false, [`a${tag + 601}`]],
  ], "300 s gehören dazu, 301 s nicht");
  assert.deepEqual(form([n(A, tag), n(B, tag + 10), n(A, tag + 20)]), [
    ["a", true, [`a${tag}`]], ["b", false, [`b${tag + 10}`]], ["a", false, [`a${tag + 20}`]],
  ], "ein anderer Absender dazwischen trennt");
});

test("C.2b2: neuer Tag beginnt eine neue Gruppe mit Datum; rückwärts laufende Zeitstempel ziehen nichts unter fremde Köpfe", () => {
  const mitternacht = T - (T % 86400) + 86400;
  assert.deepEqual(form([n(A, mitternacht - 60), n(A, mitternacht + 60)]), [
    ["a", true, [`a${mitternacht - 60}`]], ["a", true, [`a${mitternacht + 60}`]],
  ]);
  const tag = mitternacht + 7200;
  assert.deepEqual(form([n(A, tag), n(A, tag - 30)]), [["a", true, [`a${tag}`]], ["a", false, [`a${tag - 30}`]]]);
  assert.deepEqual(gruppiereVerlauf([]), []);
});

test("C.2b2 (B17): Rauminfo in der Sprache der Oberfläche – auf Deutsch wortgleich mit privacyInfo()", () => {
  for (const privacy of ["verschluesselt", "offen"] as const) {
    const kanal = { id: "k", name: "k", privacy, writeRoles: [], position: 0 };
    setLang("de");
    assert.equal(kanalVertraulichkeit(kanal), privacyInfo(kanal as never), privacy);
    setLang("en");
    assert.notEqual(kanalVertraulichkeit(kanal), privacyInfo(kanal as never));
    assert.doesNotMatch(kanalVertraulichkeit(kanal), /Verschlüsselt|Offen|Jeder|Nachrichten/);
  }
  assert.doesNotMatch(raeume.replace(/^\s*\/\/.*$/gm, ""), /privacyInfo/, "die App zeigt den deutschen Satz nicht mehr direkt");
});

test("C.2b2 (B9): Verlauf mit Namen, gebaut aus DOM und textContent; Mitglieder mit Namen", () => {
  const verlauf = raeume.slice(raeume.indexOf("const { topLevel, threads } = buildThreads"), raeume.indexOf("// Schreibrecht: Wer nicht darf"));
  // Seit C.2c zeichnen Kanal und Thread mit denselben Funktionen
  const zeichnen = raeume.slice(raeume.indexOf("const nameVon = "), raeume.indexOf("/** Thread öffnen"));
  assert.doesNotMatch(verlauf + zeichnen, /innerHTML|pkShort/, "kein HTML aus Fremddaten, keine gekürzten Schlüssel als Name");
  assert.match(verlauf, /verlaufGruppen\(topLevel, spacesUi\.verlauf\)/);
  assert.match(zeichnen, /return gruppiereVerlauf\(liste\)\.flatMap/);
  assert.match(zeichnen, /const nameVon = \(pk: string\): string => \(pk === state\.keypair\?\.pk \? t\("raum\.ich"\) : kontaktName\(pk\)\);/);
  assert.match(zeichnen, /const name = el\("span", nameVon\(g\.autor\), "msg-author"\);/);
  assert.match(zeichnen, /z\.append\(el\("div", m\.content, "msg-text"\)\);/, "Inhalt nur als textContent");
  // Aktionen je Nachricht als Werkzeugleiste – dieselben Wege wie bisher
  assert.match(zeichnen, /leiste\.setAttribute\("role", "toolbar"\);/);
  assert.match(zeichnen, /knopf\(t\("komm\.moderieren"\), "mod-hide", \(\) => void moderiere\("hide", m\.id, m\.authorPubkey\)\)/);
  assert.match(zeichnen, /knopf\(raumAktionText\(m\.authorPubkey\), "raum-aktion", \(\) => void raumAktion\(m\.id, m\.authorPubkey\)\)/);
  const mitglieder = raeume.slice(raeume.indexOf("async function zeigeMitglieder"), raeume.indexOf("/** Nachricht senden. */"));
  assert.doesNotMatch(mitglieder, /pkShort/);
  // Meldegrund als Text – nur bekannte Kennungen werden übersetzt, Fremdes bleibt, wie es ist
  assert.match(raeume, /const grund = \(MELDE_GRUENDE as readonly string\[\]\)\.includes\(m\.grund\) \? t\(GRUND_TEXT\[m\.grund as MeldeGrund\]\) : m\.grund;/);
});

test("C.2b2: nach Beitreten und Anlegen steht der Raum da; mobil ist der Kanal eine eigene Ebene mit „‹“", () => {
  const beitreten = raeume.slice(raeume.indexOf('if (join) join.onclick'), raeume.indexOf("// Mobil (C.2b2)"));
  assert.match(beitreten, /const id = raumBeitreten\(String\(w\?\.id \?\? ""\)\);\s*if \(!id\) return;[\s\S]*setzeKommModus\("space"\);\s*void oeffneRaum\(id\);/);
  const anlegen = raeume.slice(raeume.indexOf("async function legeRaumAn"), raeume.indexOf("/** Name eines Kontakts"));
  assert.equal(anlegen.split('setzeKommModus("space");').length - 1, 2, "privat und offen");
  assert.match(quelle("../src/shell/tabs/kommunikation.ts"), /^export function setzeKommModus\(modus: "dm" \| "space"\): void \{/m);
  // (seit C.2c schließt ein Kanalwechsel davor den Thread)
  assert.match(raeume, /async function oeffneKanal\(channelId: string\): Promise<void> \{\s*(if \(spacesUi\.channelId !== channelId\) spacesUi\.thread = null;\s*)?spacesUi\.channelId = channelId;[^\n]*\n[^\n]*\n\s*document\.querySelector\("\.comm-space-inner"\)\?\.classList\.add\("showing-channel"\);/);
  assert.match(html, /<button id="channel-zurueck" class="ghost icon-btn kanal-zurueck" type="button" aria-label="Zu den Kanälen" data-i18n-aria="raum\.zuDenKanaelen">/);
  assert.match(raeume, /z\.tabIndex = -1;/, "antippen zeigt die Aktionen, ohne die Tab-Reihenfolge zu verlängern");
});

test("C.2b2: Raum-Menü – Knopf mit Menü, die Punkte behalten ihre IDs; Tastatur nach Menü-Muster", () => {
  const kopf = html.slice(html.indexOf('<div class="space-head">'), html.indexOf('<div id="channel-list"'));
  assert.match(kopf, /id="space-menue-knopf"[^>]*aria-controls="space-menue"/);
  assert.match(kopf, /<div id="space-menue" class="raum-menue hidden" role="menu"/);
  for (const id of ["space-invite", "space-mods", "space-join", "space-create", "space-create-public"]) {
    assert.match(kopf, new RegExp(`<button id="${id}" class="menue-punkt[^"]*" role="menuitem"`), id);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} genau einmal`);
  }
  assert.match(raeume, /if \(menueKnopf && menue\) wireMenue\(menueKnopf, menue\);/);
  assert.match(menue, /knopf\.setAttribute\("aria-haspopup", "menu"\);/);
  assert.match(menue, /e\.key === "Escape"\) \{\s*e\.preventDefault\(\);\s*schliesse\(true\);/, "Esc gibt den Fokus dem Knopf zurück");
  // Gewählt: erst schließen und den Fokus zum Knopf (Erfassungsphase), dann öffnet der Punkt seinen Dialog
  assert.match(menue, /if \(\(e\.target as HTMLElement\)\.closest\(PUNKT\)\) schliesse\(true\);\s*\}, true\);/);
});
