/**
 * Schritt 5.3a: Spiegel – Platzhalter, Hosting-Zahlziel aus der Spiegel-Datei,
 * Bezugsquellen. Dazu die echten Dateien in spiegel/: jedes Feld ist entweder
 * ein Platzhalter oder gültig – ein Tippfehler beim Ersetzen fällt hier auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { istPlatzhalter, leseQuellen, leseSpiegelDatei, solReferenz } from "../src/index.js";

const SOL = solReferenz(new Uint8Array(32).fill(4));
const datei = (lud16: unknown, sol: unknown, version: unknown = 1) => ({ version, zahlziel: { lud16, sol } });

test("5.3a: Platzhalter erkennen", () => {
  assert.ok(istPlatzhalter("PLATZHALTER:hosting"));
  assert.ok(istPlatzhalter("  PLATZHALTER: x"));
  assert.ok(!istPlatzhalter("hosting@beispiel.org"));
  assert.ok(!istPlatzhalter(undefined));
});

test("5.3a: Spiegel-Datei – nur gültige, selbst eingetragene Adressen; Platzhalter zählen nicht", () => {
  assert.deepEqual(leseSpiegelDatei(datei("Hosting@Beispiel.org", SOL)), { lud16: "hosting@beispiel.org", sol: SOL });
  assert.deepEqual(leseSpiegelDatei(datei("PLATZHALTER:x", SOL)), { sol: SOL });
  assert.equal(leseSpiegelDatei(datei("PLATZHALTER:x", "PLATZHALTER:y")), null);
  assert.deepEqual(leseSpiegelDatei(datei("hosting@localhost.local", SOL)), { sol: SOL }, "kein lokaler Host");
  assert.deepEqual(leseSpiegelDatei(datei("kein-lud16", "0xabc")), null);
  assert.equal(leseSpiegelDatei(datei("hosting@beispiel.org", SOL, 2)), null, "unbekannte Version");
  for (const kaputt of [null, "text", 5, {}, { version: 1 }, { version: 1, zahlziel: null }]) assert.equal(leseSpiegelDatei(kaputt), null);
});

test("5.3a: Bezugsquellen – Form je Art geprüft, Platzhalter und Tippfehler offen, Unbekanntes weg", () => {
  const onion = `http://${"a".repeat(56)}.onion/freedom.html`;
  const r = leseQuellen({ quellen: [
    { art: "offiziell", url: "https://freedomstack.io/freedom.html" },
    { art: "codeberg", url: "https://nutzer.codeberg.page/freedom-app/freedom.html" },
    { art: "onion", url: onion },
    { art: "radicle", url: "rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5" },
    { art: "ipfs", url: `ipfs://bafy${"a".repeat(55)}` },
    { art: "arweave", url: `ar://${"A".repeat(43)}` },
    { art: "blossom", url: `https://blossom.beispiel.org/${"ab".repeat(32)}.html` },
    { art: "torrent", url: `magnet:?xt=urn:btih:${"c".repeat(40)}&dn=freedom.html` },
    { art: "codeberg", url: "PLATZHALTER:https://x.codeberg.page/" },
    { art: "onion", url: "http://kurz.onion/" },
    { art: "offiziell", url: "http://ohne-tls.example/freedom.html" },
    { art: "ftp", url: "ftp://x" },
  ] });
  assert.deepEqual(r.gesetzt.map((q) => q.art), ["offiziell", "codeberg", "onion", "radicle", "ipfs", "arweave", "blossom", "torrent"]);
  assert.deepEqual(r.offen, ["codeberg", "onion", "offiziell"]);
  assert.deepEqual(leseQuellen(null), { gesetzt: [], offen: [] });
});

test("5.3a: die Dateien in spiegel/ – jedes Feld Platzhalter oder gültig", () => {
  const lies = (p: string) => JSON.parse(readFileSync(new URL(`../../../spiegel/${p}`, import.meta.url), "utf8"));
  const spiegel = lies("freedom-spiegel.json") as { version: number; zahlziel: { lud16: string; sol: string } };
  assert.equal(spiegel.version, 1);
  for (const [feld, wert] of Object.entries(spiegel.zahlziel)) {
    if (istPlatzhalter(wert)) continue;
    const ziel = leseSpiegelDatei({ version: 1, zahlziel: { [feld]: wert } });
    assert.ok(ziel && (ziel as Record<string, string>)[feld], `spiegel/freedom-spiegel.json: ${feld} ist weder Platzhalter noch gültig`);
  }
  const quellen = lies("quellen.json") as { quellen: { art: string; url: string }[] };
  const r = leseQuellen(quellen);
  for (const q of quellen.quellen) {
    if (istPlatzhalter(q.url)) continue;
    assert.ok(r.gesetzt.some((g) => g.url === q.url.trim()), `spiegel/quellen.json: ${q.art} ist weder Platzhalter noch gültig`);
  }
});
