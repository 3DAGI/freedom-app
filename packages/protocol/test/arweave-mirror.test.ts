/**
 * Tests fuer den Arweave-Spiegel.
 *
 * Er ist der Weg, ueber den Treasury-Ankuendigungen dauerhaft nachlesbar
 * bleiben, auch wenn alle Relays sie vergessen. Ohne Netz laesst sich der
 * Upload nicht pruefen — aber sehr wohl, dass FEHLENDE Zugangsdaten zu einem
 * klaren Fehler fuehren statt zu einem stillen Nichts. Genau das ist der
 * Fehlerfall, der im Betrieb unbemerkt bliebe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mirrorAnnouncement } from "../src/arweave-mirror.js";

const ankuendigung = {
  id: "a".repeat(64),
  kind: 38050,
  tags: [["week", "2810"], ["address", "So11111111111111111111111111111111111111112"]],
  content: "",
  pubkey: "b".repeat(64),
  created_at: 1_800_000_000,
  sig: "c".repeat(128),
};

test("Ohne Zugangsdaten gibt es einen klaren Fehler, kein stilles Nichts", async () => {
  // Ein Spiegel, der ohne Schluessel einfach nichts tut, sieht im Log aus wie
  // Erfolg — und niemand merkt, dass nichts gespiegelt wird.
  await assert.rejects(
    () => mirrorAnnouncement(ankuendigung, {}),
    /JWK|jwk|keine/i,
  );
});

test("Nicht vorhandener Schluesselpfad wird als solcher gemeldet", async () => {
  await assert.rejects(
    () => mirrorAnnouncement(ankuendigung, { jwkPath: "/gibt/es/nicht.json" }),
    /JWK|jwk|keine/i,
  );
});

test("Kaputte Schluesseldatei bricht mit Fehler ab, nicht mit Erfolg", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freedom-ar-"));
  try {
    const p = join(dir, "kaputt.json");
    await writeFile(p, "{kein gueltiges json");
    await assert.rejects(() => mirrorAnnouncement(ankuendigung, { jwkPath: p }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Ungueltiges JWK-JSON wird abgelehnt", async () => {
  await assert.rejects(() => mirrorAnnouncement(ankuendigung, { jwkJson: "{nicht json" }));
});

test("Der Spiegel ist optional — sein Fehlen darf nichts anderes aufhalten", async () => {
  // Das ist die Eigenschaft, auf die es ankommt: main.ts faengt den Fehler ab
  // und laeuft weiter. Hier wird nur belegt, dass ueberhaupt ein FEHLER
  // kommt, den man abfangen kann.
  let gefangen = false;
  try {
    await mirrorAnnouncement(ankuendigung, {});
  } catch {
    gefangen = true;
  }
  assert.equal(gefangen, true, "es muss ein abfangbarer Fehler sein");
});
