/**
 * Schritt 4.3a: Client des Solana-Zahlkanals nach `docs/ZAHLKANAL.md`.
 * Geprüft wird das Format (Gutschrift, Anweisungen, Konto) und die Prüfung
 * beim Provider – vor allem, was nicht durchgehen darf: Gutschriften eines
 * anderen Kanals, ältere oder zu hohe Beträge, fremde Schlüssel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ed25519Program, Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  GUTSCHRIFT_LAENGE, GUTSCHRIFT_PRAEFIX, KANAL_KONTO_BYTES, KANAL_PROGRAMM_ID,
  erstatteKanalIx, gutschriftNachricht, gutschriftTags, kanalAdresse, leseGutschriftTags, leseKanal, neuerSitzungsSchluessel, oeffneKanalIx,
  pruefeGutschrift, pruefeKanalEmpfaenger, rechneKanalAbIxs, signiereGutschrift, stockeKanalAufIx, teileKanalZahlung,
  type KanalStand,
} from "../src/channel.js";

const kunde = Keypair.generate().publicKey.toBase58();
const provider = Keypair.generate().publicKey.toBase58();
const ABLAUF = 1_900_000_000n;
const disk = (s: string) => Buffer.from(sha256(new TextEncoder().encode(s)).subarray(0, 8));
const empf = (n: number, ppm = 5_000) => Array.from({ length: n }, () => ({ adresse: Keypair.generate().publicKey.toBase58(), ppm }));

function stand(sitzung: string, eingezahlt = 1_000_000n): { adresse: string; stand: KanalStand } {
  const { adresse, bump } = kanalAdresse(kunde, provider, 7n);
  return { adresse, stand: { kunde, provider, sitzungsSchluessel: sitzung, nonce: 7n, eingezahlt, ausgezahlt: 0n, ablauf: ABLAUF, empfaenger: [], bump } };
}

test("Format: Programm-ID wie im Programm, Gutschrift 71 Byte – Präfix, Kanal, Betrag u64 LE, Ablauf i64 LE", () => {
  assert.equal(new PublicKey(KANAL_PROGRAMM_ID).toBase58(), KANAL_PROGRAMM_ID, "32 Byte, kanonisch geschrieben");
  const lies = (p: string) => readFileSync(new URL(`../../../contracts/solana-channel/${p}`, import.meta.url), "utf8");
  assert.deepEqual([...lies("programs/solana-channel/src/lib.rs").matchAll(/declare_id!\("(\w+)"\)/g)].map((m) => m[1]), [KANAL_PROGRAMM_ID], "declare_id!");
  assert.deepEqual([...lies("Anchor.toml").matchAll(/^solana_channel = "(\w+)"$/gm)].map((m) => m[1]), [KANAL_PROGRAMM_ID], "Anchor.toml");
  const { adresse } = kanalAdresse(kunde, provider, 1n);
  const n = gutschriftNachricht(adresse, 0x0102030405060708n, -2n);
  assert.equal(n.length, GUTSCHRIFT_LAENGE);
  assert.equal(GUTSCHRIFT_LAENGE, 71);
  assert.equal(Buffer.from(n.subarray(0, 23)).toString(), GUTSCHRIFT_PRAEFIX);
  assert.deepEqual([...n.subarray(23, 55)], [...new PublicKey(adresse).toBytes()]);
  assert.deepEqual([...n.subarray(55, 63)], [8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual([...n.subarray(63, 71)], [0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  assert.throws(() => gutschriftNachricht(adresse, -1n, 0n), /u64/);
  assert.equal(KANAL_KONTO_BYTES, 429);
});

test("Kanal-Adresse: PDA aus Kunde, Provider und nonce – jede nonce ein eigener Kanal", () => {
  const a = kanalAdresse(kunde, provider, 1n);
  const [erwartet] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), new PublicKey(kunde).toBuffer(), new PublicKey(provider).toBuffer(), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])],
    new PublicKey(KANAL_PROGRAMM_ID),
  );
  assert.equal(a.adresse, erwartet.toBase58());
  assert.notEqual(kanalAdresse(kunde, provider, 2n).adresse, a.adresse);
  assert.notEqual(kanalAdresse(provider, kunde, 1n).adresse, a.adresse, "Rollen vertauscht → anderer Kanal");
});

test("Gutschrift: gültig nur für diesen Kanal, diesen Ablauf, mit diesem Schlüssel, steigend und bis zur Einlage", () => {
  const s = neuerSitzungsSchluessel();
  const k = stand(s.oeffentlich);
  const g = signiereGutschrift(s.geheim, k.adresse, 400n, ABLAUF);
  assert.deepEqual(pruefeGutschrift(g, k, 0n), { ok: true });
  assert.deepEqual(pruefeGutschrift(g, k, 400n), { ok: false, grund: "nicht mehr als die letzte Gutschrift" });
  assert.deepEqual(pruefeGutschrift(g, k, 500n), { ok: false, grund: "nicht mehr als die letzte Gutschrift" });
  // Replay: eine Gutschrift aus einem anderen Kanal – auch umetikettiert gilt sie nicht
  const anderer = kanalAdresse(kunde, provider, 8n).adresse;
  const fremd = signiereGutschrift(s.geheim, anderer, 400n, ABLAUF);
  assert.equal(pruefeGutschrift(fremd, k, 0n).ok, false);
  assert.deepEqual(pruefeGutschrift({ ...fremd, kanal: k.adresse }, k, 0n), { ok: false, grund: "Signatur ungültig" });
  // Betrag hochgesetzt, anderer Ablauf, fremder Schlüssel, kaputte Signatur
  assert.deepEqual(pruefeGutschrift({ ...g, betrag: 900n }, k, 0n), { ok: false, grund: "Signatur ungültig" });
  assert.deepEqual(pruefeGutschrift(signiereGutschrift(s.geheim, k.adresse, 400n, ABLAUF + 1n), k, 0n), { ok: false, grund: "Ablauf passt nicht zum Kanal" });
  assert.deepEqual(pruefeGutschrift(signiereGutschrift(neuerSitzungsSchluessel().geheim, k.adresse, 400n, ABLAUF), k, 0n), { ok: false, grund: "Signatur ungültig" });
  assert.deepEqual(pruefeGutschrift({ ...g, signatur: "zz" }, k, 0n), { ok: false, grund: "Signatur hat nicht die Form" });
  // Mehr als eingezahlt
  const hoch = signiereGutschrift(s.geheim, k.adresse, 1_000_001n, ABLAUF);
  assert.deepEqual(pruefeGutschrift(hoch, k, 0n), { ok: false, grund: "mehr als die Einlage" });
  assert.deepEqual(pruefeGutschrift(signiereGutschrift(s.geheim, k.adresse, 1_000_000n, ABLAUF), k, 0n), { ok: true });
});

test("open: Daten nach Borsh, Konten in der Reihenfolge des Programms; Empfänger wie im Programm begrenzt", () => {
  const s = neuerSitzungsSchluessel();
  const e = empf(2, 25_000);
  const ix = oeffneKanalIx({ kunde, provider, nonce: 3n, betrag: 5_000_000n, ablauf: ABLAUF, sitzungsSchluessel: s.oeffentlich, empfaenger: e });
  assert.equal(ix.programId.toBase58(), KANAL_PROGRAMM_ID);
  const d = ix.data;
  assert.deepEqual(d.subarray(0, 8), disk("global:open"));
  assert.equal(d.readBigUInt64LE(8), 3n);
  assert.equal(d.readBigUInt64LE(16), 5_000_000n);
  assert.equal(d.readBigInt64LE(24), ABLAUF);
  assert.equal(new PublicKey(d.subarray(32, 64)).toBase58(), s.oeffentlich);
  assert.equal(d.readUInt32LE(64), 2);
  assert.equal(new PublicKey(d.subarray(68, 100)).toBase58(), e[0].adresse);
  assert.equal(d.readUInt32LE(100), 25_000);
  assert.equal(d.length, 68 + 2 * 36);
  assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [kunde, true, true], [provider, false, false], [kanalAdresse(kunde, provider, 3n).adresse, false, true], [SystemProgram.programId.toBase58(), false, false],
  ]);
  const basis = { kunde, provider, nonce: 3n, betrag: 1n, ablauf: ABLAUF, sitzungsSchluessel: s.oeffentlich };
  assert.throws(() => oeffneKanalIx({ ...basis, empfaenger: empf(9, 1) }), /höchstens 8/);
  assert.throws(() => oeffneKanalIx({ ...basis, empfaenger: empf(5, 20_001) }), /über 10 %/);
  assert.throws(() => oeffneKanalIx({ ...basis, empfaenger: empf(1, 0) }), /mindestens 1 ppm/);
  assert.throws(() => oeffneKanalIx({ ...basis, betrag: 0n, empfaenger: [] }), /größer als 0/);
  const kanal = kanalAdresse(kunde, provider, 3n).adresse;
  assert.throws(() => oeffneKanalIx({ ...basis, empfaenger: [{ adresse: kanal, ppm: 1 }] }), /Kanal kann nicht/);
  assert.doesNotThrow(() => pruefeKanalEmpfaenger(empf(8, 12_500)), "genau 10 % geht");
});

test("settle: Ed25519-Anweisung mit Schlüssel, Signatur und Gutschrift direkt davor; Empfänger in Kanal-Reihenfolge", () => {
  const s = neuerSitzungsSchluessel();
  const k = stand(s.oeffentlich);
  const e = empf(3);
  const g = signiereGutschrift(s.geheim, k.adresse, 12_345n, ABLAUF);
  const [pruef, settle] = rechneKanalAbIxs({ provider, gutschrift: g, sitzungsSchluessel: s.oeffentlich, empfaenger: e });
  assert.equal(pruef.programId.toBase58(), Ed25519Program.programId.toBase58());
  const d = pruef.data;
  assert.equal(d[0], 1, "genau eine Signatur");
  const [sigOff, sigIx, pkOff, pkIx, msgOff, msgLen, msgIx] = [2, 4, 6, 8, 10, 12, 14].map((o) => d.readUInt16LE(o));
  assert.deepEqual([sigIx, pkIx, msgIx], [0xffff, 0xffff, 0xffff], "alle Offsets zeigen auf die Anweisung selbst");
  assert.equal(msgLen, 71);
  assert.equal(new PublicKey(d.subarray(pkOff, pkOff + 32)).toBase58(), s.oeffentlich);
  assert.ok(ed25519.verify(d.subarray(sigOff, sigOff + 64), d.subarray(msgOff, msgOff + msgLen), d.subarray(pkOff, pkOff + 32)));
  assert.deepEqual([...d.subarray(msgOff, msgOff + msgLen)], [...gutschriftNachricht(k.adresse, 12_345n, ABLAUF)]);
  assert.deepEqual(settle.data.subarray(0, 8), disk("global:settle"));
  assert.equal(settle.data.readBigUInt64LE(8), 12_345n);
  assert.deepEqual(settle.keys.map((x) => [x.pubkey.toBase58(), x.isSigner, x.isWritable]), [
    [provider, true, true], [k.adresse, false, true], [SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(), false, false],
    ...e.map((x) => [x.adresse, false, true]),
  ]);
});

test("refund und top_up: nur Diskriminator bzw. Betrag; refund ohne Unterschrift des Kunden (Z1), top_up mit", () => {
  const kanal = kanalAdresse(kunde, provider, 1n).adresse;
  const r = erstatteKanalIx({ kunde, kanal });
  assert.deepEqual(r.data, disk("global:refund"));
  assert.deepEqual(r.keys.map((x) => [x.pubkey.toBase58(), x.isSigner, x.isWritable]), [[kunde, false, true], [kanal, false, true]]);
  const t = stockeKanalAufIx({ kunde, kanal, betrag: 77n });
  assert.deepEqual(t.data.subarray(0, 8), disk("global:top_up"));
  assert.equal(t.data.readBigUInt64LE(8), 77n);
  assert.deepEqual(t.keys.slice(0, 2).map((x) => [x.pubkey.toBase58(), x.isSigner]), [[kunde, true], [kanal, false]], "aufstocken nur der Kunde selbst");
  assert.throws(() => stockeKanalAufIx({ kunde, kanal, betrag: 0n }), /größer als 0/);
});

test("Konto lesen: alle Felder; fremde Konten und kaputte Listen abgelehnt", () => {
  const s = neuerSitzungsSchluessel();
  const e = empf(2, 7_500);
  const b = Buffer.alloc(KANAL_KONTO_BYTES);
  disk("account:Channel").copy(b, 0);
  let o = 8;
  for (const k of [kunde, provider, s.oeffentlich]) { new PublicKey(k).toBuffer().copy(b, o); o += 32; }
  o = b.writeBigUInt64LE(9n, o); o = b.writeBigUInt64LE(5_000n, o); o = b.writeBigUInt64LE(1_200n, o); o = b.writeBigInt64LE(ABLAUF, o);
  o = b.writeUInt32LE(2, o);
  for (const x of e) { new PublicKey(x.adresse).toBuffer().copy(b, o); o += 32; o = b.writeUInt32LE(x.ppm, o); }
  b[o] = 254;
  const st = leseKanal(b);
  assert.deepEqual(st, { kunde, provider, sitzungsSchluessel: s.oeffentlich, nonce: 9n, eingezahlt: 5_000n, ausgezahlt: 1_200n, ablauf: ABLAUF, empfaenger: e, bump: 254 });
  const fremd = Buffer.from(b); fremd[0] ^= 1;
  assert.throws(() => leseKanal(fremd), /kein Kanal-Konto/);
  const zuViele = Buffer.from(b); zuViele.writeUInt32LE(9, 8 + 96 + 32);
  assert.throws(() => leseKanal(zuViele), /Empfängerliste/);
  assert.throws(() => leseKanal(b.subarray(0, 50)), /zu kurz/);
});

test("Aufteilung: abgerundet je Empfänger, Rest an den Provider – auf den Lamport", () => {
  const e = [{ adresse: "a", ppm: 25_000 }, { adresse: "b", ppm: 15_000 }, { adresse: "c", ppm: 10_000 }];
  assert.deepEqual(teileKanalZahlung(1_000_000n, e), { providerLamports: 950_000n, anteile: [25_000n, 15_000n, 10_000n] });
  const r = teileKanalZahlung(999n, e);
  assert.deepEqual(r.anteile, [24n, 14n, 9n]);
  assert.equal(r.providerLamports + r.anteile.reduce((x, y) => x + y, 0n), 999n);
  assert.deepEqual(teileKanalZahlung(5n, []), { providerLamports: 5n, anteile: [] });
});

test("Transport: Gutschrift als Tags im Kern der Anfrage und zurück; kaputte Form wirft", () => {
  const s = neuerSitzungsSchluessel();
  const kanal = kanalAdresse(kunde, provider, 4n).adresse;
  const g = signiereGutschrift(s.geheim, kanal, 12_345n, ABLAUF);
  const tags = gutschriftTags(g);
  assert.deepEqual(tags, [["kanal", kanal], ["gutschrift", "12345", String(ABLAUF), g.signatur]]);
  assert.deepEqual(leseGutschriftTags([["i", "frage"], ...tags]), g);
  assert.equal(leseGutschriftTags([["i", "frage"]]), undefined, "ohne Kanal keine Gutschrift");
  assert.throws(() => leseGutschriftTags([["kanal", kanal]]), /Form/);
  assert.throws(() => leseGutschriftTags([["kanal", kanal], ["gutschrift", "-5", "1", g.signatur]]), /Form/);
  assert.throws(() => leseGutschriftTags([["kanal", kanal], ["gutschrift", "5", "1", "abc"]]), /Form/);
  assert.throws(() => leseGutschriftTags([["kanal", "kein-schluessel"], ["gutschrift", "5", "1", g.signatur]]));
});
