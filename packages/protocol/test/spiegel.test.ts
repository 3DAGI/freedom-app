/**
 * Schritt 5.3a: Spiegel – Platzhalter, Hosting-Zahlziel aus der Spiegel-Datei,
 * Bezugsquellen. Dazu die echten Dateien in spiegel/: jedes Feld ist entweder
 * ein Platzhalter oder gültig – ein Tippfehler beim Ersetzen fällt hier auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROJEKT_REPO, baueRepoAnkuendigung, generateKeypair, istPlatzhalter, leseQuellen, leseRepoAnkuendigung, leseSpiegelDatei, projektRepo, solReferenz } from "../src/index.js";

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

test("5.9b: NIP-34-Ankündigung des Projekts – GitHub immer, Radicle erst, wenn gesetzt; nur gültige Maintainer", () => {
  const erster = "7".repeat(40);
  const ohne = projektRepo({ quellen: [{ art: "radicle", url: "PLATZHALTER:rad:<repository-id>" }] }, { ersterCommit: erster });
  assert.deepEqual(ohne.klon, ["https://github.com/3DAGI/freedom-app.git"], "Platzhalter bleibt draußen");
  assert.equal(ohne.ersterCommit, erster);
  const rad = "rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5";
  const mit = projektRepo({ quellen: [{ art: "radicle", url: rad }] }, { maintainer: ["a".repeat(64), "a".repeat(64), "kaputt"], ersterCommit: "zu-kurz" });
  assert.deepEqual(mit.klon, ["https://github.com/3DAGI/freedom-app.git", rad]);
  assert.deepEqual(mit.maintainer, ["a".repeat(64)]);
  assert.equal(mit.ersterCommit, undefined);
  // Das Event baut der NIP-34-Baustein – dieselbe Form wie für jedes Repo in der App
  const k = generateKeypair();
  const ev = baueRepoAnkuendigung(mit, k.pk);
  const gelesen = leseRepoAnkuendigung(ev);
  assert.deepEqual([gelesen.id, gelesen.klon, gelesen.web], [PROJEKT_REPO.id, mit.klon, [PROJEKT_REPO.github]]);
  // Der echte Stand der Quellen ergibt eine gültige Ankündigung
  const echt = projektRepo(JSON.parse(readFileSync(new URL("../../../spiegel/quellen.json", import.meta.url), "utf8")));
  assert.doesNotThrow(() => baueRepoAnkuendigung(echt, k.pk));
});
