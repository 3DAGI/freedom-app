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
import { EINRICHTUNG_TEXT, MODELL_TEXT, ROLLEN_TEXT, SCHRITT_TEXT, befundZeile, ladenZeile, modellZeile, statusZeilen } from "../src/knoten-status-ansicht.js";
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
    assert.equal(leer.length, 8, "dazu die Zeilen zur Einrichtung (B-11c) und zu den Modellen (E9-3b)");
    assert.equal(leer.at(-2), "Einrichtung: noch nicht geprüft – oder der Knoten ist älter als B-11c", "ohne Prüfung nie „alles gut“");
    assert.equal(leer.at(-1), "Modelle: dieser Knoten meldet keine Prüfung – er ist älter als E9-3b");
    assert.equal(statusZeilen({ ...status(), speicher: null, relay: null }).length, 7);
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
  // Seit B-12d2 fragt `frageKnotenStatus()` (auch für den Haken „Wecken“), `zeigeKnotenStatus()` zeigt nur
  const fn = ui.slice(ui.indexOf("export async function frageKnotenStatus("), ui.indexOf("/** „Status abfragen“"));
  assert.match(fn, /const weg = await wegZumKnoten\(k\.knoten, sitzung\);\s*if \(!weg\) return \{ grund: t\("set\.knotenOhneRelay"\) \};/);
  assert.ok(fn.indexOf("if (!weg)") < fn.indexOf("await baueStatusAuftrag("), "ohne Weg kein Auftrag");
  assert.match(fn, /await weg\.publish\(wrap\);/);
  assert.match(fn, /\} finally \{\s*weg\.schliesse\(\);/);
  assert.match(fn, /warteAufKnoten\(weg, sitzung, requestId, KIND_DVM_KNOTEN_STATUS \+ 1000, STATUS_ZEIT_MS, STATUS_TAKT_MS\)/);
  assert.match(fn, /const s = leseKnotenStatus\(antwort\.ergebnis\);\s*return s \? \{ status: s \} : \{ grund: t\("set\.statusUnlesbar"\) \};/);
  const zeigt = ui.slice(ui.indexOf("export async function zeigeKnotenStatus("), ui.indexOf("export function wireKnotenStatus("));
  assert.match(zeigt, /const r = await frageKnotenStatus\(k\);\s*zeige\(ziel, "status" in r \? statusZeilen\(r\.status, aktuellerKurs\(\)\) : \[r\.grund\]\);/);
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
    assert.deepEqual(z.slice(-3, -1), ["Einrichtung (Prüfung beim Start):", "✓ SOL: Zahlkanal an"], "danach die Zeile zu den Modellen (E9-3b)");
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

test("E9-3b: Modelle im Status – Zeile je Modell, Fortschritt, ältere Knoten ehrlich", () => {
  setLang("de");
  try {
    assert.equal(modellZeile({ name: "qwen3.8:27b", stufe: "ok", fall: "modell.geprueft", werte: { dateien: 4, bytes: 17_000_000_000 } }),
      "✓ qwen3.8:27b: geprüft gegen das Manifest (4 Dateien, 17 GB), im Angebot");
    assert.equal(modellZeile({ name: "llama4:70b", stufe: "fehler", fall: "modell.passtNicht", werte: { brauchtGb: 48, hatGb: 32 } }),
      "✗ llama4:70b: braucht etwa 48 GB, das Gerät hat 32 GB");
    assert.equal(modellZeile({ name: "<b>x</b>", stufe: "hinweis", fall: "modell.neuerFall", werte: {} }),
      "! <b>x</b>: Befund modell.neuerFall – diese App kennt ihn noch nicht", "Name nur als Text, Unbekanntes nur mit Kennung");
    assert.equal(ladenZeile({ name: "mistral:7b", schritt: "laden", geladen: 1_000_000_000, gesamt: 4_000_000_000, seit: 1 }),
      "… mistral:7b: Ollama lädt – 25 % von etwa 4 GB");
    assert.equal(ladenZeile({ name: "mistral:7b", schritt: "laden", geladen: 5, gesamt: 4, seit: 1 }), "… mistral:7b: Ollama lädt – 100 % von etwa 0 GB", "nie über 100 %");
    assert.equal(ladenZeile({ name: "mistral:7b", schritt: "pruefen", seit: 1 }), "… mistral:7b: Schichten prüfen");
    const z = statusZeilen({ ...status(), modellPruefung: {
      befunde: [{ name: "nemotron-3.5-lightning", stufe: "hinweis", fall: "modell.ungeprueft", werte: {} }],
      laeuft: { name: "mistral:7b", schritt: "manifest", seit: 1 },
    } });
    assert.deepEqual(z.slice(-3), [
      "Modelle (Prüfung gegen das Manifest):",
      "… mistral:7b: Manifest suchen",
      "! nemotron-3.5-lightning: angeboten, aber nicht gegen ein Manifest geprüft (PROVIDER_MODELS) – am Knoten: npm run modell -- <name> --aus-registry",
    ]);
    assert.deepEqual(statusZeilen({ ...status(), modellPruefung: { befunde: [] } }).slice(-2), ["Modelle (Prüfung gegen das Manifest):", "keine Modelle gemeldet"]);
    assert.equal(statusZeilen(status()).at(-1), "Modelle: dieser Knoten meldet keine Prüfung – er ist älter als E9-3b", "nie „alles gut“ erfinden");
  } finally {
    setLang("en");
  }
  assert.equal(modellZeile({ name: "a:1", stufe: "fehler", fall: "modell.ollamaLaden", werte: { fehler: "OllamaFehler" } }), "✗ a:1: Ollama did not download (OllamaFehler)");
});

test("E9-3b: jede Modell-Kennung des Knotens hat einen Text in beiden Sprachen – und keine ohne Knoten", () => {
  const knoten = readFileSync(new URL("../../node/src/modell-pruefung.ts", import.meta.url), "utf8");
  const faelle = new Set([...knoten.matchAll(/"(modell\.[a-zA-Z]+)"/g)].map((m) => m[1]!));
  assert.ok(faelle.size >= 21, `${faelle.size} Kennungen`);
  assert.deepEqual(Object.keys(MODELL_TEXT).sort(), [...faelle].sort());
  assert.deepEqual(Object.keys(SCHRITT_TEXT).sort(), ["laden", "manifest", "pruefen", "vorpruefung"]);
  for (const k of [...Object.values(MODELL_TEXT), ...Object.values(SCHRITT_TEXT), "set.statusModellPruefung", "set.statusModelleFehlt", "set.statusModelleKeine", "set.modLaedt", "set.modLaedtAnteil"]) {
    assert.ok(settings[k]?.de && settings[k]?.en, k);
  }
});
