/**
 * Schritt C-1 (Sammlung C-1): Browser-Dialoge (`prompt()`, `confirm()`,
 * `alert()`) weichen den Dialogen aus `shell/dialog.ts` – Teil für Teil. Die
 * Liste unten hält fest, wo es sie noch gibt: Sie darf nur schrumpfen, eine
 * neue Stelle fällt hier auf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fliesstext, ganzeSats, schluesselAusEingabe } from "../src/shell-logic.js";
import { decodeNpub, encodeNpub } from "../src/identity.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
/** Code ohne Kommentare – ein Wort im Kommentar ist kein Aufruf. */
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const BROWSER_DIALOG = /\b(prompt|confirm|alert)\(/g;

function dateien(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? dateien(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);
}

/**
 * Wo es noch Browser-Dialoge gibt (Datei → Zahl): seit C-10 (ohne
 * `newCommunity()`) nur `agent.ts` – zieht nach B-9 nach (Spur B arbeitet dort).
 */
const NOCH_OFFEN: Record<string, number> = {
  "shell/tabs/agent.ts": 5,
};

test("C-1: Browser-Dialoge nur noch, wo sie noch nicht umgestellt sind – keine neuen", () => {
  const gefunden: Record<string, number> = {};
  for (const f of dateien(SRC)) {
    const n = ohneKommentare(readFileSync(f, "utf8")).match(BROWSER_DIALOG)?.length ?? 0;
    if (n) gefunden[relative(SRC, f).split("\\").join("/")] = n;
  }
  assert.deepEqual(gefunden, NOCH_OFFEN);
});

test("C-1a: ganze sats aus einem Eingabefeld – nur Ziffern, sonst 0", () => {
  assert.equal(ganzeSats("21000"), 21000);
  assert.equal(ganzeSats("  500 "), 500, "Leerraum am Rand zählt nicht");
  // Was Number() still anders läse als getippt
  for (const v of ["1e3", "0x10", "1.5", "1,5", "-5", "+5", "5 000", "Infinity", "NaN", ""]) assert.equal(ganzeSats(v), 0, v);
  assert.equal(ganzeSats("0"), 0, "null sats tauscht man nicht");
  assert.equal(ganzeSats("0007"), 7);
  assert.equal(ganzeSats("9".repeat(16)), 0, "zu lang");
  assert.equal(ganzeSats("9007199254740993".slice(0, 15)), 900719925474099);
  assert.equal(ganzeSats(undefined), 0);
  assert.equal(ganzeSats(["5"]), 0, "eine Mehrfachwahl ist kein Betrag");
  assert.equal(ganzeSats(5), 0, "nur Text aus dem Feld");
});

test("C-1a: Währung-Tab fragt nur über Dialoge – Beträge, Adresse und Rechnung geprüft im Dialog", () => {
  const w = readFileSync(join(SRC, "shell/tabs/waehrung.ts"), "utf8");
  assert.doesNotMatch(ohneKommentare(w), BROWSER_DIALOG);
  assert.match(w, /import \{ bestaetige, dialog \} from "\.\.\/dialog\.js";/);
  const hin = w.slice(w.indexOf("async function startSwap("), w.indexOf("async function pollSwapResponse("));
  // Betrag: nur ganze sats; Adresse: nur eine Solana-Adresse, Vorschlag bleibt die frische
  assert.match(hin, /pruefe: \(w\) => \(ganzeSats\(w\.betrag\) \? null : t\("waehr\.ungueltigerBetrag"\)\),/);
  assert.match(hin, /const amount = w \? ganzeSats\(w\.betrag\) : 0;\s*if \(!amount\) return;/);
  assert.match(hin, /wert: frisch \?\? solWallet\.pubkey \?\? "", pflicht: true, mono: true/);
  assert.match(hin, /pruefe: \(w\) => \(isValidSolanaAddress\(String\(w\.adresse\)\.trim\(\)\) \? null : t\("waehr\.keineSolAdresse"\)\),/);
  assert.match(hin, /const solAddr = String\(wa\?\.adresse \?\? ""\)\.trim\(\);\s*if \(!solAddr\) return;/, "abgebrochen → kein Tausch");
  // Erst die Warnungen bestätigen, dann die Adresse – wie bisher
  const [warnung, adresse, tresor] = ['titel: t("waehr.bevorTitel")', 'label: t("waehr.empfangsadresse")', "verlangeTresor("].map((x) => hin.indexOf(x));
  assert.ok(warnung > 0 && warnung < adresse && adresse < tresor, "warnen → Adresse → Tresor");

  const rueck = w.slice(w.indexOf("async function startRueckSwap("), w.indexOf("async function warteAufRueckAntwort("));
  assert.match(rueck, /return n < offer\.minSats \|\| n > offer\.maxSats \? t\("waehr\.betragBereich", \{ min: offer\.minSats, max: offer\.maxSats \}\) : null;/, "nur im Rahmen des Angebots");
  assert.match(rueck, /const sats = ws \? ganzeSats\(ws\.sats\) : 0;\s*if \(!sats\) return;/);
  assert.match(rueck, /name: "rechnung", label: t\("waehr\.rechnungFrage", \{ sats \}\), pflicht: true, mono: true/);
  assert.match(rueck, /text: \(warnung \? `\$\{warnung\}\\n\\n` : ""\) \+ t\("waehr\.sperrenFrage"/, "die Kurswarnung steht im selben Dialog");

  // Relayer und Deposit: abgelehnt heißt nichts geschieht
  assert.match(w, /if \(!\(await bestaetige\(\{ titel: t\("waehr\.relayerTitel"\), text: t\("waehr\.relayerFrage", \{ betrag: solText\(teuerster\) \}\), ok: t\("waehr\.einloesen"\) \}\)\)\) return undefined;/);
  assert.match(w, /if \(kursWarnung && !\(await bestaetige\(\{ titel: t\("waehr\.solHinterlegen"\), text: t\("waehr\.trotzdemHinterlegen", \{ warnung: kursWarnung \}\), ok: t\("waehr\.hinterlegenTrotzdem"\) \}\)\)\) return;/);
});

test("C-1b: Modelle und Kataloge – Dialoge statt prompt(), unbrauchbare Eingaben melden sich im Dialog", () => {
  const n = readFileSync(join(SRC, "shell/tabs/agent-netz.ts"), "utf8");
  assert.doesNotMatch(ohneKommentare(n), BROWSER_DIALOG);
  assert.match(n, /import \{ dialog \} from "\.\.\/dialog\.js";/);
  const an = n.slice(n.indexOf("export async function kuendigeModellAn("), n.indexOf("export async function haltevorModell("));
  // Ohne eine Zeile mit Prüfsumme geht der Dialog nicht zu – vorher kam erst danach ein Toast
  assert.match(an, /pruefe: \(w\) => \(dateiZeilen\(String\(w\.dateien\)\)\.length \? null : t\("agent\.keineZeileBrauchbar"\)\),/);
  assert.match(an, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(f\.sha256\) && f\.sizeBytes > 0/, "nur Zeilen mit Prüfsumme und Größe");
  assert.match(an, /if \(!w\) return;/);
  assert.ok(an.indexOf("await dialog(") < an.indexOf("await signiere(buildModelManifest("), "erst fragen, dann signieren");
  const vor = n.slice(n.indexOf("export async function haltevorModell("), n.indexOf("export async function haltevorModell(") + 900);
  assert.match(vor, /const id = String\(w\?\.id \?\? ""\);\s*if \(!id\.trim\(\)\) return;/, "abgebrochen → nichts gemeldet");
  const kat = n.slice(n.indexOf("export async function veroeffentlicheKatalog("));
  assert.ok(kat.indexOf("if (alsGeraet())") < kat.indexOf("await dialog("), "als Gerät gar nicht erst fragen");
  assert.match(kat, /pruefe: \(w\) => \(leseKatalogEingabe\(String\(w\.modelle\)\)\.length \? null : t\("dlg\.pflicht"\)\),/);
  assert.match(kat, /if \(!titel\.trim\(\) \|\| !eingabe\.trim\(\)\) return;/);
});

test("C-1b: Kommunikation – Name, neue Unterhaltung und Ausgeblendetes über Dialoge; veröffentlicht nur mit Häkchen", () => {
  const k = readFileSync(join(SRC, "shell/tabs/kommunikation.ts"), "utf8");
  const ohne = ohneKommentare(k);
  // Seit C-10 kein Browser-Dialog mehr – das Anlegen von Communities (prompt) fiel ganz weg
  assert.equal(ohne.match(BROWSER_DIALOG), null);
  assert.doesNotMatch(k, /function newCommunity\(/);
  assert.match(k, /import \{ dialog, hinweis \} from "\.\.\/dialog\.js";/);
  // Eigener Name: der Name als Feld, Veröffentlichen als Häkchen (vorher war „OK“ im confirm() das Veröffentlichen)
  const name = k.slice(k.indexOf("async function benenneKontakt("), k.indexOf("function dmHinweis("));
  assert.match(name, /\{ art: "mehrfach", name: "teilen", label: t\("komm\.nameSichtbar"\), optionen: \[/);
  assert.match(name, /const teilen = !!name\.trim\(\) && Array\.isArray\(w\.teilen\) && w\.teilen\.includes\("ja"\);/);
  assert.match(name, /if \(!w\) return;\s*const name/, "abgebrochen → nichts geändert");
  assert.match(name, /wert: \[c\.id\.slice\(0, 12\) \+ "…", pkShort\(c\.id\)\]\.includes\(c\.name\) \? "" : c\.name/, "nicht mit dem gekürzten Schlüssel vorbelegt");
  assert.match(k, /if \(!c \|\| c\.type !== "dm"\) return;\s*void benenneKontakt\(c\);/);
  // Ausgeblendetes nur als Text im Dialog
  assert.match(k, /if \(ev\) void hinweis\(t\("komm\.ausgeblendetTitel"\), ev\.content\);/);
  // Neue Unterhaltung: npub (auch „nostr:npub…“ aus QR-Codes) oder Hex, geprüft im Dialog, scannen auf Klick
  const dm = k.slice(k.indexOf("export async function newDm("), k.indexOf("export function oeffneCommunity("));
  assert.match(dm, /const schluessel = \(roh: unknown\): string => schluesselAusEingabe\(roh, decodeNpub\);/);
  assert.match(dm, /name: "schluessel", label: t\("komm\.kontaktSchluessel"\), pflicht: true, mono: true, scannen: true/);
  assert.match(dm, /const id = w \? schluessel\(w\.schluessel\) : "";\s*if \(!id\) return;/);
});

test("C-1c: öffentlicher Schlüssel aus einer Eingabe – npub (auch „nostr:“), Hex in jeder Schreibung, sonst leer", () => {
  const hex = "ab".repeat(32);
  const npub = encodeNpub(hex);
  assert.equal(schluesselAusEingabe(hex, decodeNpub), hex);
  assert.equal(schluesselAusEingabe(` ${hex.toUpperCase()} `, decodeNpub), hex);
  assert.equal(schluesselAusEingabe(npub, decodeNpub), hex);
  assert.equal(schluesselAusEingabe(`nostr:${npub}`, decodeNpub), hex, "so tragen QR-Codes anderer Apps den Schlüssel");
  assert.equal(schluesselAusEingabe(npub.toUpperCase(), decodeNpub), hex, "bech32 auch in Großbuchstaben");
  for (const v of ["npub1falsch", npub.slice(0, -1) + (npub.endsWith("q") ? "p" : "q"), hex.slice(1), hex + "a", "zz".repeat(32), "", "nostr:", undefined, 42, [hex]]) {
    assert.equal(schluesselAusEingabe(v, decodeNpub), "", String(v));
  }
  // Ein nsec ist kein öffentlicher Schlüssel – nie still annehmen
  assert.equal(schluesselAusEingabe("nsec1" + npub.slice(5), decodeNpub), "");
});

test("C-1c: Settings fragen nur über Dialoge – Vertraute als Häkchen, Ersatzschlüssel verdeckt, Löschen & Co. mit Gefahr", () => {
  const st = readFileSync(join(SRC, "shell/tabs/settings.ts"), "utf8");
  assert.doesNotMatch(ohneKommentare(st), BROWSER_DIALOG);
  const funktion = (name: string) => { const a = st.indexOf(name); return st.slice(a, st.indexOf("\n}\n", a)); };
  // Nachfolge: Kontakte als Häkchen, weitere Schlüssel als Text, unter drei meldet sich der Dialog – erst danach die Warnung
  const nf = funktion("export async function richteNachfolgeEin(");
  assert.match(nf, /\{ art: "mehrfach" as const, name: "kontakte", label: t\("set\.vertrauteKontakte"\)/);
  assert.match(nf, /\.filter\(\(x\) => \/\^\[0-9a-f\]\{64\}\$\/\.test\(x\) && x !== ich\)\)\];/, "nie sich selbst");
  assert.match(nf, /pruefe: \(w\) => \(vertraute\(w\)\.length >= 3 \? null : t\("set\.mindestensDrei"\)\),/);
  assert.ok(nf.indexOf("await dialog(") < nf.indexOf("nachfolgeWarnung(") && nf.indexOf("nachfolgeWarnung(") < nf.indexOf("mitRohemSchluessel("), "fragen → warnen → erst dann der Schlüssel");
  // Diebstahl vorbeugen: erst bestätigen, dann erzeugen
  const wv = funktion("async function bereiteWechselVor(");
  assert.ok(wv.indexOf("await bestaetige({ titel: t(\"set.schritt3\"), text: fliesstext(wechselWarnung())") < wv.indexOf("generateKeypair()"));
  // Widerruf: ein Dialog, Ersatzschlüssel verdeckt, Gefahr; Hex vor fromHex
  const wr = funktion("async function widerrufeSchluessel(");
  assert.match(wr, /name: "ersatz", label: t\("set\.ersatzFrage"\), pflicht: true, mono: true, verdeckt: true/);
  assert.match(wr, /name: "seit", label: t\("set\.seitWann"\), typ: "date"/);
  assert.match(wr, /ok: t\("set\.widerrufenKnopf"\),\s*gefahr: true,/);
  assert.ok(wr.indexOf("await dialog(") < wr.indexOf("fromHex(ersatzHex)"));
  // Gerät entziehen mit Gefahr; Melden nur für einen gültigen Schlüssel; Relay-Kauf erst nach Bestätigung
  assert.match(st, /await bestaetige\(\{ titel: t\("set\.entziehenTitel"\), text: t\("set\.entziehenFrage"\), ok: t\("set\.entziehenKnopf"\), gefahr: true \}\)/);
  const md = funktion("async function meldeFuerAnderen(");
  assert.match(md, /pruefe: \(w\) => \(pubkeyAus\(w\.wen\) \? null : t\("set\.keinPubkey"\)\),/);
  assert.match(md, /buildRecoveryClaim\(state\.keypair\.pk, wen, grund\.trim\(\)\)/);
  const kauf = st.slice(st.indexOf("const kaufe = async (schiene: Schiene) => {"));
  assert.ok(kauf.indexOf("await bestaetige({ titel: t(\"set.zugangTitel\")") < kauf.indexOf("await kaufeRelayZugang({"), "erst bestätigen, dann zahlen");
});

test("C-1c: Fließtext für Dialoge – feste Zeilen verbunden, Absätze, Aufzählungen und Nummern bleiben", () => {
  assert.equal(fliesstext("ab dem du den\n   Diebstahl vermutest."), "ab dem du den Diebstahl vermutest.");
  assert.equal(fliesstext("Erster Absatz.\n\nZweiter."), "Erster Absatz.\n\nZweiter.");
  assert.equal(fliesstext("So geht es:\n\n1. Suchen.\n2. Veröffentlichen — mit dem\n   Zeitpunkt.\n3. Melden."),
    "So geht es:\n\n1. Suchen.\n2. Veröffentlichen — mit dem Zeitpunkt.\n3. Melden.");
  assert.equal(fliesstext("Was das schützt:\n  · Gerät weg,\n    du kommst zurück.\n  · Zweiter Punkt."),
    "Was das schützt:\n  · Gerät weg, du kommst zurück.\n  · Zweiter Punkt.");
  assert.equal(fliesstext(""), "");
  assert.equal(fliesstext("eine Zeile"), "eine Zeile");
});

test("C-1d: Geld-Stellen fragen über Dialoge – Adresse und Betrag geprüft, erst bestätigen, dann zahlen oder anlegen", () => {
  const q = (p: string) => readFileSync(join(SRC, p), "utf8");
  // Offline zahlen: ein Dialog, Adresse auch per QR, Betrag exakt über solZuLamports (kein Gleitkomma)
  const off = q("shell/offline-zahlung.ts");
  assert.doesNotMatch(ohneKommentare(off), BROWSER_DIALOG);
  const zahlen = off.slice(off.indexOf("async function zahlen("), off.indexOf("/** Knoepfe verdrahten"));
  assert.match(zahlen, /name: "an", label: t\("waehr\.anWelcheAdresse"\), pflicht: true, mono: true, scannen: true/);
  assert.match(zahlen, /const betrag = \(roh: unknown\) => solZuLamports\(String\(roh \?\? ""\)\.trim\(\)\.replace\(",", "\."\)\);/);
  assert.match(zahlen, /pruefe: \(w\) => \(!isValidSolanaAddress\(String\(w\.an\)\.trim\(\)\) \? t\("waehr\.keineSolAdresse"\) : betrag\(w\.betrag\) \? null : t\("waehr\.ungueltigerBetrag"\)\),/);
  assert.ok(zahlen.indexOf("await dialog(") < zahlen.indexOf("await zahleSolOffline(an, lamports)"), "erst fragen, dann signieren");
  assert.doesNotMatch(zahlen, /\* 1e9/, "kein Gleitkomma beim Betrag");
  assert.match(off, /await legeNonceKontoAn\(\(k\) => bestaetige\(\{/);
  assert.match(off, /ok: t\("waehr\.kontoSchliessen"\), gefahr: true \}\)\)\) return t\("waehr\.nichtsGeaendert"\);/);
  // Trinkgeld: öffentliche Adresse nur nach Warnung, eingegebene nur geprüft
  const zap = q("chat-zap.ts");
  assert.doesNotMatch(ohneKommentare(zap), BROWSER_DIALOG);
  assert.match(zap, /pruefe: \(w\) => \(isValidSolanaAddress\(String\(w\.adresse\)\.trim\(\)\) \? null : t\("waehr\.keineSolAdresse"\)\),/);
  assert.ok(zap.indexOf("t(\"zahl.oeffentlicheAdresseFrage\"") < zap.indexOf("zweck: \"trinkgeld\""));
  // Zahlkanal: bestätigt vor dem Merken und Einzahlen
  const kanal = q("shell/zahlkanal-ui.ts");
  assert.doesNotMatch(ohneKommentare(kanal), BROWSER_DIALOG);
  assert.ok(kanal.indexOf("await bestaetige({ titel: t(\"waehr.kanalTitel\")") < kanal.indexOf("await kanalBuch.merke(plan.eintrag);"));
  // Eingebaute Wallet entfernen: Gefahr
  const ew = q("shell/eingebaute-wallet.ts");
  assert.doesNotMatch(ohneKommentare(ew), BROWSER_DIALOG);
  assert.match(ew, /await bestaetige\(\{ titel: t\("waehr\.eingebaut"\), text: t\("waehr\.entfernenFrage"\), ok: t\("waehr\.entfernenKnopf"\), gefahr: true \}\)/);
});

test("C-1e: der Rest – Abzeichen, Nachfolge, Bunker, Urteil, Notfall, Schlüssel zeigen über Dialoge", () => {
  const q = (p: string) => readFileSync(join(SRC, p), "utf8");
  for (const p of ["shell/tabs/profil.ts", "shell/nachfolge-ui.ts", "shell/bunker.ts", "shell/pruefauftraege-ui.ts", "shell/notfall.ts", "shell/app.ts"]) {
    assert.doesNotMatch(ohneKommentare(q(p)), BROWSER_DIALOG, p);
  }
  // Abzeichen: wirklich ein Dialog (Name, Empfänger, Zweck), Empfänger als npub oder Hex, mindestens einer
  const ab = q("shell/tabs/profil.ts");
  assert.match(ab, /schluesselAusEingabe\(x, decodeNpub\)/);
  assert.match(ab, /pruefe: \(w\) => \(empfaengerAus\(w\)\.length \? null : t\("profil\.keinPubkey"\)\),/);
  assert.match(ab, /description: String\(w\.wofuer \?\? ""\),/);
  // Nachfolge: Meldung mit Pflicht-Begründung; Anteil übergeben mit Gefahr
  const nf = q("shell/nachfolge-ui.ts");
  assert.match(nf, /name: "grund", label: t\("ein\.meldungWarum", \{ wer: pkShort\(besitzer\) \}\), pflicht: true/);
  assert.match(nf, /ok: t\("ein\.uebergeben"\), gefahr: true \}\)\)\) return;/);
  assert.ok(nf.indexOf("t(\"ein.uebergebenFrage\"") < nf.indexOf("await baueAnteilUebergabe("), "erst bestätigen, dann übergeben");
  // Bunker: bestätigt, bevor die Identität wechselt
  const bu = q("shell/bunker.ts");
  assert.ok(bu.indexOf("t(\"ein.bunkerWechsel\")") < bu.indexOf("await meldeMitBunkerAn("));
  assert.ok(bu.indexOf("t(\"ein.bunkerAbmelden\")") < bu.indexOf("await meldeBunkerAb("));
  // Urteil: abgebrochen geht nichts hinaus, die Begründung darf leer sein
  const ur = q("shell/pruefauftraege-ui.ts");
  assert.match(ur, /if \(!w\) return;\s*const notiz = String\(w\.notiz \?\? ""\);/);
  assert.ok(ur.indexOf("await dialog(") < ur.indexOf("buildPrivateUrteil({"));
  // Notfall: der Hinweis vor dem weiteren Start; Schlüssel ohne Zwischenablage nur zum Ansehen
  assert.match(q("shell/notfall.ts"), /await hinweis\(t\("ein\.notfallTitel"\), t\("ein\.nichtAllesGeloescht", \{ offen: offen\.join\(", "\) \}\)\);\s*return;/);
  assert.match(q("shell/app.ts"), /\{ art: "nurlesen", name: "pk", label: t\("ein\.pubkey"\), wert: state\.keypair\.pk \}/);
});
