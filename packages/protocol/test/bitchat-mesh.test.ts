/**
 * B-36a4: Fluten wie Bitchat – Doppeltes erkennen (`BLEIngressLinkRegistry.messageID`, 1000 Kennungen, 5 Minuten) und
 * die Entscheidung über das Weiterreichen (`RelayController.decide`), Fall für Fall aus dem gemeinfreien Swift-Code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BITCHAT_FLUTEN,
  BitchatDoppel,
  bitchatFuerVerbindung,
  bitchatNachrichtId,
  bitchatWeiterreichen,
  mitBitchatTtl,
} from "../src/bitchat-mesh.js";
import {
  BITCHAT_TYP,
  BitchatFehler,
  type BitchatPaket,
  BitchatZusammensetzer,
  kodiereBitchat,
  leseBitchat,
  pruefeBitchatSignatur,
  signiereBitchat,
} from "../src/bitchat-paket.js";
import { ed25519 } from "@noble/curves/ed25519.js";

const id = (s: number): Uint8Array => Uint8Array.from({ length: 8 }, (_, i) => s + i);
const ICH = id(0x70);
const paket = (x: Partial<BitchatPaket> = {}): BitchatPaket => ({
  version: 1,
  typ: 0x02,
  ttl: 7,
  zeit: 1761220000000,
  absender: id(1),
  nutzlast: Uint8Array.of(1, 2, 3),
  ...x,
});
const mitte = (): number => 0.5;

test("B-36a4: Kennung wie Bitchat – Absender, Zeit, Typ, 4 Byte SHA-256 der Nutzlast", () => {
  const p = paket();
  const sha = createHash("sha256").update(p.nutzlast).digest("hex").slice(0, 8);
  assert.equal(bitchatNachrichtId(p), `0102030405060708-1761220000000-2-${sha}`);
  assert.notEqual(bitchatNachrichtId(paket({ ttl: 3 })), bitchatNachrichtId(paket({ zeit: 1 })), "andere Zeit, andere Kennung");
  assert.equal(bitchatNachrichtId(paket({ ttl: 3 })), bitchatNachrichtId(p), "die TTL zählt nicht – weitergereicht bleibt es dasselbe");
});

test("B-36a4: Doppeltes – einmal neu, dann nicht; nach 5 Minuten wieder neu; höchstens 1000 Kennungen", () => {
  const d = new BitchatDoppel();
  assert.ok(d.neu(paket(), 0));
  assert.equal(d.neu(paket({ ttl: 2 }), 1000), false, "dasselbe Paket mit kleinerer TTL über einen anderen Weg");
  assert.ok(d.neu(paket({ nutzlast: Uint8Array.of(9) }), 1000));
  assert.ok(d.neu(paket(), BITCHAT_FLUTEN.doppeltMs + 1), "nach 5 Minuten vergessen");
  const voll = new BitchatDoppel();
  for (let k = 0; k < BITCHAT_FLUTEN.doppeltAnzahl + 1; k++) voll.neu(paket({ zeit: k }), 0);
  assert.equal(voll.anzahl, BITCHAT_FLUTEN.doppeltAnzahl);
  assert.ok(voll.neu(paket({ zeit: 0 }), 0), "die älteste Kennung ist gefallen");
  assert.equal(voll.neu(paket({ zeit: 1000 }), 0), false, "die jüngste ist noch da");
});

test("B-36a4: Weiterreichen – nie Eigenes, nie an mich, nie mit TTL 1, nie Sync-Anfragen", () => {
  const w = (p: BitchatPaket, grad = 3) => bitchatWeiterreichen(p, { eigen: ICH, grad, zufall: mitte });
  assert.equal(w(paket({ absender: ICH })).weiter, false);
  assert.equal(w(paket({ typ: BITCHAT_TYP.noiseVerschluesselt, empfaenger: ICH })).weiter, false);
  assert.equal(w(paket({ ttl: 1 })).weiter, false);
  assert.equal(w(paket({ ttl: 0 })).weiter, false);
  assert.equal(w(paket({ typ: 0x21 })).weiter, false, "REQUEST_SYNC bleibt beim Nachbarn");
});

test("B-36a4: Gerichtetes und Handshakes immer weiter mit TTL − 1, ohne Obergrenze je Dichte", () => {
  for (const typ of [BITCHAT_TYP.noiseVerschluesselt, BITCHAT_TYP.fragment, 0x04, 0x26, 0x27, 0x28]) {
    const r = bitchatWeiterreichen(paket({ typ, empfaenger: id(0x21) }), { eigen: ICH, grad: 12, zufall: mitte });
    assert.deepEqual([r.weiter, r.ttl], [true, 6], `Typ ${typ}`);
    assert.ok(r.versatzMs >= 20 && r.versatzMs <= 60);
  }
  const h = bitchatWeiterreichen(paket({ typ: BITCHAT_TYP.noiseHandshake }), { eigen: ICH, grad: 12, zufall: () => 0 });
  assert.deepEqual(h, { weiter: true, ttl: 6, versatzMs: 10 });
  // Eine TTL über 7 wird zuerst auf 7 gekappt
  assert.equal(bitchatWeiterreichen(paket({ typ: BITCHAT_TYP.noiseHandshake, ttl: 200 }), { eigen: ICH, grad: 1, zufall: mitte }).ttl, 6);
});

test("B-36a4: Rundrufe – TTL nach Dichte, Ankündigungen eine Stufe mehr, Fragmente und Sprache eigene Grenzen", () => {
  const ttl = (p: BitchatPaket, grad: number) => bitchatWeiterreichen(p, { eigen: ICH, grad, zufall: mitte }).ttl;
  assert.equal(ttl(paket(), 1), 6, "dünn: volle Tiefe");
  assert.equal(ttl(paket({ ttl: 3 }), 2), 2);
  assert.equal(ttl(paket(), 4), 5, "mittel: höchstens 6, weiter mit 5");
  assert.equal(ttl(paket({ typ: BITCHAT_TYP.ankuendigung }), 4), 6, "Ankündigung: höchstens 7");
  assert.equal(ttl(paket(), 6), 4, "dicht: höchstens 5");
  assert.equal(ttl(paket({ ttl: 2 }), 8), 1, "dicht, aber mindestens 2 vor dem Weiterreichen");
  assert.equal(ttl(paket({ typ: BITCHAT_TYP.fragment }), 3), 6, "Fragment im Rundruf: bis 7");
  assert.equal(ttl(paket({ typ: BITCHAT_TYP.fragment }), 7), 4, "Fragment dicht: bis 5");
  assert.equal(ttl(paket({ typ: 0x29 }), 7), 4, "Sprache wie Fragmente");
  const v = (grad: number, z: number) => bitchatWeiterreichen(paket(), { eigen: ICH, grad, zufall: () => z }).versatzMs;
  assert.deepEqual([v(2, 0), v(2, 0.999)], [10, 40]);
  assert.deepEqual([v(5, 0), v(5, 0.999)], [60, 150]);
  assert.deepEqual([v(9, 0), v(9, 0.999)], [80, 180]);
  assert.deepEqual([v(10, 0), v(10, 0.999)], [100, 220]);
});

test("B-36a4: Weitergereicht wird roh – nur die TTL ändert sich, die Signatur bleibt gültig", () => {
  const sk = ed25519.utils.randomSecretKey();
  const p = signiereBitchat(paket({ typ: BITCHAT_TYP.noiseVerschluesselt, empfaenger: id(0x21), nutzlast: new Uint8Array(40).fill(7) }), sk);
  const roh = kodiereBitchat(p, { polster: true });
  const weiter = mitBitchatTtl(roh, 4);
  assert.equal(weiter.length, roh.length, "das Polster bleibt");
  assert.deepEqual([...weiter.subarray(3)], [...roh.subarray(3)]);
  const g = leseBitchat(weiter)!;
  assert.equal(g.ttl, 4);
  assert.ok(pruefeBitchatSignatur(g, ed25519.getPublicKey(sk)));
  assert.equal(roh[2], 7, "das Original bleibt");
  assert.throws(() => mitBitchatTtl(roh, 256), RangeError);
  assert.throws(() => mitBitchatTtl(new Uint8Array(2), 1), RangeError);
});

test("B-36a4: je Verbindung – ganz, wenn es passt; sonst Fragmente, die in die Grenze passen", () => {
  const kennung = id(0x50);
  const noise = paket({ typ: BITCHAT_TYP.noiseVerschluesselt, empfaenger: id(0x21), nutzlast: new Uint8Array(300).fill(5) });
  const roh = kodiereBitchat(noise);
  const gepolstert = kodiereBitchat(noise, { polster: true });
  // Android mit MTU 517: ein Wert, aufgefüllt auf 512
  assert.deepEqual(bitchatFuerVerbindung(noise, { grenze: 514, kennung }).map((w) => w.length), [512]);
  // Ankündigungen und Nachrichten bleiben ungepolstert
  const rundruf = paket({ nutzlast: new Uint8Array(77).fill(1) });
  assert.deepEqual(bitchatFuerVerbindung(rundruf, { grenze: 182, kennung }).map((w) => w.length), [kodiereBitchat(rundruf).length]);
  // iOS mit MTU 185: das gepolsterte Paket in Fragmenten, jedes höchstens 182 Byte, keines aufgefüllt
  const werte = bitchatFuerVerbindung(noise, { grenze: 182, kennung });
  assert.ok(werte.length >= 3);
  const z = new BitchatZusammensetzer();
  let ganz: BitchatPaket | null = null;
  let daten = 0;
  for (const w of werte) {
    assert.ok(w.length <= 182, `${w.length} Byte`);
    const f = leseBitchat(w)!;
    assert.equal(f.typ, BITCHAT_TYP.fragment);
    assert.equal(kodiereBitchat(f).length, w.length, "kein Polster");
    daten += f.nutzlast.length - 13;
    ganz = z.nimm(f, 0) ?? ganz;
  }
  assert.equal(daten, gepolstert.length, "zerlegt wurde das gepolsterte Paket");
  assert.ok(ganz);
  assert.equal(Buffer.from(kodiereBitchat({ ...ganz, ttl: noise.ttl })).toString("hex"), Buffer.from(roh).toString("hex"));
  // Passt nicht einmal ein Fragment-Kopf hinein, gibt es nichts zu senden
  assert.throws(() => bitchatFuerVerbindung(noise, { grenze: 50, kennung }), BitchatFehler);
});
