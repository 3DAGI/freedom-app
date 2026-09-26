/**
 * Schritt 2.2b-b: MLS-Engine in der App – entpacken, erst bei Bedarf starten,
 * nach einem Fehlschlag neu versuchen, Selbsttest mit festen Texten.
 * (Im Browser unter der echten CSP prüft das scripts/smoke_test.py.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { entpacke, mlsEngine, mlsSelbsttest } from "../src/mls-engine.js";

const gz = readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url));
const echt = async () => gz.toString("base64");

test("entpacke: Base64 der .wasm.gz ergibt genau die WASM-Datei; kein gzip → Fehler", async () => {
  const wasm = await entpacke(gz.toString("base64"));
  assert.deepEqual(Buffer.from(wasm), gunzipSync(gz));
  assert.deepEqual([...wasm.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], "WASM-Kennung");
  await assert.rejects(entpacke(Buffer.from("kein gzip").toString("base64")));
});

test("Selbsttest ohne Engine: gescheitert mit festem Text, kein Fremdtext", async () => {
  const r = await mlsSelbsttest(async () => { throw new Error("<b>fremd</b>"); });
  assert.equal(r.ok, false);
  assert.equal(r.text, "Die MLS-Engine startet in diesem Browser nicht.");
  const kaputt = await mlsSelbsttest(async () => Buffer.from("kein gzip").toString("base64"));
  assert.equal(kaputt.ok, false);
  assert.ok(!kaputt.text.includes("fremd"));
});

test("mlsEngine: nach einem Fehlschlag neuer Versuch, danach nur noch einmal geladen", async () => {
  let aufrufe = 0;
  await assert.rejects(mlsEngine(async () => { aufrufe++; throw new Error("weg"); }));
  await mlsEngine(async () => { aufrufe++; return echt(); });
  assert.equal(aufrufe, 2, "der Fehlschlag wird nicht gemerkt");
  await mlsEngine(async () => { aufrufe++; throw new Error("darf nicht gerufen werden"); });
  assert.equal(aufrufe, 2, "gestartet ist gestartet – kein zweites Laden");
});

test("Selbsttest: Gruppe, Einladung, Nachricht verschlüsselt und gelesen", async () => {
  const r = await mlsSelbsttest(echt);
  assert.equal(r.ok, true, r.text);
  assert.equal(r.text, "Gruppe angelegt, eingeladen, Nachricht verschlüsselt und gelesen.");
  assert.ok(r.ms >= 0);
});
