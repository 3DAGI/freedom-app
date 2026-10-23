/**
 * Schritt A-12b2a: Kasse im Raum in der App – die eigene Adresse für die Kasse nennen. Die eingebaute Wallet
 * weist eine frische Adresse nach (nur den festen Text der Kasse), offen geht die Meldung an die Adresse des
 * Raums, privat nur in die Gruppe; die Neuschreib-Stellen der privaten Definition geben die Kasse mit.
 * A-12b2b: die Kasse anlegen – nur über eigene Devnet-Endpunkte, mit der eingebauten Wallet – und in die Definition schreiben.
 * A-12b2c: Stand von der Kette mit Abweichungen zum Raum zeigen, einzahlen – ebenso nur Devnet, nur in Kassen der App.
 * A-12b2d: ohne eingebaute Wallet die Adresse einer verbundenen – sie signiert den festen Text, die App prüft ihn vor dem Senden.
 * A-12c1: Auszahlungen vorschlagen, abstimmen, ausführen und abschließen – nur, was das Programm annimmt, Empfänger und Betrag von der Kette.
 * A-12d1: die Kasse ändern (Mitglieder, Wartezeit) – die Art bleibt; abstimmen und ausführen über Änderungen wie bei Auszahlungen.
 * A-12c2: einen neuen Vorschlag im Raum melden – nur mit seiner Nummer, im ersten Kanal, in den man schreiben darf (V6).
 * A-12c3: abstimmen und auszahlen auch mit einer verbundenen Wallet, deren Adresse die für die Kasse ist – sie signiert nur.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58 } from "@scure/base";
import {
  KASSEN_RECHT, abstimmenAnweisung, baueKasseAnlegen, baueTransaktion, deriveSolanaKey, kassenAdresse, kassenOrt, kassenTresor, pruefeKassenNachweis,
  raumAdresse, type KassenStand, type KassenVorgang, type KassenVorschlag,
} from "@freedomstack/protocol";
import { aenderungenText, kassenAktionen, kassenStandText, kassenUnterschreiber, vorschlaegeText, zeitschlossText } from "../src/kasse-anzeige.js";
import { identityFromMnemonic } from "../src/identity.js";
import { EingebauteSolWallet, type WalletSpeicher } from "../src/sol-wallet.js";
import { setLang, t } from "../src/i18n.js";

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
  assert.match(ui, /const ort = kassenOrt\(offen \? ziel\.adresse : ziel\.privat\.gruppe\);/);
  assert.match(ui, /: await frischeKassenAdresse\(ort, ich\);/);
  const wallet = lies("shell/eingebaute-wallet.ts");
  const frisch = wallet.slice(wallet.indexOf("export async function frischeKassenAdresse("), wallet.indexOf("export function eingebauterHtlcSigner("));
  assert.match(frisch, /await frischeEmpfangsadresse\(\)/, "V4: frisch aus dem Vorrat");
  assert.match(frisch, /e\.kassenNachweis\(adresse, ort, pubkey\)/);
  assert.doesNotMatch(frisch + ui, /\.adresse\(\)/, "V4: nie die Hauptadresse");
  assert.match(ui, /publish\(await signiere\(baueKassenAdresse\(\{ autor: ich, raum: ziel\.adresse, adresse, nachweis \}\)\)\)/);
  assert.match(ui, /mlsSendeEvent\(ziel\.privat\.gruppe, raumKassenAdresse\(ziel\.privat\.gruppe, adresse, nachweis\)\)/);
  assert.equal((ui.match(/publish\(/g) ?? []).length, 3,
    "an Relays gehen nur die offene Meldung, (A-12b2b) die Definition und (A-12c2) der Hinweis auf einen Vorschlag – alles im offenen Raum");
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
  assert.match(anlegen, /await kassenZahler\(rpc, e, miete \+ gebuehr \+ UEBERWEISUNG_GEBUEHR, p\.gruender\)/, "am liebsten zahlt die Adresse für die Kasse");
  assert.match(zs, /waehleAbsender\(guthaben\.filter\(\(g\) => g\.adresse === bevorzugt\), betrag\)/);
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

test("A-12b2c: der Stand nennt, was die Kette sagt – Tresor, Art, Wartezeit, Mitglieder – und jede Abweichung zum Raum", () => {
  const KASSE = phantom(20), A = phantom(21), B = phantom(22), C = phantom(23);
  const ALLE_RECHTE = KASSEN_RECHT.vorschlagen | KASSEN_RECHT.abstimmen | KASSEN_RECHT.ausfuehren;
  const stand = (s: Partial<KassenStand>): KassenStand => ({
    createKey: phantom(24), verwalter: null, schwelle: 1, zeitschlossSek: 0, transaktionsIndex: 0n, veraltetBis: 0n, mieteAn: kassenTresor(KASSE), bump: 255,
    mitglieder: [{ adresse: A, rechte: ALLE_RECHTE }, { adresse: B, rechte: KASSEN_RECHT.vorschlagen }], ...s,
  });
  const name = (pk: string) => `~${pk.slice(0, 4)}`;
  const leer = { rechtOhneMitgliedschaft: [], mitgliedschaftOhneRecht: [] };
  const gruender = kassenStandText({ kasse: KASSE, stand: stand({}), guthaben: 1_500_000_000, abweichungen: leer, name });
  assert.equal(gruender.split("\n")[0], `Tresor: ${kassenTresor(KASSE)}`);
  assert.match(gruender, /Guthaben: 1,5 SOL/);
  assert.match(gruender, /Der Gründer entscheidet allein/);
  assert.match(gruender, /Wartezeit vor dem Auszahlen: keine/);
  assert.match(gruender, /Mitglieder auf der Kette: 2/);
  assert.match(gruender, /Raum und Kette stimmen überein\.$/);

  const mehrheit = stand({ schwelle: 2, zeitschlossSek: 86_400, mitglieder: [A, B, C].map((adresse) => ({ adresse, rechte: ALLE_RECHTE })) });
  const abw = {
    rechtOhneMitgliedschaft: [{ pubkey: "aa".repeat(32), adresse: phantom(25) }, { pubkey: "bb".repeat(32) }],
    mitgliedschaftOhneRecht: [{ adresse: B, pubkey: "cc".repeat(32) }, { adresse: C }],
  };
  const text = kassenStandText({ kasse: KASSE, stand: mehrheit, guthaben: 0, abweichungen: abw, name });
  assert.match(text, /Art: Mehrheit – 2 von 3 Stimmen/);
  assert.match(text, /Wartezeit vor dem Auszahlen: 24 Stunden/);
  assert.match(text, /Abweichungen – es zählt die Kette:/);
  assert.match(text, /· ~aaaa hat das Recht „kasse“ und eine Adresse genannt, ist aber nicht in der Kasse\./);
  assert.match(text, /· ~bbbb hat das Recht „kasse“, aber keine Adresse genannt\./);
  assert.ok(text.includes(`· ~cccc ist in der Kasse (${B}), hat das Recht „kasse“ aber nicht (mehr).`));
  assert.ok(text.includes(`· ${C} ist in der Kasse, aber niemand im Raum nennt diese Adresse.`));
  assert.doesNotMatch(text, /stimmen überein/);

  assert.match(kassenStandText({ kasse: KASSE, stand: stand({ verwalter: D() }), guthaben: 0, abweichungen: leer, name }), /eine Form, die die App nicht anlegt/, "mit Verwalter: keine Art der App");
  assert.equal(zeitschlossText(3600), "1 Stunde");
  assert.equal(zeitschlossText(60), "60 Sekunden", "eine fremde Wartezeit in Sekunden");
  function D() { return phantom(26); }
});

test("A-12b2c: Verdrahtet – Stand und Einzahlen nur über eigene Devnet-Endpunkte, nur in Kassen der App, erst Rückfrage, dann Tageslimit", () => {
  const zs = lies("shell/zahlschienen.ts");
  const ein = zs.slice(zs.indexOf("export async function zahleInKasse("), zs.indexOf("/** Den Wert neu lesen"));
  assert.match(ein, /const rpc = await devnetRpc\(\);\n  if \(!rpc\) throw new Error\(t\("kasse\.nurDevnet"\)\);/);
  assert.doesNotMatch(ein, /solRpc\(/, "nie über den gemeinsamen Pool");
  assert.match(ein, /if \(!stand \|\| !kassenArt\(stand\)\) throw new Error\(t\("kasse\.nichtEinzahlen"\)\);/, "nur in Kassen ohne Verwalter");
  assert.match(ein, /if \(vorher \+ p\.lamports < MIETE_LEERES_KONTO\) throw/);
  assert.match(ein, /const tresor = kassenTresor\(p\.kasse\);/);
  assert.match(ein, /await kassenZahler\(rpc, e, p\.lamports, p\.bevorzugt\)/);
  const reihe = ["await bestaetige({ zahler, tresor })", "e.freigabe(p.lamports, tresor, bestaetigeUeberLimit)", "baueTransaktion(", "await sendeUndBestaetige(rpc, e.signiereTransaktion(tx)"].map((x) => ein.indexOf(x));
  assert.ok(reihe.every((i, n) => i > 0 && (n === 0 || i > reihe[n - 1]!)), "erst Rückfrage, dann Tageslimit, dann bauen und senden");
  assert.match(ein, /ueberweisungAnweisung\(\{ von: zahler, an: tresor, lamports: BigInt\(p\.lamports\) \}\)/);

  const ui = lies("shell/raum-kasse-ui.ts");
  const zeige = ui.slice(ui.indexOf("export async function zeigeKasse("));
  assert.match(zeige, /const rpc = await devnetRpc\(\);/);
  assert.doesNotMatch(zeige, /solRpc\(/);
  assert.match(zeige, /kassenAbweichungen\(\{ mitglieder: stand\.mitglieder, adressen, zustand \}\)/);
  assert.ok(zeige.indexOf("if (!art) {") < zeige.indexOf("await dialog("), "eine fremde Form nur zeigen, nie einzahlen");
  assert.ok(zeige.indexOf("await verlangeTresor(") < zeige.indexOf("await zahleInKasse("));
  assert.match(zeige, /bevorzugt: adressen\.get\(ich\)/);
  assert.match(zeige, /art === "gruender" \? \[t\("kasse\.ehrlichGruenderEinzahlen"\)\]/, "Gründer entscheidet: bei jeder Einzahlung gesagt");

  const raeume = lies("shell/tabs/raeume.ts");
  assert.match(raeume, /const kasseStand = !!agentOrt\(\) && !alsGeraet\(\) && !!state\.keypair && !!st\?\.space\?\.kasse;/);
  assert.match(raeume, /m\.zeigeKasse\(ort, spacesUi\.state as SpaceState \| undefined, kontaktName\)/);
  assert.match(lies("shell/index.html"), /id="space-kasse" class="menue-punkt hidden"[^>]*data-i18n="kasse\.menue"/);
});

test("A-12b2d: Verdrahtet – die eingebaute Wallet geht vor; ohne sie die verbundene, nur mit signiereNachricht, Nachweis geprüft vor dem Senden", () => {
  const ui = lies("shell/raum-kasse-ui.ts");
  const nenne = ui.slice(ui.indexOf("export async function nenneKassenAdresse("), ui.indexOf("/** Darf ich hier die Kasse anlegen?"));
  assert.ok(nenne.indexOf("tresorEingerichtet() && !tresorOffen()") < nenne.indexOf("kassenAdresseFehlt()"), "gesperrt: erst entsperren – die eingebaute ginge vor");
  assert.match(nenne, /const kannVerbunden = !!verbunden\?\.provider\?\.signiereNachricht;/);
  assert.match(nenne, /if \(!\(kannVerbunden && !tresorEingerichtet\(\)\) && !\(await verlangeTresor\(/, "ohne Tresor nur mit verbundener Wallet weiter");
  assert.match(nenne, /const ueberVerbundene = fehlt === "ohne-wallet" && kannVerbunden;/, "nur ohne eingebaute – nie bei leerem Vorrat");
  assert.ok(nenne.indexOf("await bestaetige(") < nenne.indexOf("await nachweisDerVerbundenen("), "erst die Rückfrage, dann signieren");
  const verb = ui.slice(ui.indexOf("async function nachweisDerVerbundenen("), ui.indexOf("/** Die eigene Adresse für die Kasse nennen"));
  assert.match(verb, /signiereNachricht!\(kassenNachweisNachricht\(ort, ich\)\)/, "nur der feste Text der Kasse");
  assert.match(verb, /return pruefeKassenNachweis\(ort, ich, v\.adresse, nachweis\) \? \{ adresse: v\.adresse, nachweis \} : undefined;/);
  const ws = lies("wallet-standard.ts");
  assert.match(ws, /!gleicheBytes\(r\.signedMessage, nachricht\)/, "ein Vorspann der Wallet gilt nicht");
});

test("A-12c1: Auszahlungen im Text und im Menü – Betrag, Empfänger, Stimmen von der Kette; wählbar nur, was das Programm annimmt", () => {
  const KASSE = phantom(20), A = phantom(21), B = phantom(22), C = phantom(23), EMPF = phantom(26);
  const ALLE = KASSEN_RECHT.vorschlagen | KASSEN_RECHT.abstimmen | KASSEN_RECHT.ausfuehren;
  const stand: KassenStand = {
    createKey: phantom(24), verwalter: null, schwelle: 2, zeitschlossSek: 3600, transaktionsIndex: 3n, veraltetBis: 0n, mieteAn: kassenTresor(KASSE), bump: 255,
    mitglieder: [A, B, C].map((adresse) => ({ adresse, rechte: ALLE })),
  };
  const v = (index: bigint, status: KassenVorschlag["status"], dafuer: string[] = []): KassenVorschlag =>
    ({ kasse: KASSE, index, status, seit: 1000n, dafuer, dagegen: [], abgebrochen: [] });
  const liste: KassenVorgang[] = [
    { index: 3n, vorschlag: v(3n, "aktiv", [B]), auszahlung: { empfaenger: EMPF, lamports: 500_000_000n } },
    { index: 2n, vorschlag: v(2n, "angenommen", [A, B]), auszahlung: { empfaenger: EMPF, lamports: 100_000_000n } },
    { index: 1n, vorschlag: v(1n, "ausgefuehrt"), auszahlung: null },
  ];
  const text = vorschlaegeText(stand, liste);
  assert.equal(text.split("\n")[0], "Vorschläge (von der Kette):");
  assert.ok(text.includes(`· Nr. 3: 0,5 SOL an ${EMPF} – offen, dafür 1 von 2, dagegen 0`));
  assert.match(text, /· Nr\. 2: 0,1 SOL an \S+ – angenommen, dafür 2 von 2, dagegen 0 \(auszahlbar ab .+\)/, "mit Wartezeit: ab wann");
  assert.match(text, /· Nr\. 1: keine Auszahlung, wie die App sie baut – ausgeführt; darüber stimmt die App nicht ab\./);
  assert.equal(vorschlaegeText(stand, []), "Keine offenen Vorschläge.");

  const werte = (mitglied: string | undefined, jetzt = 10_000, s = stand) => kassenAktionen(s, liste, mitglied, jetzt).map((a) => a.wert);
  assert.deepEqual(werte(A), ["einzahlen", "vorschlagen", "aendern", "dafuer:3", "dagegen:3", "ausfuehren:2", "abschliessen:1"]);
  assert.deepEqual(werte(B), ["einzahlen", "vorschlagen", "aendern", "dagegen:3", "ausfuehren:2", "abschliessen:1"], "dieselbe Stimme nicht zweimal");
  assert.deepEqual(werte(A, 4599), ["einzahlen", "vorschlagen", "aendern", "dafuer:3", "dagegen:3", "abschliessen:1"], "vor Ablauf der Wartezeit nicht auszahlen");
  assert.deepEqual(werte(undefined), ["einzahlen", "abschliessen:1"], "ohne eigene Adresse: einzahlen und abschließen");
  assert.deepEqual(werte(phantom(40)), ["einzahlen", "abschliessen:1"], "nicht in der Kasse");
  const gruender = { ...stand, schwelle: 1, mitglieder: [{ adresse: A, rechte: ALLE }, { adresse: B, rechte: KASSEN_RECHT.vorschlagen }] };
  assert.deepEqual(werte(B, 10_000, gruender), ["einzahlen", "vorschlagen", "aendern", "abschliessen:1"], "wer nur vorschlägt, stimmt nicht ab und zahlt nicht aus");
  const fertig: KassenVorgang = { index: 4n, vorschlag: v(4n, "abgelehnt"), auszahlung: { empfaenger: EMPF, lamports: 1n } };
  assert.deepEqual(kassenAktionen(stand, [fertig], undefined, 10_000).map((a) => [a.wert, a.text]), [
    ["einzahlen", "Einzahlen"], ["abschliessen:4", "Nr. 4: abschließen (Miete in den Tresor)"],
  ], "abschließen kann jeder");
});

test("A-12c1: die eingebaute Wallet unterschreibt eine Stimme als Mitglied, auch wenn eine andere eigene Adresse die Gebühr zahlt", async () => {
  const w = new EingebauteSolWallet(speicher());
  await w.einrichten(PHRASE, PK);
  const frisch = await w.frischeAdresse();
  const haupt = w.adresse()!;
  const lebensdauer = { blockhash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", letzteHoehe: 100n };
  const stimme = (mitglied: string) => baueTransaktion({
    zahler: haupt, anweisungen: [abstimmenAnweisung({ kasse: kassenAdresse(phantom(20)), index: 1n, mitglied, dafuer: true })], lebensdauer,
  });
  const sig = w.signiereTransaktion(stimme(frisch)).signatures as Record<string, Uint8Array | null>;
  assert.deepEqual(Object.keys(sig).sort(), [frisch, haupt].sort());
  assert.ok(Object.values(sig).every(Boolean), "Zahler und Mitglied haben unterschrieben");
  const fremd = w.signiereTransaktion(stimme(phantom(5))).signatures as Record<string, Uint8Array | null>;
  assert.equal(fremd[phantom(5)], null, "eine fremde Adresse unterschreibt die Wallet nicht");
});

test("A-12c1: Verdrahtet – nur Devnet, nur Kassen der App, nur Schritte nach dem Stand der Kette; erst Rückfrage, dann bauen und senden", () => {
  const zs = lies("shell/zahlschienen.ts");
  const schritt = zs.slice(zs.indexOf("export async function kassenSchritt("), zs.indexOf("/** Den Wert neu lesen"));
  assert.match(schritt, /const rpc = await devnetRpc\(\);\n  if \(!rpc\) throw new Error\(t\("kasse\.nurDevnet"\)\);/);
  assert.doesNotMatch(schritt, /solRpc\(/, "nie über den gemeinsamen Pool");
  assert.match(schritt, /if \(!stand \|\| !kassenArt\(stand\)\) throw new Error\(t\("kasse\.nichtAuszahlen"\)\);/);
  assert.match(schritt, /if \(!eigen && a\.schritt !== "abschliessen"\) throw new Error\(t\("kasse\.nurEingebaut"\)\);/, "unterschreiben nur mit eigener Adresse");
  assert.match(schritt, /& KASSEN_RECHT\.vorschlagen\)\) throw new Error\(t\("kasse\.schrittNicht"\)\);/);
  assert.match(schritt, /if \(rest !== 0 && rest < MIETE_LEERES_KONTO\) throw new Error\(t\("kasse\.zuViel"\)\);/);
  assert.match(schritt, /auszahlungKontoGroessen\(stand\.mitglieder\.length\)/, "Miete beider Konten vorher");
  assert.match(schritt, /auszahlungVorschlagenAnweisungen\(\{ \.\.\.p, mietZahler: zahler, \.\.\.a\.auszahlung \}\)/);
  assert.match(schritt, /const vg = await leseVorgang\(rpc, a\.kasse, index\);\n    auszahlung = vg\?\.auszahlung \?\? null;/, "Empfänger und Betrag von der Kette (V6)");
  assert.match(schritt, /!vorschlagsSchritte\(\{ stand, vorschlag: vg\.vorschlag, auszahlung, konfiguration, mitglied: eigen, jetztSek \}\)\.includes\(schritt\)\) throw new Error\(t\("kasse\.schrittNicht"\)\)/);
  assert.match(schritt, /\[ausfuehrenAnweisung\(\{ \.\.\.geht, mitglied: eigen!, auszahlung: auszahlung! \}\), \.\.\.abschliessen\]/, "ausführen und abschließen in einem Zug");
  assert.match(schritt, /await kassenZahler\(rpc, e!, miete, eigen\)/, "am liebsten zahlt die Adresse für die Kasse");
  const reihe = ["await bestaetige({ zahler, miete, auszahlung,", "baueTransaktion(", "e!.signiereTransaktion(tx)", "await sendeUndBestaetige(rpc, signiert,"].map((x) => schritt.indexOf(x));
  assert.ok(reihe.every((i, n) => i > 0 && (n === 0 || i > reihe[n - 1]!)), "erst Rückfrage, dann bauen und senden");

  const ui = lies("shell/raum-kasse-ui.ts");
  const zeige = ui.slice(ui.indexOf("export async function zeigeKasse("), ui.indexOf("const FRAGE:"));
  assert.match(zeige, /const vorgaenge = await leseVorschlaege\(rpc, kasse, stand\);/);
  assert.match(zeige, /kassenAktionen\(stand, vorgaenge, mitglied, Math\.floor\(Date\.now\(\) \/ 1000\)\)/);
  assert.match(zeige, /if \(aktion\.aktion !== "einzahlen"\) return await auszahlen\(kasse, String\(aktion\.aktion\), mitglied, werName, melde\);/);
  const aus = ui.slice(ui.indexOf("async function auszahlen("));
  assert.ok(aus.indexOf("await verlangeTresor(") < aus.indexOf("await kassenSchritt("), "erst der Tresor");
  assert.match(aus, /if \(!istSolAdresse\(an\) \|\| an === kassenTresor\(kasse\)\) return t\("kasse\.empfaengerFalsch"\);/);
  assert.match(aus, /empfaenger: k\.auszahlung\?\.empfaenger \?\? ""/, "die Rückfrage zeigt, was auf der Kette steht");
  assert.match(ui, /zahler === mitglied \? \[\] : \[mitglied \? t\("kasse\.zahlerVerbunden", \{ gruender: mitglied \}\) : t\("kasse\.zahlerVerbundenOhne"\)\]/);
  assert.match(aus, /\.\.\.zahlerHinweis\(k\.zahler, mitglied\),/, "zahlt eine andere Adresse, sagt die Rückfrage es");
});

test("A-12d1: Änderungen der Kasse im Text und im Menü – was sich ändert, von der Kette; für eine andere Art stimmt die App nicht", () => {
  const KASSE = phantom(20), A = phantom(21), B = phantom(22), C = phantom(23), D = phantom(25);
  const stand: KassenStand = {
    createKey: phantom(24), verwalter: null, schwelle: 2, zeitschlossSek: 0, transaktionsIndex: 4n, veraltetBis: 0n, mieteAn: kassenTresor(KASSE), bump: 255,
    mitglieder: [A, B].map((adresse) => ({ adresse, rechte: 7 })),
  };
  const v = (index: bigint, status: KassenVorschlag["status"], dafuer: string[] = []): KassenVorschlag =>
    ({ kasse: KASSE, index, status, seit: 1000n, dafuer, dagegen: [], abgebrochen: [] });
  const liste: KassenVorgang[] = [
    { index: 4n, vorschlag: v(4n, "aktiv"), auszahlung: null, konfiguration: [{ art: "mitglied-dazu", adresse: C, rechte: 7 }, { art: "zeitschloss", sek: 3600 }] },
    { index: 3n, vorschlag: v(3n, "aktiv"), auszahlung: null, konfiguration: [{ art: "schwelle", schwelle: 1 }] },
    { index: 2n, vorschlag: v(2n, "angenommen", [A, B]), auszahlung: null, konfiguration: [{ art: "mitglied-weg", adresse: B }, { art: "mitglied-dazu", adresse: D, rechte: 7 }] },
    { index: 1n, vorschlag: v(1n, "ausgefuehrt"), auszahlung: null, konfiguration: null },
  ];
  const wer = (a: string) => (a === C ? "Clara" : undefined);
  const text = vorschlaegeText(stand, liste, wer);
  assert.ok(text.includes(`· Nr. 4: Änderung – Clara (${C}) kommt dazu (alle Rechte); Wartezeit 1 Stunde – offen, dafür 0 von 2, dagegen 0`), text);
  assert.ok(text.includes("· Nr. 3: Änderung – Schwelle 1 – offen, dafür 0 von 2, dagegen 0 Danach hätte die Kasse eine andere Art – dafür stimmt die App nicht."));
  assert.ok(text.includes(`· Nr. 2: Änderung – ${B} geht; ${D} kommt dazu (alle Rechte) – angenommen, dafür 2 von 2, dagegen 0`), "ohne Namen nur die Adresse");
  assert.match(text, /· Nr\. 1: Änderung der Kasse, die die App nicht anbietet .* – ausgeführt; darüber stimmt die App nicht ab\./);
  assert.equal(aenderungenText([{ art: "mitglied-dazu", adresse: C, rechte: 1 }, { art: "mitglied-dazu", adresse: D, rechte: 3 }]),
    `${C} kommt dazu (darf nur vorschlagen); ${D} kommt dazu (Rechte 3 bei Squads)`);

  const menue = kassenAktionen(stand, liste, A, 10_000);
  assert.deepEqual(menue.map((a) => a.wert), ["einzahlen", "vorschlagen", "aendern", "dafuer:4", "dagegen:4", "dagegen:3", "ausfuehren:2", "abschliessen:1"],
    "Nr. 3 machte aus der Mehrheit eine andere Art: nur dagegen");
  assert.equal(menue.find((a) => a.wert === "ausfuehren:2")?.text, "Nr. 2: Änderung ausführen");
  assert.equal(menue.find((a) => a.wert === "aendern")?.text, "Kasse ändern (Mitglieder, Wartezeit) …");
  assert.deepEqual(kassenAktionen({ ...stand, veraltetBis: 4n }, liste, A, 10_000).map((a) => a.wert),
    ["einzahlen", "vorschlagen", "aendern", "abschliessen:4", "abschliessen:3", "abschliessen:2", "abschliessen:1"], "veraltet: nur abschließen");
  assert.deepEqual(kassenAktionen(stand, liste, undefined, 10_000).map((a) => a.wert), ["einzahlen", "abschliessen:1"], "ohne eigene Adresse nicht ändern");
});

test("A-12d1: Verdrahtet – ändern nur aus dem Stand der Kette mit erhaltener Art, Miete nach der Größe; ausführen mit Zuwachs, abschließen mit der Anweisung der Änderung", () => {
  const zs = lies("shell/zahlschienen.ts");
  const schritt = zs.slice(zs.indexOf("export async function kassenSchritt("), zs.indexOf("/** Den Wert neu lesen"));
  assert.match(schritt, /aenderungen = kassenAenderungen\(stand, a\);\n      \} catch \{\n        throw new Error\(t\("kasse\.schrittNicht"\)\);/, "aus dem frisch gelesenen Stand, die Art bleibt");
  assert.match(schritt, /groesse = konfigurationKontoGroessen\(aenderungen, stand\.mitglieder\.length\);/, "Miete beider Konten vorher");
  assert.match(schritt, /konfigurationVorschlagenAnweisungen\(\{ \.\.\.p, mietZahler: zahler, aenderungen \}\)/);
  assert.match(schritt, /if \(konfiguration && \(schritt === "dafuer" \|\| schritt === "ausfuehren"\) && !behaeltArt\(stand, konfiguration\)\) throw new Error\(t\("kasse\.schrittNicht"\)\);/,
    "für eine andere Art nicht stimmen, sie nicht ausführen");
  assert.match(schritt, /konfiguration !== undefined \? konfigurationAbschliessenAnweisung\(\{ \.\.\.geht, mieteAn: stand\.mieteAn \}\) : abschliessenAnweisung\(/,
    "eine Änderung nie mit der Anweisung der Auszahlung abschließen");
  assert.match(schritt, /const neu = kassenKontoGroesseNach\(konto\.daten\.length, kassenStandNach\(stand, konfiguration\)\.mitglieder\.length\);\n      if \(neu > konto\.daten\.length\) miete = Math\.max\(0, \(await mieteFuer\(neu\)\) - Number\(konto\.lamports\)\);/,
    "wer ausführt, zahlt den Zuwachs");
  assert.match(schritt, /\[konfigurationAusfuehrenAnweisung\(\{ \.\.\.geht, mitglied: eigen!, mietZahler: zahler \}\), \.\.\.abschliessen\]/);
  assert.match(schritt, /await bestaetige\(\{ zahler, miete, auszahlung, \.\.\.\(konfiguration \? \{ konfiguration \} : \{\}\), \.\.\.verbunden \}\)/, "die Rückfrage zeigt die Änderungen");

  const ui = lies("shell/raum-kasse-ui.ts");
  const zeige = ui.slice(ui.indexOf("export async function zeigeKasse("), ui.indexOf("const FRAGE:"));
  assert.match(zeige, /if \(aktion\.aktion === "aendern"\) return await aendern\(kasse, stand, abweichungen, mitglied, werName, melde\);/);
  const aendern = ui.slice(ui.indexOf("async function aendern("), ui.indexOf("async function auszahlen("));
  assert.match(aendern, /const dazu = abw\.rechtOhneMitgliedschaft\.flatMap\(\(x\) => \(x\.adresse \? \[x\.adresse\] : \[\]\)\);/, "dazu nur mit Recht und genannter Adresse (V3)");
  assert.match(aendern, /kassenAenderungen\(stand, wunsch\(w\)\);\n        return null;/, "geprüft, bevor der Dialog zugeht");
  assert.ok(aendern.indexOf("await verlangeTresor(") < aendern.indexOf("await kassenSchritt("), "erst der Tresor");
  assert.match(aendern, /aenderungenText\(k\.konfiguration \?\? \[\], wer\)/, "die Rückfrage zeigt, was gesendet wird");
  assert.match(aendern, /\.\.\.zahlerHinweis\(k\.zahler, mitglied\),/);
});

test("A-12c2: Verdrahtet – nach einem neuen Vorschlag ein Hinweis im Raum, nur mit der Nummer; offen an den Raum, privat nur in die Gruppe", () => {
  const ui = lies("shell/raum-kasse-ui.ts");
  const zeige = ui.slice(ui.indexOf("export async function zeigeKasse("), ui.indexOf("const FRAGE:"));
  assert.match(zeige, /const kanal = kassenHinweisKanal\(zustand, ich\);\n    const melde = kanal \? \(index: bigint\) => meldeVorschlag\(ziel, ich, kanal, index\) : undefined;/,
    "nur, wo ich schreiben darf");
  const melde = ui.slice(ui.indexOf("async function meldeVorschlag("), ui.indexOf("/** Nach einem neuen Vorschlag"));
  assert.match(melde, /const text = t\("kasse\.hinweisRaum", \{ nr: String\(index\) \}\);/, "nur die Nummer – Empfänger und Betrag nie aus dem Hinweis (V6)");
  assert.match(melde, /if \("privat" in ziel\) return !!\(await sendePrivat\(ziel\.privat\.gruppe, kanal, text\)\);/, "privat nur als inneres Event der Gruppe");
  assert.ok(melde.indexOf('"privat" in ziel') < melde.indexOf("publish("), "privat nie veröffentlicht");
  assert.match(melde, /buildChannelMessage\(\{ authorPubkey: ich, spaceId: raum\.spaceId, channelId: kanal, content: text, mentions: \[\] \}\)/, "niemand erwähnt");
  assert.equal(ui.match(/\bmelde\(/g)?.length, 1, "gemeldet wird nur in vorgeschlagen()");
  assert.match(ui, /else toast\(t\("kasse\.hinweisNicht", \{ nr: String\(index\) \}\), true\);/, "ging der Hinweis nicht hinaus, sagt die App es");

  const aendern = ui.slice(ui.indexOf("async function aendern("), ui.indexOf("async function auszahlen("));
  assert.match(aendern, /\.\.\.\(melde \? \[t\("kasse\.hinweisFolgt"\)\] : \[\]\),/, "die Rückfrage sagt es vorher");
  assert.match(aendern, /await vorgeschlagen\("kasse\.aenderungVorgeschlagen", index, melde\);/);
  const auszahlen = ui.slice(ui.indexOf("async function auszahlen("));
  assert.match(auszahlen, /\.\.\.\(schritt === "vorschlagen" && melde \? \[t\("kasse\.hinweisFolgt"\)\] : \[\]\),/);
  assert.match(auszahlen, /if \(schritt === "vorschlagen"\) await vorgeschlagen\(ERLEDIGT\.vorschlagen, index, melde\);\n  else toast\(/, "nach Stimmen, Ausführen und Abschließen kein Hinweis");
});

test("A-12c2: der Hinweis nennt nur die Nummer und den Weg zur Kasse – in beiden Sprachen", () => {
  const de = t("kasse.hinweisRaum", { nr: "7" });
  assert.match(de, /Nr\. 7/);
  assert.match(de, /Kette/, "was er tut, steht auf der Kette");
  assert.match(de, /„Kasse …“/, "derselbe Name wie im Menü");
  setLang("en");
  try {
    assert.match(t("kasse.hinweisRaum", { nr: "7" }), /no\. 7.*“Treasury …”/);
  } finally {
    setLang("de");
  }
  assert.match(t("kasse.hinweisFolgt"), /nur die Nummer/);
});

test("A-12c3: wer für die Kasse unterschreibt – die eingebaute Wallet vor der verbundenen, die verbundene nur mit genau der Adresse", () => {
  const A = phantom(0), B = phantom(1), C = phantom(2);
  const kann = (adresse: string) => ({ adresse, signiert: true });
  assert.deepEqual(kassenUnterschreiber(A, [B, A], undefined), { wer: "eingebaut", mitglied: A });
  assert.deepEqual(kassenUnterschreiber(A, [A], kann(A)), { wer: "eingebaut", mitglied: A }, "die eingebaute geht vor");
  assert.deepEqual(kassenUnterschreiber(A, [B], kann(A)), { wer: "verbunden", mitglied: A });
  assert.deepEqual(kassenUnterschreiber(A, undefined, kann(A)), { wer: "verbunden", mitglied: A }, "ohne eingebaute (oder gesperrt)");
  // Ohne Mitglied geht nur Abschließen – es zahlt, wer da ist, die eingebaute zuerst
  assert.deepEqual(kassenUnterschreiber(A, [B], kann(C)), { wer: "eingebaut" }, "eine andere Adresse unterschreibt nie für die Kasse");
  assert.deepEqual(kassenUnterschreiber(A, undefined, kann(C)), { wer: "verbunden" });
  assert.deepEqual(kassenUnterschreiber(undefined, [B], kann(C)), { wer: "eingebaut" });
  assert.deepEqual(kassenUnterschreiber(A, [], { adresse: A, signiert: false }), undefined, "eine Wallet, die nicht signieren kann, nie");
  assert.deepEqual(kassenUnterschreiber(A, [B], { adresse: A, signiert: false }), { wer: "eingebaut" });
  assert.equal(kassenUnterschreiber(A, undefined, undefined), undefined);
});

test("A-12c3: Verdrahtet – die verbundene Wallet signiert nur, gesendet wird über Devnet; sie zahlt selbst, die Rückfrage sagt es, kein Tresor nötig", () => {
  const zs = lies("shell/zahlschienen.ts");
  const schritt = zs.slice(zs.indexOf("export async function kassenSchritt("), zs.indexOf("/** Den Wert neu lesen"));
  assert.match(schritt, /const u = kassenUnterschreiber\(a\.mitglied, e\?\.adresse\(\) \? e\.eigeneAdressen\(\) : undefined, v && \{ adresse: v\.adresse, signiert: !!v\.provider\?\.signiereTransaktion \}\);\n  if \(!u\) throw new Error\(t\("kasse\.nurEingebaut"\)\);\n  const eigen = u\.mitglied;/);
  assert.match(schritt, /: waehleAbsender\(\[\{ adresse: v!\.adresse, lamports: Number\(await leseGuthaben\(rpc, v!\.adresse\)\) \}\], miete\);/, "die verbundene zahlt selbst, mit Prüfung des Guthabens");
  assert.match(schritt, /const signiert = u\.wer === "eingebaut" \? e!\.signiereTransaktion\(tx\) : await v!\.provider!\.signiereTransaktion!\(tx\);/);
  assert.doesNotMatch(schritt, /signiereUndSendeTransaktion|signiereUndSende\(/, "nie über die Wallet senden – sie schickte an ihr eigenes Netz");
  assert.match(schritt, /\.\.\.verbunden \}\)\)\) throw new Error\(t\("zahl\.abgebrochenNichtsGesendet"\)\);/, "die Rückfrage weiß, wer unterschreibt");
  assert.doesNotMatch(schritt, /solRpc\(/, "nur Devnet");

  const ui = lies("shell/raum-kasse-ui.ts");
  assert.match(ui, /const unterschreibtVerbundene = \(mitglied: string \| undefined\): boolean => !!mitglied && verbundeneSolanaWallet\(\)\?\.adresse === mitglied;/);
  const aendern = ui.slice(ui.indexOf("async function aendern("), ui.indexOf("async function auszahlen("));
  const auszahlen = ui.slice(ui.indexOf("async function auszahlen("));
  for (const [name, teil] of [["aendern", aendern], ["auszahlen", auszahlen]] as const) {
    assert.match(teil, /!unterschreibtVerbundene\(mitglied\) && !\(await verlangeTresor\(t\("kasse\.wofuer"\)\)\)/, `${name}: Tresor nur, wenn nicht die verbundene unterschreibt`);
    assert.match(teil, /\.\.\.\(k\.verbunden \? \[t\("kasse\.verbundenUnterschreibt"\)\] : \[\]\),/, `${name}: die Rückfrage sagt es`);
  }
  assert.match(t("kasse.verbundenUnterschreibt"), /Devnet/);
  assert.match(t("kasse.nurEingebaut"), /verbundenen Wallet mit genau dieser Adresse/);
});
