/**
 * Schritt 5.10a: Abdeckungskarte in der App – Eintrag mit Wegwerfschluessel
 * statt Identitaet, Schluessel nur im Tresor, Austragen per Widerruf, und die
 * Einwilligung sagt, was auf den Relays sichtbar ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE, SICHERUNG_NIE } from "@freedomstack/protocol";

test("5.10a verdrahtet: Eintrag nie mit der Identitaet, Schluessel nur im Tresor, Austragen per Widerruf", () => {
  const earn = readFileSync(new URL("../src/shell/tabs/earn.ts", import.meta.url), "utf8");
  const ein = earn.slice(earn.indexOf("export async function trageAbdeckungEin"), earn.indexOf("export const LS_ABDECKUNG_EINTRAG"));
  assert.match(ein, /if \(!confirm\(coverageConsentText\(layer\)\)\) return;/, "erst die Einwilligung");
  assert.match(ein, /const \{ event, wegwerfSk \} = baueCoverageEintrag\(\{ layer, cell, region: "" \}\);/);
  assert.match(ein, /await geheim\.setItem\(LS_ABDECKUNG_EINTRAG, /);
  assert.match(ein, /await widerrufeAbdeckung\(false\);/, "ein frueherer Eintrag wird zuerst widerrufen");
  assert.doesNotMatch(ein, /signiere\(|state\.keypair!?\.pk/, "nie mit der Identitaet signiert");
  const aus = earn.slice(earn.indexOf("export async function widerrufeAbdeckung"));
  assert.match(aus, /baueCoverageWiderruf\(e\.id, sk\)/);
  assert.match(aus, /await geheim\.removeItem\(LS_ABDECKUNG_EINTRAG\);/);
  assert.doesNotMatch(earn, /localStorage\.setItem\(LS_ABDECKUNG_EINTRAG/);

  const settings = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  assert.match(settings, /leave\.onclick = \(\) => void widerrufeAbdeckung\(\);/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /id="coverage-leave"/);
  assert.match(html, /Auf den Relays ist jeder Eintrag einzeln sichtbar/);

  const tresor = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");
  assert.match(tresor, /const GEHEIM_FEST = \[[^\]]*"freedom\.coverage\.eintrag"/, "Wegwerfschluessel im Tresor");
  assert.ok(SICHERUNG_NIE.some((r) => r.test("freedom.coverage.eintrag")), "nie in die Zustandssicherung");
  assert.ok(!SICHERUNG_EINTRAEGE.includes("freedom.coverage.eintrag"));
});
