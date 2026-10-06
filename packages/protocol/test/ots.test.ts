/**
 * OpenTimestamps (Schritt 5.10b, B-17) gegen die Referenz: echte
 * Kalender-Antworten, eine Nachreichung bis Bitcoin-Block 428648, ein Bündel
 * wie der ots-Client – nachgerechnet mit python-opentimestamps
 * (`scripts/ots-referenz.py`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  OTS_GRENZEN, OtsFehler, attestierungenVon, buendele, fuegeEin, leseOtsDatei, leseOtsZeitstempel,
  schreibeOtsDatei, schreibeOtsZeitstempel, wendeAn, type OtsZeitstempel,
} from "../src/ots.js";

type Att = [string, string, string | number];
const REF = JSON.parse(readFileSync(new URL("./fixtures/ots-referenz.json", import.meta.url), "utf8")) as {
  digest: string;
  kalender: { name: string; antwort: string; attestierungen: Att[] }[];
  aufwertung: { commitment: string; antwort: string; attestierungen: Att[] };
  buendel: { blaetter: string[]; nonces: string[]; spitze: string; dateien: string[]; attestierungen: Att[][] };
  alleOps: { nachricht: string; bytes: string; attestierungen: Att[] };
};
const alsListe = (z: OtsZeitstempel): Att[] =>
  attestierungenVon(z)
    .map(({ nachricht, attestierung: a }): Att => [bytesToHex(nachricht), a.art, a.art === "bitcoin" ? a.hoehe : a.art === "ausstehend" ? a.kalender : ""])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
const fehler = (kennung: string) => (e: unknown) => e instanceof OtsFehler && e.kennung === kennung && e.message === `OpenTimestamps: ${kennung}`;

test("Antworten von vier Kalendern: gelesen wie die Referenz, byte-gleich zurückgeschrieben", () => {
  assert.equal(REF.kalender.length, 4);
  for (const k of REF.kalender) {
    const z = leseOtsZeitstempel(hexToBytes(k.antwort), hexToBytes(REF.digest));
    assert.deepEqual(alsListe(z), k.attestierungen, k.name);
    assert.equal(bytesToHex(schreibeOtsZeitstempel(z)), k.antwort, k.name);
    assert.ok(alsListe(z).every((a) => a[1] === "ausstehend"), "frisch gestempelt heißt nur: versprochen");
  }
});

test("Nachreichung eines alten Stempels: endet in Bitcoin-Block 428648 mit dem Wert der Referenz", () => {
  const z = leseOtsZeitstempel(hexToBytes(REF.aufwertung.antwort), hexToBytes(REF.aufwertung.commitment));
  assert.deepEqual(alsListe(z), REF.aufwertung.attestierungen);
  assert.deepEqual(REF.aufwertung.attestierungen.map((a) => a[1]), ["bitcoin"]);
  assert.equal(REF.aufwertung.attestierungen[0]![2], 428648);
  assert.equal(bytesToHex(schreibeOtsZeitstempel(z)), REF.aufwertung.antwort);
});

test("Bündel wie der ots-Client: gleiche Spitze, jede Datei byte-gleich mit der Referenz und wieder lesbar", () => {
  const nonces = REF.buendel.nonces.map(hexToBytes);
  let i = 0;
  const { spitze, dateien } = buendele(REF.buendel.blaetter.map(hexToBytes), () => nonces[i++]!);
  assert.equal(bytesToHex(spitze.nachricht), REF.buendel.spitze);
  spitze.attestierungen.push({ art: "ausstehend", kalender: "https://alice.btc.calendar.opentimestamps.org" });
  dateien.forEach((d, n) => {
    const bytes = schreibeOtsDatei(d);
    assert.equal(bytesToHex(bytes), REF.buendel.dateien[n], `Datei ${n}`);
    const zurueck = leseOtsDatei(bytes);
    assert.equal(bytesToHex(zurueck.digest), REF.buendel.blaetter[n]);
    assert.deepEqual(alsListe(zurueck.zeitstempel), REF.buendel.attestierungen[n]);
    // Was an der Spitze ankommt, steht in jeder Datei – sie teilen sich den Baum
    assert.equal(bytesToHex(attestierungenVon(d.zeitstempel)[0]!.nachricht), REF.buendel.spitze);
  });
  assert.throws(() => buendele([], () => nonces[0]!), fehler("leeres-buendel"));
  assert.throws(() => buendele([new Uint8Array(20)], () => nonces[0]!), fehler("nur-sha256"));
  assert.throws(() => buendele([hexToBytes(REF.digest)], () => new Uint8Array(8)), fehler("nonce"));
});

test("Alle Operationen (sha1, ripemd160, keccak256, reverse, hexlify, append, prepend) und beide Attestierungen", () => {
  const z = leseOtsZeitstempel(hexToBytes(REF.alleOps.bytes), hexToBytes(REF.alleOps.nachricht));
  assert.deepEqual(alsListe(z), REF.alleOps.attestierungen);
  assert.equal(bytesToHex(schreibeOtsZeitstempel(z)), REF.alleOps.bytes);
});

test("Antworten mehrerer Kalender in einen Knoten übernehmen – ohne Doppel, wieder lesbar", () => {
  const d = hexToBytes(REF.digest);
  const ziel: OtsZeitstempel = { nachricht: d, attestierungen: [], zweige: [] };
  for (const k of REF.kalender) fuegeEin(ziel, leseOtsZeitstempel(hexToBytes(k.antwort), d));
  const einmal = bytesToHex(schreibeOtsZeitstempel(ziel));
  fuegeEin(ziel, leseOtsZeitstempel(hexToBytes(REF.kalender[1]!.antwort), d));
  assert.equal(bytesToHex(schreibeOtsZeitstempel(ziel)), einmal, "dieselbe Antwort zweimal ändert nichts");
  const alle = REF.kalender.flatMap((k) => k.attestierungen).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  assert.deepEqual(alsListe(leseOtsZeitstempel(hexToBytes(einmal), d)), alle);
  assert.throws(() => fuegeEin(ziel, { nachricht: new Uint8Array(32), attestierungen: [], zweige: [] }), fehler("andere-nachricht"));
});

test("Fremde Beweise nur in den Grenzen – Fehler nur als Kennung", () => {
  const d = hexToBytes(REF.digest);
  const gut = hexToBytes(REF.kalender[2]!.antwort);
  assert.throws(() => leseOtsZeitstempel(gut.slice(0, gut.length - 3), d), fehler("zu-kurz"));
  assert.throws(() => leseOtsZeitstempel(Uint8Array.from([...gut, 0x00]), d), fehler("rest"));
  assert.throws(() => leseOtsZeitstempel(Uint8Array.of(0x42), d), fehler("unbekannte-operation"));
  assert.throws(() => leseOtsZeitstempel(Uint8Array.of(0xf0, 0x00), d), fehler("laenge"), "append ohne Argument");
  assert.throws(() => leseOtsZeitstempel(new Uint8Array(OTS_GRENZEN.bytes + 1), d), fehler("zu-gross"));
  // 300 verschachtelte sha256 – tiefer als die Referenz erlaubt
  assert.throws(() => leseOtsZeitstempel(new Uint8Array(300).fill(0x08), d), fehler("zu-tief"));
  // Ergebnis über 4096 Bytes
  const lang = Uint8Array.from([0xf0, ...[0x80, 0x20], ...new Uint8Array(4096), 0x08]);
  assert.throws(() => leseOtsZeitstempel(lang, d), fehler("ergebnis-laenge"));
  // Kalender-Adresse mit verbotenem Zeichen
  const uri = new TextEncoder().encode("https://evil.example/<script>");
  const nutz = Uint8Array.from([uri.length, ...uri]);
  const boese = Uint8Array.from([0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, nutz.length, ...nutz]);
  assert.throws(() => leseOtsZeitstempel(boese, d), fehler("kalender-adresse"));
  // Datei: falsche Magie, falsche Version, anderer Hash als SHA-256
  const datei = hexToBytes(REF.buendel.dateien[0]!);
  const magie = Uint8Array.from(datei); magie[1] = 0x41;
  assert.throws(() => leseOtsDatei(magie), fehler("keine-ots-datei"));
  const version = Uint8Array.from(datei); version[31] = 2;
  assert.throws(() => leseOtsDatei(version), fehler("version"));
  const sha1 = Uint8Array.from(datei); sha1[32] = 0x02;
  assert.throws(() => leseOtsDatei(sha1), fehler("nur-sha256"));
  assert.throws(() => wendeAn({ art: "sha256" }, new Uint8Array(0)), fehler("nachricht-laenge"));
});

test("Unbekannte Attestierungen bleiben erhalten (Tag und Nutzlast)", () => {
  const d = hexToBytes(REF.digest);
  const tag = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  const z: OtsZeitstempel = { nachricht: d, attestierungen: [{ art: "unbekannt", tag, nutzlast: Uint8Array.of(9, 9) }], zweige: [] };
  const zurueck = leseOtsZeitstempel(schreibeOtsZeitstempel(z), d);
  assert.deepEqual(zurueck.attestierungen, [{ art: "unbekannt", tag, nutzlast: Uint8Array.of(9, 9) }]);
});
