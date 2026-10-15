/**
 * Schritt C-50a (Oberflächen-Review 15.10.2026): Kontostand oben im Wallet und vier Aktionen.
 * Eine Summe nur mit Kurs (Regel „ohne Kurs keinen SOL-Preis erfinden“), ein unbekannter Stand macht
 * sie „unvollständig“, ohne Konto keine Null, sondern der Hinweis.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gesamtStand } from "../src/wallet-gesamt.js";
import { setLang } from "../src/i18n.js";

setLang("de");
const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const KURS = { satsProSol: 150_000 };

test("ohne Konto keine Zahl – auch nicht 0", () => {
  assert.equal(gesamtStand({}), null);
  assert.equal(gesamtStand({}, KURS, "sol"), null);
});

test("mit Kurs eine Summe in der gewählten Einheit, die andere darunter", () => {
  // 840 000 sats + 0,1 SOL (= 15 000 sats bei 150 000 sats je SOL)
  const stand = { lnMsat: 840_000_000, solLamports: 100_000_000 };
  assert.deepEqual(gesamtStand(stand, KURS, "sats"), { betrag: "855.000", einheit: "sats", zusatz: "≈ 5,7 SOL", summe: true, vollstaendig: true });
  assert.deepEqual(gesamtStand(stand, KURS, "sol"), { betrag: "5,7", einheit: "SOL", zusatz: "≈ 855.000 sats", summe: true, vollstaendig: true });
  // „eigene“ Einheit zeigt sats wie bisher
  assert.equal(gesamtStand(stand, KURS, "eigene")?.einheit, "sats");
});

test("ohne Kurs keine Summe: beide Beträge getrennt, nie erfunden", () => {
  const stand = { lnMsat: 2_100_000, solLamports: 13_730_000 };
  assert.deepEqual(gesamtStand(stand, undefined, "sats"), { betrag: "2.100", einheit: "sats", zusatz: "+ 0,0137 SOL", summe: false, vollstaendig: true });
  assert.deepEqual(gesamtStand(stand, undefined, "sol"), { betrag: "0,0137", einheit: "SOL", zusatz: "+ 2.100 sats", summe: false, vollstaendig: true });
  // Nur ein Konto: dessen Einheit, auch wenn die andere gewählt ist
  assert.deepEqual(gesamtStand({ solLamports: 50_000_000 }, undefined, "sats"), { betrag: "0,05", einheit: "SOL", zusatz: "", summe: false, vollstaendig: true });
  assert.deepEqual(gesamtStand({ lnMsat: 5_000 }, undefined, "sol"), { betrag: "5", einheit: "sats", zusatz: "", summe: false, vollstaendig: true });
});

test("ein unbekannter Stand macht die Summe unvollständig – nie als 0 verkauft", () => {
  assert.equal(gesamtStand({ lnMsat: null, solLamports: 100_000_000 }, KURS)?.vollstaendig, false);
  assert.equal(gesamtStand({ lnMsat: 1_000, solLamports: null }, KURS)?.vollstaendig, false);
  assert.equal(gesamtStand({ lnMsat: 1_000, solLamports: 5, fehlt: true }, KURS)?.vollstaendig, false);
  // Negative oder krumme Angaben: auf 0 bzw. ganze Einheiten
  assert.equal(gesamtStand({ lnMsat: -500 }, undefined, "sats")?.betrag, "0");
});

test("verdrahtet: die Stände kommen dorther, wo die App sie ohnehin holt – kein zusätzlicher Abruf, nichts gemerkt", () => {
  const ui = quelle("../src/shell/wallet-gesamt-ui.ts");
  assert.doesNotMatch(ui, /fetch|localStorage|geheim|publish|ensurePool/);
  const w = quelle("../src/shell/tabs/waehrung.ts");
  assert.match(w, /merkeStand\("ln", balance\);/);
  assert.match(w, /merkeStand\("ln", undefined\);/);
  assert.match(w, /merkeStand\("solBrowser", bal\.lamports\);/);
  assert.match(w, /merkeStand\("solBrowser", null\);/);
  const e = quelle("../src/shell/eingebaute-wallet.ts");
  assert.match(e, /merkeStand\("solEingebaut", summe\);/);
  assert.match(e, /merkeStand\("solEingebaut", null\);/);
  assert.match(quelle("../src/shell/app.ts"), /wireWalletAktionen\(\);/);
  const html = quelle("../src/shell/index.html");
  const karte = html.slice(html.indexOf('<div class="card wallet-gesamt" id="wallet-gesamt">'), html.indexOf('<div class="grid-2">', html.indexOf('id="wallet-gesamt"')));
  for (const id of ["wg-zahl", "wg-einheit", "wg-zusatz", "wallet-empfangen", "wallet-senden", "wallet-tauschen", "wallet-hinterlegen"]) assert.match(karte, new RegExp(`id="${id}"`), id);
  assert.match(karte, /id="wallet-tauschen"[^>]*data-subtab-ziel="swap"/);
  assert.match(karte, /id="wallet-hinterlegen"[^>]*data-subtab-ziel="lp"/);
});

test("C-50b: Konten als Zeilen mit Stand – die Verbindung dahinter, offen nur ohne Konto; „Wallet verbinden“ nur noch einmal", () => {
  const html = quelle("../src/shell/index.html");
  for (const [details, stand] of [["ln-verwalten", "ln-balance"], ["sol-verwalten", "sol-stand"]]) {
    assert.match(html, new RegExp(`<div id="${stand}" class="konto-stand">—</div></div>\\s*<details id="${details}" class="konto-verwalten" open>`), details);
  }
  // Die Felder stehen in der Verbindung, nicht mehr offen auf der Übersicht
  const ln = html.slice(html.indexOf('<details id="ln-verwalten"'), html.indexOf("</details>", html.indexOf('<details id="ln-verwalten"')));
  for (const id of ["nwc-uri", "nwc-connect", "nwc-privat", "nwc-eigenes-relay"]) assert.match(ln, new RegExp(`id="${id}"`), id);
  const sol = html.slice(html.indexOf('<details id="sol-verwalten"'), html.indexOf("</details>", html.indexOf('<details id="sol-verwalten"')));
  for (const id of ["kurs-info", "sol-connect", "solw-box", "solw-einrichten"]) assert.match(sol, new RegExp(`id="${id}"`), id);
  // Verbunden oder eingerichtet: zu; getrennt: wieder offen
  const w = quelle("../src/shell/tabs/waehrung.ts");
  assert.match(w, /merkeStand\("ln", balance\);[^\n]*\n\s+document\.getElementById\("ln-verwalten"\)\?\.removeAttribute\("open"\);/);
  assert.match(w, /merkeStand\("ln", undefined\);\n\s+document\.getElementById\("ln-verwalten"\)\?\.setAttribute\("open", ""\);/);
  assert.match(w, /document\.getElementById\("sol-verwalten"\)\?\.removeAttribute\("open"\);/);
  assert.match(quelle("../src/shell/eingebaute-wallet.ts"), /document\.getElementById\("sol-verwalten"\)\?\.removeAttribute\("open"\);/);
  // Der Kopf der Seite ohne „Wallet verbinden“; das KI-Budget als eigene Karte
  assert.doesNotMatch(html, /id="nb-wallet"/);
  assert.equal((html.match(/data-i18n="waehr\.walletVerbinden"/g) ?? []).length, 1, "nur noch an der Lightning-Verbindung");
  assert.match(html, /<div class="card ki-budget-karte nav-balances" id="nav-balances">\s*<div class="nb-row">/);
});
