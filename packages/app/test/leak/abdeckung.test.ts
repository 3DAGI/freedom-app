/**
 * Leak-Szenario „Abdeckung eintragen“ (Schritt 1.5): wie `trageAbdeckungEin()`
 * in `tabs/earn.ts` – der Standort wird lokal auf eine Zelle gerundet, nur die
 * Zelle geht ins Netz.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAYER_CELL_DEGREES, LocalSigner, buildCoverageAnnouncement, generateKeypair, regelKeinKlartext, toCell,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

const LAT = 52.520008;
const LON = 13.404954;
// Genau und auf vier Stellen (etwa 11 m) – beides darf nicht im Event stehen.
const GENAU = [String(LAT), String(LON), LAT.toFixed(4), LON.toFixed(4)];

for (const layer of ["lora", "bluetooth"] as const) {
  test(`Abdeckung (${layer}): nur die gerundete Zelle, nie der genaue Standort`, async () => {
    const { pool, relay } = aufzeichnung();
    const signer = new LocalSigner(generateKeypair().sk);
    const cell = toCell(LAT, LON, LAYER_CELL_DEGREES[layer]);
    await pool.publish(await signer.signEvent(buildCoverageAnnouncement({ pubkey: signer.publicKey(), layer, cell, region: "" })));
    assert.equal(relay.gesendet.length, 1);
    assert.deepEqual(regelKeinKlartext(relay.gesendet, GENAU), []);
  });
}

test("Verdrahtung: trageAbdeckungEin() rundet vor dem Senden", () => {
  const e = readFileSync(new URL("../../src/shell/tabs/earn.ts", import.meta.url), "utf8");
  assert.match(e, /const cell = toCell\(pos\.coords\.latitude, pos\.coords\.longitude, LAYER_CELL_DEGREES\[layer\]\);/);
  assert.match(e, /buildCoverageAnnouncement\(\{\s*pubkey: state\.keypair!\.pk, layer, cell, region: "",\s*\}\)/);
});
