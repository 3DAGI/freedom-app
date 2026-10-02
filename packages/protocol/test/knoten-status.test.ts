/**
 * Status meines Knotens (B-11a, L6 A): versiegelt mit Besitzer-Nachweis
 * gefragt, die Antwort nur in fester Form – Zahlen, feste Kennungen,
 * Modellnamen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_GIFT_WRAP, LocalSigner, STATUS_GRENZEN, STATUS_ROLLEN, baueStatusAuftrag, generateKeypair, getTag,
  istBesitzer, knotenStatusText, leseKnotenStatus, neueKopplung, openPrivateKundenEvent, type KnotenStatus,
} from "../src/index.js";

const beispiel = (): KnotenStatus => ({
  fassung: "0.1.0",
  seit: 1_790_000_000,
  rollen: ["ki", "relay", "speicher"],
  modelle: ["qwen3.8:27b", "nemotron-3.5-lightning:30b-a3b-nvfp4"],
  auftraege: { erledigt: 12, gratis: 4, abgelehnt: 1 },
  abgerechnetMsat: 84_000,
  speicher: { belegtBytes: 1_048_576, quotaBytes: 0, gehalten: 24 },
  relay: { events: 310, verbindungen: 3 },
});

test("B-11a: baueStatusAuftrag – versiegelt an den Knoten, Kern 5077 ohne Gebot, mit Nachweis; offen steht davon nichts", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap, requestId } = await baueStatusAuftrag({ sitzung, kopplung: k });
  assert.equal(wrap.kind, KIND_GIFT_WRAP);
  assert.equal(getTag(wrap, "p"), knoten.pk);
  const offen = JSON.stringify(wrap);
  for (const geheim of [k.geheimnis, sitzung.publicKey(), String(KIND_DVM_KNOTEN_STATUS)]) assert.ok(!offen.includes(geheim), "nichts davon offen");
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.kind, KIND_DVM_KNOTEN_STATUS);
  assert.equal(getTag(r.request, "bid"), "0");
  assert.ok(istBesitzer(r.request, [k.geheimnis], r.request.created_at), "mit Nachweis des Besitzers");
  assert.ok(!istBesitzer(r.request, [neueKopplung(knoten.pk).geheimnis], r.request.created_at), "ein anderes Geheimnis passt nicht");
});

test("B-11a: Antwort – gelesen wird genau, was geschrieben wurde; unbekannte Felder bleiben unbeachtet", () => {
  const s = beispiel();
  assert.deepEqual(leseKnotenStatus(knotenStatusText(s)), s);
  const ohne = { ...s, speicher: null, relay: null, rollen: [] as KnotenStatus["rollen"], modelle: [] };
  assert.deepEqual(leseKnotenStatus(knotenStatusText(ohne)), ohne);
  // Rollen in fester Reihenfolge, Unbekanntes im Eingang fällt beim Schreiben weg
  assert.deepEqual(leseKnotenStatus(knotenStatusText({ ...s, rollen: ["speicher", "ki"] }))!.rollen, ["ki", "speicher"]);
  const mehr = JSON.stringify({ ...JSON.parse(knotenStatusText(s)), einrichtung: [{ stufe: "ok" }] });
  assert.deepEqual(leseKnotenStatus(mehr), s, "ein neuerer Knoten darf mehr melden");
  assert.ok(STATUS_ROLLEN.includes("ki") && STATUS_ROLLEN.length === 10);
});

test("B-11a: Antwort – alles andere ist null", () => {
  const gut = JSON.parse(knotenStatusText(beispiel())) as Record<string, unknown>;
  const mit = (aenderung: Record<string, unknown>) => JSON.stringify({ ...gut, ...aenderung });
  for (const kaputt of [
    "", "{", "null", "[]", '"status"', "Speicher voll",
    mit({ fassung: "" }), mit({ fassung: "0.1.0 <b>" }), mit({ fassung: "x".repeat(STATUS_GRENZEN.fassungZeichen + 1) }), mit({ fassung: 1 }),
    mit({ seit: -1 }), mit({ seit: 1.5 }), mit({ seit: "1790000000" }),
    mit({ rollen: ["ki", "ki"] }), mit({ rollen: ["root"] }), mit({ rollen: "ki" }),
    mit({ modelle: ["a", "a"] }), mit({ modelle: [""] }), mit({ modelle: ["x".repeat(STATUS_GRENZEN.modellZeichen + 1)] }),
    mit({ modelle: ["zeile\nzwei"] }), mit({ modelle: [7] }), mit({ modelle: Array.from({ length: STATUS_GRENZEN.modelle + 1 }, (_, i) => `m${i}`) }),
    mit({ auftraege: { erledigt: 1, gratis: 2, abgelehnt: 0 } }), mit({ auftraege: { erledigt: 1, gratis: 0 } }), mit({ auftraege: null }),
    mit({ abgerechnetMsat: -5 }), mit({ abgerechnetMsat: 2 ** 60 }),
    mit({ speicher: { belegtBytes: 1, quotaBytes: 2 } }), mit({ speicher: [] }), mit({ speicher: undefined }),
    mit({ relay: { events: "3", verbindungen: 1 } }),
    JSON.stringify({ ...gut, modelle: ["x"], fuell: "y".repeat(STATUS_GRENZEN.zeichen) }),
  ]) assert.equal(leseKnotenStatus(kaputt), null, kaputt.slice(0, 80));
});
