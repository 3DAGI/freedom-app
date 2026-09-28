/**
 * Schritt C.2b1: Dialoge statt prompt(), confirm() und alert(). Die Prüfung
 * der Eingaben ist rein und hier getestet; Tastatur, Fokus und Esc prüft der
 * Smoke-Test („dialog“) im Browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MELDE_GRUENDE } from "@freedomstack/protocol";
import { type Feld, pruefeWerte } from "../src/shell/dialog.js";
import { setLang, t } from "../src/i18n.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const dialog = quelle("../src/shell/dialog.ts");
const raeume = quelle("../src/shell/tabs/raeume.ts");
/** Code ohne Kommentare – ein Wort im Kommentar ist kein Aufruf. */
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const felder: Feld[] = [
  { art: "text", name: "name", label: "Name", pflicht: true },
  { art: "textarea", name: "notiz", label: "Notiz" },
  { art: "wahl", name: "grund", label: "Grund", pflicht: true, optionen: [{ wert: "spam", text: "Spam" }, { wert: "other", text: "Anderes" }] },
  { art: "mehrfach", name: "mods", label: "Moderatoren", optionen: [{ wert: "a", text: "A" }] },
  { art: "nurlesen", name: "kennung", label: "Kennung", wert: "x" },
];

test("C.2b1: Pflichtfelder – leer und nur Leerzeichen gelten nicht; der Fehler nennt das Feld", () => {
  setLang("de");
  assert.deepEqual(pruefeWerte(felder, { name: "", grund: "spam" }), { feld: "name", text: "Bitte ausfüllen" });
  assert.deepEqual(pruefeWerte(felder, { name: "  \n ", grund: "spam" }), { feld: "name", text: "Bitte ausfüllen" });
  assert.deepEqual(pruefeWerte(felder, { name: "Raum", grund: "" }), { feld: "grund", text: "Bitte ausfüllen" });
  // Ein eigener Text statt des allgemeinen
  const mitText: Feld[] = [{ art: "textarea", name: "grund", label: "Begründung", pflicht: true, fehler: t("komm.ohneBegruendung") }];
  assert.equal(pruefeWerte(mitText, { grund: " " })?.text, "Ohne Begründung nicht — sie gehört zur Maßnahme");
  setLang("en");
  assert.equal(pruefeWerte(felder, {})?.text, "Please fill in");
  // Freiwillige Felder, Mehrfachwahl und Nur-Lesen dürfen leer sein
  assert.equal(pruefeWerte(felder, { name: "Raum", grund: "spam", notiz: "", mods: [] }), null);
});

test("C.2b1: eine Wahl nur aus den Optionen – auch wenn jemand den Wert im DOM verändert", () => {
  assert.equal(pruefeWerte(felder, { name: "Raum", grund: "bitte-sperren" })?.feld, "grund");
  const frei: Feld[] = [{ art: "wahl", name: "kontakt", label: "Kontakt", optionen: [{ wert: "a".repeat(64), text: "Alice" }] }];
  assert.equal(pruefeWerte(frei, { kontakt: "" }), null, "freiwillige Wahl darf leer bleiben");
  assert.equal(pruefeWerte(frei, { kontakt: "b".repeat(64) })?.feld, "kontakt");
});

test("C.2b1: Prüfung über die Felder hinweg läuft erst, wenn die Felder stimmen", () => {
  let gerufen = 0;
  const pruefe = (w: Record<string, unknown>) => (gerufen++, /^[0-9a-f]{64}$/.test(String(w.schluessel)) ? null : "kein Schlüssel");
  const f: Feld[] = [{ art: "text", name: "schluessel", label: "Schlüssel", pflicht: true }];
  assert.equal(pruefeWerte(f, { schluessel: "" }, pruefe)?.feld, "schluessel");
  assert.equal(gerufen, 0);
  assert.deepEqual(pruefeWerte(f, { schluessel: "abc" }, pruefe), { text: "kein Schlüssel" });
  assert.equal(pruefeWerte(f, { schluessel: "c".repeat(64) }, pruefe), null);
});

