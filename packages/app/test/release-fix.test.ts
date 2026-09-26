/**
 * Schritt 5.2: Releases k von n in der App – Verdrahtung. Die Logik (k von n,
 * Fixierung) pruefen die Protokoll-Tests (`release.test.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Verdrahtung (5.2): Start prueft die fixierte Version, Settings fixieren nur Bestaetigtes", () => {
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /void pruefeFixierungBeimStart\(\);/);
  const s = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  assert.match(s, /fixierung: pruefeFixierung\(ladeFixierung\(\), hash, r\)/);
  assert.match(s, /if \(r\.status === "echt" && r\.version && fix\?\.sha256 !== hash\)/, "fixieren nur, was k Signierer bestaetigen");
  assert.match(s, /fixierung\.status === "andere-echt" && r\.version && confirm\(fixierung\.meldung\)/, "neue Version nur nach Rueckfrage");
  assert.match(s, /mindestens `RELEASE_MIN_SIGNATUREN` \(2\)/);
  const skript = readFileSync(new URL("../../../scripts/publish-release.mjs", import.meta.url), "utf8");
  assert.match(skript, /nutzlast\(\{ version, artifacts \}\)/, "Nutzlast-Hash zum Abgleich unter den Signierern");
});
