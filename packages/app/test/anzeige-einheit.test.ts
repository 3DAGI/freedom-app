/**
 * Schritt 12.1 (Oberfläche): Auswahl der Anzeigeeinheit in Währung › Zahlen.
 * Gemerkt wird nur die eigene Wahl (sats oder SOL); „automatisch“ entfernt sie,
 * dann gilt `anzeigeEinheit()` wie vorher (Logik von Spur A, preis-anzeige.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE } from "@freedomstack/protocol";
import { LS_ANZEIGE_EINHEIT } from "../src/standard-schiene.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("12.1: Auswahl neben der Standard-Schiene – automatisch, sats, SOL", () => {
  const html = src("../src/shell/index.html");
  const sel = html.slice(html.indexOf('<select id="anzeige-einheit"'), html.indexOf("</select>", html.indexOf('<select id="anzeige-einheit"')));
  assert.deepEqual([...sel.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), ["", "sats", "sol"]);
  assert.ok(html.indexOf('id="standard-schiene"') < html.indexOf('id="anzeige-einheit"'), "im selben Kasten, nach der Schiene");
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_ANZEIGE_EINHEIT), "die Wahl reist mit der Sicherung");
});

test("12.1: Verdrahtung – nur sats oder SOL gemerkt, sonst entfernt; vorbelegt aus dem Gemerkten", () => {
  const m = src("../src/shell/tabs/mesh.ts");
  const f = m.slice(m.indexOf('getElementById("anzeige-einheit")'), m.indexOf("// Private Kontaktliste"));
  assert.match(f, /einheit\.value = wahl === "sats" \|\| wahl === "sol" \? wahl : "";/);
  assert.match(f, /if \(einheit\.value === "sats" \|\| einheit\.value === "sol"\) localStorage\.setItem\(LS_ANZEIGE_EINHEIT, einheit\.value\);\s*else localStorage\.removeItem\(LS_ANZEIGE_EINHEIT\);/);
  assert.doesNotMatch(f, /setItem\(LS_ANZEIGE_EINHEIT, ""\)/, "„automatisch“ ist keine gemerkte Wahl");
});
