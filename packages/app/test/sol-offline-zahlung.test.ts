/**
 * Schritt 7.2b: Offline-SOL-Zahlung der eingebauten Wallet – mit dem
 * abgelegten Nonce, Tageslimit wie jede Zahlung, ein Wert zahlt einmal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { pruefeOfflineUeberweisung } from "@freedomstack/protocol";
import { identityFromMnemonic } from "../src/identity.js";
import { EingebauteSolWallet, type Nachfrage, type WalletSpeicher } from "../src/sol-wallet.js";
import { LS_SOL_NONCE, type NonceAblage, erstelleOfflineZahlung, leseAblage, schreibeAblage } from "../src/sol-offline-zahlung.js";

// Oeffentliche BIP-39-Testphrase – kein Geheimnis.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ZIEL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const KONTO = Keypair.generate().publicKey.toBase58();
const NONCE = Keypair.generate().publicKey.toBase58();

function speicher(): WalletSpeicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return {
    daten,
    getItem: (k) => daten.get(k) ?? null,
    async setItem(k, v) { daten.set(k, v); },
    async removeItem(k) { daten.delete(k); },
  };
}

async function aufbau(autoritaet?: string) {
  const s = speicher();
  const w = new EingebauteSolWallet(s, () => 1_790_000_000);
  await w.einrichten(PHRASE, identityFromMnemonic(PHRASE).pk);
  const ablage: NonceAblage = { konto: KONTO, stand: { autoritaet: autoritaet ?? w.adresse()!, nonce: NONCE, lamportsJeSignatur: 5000 }, gelesen: 1_790_000_000, verbraucht: false };
  await schreibeAblage(s, ablage);
  return { s, w };
}

const nie = async (_n: Nachfrage) => { throw new Error("keine Nachfrage erwartet"); };

test("Offline zahlen: signiert mit dem Nonce, besteht die Pruefung, Wert danach verbraucht", async () => {
  const { s, w } = await aufbau();
  const roh = await erstelleOfflineZahlung(w, s, { an: ZIEL, lamports: 10_000_000 }, nie);
  const p = pruefeOfflineUeberweisung(roh);
  assert.ok(p.ok);
  assert.equal(p.von, w.adresse());
  assert.equal(p.an, ZIEL);
  assert.equal(p.lamports, 10_000_000);
  assert.equal(p.nonce, NONCE);
  assert.equal(leseAblage(s)!.verbraucht, true);
  await assert.rejects(erstelleOfflineZahlung(w, s, { an: ZIEL, lamports: 1 }, nie), /verbraucht/);
});

test("Offline zahlen: ueber dem Tageslimit fragt die Wallet – abgelehnt heisst nichts erstellt", async () => {
  const { s, w } = await aufbau();
  let gefragt = 0;
  await assert.rejects(erstelleOfflineZahlung(w, s, { an: ZIEL, lamports: 50 * 1e9 }, async () => { gefragt++; return false; }), /nicht freigegeben/);
  assert.equal(gefragt, 1);
  assert.equal(leseAblage(s)!.verbraucht, false, "der Wert bleibt frei");
  assert.equal(w.ausgaben().length, 0, "nichts zum Tag gezählt");
});

test("Offline zahlen: ohne Ablage, fremde Autoritaet, keine Adresse – abgelehnt, bevor etwas zaehlt", async () => {
  const { s, w } = await aufbau(new PublicKey(Keypair.generate().publicKey.toBytes()).toBase58());
  await assert.rejects(erstelleOfflineZahlung(w, s, { an: ZIEL, lamports: 1 }, nie), /anderen Adresse/);
  await assert.rejects(erstelleOfflineZahlung(w, s, { an: "keine-adresse", lamports: 1 }, nie), /keine Solana-Adresse/);
  assert.equal(w.ausgaben().length, 0);
  await schreibeAblage(s, null);
  await assert.rejects(erstelleOfflineZahlung(w, s, { an: ZIEL, lamports: 1 }, nie), /Kein Nonce-Konto/);
});

test("Ablage wird streng gelesen", async () => {
  const s = speicher();
  for (const roh of ["kaputt", "{}", JSON.stringify({ konto: "x", stand: {}, gelesen: 1, verbraucht: false })]) {
    s.daten.set(LS_SOL_NONCE, roh);
    assert.equal(leseAblage(s), null, roh);
  }
});
