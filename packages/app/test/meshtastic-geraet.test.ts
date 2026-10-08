/**
 * Schritt 7.5c: Meshtastic über Bluetooth und „Kanal anlegen“ – gegen eine
 * Attrappe, die wie ein Gerät antwortet: Einstellungen auf `want_config`,
 * `set_channel` an sich selbst, Bluetooth mit „zum Gerät“, „vom Gerät“, „Meldung“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FREEDOM_KANAL, MeshtasticStrom, baueFunkPaket, baueKanalAnlegen, mitMeshtasticKopf,
} from "@freedomstack/protocol";
import { erkenneSerielleStrecke, meshtasticBluetooth, meshtasticHinweise, type BleMerkmal } from "../src/meshtastic-strecke.js";
import type { SerialPortLike } from "../src/mesh-radio.js";
import { setLang, t } from "../src/i18n.js";

const REF = JSON.parse(readFileSync(new URL("../../protocol/test/fixtures/meshtastic-referenz.json", import.meta.url), "utf8")) as {
  vomGeraet: { fall: string; hex: string }[];
};
const vom = (fall: string): Uint8Array => Uint8Array.from(Buffer.from(REF.vomGeraet.find((f) => f.fall === fall)!.hex, "hex"));
const KNOTEN = 0xdeadbeef; // eigene Nummer in „ich“ der Referenz
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const varint = (n: number): number[] => { const o: number[] = []; while (n > 0x7f) { o.push((n % 128) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
const feld = (nr: number, inhalt: ArrayLike<number>) => [nr * 8 + 2, ...varint(inhalt.length), ...Array.from(inhalt)];

/** FromRadio.channel: Platz, Name, Schlüssel, Rolle (1 Haupt-, 2 zweiter Kanal). */
function kanal(index: number, name: string, psk: Uint8Array, rolle: number): Uint8Array {
  const settings = [...feld(2, psk), ...feld(3, new TextEncoder().encode(name))];
  return Uint8Array.from(feld(10, [0x08, index, ...feld(2, settings), 0x18, rolle]));
}
const fertig = (id: number) => Uint8Array.from([0x38, ...varint(id)]);
/** FromRadio.packet aus unserem ToRadio.packet (Feld 1 → 2), Absender 0x12345678. */
function ausDemFunk(k: number, rahmen: Uint8Array): Uint8Array {
  const zum = baueFunkPaket({ kanal: k, hopLimit: 3, nutzlast: rahmen });
  const n0 = zum[1]! < 0x80 ? zum[1]! : (zum[1]! & 0x7f) | (zum[2]! << 7);
  const mesh = zum.subarray(zum.length - n0);
  return Uint8Array.from(feld(2, [0x0d, 0x78, 0x56, 0x34, 0x12, ...mesh]));
}

/** Ein Gerät mit Meshtastic: antwortet auf Fragen, nimmt „Kanal anlegen“ an. */
class Attrappe {
  kanaele = new Map<number, Uint8Array>([[0, vom("kanal-primaer")]]);
  zumGeraet: Uint8Array[] = [];
  #aus: Uint8Array[] = [];
  #wecker: (() => void) | null = null;
  antwortet = true;
  /** Wie oft die App „vom Gerät“ gelesen hat. */
  gelesen = 0;
  constructor(weitere: Uint8Array[] = []) { weitere.forEach((k, i) => this.kanaele.set(i + 1, k)); }

