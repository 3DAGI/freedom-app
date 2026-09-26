/**
 * Schritt 8.1a: Merkphrase „spaeter“ bestaetigen, Leiste und Erinnerung
 * sichtbar, Import wie angekuendigt – und die Merkphrase nie in einer Sicherung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_NIE, filtereWiederherstellung, waehleSicherung } from "@freedomstack/protocol";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = src("../src/shell/app.ts");
const html = src("../src/shell/index.html");
const tresor = src("../src/shell/tresor.ts");

function funktion(kopf: string): string {
  const start = app.indexOf(kopf);
  assert.ok(start >= 0, `${kopf} nicht gefunden`);
  return app.slice(start, app.indexOf("\n}\n", start));
}

test("8.1a: Leiste und Sicherungs-Erinnerung stehen im HTML (bis dahin fehlten beide)", () => {
  assert.match(html, /<div id="onboarding-bar" class="mono-sm hidden"/);
  assert.match(html, /<div id="backup-warn" class="mono-sm hidden"/);
});

test("8.1a: Merkphrase bis zur Bestaetigung im Geheimspeicher, danach geloescht; „spaeter“ moeglich", () => {
  assert.match(funktion("async function erzeugeIdentitaetMitPhrase("), /await geheim\.setItem\(LS_MERKPHRASE, id\.mnemonic!\);\s*markHasMnemonic\(\);/);
  const dialog = funktion("async function zeigeSicherungsDialog(");
  assert.match(dialog, /markBackupConfirmed\(\);\s*\/\/[^\n]*\n\s*void geheim\.removeItem\(LS_MERKPHRASE\);/);
  assert.match(dialog, /id="bk-later"/);
  assert.match(funktion("async function sichereJetzt("), /const merkphrase = geheim\.getItem\(LS_MERKPHRASE\);\s*if \(merkphrase\) \{\s*await zeigeSicherungsDialog\(merkphrase\);/);
  assert.doesNotMatch(app, /localStorage\.setItem\(LS_MERKPHRASE/, "nie am Tresor vorbei");
  assert.match(tresor, /const GEHEIM_FEST = \[LS_KEY, LS_BUNKER, LS_MERKPHRASE,/, "mit Tresor verschluesselt, Notfall-Loeschung erfasst sie");
});

test("8.1a: die Merkphrase geht nie in eine Sicherung und kommt nie aus einer zurueck", () => {
  assert.ok(SICHERUNG_NIE.some((r) => r.test("freedom.merkphrase")));
  const lese = (k: string) => (k === "freedom.merkphrase" ? "wort ".repeat(12).trim() : k === "freedom.chats" ? "[]" : null);
  assert.deepEqual(Object.keys(waehleSicherung(["freedom.merkphrase", "freedom.chats"], lese)), ["freedom.chats"]);
  assert.deepEqual(Object.keys(filtereWiederherstellung({ "freedom.merkphrase": "x", "freedom.chats": "[]" })), ["freedom.chats"]);
});

test("8.1a: Leiste mit echtem Zustand – kein erfundener Gratis-Zaehler, Erinnerung nicht doppelt", () => {
  const leiste = funktion("export async function zeigeOnboarding(");
  assert.match(leiste, /gratisErschoepft: gratisAbgelehnt,/);
  assert.match(leiste, /merkphraseDa: geheim\.getItem\(LS_MERKPHRASE\) !== null,/);
  assert.doesNotMatch(app, /freedom\.freeLeft/, "der Zaehler wurde nie gesetzt – stand immer auf 10");
  const warn = funktion("async function zeigeBackupWarnung(");
  assert.match(warn, /localStorage\.getItem\("freedom\.usedOnce"\) === "1" && !leisteZeigtSichern/);
  const agent = src("../src/shell/tabs/agent.ts");
  assert.ok(agent.includes('if (retryTier === "free" && /bid zu niedrig/i.test((e as Error)?.message ?? String(e))) merkeGratisAbgelehnt();'));
});

test("8.1a: Import nimmt, was er ankuendigt – Merkphrase, nsec, Hex, Geraetecode", () => {
  const imp = funktion("async function importIdentity(");
  assert.match(imp, /prompt\("Merkphrase, nsec1…, 64 Zeichen Hex oder Gerätecode einfuegen:"\)/);
  assert.match(imp, /const \{ importIdentity: leseIdentitaet \} = await import\("\.\.\/identity\.js"\);/);
  assert.match(imp, /if \(mitMerkphrase\) \{\s*markHasMnemonic\(\);\s*markBackupConfirmed\(\);\s*\} else \{\s*markOhneMnemonic\(\);/);
  assert.match(imp, /void geheim\.removeItem\(LS_MERKPHRASE\);/, "die offene Merkphrase gehoerte zur alten Identitaet");
});
