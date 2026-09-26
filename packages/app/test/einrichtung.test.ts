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
  const dialog = funktion("async function baueSicherungsDialog(");
  assert.match(funktion("function zeigeSicherungsDialog("), /offenerSicherungsDialog \?\?= baueSicherungsDialog\(mnemonic\)/, "nie zwei Dialoge uebereinander");
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

// ------------------------------------------------------------- 8.1b Einrichtung

import { PRIVACY_FACTS } from "@freedomstack/protocol";
import {
  LS_EINRICHTUNG, LS_WERBER_ZUSTIMMUNG, darfWerberNennen, datenschutzKurz, einrichtungOffen, einrichtungsSeiten, merkphraseNochZeigen,
  zielNachEinrichtung,
} from "../src/einrichtung.js";

const speicher = (werte: Record<string, string>) => ({ getItem: (k: string) => werte[k] ?? null });

test("8.1b: Seiten in der Reihenfolge der Karte – Merkphrase, Passphrase, Schiene, privat, Vorhaben", () => {
  assert.deepEqual(einrichtungsSeiten({ merkphraseOffen: true, tresorDa: false, mitBunker: false }), ["sichern", "schutz", "zahlen", "privat", "los"]);
  assert.deepEqual(einrichtungsSeiten({ merkphraseOffen: false, tresorDa: false, mitBunker: false }), ["schutz", "zahlen", "privat", "los"], "ohne neue Merkphrase keine Merkphrasen-Seite");
  assert.deepEqual(einrichtungsSeiten({ merkphraseOffen: true, tresorDa: true, mitBunker: false }), ["sichern", "zahlen", "privat", "los"], "Tresor schon da");
  assert.deepEqual(einrichtungsSeiten({ merkphraseOffen: false, tresorDa: false, mitBunker: true }), ["zahlen", "privat", "los"], "mit Bunker kein Schluessel in der App");
});

test("8.1b: Einrichtung einmal – wer die alte Karte geschlossen hat, bekommt sie nicht nachtraeglich", () => {
  assert.equal(einrichtungOffen(speicher({})), true);
  assert.equal(einrichtungOffen(speicher({ [LS_EINRICHTUNG]: "fertig" })), false);
  assert.equal(einrichtungOffen(speicher({ "freedom.onboarded": "1" })), false);
  assert.equal(einrichtungOffen(speicher({ [LS_EINRICHTUNG]: "laeuft" })), true, "abgebrochen: beim naechsten Start weiter");
  assert.equal(merkphraseNochZeigen(speicher({})), true);
  assert.equal(merkphraseNochZeigen(speicher({ [LS_EINRICHTUNG]: "laeuft" })), false, "wer „spaeter“ waehlte, bekommt sie beim Fortsetzen nicht gleich wieder");
  assert.deepEqual((["nutzen", "kommunizieren", "verdienen", "unbekannt"] as const).map(zielNachEinrichtung), ["ai", "comm", "earn", "ai"]);
});

test("8.1b: Werber nur mit ausdruecklicher Zustimmung", () => {
  assert.equal(darfWerberNennen(speicher({})), false, "Standard: nicht nennen");
  assert.equal(darfWerberNennen(speicher({ [LS_WERBER_ZUSTIMMUNG]: "0" })), false);
  assert.equal(darfWerberNennen(speicher({ [LS_WERBER_ZUSTIMMUNG]: "ja" })), false);
  assert.equal(darfWerberNennen(speicher({ [LS_WERBER_ZUSTIMMUNG]: "1" })), true);
  const earn = src("../src/shell/tabs/earn.ts");
  const f = earn.slice(earn.indexOf("export async function publishReferralClaim("), earn.indexOf("\n}\n", earn.indexOf("export async function publishReferralClaim(")));
  assert.match(f, /if \(!darfWerberNennen\(localStorage\)\) return;[\s\S]*buildReferralClaim/, "Pruefung vor dem Bauen des Events");
  assert.match(html, /entscheidet bei der\s+Einrichtung selbst, ob er dich öffentlich als Werber nennt; ohne seine Zustimmung zählt er nicht\./, "die Werben-Karte sagt es auch");
});

test("8.1b: Die Seite „privat“ sagt woertlich, was der Datenschutzbericht sagt – nicht mehr", () => {
  const { belegt, offen } = datenschutzKurz();
  const aussage = (id: string) => PRIVACY_FACTS.find((f) => f.id === id)!;
  for (const id of ["dm-inhalt", "dm-absender", "ki-prompt"]) {
    if (aussage(id).status === "belegt") assert.ok(belegt.includes(aussage(id).aussage), id);
  }
  for (const a of belegt) assert.ok(PRIVACY_FACTS.some((f) => f.status === "belegt" && f.aussage === a), a);
  assert.equal(offen.includes(aussage("ip").aussage), aussage("ip").status !== "belegt", "die IP-Adresse steht als „noch nicht“, solange sie offen ist");
});

test("8.1b: Verdrahtung – neue Identitaet startet die Einrichtung, Fortsetzen beim Start, alte Karte weg", () => {
  assert.match(funktion("async function erzeugeIdentitaetMitPhrase("), /await starteEinrichtung\(id\.mnemonic!\);/);
  assert.match(app, /if \(state\.keypair && einrichtungOffen\(localStorage\)\) \{\s*void starteEinrichtung\(merkphraseNochZeigen\(localStorage\) \? geheim\.getItem\(LS_MERKPHRASE\) : null\);/);
  assert.match(funktion("function starteEinrichtung("), /sichern: \(\) => zeigeSicherungsDialog\(merkphrase\)[\s\S]*nenneWerber: \(\) => void publishReferralClaim\(\),/);
  assert.doesNotMatch(app, /function showOnboarding|3 Gratis-Antworten|Zap senden/, "die Karte ohne Funktion ist weg");
  const ui = src("../src/shell/einrichtung-ui.ts");
  assert.match(ui, /netzSel\.dispatchEvent\(new Event\("change"\)\)/, "Verbindung ueber den Handler der Settings");
  assert.match(ui, /kontakteSel\.dispatchEvent\(new Event\("change"\)\)/, "Kontakte ueber den Handler der Settings");
  assert.match(ui, /localStorage\.setItem\(LS_STANDARD_SCHIENE, s\);/);
  assert.match(ui, /localStorage\.setItem\(LS_WERBER_ZUSTIMMUNG, werber\.checked \? "1" : "0"\);\s*if \(werber\.checked\) nenneWerber\(\);/);
  assert.match(ui, /<input type="checkbox" id="ein-kontakte" \/>/, "Kontakte-Abgleich nicht vorausgewaehlt");
  assert.match(ui, /<input type="checkbox" id="ein-werber" \/>/, "Werber nicht vorausgewaehlt");
});
