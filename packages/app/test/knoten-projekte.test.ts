/**
 * Projekte meines Knotens (VKl2): „Als Repo in einen Raum stellen“ – die Liste nur auf Knopfdruck, versiegelt über
 * den Weg zu meinem Knoten; Ablehnungen nur über ihre Kennung; erst das Bundle, dann die Ankündigung – scheitert
 * das Bundle, geht nichts hinaus; im privaten Raum alles nur in die Gruppe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLang } from "../src/i18n.js";
import { CODE_FALL_TEXT, bundleVerweis, codeAblehnungText, projektZeile } from "../src/knoten-projekte.js";
import { settings } from "../src/texte/settings.js";
import { repos } from "../src/texte/repos.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const SCHLUESSEL = { alg: "aes-gcm" as const, key: "a".repeat(64), nonce: "b".repeat(24), ox: "c".repeat(64) };

test("VKl2: jede Kennung des Knotens hat einen Text in beiden Sprachen – und keine ohne Knoten", () => {
  const quelle = readFileSync(new URL("../../node/src/projekte.ts", import.meta.url), "utf8");
  const zeile = quelle.split("\n").find((z) => z.includes("readonly fall:"))!;
  const faelle = [...zeile.matchAll(/"(code-[a-z-]+)"/g)].map((m) => m[1]!).sort();
  assert.deepEqual(Object.keys(CODE_FALL_TEXT).sort(), faelle);
  for (const k of [...Object.values(CODE_FALL_TEXT), "set.codeAbgelehnt"]) {
    const e = (settings as Record<string, { de: string; en: string }>)[k];
    assert.ok(e?.de && e.en, k);
  }
});

test("VKl2: Ablehnung nur über die Kennung – Text des Knotens bleibt draußen", () => {
  setLang("de");
  try {
    assert.equal(codeAblehnungText("code-leer"), "das Projekt hat noch keinen Schritt (Commit)");
    assert.equal(codeAblehnungText("code-unbekannt"), "mein Knoten lehnt ab");
    assert.equal(codeAblehnungText(undefined), "mein Knoten lehnt ab");
    assert.equal(codeAblehnungText("toString"), "mein Knoten lehnt ab", "keine Eigenschaft des Objekts");
  } finally {
    setLang("en");
  }
});

test("VKl2: Zeile je Projekt und Bundle-Verweis aus der Antwort", () => {
  setLang("de");
  try {
    assert.match(projektZeile({ name: "meine-app", schritte: 3, geaendert: 1_790_000_000 }), /^meine-app – 3 Schritte, zuletzt .*2026$/);
  } finally {
    setLang("en");
  }
  const v = bundleVerweis("meine-app", { aktion: "bundle", blob: "d".repeat(64), manifest: "e".repeat(64), schluessel: SCHLUESSEL, bytes: 9 }, 1_790_000_000);
  assert.deepEqual(v, { name: "meine-app", blobId: "d".repeat(64), headSha: "local", branch: "main", message: "bundle meine-app", version: 1_790_000_000, schluessel: SCHLUESSEL });
});

test("VKl2: Verdrahtung – Projekte nur gekoppelt und auf Knopfdruck, versiegelt über den Weg, Bundle vor der Ankündigung", () => {
  const ui = lies("shell/knoten-code-ui.ts");
  assert.match(ui, /baueCodeAuftrag\(\{ sitzung, kopplung: k, aktion, powBits \}\)/);
  assert.match(ui, /const weg = await wegZumKnoten\(k\.knoten, sitzung\);\n\s+if \(!weg\) return/);
  assert.match(ui, /leseCodeAntwort\(antwort\.ergebnis, aktion\.aktion\)/);
  assert.match(ui, /codeAblehnungText\(antwort\.fall\)/, "Ablehnung nur über die Kennung");
  assert.ok(!/localStorage|\.publish\((?!wrap)|innerHTML|abgelehnt\)/.test(ui.replace(/await weg\.publish\(wrap\)/, "")), "nichts gemerkt, nichts daneben veröffentlicht, nie Text vom Knoten");
  // Ohne das Manifest an den eigenen Relays wird nichts angekündigt
  assert.match(ui, /ids: \[r\.antwort\.manifest\]/);
  assert.match(lies("shell/mein-knoten.ts"), /getElementById\("knoten-projekte"\)\?\.toggleAttribute\("hidden", !k\)/);
  assert.match(lies("shell/app.ts"), /wireKnotenProjekte\(\);/);
  assert.match(lies("shell/knoten-weg-ui.ts"), /return \{ abgelehnt: a\.response\.content, fall: getTag\(a\.response, "fall"\) \}/);

  const r = lies("shell/tabs/repos.ts");
  const fn = r.slice(r.indexOf("async function kuendigeAn("), r.indexOf("export const legeRepoImRaumAn"));
  const bundle = fn.indexOf("await ausKnoten.hole()");
  assert.ok(bundle > 0 && bundle < fn.indexOf("baueRepoAnkuendigung(angaben"), "erst das Bundle, dann die Ankündigung");
  assert.match(fn, /if \(ausKnoten && !bundle\) return;/);
  assert.match(fn, /if \(gruppe\) await sendeInRaum\(gruppe, raumRepoBundle\(gruppe, verweis\)\);\n\s+else await pool\.publish\(await signiere\(buildGitRepoRef\(verweis, state\.keypair\.pk\)\)\);/);
  assert.match(fn, /\]\.filter\(\(o\) => !ausKnoten \|\| o\.wert !== LOKAL\) \}\] : \[\]\),/, "vom Knoten nie „nur dieses Gerät“");
  assert.match(fn, /if \(!imRaum && !ausKnoten && w\.wo === LOKAL\)/);
  for (const k of ["repo.knotenHinweis", "repo.knotenEingestellt"]) {
    const e = (repos as Record<string, { de: string; en: string }>)[k];
    assert.ok(e?.de && e.en, k);
  }
});
