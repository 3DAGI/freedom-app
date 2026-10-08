/**
 * Schritt 7.5a: Meshtastic-Format ohne Abhängigkeit. Verglichen mit der
 * offiziellen Python-Bibliothek meshtastic 2.7.11
 * (`fixtures/meshtastic-referenz.json`, erzeugt mit
 * `scripts/meshtastic-referenz.py`): was die App sendet, Byte für Byte; was
 * ein Gerät schickt, samt Feldern, die der Leser überspringen muss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  FREEDOM_KANAL, MESHTASTIC_MAX_NUTZLAST, MESHTASTIC_PORT, MeshtasticStrom,
  baueFunkPaket, baueKonfigAnfrage, leseVomGeraet, meshtasticSendezeit, mitMeshtasticKopf, type VomGeraet,
} from "../src/meshtastic.js";
import { LORA_MTU } from "../src/mesh-transport.js";

interface Zum { fall: "konfig" | "paket"; id?: number; kanal?: number; hopLimit?: number; nutzlast?: string; hex: string }
interface Vom { fall: string; hex: string; erwartet: Record<string, unknown> }
const REF = JSON.parse(readFileSync(new URL("./fixtures/meshtastic-referenz.json", import.meta.url), "utf8")) as {
  quelle: string;
  kanal: { name: string; psk: string };
  kopf: { laenge: number; hex: string }[];
  zumGeraet: Zum[];
  vomGeraet: Vom[];
};
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const bytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));
/** Ergebnis mit Bytes als Hex – vergleichbar mit der Referenz. */
const alsJson = (v: VomGeraet | null): unknown =>
  v && Object.fromEntries(Object.entries(v).map(([k, w]) => [k, w instanceof Uint8Array ? hex(w) : w]));

test("Kanal „freedom“: öffentlicher Schlüssel, nachgerechnet und gleich der Referenz", () => {
  assert.equal(FREEDOM_KANAL.name, REF.kanal.name);
  assert.ok(new TextEncoder().encode(FREEDOM_KANAL.name).length < 12, "Meshtastic: Name kürzer als 12 Byte");
  assert.equal(FREEDOM_KANAL.psk.length, 32, "AES-256");
  assert.equal(hex(FREEDOM_KANAL.psk), createHash("sha256").update("freedomstack-meshtastic-kanal-v1").digest("hex"));
  assert.equal(hex(FREEDOM_KANAL.psk), REF.kanal.psk);
  // Unsere Rahmen passen in ein Paket
  assert.ok(LORA_MTU <= MESHTASTIC_MAX_NUTZLAST);
  assert.equal(MESHTASTIC_PORT, 256);
});

test("zum Gerät: Bytes wie die Referenz", () => {
  assert.match(REF.quelle, /^meshtastic 2\.7\.11$/);
  assert.equal(REF.zumGeraet.length, 7);
  for (const f of REF.zumGeraet) {
    const b = f.fall === "konfig"
      ? baueKonfigAnfrage(f.id!)
      : baueFunkPaket({ kanal: f.kanal!, hopLimit: f.hopLimit!, nutzlast: bytes(f.nutzlast!) });
    assert.equal(hex(b), f.hex, `${f.fall} ${f.id ?? f.kanal}`);
  }
});

test("zum Gerät: Ungültiges wird abgewiesen, nie still gekürzt", () => {
  const n = (k: number) => new Uint8Array(k);
  assert.throws(() => baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: n(MESHTASTIC_MAX_NUTZLAST + 1) }), RangeError);
  baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: n(MESHTASTIC_MAX_NUTZLAST) });
  for (const kanal of [-1, 1.5, 2 ** 32, NaN]) assert.throws(() => baueFunkPaket({ kanal, hopLimit: 3, nutzlast: n(1) }), RangeError);
  for (const hopLimit of [-1, 0.5, 2 ** 32]) assert.throws(() => baueFunkPaket({ kanal: 1, hopLimit, nutzlast: n(1) }), RangeError);
  for (const id of [-1, 2 ** 32, 1.5]) assert.throws(() => baueKonfigAnfrage(id), RangeError);
});

test("Kopf im Strom: START1, START2, Länge – höchstens 512", () => {
  for (const k of REF.kopf) assert.equal(hex(mitMeshtasticKopf(new Uint8Array(k.laenge)).subarray(0, 4)), k.hex);
  const m = mitMeshtasticKopf(Uint8Array.from([1, 2, 3]));
  assert.equal(hex(m), "94c30003010203");
  assert.throws(() => mitMeshtasticKopf(new Uint8Array(513)), RangeError);
});

