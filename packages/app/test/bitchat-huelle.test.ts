/**
 * B-36b3b: Bitchat über die Android-Hülle – nur unter Android, Stand und Werte streng gelesen, Senden nur in der Form, die
 * die Hülle annimmt. Die Kotlin-Seite prüft `scripts/test_android_bitchat.py`, die Rust-Seite `cargo test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BITCHAT_WERT_MAX,
  bitchatAufruf,
  bitchatHolen,
  bitchatSenden,
  bitchatStand,
  bitchatStarten,
  bitchatStoppen,
  leseBitchatStand,
  leseBitchatWerte,
} from "../src/shell/bitchat-huelle.js";

const huelle = (art: string, invoke: (b: string, a?: Record<string, unknown>) => Promise<unknown>) => ({
  __FREEDOM_NATIVE__: { huelle: art },
  __TAURI_INTERNALS__: { invoke },
});
const rahmen = (id: string, wert: number[]): number[] => [id.length, ...Buffer.from(id), wert.length >> 8, wert.length & 0xff, ...wert];

test("B-36b3b: nur unter Android – Browser und Desktop bekommen keinen Weg", async () => {
  const invoke = async () => "{}";
  assert.equal(bitchatAufruf({}), null);
  assert.equal(bitchatAufruf(huelle("desktop", invoke)), null);
  assert.ok(bitchatAufruf(huelle("android", invoke)));
  assert.equal(await bitchatStand(null), null);
  assert.equal(await bitchatStarten(null), null);
  assert.deepEqual(await bitchatHolen(null), []);
  assert.equal(await bitchatSenden("p1", Uint8Array.of(1), null), false);
});

test("B-36b3b: Stand streng – Kotlin schickt JSON, Unbekanntes und Kaputtes gilt nicht", () => {
  const gut = '{"stand":"an","werbung":"an","verbindungen":[{"id":"p1","grenze":512},{"id":"z12","grenze":182}]}';
  assert.deepEqual(leseBitchatStand(gut), {
    stand: "an",
    werbung: "an",
    verbindungen: [{ id: "p1", grenze: 512 }, { id: "z12", grenze: 182 }],
  });
  assert.deepEqual(leseBitchatStand('{"stand":"erlaubnis","werbung":"aus","verbindungen":[]}')?.stand, "erlaubnis");
  // Ohne Werbung verbindet sich das Gerät nur selbst (B-36b2); höchstens 64 Verbindungen
  const viele = (n: number) =>
    JSON.stringify({ stand: "an", werbung: "nicht-moeglich", verbindungen: Array.from({ length: n }, (_, i) => ({ id: `z${i + 1}`, grenze: 20 })) });
  assert.equal(leseBitchatStand(viele(64))?.verbindungen.length, 64);
  assert.equal(leseBitchatStand(viele(65)), null, "über 64 Verbindungen");
  for (const kaputt of [
    gut.replace('"an","werbung"', '"vielleicht","werbung"'),
    gut.replace('"werbung":"an"', '"werbung":"laut"'),
    gut.replace('"p1"', '"x1"'),
    gut.replace("512", "511.5"),
    gut.replace("512", "513"),
    gut.replace("182", "19"),
    '{"stand":"an","werbung":"an"}',
    "kein json",
    { stand: "an", werbung: "an", verbindungen: [] },
  ]) {
    assert.equal(leseBitchatStand(kaputt), null, String(typeof kaputt === "string" ? kaputt : "Objekt statt Text"));
  }
});

test("B-36b3b: Werte aus der Hülle – Kennung, Länge, Bytes; ein Fehler macht alles ungültig", () => {
  const d = Uint8Array.from([...rahmen("p1", [1, 2, 3]), ...rahmen("z42", new Array(512).fill(7))]);
  const werte = leseBitchatWerte(d)!;
  assert.deepEqual(werte.map((w) => [w.id, w.wert.length, w.wert[0]]), [["p1", 3, 1], ["z42", 512, 7]]);
  assert.deepEqual(leseBitchatWerte(new Uint8Array(0)), []);
  assert.equal(leseBitchatWerte(d.subarray(0, d.length - 1)), null, "abgeschnitten");
  assert.equal(leseBitchatWerte(Uint8Array.from(rahmen("p1", new Array(513).fill(0)))), null, "über 512");
  assert.equal(leseBitchatWerte(Uint8Array.from(rahmen("p1", []))), null, "leer");
  assert.equal(leseBitchatWerte(Uint8Array.from(rahmen("q1", [1]))), null, "fremde Kennung");
});

test("B-36b3b: Kommandos – senden nur ganze Werte bis 512 Byte, holen auch als ArrayBuffer", async () => {
  const gerufen: [string, Record<string, unknown> | undefined][] = [];
  const w = huelle("android", async (b, a) => {
    gerufen.push([b, a]);
    if (b === "bitchat_stand") return '{"stand":"bereit","werbung":"aus","verbindungen":[]}';
    if (b === "bitchat_starten") return "erlaubnis";
    if (b === "bitchat_senden") return true;
    if (b === "bitchat_holen") return Uint8Array.from(rahmen("z1", [9, 9])).buffer;
    return null;
  });
  const aufruf = bitchatAufruf(w);
  assert.equal((await bitchatStand(aufruf))?.stand, "bereit");
  assert.equal(await bitchatStarten(aufruf), "erlaubnis");
  assert.equal(await bitchatSenden("z1", Uint8Array.of(1, 2), aufruf), true);
  assert.deepEqual(gerufen.at(-1), ["bitchat_senden", { id: "z1", wert: [1, 2] }]);
  const vorher = gerufen.length;
  assert.equal(await bitchatSenden("z1", new Uint8Array(BITCHAT_WERT_MAX + 1), aufruf), false, "zu groß – nie geteilt");
  assert.equal(await bitchatSenden("z1", new Uint8Array(0), aufruf), false);
  assert.equal(await bitchatSenden("../1", Uint8Array.of(1), aufruf), false);
  assert.equal(gerufen.length, vorher, "nichts davon erreicht die Hülle");
  assert.deepEqual((await bitchatHolen(aufruf)).map((x) => [x.id, [...x.wert]]), [["z1", [9, 9]]]);
  await bitchatStoppen(aufruf);
  assert.equal(gerufen.at(-1)?.[0], "bitchat_stoppen");
  // Fehler der Hülle (etwa „kein-android“) werden zu nichts
  const fehler = bitchatAufruf(huelle("android", async () => {
    throw new Error("kein-android");
  }));
  assert.equal(await bitchatStand(fehler), null);
  assert.equal(await bitchatStarten(fehler), null);
  assert.equal(await bitchatSenden("p1", Uint8Array.of(1), fehler), false);
  assert.deepEqual(await bitchatHolen(fehler), []);
});
