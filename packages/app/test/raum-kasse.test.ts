/**
 * Schritt A-12b2a: Kasse im Raum in der App – die eigene Adresse für die Kasse nennen. Die eingebaute Wallet
 * weist eine frische Adresse nach (nur den festen Text der Kasse), offen geht die Meldung an die Adresse des
 * Raums, privat nur in die Gruppe; die Neuschreib-Stellen der privaten Definition geben die Kasse mit.
 * A-12b2b: die Kasse anlegen – nur über eigene Devnet-Endpunkte, mit der eingebauten Wallet – und in die Definition schreiben.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58 } from "@scure/base";
import { baueKasseAnlegen, deriveSolanaKey, kassenOrt, pruefeKassenNachweis, raumAdresse } from "@freedomstack/protocol";
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
  assert.equal((ui.match(/publish\(/g) ?? []).length, 2, "an Relays gehen nur die offene Meldung und (A-12b2b) die Definition des offenen Raums");
  const schreibe = ui.slice(ui.indexOf("async function schreibeKasse("));
  assert.ok(schreibe.indexOf('if ("privat" in ziel) return setzePrivateKasse(') < schreibe.indexOf("publish("), "privat nie an Relays");

  const raeume = lies("shell/tabs/raeume.ts");
  assert.match(raeume, /const kasse = !!agentOrt\(\) && !alsGeraet\(\) && !!state\.keypair && !!st && darf\(state\.keypair\.pk, RAUM_KASSEN_RECHT, st\);/);
  assert.match(raeume, /document\.getElementById\("space-kasse-adresse"\)\?\.classList\.toggle\("hidden", !kasse\);/);
  assert.match(raeume, /void import\("\.\.\/raum-kasse-ui\.js"\)\.then\(async \(m\) => \{ if \(\(await m\.nenneKassenAdresse\(ort, /);
  assert.match(lies("shell/index.html"), /id="space-kasse-adresse" class="menue-punkt hidden"[^>]*data-i18n="kasse\.adresseMenue"/);
});

test("A-12b2a: wer die private Definition neu schreibt, gibt die Kasse mit – Raumstand, Kanäle, Agentenketten", () => {
  const mls = lies("shell/raum-mls.ts");
  assert.match(mls, /raumDefinition\(raum\.gruppe, \{ kasse: raum\.zustand\.space\?\.kasse, \.\.\.r \}\)/);
  assert.equal((mls.match(/definitionMitKetten\(raum, \{/g) ?? []).length, 4, "Raumstand, Kanal anlegen, Kanal ändern, Kasse – alle über die Stelle mit der Kasse");
  const setze = mls.slice(mls.indexOf("export function setzePrivateKetten("), mls.indexOf("/** Den Raumstand"));
  assert.match(setze, /raumDefinition\(raum\.gruppe, \{ name: sp\.name, beschreibung: sp\.description, kanaele: sp\.channels, kasse: sp\.kasse \}\)/);
  assert.equal((mls.match(/raumDefinition\(/g) ?? []).length, 3, "Anlegen (ohne Kasse), definitionMitKetten, setzePrivateKetten – keine weitere Stelle");
});

test("A-12b2b: die eingebaute Wallet unterschreibt das Anlegen als Ersteller – auch mit der Adresse für die Kasse; danach fehlt keine Unterschrift", async () => {
  const w = new EingebauteSolWallet(speicher());
  await w.einrichten(PHRASE, PK);
  const frisch = await w.frischeAdresse();
  const lebensdauer = { blockhash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", letzteHoehe: 100n };
  const p = { schatzamt: phantom(9), art: "gruender" as const, gruender: frisch, weitere: [phantom(7)], zeitschlossSek: 0, lebensdauer };
  const signiert = w.signiereTransaktion(baueKasseAnlegen({ ...p, ersteller: frisch }).tx);
  const sig = signiert.signatures as Record<string, Uint8Array | null>;
  assert.equal(Object.keys(sig).length, 2, "Ersteller und Create-Key");
  assert.ok(Object.values(sig).every(Boolean), "beide haben unterschrieben");
  assert.ok(sig[frisch]);
  assert.throws(() => w.signiereTransaktion(baueKasseAnlegen({ ...p, ersteller: phantom(5) }).tx), /verlangt keine Signatur/, "eine noch nicht vergebene Adresse unterschreibt nicht");
});

test("A-12b2b: Verdrahtet – anlegen nur über eigene Devnet-Endpunkte, erst Kosten bestätigen, dann senden; danach in die Definition, bis es gelingt", () => {
  const zs = lies("shell/zahlschienen.ts");
  const anlegen = zs.slice(zs.indexOf("export async function legeKasseAn("), zs.indexOf("/** Den Wert neu lesen"));
  assert.match(anlegen, /const rpc = await devnetRpc\(\);\n  if \(!rpc\) throw new Error\(t\("kasse\.nurDevnet"\)\);/);
  assert.doesNotMatch(anlegen, /solRpc\(/, "nie über den gemeinsamen Pool – er wiche auf Mainnet aus");
  assert.match(anlegen, /if \(!eigene\.includes\(p\.gruender\)\) throw/);
  assert.ok(anlegen.indexOf("await bestaetige(") < anlegen.indexOf("baueKasseAnlegen("), "erst die Kosten, dann die Transaktion");
  assert.match(anlegen, /await sendeUndBestaetige\(rpc, e\.signiereTransaktion\(tx\), lebensdauer\.letzteHoehe\);/);
  assert.match(anlegen, /waehleAbsender\(guthaben\.filter\(\(g\) => g\.adresse === p\.gruender\), betrag\)/, "am liebsten zahlt die Adresse für die Kasse");
  const st = lies("shell/state.ts");
  const devnet = st.slice(st.indexOf("export async function devnetRpc("), st.indexOf("/** Beste erreichbare RPC-URL"));
  assert.match(devnet, /await endpunkteImNetz\(eigene, GENESIS_DEVNET\)/);
  assert.match(devnet, /new RpcPool\(\[\], \{ userEndpoints: devnet \}\)/);
  assert.doesNotMatch(devnet, /DEFAULT_MAINNET_RPCS|ensureRpcPool/);

  const ui = lies("shell/raum-kasse-ui.ts");
  assert.match(ui, /if \(!ich \|\| !zustand\?\.space \|\| zustand\.space\.kasse \|\| alsGeraet\(\)\) return false;\n  return "privat" in ziel \? ziel\.privat\.admins\.includes\(ich\) : zustand\.ownerPubkey === ich;/);
  assert.ok(ui.indexOf("const gruender = adressen.get(ich);") < ui.indexOf("await import(\"./zahlschienen.js\")"), "erst die eigene Adresse, dann anlegen");
  assert.match(ui, /const andere = mitKassenRecht\(zustand\)\.filter\(\(pk\) => pk !== ich\);/);
  assert.match(ui, /while \(!\(await schreibeKasse\(ziel, ich, kasse\)\)\)/);
  assert.match(ui, /buildEvent\(ich, KIND_SPACE, mitKassenTag\(alt\.tags, kasse\), "", zeit\)/);
  assert.match(ui, /Math\.max\(Math\.floor\(Date\.now\(\) \/ 1000\), alt\.zeit \+ 1\)/);
  assert.match(ui, /setzePrivateKasse\(ziel\.privat, kasse\)/);
  const mls = lies("shell/raum-mls.ts");
  assert.match(mls, /definitionMitKetten\(raum, \{ name: sp\.name, beschreibung: sp\.description, kanaele: sp\.channels, kasse \}\)/);

  const raeume = lies("shell/tabs/raeume.ts");
  assert.match(raeume, /getElementById\("space-kasse-anlegen"\)\?\.classList\.toggle\("hidden", !verwalten \|\| alsGeraet\(\) \|\| !agentOrt\(\) \|\| !st\?\.space \|\| !!st\.space\.kasse\);/);
  assert.match(raeume, /m\.legeKasseImRaumAn\(ort, /);
  assert.match(lies("shell/index.html"), /id="space-kasse-anlegen" class="menue-punkt hidden"[^>]*data-i18n="kasse\.anlegenMenue"/);
});