test("C.2b1: der Dialog baut nur mit DOM und textContent – barrierefrei, Fokus bleibt drin, Esc bricht ab", () => {
  assert.doesNotMatch(dialog, /innerHTML|insertAdjacentHTML|outerHTML/, "Fremddaten nie als HTML");
  assert.match(dialog, /e\.textContent = text;/);
  assert.match(dialog, /box\.setAttribute\("role", "dialog"\);\s*box\.setAttribute\("aria-modal", "true"\);/);
  assert.match(dialog, /box\.setAttribute\("aria-labelledby", titel\.id\);/);
  assert.match(dialog, /if \(app\) app\.inert = true;/, "der Rest der App ist solange nicht bedienbar");
  assert.match(dialog, /document\.addEventListener\("focusin", halteFokus\);/);
  assert.match(dialog, /if \(e\.key === "Escape"\) \{\s*e\.preventDefault\(\);\s*ende\(null\);/);
  assert.match(dialog, /if \(vorher\?\.isConnected\) vorher\.focus\(\);/, "Fokus kehrt zurück");
  assert.match(dialog, /const zuerst = \(o\.gefahr && ab\) \? ab :/, "bei Löschen & Co. steht der Fokus zuerst auf Abbrechen");
});

test("C.2b1: Räume fragen nur noch über Dialoge – kein prompt(), confirm() oder alert()", () => {
  assert.doesNotMatch(ohneKommentare(raeume), /\b(prompt|confirm|alert)\(/);
  assert.match(raeume, /import \{ bestaetige, dialog, hinweis, type Option \} from "\.\.\/dialog\.js";/);
  // Öffentlich anlegen nur mit dem Hinweis im selben Dialog, in dem der Name steht
  const anlegen = raeume.slice(raeume.indexOf("async function legeRaumAn"), raeume.indexOf("const { buildSpace, buildRoles }"));
  assert.match(anlegen, /text: t\(oeffentlich \? "komm\.oeffentlichWarnung" : "komm\.privatTitel"\),/);
  assert.match(anlegen, /if \(!name\.trim\(\)\) return;\s*if \(!oeffentlich\) \{/, "abgebrochen oder leer → nichts angelegt");
  // Einladen: nur ein gültiger Schlüssel verlässt den Dialog
  const einladen = raeume.slice(raeume.indexOf("async function ladeEin"), raeume.indexOf("/**\n * Moderieren"));
  assert.match(einladen, /pruefe: \(w\) => \(\/\^\[0-9a-f\]\{64\}\$\/\.test\(wen\(w\)\) \? null : t\("komm\.keinSchluessel"\)\),/);
  assert.match(einladen, /if \(!w\) return;\s*const pk = wen\(w\);/);
  // Offene Räume: Maßnahme und Begründung in einem Dialog, ohne Begründung nichts
  const moderiere = raeume.slice(raeume.indexOf("async function moderiere"), raeume.indexOf("/**\n * Moderatoren ernennen"));
  assert.match(moderiere, /pflicht: true, fehler: t\("komm\.ohneBegruendung"\)/);
  assert.match(moderiere, /if \(!w \|\| !grund\) return;/);
  assert.match(moderiere, /: buildBan\(spacesUi\.spaceId, state\.keypair\.pk, autor, grund\);/, "gesperrt wird der Absender, nicht die Nachricht");
});

test("C.2b1: Meldegründe als Wahl – jeder Grund des Protokolls hat einen Text in beiden Sprachen, gesendet wird die Kennung", () => {
  const tabelle = raeume.slice(raeume.indexOf("const GRUND_TEXT"), raeume.indexOf("};", raeume.indexOf("const GRUND_TEXT")));
  for (const g of MELDE_GRUENDE) {
    const m = new RegExp(`\\b${g}: "(raum\\.grund\\w+)"`).exec(tabelle);
    assert.ok(m, `Text für ${g}`);
    for (const sprache of ["de", "en"] as const) {
      setLang(sprache);
      assert.notEqual(t(m[1]!), m[1], `${m[1]} (${sprache})`);
    }
  }
  setLang("en");
  assert.match(raeume, /optionen: MELDE_GRUENDE\.map\(\(g\) => \(\{ wert: g, text: t\(GRUND_TEXT\[g\]\) \}\)\)/);
  assert.match(raeume, /if \(!\(MELDE_GRUENDE as readonly string\[\]\)\.includes\(grund\)\) return;/);
});
