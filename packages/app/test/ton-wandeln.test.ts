/**
 * B-38c1: Sprachnachrichten als Text über den eigenen Knoten (SP-W1 A, SP-W5 A, `docs/SPRACHE-ENTWURF.md`) – der Ton wird
 * im Browser zu WAV in genau der Form, die der Knoten annimmt; gefragt wird nur ein Knoten mit der Rolle `sprache`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPRACHE_FAELLE, SPRACHE_GRENZEN, pruefeWav } from "@freedomstack/protocol";
import { setLang, t } from "../src/i18n.js";
import { TON_SPIELRAUM_SEK, alsInt16, alsSpracheWav, browserDekoder, mono, type DekodierterTon } from "../src/ton-wandeln.js";

const RATE = SPRACHE_GRENZEN.abtastrate;
const dekoder = (ton: DekodierterTon) => async () => ton;
const sinus = (sek: number, f = 440) => Float32Array.from({ length: Math.round(sek * RATE) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / RATE));

test("B-38c1: Kanäle mischen und in 16 Bit wandeln – begrenzt, NaN als Stille", () => {
  assert.deepEqual([...mono([Float32Array.of(1, 0.5, -1), Float32Array.of(0, 0.5, 1, 0.9)])], [0.5, 0.5, 0], "Mittelwert, so lang wie der kürzeste Kanal");
  assert.deepEqual([...alsInt16(Float32Array.of(0, 1, -1, 2, -2, 0.5, Number.NaN))], [0, 32767, -32768, 32767, -32768, 16384, 0]);
});

test("B-38c1: eine Aufnahme wird WAV in der Form, die der Knoten annimmt", async () => {
  const links = sinus(2.5), rechts = sinus(2.5, 220);
  const r = await alsSpracheWav(new Uint8Array([1, 2, 3]), dekoder({ rate: RATE, kanaele: [links, rechts] }));
  assert.ok(r.ok);
  assert.equal(r.sekunden, 2.5);
  assert.deepEqual(pruefeWav(r.wav), { ok: true, sekunden: 2.5 });
  const d = new DataView(r.wav.buffer, 44);
  assert.equal(d.getInt16(2 * 1000, true), alsInt16(mono([links, rechts]))[1000], "Proben gemischt, kleinendian");

  // Der Kodierer hängt ein paar Millisekunden an – bis zum Spielraum schneidet die App auf 120 s
  const knapp = await alsSpracheWav(new Uint8Array(1), dekoder({ rate: RATE, kanaele: [new Float32Array((SPRACHE_GRENZEN.sekunden + 0.4) * RATE)] }));
  assert.ok(knapp.ok);
  assert.equal(knapp.sekunden, SPRACHE_GRENZEN.sekunden);
  assert.ok(pruefeWav(knapp.wav).ok);
});

test("B-38c1: zu lang, leer, fremde Rate oder unlesbar – keine WAV, nur eine Kennung", async () => {
  const zuLang = new Float32Array((SPRACHE_GRENZEN.sekunden + TON_SPIELRAUM_SEK) * RATE + 1);
  assert.deepEqual(await alsSpracheWav(new Uint8Array(1), dekoder({ rate: RATE, kanaele: [zuLang] })), { ok: false, fall: "ton-lang" },
    "eine fremde Nachricht wird nie still abgeschnitten");
  assert.deepEqual(await alsSpracheWav(new Uint8Array(1), dekoder({ rate: RATE, kanaele: [new Float32Array(0)] })), { ok: false, fall: "ton-leer" });
  assert.deepEqual(await alsSpracheWav(new Uint8Array(1), dekoder({ rate: 48_000, kanaele: [sinus(1)] })), { ok: false, fall: "ton-unlesbar" });
  assert.deepEqual(await alsSpracheWav(new Uint8Array(1), dekoder({ rate: RATE, kanaele: [] })), { ok: false, fall: "ton-unlesbar" });
  assert.deepEqual(await alsSpracheWav(new Uint8Array(1), async () => { throw new Error("EncodingError"); }), { ok: false, fall: "ton-unlesbar" });
  assert.equal(browserDekoder(), null, "ohne Web Audio kein Dekoder");
});

test("B-38c1: der Browser-Dekoder dekodiert bei 16 kHz und lässt die Bytes des Abspielers stehen", async () => {
  const gesehen: { rate: number; laenge: number; gleich: boolean }[] = [];
  const bytes = new Uint8Array([7, 8, 9]);
  class Kontext {
    constructor(readonly kanaele: number, readonly laenge: number, readonly rate: number) {}
    async decodeAudioData(b: ArrayBuffer) {
      gesehen.push({ rate: this.rate, laenge: b.byteLength, gleich: b === bytes.buffer });
      return { sampleRate: this.rate, numberOfChannels: 2, getChannelData: (i: number) => Float32Array.of(i) };
    }
  }
  (globalThis as Record<string, unknown>).OfflineAudioContext = Kontext;
  try {
    const ton = await browserDekoder()!(bytes);
    assert.deepEqual(ton, { rate: RATE, kanaele: [Float32Array.of(0), Float32Array.of(1)] });
    assert.deepEqual(gesehen, [{ rate: RATE, laenge: 3, gleich: false }], "eine Kopie – decodeAudioData übernimmt den Puffer");
  } finally {
    delete (globalThis as Record<string, unknown>).OfflineAudioContext;
  }
});

test("B-38c1: verdrahtet – erst wandeln, dann die Rolle `sprache`, dann Ton und Auftrag über den Weg zum Knoten", () => {
  const ui = readFileSync(new URL("../src/shell/sprache-text-ui.ts", import.meta.url), "utf8");
  const stelle = (s: string) => { const i = ui.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(stelle("alsSpracheWav(bytes, dekoder)") < stelle("grundGegenKnoten(k)"), "was der Browser nicht liest, fragt den Knoten nicht");
  assert.ok(stelle('rollen.includes("sprache")') < stelle("uploadAnhang("), "nur ein Knoten mit der Rolle bekommt den Ton");
  assert.match(ui, /uploadAnhang\(new File\(\[ton\.wav as BlobPart\], "", \{ type: "application\/octet-stream" \}\), weg, sitzung\)/,
    "ohne Name und Typ, über den Weg zum Knoten, signiert vom Sitzungsschlüssel");
  assert.doesNotMatch(ui, /state\.signer|state\.keypair/, "nie die eigene Identität");
  assert.match(ui, /await weg\.publish\(wrap\)/);
  assert.match(ui, /warteAufKnoten\(weg, sitzung, requestId, KIND_DVM_TEXT_AUS_SPRACHE \+ 1000/);
  assert.match(ui, /aus\.textContent = "text" in r \? r\.text : r\.grund/, "der Text nur als textContent");
  assert.doesNotMatch(ui, /innerHTML|localStorage|geheim\./, "nichts gespeichert");

  const chat = readFileSync(new URL("../src/shell/tabs/chat-anhaenge.ts", import.meta.url), "utf8");
  assert.match(chat, /if \(v\.art === "audio" && v\.url\.startsWith\("data:"\)\) \{/, "nur Ton aus der Nachricht selbst – nie eine Adresse im Netz");
  assert.match(chat, /el\.replaceWith\(mitAlsText\(ton, async \(\) => bytes\)\)/, "entschlüsselte Sprachnachrichten aus dem Blob-Netz");
});

test("B-38c1: für jede Kennung des Knotens und jeden Ausgang ein Satz in beiden Sprachen", () => {
  // Die Oberfläche lädt ohne DOM nicht – die Schlüssel stehen im Quelltext
  const ui = readFileSync(new URL("../src/shell/sprache-text-ui.ts", import.meta.url), "utf8");
  const schluessel = SPRACHE_FAELLE.map((f) => new RegExp(`"${f}": "(komm\\.[A-Za-z]+)"`).exec(ui)?.[1] ?? f);
  assert.equal(new Set(schluessel).size, SPRACHE_FAELLE.length);
  const alle = [...schluessel, ...[...ui.matchAll(/t\("(komm\.alsText[A-Za-z]*)"/g)].map((m) => m[1]!), "komm.alsTextUnlesbar", "komm.alsTextLeer", "komm.alsTextLang"];
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    for (const k of alle) assert.notEqual(t(k), k, `${k} (${sprache})`);
  }
  setLang("de");
});
