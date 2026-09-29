/**
 * Schritt 6.3: Die Lightning-Adresse geht nur mit Häkchen ins öffentliche
 * Profil. Wer vor 6.3 eine gespeichert hatte, hat sie veröffentlicht – das
 * übernimmt die Einstellung einmal, sonst gilt „aus“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, SICHERUNG_EINTRAEGE, auditPrivacy } from "@freedomstack/protocol";
import { LS_LN_OEFFENTLICH, lnOeffentlich, setzeLnOeffentlich } from "../src/profil-lightning.js";

function speicher(werte: Record<string, string> = {}) {
  const m = new Map(Object.entries(werte));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test("6.3: neu ohne Adresse aus – und bleibt aus, wenn danach eine eingetragen wird", () => {
  const s = speicher();
  assert.equal(lnOeffentlich(s), false);
  assert.equal(s.m.get(LS_LN_OEFFENTLICH), "0");
  s.setItem("freedom.profile", JSON.stringify({ lud16: "ada@wallet.example" }));
  assert.equal(lnOeffentlich(s), false, "ein neuer Eintrag geht nicht von selbst hinaus");
  setzeLnOeffentlich(s, true);
  assert.equal(lnOeffentlich(s), true);
  setzeLnOeffentlich(s, false);
  assert.equal(lnOeffentlich(s), false);
});

test("6.3: vor 6.3 gespeicherte Adresse gilt als veröffentlicht; Kaputtes als aus", () => {
  assert.equal(lnOeffentlich(speicher({ "freedom.profile": JSON.stringify({ lud16: "ada@wallet.example" }) })), true);
  assert.equal(lnOeffentlich(speicher({ "freedom.profile": JSON.stringify({ lud16: "  " }) })), false);
  assert.equal(lnOeffentlich(speicher({ "freedom.profile": "kein json" })), false);
  assert.equal(lnOeffentlich(speicher({ "freedom.profile": JSON.stringify({ lud16: "ada@wallet.example" }), [LS_LN_OEFFENTLICH]: "0" })), false);
  assert.equal(lnOeffentlich(speicher({ [LS_LN_OEFFENTLICH]: "ja" })), false, "unbekannter Wert → neu bestimmt");
});

test("6.3: Bericht warnt nur bei öffentlicher Adresse; die Einstellung reist mit der Sicherung", () => {
  assert.ok(!auditPrivacy(DEFAULT_CONFIG).some((f) => f.id === "ln-profil"));
  assert.ok(auditPrivacy({ ...DEFAULT_CONFIG, lightningInProfile: true }).some((f) => f.id === "ln-profil" && f.severity === "warnung"));
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_LN_OEFFENTLICH));
  const ds = readFileSync(new URL("../src/shell/datenschutz.ts", import.meta.url), "utf8");
  assert.match(ds, /lightningInProfile: !!profil\.lud16\?\.trim\(\) && lnOeffentlich\(localStorage\),/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<input type="checkbox" id="pf-lud16-oeffentlich" \/>/);
  const pf = readFileSync(new URL("../src/shell/tabs/profil.ts", import.meta.url), "utf8");
  assert.match(pf, /lnHaken\.onchange = \(\) => \{\s*setzeLnOeffentlich\(localStorage, lnHaken\.checked\);/);
});
