/**
 * Schritt 4.2a: eingebaute SOL-Wallet – Ableitung aus den 12 Woertern,
 * Signieren, Tageslimit und der Freigabe-Haken der Solana-Schiene.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { zahle } from "@freedomstack/protocol";
import { identityFromMnemonic } from "../src/identity.js";
import { SolanaRail } from "../src/rails.js";
import {
  EingebauteSolWallet, LS_SOL_AUSGABEN, LS_SOL_LIMIT, LS_SOL_WALLET, type Nachfrage, STANDARD_LIMIT, type WalletSpeicher,
  solSchluesselAusPhrase,
} from "../src/sol-wallet.js";

// Oeffentliche BIP-39-Testphrasen – keine Geheimnisse.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ANDERE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
/** Die Adresse, die Phantom fuer PHRASE zeigt (m/44'/501'/0'/0'). */
const PHANTOM = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";
const ZIEL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const T0 = 1_790_000_000;

function speicher(): WalletSpeicher & { daten: Map<string, string>; gesperrt: boolean } {
  const daten = new Map<string, string>();
  return {
    daten,
    gesperrt: false,
    getItem(k) { return this.gesperrt ? null : daten.get(k) ?? null; },
    async setItem(k, v) { if (this.gesperrt) throw new Error("Tresor gesperrt"); daten.set(k, v); },
    async removeItem(k) { daten.delete(k); },
  };
}

async function wallet(uhr = { t: T0 }) {
  const s = speicher();
  const w = new EingebauteSolWallet(s, () => uhr.t);
  await w.einrichten(PHRASE, identityFromMnemonic(PHRASE).pk);
  return { s, w, uhr };
}

function ueberweisung(von: string): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: new PublicKey(von), toPubkey: new PublicKey(ZIEL), lamports: 5_000 }));
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.feePayer = new PublicKey(von);
  return tx;
}

test("Einrichten: Phantom-Adresse aus den 12 Woertern, gespeichert nur der Schluessel", async () => {
  const { s, w } = await wallet();
  assert.equal(w.eingerichtet(), true);
  assert.equal(w.adresse(), PHANTOM);
  assert.match(s.daten.get(LS_SOL_WALLET)!, /^[0-9a-f]{64}$/);
  const alles = [...s.daten.values()].join(" ");
  assert.ok(!alles.includes("abandon"), "die Woerter werden nicht gespeichert");
  // Woerter einer anderen Identitaet, ungueltige Pruefsumme
  const pk = identityFromMnemonic(PHRASE).pk;
  assert.throws(() => solSchluesselAusPhrase(ANDERE, pk), /gehören nicht zu deiner Identität/);
  assert.throws(() => solSchluesselAusPhrase(PHRASE.replace("about", "abandon"), pk), /ungültig/);
  // Gesperrter Tresor: keine Adresse, kein Signieren
  s.gesperrt = true;
  assert.equal(w.eingerichtet(), false);
  assert.equal(w.adresse(), undefined);
  assert.throws(() => w.signiere(ueberweisung(PHANTOM)), /nicht verfügbar/);
  s.gesperrt = false;
  await w.entfernen();
  assert.equal(w.eingerichtet(), false);
  assert.equal(s.daten.size, 0);
});

test("Signieren: gueltige Signatur fuer die eigene Adresse, fremde Transaktion abgelehnt", async () => {
  const { w } = await wallet();
  const tx = ueberweisung(PHANTOM);
  w.signiere(tx);
  assert.equal(tx.verifySignatures(), true);
  assert.equal(tx.signatures[0].publicKey.toBase58(), PHANTOM);
  // Dieselbe Signatur wie mit dem Schluessel aus web3.js (deterministisch nach Ed25519)
  const vergleich = ueberweisung(PHANTOM);
  const sk = solSchluesselAusPhrase(PHRASE, identityFromMnemonic(PHRASE).pk);
  vergleich.sign(Keypair.fromSeed(sk));
  assert.deepEqual(tx.signatures[0].signature, vergleich.signatures[0].signature);
  // Eine Transaktion, die eine andere Adresse bezahlen laesst: nicht signieren
  const fremd = ueberweisung(Keypair.generate().publicKey.toBase58());
  assert.throws(() => w.signiere(fremd), /keine Signatur dieser Wallet/);
  assert.equal(fremd.signatures[0].signature, null);
});

