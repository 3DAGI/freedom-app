/**
 * Wecken in der App (Sammlung B-12d2): Haken in „Mein Knoten“ – Abo mit dem
 * VAPID-Schlüssel des eigenen Knotens, Anmeldung versiegelt über den Weg aus
 * B-9c2; misslingt etwas, bleibt nichts halb angemeldet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WECKEN_GRENZEN, generateKeypair } from "@freedomstack/protocol";
import { weckSchluesselBytes, weckSchluesselFuer, weckWorkerAdresse, weckenMoeglich } from "../src/wecken-app.js";
import { settings } from "../src/texte/settings.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("B-12d2: Wecken nur im sicheren Kontext mit Service Worker, Push und Meldungen", () => {
  const voll = { isSecureContext: true, navigator: { serviceWorker: {} }, PushManager: {}, Notification: {} };
  assert.equal(weckenMoeglich(voll), true);
  assert.equal(weckenMoeglich({ ...voll, isSecureContext: false }), false, "http im Heimnetz (B-10)");
  assert.equal(weckenMoeglich({ ...voll, navigator: {} }), false);
  assert.equal(weckenMoeglich({ ...voll, PushManager: undefined }), false);
  assert.equal(weckenMoeglich({ ...voll, Notification: undefined }), false);
  assert.equal(weckWorkerAdresse("de"), "freedom-sw.js?sprache=de");
});

test("B-12d2: VAPID-Schlüssel des Knotens – nur genau 65 Byte mit 0x04, sonst nichts", () => {
  const bytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i));
  const b64url = Buffer.from(bytes).toString("base64url");
  assert.deepEqual(weckSchluesselBytes(b64url), bytes);
  assert.equal(weckSchluesselBytes(undefined), null);
  assert.equal(weckSchluesselBytes(""), null);
  assert.equal(weckSchluesselBytes(b64url.slice(1)), null, "zu kurz");
  assert.equal(weckSchluesselBytes(b64url + "A"), null, "zu lang");
  assert.equal(weckSchluesselBytes("B" + "+".repeat(86)), null, "kein base64url");
});

test("B-12d2: Schlüssel, deren Post weckt – Person und Geräte, ohne Doppelte, nur Hex, höchstens die Grenze", () => {
  const ich = generateKeypair().pk, g1 = generateKeypair().pk;
  assert.deepEqual(weckSchluesselFuer(ich, [g1, ich, "kaputt"]), [ich, g1]);
  const viele = Array.from({ length: 40 }, () => generateKeypair().pk);
  assert.equal(weckSchluesselFuer(ich, viele).length, WECKEN_GRENZEN.schluessel);
  assert.equal(weckSchluesselFuer(ich, viele)[0], ich, "die Person zuerst");
});

test("B-12d2: verdrahtet – Status, Erlaubnis, Worker, Abo, versiegelte Anmeldung; misslingt etwas, alles zurück", () => {
  const ui = lies("shell/wecken-ui.ts");
  const an = ui.slice(ui.indexOf("async function schalteAn("), ui.indexOf("async function schalteAus("));
  const reihe = ["await frageKnotenStatus(k)", "weckSchluesselBytes(status.status.weckSchluessel)", "await Notification.requestPermission()",
    "navigator.serviceWorker.register(", "pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid })",
    "pruefeWeckEndpunkt(abo.endpoint)", "await anKnoten(k, { aktion: \"an\""].map((s) => an.indexOf(s));
  assert.ok(reihe.every((i, n) => i > 0 && (n === 0 || i > reihe[n - 1]!)), `Reihenfolge ${reihe}`);
  assert.equal((an.match(/await weckerAbmelden\(\);/g) ?? []).length, 3, "Endpunkt untauglich, Knoten sagt nein, Fehler – jedes Mal zurück");
  const knoten = ui.slice(ui.indexOf("async function anKnoten("), ui.indexOf("async function schalteAn("));
  assert.match(knoten, /const weg = await wegZumKnoten\(k\.knoten, sitzung\);\s*if \(!weg\) return/, "ohne Weg geht nichts hinaus");
  assert.match(knoten, /await baueWeckAnmeldung\(\{ sitzung, kopplung: k, anmeldung, powBits \}\)/);
  assert.match(knoten, /\} finally \{\s*weg\.schliesse\(\);/);
  // Das Relay des Knotens liefert nur an angemeldete Schlüssel (B-9c2): gefragt wird nur nach dem des Auftrags
  const weg = lies("shell/knoten-weg-ui.ts");
  assert.match(weg.slice(weg.indexOf("export async function warteAufKnoten(")), /weg\.query\(\{ kinds: \[1059\], "#p": \[weg\.sitzungPk\], since: seit \}\)/);
  assert.doesNotMatch(ui, /localStorage|geheim\./, "gemerkt wird nichts – der Haken zeigt das Abo");
  assert.doesNotMatch(ui, /ensurePool|\.publish\(wrap\)(?![\s\S]*weg)/, "nur über den Weg zum Knoten");
  const aus = ui.slice(ui.indexOf("async function schalteAus("), ui.indexOf("export function wireWecken("));
  assert.ok(aus.indexOf("anKnoten(k, { aktion: \"ab\"") < aus.indexOf("await weckerAbmelden()"), "erst beim Knoten abmelden, dann lokal");
  // Entkoppeln nimmt Wecken mit; Sichtbarkeit nur gekoppelt; beim Start verdrahtet
  const mk = lies("shell/mein-knoten.ts");
  assert.match(mk, /await geheim\.removeItem\(LS_KOPPLUNG\);\s*\/\/[^\n]*\n\s*await weckerAbmelden\(\)\.catch\(\(\) => \[\]\);/);
  assert.match(mk, /document\.getElementById\("knoten-wecken-zeile"\)\?\.toggleAttribute\("hidden", !k\);/);
  assert.match(lies("shell/index.html"), /<label id="knoten-wecken-zeile"[^>]* hidden><input type="checkbox" id="knoten-wecken" \/> <span data-i18n="set\.knotenWecken">/);
  assert.match(lies("shell/app.ts"), /wireKnotenStatus\(\);\s*wireWecken\(\);/);
  for (const k of ["set.knotenWecken", "set.weckenFragt", "set.weckenKnotenNicht", "set.weckenKeineErlaubnis", "set.weckenKeinWorker",
    "set.weckenEndpunkt", "set.weckenAn", "set.weckenAus", "set.weckenAusOhneKnoten", "set.weckenRest", "set.weckenNichtHier"] as const) {
    assert.ok(settings[k]?.de && settings[k]?.en, k);
  }
  assert.match(settings["set.knotenWecken"].de, /Push-Dienst des Browsers sieht, wann/, "ehrlich schon am Haken");
});