  /** Eine ToRadio-Nachricht der App. */
  nimm(m: Uint8Array): void {
    this.zumGeraet.push(m);
    if (!this.antwortet) return;
    if (m[0] === 0x18) {
      let id = 0, f = 1;
      for (let i = 1; i < m.length; i++) { id += (m[i]! & 0x7f) * f; f *= 128; if (m[i]! < 0x80) break; }
      const alle = [...this.kanaele.entries()].sort((a, b) => a[0] - b[0]).map(([, k]) => k);
      this.raus(vom("ich"), vom("lora"), ...alle, fertig(id));
    }
    for (let i = 1; i <= 7; i++) {
      if (hex(m) === hex(baueKanalAnlegen({ knoten: KNOTEN, index: i }))) this.kanaele.set(i, kanal(i, "freedom", FREEDOM_KANAL.psk, 2));
    }
  }
  raus(...m: Uint8Array[]): void {
    this.#aus.push(...m);
    this.#wecker?.();
  }
  /** USB: Strom mit Kopf; liest, bis getrennt wird. */
  port(): SerialPortLike & { abgebrochen: () => boolean } {
    const strom = new MeshtasticStrom();
    let zu = false;
    return {
      abgebrochen: () => zu,
      async open() { /* offen */ },
      async close() { /* zu */ },
      writable: { getWriter: () => ({ write: async (d: Uint8Array) => { for (const m of strom.push(d)) this.nimm(m); }, releaseLock() { /* frei */ } }) },
      readable: {
        getReader: () => ({
          read: async () => {
            while (this.#aus.length === 0 && !zu) await new Promise<void>((r) => { this.#wecker = r; setTimeout(r, 20); });
            const m = this.#aus.shift();
            return m && !zu ? { value: mitMeshtasticKopf(m), done: false } : { done: true };
          },
          cancel: async () => { zu = true; this.#wecker?.(); },
          releaseLock() { /* frei */ },
        }),
      },
    };
  }
  /** Bluetooth: je Lesen eine Nachricht ohne Kopf, leer heißt „nichts mehr“; „Meldung“ bei Neuem. */
  ble(): { zumGeraet: BleMerkmal; vomGeraet: BleMerkmal; meldung: BleMerkmal & { gestoppt: () => boolean } } {
    const leer = (): Promise<void> => Promise.resolve();
    let melder: ((e: Event) => void) | null = null;
    let gestoppt = false;
    const ohne = { readValue: async () => new DataView(new ArrayBuffer(0)), writeValueWithResponse: leer, startNotifications: leer, addEventListener: () => {} };
    return {
      zumGeraet: { ...ohne, writeValueWithResponse: async (d: Uint8Array) => this.nimm(Uint8Array.from(d)) },
      vomGeraet: {
        ...ohne,
        readValue: async () => {
          this.gelesen++;
          const m = this.#aus.shift() ?? new Uint8Array(0);
          return new DataView(m.buffer, m.byteOffset, m.byteLength);
        },
      },
      meldung: {
        ...ohne,
        gestoppt: () => gestoppt,
        addEventListener: (_t: string, f: (e: Event) => void) => {
          melder = f;
          this.#wecker = () => melder?.(new Event("characteristicvaluechanged"));
        },
        stopNotifications: async () => { gestoppt = true; },
      },
    };
  }
}
const bis = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); };

test("Kanal anlegen über USB: Platz 1, an das eigene Gerät, danach senden auf diesem Kanal", async () => {
  setLang("de");
  const g = new Attrappe();
  const tr = await erkenneSerielleStrecke(g.port(), () => {});
  try {
    assert.equal(tr.meshtastic?.kanal, null);
    assert.ok(meshtasticHinweise(tr.meshtastic!).some((h) => h.startsWith("Auf dem Gerät fehlt der Kanal")));
    const vorher = g.zumGeraet.length;
    assert.equal(await tr.kanalAnlegen!(), true);
    assert.equal(hex(g.zumGeraet[vorher]!), hex(baueKanalAnlegen({ knoten: KNOTEN, index: 1 })), "set_channel auf Platz 1 an das eigene Gerät");
    assert.equal(g.zumGeraet[vorher + 1]![0], 0x18, "danach neu gefragt");
    assert.equal(tr.meshtastic?.kanal, 1);
    assert.deepEqual(meshtasticHinweise(tr.meshtastic!), [], "kein Hinweis mehr");
    const rahmen = new Uint8Array(40).fill(3);
    await tr.send(rahmen);
    assert.equal(hex(g.zumGeraet.at(-1)!), hex(baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: rahmen })));
    // Gibt es ihn schon, geht nichts mehr an das Gerät
    const zahl = g.zumGeraet.length;
    assert.equal(await tr.kanalAnlegen!(), true);
    assert.equal(g.zumGeraet.length, zahl);
    // Löscht jemand den Kanal am Gerät, gilt nach dem nächsten Neustart: kein Kanal – nie den alten weiter benutzen
    g.kanaele.delete(1);
    g.raus(vom("neustart"));
    await bis(() => tr.meshtastic?.kanal === null);
    assert.equal(tr.meshtastic?.kanal, null);
    await assert.rejects(tr.send(rahmen), { kennung: "meshtastic-ohne-kanal" });
  } finally {
    await tr.close();
  }
});

test("Kanal anlegen: ein „freedom“ mit fremdem Schlüssel wird ersetzt; ohne freien Platz nichts", async () => {
  setLang("de");
  const fremd = new Attrappe([kanal(1, "andere", new Uint8Array(16).fill(1), 2), kanal(2, "freedom", new Uint8Array(32).fill(9), 2)]);
  const a = await erkenneSerielleStrecke(fremd.port(), () => {});
  try {
    assert.equal(a.meshtastic?.kanalFremd, true);
    assert.equal(await a.kanalAnlegen!(), true);
    assert.ok(fremd.zumGeraet.some((m) => hex(m) === hex(baueKanalAnlegen({ knoten: KNOTEN, index: 2 }))), "auf seinem Platz 2, nicht auf einem neuen");
    assert.equal(a.meshtastic?.kanal, 2);
    assert.equal(a.meshtastic?.kanalFremd, false);
  } finally {
    await a.close();
  }
  const voll = new Attrappe([1, 2, 3, 4, 5, 6, 7].map((i) => kanal(i, `k${i}`, new Uint8Array(16).fill(i), 2)));
  const b = await erkenneSerielleStrecke(voll.port(), () => {});
  try {
    const zahl = voll.zumGeraet.length;
    assert.equal(await b.kanalAnlegen!(), false);
    assert.equal(voll.zumGeraet.length, zahl, "kein Platz: nichts an das Gerät, der Hauptkanal bleibt");
  } finally {
    await b.close();
  }
});

