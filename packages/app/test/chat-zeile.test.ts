/**
 * Schritt C-52a (Oberflächen-Review 15.10.2026): Zeile der Chat-Liste mit Vorschau und Zeit.
 * Die Vorschau lebt nur im Speicher (nie `geheim`, nie localStorage), eine ältere Nachricht ersetzt keine neuere,
 * abgelaufene (NIP-40) verschwinden, Anhänge zeigen ihre Art statt der Adresse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { merkeVorschau, vorschauText, vorschauVon, vorschauZeile, zeitKurz } from "../src/chat-zeile.js";
import { setLang } from "../src/i18n.js";

setLang("de");
const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const anhang = (mime: string) => ({ url: "https://blossom.example/abc", mime, name: "x", size: 1 });

test("Vorschau: eine Zeile, gekürzt, Anhänge als Art – nie die Adresse", () => {
  assert.equal(vorschauText("  Hallo\n\nwie   geht's?  "), "Hallo wie geht's?");
  const lang = "ä".repeat(100);
  assert.equal(vorschauText(lang), `${"ä".repeat(79)}…`);
  assert.equal(vorschauText(JSON.stringify({ text: "Schau mal", attachments: [anhang("image/png")] })), "Schau mal");
  assert.equal(vorschauText(JSON.stringify({ text: "", attachments: [anhang("audio/webm")] })), "Sprachnachricht");
  assert.equal(vorschauText(JSON.stringify({ text: "", attachments: [anhang("image/png"), anhang("image/jpeg")] })), "Bild");
  assert.equal(vorschauText(JSON.stringify({ text: "", attachments: [anhang("image/png"), anhang("application/pdf")] })), "Anhang (2)");
  assert.ok(!vorschauText(JSON.stringify({ text: "", attachments: [anhang("application/pdf")] })).includes("blossom"));
  assert.equal(vorschauText("   "), "");
  setLang("en");
  assert.equal(vorschauText(JSON.stringify({ text: "", attachments: [anhang("audio/ogg")] })), "Voice message");
  setLang("de");
});

test("die neueste Nachricht gewinnt, eigene mit „Du:“", () => {
  merkeVorschau("a", { inhalt: "zweite", vonMir: false, zeit: 200 });
  merkeVorschau("a", { inhalt: "erste", vonMir: true, zeit: 100 });
  assert.equal(vorschauZeile(vorschauVon("a")!), "zweite");
  merkeVorschau("a", { inhalt: "dritte", vonMir: true, zeit: 300 });
  assert.equal(vorschauZeile(vorschauVon("a")!), "Du: dritte");
  // Leeres ersetzt nichts
  merkeVorschau("a", { inhalt: "  ", vonMir: false, zeit: 400 });
  assert.equal(vorschauVon("a")?.text, "dritte");
  assert.equal(vorschauVon("unbekannt"), undefined);
});

test("mit Ablauf (NIP-40) nur bis dahin", () => {
  merkeVorschau("b", { inhalt: "geheim", vonMir: false, zeit: 1000, ablauf: 2000 });
  assert.equal(vorschauVon("b", 1999)?.text, "geheim");
  assert.equal(vorschauVon("b", 2000), undefined);
  // auch danach weg, selbst mit früherer Uhr
  assert.equal(vorschauVon("b", 1500), undefined);
});

test("Zeit: heute Uhrzeit, gestern, Wochentag, Datum", () => {
  const jetzt = new Date(2026, 9, 15, 14, 30);
  const s = (d: Date) => Math.floor(d.getTime() / 1000);
  assert.equal(zeitKurz(s(new Date(2026, 9, 15, 9, 5)), jetzt), "09:05");
  assert.equal(zeitKurz(s(new Date(2026, 9, 14, 23, 59)), jetzt), "gestern");
  // Abkürzung des Wochentags aus den Daten der Laufzeit („Mo“ in Node, „Mo.“ in manchem Browser)
  assert.equal(zeitKurz(s(new Date(2026, 9, 12, 10, 0)), jetzt), new Date(2026, 9, 12).toLocaleDateString("de-DE", { weekday: "short" }));
  assert.match(zeitKurz(s(new Date(2026, 9, 12, 10, 0)), jetzt), /^Mo/);
  assert.equal(zeitKurz(s(new Date(2026, 9, 8, 10, 0)), jetzt), "08.10.");
  assert.equal(zeitKurz(s(new Date(2025, 11, 31, 10, 0)), jetzt), "31.12.25");
  assert.equal(zeitKurz(0, jetzt), "");
  assert.equal(zeitKurz(Number.NaN, jetzt), "");
  setLang("en");
  assert.equal(zeitKurz(s(new Date(2026, 9, 14, 8, 0)), jetzt), "yesterday");
  setLang("de");
});

test("verdrahtet: Abgleich, MLS, Senden und geöffneter Verlauf füllen die Vorschau – gespeichert wird sie nie", () => {
  const post = quelle("../src/shell/tabs/posteingang.ts");
  assert.match(post, /merkeVorschau\(e\.partner, \{ inhalt: e\.ev\.content, vonMir: !vomGegenueber/);
  assert.match(post, /merkeVorschau\(c\.id, \{ inhalt: letzte\.text/);
  const komm = quelle("../src/shell/tabs/kommunikation.ts");
  assert.match(komm, /merkeVorschau\(c\.id, \{ inhalt: gesendet, vonMir: true/);
  assert.match(komm, /merkeVorschau\(c\.id, \{ inhalt: letzte\.content/);
  assert.match(komm, /el\("span", zeitKurz\(c\.lastTs\), "chat-zeit"\)/);
  const zeile = quelle("../src/chat-zeile.ts");
  assert.doesNotMatch(zeile, /geheim|localStorage|sessionStorage|indexedDB/);
  // Die Unterhaltung im Tresor bekommt kein Feld für Text
  assert.doesNotMatch(komm.slice(komm.indexOf("interface ChatConversation"), komm.indexOf("export let conversations")), /vorschau/i);
});
