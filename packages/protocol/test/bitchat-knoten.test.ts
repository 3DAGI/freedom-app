/**
 * B-36c2a1: ein kleines Bitchat-Netz ohne Bluetooth – A und B sind Freedom-Kontakte, R dazwischen ein fremdes Gerät, das nur
 * weiterreicht. Ankündigen, erkennen, roh weiterreichen, auch in Verbindungen mit kleinerer Grenze; dazu, was nicht gehen darf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { BITCHAT_KNOTEN, type BitchatAusgabe, BitchatKnoten } from "../src/bitchat-knoten.js";
import { BITCHAT_TYP, BitchatZusammensetzer, kodiereBitchat, leseBitchat, zerlegeBitchatRoh } from "../src/bitchat-paket.js";

const JETZT = 1_761_220_000_000;
const ident = (name: string) => ({ noise: x25519.utils.randomSecretKey(), signier: ed25519.utils.randomSecretKey(), name });
const mitte = (): number => 0.5;

/** Geräte und Verbindungen; `lauf()` stellt zu, bis nichts mehr unterwegs ist */
function netz(knoten: Record<string, BitchatKnoten>, kanten: [string, string, number][]) {
  const nach = new Map<string, [string, string]>(); // "<gerät>:<verbindung>" → [anderes Gerät, seine Verbindung]
  const verbindungen = new Map<string, { id: string; grenze: number }[]>();
  for (const [a, b, grenze] of kanten) {
    nach.set(`${a}:${b}`, [b, a]);
    nach.set(`${b}:${a}`, [a, b]);
    for (const [x, y] of [[a, b], [b, a]] as const) verbindungen.set(x, [...(verbindungen.get(x) ?? []), { id: y, grenze }]);
  }
  for (const [name, k] of Object.entries(knoten)) k.setzeVerbindungen(verbindungen.get(name) ?? []);
  const gesehen: { von: string; an: string; wert: Uint8Array }[] = [];
  const lauf = (von: string, ausgabe: BitchatAusgabe[], jetzt = JETZT) => {
    const offen = ausgabe.map((a) => ({ von, ...a }));
    while (offen.length) {
      const a = offen.shift()!;
      const [an, ueber] = nach.get(`${a.von}:${a.id}`)!;
      gesehen.push({ von: a.von, an, wert: a.wert });
      offen.push(...knoten[an]!.nimm(ueber, a.wert, jetzt).ausgabe.map((x) => ({ von: an, ...x })));
    }
  };
  return { lauf, gesehen };
}

function aufbau() {
  const [ia, ib, ir] = [ident("anon1111"), ident("anon2222"), ident("anon3333")];
  const a = new BitchatKnoten(ia, { zufall: mitte });
  const b = new BitchatKnoten(ib, { zufall: mitte });
  const r = new BitchatKnoten(ir, { zufall: mitte }); // ein Bitchat-Gerät ohne Kontakte
  a.setzeKontakte([{ person: "b", ...b.schluessel }]);
  b.setzeKontakte([{ person: "a", ...a.schluessel }]);
  // A – R mit Android-MTU, R – B mit iPhone-MTU: dort gehen Fragmente
  const n = netz({ a, b, r }, [["a", "r", 512], ["r", "b", 182]]);
  return { a, b, r, ia, n };
}

test("B-36c2a1: A und B erkennen sich über R an ihren Ankündigungen – R erkennt niemanden", () => {
  const { a, b, r, n } = aufbau();
  assert.deepEqual(a.inDerNaehe(JETZT), []);
  n.lauf("a", a.ankuendigung(JETZT));
  n.lauf("b", b.ankuendigung(JETZT));
  assert.deepEqual([a.inDerNaehe(JETZT), b.inDerNaehe(JETZT), r.inDerNaehe(JETZT)], [["b"], ["a"], []]);
  // Jede Ankündigung ging genau einmal über jede Verbindung: R reicht sie weiter, nie zurück, kein Echo
  assert.deepEqual(n.gesehen.map((g) => `${g.von}>${g.an}`), ["a>r", "r>b", "b>r", "r>a"]);
  const p = leseBitchat(n.gesehen[1]!.wert)!;
  assert.equal(p.typ, BITCHAT_TYP.ankuendigung);
  assert.equal(p.ttl, BITCHAT_KNOTEN.ttl - 1, "R zieht eins von der TTL ab");
  assert.deepEqual(p.absender, a.peerId, "Absender bleibt A");
  // Nach einer Minute ohne Ankündigung ist B nicht mehr in der Nähe; wer kein Kontakt mehr ist, auch nicht
  assert.deepEqual(a.inDerNaehe(JETZT + BITCHAT_KNOTEN.gesehenMs + 1), []);
  b.setzeKontakte([]);
  assert.deepEqual(b.inDerNaehe(JETZT), []);
});