test("vom Gerät: liest, was die App braucht, und überspringt den Rest", () => {
  assert.equal(REF.vomGeraet.length, 13);
  for (const f of REF.vomGeraet) assert.deepEqual(alsJson(leseVomGeraet(bytes(f.hex))), f.erwartet, f.fall);
  // Unbekannte Felder aller Arten, auch fixed64 (Typ 1), vor der Nachricht
  const paket = REF.vomGeraet.find((f) => f.fall === "paket")!;
  const davor = Uint8Array.from([...[0xf9, 0x07, 1, 2, 3, 4, 5, 6, 7, 8], ...[0xf8, 0x07, 0x2a], ...bytes(paket.hex)]);
  assert.deepEqual(alsJson(leseVomGeraet(davor)), paket.erwartet);
  // Oneof: das letzte Feld gilt (wie die Python-Bibliothek) – erst lesbar, dann verschlüsselt ist verschlüsselt
  const lesbar = [0x22, 0x06, 0x08, 0x80, 0x02, 0x12, 0x01, 0x01];
  const chiffre = [0x2a, 0x01, 0x02];
  assert.deepEqual(leseVomGeraet(Uint8Array.from([0x12, 0x0b, ...lesbar, ...chiffre])), { art: "anderes" });
  assert.deepEqual(alsJson(leseVomGeraet(Uint8Array.from([0x12, 0x0b, ...chiffre, ...lesbar]))),
    { art: "paket", von: 0, an: 0, kanal: 0, port: 256, nutzlast: "01" });
  // Die Nutzlast ist eine Kopie, kein Blick in den Puffer
  const roh = bytes(paket.hex);
  const p = leseVomGeraet(roh) as Extract<VomGeraet, { art: "paket" }>;
  roh.fill(0);
  assert.equal(hex(p.nutzlast), paket.erwartet.nutzlast);
});

test("vom Gerät: Kaputtes ergibt null, wirft nie", () => {
  for (const f of REF.vomGeraet) {
    const b = bytes(f.hex);
    for (let n = 0; n < b.length; n++) {
      const v = leseVomGeraet(b.subarray(0, n)); // jede abgeschnittene Fassung
      assert.ok(v === null || typeof v.art === "string");
    }
  }
  const nichts = (b: number[], was: string) => assert.equal(leseVomGeraet(Uint8Array.from(b)), null, was);
  nichts([0x08, ...Array(10).fill(0xff), 0x01], "Zahl mit mehr als zehn Byte");
  nichts([0x12, 0x05, 0x01], "Länge über das Ende hinaus");
  nichts([0x13], "Gruppe (Typ 3)");
  nichts([0x00, 0x00], "Feldnummer 0");
  nichts([0x52, 0x02, 0x08, 0x08], "Kanal 8 – Meshtastic kennt acht (0 bis 7)");
  nichts([0x52, 0x0b, 0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01], "negativer Kanal-Index");
  nichts([0x12, 0x07, 0x18, 0x80, 0x80, 0x80, 0x80, 0x10, 0x00], "Kanal über 32 Bit");
  nichts([0x12, 0x03, 0x0d, 0x01, 0x02], "fixed32 zu kurz");
  nichts([0x12, 0x02, 0x08, 0x01], "Absender als Zahl statt fixed32");
  // Leer ist keine Nachricht des Geräts, aber nicht kaputt
  assert.deepEqual(leseVomGeraet(new Uint8Array(0)), { art: "anderes" });
});

test("Strom: Nachrichten über beliebige Grenzen, Debug-Text dazwischen, neu aufsetzen", () => {
  const a = Uint8Array.from([1, 2, 3]);
  const b = bytes(REF.vomGeraet[0]!.hex);
  const log = new TextEncoder().encode("INFO | ??:??:?? 3 [Router] Rx\r\n");
  const strom = Uint8Array.from([...log, ...mitMeshtasticKopf(a), ...log, ...mitMeshtasticKopf(b), 0x94]);
  for (const schnitt of [1, 2, 3, 5, 7, 64, strom.length]) {
    const s = new MeshtasticStrom();
    const raus: string[] = [];
    for (let i = 0; i < strom.length; i += schnitt) for (const m of s.push(strom.subarray(i, i + schnitt))) raus.push(hex(m));
    assert.deepEqual(raus, [hex(a), hex(b)], `in Stücken zu ${schnitt}`);
  }
  // Länge über 512: verworfen, die nächste Nachricht kommt trotzdem
  const s = new MeshtasticStrom();
  assert.deepEqual(s.push(Uint8Array.from([0x94, 0xc3, 0x02, 0x01, 0x94, 0xc3, 0x00, 0x01, 0x07])).map(hex), ["07"]);
  // START1 doppelt: das zweite beginnt die Nachricht
  assert.deepEqual(new MeshtasticStrom().push(Uint8Array.from([0x94, 0x94, 0xc3, 0x00, 0x01, 0x09])).map(hex), ["09"]);
  // Leere Nachricht ist eine Nachricht
  assert.deepEqual(new MeshtasticStrom().push(Uint8Array.from([0x94, 0xc3, 0x00, 0x00])).map(hex), [""]);
});

