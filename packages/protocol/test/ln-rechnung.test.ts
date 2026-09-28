/**
 * Schritt 6.3b: Lightning-Rechnung versiegelt bei einem Kontakt erfragen –
 * Anfrage und Antwort nur im Umschlag, die Antwort nur vom Gefragten zur
 * eigenen Anfrage und nur mit einer Rechnung über genau den Betrag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import {
  KIND_RECHNUNGS_ANFRAGE, RECHNUNG_MAX_MSAT, buildRechnungsAnfrage, buildRechnungsAntwort, oeffneRechnungsAnfrage,
  oeffneRechnungsAntwort, rechnungsBetragOk,
} from "../src/ln-rechnung.js";
import { regelAutorNicht, regelKeinBolt11, regelKeinKlartext } from "../src/leak-rules.js";
import { knotenSchluessel, rechnung } from "./bolt11-hilfe.js";

const zahler = generateKeypair();
const empfaenger = generateKeypair();
const sZ = new LocalSigner(zahler.sk);
const sE = new LocalSigner(empfaenger.sk);
const knoten = knotenSchluessel();
const PR_21 = rechnung(knoten, "lnbc210n", new Uint8Array(32).fill(7)); // 21 sats

test("6.3b: Anfrage und Antwort – nur Umschläge, weder Betrag noch Rechnung noch Identität offen", async () => {
  const { wrap, anfrageId } = await buildRechnungsAnfrage({ von: sZ, anPk: empfaenger.pk, betragMsat: 21_000 });
  const a = await oeffneRechnungsAnfrage(wrap, sE);
  assert.deepEqual(a && { von: a.von, anfrageId: a.anfrageId, betragMsat: a.betragMsat }, { von: zahler.pk, anfrageId, betragMsat: 21_000 });

  const antwort = await buildRechnungsAntwort({ von: sE, anPk: zahler.pk, anfrageId, bolt11: PR_21 });
  assert.deepEqual(await oeffneRechnungsAntwort(antwort, sZ, { vonPk: empfaenger.pk, anfrageId, betragMsat: 21_000 }), { bolt11: PR_21 });

  const alle = [wrap, antwort];
  assert.ok(alle.every((e) => e.kind === 1059));
  assert.deepEqual(regelKeinBolt11(alle), []);
  assert.deepEqual(regelKeinKlartext(alle, ["21000", PR_21]), []);
  assert.deepEqual(regelAutorNicht(alle, zahler.pk), []);
  assert.deepEqual(regelAutorNicht(alle, empfaenger.pk), []);
});

test("6.3b: Antwort nur vom Gefragten, zur eigenen Anfrage, über genau den Betrag", async () => {
  const { anfrageId } = await buildRechnungsAnfrage({ von: sZ, anPk: empfaenger.pk, betragMsat: 21_000 });
  const erwartet = { vonPk: empfaenger.pk, anfrageId, betragMsat: 21_000 };
  const fremd = new LocalSigner(generateKeypair().sk);
  assert.equal(await oeffneRechnungsAntwort(await buildRechnungsAntwort({ von: fremd, anPk: zahler.pk, anfrageId, bolt11: PR_21 }), sZ, erwartet), null, "fremder Absender");
  assert.equal(await oeffneRechnungsAntwort(await buildRechnungsAntwort({ von: sE, anPk: zahler.pk, anfrageId: "ab".repeat(32), bolt11: PR_21 }), sZ, erwartet), null, "andere Anfrage");
  const teurer = rechnung(knoten, "lnbc2100n", new Uint8Array(32).fill(8));
  assert.equal(await oeffneRechnungsAntwort(await buildRechnungsAntwort({ von: sE, anPk: zahler.pk, anfrageId, bolt11: teurer }), sZ, erwartet), null, "anderer Betrag");
  const offen = rechnung(knoten, "lnbc", new Uint8Array(32).fill(9));
  assert.equal(await oeffneRechnungsAntwort(await buildRechnungsAntwort({ von: sE, anPk: zahler.pk, anfrageId, bolt11: offen }), sZ, erwartet), null, "ohne Betrag");
  await assert.rejects(buildRechnungsAntwort({ von: sE, anPk: zahler.pk, anfrageId, bolt11: "lnbc1kaputt" }));
  // Eine Anfrage ist keine Antwort (und umgekehrt)
  const anfrage = await buildRechnungsAnfrage({ von: sE, anPk: zahler.pk, betragMsat: 21_000 });
  assert.equal(await oeffneRechnungsAntwort(anfrage.wrap, sZ, erwartet), null);
});

test("6.3b: Beträge nur ganze sats bis 0,1 BTC; kaputte Anfragen sind keine", async () => {
  assert.deepEqual([1000, 21_000, RECHNUNG_MAX_MSAT].map(rechnungsBetragOk), [true, true, true]);
  assert.deepEqual([0, 999, 1500, RECHNUNG_MAX_MSAT + 1000, 1.5e3 + 0.5, NaN].map(rechnungsBetragOk), [false, false, false, false, false, false]);
  await assert.rejects(buildRechnungsAnfrage({ von: sZ, anPk: empfaenger.pk, betragMsat: 1500 }));
  await assert.rejects(buildRechnungsAnfrage({ von: sZ, anPk: "kein-schluessel", betragMsat: 21_000 }));
  // Von Hand gebaut: Betrag kaputt → keine Anfrage
  const { giftWrapMitSigner } = await import("../src/gift-wrap.js");
  const kern = (amount: string) => ({ pubkey: zahler.pk, kind: KIND_RECHNUNGS_ANFRAGE, created_at: 1_790_000_000, tags: [["p", empfaenger.pk], ["amount", amount]], content: "" });
  for (const b of ["-1000", "1e6", "abc", "999", "10000000001000"]) {
    assert.equal(await oeffneRechnungsAnfrage(await giftWrapMitSigner(kern(b), sZ, empfaenger.pk), sE), null, b);
  }
});