test("B-36c2a1: Kontakte nur mit ihren beiden Schlüsseln, Doppeltes und Eigenes nie, Kaputtes nie", () => {
  const { a, ia } = aufbau();
  // Ein Gerät mit As Noise-Schlüssel, aber eigenem Signier-Schlüssel ist nicht A
  const falsch = new BitchatKnoten({ ...ident("anon1111"), noise: ia.noise });
  const c = new BitchatKnoten(ident("anon4444"));
  c.setzeKontakte([{ person: "a", ...a.schluessel }]);
  falsch.setzeVerbindungen([{ id: "c", grenze: 512 }]);
  c.setzeVerbindungen([{ id: "f", grenze: 512 }, { id: "g", grenze: 512 }]);
  for (const w of falsch.ankuendigung(JETZT)) c.nimm("f", w.wert, JETZT);
  assert.deepEqual(c.inDerNaehe(JETZT), [], "Signier-Schlüssel passt nicht zum Kontakt");
  // Die echte Ankündigung von A gilt – ein zweites Mal kommt sie nicht weiter (Doppel), die eigene nie
  assert.deepEqual(new BitchatKnoten(ident("anon6666")).ankuendigung(JETZT), [], "ohne Verbindungen geht nichts hinaus");
  a.setzeVerbindungen([{ id: "c", grenze: 512 }]);
  const w = a.ankuendigung(JETZT + 1)[0]!.wert;
  assert.equal(c.nimm("f", w, JETZT + 1).ausgabe.length, 1, "weiter an g");
  assert.deepEqual(c.inDerNaehe(JETZT + 1), ["a"]);
  assert.deepEqual(c.nimm("g", w, JETZT + 2).ausgabe, [], "doppelt");
  assert.deepEqual(a.nimm("c", w, JETZT + 2).ausgabe, [], "das eigene Paket");
  // Eine veränderte Ankündigung (anderer Name, alte Signatur) zählt nicht
  const d = new BitchatKnoten(ident("anon5555"));
  d.setzeKontakte([{ person: "a", ...a.schluessel }]);
  const p = leseBitchat(w)!;
  const veraendert = kodiereBitchat({ ...p, nutzlast: Uint8Array.from(p.nutzlast).map((x, i) => (i === 2 ? x ^ 1 : x)) });
  d.nimm("x", veraendert, JETZT + 3);
  assert.deepEqual(d.inDerNaehe(JETZT + 3), []);
  for (const kaputt of [new Uint8Array(0), Uint8Array.of(1, 2, 3), w.subarray(0, 20)]) assert.deepEqual(d.nimm("x", kaputt, JETZT + 3).ausgabe, []);
});

test("B-36c2a1: R reicht ein großes Paket an B in Fragmenten bis 182 Byte weiter – roh, B setzt es wieder zusammen", () => {
  const { a, b, n } = aufbau();
  // Ein gerichtetes Paket von A an B mit 400 Byte Nutzlast (wie Chiffrat aus einer Noise-Sitzung), gepolstert
  const nutzlast = Uint8Array.from({ length: 400 }, (_, i) => (i * 7) & 0xff);
  const roh = kodiereBitchat(
    { version: 1, typ: BITCHAT_TYP.noiseVerschluesselt, ttl: 7, zeit: JETZT, absender: a.peerId, empfaenger: b.peerId, nutzlast },
    { polster: true },
  );
  assert.ok(roh.length > 182 && roh.length <= 512);
  n.lauf("a", [{ id: "r", wert: roh, versatzMs: 0 }]);
  const anB = n.gesehen.filter((g) => g.an === "b").map((g) => g.wert);
  assert.ok(anB.length >= 3 && anB.every((w) => w.length <= 182), "Fragmente in der Grenze");
  const z = new BitchatZusammensetzer();
  const ganz = anB.map((w) => z.nimm(leseBitchat(w)!, JETZT)).find((x) => x)!;
  assert.deepEqual([ganz.typ, ganz.absender, ganz.empfaenger, ganz.nutzlast], [BITCHAT_TYP.noiseVerschluesselt, a.peerId, b.peerId, nutzlast]);
  // Gerichtetes an B reicht B nicht weiter, und nichts geht zurück an A
  assert.equal(n.gesehen.filter((g) => g.von === "b").length, 0);
  assert.equal(n.gesehen.filter((g) => g.an === "a").length, 0);
});

test("B-36c2a1: roh zerlegen – Daten sind die Bytes, wie sie kamen; Unlesbares nicht; zu klein wirft", () => {
  const p = {
    version: 1 as const, typ: BITCHAT_TYP.noiseVerschluesselt, ttl: 3, zeit: JETZT,
    absender: Uint8Array.from({ length: 8 }, (_, i) => i + 1), empfaenger: Uint8Array.from({ length: 8 }, (_, i) => i + 11),
    nutzlast: Uint8Array.from({ length: 300 }, (_, i) => i & 0xff),
  };
  const roh = kodiereBitchat(p, { polster: true });
  const kennung = Uint8Array.of(9, 9, 9, 9, 9, 9, 9, 9);
  const teile = zerlegeBitchatRoh(roh, kennung, 182)!;
  assert.ok(teile.length >= 2);
  for (const t of teile) {
    assert.ok(kodiereBitchat(t).length <= 182);
    assert.deepEqual([t.typ, t.ttl, t.absender, t.empfaenger], [BITCHAT_TYP.fragment, 3, p.absender, p.empfaenger]);
  }
  // Die Daten der Fragmente zusammen sind genau die rohen Bytes – samt Polster, nicht neu kodiert
  const z = new BitchatZusammensetzer();
  const ganz = teile.map((t) => z.nimm(leseBitchat(kodiereBitchat(t))!, JETZT)).find((x) => x)!;
  assert.deepEqual(ganz.nutzlast, p.nutzlast);
  assert.equal(zerlegeBitchatRoh(Uint8Array.of(1, 2, 3), kennung, 182), null);
  assert.throws(() => zerlegeBitchatRoh(roh, kennung, 20));
});
