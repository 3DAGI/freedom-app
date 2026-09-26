/**
 * Schritt 8.14: Die Notfall-Loeschung erreicht alles, was die App lokal
 * ablegt. Sie loescht nach Praefix (`freedom.` in localStorage und
 * sessionStorage, `freedom…` bei Datenbanken) – dieser Waechter prueft im
 * Quelltext, dass kein Speicherort ausserhalb davon entsteht und keine
 * Speicherart dazukommt, die sie nicht kennt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { WIPE_DATENBANKEN } from "@freedomstack/protocol";

function dateien(dir: URL): { name: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "shims" ? [] : dateien(new URL(`${e.name}/`, dir));
    return e.name.endsWith(".ts") ? [{ name: e.name, text: readFileSync(new URL(e.name, dir), "utf8") }] : [];
  });
}
// App und Protokoll (die App laedt das Protokoll mit)
const quellen = [...dateien(new URL("../src/", import.meta.url)), ...dateien(new URL("../../protocol/src/", import.meta.url))];

test("8.14: jeder Schluessel in localStorage, sessionStorage und im Tresor beginnt mit freedom.", () => {
  const namen: string[] = [];
  for (const { name, text } of quellen) {
    for (const m of text.matchAll(/(?:localStorage|sessionStorage|geheim)\.(?:getItem|setItem|removeItem)\(\s*(["'`])([^"'`]*)/g)) {
      namen.push(`${name}: ${m[2]}`);
      assert.ok(m[2]!.startsWith("freedom."), `${name}: Schlüssel „${m[2]}“ entginge der Notfall-Löschung`);
    }
    for (const m of text.matchAll(/const (LS_[A-Z_]+)\s*=\s*(["'`])([^"'`]*)/g)) {
      namen.push(`${name}: ${m[1]}`);
      assert.ok(m[3]!.startsWith("freedom."), `${name}: ${m[1]} = „${m[3]}“ entginge der Notfall-Löschung`);
    }
  }
  assert.ok(namen.length > 40, `zu wenige Fundstellen (${namen.length}) – Muster veraltet?`);
});

test("8.14: jede IndexedDB-Datenbank der App steht in WIPE_DATENBANKEN", () => {
  const gefunden = new Set<string>();
  for (const { name, text } of quellen) {
    for (const m of text.matchAll(/indexedDB\.open\(\s*([^,)]+)/g)) {
      const arg = m[1]!.trim();
      if (arg === "this.dbName" || arg === "d.name" || arg === "name") continue;   // Tresor-Speicher unten; Pruefungen
      const wert = /^["'`]/.test(arg) ? arg.slice(1, -1) : new RegExp(`const ${arg}\\s*=\\s*["'\`]([^"'\`]+)`).exec(text)?.[1];
      assert.ok(wert, `${name}: Datenbankname ${arg} nicht auflösbar`);
      gefunden.add(wert!);
    }
    for (const m of text.matchAll(/new IndexedDbSpeicher\(\s*["'`]([^"'`]+)/g)) gefunden.add(m[1]!);
    for (const m of text.matchAll(/constructor\(private dbName = ["'`]([^"'`]+)/g)) gefunden.add(m[1]!);
  }
  assert.ok(gefunden.size >= 3, `gefunden: ${[...gefunden].join(", ")}`);
  for (const db of gefunden) {
    assert.ok(WIPE_DATENBANKEN.includes(db), `Datenbank „${db}“ fehlt in WIPE_DATENBANKEN`);
    assert.ok(db.startsWith("freedom"), `Datenbank „${db}“ ohne Präfix`);
  }
});

test("8.14: keine Speicherart, die die Notfall-Loeschung nicht kennt", () => {
  for (const { name, text } of quellen) {
    for (const verboten of [/\bcaches\.open\(/, /navigator\.storage\.getDirectory\(/, /document\.cookie\s*=/, /\bopenDatabase\(/, /serviceWorker\.register\(/]) {
      assert.doesNotMatch(text, verboten, `${name}: ${verboten} – erst die Notfall-Löschung erweitern`);
    }
  }
});

test("8.14: verdrahtet – Knopf in den Settings, zweiter Durchgang vor allem anderen beim Start", () => {
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /nachNotfallLoeschung\(\)\.then\(\(\) => entsperreBeimStart\(\)\)\.then\(starte\)/);
  assert.match(app, /wireNotfallLoeschung\(geldVorgangLaeuft\)/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /id="notfall-loeschen"/);
  const notfall = readFileSync(new URL("../src/shell/notfall.ts", import.meta.url), "utf8");
  assert.match(notfall, /wipeConfirmation\(\)/, "der rechtliche Hinweis steht vor dem Löschen");
  assert.match(notfall, /sucheVergessen\(\)/, "der Suchindex schreibt nicht zurück");
  assert.doesNotMatch(notfall, /\.innerHTML\s*=/);
});
