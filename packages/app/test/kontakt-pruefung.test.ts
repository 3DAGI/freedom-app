/**
 * Kontakt prüfen (B-4): geprüfte Kontakte im Tresor, der Dialog mit dem Code
 * aus beiden Schlüsseln, verdrahtet im Chat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE, generateKeypair } from "@freedomstack/protocol";
import { LS_GEPRUEFT, MAX_GEPRUEFT, geprueftAm, gepruefteKontakte, merkeGeprueft } from "../src/kontakt-pruefung.js";

class Speicher {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  async setItem(k: string, v: string) { this.m.set(k, v); }
}

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");

test("B-4: geprüft merken – je Schlüssel mit Zeit; ein neuer Schlüssel ist ungeprüft", async () => {
  const s = new Speicher();
  const alt = generateKeypair().pk;
  const neu = generateKeypair().pk;
  assert.equal(geprueftAm(s, alt), undefined);
  await merkeGeprueft(s, alt, 1_800_000_000);
  assert.equal(geprueftAm(s, alt), 1_800_000_000);
  assert.equal(geprueftAm(s, neu), undefined, "nach einem Schlüsselwechsel gilt der neue als ungeprüft");
  await merkeGeprueft(s, alt, 1_800_000_500);
  assert.equal(geprueftAm(s, alt), 1_800_000_500, "erneut geprüft: neue Zeit");
  await assert.rejects(merkeGeprueft(s, "npub1abc"), /Schlüssel ungültig/);
});

test("B-4: Unlesbares fällt weg, statt die Liste zu sperren; begrenzt", async () => {
  const s = new Speicher();
  const pk = generateKeypair().pk;
  s.m.set(LS_GEPRUEFT, JSON.stringify({ [pk]: 1_800_000_000, kaputt: 5, ["a".repeat(64)]: "gestern", ["b".repeat(64)]: -1 }));
  assert.deepEqual([...gepruefteKontakte(s)], [[pk, 1_800_000_000]]);
  s.m.set(LS_GEPRUEFT, "{kein json");
  assert.equal(gepruefteKontakte(s).size, 0);
  s.m.set(LS_GEPRUEFT, "[1,2]");
  assert.equal(gepruefteKontakte(s).size, 0);
  const viele = Object.fromEntries(Array.from({ length: MAX_GEPRUEFT }, (_, i) => [i.toString(16).padStart(64, "0"), 1_000 + i]));
  s.m.set(LS_GEPRUEFT, JSON.stringify(viele));
  await merkeGeprueft(s, pk, 1_800_000_000);
  const danach = gepruefteKontakte(s);
  assert.equal(danach.size, MAX_GEPRUEFT);
  assert.ok(danach.has(pk), "der neue bleibt");
  assert.ok(!danach.has("0".repeat(64)), "der älteste fällt weg");
});

test("B-4: im Tresor und in der Sicherung – mit Präfix für die Notfall-Löschung", () => {
  assert.ok(LS_GEPRUEFT.startsWith("freedom."));
  assert.match(lies("shell/tresor.ts"), /const GEHEIM_FEST = \[[^\]]*"freedom\.kontakte\.geprueft"\]/, "verrät, wen man getroffen hat");
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_GEPRUEFT), "ein neues Gerät kennt die geprüften Kontakte");
});

test("B-4: verdrahtet – Knopf im Chat, Code aus beiden Schlüsseln der Personen, gemerkt erst nach dem Vergleich", () => {
  const html = lies("shell/index.html");
  assert.match(html, /<button id="chat-pruefen" [^>]*data-i18n-title="komm\.pruefenTitel" data-i18n-aria="komm\.pruefen">/);
  const app = lies("shell/app.ts");
  assert.match(app, /const pruefBtn = \$\("#chat-pruefen"\);[\s\S]{0,400}if \(!c \|\| c\.type !== "dm"\) return toast\(t\("komm\.pruefNur11"\), true\);[\s\S]{0,200}await pruefeKontakt\(c\.id, c\.name\);/);
  const ui = lies("shell/kontakt-pruefen-ui.ts");
  assert.match(ui, /const ich = sprichtFuer\(\);\s*const code = ich \? sicherheitscode\(ich, pk\) : undefined;/, "als Gerät spricht die App für die Person (8.6c)");
  assert.ok(ui.indexOf("if (!w) return false;") < ui.indexOf("await merkeGeprueft(geheim, pk);"), "abgebrochen: nichts gemerkt");
  assert.match(ui, /return eingabe && !sicherheitscodeStimmt\(eingabe, code\) \? t\("komm\.pruefFalsch"\) : null;/, "ein falscher Code lässt sich nicht bestätigen");
  assert.doesNotMatch(ui, /innerHTML|publish|signiere/, "nur DOM über den Dialog, nichts geht hinaus");
  const komm = lies("shell/tabs/kommunikation.ts");
  assert.match(komm, /\(c\?\.type === "dm" \? `<br\/><span class="pruef-stand">\$\{escapeHtml\(pruefStand\(c\.id\)\)\}<\/span>` : ""\)/);
});
