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
import { weckerAbmelden } from "../src/wecker-abmelden.js";

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
    for (const verboten of [/\bcaches\.open\(/, /navigator\.storage\.getDirectory\(/, /document\.cookie\s*=/, /\bopenDatabase\(/]) {
      assert.doesNotMatch(text, verboten, `${name}: ${verboten} – erst die Notfall-Löschung erweitern`);
    }
  }
  // Service Worker seit B-12d2: nur der Weck-Worker, nur aus dem Haken – die Löschung kennt ihn (weckerAbmelden(), B-12d1)
  const mitWorker = quellen.filter(({ text }) => /serviceWorker\.register\(/.test(text)).map(({ name }) => name);
  assert.deepEqual(mitWorker, ["wecken-ui.ts"]);
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

/** Eine Anmeldung zum Nachstellen – zählt, was gekündigt und abgemeldet wird. */
function anmeldung(p: { abo?: boolean; aboFehler?: boolean; abmelden?: boolean | "wirft" }, zaehler: { gekuendigt: number; abgemeldet: number }) {
  return {
    pushManager: {
      getSubscription: async () => (p.abo ? { unsubscribe: async () => { if (p.aboFehler) throw new Error("x"); zaehler.gekuendigt++; return true; } } : null),
    },
    unregister: async () => { if (p.abmelden === "wirft") throw new Error("x"); zaehler.abgemeldet++; return p.abmelden ?? true; },
  } as unknown as ServiceWorkerRegistration;
}

test("B-12d1: Notfall-Löschung kündigt Push-Abos und meldet jeden Weck-Worker ab", async () => {
  const z = { gekuendigt: 0, abgemeldet: 0 };
  const sw = { getRegistrations: async () => [anmeldung({ abo: true }, z), anmeldung({}, z)] };
  assert.deepEqual(await weckerAbmelden(sw), []);
  assert.deepEqual(z, { gekuendigt: 1, abgemeldet: 2 });
  // Negativfälle: was nicht ging, steht im Ergebnis – und alles andere wird trotzdem versucht
  const y = { gekuendigt: 0, abgemeldet: 0 };
  const schief = { getRegistrations: async () => [anmeldung({ abo: true, aboFehler: true }, y), anmeldung({ abmelden: false }, y), anmeldung({ abmelden: "wirft" }, y)] };
  assert.deepEqual(await weckerAbmelden(schief), ["push", "worker", "worker"]);
  assert.equal(y.abgemeldet, 2, "trotz gescheitertem Abo abgemeldet");
  assert.deepEqual(await weckerAbmelden({ getRegistrations: async () => { throw new Error("x"); } }), ["worker"]);
  assert.deepEqual(await weckerAbmelden(undefined), [], "ohne sicheren Kontext gibt es keine Worker");
});

test("B-12d1: verdrahtet – vor dem Löschen und im zweiten Durchgang, Reste werden gemeldet", () => {
  const notfall = readFileSync(new URL("../src/shell/notfall.ts", import.meta.url), "utf8");
  const jetzt = notfall.slice(notfall.indexOf("export async function loescheJetzt("), notfall.indexOf("export async function nachNotfallLoeschung("));
  assert.ok(jetzt.indexOf("await weckerAbmelden()") > 0 && jetzt.indexOf("await weckerAbmelden()") < jetzt.indexOf("await loescheAllesLokal("));
  assert.match(jetzt, /const offen = \[\.\.\.new Set\(\[\.\.\.worker, \.\.\.b\.failed, \.\.\.b\.uebrig\]\)\];/);
  const zweiter = notfall.slice(notfall.indexOf("export async function nachNotfallLoeschung("));
  assert.match(zweiter, /const worker = await weckerAbmelden\(\)\.catch\(\(\) => \["worker"\]\);\s*const zweiter = await loescheAllesLokal/);
  assert.match(zweiter, /\[\.\.\.worker, \.\.\.zweiter\.failed, \.\.\.zweiter\.uebrig\]/);
});
