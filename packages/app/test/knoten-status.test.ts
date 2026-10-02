/**
 * Status meines Knotens in der App (B-11b, L6 A – nur lesen): nur auf
 * Knopfdruck, nur gekoppelt, über den Weg zu meinem Knoten (B-9c2); gezeigt
 * nur, was `leseKnotenStatus()` durchlässt, als Text in beiden Sprachen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STATUS_ROLLEN, type KnotenStatus } from "@freedomstack/protocol";
import { setLang } from "../src/i18n.js";
import { EINRICHTUNG_TEXT, ROLLEN_TEXT, befundZeile, statusZeilen } from "../src/knoten-status-ansicht.js";
import { settings } from "../src/texte/settings.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const status = (): KnotenStatus => ({
  fassung: "0.1.0",
  seit: 1_790_000_000,
  rollen: ["ki", "relay", "speicher"],
  modelle: ["qwen3.8:27b", "<b>fett</b>"],
  auftraege: { erledigt: 1234, gratis: 4, abgelehnt: 1 },
  abgerechnetMsat: 84_000,
  speicher: { belegtBytes: 3 * 1024 ** 2, quotaBytes: 10 * 1024 ** 2, gehalten: 24 },
  relay: { events: 310, verbindungen: 3 },
});

test("B-11b: Zeilen auf Deutsch – Rollen übersetzt, Modelle wie gemeldet, Beträge in sats und SOL", () => {
  setLang("de");
  try {
    const z = statusZeilen(status(), { satsProSol: 150_000 });
    assert.match(z[0]!, /^Fassung 0\.1\.0, läuft seit .*2026/);
    assert.equal(z[1], "Rollen: KI, Relay, Speicher");
    assert.equal(z[2], "Modelle: qwen3.8:27b, <b>fett</b>", "nur Text – die Anzeige setzt ihn über textContent");
    assert.equal(z[3], "Aufträge seit dem Start: 1.234 erledigt (davon 4 gratis), 1 abgelehnt");
    assert.match(z[4]!, /^Abgerechnet seit dem Start: 84 sats ≈ 0,00056 SOL – verlangt/);
    assert.equal(z[5], "Speicher: 3 MB von 10 MB belegt, 24 Stücke für mich gehalten");
    assert.equal(z[6], "Relay: 310 Events, 3 Verbindungen");
    // Ohne Kurs kein erfundener SOL-Betrag; ohne Speicher und Relay keine Zeile; leere Listen „keine“
    const leer = statusZeilen({ ...status(), rollen: [], modelle: [], speicher: { belegtBytes: 0, quotaBytes: 0, gehalten: 0 }, relay: null });
    assert.equal(leer[1], "Rollen: keine");
    assert.equal(leer[2], "Modelle: keine");
    assert.match(leer[4]!, /84 sats \(SOL: kein Kurs\)/);
    assert.equal(leer[5], "Speicher: 0 MB belegt (ohne Grenze), 0 Stücke für mich gehalten");
    assert.equal(leer.length, 7, "dazu die Zeile zur Einrichtung (B-11c)");
    assert.equal(leer.at(-1), "Einrichtung: noch nicht geprüft – oder der Knoten ist älter als B-11c", "ohne Prüfung nie „alles gut“");
    assert.equal(statusZeilen({ ...status(), speicher: null, relay: null }).length, 6);
  } finally {
    setLang("en");
  }
});

test("B-11b: Zeilen auf Englisch, und jede Rolle hat einen Text in beiden Sprachen", () => {
  setLang("en");
  const z = statusZeilen(status());
  assert.equal(z[1], "Roles: AI, relay, storage");
  assert.equal(z[3], "Jobs since start: 1,234 done (4 of them free), 1 declined");
  assert.deepEqual(Object.keys(ROLLEN_TEXT).sort(), [...STATUS_ROLLEN].sort());
  for (const k of [...Object.values(ROLLEN_TEXT), "set.knotenStatusHolen", "set.statusFragt", "set.statusSchweigt", "set.statusAbgelehnt",
    "set.statusUnlesbar", "set.statusFehler", "set.statusFassung", "set.statusRollen", "set.statusModelle", "set.statusAuftraege",
    "set.statusAbgerechnet", "set.statusSpeicher", "set.statusSpeicherOhne", "set.statusRelay", "set.statusKeine"]) {
    assert.ok(settings[k]?.de && settings[k]?.en, k);
  }
});

test("B-11b: Verdrahtung – nur auf Knopfdruck, über den Weg, ohne Relay nichts, nur gelesener Status als Text", () => {
  const ui = lies("shell/knoten-status-ui.ts");
  const fn = ui.slice(ui.indexOf("export async function zeigeKnotenStatus("), ui.indexOf("export function wireKnotenStatus("));
  assert.match(fn, /const weg = await wegZumKnoten\(k\.knoten, sitzung\);\s*if \(!weg\) return zeige\(ziel, \[t\("set\.knotenOhneRelay"\)\]\);/);
  assert.ok(fn.indexOf("if (!weg)") < fn.indexOf("await baueStatusAuftrag("), "ohne Weg kein Auftrag");
  assert.match(fn, /await weg\.publish\(wrap\);/);
  assert.match(fn, /\} finally \{\s*weg\.schliesse\(\);/);
  assert.match(fn, /const s = leseKnotenStatus\(antwort\.ergebnis\);\s*zeige\(ziel, s \? statusZeilen\(s, aktuellerKurs\(\)\) : \[t\("set\.statusUnlesbar"\)\]\);/);
  assert.doesNotMatch(ui, /innerHTML|localStorage|ensurePool/, "nur Text, nichts gemerkt, nie am Weg vorbei");
  assert.match(ui, /ziel\.replaceChildren\(\.\.\.zeilen\.map\(\(z\) => el\("div", z\)\)\);/);
  // Gefragt wird nur beim Klick, nie beim Start
  assert.match(ui, /export function wireKnotenStatus\(\): void \{\s*document\.getElementById\("knoten-status-holen"\)\?\.addEventListener\("click", \(\) => void zeigeKnotenStatus\(\)\);\s*\}/);
  assert.match(lies("shell/app.ts"), /wireKnotenWeg\(\);\s*wireKnotenStatus\(\);/);
  // Nur gekoppelt sichtbar; entkoppelt bleibt keine alte Anzeige stehen
  const mk = lies("shell/mein-knoten.ts");
  assert.match(mk, /document\.getElementById\("knoten-status-holen"\)\?\.toggleAttribute\("hidden", !k\);\s*if \(!k\) document\.getElementById\("knoten-status-anzeige"\)\?\.replaceChildren\(\);/);
  assert.doesNotMatch(mk, /localStorage|publish/, "mein-knoten.ts bleibt frei davon (B-8c)");
  const html = lies("shell/index.html");
  assert.match(html, /<button id="knoten-status-holen" class="ghost"[^>]* hidden data-i18n="set\.knotenStatusHolen">/);
  assert.match(html, /<div id="knoten-status-anzeige" class="mono-sm"[^>]* aria-live="polite"><\/div>/);
});

test("B-11c: Befunde der Einrichtung – Text aus der Kennung, SOL aus Lamports, Unbekanntes nur mit Kennung", () => {
  setLang("de");
  try {
    assert.equal(befundZeile({ schiene: "lightning", stufe: "ok", fall: "ln.ok", werte: { min: 1, max: 100_000 } }),
      "✓ Lightning: Die Lightning-Adresse stellt Rechnungen aus (1 bis 100.000 sats)");
    assert.equal(befundZeile({ schiene: "sol", stufe: "hinweis", fall: "sol.wenigGuthaben", werte: { lamports: 0, mindestLamports: 1_000_000 } }),
      "! SOL: Die Adresse des Knotens hat 0 SOL – für die Gebühren der Einlösungen braucht sie mindestens 0,001 SOL");
    assert.equal(befundZeile({ schiene: "lightning", stufe: "fehler", fall: "ln.unerreichbar", werte: { fehler: "AbortError" } }),
      "✗ Lightning: Die Lightning-Adresse ist nicht erreichbar (AbortError)");
    assert.equal(befundZeile({ schiene: "sol", stufe: "hinweis", fall: "sol.neuerFall", werte: {} }), "! SOL: Befund sol.neuerFall – diese App kennt ihn noch nicht");
    const z = statusZeilen({ ...status(), einrichtung: [{ schiene: "sol", stufe: "ok", fall: "sol.kanalAn", werte: {} }] });
    assert.deepEqual(z.slice(-2), ["Einrichtung (Prüfung beim Start):", "✓ SOL: Zahlkanal an"]);
  } finally {
    setLang("en");
  }
  assert.equal(befundZeile({ schiene: "sol", stufe: "ok", fall: "sol.kanalAn", werte: {} }), "✓ SOL: Payment channel on");
});

test("B-11c: jede Kennung des Knotens hat einen Text in beiden Sprachen – und keine ohne Knoten", () => {
  const knoten = readFileSync(new URL("../../node/src/einrichtung.ts", import.meta.url), "utf8");
  const kasse = readFileSync(new URL("../../node/src/kanal-kasse.ts", import.meta.url), "utf8");
  const faelle = new Set([...knoten.matchAll(/"((?:ln|sol)\.[a-zA-Z]+)"/g)].map((m) => m[1]!));
  // sol.kanal… entsteht aus den Kennungen der Kasse (`KanalAusFall`)
  const aus = kasse.match(/export type KanalAusFall = ([^;]+);/)![1]!.match(/"([a-zA-Z]+)"/g)!.map((x) => x.slice(1, -1));
  for (const f of aus) faelle.add(`sol.kanal${f.charAt(0).toUpperCase()}${f.slice(1)}`);
  assert.ok(faelle.size >= 27, `${faelle.size} Kennungen`);
  assert.deepEqual(Object.keys(EINRICHTUNG_TEXT).sort(), [...faelle].sort());
  for (const k of [...Object.values(EINRICHTUNG_TEXT), "set.statusEinrichtung", "set.statusEinrichtungFehlt", "set.einUnbekannt", "set.schieneLightning", "set.schieneSol"]) {
    assert.ok(settings[k]?.de && settings[k]?.en, k);
  }
});
