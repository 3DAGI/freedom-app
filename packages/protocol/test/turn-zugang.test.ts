/**
 * Zugang zum TURN des eigenen Knotens (B-13a, T1 A, T2 A): Anfrage nur
 * versiegelt mit Besitzer-Nachweis; der Zugang nur in der Form von TURN-REST,
 * mit Ablauf in der nahen Zukunft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  KIND_DVM_TURN, KIND_GIFT_WRAP, LocalSigner, TURN_GRENZEN, baueTurnAnfrage, generateKeypair, getTag, istBesitzer, leseTurnZugang,
  neueKopplung, openPrivateKundenEvent, turnZugangText, type TurnZugang,
} from "../src/index.js";

const JETZT = 1_790_000_000;
const zugang = (bis = JETZT + 3600): TurnZugang => {
  const nutzer = `${bis}:Zufall_abc123`;
  return { urls: ["turns:knoten.example:5349?transport=tcp", "turn:knoten.example:3478"], nutzer, passwort: createHmac("sha1", "geheim").update(nutzer).digest("base64"), bis };
};

test("B-13a: baueTurnAnfrage – versiegelt an den Knoten, Kern 5079 ohne Gebot, mit Nachweis", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap, requestId } = await baueTurnAnfrage({ sitzung, kopplung: k });
  assert.equal(wrap.kind, KIND_GIFT_WRAP);
  assert.equal(getTag(wrap, "p"), knoten.pk);
  for (const geheim of [k.geheimnis, sitzung.publicKey()]) assert.ok(!JSON.stringify(wrap).includes(geheim));
  // Das Kind steht nur im versiegelten Kern: offen nur 1059 mit dem Empfänger – nie eine Ziffernfolge im Zufall suchen
  assert.deepEqual(wrap.tags, [["p", knoten.pk]]);
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.kind, KIND_DVM_TURN);
  assert.equal(getTag(r.request, "bid"), "0");
  assert.ok(istBesitzer(r.request, [k.geheimnis], r.request.created_at));
});

test("B-13a: Zugang – gelesen nur in der Form von TURN-REST, Ablauf in der Zukunft und höchstens einen Tag entfernt", () => {
  const z = zugang();
  assert.equal(z.passwort.length, 28, "HMAC-SHA1 als base64");
  assert.deepEqual(leseTurnZugang(turnZugangText(z), JETZT), z);
  const mit = (aenderung: Partial<Record<keyof TurnZugang, unknown>>) => JSON.stringify({ ...z, ...aenderung });
  for (const kaputt of [
    "", "{", "null", "[]",
    mit({ urls: [] }), mit({ urls: ["stun:knoten.example:3478"] }), mit({ urls: ["https://knoten.example"] }), mit({ urls: ["turn:knoten example"] }),
    mit({ urls: ["turn:a", "turn:a"] }), mit({ urls: ["turn:a", "turn:b", "turn:c", "turn:d", "turn:e"] }), mit({ urls: ["turn:a?transport=quic"] }),
    mit({ urls: [`turn:${"a".repeat(TURN_GRENZEN.urlZeichen)}`] }),
    mit({ nutzer: "nutzer" }), mit({ nutzer: `${z.bis + 1}:Zufall_abc123` }), mit({ nutzer: `${z.bis}:kurz` }),
    mit({ passwort: "kein base64" }), mit({ passwort: z.passwort.slice(1) }),
    mit({ bis: "1790003600" }),
  ]) assert.equal(leseTurnZugang(kaputt, JETZT), null, kaputt.slice(0, 120));
  assert.equal(leseTurnZugang(turnZugangText(zugang(JETZT)), JETZT), null, "abgelaufen");
  assert.equal(leseTurnZugang(turnZugangText(zugang(JETZT + TURN_GRENZEN.hoechstensSek + 1)), JETZT), null, "mehr als ein Tag");
});
