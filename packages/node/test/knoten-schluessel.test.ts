/**
 * Schlüssel des Knotens (Sammlung B-40, Lauf 2 des lokalen Agenten): nie bei
 * jedem Start ein neuer, nie der geheime im Log. Aus `NODE_SECRET_KEY` (streng)
 * oder `~/.freedom/node-key` (beim ersten Start angelegt, 0600).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeypair, toHex } from "@freedomstack/protocol";
import { SchluesselFehler, knotenSchluesselDatei, ladeKnotenSchluessel } from "../src/knoten-schluessel.js";

const neueDatei = () => join(mkdtempSync(join(tmpdir(), "knoten-")), ".freedom", "node-key");

test("B-40: ohne Umgebung beim ersten Start angelegt (0600), danach immer derselbe Schlüssel", () => {
  const datei = neueDatei();
  const erst = ladeKnotenSchluessel(undefined, datei, { anlegen: true });
  assert.equal(erst.quelle, "neu");
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  assert.equal(readFileSync(datei, "utf8").trim(), toHex(erst.sk));
  const zweit = ladeKnotenSchluessel(undefined, datei, { anlegen: true });
  assert.equal(zweit.quelle, "datei");
  assert.equal(zweit.pk, erst.pk, "ein Neustart behält die Identität");
  // Leer gesetzt (Compose: "${NODE_SECRET_KEY:-}") gilt als nicht gesetzt
  assert.equal(ladeKnotenSchluessel("  ", datei, { anlegen: true }).pk, erst.pk);
  assert.equal(knotenSchluesselDatei("/home/x"), "/home/x/.freedom/node-key", "dieselbe Datei wie der Installer");
});

test("B-40: die Umgebung geht vor – nur streng, sonst kein Start; die Datei bleibt unberührt", () => {
  const datei = neueDatei();
  const kp = generateKeypair();
  const hex = toHex(kp.sk);
  const aus = ladeKnotenSchluessel(hex.toUpperCase(), datei, { anlegen: true });
  assert.equal(aus.quelle, "umgebung");
  assert.equal(aus.pk, kp.pk);
  assert.equal(existsSync(datei), false, "mit Umgebung keine Datei anlegen");
  // fromHex() schnitte still ab (Fallstrick „Hex aus Fremddaten“) – hier wirft es
  for (const kaputt of [hex.slice(1), `0x${hex}`, `${hex.slice(0, 63)}g`, `${hex}00`]) {
    assert.throws(() => ladeKnotenSchluessel(kaputt, datei, { anlegen: true }), SchluesselFehler, kaputt.length.toString());
  }
  assert.equal(existsSync(datei), false);
});

test("B-40: eine defekte Datei wird nie ersetzt; ohne Schlüssel legt nur der Knoten an, nicht `npm run koppeln`", () => {
  const datei = neueDatei();
  assert.throws(() => ladeKnotenSchluessel(undefined, datei, { anlegen: false }), SchluesselFehler);
  assert.equal(existsSync(datei), false);
  ladeKnotenSchluessel(undefined, datei, { anlegen: true });
  writeFileSync(datei, "kein schluessel\n");
  assert.throws(() => ladeKnotenSchluessel(undefined, datei, { anlegen: true }), (e: unknown) =>
    e instanceof SchluesselFehler && !e.message.includes("kein schluessel"), "fester Text, nie der Inhalt");
  assert.equal(readFileSync(datei, "utf8"), "kein schluessel\n", "nie still überschrieben");
});

test("B-40: Verdrahtung – Knoten und `npm run koppeln` laden denselben Schlüssel, der geheime geht nie ins Log", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const koppeln = readFileSync(new URL("../src/koppeln.ts", import.meta.url), "utf8");
  assert.match(main, /ladeKnotenSchluessel\(process\.env\.NODE_SECRET_KEY, datei, \{ anlegen: true \}\)/);
  assert.match(koppeln, /ladeKnotenSchluessel\(process\.env\.NODE_SECRET_KEY, knotenSchluesselDatei\(\), \{ anlegen: false \}\)/);
  assert.doesNotMatch(main, /generateKeypair\(\)/, "kein neuer Schlüssel je Start");
  // Was der Knoten über den Schlüssel loggt, nennt nur Quelle und pubkey
  const logs = [...main.matchAll(/console\.(?:log|error)\(([^;]*)\);/g)].map((m) => m[1]!).filter((z) => /k\.|schl[uü]ssel/i.test(z));
  assert.ok(logs.length >= 2);
  for (const z of logs) assert.doesNotMatch(z, /\bsk\b|k\.sk|toHex\(k|Buffer\.from\(/, z);
  const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
  assert.match(compose, /NODE_SECRET_KEY: "\$\{NODE_SECRET_KEY:-\}"/, "Compose reicht die Variable durch, leer heißt Datei");
});
