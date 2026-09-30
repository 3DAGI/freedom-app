/**
 * Sammlung A-6: Belege als CSV. Die Quittungen der KI-Zahlungen als Datei nur
 * auf diesem Gerät – Beträge in kleinster Einheit, Zeit in UTC, Zellen nach
 * RFC 4180, nichts, was eine Tabellenkalkulation als Formel liest; vor dem
 * Speichern die Warnung, dass die Datei nicht verschlüsselt ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { KanalQuittung, LightningQuittung } from "@freedomstack/protocol";
import { BELEGE_SPALTEN, belegeCsv, belegeDateiname, csvZelle } from "../src/belege-export.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const P = "ab".repeat(32);

const ln: LightningQuittung = {
  art: "lightning", provider: P, auftraege: 3, zeit: 1_790_000_000, stand: "belegt",
  betragMsat: 21_000, rechnung: "lnbc210n1pexample", preimage: "cd".repeat(32),
};
const kanal: KanalQuittung = {
  art: "kanal", provider: P, auftraege: 1, zeit: 1_789_000_000, stand: "angekuendigt",
  preisLamports: 12_345, kanal: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", gutschrift: "500000", anfrage: "ef".repeat(32),
};

test("CSV: Kopf, älteste zuerst, Beträge in msat bzw. Lamports, Zeit in UTC, CRLF", () => {
  const csv = belegeCsv([ln, kanal]);
  const zeilen = csv.split("\r\n");
  assert.equal(zeilen.length, 4, "Kopf, zwei Quittungen, leeres Ende");
  assert.equal(zeilen[0], BELEGE_SPALTEN.join(","));
  assert.equal(zeilen[1], `2026-09-10T00:26:40.000Z,kanal,${P},1,12345,lamports,angekuendigt,,,${kanal.kanal},500000,${kanal.anfrage}`);
  assert.equal(zeilen[2], `2026-09-21T14:13:20.000Z,lightning,${P},3,21000,msat,belegt,lnbc210n1pexample,${ln.preimage},,,`);
  assert.equal(zeilen[3], "");
  assert.equal(belegeCsv([]), `${BELEGE_SPALTEN.join(",")}\r\n`);
});

test("CSV: Zellen nach RFC 4180 und ohne Formel-Anfang", () => {
  assert.equal(csvZelle("einfach"), "einfach");
  assert.equal(csvZelle(42), "42");
  assert.equal(csvZelle('mit "Zitat"'), '"mit ""Zitat"""');
  assert.equal(csvZelle("a,b"), '"a,b"');
  assert.equal(csvZelle("zwei\nZeilen"), '"zwei\nZeilen"');
  for (const boese of ["=HYPERLINK(\"x\")", "+1", "-1", "@SUMME(A1)", "\tx", "\rx"]) {
    const z = csvZelle(boese);
    assert.ok(z.startsWith("'") || z.startsWith("\"'"), `${JSON.stringify(boese)} → ${z}`);
  }
  // Eine fremde Rechnung mit Formel-Anfang bleibt Text
  const csv = belegeCsv([{ ...ln, rechnung: "=cmd|' /C calc'!A0" }]);
  assert.match(csv, /,'=cmd\|' \/C calc'!A0,/);
});

test("Dateiname mit dem Tag", () => {
  assert.equal(belegeDateiname(new Date("2026-09-29T23:59:00Z")), "freedom-belege-2026-09-29.csv");
});

test("Verdrahtet: nur auf Knopfdruck, erst die Warnung, dann nur lokal speichern", () => {
  const ui = src("../src/shell/belege-ui.ts");
  assert.match(ui, /knopf\.addEventListener\("click"/);
  assert.ok(ui.indexOf("bestaetige(") < ui.indexOf("URL.createObjectURL("), "erst die Warnung, dann die Datei");
  assert.match(ui, /if \(!\(await bestaetige\(/);
  assert.match(ui, /new Blob\(\[belegeCsv\(quittungen\)\], \{ type: "text\/csv;charset=utf-8" \}\)/);
  assert.match(ui, /quittungsBuch\.alle\(\)/, "aus dem Quittungsbuch im Tresor");
  assert.doesNotMatch(ui, /fetch\(|publish\(|innerHTML/, "nichts verlässt das Gerät");
  assert.match(src("../src/shell/app.ts"), /wireBelege\(\);/);
  assert.match(src("../src/shell/index.html"), /<button id="belege-export"/);
});
