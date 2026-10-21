/**
 * Schritt A-12b2a: Kasse im Raum in der App – die eigene Adresse für die Kasse nennen. Die eingebaute Wallet
 * weist eine frische Adresse nach (nur den festen Text der Kasse), offen geht die Meldung an die Adresse des
 * Raums, privat nur in die Gruppe; die Neuschreib-Stellen der privaten Definition geben die Kasse mit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58 } from "@scure/base";
import { deriveSolanaKey, kassenOrt, pruefeKassenNachweis, raumAdresse } from "@freedomstack/protocol";
import { identityFromMnemonic } from "../src/identity.js";
import { EingebauteSolWallet, type WalletSpeicher } from "../src/sol-wallet.js";
import { setLang } from "../src/i18n.js";

// Meldungen hier auf Deutsch prüfen
setLang("de");

// Öffentliche BIP-39-Testphrase – kein Geheimnis.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PK = identityFromMnemonic(PHRASE).pk;
const phantom = (i: number) => base58.encode(deriveSolanaKey(mnemonicToSeedSync(PHRASE), i).publicKey);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function speicher(): WalletSpeicher & { gesperrt: boolean } {
  const daten = new Map<string, string>();
  return {
    gesperrt: false,
    getItem(k) { return this.gesperrt ? null : daten.get(k) ?? null; },
    async setItem(k, v) { daten.set(k, v); },
    async removeItem(k) { daten.delete(k); },
  };
}

test("A-12b2a: die eingebaute Wallet weist eine frische Adresse für die Kasse nach – nur eigene, nur für diesen Ort und Schlüssel", async () => {
  const s = speicher();
  const w = new EingebauteSolWallet(s);
  const haupt = await w.einrichten(PHRASE, PK);
  const frisch = await w.frischeAdresse();
  assert.equal(frisch, phantom(1));
  const ort = kassenOrt(raumAdresse(PK, "werkstatt-ab12cd"));
  const nachweis = w.kassenNachweis(frisch, ort, PK);
  assert.equal(pruefeKassenNachweis(ort, PK, frisch, nachweis), true);
  assert.equal(pruefeKassenNachweis(ort, "ab".repeat(32), frisch, nachweis), false, "nur für diesen Schlüssel");
  assert.equal(pruefeKassenNachweis(kassenOrt("9e41c07b5a2d38f6e1b0c4d7a8f25e93"), PK, frisch, nachweis), false, "nur für diesen Ort");
  assert.equal(pruefeKassenNachweis(ort, PK, haupt, nachweis), false, "die Signatur gehört zur frischen Adresse");

  assert.throws(() => w.kassenNachweis("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb", ort, PK), /gehört nicht zur eingebauten Wallet/);
  assert.throws(() => w.kassenNachweis(phantom(2), ort, PK), /gehört nicht zur eingebauten Wallet/, "nur vergebene frische Adressen");
  assert.throws(() => w.kassenNachweis(frisch, ort, "kein-schluessel"), /Schlüssel ungültig/, "nur der feste Text mit einem Nostr-Schlüssel");
  s.gesperrt = true;
  assert.throws(() => w.kassenNachweis(frisch, ort, PK), /gehört nicht zur eingebauten Wallet/, "gesperrter Tresor: kein Schlüssel");
});

test("A-12b2a: Verdrahtet – Menü nur mit „kasse“ und als Person, erst fragen, dann frische Adresse; offen an die Raum-Adresse, privat nur in die Gruppe", () => {
  const ui = lies("shell/raum-kasse-ui.ts");
  assert.match(ui, /!alsGeraet\(\) && can\(ich, RAUM_KASSEN_RECHT, zustand\)/);
  assert.ok(ui.indexOf("await bestaetige(") < ui.indexOf("await frischeKassenAdresse("), "erst die Rückfrage, dann die Adresse");
  assert.match(ui, /frischeKassenAdresse\(kassenOrt\(offen \? ziel\.adresse : ziel\.privat\.gruppe\), ich\)/);
  const wallet = lies("shell/eingebaute-wallet.ts");
  const frisch = wallet.slice(wallet.indexOf("export async function frischeKassenAdresse("), wallet.indexOf("export function eingebauterHtlcSigner("));
  assert.match(frisch, /await frischeEmpfangsadresse\(\)/, "V4: frisch aus dem Vorrat");
  assert.match(frisch, /e\.kassenNachweis\(adresse, ort, pubkey\)/);
  assert.doesNotMatch(frisch + ui, /\.adresse\(\)/, "V4: nie die Hauptadresse");
  assert.match(ui, /publish\(await signiere\(baueKassenAdresse\(\{ autor: ich, raum: ziel\.adresse, adresse, nachweis \}\)\)\)/);
  assert.match(ui, /mlsSendeEvent\(ziel\.privat\.gruppe, raumKassenAdresse\(ziel\.privat\.gruppe, adresse, nachweis\)\)/);
  assert.equal((ui.match(/publish\(/g) ?? []).length, 1, "nur die offene Meldung geht an Relays");

  const raeume = lies("shell/tabs/raeume.ts");
  assert.match(raeume, /const kasse = !!agentOrt\(\) && !alsGeraet\(\) && !!state\.keypair && !!st && darf\(state\.keypair\.pk, RAUM_KASSEN_RECHT, st\);/);
  assert.match(raeume, /document\.getElementById\("space-kasse-adresse"\)\?\.classList\.toggle\("hidden", !kasse\);/);
  assert.match(raeume, /void import\("\.\.\/raum-kasse-ui\.js"\)\.then\(async \(m\) => \{ if \(\(await m\.nenneKassenAdresse\(ort, /);
  assert.match(lies("shell/index.html"), /id="space-kasse-adresse" class="menue-punkt hidden"[^>]*data-i18n="kasse\.adresseMenue"/);
});

test("A-12b2a: wer die private Definition neu schreibt, gibt die Kasse mit – Raumstand, Kanäle, Agentenketten", () => {
  const mls = lies("shell/raum-mls.ts");
  assert.match(mls, /raumDefinition\(raum\.gruppe, \{ kasse: raum\.zustand\.space\?\.kasse, \.\.\.r \}\)/);
  assert.equal((mls.match(/definitionMitKetten\(raum, \{/g) ?? []).length, 3, "Raumstand, Kanal anlegen, Kanal ändern – alle über die Stelle mit der Kasse");
  const setze = mls.slice(mls.indexOf("export function setzePrivateKetten("), mls.indexOf("/** Den Raumstand"));
  assert.match(setze, /raumDefinition\(raum\.gruppe, \{ name: sp\.name, beschreibung: sp\.description, kanaele: sp\.channels, kasse: sp\.kasse \}\)/);
  assert.equal((mls.match(/raumDefinition\(/g) ?? []).length, 3, "Anlegen (ohne Kasse), definitionMitKetten, setzePrivateKetten – keine weitere Stelle");
});