test("Tageslimit: darunter ohne Nachfrage, darueber nur mit Bestaetigung, rollend 24 Stunden", async () => {
  const { s, w, uhr } = await wallet();
  assert.equal(w.limit(), STANDARD_LIMIT);
  await w.setzeLimit(10_000);
  const fragen: Nachfrage[] = [];
  let antwort = false;
  const bestaetige = async (n: Nachfrage) => { fragen.push(n); return antwort; };

  assert.equal(await w.freigabe(6_000, ZIEL, bestaetige), true);
  assert.equal(fragen.length, 0, "im Limit: keine Nachfrage");
  // 6.000 + 5.000 > 10.000: nachfragen; abgelehnt zaehlt nicht
  assert.equal(await w.freigabe(5_000, ZIEL, bestaetige), false);
  assert.deepEqual(fragen[0], { lamports: 5_000, ziel: ZIEL, limit: 10_000, pruefung: { ohneNachfrage: false, verbraucht: 6_000, rest: 4_000 } });
  assert.equal(w.pruefe(4_000).verbraucht, 6_000);
  // bestaetigt: zaehlt mit
  antwort = true;
  assert.equal(await w.freigabe(5_000, ZIEL, bestaetige), true);
  assert.equal(w.pruefe(1).verbraucht, 11_000);
  // nach 24 Stunden faellt die erste Ausgabe heraus, gespeichert wird nur das Fenster
  uhr.t = T0 + 24 * 3600;
  assert.equal(w.pruefe(1).verbraucht, 0);
  assert.equal(await w.freigabe(1_000, ZIEL, bestaetige), true);
  assert.equal(JSON.parse(s.daten.get(LS_SOL_AUSGABEN)!).length, 1);
  // Limit 0: jede Zahlung fragt; ungueltige Werte
  await w.setzeLimit(0);
  fragen.length = 0;
  await w.freigabe(1, ZIEL, bestaetige);
  assert.equal(fragen.length, 1);
  await assert.rejects(w.setzeLimit(-1), /nicht negative/);
  await assert.rejects(w.setzeLimit(1.5), /nicht negative/);
  s.daten.set(LS_SOL_LIMIT, "kaputt");
  assert.equal(w.limit(), STANDARD_LIMIT, "unlesbares Limit: Standard statt unbegrenzt");
  s.daten.set(LS_SOL_AUSGABEN, "{kaputt");
  assert.deepEqual(w.ausgaben(), []);
  await assert.rejects(w.freigabe(0, ZIEL, bestaetige), /positive ganze Zahl/);
});

test("Solana-Schiene: ohne Freigabe wird nichts gebaut und nichts gesendet", async () => {
  const { w } = await wallet();
  await w.setzeLimit(1_000);
  let gebaut = 0;
  const gesendet: Transaction[] = [];
  const rail = new SolanaRail({
    wallet: () => ({
      adresse: w.adresse()!,
      freigabe: (lamports, ziel) => w.freigabe(lamports, ziel, async () => false),
      signiereUndSende: async (tx) => { w.signiere(tx as Transaction); gesendet.push(tx as Transaction); return "5".repeat(88); },
    }),
    baueUeberweisung: async (von) => { gebaut++; return ueberweisung(von); },
  });
  await assert.rejects(zahle([rail], { ziel: ZIEL, betrag: { einheit: "lamports", wert: 5_000 }, zweck: "trinkgeld" }), /nicht freigegeben/);
  assert.equal(gebaut, 0);
  assert.equal(gesendet.length, 0);
  // im Limit: gebaut, signiert, gesendet
  const b = await zahle([rail], { ziel: ZIEL, betrag: { einheit: "lamports", wert: 500 }, zweck: "trinkgeld" });
  assert.equal(gebaut, 1);
  assert.equal(gesendet[0].verifySignatures(), true);
  assert.equal(b.rail, "solana");
});

test("Verdrahtung (4.2b): Abschnitt im Wallet-Tab – Tresor zuerst, Bunker gesperrt, alle Knoepfe vorhanden", async () => {
  const { readFileSync } = await import("node:fs");
  const ui = readFileSync(new URL("../src/shell/eingebaute-wallet.ts", import.meta.url), "utf8");
  assert.match(ui, /if \(!\(await verlangeTresor\("die eingebaute Wallet"\)\)\) return;/);
  assert.match(ui, /const adresse = mitBunker\(\) \? undefined : eingebauteWallet\.adresse\(\);/);
  assert.match(ui, /await eingebauteWallet\.einrichten\(feld\.value, state\.keypair\?\.pk \?\? ""\);\n\s+feld\.value = "";/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  for (const id of ["solw-box", "solw-einrichten", "solw-bereit", "solw-adresse", "solw-guthaben", "solw-limit", "solw-limit-speichern", "solw-kopieren", "solw-entfernen", "solw-status"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
    if (id !== "solw-box") assert.ok(ui.includes(`"#${id}"`), `${id} wird benutzt`);
  }
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /wireEingebauteWallet\(\);/);
  const tab = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  assert.match(tab, /zeigeEingebauteWallet\(\);/);
});