test("Rundweg: ein Rahmen der App, wie ihn ein anderes Gerät liefert", () => {
  // Das Gerät des Empfängers gibt das Paket als FromRadio.packet heraus – dieselben
  // Felder wie unser ToRadio.packet, dazu der Absender. Nachgebaut aus unserem ToRadio.
  const rahmen = Uint8Array.from({ length: LORA_MTU }, (_, i) => (i * 7) & 0xff);
  const zum = baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: rahmen });
  assert.equal(zum[0], 0x0a, "ToRadio.packet");
  const laenge = (zum[1]! & 0x7f) | (zum[2]! << 7); // zwei Byte: das Paket ist länger als 127
  const mesh = zum.subarray(3);
  assert.equal(mesh.length, laenge);
  const von = [0x0d, 0x78, 0x56, 0x34, 0x12]; // from = 0x12345678
  const n = von.length + mesh.length;
  const vom = Uint8Array.from([0x12, (n & 0x7f) | 0x80, n >> 7, ...von, ...mesh]);
  const v = leseVomGeraet(vom) as Extract<VomGeraet, { art: "paket" }>;
  assert.deepEqual({ ...v, nutzlast: hex(v.nutzlast) }, { art: "paket", von: 0x12345678, an: 0xffffffff, kanal: 1, port: MESHTASTIC_PORT, nutzlast: hex(rahmen) });
});

test("Sendezeit nach Semtech: Presets der Firmware, Meshtastic-Kopf, eigene Werte langsam (7.5b)", () => {
  // Eigene Rechnung nach der Formel von Semtech (AN1200.13), verankert an zwei veröffentlichten
  // Werten: 20 Byte mit SF7/125 kHz 56,6 ms, mit SF12/125 kHz 1318,9 ms (Präambel 8, CR 4/5).
  const semtech = (pl: number, sf: number, bwKhz: number, cr: number, praeambel: number) => {
    const ts = 2 ** sf / (bwKhz * 1000);
    const de = ts > 0.016 ? 1 : 0;
    return (praeambel + 4.25) * ts + (8 + Math.max(Math.ceil((8 * pl - 4 * sf + 44) / (4 * (sf - 2 * de))) * cr, 0)) * ts;
  };
  assert.equal(Math.round(semtech(20, 7, 125, 5, 8) * 10000) / 10, 56.6);
  assert.equal(Math.round(semtech(20, 12, 125, 5, 8) * 10000) / 10, 1318.9);
  // Ein voller Rahmen der App: 16 Byte Kopf + Port (3) + Nutzlast mit Länge (1 + 2 + 200) + Bitfeld (2)
  const voll = 16 + 3 + 1 + 2 + LORA_MTU + 2;
  const longFast = meshtasticSendezeit({ preset: 0, vorgabe: true }, LORA_MTU);
  assert.equal(longFast, semtech(voll, 11, 250, 5, 16));
  assert.ok(longFast > 1.9 && longFast < 1.92, `LongFast ${longFast}`);
  assert.equal(meshtasticSendezeit({ preset: 1, vorgabe: true }, LORA_MTU), semtech(voll, 12, 125, 8, 16)); // LongSlow
  assert.equal(meshtasticSendezeit({ preset: 6, vorgabe: true }, 10), semtech(16 + 3 + 1 + 1 + 10 + 2, 7, 250, 5, 16)); // ShortFast, kurze Länge
  // Unbekanntes Preset: wie die Firmware LongFast; eigene Werte (ohne Vorgabe): so langsam wie LongSlow
  assert.equal(meshtasticSendezeit({ preset: 99, vorgabe: true }, LORA_MTU), longFast);
  assert.equal(meshtasticSendezeit({ preset: 0, vorgabe: false }, LORA_MTU), semtech(voll, 12, 125, 8, 16));
  // Die alte Annahme der App (200 Byte/s) rechnete mit LongFast fast die Hälfte zu wenig
  assert.ok(longFast > 1.8 * (LORA_MTU / 200));
});
