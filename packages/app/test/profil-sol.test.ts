/**
 * Schritt 12.6: Die SOL-Adresse geht nur mit Häkchen ins öffentliche Profil,
 * eingeschaltet erst nach einer Warnung. Vorher gab es kein Feld – also gilt
 * „aus“, ohne Übernahme wie bei der Lightning-Adresse (6.3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, SICHERUNG_EINTRAEGE, auditPrivacy } from "@freedomstack/protocol";
import { LS_SOL_OEFFENTLICH, setzeSolOeffentlich, solOeffentlich } from "../src/profil-sol.js";

function speicher(werte: Record<string, string> = {}) {
  const m = new Map(Object.entries(werte));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";

test("12.6: aus, auch wenn eine Adresse im Entwurf steht – nur das Häkchen schaltet ein", () => {
  const s = speicher({ "freedom.profile": JSON.stringify({ sol: SOL }) });
  assert.equal(solOeffentlich(s), false);
  assert.equal(s.m.has(LS_SOL_OEFFENTLICH), false, "Lesen schreibt nichts");
  setzeSolOeffentlich(s, true);
  assert.equal(s.m.get(LS_SOL_OEFFENTLICH), "1");
  assert.equal(solOeffentlich(s), true);
  setzeSolOeffentlich(s, false);
  assert.equal(solOeffentlich(s), false);
  assert.equal(solOeffentlich(speicher({ [LS_SOL_OEFFENTLICH]: "ja" })), false, "unbekannter Wert ist aus");
});

test("12.6: Bericht – kritisch nur bei öffentlicher Adresse, gelesen aus Profil und Häkchen; die Einstellung reist mit der Sicherung", () => {
  assert.ok(!auditPrivacy(DEFAULT_CONFIG).some((f) => f.id === "sol-profil"));
  assert.ok(auditPrivacy({ ...DEFAULT_CONFIG, solanaInProfile: true }).some((f) => f.id === "sol-profil" && f.severity === "kritisch"));
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_SOL_OEFFENTLICH));
  const ds = readFileSync(new URL("../src/shell/datenschutz.ts", import.meta.url), "utf8");
  assert.match(ds, /solanaInProfile: !!profil\.sol\?\.trim\(\) && solOeffentlich\(localStorage\),/);
  assert.doesNotMatch(ds, /freedom\.solAddress/, "den alten Schlüssel schrieb nichts");
});

test("12.6: Formular – Feld, frische Adresse, Häkchen; einschalten nur nach der Warnung, ungültig wird nicht gespeichert", () => {
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<input id="pf-sol" /);
  assert.match(html, /<button id="pf-sol-frisch" /);
  assert.match(html, /<input type="checkbox" id="pf-sol-oeffentlich" \/>/);
  const pf = readFileSync(new URL("../src/shell/tabs/profil.ts", import.meta.url), "utf8");
  const an = pf.slice(pf.indexOf("solHaken.onchange"), pf.indexOf("const solFrisch"));
  assert.ok(an.indexOf("await bestaetige(") > 0 && an.indexOf("await bestaetige(") < an.indexOf("setzeSolOeffentlich(localStorage, solHaken.checked)"), "erst die Warnung, dann merken");
  assert.match(an, /solHaken\.checked = false;\s*return;/, "abgebrochen bleibt aus");
  // Frisch nur aus dem Vorrat der eingebauten Wallet (nie die Hauptadresse)
  assert.match(pf, /const \{ frischeEmpfangsadresse \} = await import\("\.\.\/eingebaute-wallet\.js"\);/);
  const sp = pf.slice(pf.indexOf("save.onclick"));
  assert.ok(sp.indexOf('adresseFuer({ sol: entwurf.sol }, "solana")') > 0 && sp.indexOf('adresseFuer({ sol: entwurf.sol }, "solana")') < sp.indexOf("buildProfile("), "erst prüfen, dann veröffentlichen");
  // Vorschau zeigt sie nur, wenn sie hinausgeht
  assert.match(pf, /if \(gespeichert\.sol && solOeffentlich\(localStorage\)\) \{/);
});
