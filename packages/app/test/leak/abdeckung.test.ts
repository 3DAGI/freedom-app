/**
 * Leak-Szenario „Abdeckung eintragen“ (Schritt 1.5): wie `trageAbdeckungEin()`
 * in `tabs/earn.ts` – der Standort wird lokal auf eine Zelle gerundet, nur die
 * Zelle geht ins Netz. Seit 5.10 mit einem Wegwerfschluessel je Eintrag, nie
 * mit der Identitaet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAYER_CELL_DEGREES, baueCoverageEintrag, generateKeypair, regelAutorNicht, regelKeinKlartext, toCell,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

const LAT = 52.520008;
const LON = 13.404954;
// Genau und auf vier Stellen (etwa 11 m) – beides darf nicht im Event stehen.
const GENAU = [String(LAT), String(LON), LAT.toFixed(4), LON.toFixed(4)];

for (const layer of ["lora", "bluetooth"] as const) {
  test(`Abdeckung (${layer}): nur die gerundete Zelle, nie der genaue Standort, nie die Identitaet`, async () => {
    const { pool, relay } = aufzeichnung();
    const identitaet = generateKeypair().pk;
    const cell = toCell(LAT, LON, LAYER_CELL_DEGREES[layer]);
    await pool.publish(baueCoverageEintrag({ layer, cell, region: "" }).event);
    assert.equal(relay.gesendet.length, 1);
    assert.deepEqual(regelKeinKlartext(relay.gesendet, GENAU), []);
    assert.deepEqual(regelAutorNicht(relay.gesendet, identitaet), []);
  });
}

test("Verdrahtung: trageAbdeckungEin() rundet vor dem Senden", () => {
  const e = readFileSync(new URL("../../src/shell/tabs/earn.ts", import.meta.url), "utf8");
  // Seit C.4b aus dem schon gerundeten Ort (0,5°, Vielfaches jeder Zellgroesse) – der genaue Ort wird nur einmal gelesen
  assert.match(e, /const ort = rundeStandort\(pos\.coords\.latitude, pos\.coords\.longitude\);/);
  assert.match(e, /const ort = await holeStandort\(\);\n\s+if \(!ort\) return toast\(t\("earn\.standortFehlt"\), true\);/);
  assert.match(e, /const cell = toCell\(ort\[0\], ort\[1\], LAYER_CELL_DEGREES\[layer\]\);/);
  assert.equal((e.match(/pos\.coords/g) ?? []).length, 2);
  // Seit 5.10: Wegwerfschluessel je Eintrag statt Identitaet.
  assert.match(e, /const \{ event, wegwerfSk \} = baueCoverageEintrag\(\{ layer, cell, region: "" \}\);/);
  assert.doesNotMatch(e, /buildCoverageAnnouncement\(\{\s*pubkey: state\.keypair/);
});
