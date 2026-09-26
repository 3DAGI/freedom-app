/**
 * Schritt 4.9c: frische Empfangsadressen der eingebauten Wallet. Geprueft wird,
 * dass sie Phantoms Konten 1, 2, … sind (aus den Woertern wiederherstellbar),
 * nie zweimal herausgehen, ohne Woerter nachwachsen und dass gezahlt wird nur
 * von einer Adresse, die allein reicht – nie zusammengelegt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58 } from "@scure/base";
import { deriveSolanaKey } from "@freedomstack/protocol";
import { identityFromMnemonic } from "../src/identity.js";
import { SolanaRail } from "../src/rails.js";
import {
  EingebauteSolWallet, LS_SOL_VORRAT, UEBERWEISUNG_GEBUEHR, VORRAT_GROESSE, type WalletSpeicher, waehleAbsender,
} from "../src/sol-wallet.js";

// Oeffentliche BIP-39-Testphrasen – keine Geheimnisse.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ANDERE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PK = identityFromMnemonic(PHRASE).pk;
const ZIEL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const MIETE = 890_880;

const phantom = (i: number) => base58.encode(deriveSolanaKey(mnemonicToSeedSync(PHRASE), i).publicKey);

function speicher(): WalletSpeicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return { daten, getItem: (k) => daten.get(k) ?? null, async setItem(k, v) { daten.set(k, v); }, async removeItem(k) { daten.delete(k); } };
}

test("Vorrat: Phantoms Konten 1, 2, … – jede Adresse nur einmal, Woerter nie gespeichert", async () => {
  const s = speicher();
  const w = new EingebauteSolWallet(s);
  assert.equal(await w.einrichten(PHRASE, PK), phantom(0));
  assert.equal(w.vorratFrei(), VORRAT_GROESSE);
  const a1 = await w.frischeAdresse();
  const a2 = await w.frischeAdresse();
  assert.deepEqual([a1, a2], [phantom(1), phantom(2)]);
  assert.equal(w.vorratFrei(), VORRAT_GROESSE - 2);
  assert.deepEqual(w.eigeneAdressen(), [phantom(0), phantom(1), phantom(2)]);
  // Ueberdauert einen Neustart: dieselbe Ablage, naechste Adresse
  assert.equal(await new EingebauteSolWallet(s).frischeAdresse(), phantom(3));
  assert.ok(![...s.daten.values()].join(" ").includes("abandon"));
});

test("Vorrat aufgebraucht: klare Meldung; mit denselben Woertern waechst er, mit anderen nicht", async () => {
  const s = speicher();
  const w = new EingebauteSolWallet(s);
  await w.einrichten(PHRASE, PK);
  for (let i = 0; i < VORRAT_GROESSE; i++) await w.frischeAdresse();
  await assert.rejects(() => w.frischeAdresse(), /Keine frische Adresse mehr/);
  await assert.rejects(() => w.vorratErgaenzen(ANDERE, PK), /gehören nicht zu deiner Identität/);
  assert.equal(await w.vorratErgaenzen(PHRASE, PK), VORRAT_GROESSE);
  assert.equal(await w.frischeAdresse(), phantom(VORRAT_GROESSE + 1), "weiter in Phantoms Reihenfolge");
  assert.equal(w.eigeneAdressen()[1], phantom(1), "die vergebenen bleiben");

  // Wallet von vor 4.9c: nur der Hauptschluessel – Vorrat leer, dann ergaenzt
  s.daten.delete(LS_SOL_VORRAT);
  assert.equal(w.vorratFrei(), 0);
  assert.deepEqual(w.eigeneAdressen(), [phantom(0)]);
  assert.equal(await w.vorratErgaenzen(PHRASE, PK), VORRAT_GROESSE);
  assert.equal(await w.frischeAdresse(), phantom(1));

  // Woerter einer anderen Wallet unter derselben Identitaet gibt es nicht; eine andere Hauptadresse schon
  const s2 = speicher();
  const w2 = new EingebauteSolWallet(s2);
  await w2.einrichten(PHRASE, PK);
  s2.daten.set("freedom.solWallet", "11".repeat(32));
  await assert.rejects(() => w2.vorratErgaenzen(PHRASE, PK), /andere Wallet/);
  await w2.entfernen();
  assert.equal(s2.daten.has(LS_SOL_VORRAT), false, "entfernen nimmt den Vorrat mit");
});

test("Signieren fuer eine vergebene frische Adresse, nicht fuer eine noch unvergebene", async () => {
  const w = new EingebauteSolWallet(speicher());
  await w.einrichten(PHRASE, PK);
  const frisch = await w.frischeAdresse();
  const tx = (von: string) => {
    const t = new Transaction().add(SystemProgram.transfer({ fromPubkey: new PublicKey(von), toPubkey: new PublicKey(ZIEL), lamports: 5_000 }));
    t.recentBlockhash = "11111111111111111111111111111111";
    t.feePayer = new PublicKey(von);
    return t;
  };
  const t1 = tx(frisch);
  w.signiere(t1 as never);
  assert.equal(t1.verifySignatures(), true);
  assert.throws(() => w.signiere(tx(phantom(2)) as never), /keine Signatur dieser Wallet/, "Adresse 2 ist noch nicht vergeben");
});

test("Absender: kleinste Adresse, die allein reicht und danach leer oder mietfrei ist – sonst ehrlich ablehnen", () => {
  const g = (adresse: string, lamports: number) => ({ adresse, lamports });
  const betrag = 1_000_000;
  assert.equal(waehleAbsender([g("gross", 50_000_000), g("klein", 2_000_000)], betrag), "klein");
  // Rest zwischen 0 und Mindestmiete: die Kette lehnt ab – diese Adresse nicht
  assert.equal(waehleAbsender([g("knapp", betrag + UEBERWEISUNG_GEBUEHR + 1000), g("gross", 50_000_000)], betrag), "gross");
  assert.equal(waehleAbsender([g("genau", betrag + UEBERWEISUNG_GEBUEHR)], betrag), "genau", "danach leer ist erlaubt");
  assert.equal(waehleAbsender([g("miete", betrag + UEBERWEISUNG_GEBUEHR + MIETE)], betrag), "miete");
  assert.throws(() => waehleAbsender([g("a", 800_000), g("b", 800_000)], betrag), /Keine einzelne deiner 2 Adressen.*nicht zusammen/);
  assert.throws(() => waehleAbsender([g("a", 100)], betrag), /Nicht genug SOL/);
});

test("Solana-Schiene zahlt von der gewaehlten eigenen Adresse", async () => {
  let gebaut: string | undefined;
  const rail = new SolanaRail({
    wallet: () => ({ adresse: "HAUPT", absender: async () => "FRISCH", signiereUndSende: async () => "5".repeat(88) }),
    baueUeberweisung: async (von) => { gebaut = von; return {}; },
  });
  await rail.pay({ rail: "solana", ziel: ZIEL, betrag: { einheit: "lamports", wert: 1000 }, zweck: "trinkgeld" } as never);
  assert.equal(gebaut, "FRISCH");
});

test("Verdrahtung (4.9c): Tausch schlaegt eine frische Adresse vor, Einloesen nur mit dem Schluessel der Empfangsadresse, Schiene waehlt den Absender", () => {
  const w = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  const start = w.slice(w.indexOf("async function startSwap("), w.indexOf("async function pollSwapResponse("));
  assert.match(start, /const frisch = await frischeEmpfangsadresse\(\)/);
  assert.match(start, /frisch \?\? solWallet\.pubkey \?\? ""/);
  assert.match(w, /verbunden\?\.publicKey\.toBase58\(\) === activeSwap\.solAddress \? verbunden : eingebauterHtlcSigner\(activeSwap\.solAddress\)/);
  const z = readFileSync(new URL("../src/shell/zahlschienen.ts", import.meta.url), "utf8");
  assert.match(z, /return waehleAbsender\(guthaben, lamports\);/);
  const e = readFileSync(new URL("../src/shell/eingebaute-wallet.ts", import.meta.url), "utf8");
  assert.match(e, /\$\("#solw-frisch"\)\.addEventListener\("click", \(\) => void frischKopieren\(\)\);/);
  assert.match(e, /\$\("#solw-ergaenzen"\)\.addEventListener\("click", \(\) => void ergaenzen\(\)\);/);
});
