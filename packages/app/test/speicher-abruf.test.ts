/**
 * Schritt 8.9b: Fehlen auf den Relays Stuecke, fragt die App Speicherknoten
 * versiegelt an und laedt die Datei danach vom Relay. Der Knoten ist hier
 * nachgebildet (oeffnen, gespeichertes Stueck erneut veroeffentlichen) –
 * der echte ist in node/test/speicher-ausfall.test.ts geprueft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_BLOB_CHUNK, KIND_GIFT_WRAP, LocalSigner, MemoryRelay, OutboxPool, buildCapabilities, generateKeypair, getTag,
  openPrivateKundenEvent, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { downloadBlob, oeffneAnhang, uploadAnhang, uploadBlob } from "../src/blob-client.js";
import { speicherKnoten, frageKnotenAn } from "../src/speicher-abruf.js";

const JETZT = Math.floor(Date.now() / 1000);
const angebot = (k: { pk: string; sk: Uint8Array }, at: number, storage = true, pow = 0) =>
  signEvent(buildCapabilities({
    pubkey: k.pk, tier: "free", models: [], textRatePerKTokenMsat: 0, tools: [], currentlyFree: true,
    ...(storage ? { storage: { capacityBytes: 1e9, priceMsatPerMB: 1, bootstrap: false } } : {}), powBits: pow,
  }, at), k.sk);

test("8.9b: Speicherknoten aus Angeboten – frisch, mit Speicher, je Schluessel das neueste", () => {
  const [a, b, c] = [generateKeypair(), generateKeypair(), generateKeypair()];
  const k = speicherKnoten([angebot(a, JETZT - 100, true, 12), angebot(a, JETZT - 50, true, 10), angebot(b, JETZT, false), angebot(c, JETZT - 90_000)], JETZT);
  assert.deepEqual(k, [{ pk: a.pk, powBits: 10 }]);
  const viele = Array.from({ length: 6 }, () => generateKeypair());
  assert.equal(speicherKnoten(viele.map((x, i) => angebot(x, JETZT - i)), JETZT).length, 4);
});

/** Knoten wie in 8.9a: haelt Stuecke, veroeffentlicht sie auf versiegelten Abruf erneut. */
function knoten(relay: MemoryRelay, gehalten: NostrEvent[]) {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const gesehen = new Set<string>();
  return {
    kp,
    async takt() {
      for (const w of await relay.query({ kinds: [KIND_GIFT_WRAP], "#p": [kp.pk] })) {
        if (gesehen.has(w.id)) continue;
        gesehen.add(w.id);
        const r = await openPrivateKundenEvent(w, signer, 0);
        if (!r.ok || r.request.kind !== 5075) continue;
        const idx = r.request.tags.find((t) => t[0] === "param" && t[1] === "shard")?.[2];
        const ev = gehalten.find((e) => getTag(e, "blob") === getTag(r.request, "i") && getTag(e, "index") === idx);
        if (ev) await relay.publish(ev);
      }
    },
  };
}

test("8.9b: Download holt fehlende Stuecke von Speicherknoten – versiegelt angefragt, vom Relay gelesen", async () => {
  const hoch = new MemoryRelay("mem://hoch");
  const ich = new LocalSigner(generateKeypair().sk);
  const klartext = new TextEncoder().encode("Befund und Rechnung, bitte vertraulich. ".repeat(3000));
  const { blobId, schluessel } = await uploadAnhang(new File([klartext], "befund.pdf"), new OutboxPool([hoch], { minAcks: 1 }), ich);
  const stuecke = await hoch.query({ kinds: [KIND_BLOB_CHUNK] });
  assert.ok(stuecke.every((e) => getTag(e, "verschluesselt") === "1"), "Anhang gekennzeichnet");

  // Das Relay beim Download hat die Stuecke verloren, nur Manifest und Angebote
  const runter = new MemoryRelay("mem://runter");
  for (const m of await hoch.query({ kinds: [38040] })) await runter.publish(m);
  const k = knoten(runter, stuecke);
  await runter.publish(angebot(k.kp, JETZT));
  const pool = new OutboxPool([runter], { minAcks: 1 });
  const r = await downloadBlob(blobId, pool as never, undefined, async () => { await k.takt(); });
  assert.ok(r, "wiederhergestellt");
  assert.deepEqual(await oeffneAnhang(r!.bytes, schluessel), klartext);
  // Kein Abruf offen: nur Umschlaege an den Knoten
  assert.equal((await runter.query({ kinds: [5075] })).length, 0);
  assert.ok((await runter.query({ kinds: [KIND_GIFT_WRAP], "#p": [k.kp.pk] })).length > 0);
});

test("8.9b: Unverschluesseltes fragt keine Knoten an; ohne Knoten kein Abruf", async () => {
  const hoch = new MemoryRelay("mem://offen");
  const ich = new LocalSigner(generateKeypair().sk);
  const { blobId } = await uploadBlob(new File([new Uint8Array(5000).fill(7)], "x.bin"), new OutboxPool([hoch], { minAcks: 1 }), ich);
  const runter = new MemoryRelay("mem://offen-runter");
  for (const m of await hoch.query({ kinds: [38040] })) await runter.publish(m);
  const k = knoten(runter, await hoch.query({ kinds: [KIND_BLOB_CHUNK] }));
  await runter.publish(angebot(k.kp, JETZT));
  let pausen = 0;
  assert.equal(await downloadBlob(blobId, new OutboxPool([runter], { minAcks: 1 }) as never, undefined, async () => { pausen++; }), null);
  assert.equal(pausen, 0);
  assert.equal((await runter.query({ kinds: [KIND_GIFT_WRAP] })).length, 0);
  assert.equal(await frageKnotenAn({ pool: { publish: async () => undefined }, knoten: [], blobId, fehlend: [0, 1] }), 0);
});
