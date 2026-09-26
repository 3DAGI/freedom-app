/**
 * Schritt 8.9a: Speicherknoten halten nur Verschluesseltes – Kennzeichen,
 * Form, Hash, leere Fuellung und ein Datenbereich, der wie Zufall aussieht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  baueStueckAbruf, buildBlob, nutzLaenge, pruefeSpeicherStueck, wirktZufaellig,
} from "../src/blob.js";
import { verschluesseleDatei } from "../src/datei-krypto.js";
import { generateKeypair, getTag } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { openPrivateKundenEvent } from "../src/private-job.js";

const ICH = generateKeypair();
const TEXT = new TextEncoder().encode("Liebe Beratungsstelle, anbei mein Laborbefund vom Dienstag. ".repeat(400));

test("8.9a: verschluesselt hochgeladen – jedes Stueck besteht die Pruefung des Knotens", async () => {
  const { chiffrat } = verschluesseleDatei(TEXT);
  const { manifestEvent, chunkEvents, manifest } = await buildBlob({ name: "", mime: "application/octet-stream", bytes: chiffrat }, ICH.pk, { verschluesselt: true });
  assert.equal(getTag(manifestEvent, "verschluesselt"), "1");
  assert.equal(manifest.encrypted, true);
  assert.equal(chunkEvents.length, 24);
  for (const ev of chunkEvents) {
    const r = pruefeSpeicherStueck(ev);
    assert.ok(r.ok, `Stück ${getTag(ev, "index")}: ${(r as { grund?: string }).grund}`);
  }
});

test("8.9a: ohne Kennzeichen, oder Klartext mit Kennzeichen – abgelehnt", async () => {
  const offen = await buildBlob({ name: "notiz.txt", mime: "text/plain", bytes: TEXT }, ICH.pk);
  assert.deepEqual(pruefeSpeicherStueck(offen.chunkEvents[0]!), { ok: false, grund: "nicht als verschlüsselt gekennzeichnet" });
  // Ein Hochladender, der luegt: Klartext mit Kennzeichen
  const luege = await buildBlob({ name: "", mime: "application/octet-stream", bytes: TEXT }, ICH.pk, { verschluesselt: true });
  assert.deepEqual(pruefeSpeicherStueck(luege.chunkEvents[0]!), { ok: false, grund: "sieht nicht verschlüsselt aus" });
  // Paritaet ist eine Mischung des Klartexts – faellt ebenso auf
  assert.equal(pruefeSpeicherStueck(luege.chunkEvents[16]!).ok, false);
});

test("8.9a: manipulierte Stuecke fallen heraus", async () => {
  const { chiffrat } = verschluesseleDatei(randomBytes(5000));
  const { chunkEvents } = await buildBlob({ name: "", mime: "application/octet-stream", bytes: chiffrat }, ICH.pk, { verschluesselt: true });
  const ev = chunkEvents[0]!;
  const mit = (tags: string[][], content = ev.content) => ({ ...ev, tags, content });
  const tausche = (name: string, wert: string) => ev.tags.map((t) => (t[0] === name ? [name, wert] : t));
  // Erstes Byte sicher ändern – beginnt das (zufällige) Chiffrat schon mit ff,
  // wäre "ff" keine Änderung (so bis 2.2b-b: rot in etwa 1 von 256 Läufen).
  const anders = ev.content.startsWith("ff") ? "00" : "ff";
  assert.equal((pruefeSpeicherStueck(mit(ev.tags, anders + ev.content.slice(2))) as { grund: string }).grund, "Hash passt nicht");
  assert.equal((pruefeSpeicherStueck(mit(ev.tags, "zz" + ev.content.slice(2))) as { grund: string }).grund, "Inhalt kein Hex der angegebenen Länge");
  assert.equal((pruefeSpeicherStueck(mit(tausche("index", "99"))) as { grund: string }).grund, "Erasure-Angaben unstimmig");
  assert.equal((pruefeSpeicherStueck(mit(tausche("size", "-1"))) as { grund: string }).grund, "Stück unvollständig");
  // Nicht-leere Fuellung: Daten hinter dem angegebenen Ende
  const leer = chunkEvents[1]!; // reine Fuellung (Datei kleiner als ein Stueck)
  const voll = "01" + leer.content.slice(2);
  const { sha256, toHex } = await import("../src/htlc.js");
  const bytes = Uint8Array.from(voll.match(/../g)!, (h) => parseInt(h, 16));
  const falsch = { ...leer, content: voll, tags: leer.tags.map((t) => (t[0] === "sha256" ? ["sha256", toHex(sha256(bytes))] : t)) };
  assert.equal((pruefeSpeicherStueck(falsch) as { grund: string }).grund, "Füllung nicht leer");
});

test("8.9a: Nutzlaenge je Stueck und Zufallstest", () => {
  // 100 KB, Stuecke 64 KB, 16 + 8
  const C = 64 * 1024;
  assert.equal(nutzLaenge(0, 100 * 1024, C, 16, 8), C);
  assert.equal(nutzLaenge(1, 100 * 1024, C, 16, 8), 36 * 1024);
  assert.equal(nutzLaenge(2, 100 * 1024, C, 16, 8), 0);
  assert.equal(nutzLaenge(16, 100 * 1024, C, 16, 8), C, "Paritaet so lang wie das laengste Daten-Stueck");
  assert.equal(nutzLaenge(24, 17 * C, C, 16, 8), C, "zweite Gruppe: Daten-Stueck 16");
  assert.equal(nutzLaenge(25, 17 * C, C, 16, 8), 0);
  assert.ok(wirktZufaellig(randomBytes(64 * 1024)));
  assert.ok(wirktZufaellig(randomBytes(300)));
  assert.ok(!wirktZufaellig(new Uint8Array(4096)));
  assert.ok(!wirktZufaellig(TEXT.subarray(0, 4096)));
  assert.ok(!wirktZufaellig(TEXT.subarray(0, 300)));
});

test("8.9a: Abruf ist versiegelt und nennt nur Blob und Stueck", async () => {
  const knoten = generateKeypair();
  const sitzung = new LocalSigner(generateKeypair().sk);
  const blobId = "ab".repeat(32);
  const { wrap } = await baueStueckAbruf({ sitzung, knotenPk: knoten.pk, blobId, index: 7 });
  assert.equal(wrap.kind, 1059);
  assert.ok(!JSON.stringify(wrap).includes(blobId), "Blob-ID nicht offen");
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk), 0);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.request.kind, 5075);
  assert.equal(getTag(r.request, "i"), blobId);
  assert.deepEqual(r.request.tags.find((t) => t[0] === "param"), ["param", "shard", "7"]);
  assert.equal(r.request.pubkey, sitzung.publicKey());
  await assert.rejects(baueStueckAbruf({ sitzung, knotenPk: knoten.pk, blobId: "kurz", index: 0 }), /ungültig/);
});
