/**
 * Tests fuer die Release-Verifikation.
 *
 * Hier entscheidet sich, ob eine weitergereichte Kopie der App vertrauenswuerdig
 * ist. Der Schwerpunkt liegt auf dem Angriff, der zaehlt: jemand
 * veroeffentlicht ein eigenes Manifest fuer seine manipulierte Datei.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent } from "../src/event.js";
import {
  buildReleaseManifest, parseReleaseManifest, verifyArtifact,
  latestRelease, allSources, hashText, sharingInstructions,
  KIND_RELEASE_MANIFEST, ReleaseManifest,
} from "../src/release.js";

const ECHT = generateKeypair();
const ANGREIFER = generateKeypair();
const VERTRAUT = [ECHT.pk];

const APP = "<html>die echte app</html>";
const GEFAELSCHT = "<html>die echte app<script>steal()</script></html>";

function manifest(kp: { pk: string; sk: Uint8Array }, inhalt: string, version = "1.0.0", releasedAt = 1000) {
  return signEvent(
    buildReleaseManifest({
      version,
      releasedAt,
      artifacts: [{ name: "freedom.html", sha256: hashText(inhalt), sizeBytes: inhalt.length }],
      sources: ["https://freedomstack.io/freedom.html", "magnet:?xt=urn:btih:abc"],
    }, kp.pk),
    kp.sk,
  );
}

// ------------------------------------------------------------- Format

test("Manifest: Roundtrip build -> parse", () => {
  const ev = manifest(ECHT, APP);
  const m = parseReleaseManifest(ev);
  assert.equal(ev.kind, KIND_RELEASE_MANIFEST);
  assert.equal(m.version, "1.0.0");
  assert.equal(m.artifacts.length, 1);
  assert.equal(m.artifacts[0].sha256, hashText(APP));
  assert.equal(m.sources.length, 2);
  assert.equal(m.signerPubkey, ECHT.pk);
});

test("Manifest: Artefakte ohne gueltige Pruefsumme fallen raus", () => {
  const kp = generateKeypair();
  const ev = signEvent(buildEvent(kp.pk, KIND_RELEASE_MANIFEST, [
    ["version", "1"], ["artifact", "a.html", "keine-pruefsumme", "10"],
    ["artifact", "b.html", hashText("x"), "1"],
  ], ""), kp.sk);
  assert.equal(parseReleaseManifest(ev).artifacts.length, 1);
});

test("Manifest: falscher Kind und fehlende Version werden abgelehnt", () => {
  const kp = generateKeypair();
  assert.throws(() => parseReleaseManifest(signEvent(buildEvent(kp.pk, 1, [], ""), kp.sk)), /kein Release-Manifest/);
  assert.throws(
    () => parseReleaseManifest(signEvent(buildEvent(kp.pk, KIND_RELEASE_MANIFEST, [], ""), kp.sk)),
    /ohne Version/,
  );
});

// ------------------------------------------------------------- Pruefung

test("Echte Datei wird als echt erkannt — egal woher sie kam", () => {
  const r = verifyArtifact(hashText(APP), "freedom.html", [parseReleaseManifest(manifest(ECHT, APP))], VERTRAUT);
  assert.equal(r.status, "echt");
  assert.equal(r.version, "1.0.0");
  assert.match(r.message, /stimmt/);
});

test("Manipulierte Datei wird erkannt", () => {
  const r = verifyArtifact(
    hashText(GEFAELSCHT), "freedom.html",
    [parseReleaseManifest(manifest(ECHT, APP))], VERTRAUT,
  );
  assert.equal(r.status, "abweichend");
  assert.match(r.message, /KEINER veröffentlichten Version/);
  assert.match(r.message, /neu beziehen/);
});

test("DER Angriff: eigenes Manifest fuer eine manipulierte Datei", () => {
  // Ohne festgelegte Signierer koennte jeder seine Faelschung als echt
  // ausweisen. Die Pruefung ist nur so viel wert wie diese Liste.
  const manifeste = [
    parseReleaseManifest(manifest(ECHT, APP)),
    parseReleaseManifest(manifest(ANGREIFER, GEFAELSCHT, "9.9.9", 99_999)),
  ];
  const r = verifyArtifact(hashText(GEFAELSCHT), "freedom.html", manifeste, VERTRAUT);
  assert.equal(r.status, "abweichend", "das Manifest des Angreifers zaehlt nicht");
});

test("Ohne bekannten Signierer wird nichts behauptet", () => {
  // Ehrlich: "nicht pruefbar" ist etwas anderes als "gefaelscht".
  const r = verifyArtifact(
    hashText(APP), "freedom.html",
    [parseReleaseManifest(manifest(ANGREIFER, APP))], VERTRAUT,
  );
  assert.equal(r.status, "unbekannt");
  assert.match(r.message, /niemand für sie bürgt/);
});

test("Unbekannter Dateiname ergibt 'unbekannt', nicht 'abweichend'", () => {
  const r = verifyArtifact(hashText(APP), "anderes.html", [parseReleaseManifest(manifest(ECHT, APP))], VERTRAUT);
  assert.equal(r.status, "unbekannt");
});

test("Aeltere Version bleibt gueltig, solange ihr Manifest existiert", () => {
  const alt = "<html>v1</html>";
  const manifeste = [
    parseReleaseManifest(manifest(ECHT, alt, "1.0.0", 1000)),
    parseReleaseManifest(manifest(ECHT, APP, "2.0.0", 2000)),
  ];
  assert.equal(verifyArtifact(hashText(alt), "freedom.html", manifeste, VERTRAUT).status, "echt");
  assert.equal(verifyArtifact(hashText(APP), "freedom.html", manifeste, VERTRAUT).version, "2.0.0");
});

// ------------------------------------------------------------- Quellen

test("Neueste Version wird nach Datum bestimmt, nicht nach Reihenfolge", () => {
  const manifeste = [
    parseReleaseManifest(manifest(ECHT, APP, "2.0.0", 2000)),
    parseReleaseManifest(manifest(ECHT, "x", "1.0.0", 1000)),
  ];
  assert.equal(latestRelease(manifeste, VERTRAUT)!.version, "2.0.0");
  assert.equal(latestRelease([], VERTRAUT), null);
});

test("Manifest eines Fremden gilt nicht als neueste Version", () => {
  const manifeste = [
    parseReleaseManifest(manifest(ECHT, APP, "1.0.0", 1000)),
    parseReleaseManifest(manifest(ANGREIFER, GEFAELSCHT, "99.0.0", 99_999)),
  ];
  assert.equal(latestRelease(manifeste, VERTRAUT)!.version, "1.0.0");
});

test("Quellen: nicht-webbasierte zuerst", () => {
  // Wenn die Domain ausgefallen ist, hilft eine weitere Domain am wenigsten.
  const m: ReleaseManifest = {
    version: "1", releasedAt: 1, artifacts: [], signerPubkey: ECHT.pk,
    sources: ["https://a.io/app", "magnet:?xt=urn:btih:x", "https://b.io/app", "ipfs://Qm123"],
  };
  const s = allSources([m], VERTRAUT);
  assert.ok(s[0].startsWith("magnet:") || s[0].startsWith("ipfs://"));
  assert.equal(s.length, 4);
});

test("Quellen aus fremden Manifesten werden nicht uebernommen", () => {
  const fremd: ReleaseManifest = {
    version: "1", releasedAt: 1, artifacts: [], signerPubkey: ANGREIFER.pk,
    sources: ["https://boese.io/app"],
  };
  assert.equal(allSources([fremd], VERTRAUT).length, 0);
});

// ------------------------------------------------------------- Weitergabe

test("Weitergabe-Anleitung enthaelt Pruefsumme und Warnung", () => {
  const t = sharingInstructions(hashText(APP), "1.0.0");
  assert.ok(t.includes(hashText(APP)));
  assert.match(t, /sha256sum/);
  // Der wichtigste Satz: Ein Manifest neben der Datei waere wertlos.
  assert.match(t, /Relays/);
  assert.match(t, /austauschen/);
});
