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
  // Seit 8.16g2b2 bildet fixierungText() die Rueckfrage in der Sprache der Oberflaeche
  // Seit C-1c als Dialog statt confirm()
  assert.match(s, /fixierung\.status === "andere-echt" && r\.version && await bestaetige\(\{ titel: t\("set\.neueVersionTitel"\), text: fixierungText\(fixierung\.status, fixVersion, r\.version\), ok: t\("set\.uebernehmen"\) \}\)/, "neue Version nur nach Rueckfrage");
  // Seit 11.2a stehen die Signierer in release-signierer.ts – auch für die Prüfung der eigenen Adresse
  const signierer = readFileSync(new URL("../src/release-signierer.ts", import.meta.url), "utf8");
  assert.match(signierer, /mindestens `RELEASE_MIN_SIGNATUREN` \(2\)/);
  assert.match(s, /const manifeste = await ladeManifeste\(await ensurePool\(\)\);\s*const r = verifyArtifact\(hash, "freedom\.html", manifeste, TRUSTED_SIGNERS\);/);
  const skript = readFileSync(new URL("../../../scripts/publish-release.mjs", import.meta.url), "utf8");
  assert.match(skript, /nutzlast\(\{ version, artifacts \}\)/, "Nutzlast-Hash zum Abgleich unter den Signierern");
});
