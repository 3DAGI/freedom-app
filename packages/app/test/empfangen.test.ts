/**
 * Schritt 12.7b: Empfangen – was der QR-Code trägt, woher Rechnung und
 * Adresse kommen. Lightning nur aus der eigenen Wallet (NWC), SOL frisch aus
 * der eingebauten Wallet, sonst ausdrücklich die verbundene; nie ein Relay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { empfangsLink } from "../src/empfangen.js";
import { leseSendeZiel } from "../src/senden.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";

test("12.7b: Links nach lightning: und Solana Pay – und „Senden“ liest sie zurück", () => {
  assert.equal(empfangsLink({ rechnung: BOLT11 }), `lightning:${BOLT11}`);
  assert.equal(empfangsLink({ adresse: SOL }), `solana:${SOL}`);
  assert.equal(empfangsLink({ adresse: SOL, lamports: 50_000_000 }), `solana:${SOL}?amount=0.05`);
  assert.equal(empfangsLink({ adresse: SOL, lamports: 1 }), `solana:${SOL}?amount=0.000000001`);
  assert.deepEqual(leseSendeZiel(empfangsLink({ rechnung: BOLT11 })), { rail: "lightning", ziel: BOLT11, betrag: { einheit: "msat", wert: 250_000_000 } });
  assert.deepEqual(leseSendeZiel(empfangsLink({ adresse: SOL, lamports: 123_456_789 })), { rail: "solana", ziel: SOL, betrag: { einheit: "lamports", wert: 123_456_789 } });
  assert.deepEqual(leseSendeZiel(empfangsLink({ adresse: SOL })), { rail: "solana", ziel: SOL });
});

test("12.7b: SOL-Adresse – erst frisch aus der eingebauten Wallet, sonst die verbundene, nie die Hauptadresse", () => {
  const z = src("../src/shell/zahlschienen.ts");
  const f = z.slice(z.indexOf("export async function eigeneSolAdresse"), z.indexOf("type WebLN"));
  assert.ok(f.indexOf("frischeEmpfangsadresse()") > 0 && f.indexOf("frischeEmpfangsadresse()") < f.indexOf("verbundeneSolanaWallet()"));
  assert.doesNotMatch(f, /\.adresse\(\)/, "nie die Hauptadresse der eingebauten Wallet");
  assert.match(f, /return adresse \? \{ adresse, art: "frisch" \} : \{ fehlt: "vorrat" \};/, "Vorrat leer → nicht ausweichen");
});

test("12.7b: Verdrahtung – Knopf, eigene Rechnung bzw. Adresse, QR und Text; nichts veröffentlicht, nichts gemerkt", () => {
  const ui = src("../src/shell/empfangen-ui.ts");
  assert.match(ui, /await eigeneRechnung\(msat\)/);
  assert.match(ui, /await eigeneSolAdresse\(\)/);
  assert.match(ui, /art: "qr", name: "qr"/);
  assert.match(ui, /art: "nurlesen"/);
  assert.doesNotMatch(ui, /publish|localStorage|geheim|nwc\./, "kein Relay, nichts gemerkt, keine Wallet am Schienen vorbei");
  assert.match(src("../src/shell/app.ts"), /\n  wireEmpfangen\(\);\n/);
  assert.match(src("../src/shell/index.html"), /<button id="wallet-empfangen" class="send-btn" type="button" data-i18n="empf.knopf">/);
});
