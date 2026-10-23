/**
 * B-36a3: Noise XX für Bitchat – Handshake und Transport gegen die Vektoren von cacophony und snow
 * (`fixtures/noise-xx-vektoren.json`), dazu der Transport mit Nonce vorn und Ersetzungsfenster wie Bitchat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BitchatTransport, NOISE_GRENZEN, NoiseFehler, NoiseXX, noiseSchluessel } from "../src/bitchat-noise.js";
import { bitchatPeerId } from "../src/bitchat-paket.js";

interface Vektor {
  protocol_name: string;
  init_prologue: string;
  init_static: string;
  init_ephemeral: string;
  resp_static: string;
  resp_ephemeral: string;
  handshake_hash?: string;
  messages: { payload: string; ciphertext: string }[];
}
const VEKTOREN = (JSON.parse(readFileSync(new URL("./fixtures/noise-xx-vektoren.json", import.meta.url), "utf8")) as { vektoren: Vektor[] }).vektoren;
const b = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));
const h = (x: Uint8Array): string => Buffer.from(x).toString("hex");

test("B-36a3: Noise XX – Handshake und Transport Byte für Byte wie cacophony und snow", () => {
  assert.equal(VEKTOREN.length, 2);
  for (const v of VEKTOREN) {
    assert.equal(v.protocol_name, "Noise_XX_25519_ChaChaPoly_SHA256");
    const prolog = b(v.init_prologue);
    const i = new NoiseXX(true, noiseSchluessel(b(v.init_static)), { prolog, ephemeral: noiseSchluessel(b(v.init_ephemeral)) });
    const r = new NoiseXX(false, noiseSchluessel(b(v.resp_static)), { prolog, ephemeral: noiseSchluessel(b(v.resp_ephemeral)) });
    v.messages.slice(0, 3).forEach((m, k) => {
      const [schreiber, leser] = k % 2 === 0 ? [i, r] : [r, i];
      const geheim = schreiber.schreibe(b(m.payload));
      assert.equal(h(geheim), m.ciphertext, `Handshake ${k}`);
      assert.equal(h(leser.lies(geheim)), m.payload, `Handshake ${k} gelesen`);
    });
    const si = i.teile();
    const sr = r.teile();
    if (v.handshake_hash) assert.equal(h(si.hash), v.handshake_hash);
    assert.equal(h(si.hash), h(sr.hash));
    assert.equal(h(si.entfernt), h(noiseSchluessel(b(v.resp_static)).oeffentlich), "der Initiator kennt den Schlüssel der Gegenseite");
    assert.equal(h(sr.entfernt), h(noiseSchluessel(b(v.init_static)).oeffentlich));
    v.messages.slice(3).forEach((m, k) => {
      const [aus, ein] = k % 2 === 0 ? [sr, si] : [si, sr];
      const geheim = aus.senden.verschluessele(new Uint8Array(0), b(m.payload));
      assert.equal(h(geheim), m.ciphertext, `Transport ${k}`);
      assert.equal(h(ein.empfangen.entschluessele(new Uint8Array(0), geheim)), m.payload);
    });
  }
});

function sitzung(): [BitchatTransport, BitchatTransport, Uint8Array, Uint8Array] {
  const a = noiseSchluessel();
  const z = noiseSchluessel();
  const i = new NoiseXX(true, a);
  const r = new NoiseXX(false, z);
  r.lies(i.schreibe());
  i.lies(r.schreibe());
  r.lies(i.schreibe());
  const si = i.teile();
  const sr = r.teile();
  assert.equal(h(bitchatPeerId(si.entfernt)), h(bitchatPeerId(z.oeffentlich)), "die Sitzung gehört zur Peer-ID der Gegenseite");
  return [new BitchatTransport(si), new BitchatTransport(sr), a.oeffentlich, z.oeffentlich];
}

test("B-36a3: Transport wie Bitchat – Nonce als 4 Byte vorn, vertauscht ja, doppelt nie, zu alt nie", () => {
  const [a, z] = sitzung();
  const n = Array.from({ length: 5 }, (_, k) => a.verschluessele(Uint8Array.of(k, k, k)));
  assert.deepEqual([...n[3].subarray(0, 4)], [0, 0, 0, 3], "Nonce Großendian vorn");
  assert.equal(n[0].length, 4 + 3 + 16);
  // Vertauschte Reihenfolge geht (Bluetooth), jede Nachricht genau einmal
  for (const k of [2, 0, 4, 1, 3]) assert.deepEqual([...z.entschluessele(n[k])], [k, k, k]);
  assert.throws(() => z.entschluessele(n[2]), (e: unknown) => e instanceof NoiseFehler && e.fall === "wiederholt");
  // Zurück geht es ebenso
  assert.deepEqual([...a.entschluessele(z.verschluessele(Uint8Array.of(9)))], [9]);
  // Weiter als das Fenster zurück: abgelehnt
  const alt = a.verschluessele(Uint8Array.of(7));
  for (let k = 0; k < NOISE_GRENZEN.fenster + 1; k++) z.entschluessele(a.verschluessele(Uint8Array.of(1)));
  assert.throws(() => z.entschluessele(alt), (e: unknown) => e instanceof NoiseFehler && e.fall === "wiederholt");
  // Verändert, fremd, zu kurz
  const neu = a.verschluessele(Uint8Array.of(5));
  const kaputt = neu.slice();
  kaputt[kaputt.length - 1] ^= 1;
  assert.throws(() => z.entschluessele(kaputt), (e: unknown) => e instanceof NoiseFehler && e.fall === "entschluesseln");
  assert.deepEqual([...z.entschluessele(neu)], [5], "ein gescheiterter Versuch verbraucht die Nonce nicht");
  const [, fremd] = sitzung();
  assert.throws(() => fremd.entschluessele(a.verschluessele(Uint8Array.of(1))), (e: unknown) => e instanceof NoiseFehler && e.fall === "entschluesseln");
  assert.throws(() => z.entschluessele(new Uint8Array(19)), (e: unknown) => e instanceof NoiseFehler && e.fall === "form");
});

test("B-36a3: Handshake – nur in der richtigen Reihenfolge, ein falscher Schlüssel scheitert, ein Fehler beendet ihn", () => {
  const i = new NoiseXX(true, noiseSchluessel());
  const r = new NoiseXX(false, noiseSchluessel());
  assert.throws(() => r.schreibe(), (e: unknown) => e instanceof NoiseFehler && e.fall === "reihenfolge");
  assert.throws(() => i.teile(), (e: unknown) => e instanceof NoiseFehler && e.fall === "reihenfolge");
  const m1 = i.schreibe();
  assert.equal(m1.length, 32, "Nachricht 1: nur e");
  assert.throws(() => i.schreibe(), (e: unknown) => e instanceof NoiseFehler && e.fall === "reihenfolge");
  r.lies(m1);
  const m2 = r.schreibe();
  assert.equal(m2.length, 32 + 48 + 16, "Nachricht 2: e, s verschlüsselt, leere Nutzlast mit Tag");
  // Nachricht 2 an einen anderen Initiator: dessen flüchtiger Schlüssel passt nicht – s lässt sich nicht öffnen
  const anderer = new NoiseXX(true, noiseSchluessel());
  anderer.schreibe();
  assert.throws(() => anderer.lies(m2), (e: unknown) => e instanceof NoiseFehler && e.fall === "entschluesseln");
  // Unterwegs verändert: ebenso
  const m2kaputt = m2.slice();
  m2kaputt[40] ^= 1;
  const kopie = new NoiseXX(true, noiseSchluessel(), { ephemeral: undefined });
  kopie.schreibe();
  assert.throws(() => kopie.lies(m2kaputt), (e: unknown) => e instanceof NoiseFehler && e.fall === "entschluesseln");
  // Unverändert und beim richtigen Initiator geht es weiter
  assert.equal(i.lies(m2).length, 0);
  r.lies(i.schreibe());
  assert.ok(i.fertig && r.fertig);
  // Ein gescheiterter Schritt beendet den Handshake – auch wenn danach die richtige Nachricht käme
  const j = new NoiseXX(true, noiseSchluessel());
  const q = new NoiseXX(false, noiseSchluessel());
  q.lies(j.schreibe());
  const q2 = q.schreibe();
  assert.throws(() => j.lies(q2.subarray(0, 60)), (e: unknown) => e instanceof NoiseFehler && e.fall === "form");
  assert.throws(() => j.lies(q2), (e: unknown) => e instanceof NoiseFehler && e.fall === "abgebrochen");
  assert.throws(() => j.teile(), (e: unknown) => e instanceof NoiseFehler && e.fall === "abgebrochen");
  assert.throws(() => noiseSchluessel(new Uint8Array(31)), NoiseFehler);
});
