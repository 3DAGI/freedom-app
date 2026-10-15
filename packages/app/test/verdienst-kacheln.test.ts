/**
 * Schritt C-54 (Oberflächen-Review 15.10.2026): Verdienen als Übersicht – Kacheln aus den Leistungs-Events (38010),
 * heute und in 30 Tagen je Kette; Beträge aus Fremddaten zählen nur als ganze msat. Ohne Knoten eine Checkliste,
 * gekoppelt gilt der gekoppelte Knoten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NostrEvent } from "@freedomstack/protocol";
import { einnahmenKacheln, summeText } from "../src/verdienst-kacheln.js";
import { setLang, t } from "../src/i18n.js";

setLang("de");
const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const JETZT = new Date(2026, 9, 15, 14, 0);
const s = (d: Date) => Math.floor(d.getTime() / 1000);
const ev = (zeit: number, msat: string, kette?: string): NostrEvent => ({
  id: "x", pubkey: "p", sig: "s", kind: 38010, content: "", created_at: zeit,
  tags: [["volume_msat", msat], ...(kette ? [["chain", kette]] : [])],
});

test("heute ab Mitternacht, 30 Tage, Aufträge – je Kette getrennt", () => {
  const k = einnahmenKacheln([
    ev(s(new Date(2026, 9, 15, 9, 0)), "21000"),
    ev(s(new Date(2026, 9, 15, 0, 0)), "1000", "solana"),
    ev(s(new Date(2026, 9, 14, 23, 59)), "5000"),
    ev(s(new Date(2026, 8, 20)), "7000"),
    ev(s(new Date(2026, 8, 1)), "999999"), // älter als 30 Tage
    ev(s(JETZT) + 60, "888888"), // aus der Zukunft
  ], JETZT);
  assert.deepEqual(k, { heute: { lnMsat: 21_000, solMsat: 1_000 }, monat: { lnMsat: 33_000, solMsat: 1_000 }, auftraege: 4 });
});

test("Fremddaten: nur ganze msat zählen, sonst 0 – der Auftrag zählt trotzdem", () => {
  const k = einnahmenKacheln([ev(s(JETZT) - 10, "1e9"), ev(s(JETZT) - 10, "-5"), ev(s(JETZT) - 10, "12.5"), ev(s(JETZT) - 10, "9".repeat(19))], JETZT);
  assert.deepEqual(k.monat, { lnMsat: 0, solMsat: 0 });
  assert.equal(k.auftraege, 4);
});

test("Text: sats, SOL nur mit Kurs als SOL, beides mit „·“, leer als 0 sats", () => {
  assert.equal(summeText({ lnMsat: 0, solMsat: 0 }), "0 sats");
  assert.equal(summeText({ lnMsat: 21_000_000, solMsat: 0 }), "21.000 sats");
  const mitKurs = summeText({ lnMsat: 21_000_000, solMsat: 150_000_000 }, { satsProSol: 150_000 });
  assert.match(mitKurs, /^21\.000 sats · .*SOL/);
  assert.doesNotMatch(summeText({ lnMsat: 0, solMsat: 150_000_000 }), /^0 sats/);
});

test("verdrahtet: Kacheln aus loadEarnings(), Stand aus dem Angebot, Checkliste ohne Knoten, gekoppelter Knoten zuerst", () => {
  const earn = quelle("../src/shell/tabs/earn.ts");
  assert.match(earn, /const k = einnahmenKacheln\(sorted, jetzt\);/);
  assert.match(earn, /since: Math\.floor\(jetzt\.getTime\(\) \/ 1000\) - 30 \* 86_400,/);
  assert.match(earn, /sorted\.slice\(0, 20\)\.map/, "die Liste zeigt weiter die neuesten 20");
  const ui = quelle("../src/shell/verdienst-ui.ts");
  assert.match(ui, /return meineKopplung\(\)\?\.knoten \?\? state\.keypair\?\.pk;/);
  assert.match(ui, /stand\.textContent = angebot \? t\("earn\.standAktiv"\) : t\("earn\.standKeins"\);/);
  assert.match(ui, /\$\("#earn-check-koppeln"\)\?\.addEventListener\("click", \(\) => document\.getElementById\("knoten-koppeln"\)\?\.click\(\)\);/);
  // Selbstauskunft – die Kachel sagt es dazu
  assert.match(t("earn.kachelHinweis"), /Wie dein Knoten es meldet/);
});