test("Bluetooth: Einstellungen lesen, empfangen nach „Meldung“, senden ohne Kopf, Kanal anlegen", async () => {
  setLang("de");
  const g = new Attrappe([kanal(1, "freedom", FREEDOM_KANAL.psk, 2)]);
  const ble = g.ble();
  let getrennt = false;
  const empfangen: string[] = [];
  const tr = await meshtasticBluetooth(ble, "T-Echo", () => { getrennt = true; }, (r) => empfangen.push(hex(r)));
  try {
    assert.equal(tr.kind, "bluetooth");
    assert.equal(tr.name, "T-Echo");
    assert.equal(tr.leitetSelbstWeiter, true);
    assert.equal(tr.meshtastic?.kanal, 1);
    assert.equal(tr.meshtastic?.region, 3);
    assert.equal(g.zumGeraet[0]![0], 0x18, "zuerst want_config – über Bluetooth ohne Kopf und ohne Wecken");
    // Ein Paket aus dem Funk: das Gerät meldet, die App liest
    const rahmen = new Uint8Array(60).fill(5);
    g.raus(ausDemFunk(0, rahmen), ausDemFunk(1, rahmen));
    await bis(() => empfangen.length > 0);
    assert.deepEqual(empfangen, [hex(rahmen)], "nur Kanal „freedom“");
    await tr.send(rahmen);
    assert.equal(hex(g.zumGeraet.at(-1)!), hex(baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: rahmen })), "ohne Strom-Kopf");
    // Gelesen wird bis „leer“, nicht darüber hinaus: je Nachricht einmal, je Leeren einmal mehr
    assert.ok(g.gelesen < 30, `${g.gelesen} Lesevorgänge`);
  } finally {
    await tr.close();
  }
  assert.ok(getrennt && ble.meldung.gestoppt(), "getrennt und Meldungen aus");

  // Ohne Kanal: über Bluetooth genauso anlegen
  const ohne = new Attrappe();
  const b = await meshtasticBluetooth(ohne.ble(), "X", () => {}, () => {});
  try {
    assert.equal(await b.kanalAnlegen!(), true);
    assert.equal(b.meshtastic?.kanal, 1);
  } finally {
    await b.close();
  }
});

test("Bluetooth: ein Gerät, das nicht antwortet, wird getrennt – mit Meldung", async () => {
  setLang("de");
  const g = new Attrappe();
  g.antwortet = false;
  let getrennt = false;
  await assert.rejects(meshtasticBluetooth(g.ble(), "Stumm", () => { getrennt = true; }, () => {}, { fristMs: 50 }), new RegExp(t("bau.meshtasticStumm")));
  assert.ok(getrennt);
});

test("Verdrahtung: Bluetooth wählt den Meshtastic-Dienst, „Kanal anlegen“ nur nach Rückfrage", () => {
  const radio = readFileSync(new URL("../src/mesh-radio.ts", import.meta.url), "utf8");
  assert.match(radio, /filters: \[\{ services: \[NUS_SERVICE\] \}, \{ services: \[MESHTASTIC_BLE\.dienst\] \}\]/);
  assert.match(radio, /const mesh = await server\.getPrimaryService\(MESHTASTIC_BLE\.dienst\)\.catch\(\(\) => null\);\n\s+if \(mesh\) \{/);
  assert.match(radio, /return meshtasticBluetooth\(/);
  const mesh = readFileSync(new URL("../src/shell/tabs/mesh.ts", import.meta.url), "utf8");
  assert.equal(mesh.match(/await zeigeGeraet\(tr\);/g)?.length, 2, "nach USB und nach Bluetooth");
  const knopf = mesh.slice(mesh.indexOf("knopf.onclick"));
  assert.ok(knopf.indexOf("await bestaetige(") < knopf.indexOf("await tr.kanalAnlegen()"), "erst die Rückfrage");
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<button id="mesh-kanal" class="ghost hidden"[^>]*data-i18n="set\.meshtasticKanalAnlegen">/);
});
