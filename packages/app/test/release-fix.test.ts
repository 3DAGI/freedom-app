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
  assert.match(s, /const events = await ladeManifestEvents\(await ensurePool\(\)\);\s*const manifeste = manifesteAus\(events\);\s*const r = verifyArtifact\(hash, "freedom\.html", manifeste, TRUSTED_SIGNERS\);/);
  // Seit 6.1a2: „neuere Version“ nur über suchUpdate() – k Signierer, neuer als die laufende, Signaturen selbst geprüft
  // Seit 6.1a3c nennt die Desktop-Hülle den Zeitpunkt der laufenden Fassung (sonst wie bisher nur die Prüfsumme)
  assert.match(s, /const update = suchUpdate\(events, TRUSTED_SIGNERS, \{ sha256: hash, \.\.\.seit \}\);/);
  assert.doesNotMatch(s, /latestRelease\(/, "latestRelease() nannte auch eine ältere als „neuer“");
  const skript = readFileSync(new URL("../../../scripts/publish-release.mjs", import.meta.url), "utf8");
  assert.match(skript, /nutzlast\(\{ version, artifacts \}\)/, "Nutzlast-Hash zum Abgleich unter den Signierern");
});

test("6.1a2: Manifeste als Events laden – nur Kind 38054, unlesbare fallen beim Lesen weg", async () => {
  const { ladeManifestEvents, manifesteAus } = await import("../src/release-signierer.js");
  const { buildReleaseManifest, generateKeypair, signEvent, KIND_RELEASE_MANIFEST } = await import("@freedomstack/protocol");
  const kp = generateKeypair();
  const gut = signEvent(buildReleaseManifest({ version: "1.0.0", releasedAt: 1000, artifacts: [], sources: [] }, kp.pk, 1_700_000_000), kp.sk);
  const ohneVersion = signEvent({ kind: KIND_RELEASE_MANIFEST, pubkey: kp.pk, created_at: 1_700_000_000, tags: [], content: "" }, kp.sk);
  const anderes = signEvent({ kind: 1, pubkey: kp.pk, created_at: 1_700_000_000, tags: [], content: "x" }, kp.sk);
  const gefragt: unknown[] = [];
  const evs = await ladeManifestEvents({ query: async (f) => { gefragt.push(f); return [gut, ohneVersion, anderes]; } });
  assert.deepEqual(gefragt, [{ kinds: [KIND_RELEASE_MANIFEST], limit: 50 }]);
  assert.equal(evs.length, 3, "Events unverändert – suchUpdate() prüft sie selbst");
  assert.deepEqual(manifesteAus(evs).map((m) => m.version), ["1.0.0"]);
});
