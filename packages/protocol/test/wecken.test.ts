/**
 * Wecken über den eigenen Knoten (B-12a, W1 A, W2 A): An- und Abmeldung nur
 * versiegelt mit Besitzer-Nachweis; die Push-Adresse steht nie offen; nur
 * https-Adressen öffentlicher Hosts; die Antwort nur in fester Form.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  KIND_DVM_WECKEN, KIND_GIFT_WRAP, LocalSigner, WECKEN_GRENZEN, WECK_SCHLUESSEL, baueWeckAnmeldung, generateKeypair, getTag, istBesitzer,
  knotenStatusText, leseKnotenStatus, leseWeckAnmeldung, leseWeckAntwort, neueKopplung, openPrivateKundenEvent, pruefeWeckEndpunkt,
  weckAntwortText, type KnotenStatus,
} from "../src/index.js";

const ENDPUNKT = "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH";

test("B-12a: baueWeckAnmeldung – versiegelt an den Knoten, Kern 5078 mit Aktion, Adresse und Schlüsseln, mit Nachweis; offen steht nichts davon", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const person = generateKeypair().pk, geraet = generateKeypair().pk;
  const { wrap, requestId } = await baueWeckAnmeldung({ sitzung, kopplung: k, anmeldung: { aktion: "an", endpunkt: ENDPUNKT, schluessel: [person, geraet] } });
  assert.equal(wrap.kind, KIND_GIFT_WRAP);
  assert.equal(getTag(wrap, "p"), knoten.pk);
  const offen = JSON.stringify(wrap);
  for (const geheim of [k.geheimnis, "fcm.googleapis.com", person, geraet, sitzung.publicKey()]) assert.ok(!offen.includes(geheim), "nichts davon offen");
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.kind, KIND_DVM_WECKEN);
  assert.ok(istBesitzer(r.request, [k.geheimnis], r.request.created_at), "mit Nachweis");
  assert.deepEqual(leseWeckAnmeldung(r.request), { aktion: "an", endpunkt: ENDPUNKT, schluessel: [person, geraet] });
  // Abmelden: nur die Adresse
  const ab = await baueWeckAnmeldung({ sitzung, kopplung: k, anmeldung: { aktion: "ab", endpunkt: ENDPUNKT, schluessel: [] } });
  const rab = await openPrivateKundenEvent(ab.wrap, new LocalSigner(knoten.sk));
  assert.ok(rab.ok);
  assert.deepEqual(leseWeckAnmeldung(rab.request), { aktion: "ab", endpunkt: ENDPUNKT, schluessel: [] });
});

test("B-12a: Push-Adresse – nur https zu öffentlichen Hosts, ohne Zugangsdaten, begrenzt", () => {
  assert.equal(pruefeWeckEndpunkt(ENDPUNKT), ENDPUNKT);
  assert.equal(pruefeWeckEndpunkt("https://web.push.apple.com/QGuQyavXutnMqXhq"), "https://web.push.apple.com/QGuQyavXutnMqXhq");
  assert.equal(pruefeWeckEndpunkt("https://updates.push.services.mozilla.com/wpush/v2/gAAAAA"), "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA");
  for (const kaputt of [
    "http://fcm.googleapis.com/fcm/send/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.7/x", "https://[::1]/x",
    "https://[::ffff:7f00:1]/x", "https://192.168.1.5/x", "https://drucker.local/x", "https://intranet/x", "https://nutzer:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com/x#frag", "kein url", "", `https://fcm.googleapis.com/${"x".repeat(WECKEN_GRENZEN.endpunktZeichen)}`,
  ]) assert.equal(pruefeWeckEndpunkt(kaputt), null, kaputt.slice(0, 60));
});

test("B-12a: ungültige Anmeldungen gehen nicht hinaus und werden im Knoten nicht gelesen", async () => {
  const k = neueKopplung(generateKeypair().pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const pk = generateKeypair().pk;
  for (const anmeldung of [
    { aktion: "an" as const, endpunkt: "http://x.example/push", schluessel: [pk] },
    { aktion: "an" as const, endpunkt: ENDPUNKT, schluessel: [] },
    { aktion: "an" as const, endpunkt: ENDPUNKT, schluessel: [pk, pk] },
    { aktion: "an" as const, endpunkt: ENDPUNKT, schluessel: [pk.toUpperCase()] },
    { aktion: "an" as const, endpunkt: ENDPUNKT, schluessel: Array.from({ length: WECKEN_GRENZEN.schluessel + 1 }, () => generateKeypair().pk) },
    { aktion: "ab" as const, endpunkt: ENDPUNKT, schluessel: [pk] },
    { aktion: "weg" as "an", endpunkt: ENDPUNKT, schluessel: [pk] },
  ]) await assert.rejects(baueWeckAnmeldung({ sitzung, kopplung: k, anmeldung }), /Weck-Anmeldung ungültig/);
  const kern = (params: string[][]) => ({ kind: KIND_DVM_WECKEN, tags: params.map((p) => ["param", ...p]) });
  assert.equal(leseWeckAnmeldung(kern([["aktion", "an"], ["endpunkt", ENDPUNKT], ["endpunkt", ENDPUNKT], ["schluessel", pk]])), null, "eine Adresse");
  assert.equal(leseWeckAnmeldung(kern([["aktion", "an"], ["endpunkt", ENDPUNKT], ["schluessel", pk], ["befehl", "rm"]])), null, "nichts Unbekanntes");
  assert.equal(leseWeckAnmeldung(kern([["endpunkt", ENDPUNKT], ["schluessel", pk]])), null, "ohne Aktion");
  assert.equal(leseWeckAnmeldung({ kind: 5050, tags: [["param", "aktion", "an"], ["param", "endpunkt", ENDPUNKT], ["param", "schluessel", pk]] }), null, "anderes Kind");
});

test("B-12a: Antwort und Weckschlüssel im Status – nur in fester Form", () => {
  assert.deepEqual(leseWeckAntwort(weckAntwortText({ aktion: "an", schluessel: 2 })), { aktion: "an", schluessel: 2 });
  assert.deepEqual(leseWeckAntwort(weckAntwortText({ aktion: "ab", schluessel: 0 })), { aktion: "ab", schluessel: 0 });
  for (const kaputt of ["", "{", "null", '{"aktion":"an"}', '{"aktion":"an","schluessel":-1}', '{"aktion":"an","schluessel":21}',
    '{"aktion":"ab","schluessel":1}', '{"aktion":"x","schluessel":1}', '{"aktion":"an","schluessel":"1"}']) {
    assert.equal(leseWeckAntwort(kaputt), null, kaputt);
  }
  // Ein echter VAPID-Schlüssel (P-256, unkomprimiert, base64url) passt; anderes nicht
  const roh = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).subarray(-65);
  const echt = roh.toString("base64url");
  assert.match(echt, WECK_SCHLUESSEL);
  const basis: KnotenStatus = {
    fassung: "0.1.0", seit: 1, rollen: ["ki"], modelle: [], auftraege: { erledigt: 0, gratis: 0, abgelehnt: 0 }, abgerechnetMsat: 0, speicher: null, relay: null,
  };
  assert.equal(leseKnotenStatus(knotenStatusText({ ...basis, weckSchluessel: echt }))!.weckSchluessel, echt);
  assert.equal("weckSchluessel" in leseKnotenStatus(knotenStatusText(basis))!, false, "ohne Weckdienst kein Feld");
  for (const falsch of ["", echt.slice(1), `A${echt.slice(1)}`, `${echt}=`, echt.replace(/.$/, "+")]) {
    assert.equal(leseKnotenStatus(JSON.stringify({ ...JSON.parse(knotenStatusText(basis)), weckSchluessel: falsch })), null, falsch);
  }
});
