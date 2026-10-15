/**
 * Schritt E9-2 (V2 A aus `docs/E9-ENTWURF.md`, freigegeben 08.10.2026): Jeder
 * Speicherknoten nennt im Angebot selbst, bis zu welcher Größe er gratis hält –
 * ein vierter Wert im `storage`-Tag. Eine netzweite Schwelle gibt es nicht mehr.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, generateKeypair } from "../src/event.js";
import { SPEICHER_GRATIS_MAX, buildCapabilities, leseSpeicherGratis, parseCapabilities } from "../src/tiers.js";
import { KIND_BLOB_CHUNK, KIND_PROVIDER_CAPABILITIES } from "../src/kinds.js";
import { buildBlob, pruefeSpeicherStueck } from "../src/blob.js";

const A = generateKeypair();
const angebot = (storage?: { capacityBytes: number; priceMsatPerMB: number; bootstrap: boolean; gratisBytes?: number }) =>
  buildCapabilities({ pubkey: A.pk, tier: "classic", models: [], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false, storage }, 1_800_000_000);

test("E9-2: die Gratis-Grenze steht als vierter Wert im storage-Tag und wird gelesen", () => {
  const ev = angebot({ capacityBytes: 10_000, priceMsatPerMB: 1, bootstrap: false, gratisBytes: 50 * 1024 * 1024 });
  assert.deepEqual(ev.tags.find((t) => t[0] === "storage"), ["storage", "10000", "1", "0", String(50 * 1024 * 1024)]);
  assert.equal(parseCapabilities(ev).storage!.gratisBytes, 50 * 1024 * 1024);
  // Ohne Angabe bleibt das Tag wie bisher, und gelesen wird keine
  const ohne = angebot({ capacityBytes: 10_000, priceMsatPerMB: 1, bootstrap: true });
  assert.deepEqual(ohne.tags.find((t) => t[0] === "storage"), ["storage", "10000", "1", "1"]);
  assert.deepEqual(parseCapabilities(ohne).storage, { capacityBytes: 10_000, priceMsatPerMB: 1, bootstrap: true });
  // Null heißt: nichts gratis
  assert.equal(parseCapabilities(angebot({ capacityBytes: 1, priceMsatPerMB: 1, bootstrap: false, gratisBytes: 0 })).storage!.gratisBytes, 0);
});

test("E9-2: fremde Angaben streng – nur ganze Zahlen bis 1 TiB, sonst keine Angabe", () => {
  for (const roh of ["-1", "1.5", "1e9", "0x10", " 5", "007", "", String(SPEICHER_GRATIS_MAX + 1), "99999999999999"]) {
    assert.equal(leseSpeicherGratis(roh), undefined, roh);
    const ev = buildEvent(A.pk, KIND_PROVIDER_CAPABILITIES, [["d", A.pk], ["tier", "classic"], ["text_rate_msat", "1"], ["free", "0"], ["storage", "1", "1", "0", roh]], "");
    assert.equal(parseCapabilities(ev).storage!.gratisBytes, undefined, `fremd: ${roh}`);
  }
  assert.equal(leseSpeicherGratis("0"), 0);
  assert.equal(leseSpeicherGratis(String(SPEICHER_GRATIS_MAX)), SPEICHER_GRATIS_MAX);
  // Beim Bauen wird Unbrauchbares weggelassen, nie veröffentlicht
  assert.equal(angebot({ capacityBytes: 1, priceMsatPerMB: 1, bootstrap: false, gratisBytes: -5 }).tags.find((t) => t[0] === "storage")!.length, 4);
  assert.equal(angebot({ capacityBytes: 1, priceMsatPerMB: 1, bootstrap: false, gratisBytes: 1.5 }).tags.find((t) => t[0] === "storage")!.length, 4);
});

test("E9-2: das geprüfte Stück nennt die Größe der ganzen Datei – danach entscheidet der Knoten", async () => {
  // Chiffrat sieht aus wie Zufall – das prüft der Speicherknoten
  const daten = new Uint8Array(300_000);
  for (let i = 0; i < daten.length; i += 65_536) crypto.getRandomValues(daten.subarray(i, i + 65_536));
  const { chunkEvents, manifest } = await buildBlob({ name: "", mime: "", bytes: daten }, A.pk, { verschluesselt: true });
  const r = pruefeSpeicherStueck(chunkEvents[0]!);
  assert.ok(r.ok);
  assert.equal(r.groesse, manifest.sizeBytes);
  assert.equal(r.groesse, 300_000);
  assert.equal(chunkEvents[0]!.kind, KIND_BLOB_CHUNK);
});
