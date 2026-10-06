/**
 * Schritt 12.7a: Senden aus der Wallet – Ziel lesen, Betrag, Verdrahtung.
 * Die Schiene folgt dem Ziel; eine Rechnung trägt ihren Betrag selbst, eine
 * ohne Betrag nimmt die App nicht; gezahlt wird nur nach der Bestätigung und
 * nur über die Zahlschienen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { geltenderBetrag, leseSendeZiel, sendeBetrag, zielAnzeige, type SendeZiel } from "../src/senden.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// Beispiele aus BOLT 11: 250 000 sats bzw. ohne Betrag
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const OHNE_BETRAG = "lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w";
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const REF = "11111111111111111111111111111111";

test("12.7a: Rechnung – mit oder ohne lightning:, Betrag aus der Rechnung; ohne Betrag oder kaputt nicht", () => {
  for (const roh of [BOLT11, `lightning:${BOLT11}`, `  LIGHTNING:${BOLT11.toUpperCase()}  `]) {
    assert.deepEqual(leseSendeZiel(roh), { rail: "lightning", ziel: BOLT11, betrag: { einheit: "msat", wert: 250_000_000 } }, roh.slice(0, 20));
  }
  assert.deepEqual(leseSendeZiel(OHNE_BETRAG), { fall: "rechnung-ohne-betrag" });
  assert.deepEqual(leseSendeZiel(BOLT11.slice(0, -5) + "qqqqq"), { fall: "rechnung-unlesbar" }, "Prüfsumme falsch");
});

test("12.7a: Lightning-Adresse und Solana-Adresse – ohne Betrag, den gibt man ein", () => {
  assert.deepEqual(leseSendeZiel("Ada@Wallet.Example"), { rail: "lightning", ziel: "ada@wallet.example" });
  assert.deepEqual(leseSendeZiel("lightning:ada@wallet.example"), { rail: "lightning", ziel: "ada@wallet.example" });
  assert.deepEqual(leseSendeZiel(SOL), { rail: "solana", ziel: SOL });
});

test("12.7a: solana: nach Solana Pay – Betrag, Referenz; Token, zwei Referenzen und kaputte Beträge nicht", () => {
  assert.deepEqual(leseSendeZiel(`solana:${SOL}`), { rail: "solana", ziel: SOL });
  assert.deepEqual(leseSendeZiel(`solana:${SOL}?amount=0.05&reference=${REF}&label=Laden`),
    { rail: "solana", ziel: SOL, betrag: { einheit: "lamports", wert: 50_000_000 }, referenz: REF });
  assert.deepEqual(leseSendeZiel(`solana:${SOL}?amount=1&spl-token=${REF}`), { fall: "nur-sol" });
  assert.deepEqual(leseSendeZiel(`solana:${SOL}?reference=${REF}&reference=${SOL}`), { fall: "referenz" });
  assert.deepEqual(leseSendeZiel(`solana:${SOL}?reference=kaputt`), { fall: "referenz" });
  for (const m of ["0", "-1", "1e3", "0.0000000001", "abc"]) assert.deepEqual(leseSendeZiel(`solana:${SOL}?amount=${m}`), { fall: "betrag" }, m);
  assert.deepEqual(leseSendeZiel("solana:keine-adresse"), { fall: "unbekannt" });
});

test("12.7a: Unbekanntes und Leeres", () => {
  assert.deepEqual(leseSendeZiel("   "), { fall: "leer" });
  for (const x of ["hallo", "lnurl1dp68gurn8ghj7", "npub1" + "q".repeat(58), "bitcoin:bc1qxyz", "https://example.com"]) {
    assert.deepEqual(leseSendeZiel(x), { fall: "unbekannt" }, x);
  }
});

test("12.7a: Betrag – ganze sats bzw. SOL mit Komma oder Punkt; nichts Geratenes", () => {
  assert.deepEqual(sendeBetrag("lightning", "21"), { einheit: "msat", wert: 21_000 });
  assert.deepEqual(sendeBetrag("solana", "0,5"), { einheit: "lamports", wert: 500_000_000 });
  assert.deepEqual(sendeBetrag("solana", "0.000000001"), { einheit: "lamports", wert: 1 });
  for (const x of ["", "0", "1e3", "0x10", "2.5", "-3", "1 000"]) assert.equal(sendeBetrag("lightning", x), undefined, x);
  for (const x of ["", "0", "1e3", "-1", "0,0000000001"]) assert.equal(sendeBetrag("solana", x), undefined, x);
});

test("12.7a: Betrag aus dem Ziel gilt – ein anderer getippter ist ein Widerspruch, derselbe nicht", () => {
  const z = leseSendeZiel(BOLT11) as SendeZiel;
  assert.deepEqual(geltenderBetrag(z, ""), { einheit: "msat", wert: 250_000_000 });
  assert.deepEqual(geltenderBetrag(z, "250000"), { einheit: "msat", wert: 250_000_000 });
  assert.equal(geltenderBetrag(z, "100"), "widerspruch");
  const a = leseSendeZiel("ada@wallet.example") as SendeZiel;
  assert.equal(geltenderBetrag(a, ""), undefined);
  assert.deepEqual(geltenderBetrag(a, "100"), { einheit: "msat", wert: 100_000 });
  assert.equal(zielAnzeige(z), `${BOLT11.slice(0, 16)}…${BOLT11.slice(-8)}`);
  assert.equal(zielAnzeige(leseSendeZiel(SOL) as SendeZiel), SOL, "Adressen ganz – zum Vergleichen");
});

test("12.7a: Verdrahtung – Knopf, erst bestätigen, dann über die Zahlschienen mit Zweck „senden“", () => {
  const ui = src("../src/shell/senden-ui.ts");
  const ab = ui.indexOf("await bestaetige(");
  const zahlt = ui.indexOf('await zahle(zahlschienen(), { ziel: z.ziel, betrag, zweck: "senden"');
  assert.ok(ab > 0 && zahlt > ab, "erst bestätigen, dann zahlen");
  assert.equal((ui.match(/await zahle\(/g) ?? []).length, 1, "ein Weg zum Geld");
  assert.doesNotMatch(ui, /nwc|webln|signTransaction|localStorage/, "keine Wallet am Schienen vorbei, nichts gemerkt");
  assert.match(ui, /scannen: true/, "Ziel auch per QR-Code");
  assert.match(src("../src/shell/app.ts"), /\n  wireSenden\(\);\n/);
  assert.match(src("../src/shell/index.html"), /<button id="wallet-senden" class="send-btn" type="button" data-i18n="senden.knopf">/);
});
