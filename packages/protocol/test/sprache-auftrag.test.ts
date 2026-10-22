/**
 * B-38b1: Text aus Sprache beim eigenen Knoten – WAV nur in einer Form, Auftrag versiegelt mit Nachweis, Antwort streng.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_TEXT_AUS_SPRACHE, LocalSigner, SPRACHE_GRENZEN, baueSpracheAuftrag, baueWav, generateKeypair, leseSpracheAuftrag,
  leseTranskript, neueKopplung, openPrivateJobRequest, pruefeWav, transkriptText, verschluesseleDatei, type SpracheAuftrag,
} from "../src/index.js";

const sinus = (sekunden: number) => Int16Array.from({ length: sekunden * SPRACHE_GRENZEN.abtastrate }, (_, i) => Math.round(8000 * Math.sin(i / 10)));

test("B-38b1: WAV aus baueWav() – 44 Byte Kopf, PCM mono 16 kHz 16 Bit, Proben kleinendian, und pruefeWav() nimmt sie", () => {
  const wav = baueWav(Int16Array.from([1, -2, 0x1234]));
  assert.equal(wav.length, 44 + 6);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 16)), "WAVEfmt ");
  assert.deepEqual([...wav.slice(44)], [1, 0, 0xfe, 0xff, 0x34, 0x12]);
  assert.deepEqual(pruefeWav(wav), { ok: true, sekunden: 3 / SPRACHE_GRENZEN.abtastrate });
  assert.deepEqual(pruefeWav(baueWav(sinus(2))), { ok: true, sekunden: 2 });
  // Auch als Ausschnitt eines größeren Puffers (Blob-Netz, Entschlüsseln)
  const gross = new Uint8Array(wav.length + 10);
  gross.set(wav, 5);
  assert.equal(pruefeWav(gross.subarray(5, 5 + wav.length)).ok, true);
});

test("B-38b1: pruefeWav() nimmt nichts anderes – Form, Format, leer, zu lang", () => {
  const gut = baueWav(sinus(1));
  const mit = (an: number, wert: number, breite: 2 | 4) => {
    const b = gut.slice();
    const d = new DataView(b.buffer);
    if (breite === 2) d.setUint16(an, wert, true); else d.setUint32(an, wert, true);
    return b;
  };
  const text = (an: number, s: string) => { const b = gut.slice(); for (let i = 0; i < s.length; i++) b[an + i] = s.charCodeAt(i); return b; };
  const faelle: Array<[string, Uint8Array, string]> = [
    ["zu kurz", gut.slice(0, 40), "wav-form"],
    ["kein RIFF", text(0, "RIFX"), "wav-form"],
    ["kein WAVE", text(8, "AVI "), "wav-form"],
    ["anderer Abschnitt statt data", text(36, "LIST"), "wav-form"],
    ["RIFF-Länge falsch", mit(4, gut.length, 4), "wav-form"],
    ["fmt mit 18 Byte", mit(16, 18, 4), "wav-form"],
    ["data-Länge falsch", mit(40, 10, 4), "wav-form"],
    ["angehängte Bytes", Uint8Array.from([...gut, 0, 0]), "wav-form"],
    ["Fließkomma (3)", mit(20, 3, 2), "wav-format"],
    ["Stereo", mit(22, 2, 2), "wav-format"],
    ["44,1 kHz", mit(24, 44_100, 4), "wav-format"],
    ["Byte-Rate falsch", mit(28, 16_000, 4), "wav-format"],
    ["8 Bit", mit(34, 8, 2), "wav-format"],
    ["leer", baueWav(new Int16Array(0)), "wav-leer"],
    ["ungerade Länge", (() => { const b = Uint8Array.from([...gut, 7]); const d = new DataView(b.buffer); d.setUint32(4, b.length - 8, true); d.setUint32(40, b.length - 44, true); return b; })(), "wav-form"],
  ];
  for (const [name, b, fall] of faelle) assert.deepEqual(pruefeWav(b), { ok: false, fall }, name);
  // Genau die Grenze geht, eine Probe mehr nicht
  assert.deepEqual(pruefeWav(baueWav(new Int16Array(SPRACHE_GRENZEN.sekunden * SPRACHE_GRENZEN.abtastrate))), { ok: true, sekunden: SPRACHE_GRENZEN.sekunden });
  assert.deepEqual(pruefeWav(baueWav(new Int16Array(SPRACHE_GRENZEN.sekunden * SPRACHE_GRENZEN.abtastrate + 1))), { ok: false, fall: "wav-lang" });
});

test("B-38b1: Auftrag – Blob, Manifest und Schlüssel, versiegelt an den Knoten, mit Nachweis, ohne Gebot", async () => {
  const { schluessel } = verschluesseleDatei(baueWav(sinus(1)));
  const auftrag: SpracheAuftrag = { ton: { blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel }, sprache: "de" };
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await baueSpracheAuftrag({ sitzung, kopplung: k, auftrag });
  assert.equal(wrap.kind, 1059, "nur versiegelt");
  assert.deepEqual(wrap.tags, [["p", knoten.pk]], "offen nur der Knoten – kein Blob, kein Schlüssel");
  assert.ok(!JSON.stringify(wrap).includes(schluessel.key), "der Schlüssel des Tons steht nie offen");
  const offen = await openPrivateJobRequest(wrap, new LocalSigner(knoten.sk));
  assert.ok(offen.ok);
  assert.equal(offen.request.kind, KIND_DVM_TEXT_AUS_SPRACHE);
  assert.equal(offen.request.pubkey, sitzung.publicKey(), "vom Sitzungsschlüssel, nie von der Identität");
  assert.ok(offen.request.tags.some((t) => t[0] === "besitzer"), "mit Nachweis");
  assert.equal(offen.request.tags.find((t) => t[0] === "bid")?.[1] ?? "0", "0");
  assert.deepEqual(leseSpracheAuftrag(offen.request.tags.find((t) => t[0] === "i")![1]!), auftrag);
  await assert.rejects(baueSpracheAuftrag({ sitzung, kopplung: k, auftrag: { ...auftrag, sprache: "fr" as never } }));
});

test("B-38b1: Auftrag streng gelesen – sonst null", () => {
  const { schluessel } = verschluesseleDatei(new Uint8Array(4));
  const gut = { ton: { blob: "ab".repeat(32), manifest: "cd".repeat(32), schluessel }, sprache: "auto" };
  assert.deepEqual(leseSpracheAuftrag(JSON.stringify(gut)), gut);
  // Was nicht dazugehört, fällt weg – gelesen wird nur die bekannte Form
  assert.deepEqual(leseSpracheAuftrag(JSON.stringify({ ...gut, url: "https://x", ton: { ...gut.ton, extra: 1, schluessel: { ...schluessel, x: 1 } } })), gut);
  for (const falsch of [
    { ...gut, sprache: "fr" }, { ...gut, sprache: undefined }, { ton: gut.ton },
    { ...gut, ton: { ...gut.ton, blob: "AB".repeat(32) } }, { ...gut, ton: { ...gut.ton, blob: "ab".repeat(31) } },
    { ...gut, ton: { ...gut.ton, manifest: "zz".repeat(32) } }, { ...gut, ton: { ...gut.ton, schluessel: { ...schluessel, alg: "aes-cbc" } } },
    { ...gut, ton: { ...gut.ton, schluessel: { ...schluessel, key: "00" } } }, { ...gut, ton: null }, { ...gut, ton: [gut.ton] }, [gut],
  ]) {
    assert.equal(leseSpracheAuftrag(JSON.stringify(falsch)), null, JSON.stringify(falsch).slice(0, 80));
  }
  for (const kaputt of ["", "{", "null", "1", "\"ton\""]) assert.equal(leseSpracheAuftrag(kaputt), null, kaputt);
});

test("B-38b1: Antwort streng – Text bis 8000 Zeichen ohne Steuerzeichen, Länge im Rahmen", () => {
  const gut = { text: "Hallo Welt.\nZweite Zeile – mit Umlauten: äöü ß.", sekunden: 2.5 };
  assert.deepEqual(leseTranskript(transkriptText(gut)), gut);
  assert.deepEqual(leseTranskript(transkriptText({ text: "", sekunden: 1 })), { text: "", sekunden: 1 }, "Stille ist kein Fehler");
  assert.deepEqual(leseTranskript(transkriptText({ text: "x".repeat(SPRACHE_GRENZEN.textZeichen), sekunden: 120 }))?.text.length, SPRACHE_GRENZEN.textZeichen);
  for (const falsch of [
    { text: "x".repeat(SPRACHE_GRENZEN.textZeichen + 1), sekunden: 1 }, { text: "a\u0000b", sekunden: 1 }, { text: "a\u001b[31mrot", sekunden: 1 },
    { text: "a\rb", sekunden: 1 }, { text: "a\u007fb", sekunden: 1 }, { text: 5, sekunden: 1 }, { text: "a", sekunden: 0 }, { text: "a", sekunden: -1 },
    { text: "a", sekunden: SPRACHE_GRENZEN.sekunden + 0.1 }, { text: "a", sekunden: "2" }, { text: "a" },
  ]) {
    assert.equal(leseTranskript(JSON.stringify(falsch)), null, JSON.stringify(falsch).slice(0, 60));
  }
  assert.equal(leseTranskript("kein json"), null);
  assert.equal(leseTranskript("[]"), null);
});
