/**
 * Tests fuer Identitaet und Sicherung.
 *
 * Der wahrscheinlichste Totalverlust in diesem System ist nicht ein Angriff,
 * sondern geloeschte Browserdaten. Diese Tests pruefen deshalb vor allem, dass
 * eine Identitaet wiederherstellbar ist — und zwar auch mit fremden Clients.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  createIdentity, identityFromMnemonic, identityFromHex, importIdentity,
  encodeNsec, decodeNsec, encodeNpub, decodeNpub,
  buildBackupFile, parseBackupFile,
  verifyMnemonicChallenge, pickChallengePositions,
  NOSTR_DERIVATION_PATH,
  backupStatus,
} from "../src/identity.js";

// ------------------------------------------------------------- Erzeugen

test("Neue Identitaet hat alles, was zur Wiederherstellung noetig ist", () => {
  const id = createIdentity();
  assert.equal(id.sk.length, 32);
  assert.match(id.pk, /^[0-9a-f]{64}$/);
  assert.match(id.nsec, /^nsec1/);
  assert.match(id.npub, /^npub1/);
  assert.equal(id.mnemonic!.split(" ").length, 12);
});

test("Pubkey passt zum Secret", () => {
  const id = createIdentity();
  assert.equal(bytesToHex(schnorr.getPublicKey(id.sk)), id.pk);
});

test("Zwei Identitaeten sind verschieden", () => {
  assert.notEqual(createIdentity().pk, createIdentity().pk);
});

test("Dieselbe Merkphrase ergibt IMMER dieselbe Identitaet", () => {
  // Das ist die eigentliche Zusage an den Nutzer: Zettel eintippen, alles zurueck.
  const id = createIdentity();
  const wieder = identityFromMnemonic(id.mnemonic!);
  assert.equal(wieder.pk, id.pk);
  assert.equal(wieder.nsec, id.nsec);
});

test("Merkphrase folgt NIP-06 — andere Clients koennen sie lesen", () => {
  // Offizieller NIP-06-Testvektor. Ohne ihn waere "interoperabel" nur behauptet.
  const id = identityFromMnemonic(
    "leader monkey parrot ring guide accident before fence cannon height naive bean",
  );
  assert.equal(
    id.pk,
    "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917",
  );
  assert.equal(NOSTR_DERIVATION_PATH, "m/44'/1237'/0'/0/0");
});

test("24-Wort-Phrasen werden ebenso unterstuetzt", () => {
  // Kein zweiter Vektor aus dem Gedaechtnis: Ein falsch notierter Sollwert in
  // einem Test ist schlimmer als kein Test, weil er Sicherheit vortaeuscht.
  // Der offizielle Vektor oben belegt die Ableitung; hier geht es nur darum,
  // dass die laengere Form nicht durchfaellt.
  const lang =
    "what bleak badge arrange retreat wolf trade produce cricket blur garlic " +
    "valid proud rude strong choose busy staff weather area salt hollow arm fade";
  const id = identityFromMnemonic(lang);
  assert.match(id.pk, /^[0-9a-f]{64}$/);
  assert.equal(identityFromMnemonic(lang).pk, id.pk, "reproduzierbar");
  assert.equal(lang.split(" ").length, 24);
});

test("Passphrase aendert die Identitaet", () => {
  const phrase = createIdentity().mnemonic!;
  assert.notEqual(identityFromMnemonic(phrase).pk, identityFromMnemonic(phrase, "extra").pk);
});

test("Kaputte Merkphrase wird erkannt, nicht still akzeptiert", () => {
  // BIP-39 hat eine Pruefsumme — ein Tippfehler faellt auf, statt zu einer
  // fremden, leeren Identitaet zu fuehren.
  assert.throws(() => identityFromMnemonic("abandon ".repeat(11) + "abandon"), /ungültig/);
  assert.throws(() => identityFromMnemonic("kein gueltiges wort hier drin"), /ungültig/);
});

test("Gross- und Kleinschreibung und Mehrfach-Leerzeichen stoeren nicht", () => {
  const id = createIdentity();
  const unsauber = "  " + id.mnemonic!.toUpperCase().replace(/ /g, "   ") + "  ";
  assert.equal(identityFromMnemonic(unsauber).pk, id.pk);
});

// ------------------------------------------------------------- NIP-19

test("nsec und npub sind roundtrip-fest", () => {
  const id = createIdentity();
  assert.deepEqual(decodeNsec(id.nsec), id.sk);
  assert.equal(decodeNpub(id.npub), id.pk);
  assert.equal(encodeNsec(id.sk), id.nsec);
  assert.equal(encodeNpub(id.pk), id.npub);
});

test("nsec und npub werden nicht verwechselt", () => {
  const id = createIdentity();
  assert.throws(() => decodeNsec(id.npub), /Erwartet wurde ein nsec/);
  assert.throws(() => decodeNpub(id.nsec), /Erwartet wurde ein npub/);
});

test("Verstuemmeltes bech32 wird abgelehnt", () => {
  const id = createIdentity();
  const kaputt = id.nsec.slice(0, -1) + (id.nsec.endsWith("q") ? "p" : "q");
  assert.throws(() => decodeNsec(kaputt));
});

// ------------------------------------------------------------- Import

test("Import versteht alle drei Formate", () => {
  const id = createIdentity();
  assert.equal(importIdentity(id.mnemonic!).pk, id.pk);
  assert.equal(importIdentity(id.nsec).pk, id.pk);
  assert.equal(importIdentity(bytesToHex(id.sk)).pk, id.pk);
});

test("Import erklaert, was mit einem npub nicht geht", () => {
  // Der haeufigste Bedienfehler: der Nutzer kopiert den oeffentlichen Teil.
  const id = createIdentity();
  assert.throws(() => importIdentity(id.npub), /nicht signieren/);
});

test("Import nennt bei Unfug die akzeptierten Formate", () => {
  assert.throws(() => importIdentity("hallo"), /Merkphrase, nsec1/);
  assert.throws(() => importIdentity(""), /Nichts eingegeben/);
});

test("Alte Hex-Schluessel funktionieren weiter", () => {
  // Bestandsnutzer duerfen durch die Umstellung nichts verlieren.
  const hex = "11".repeat(32);
  const id = identityFromHex(hex);
  assert.equal(bytesToHex(id.sk), hex);
  assert.match(id.nsec, /^nsec1/);
  assert.equal(id.mnemonic, undefined, "ohne Phrase, ehrlich");
});

// ------------------------------------------------------- Bestaetigung

test("Bestaetigung prueft echte Woerter, nicht ein Haekchen", () => {
  const id = createIdentity();
  const w = id.mnemonic!.split(" ");
  const ok = verifyMnemonicChallenge(id.mnemonic!, [0, 5, 11], [w[0], w[5], w[11]]);
  assert.equal(ok.ok, true);

  const falsch = verifyMnemonicChallenge(id.mnemonic!, [0, 5, 11], [w[0], "banane", w[11]]);
  assert.equal(falsch.ok, false);
  assert.deepEqual(falsch.wrong, [5], "der Nutzer erfaehrt, WELCHES Wort falsch war");
});

test("Bestaetigung ist tolerant bei Schreibweise und Leerzeichen", () => {
  const id = createIdentity();
  const w = id.mnemonic!.split(" ");
  assert.equal(verifyMnemonicChallenge(id.mnemonic!, [1], ["  " + w[1].toUpperCase() + " "]).ok, true);
});

test("Abgefragte Positionen sind verteilt und ohne Wiederholung", () => {
  for (let i = 0; i < 30; i++) {
    const pos = pickChallengePositions(12, 3);
    assert.equal(pos.length, 3);
    assert.equal(new Set(pos).size, 3, "kein Wort doppelt abfragen");
    assert.ok(pos.every((p) => p >= 0 && p < 12));
  }
});

// ------------------------------------------------------------- Datei

test("Sicherungsdatei traegt die Warnung IM Dokument", () => {
  // Wer die Datei in einem Jahr wiederfindet, hat den Dialog laengst vergessen.
  const json = buildBackupFile(createIdentity());
  const f = JSON.parse(json);
  assert.match(f.warning, /ist du/);
  assert.match(f.warning, /Cloud/);
  assert.equal(f.format, "freedomstack-identity");
});

test("Sicherungsdatei stellt die Identitaet wieder her", () => {
  const id = createIdentity();
  assert.equal(parseBackupFile(buildBackupFile(id)).pk, id.pk);
});

test("Sicherungsdatei funktioniert auch ohne Merkphrase", () => {
  const id = identityFromHex("22".repeat(32));
  const wieder = parseBackupFile(buildBackupFile(id));
  assert.equal(wieder.pk, id.pk);
});

test("Fremde Dateien werden abgelehnt", () => {
  assert.throws(() => parseBackupFile('{"format":"etwas-anderes"}'), /keine FreedomStack/);
  assert.throws(() => parseBackupFile('{"format":"freedomstack-identity"}'), /weder Merkphrase noch nsec/);
});

// ------------------------------------------------------------- Sicherungsstand mit Tresor (1.2)

function mitSpeicher(werte: Record<string, string>, f: () => void): void {
  const m = new Map(Object.entries(werte));
  const vorher = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  try { f(); } finally { (globalThis as { localStorage?: unknown }).localStorage = vorher; }
}

test("backupStatus: Schluessel im Tresor zaehlt als vorhanden – die Warnung bleibt", () => {
  mitSpeicher({}, () => assert.equal(backupStatus().hasKey, false));
  mitSpeicher({ "freedom.nsec": "ab".repeat(32) }, () => assert.equal(backupStatus().hasKey, true));
  mitSpeicher({ "freedom.vault": "1", "freedom.backup.mnemonic": "1" }, () => {
    const st = backupStatus();
    assert.equal(st.hasKey, true, "Schluessel liegt im Tresor, nicht in localStorage");
    assert.match(st.warning ?? "", /nicht bestätigt/, "ohne bestaetigte Merkphrase wird weiter gewarnt");
  });
  mitSpeicher({ "freedom.vault": "0" }, () => assert.equal(backupStatus().hasKey, false));
});
