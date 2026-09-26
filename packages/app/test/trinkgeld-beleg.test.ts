/**
 * Schritt 4.7b: SOL-Trinkgeld-Beleg in der App – senden (privat, oeffentlich
 * nur auf Wunsch), pruefen gegen die Kette, Anzeige im Chat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KIND_GIFT_WRAP, KIND_SOL_TRINKGELD, LocalSigner, generateKeypair, type NostrEvent, type SolTrinkgeld } from "@freedomstack/protocol";
import { pruefeTrinkgeld, sendeTrinkgeldBeleg, trinkgeldText } from "../src/trinkgeld-beleg.js";

const AN = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";
const SIG = "4".repeat(88);
const t = (empfaenger: string): SolTrinkgeld => ({ empfaenger, signatur: SIG, lamports: 2_000_000, an: AN, kette: "solana:devnet" });
const ueberweisung = (lamports: number) => ({
  meta: { err: null },
  transaction: { message: { instructions: [{ program: "system", parsed: { type: "transfer", info: { source: "x", destination: AN, lamports } } }] } },
});

test("Senden: privat nur Umschlaege; oeffentlich zusaetzlich der signierte Beleg", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const du = generateKeypair().pk;
  const privat: NostrEvent[] = [];
  assert.equal(await sendeTrinkgeldBeleg({ publish: async (e) => privat.push(e) }, ich, t(du), false), 2);
  assert.ok(privat.every((e) => e.kind === KIND_GIFT_WRAP));
  const offen: NostrEvent[] = [];
  assert.equal(await sendeTrinkgeldBeleg({ publish: async (e) => offen.push(e) }, ich, t(du), true), 3);
  const beleg = offen.find((e) => e.kind === KIND_SOL_TRINKGELD)!;
  assert.equal(beleg.pubkey, ich.publicKey());
  assert.ok(beleg.sig.length === 128, "signiert");
});

test("Pruefen: richtige Kette noetig; Fehler der RPC verraten keinen Text", async () => {
  const b = t(generateKeypair().pk);
  assert.deepEqual(await pruefeTrinkgeld(b, "solana:devnet", async () => ueberweisung(2_000_000)), { status: "belegt" });
  assert.equal((await pruefeTrinkgeld(b, "solana:devnet", async () => ueberweisung(1_000))).status, "falsch");
  assert.deepEqual(await pruefeTrinkgeld(b, "solana:mainnet", async () => ueberweisung(2_000_000)),
    { status: "unbestaetigt", grund: "Beleg für solana:devnet, eingestellt ist solana:mainnet" });
  const fehler = await pruefeTrinkgeld(b, "solana:devnet", async () => { throw new TypeError("https://rpc.example/?key=geheim"); });
  assert.deepEqual(fehler, { status: "unbestaetigt", grund: "Kette nicht erreichbar (TypeError)" });
});

test("Anzeige: Betrag in beiden Einheiten und Pruefstand", () => {
  const b = { ...t(generateKeypair().pk), notiz: "Danke" };
  const kurs = { satsProSol: 150_000 };
  assert.equal(trinkgeldText(b, undefined, kurs), "◎ Trinkgeld 0,002 SOL ≈ 300 sats · wird geprüft … – „Danke“");
  assert.equal(trinkgeldText(b, { status: "belegt" }, kurs), "◎ Trinkgeld 0,002 SOL ≈ 300 sats · belegt ✓ – „Danke“");
  assert.equal(trinkgeldText(t(b.empfaenger), { status: "falsch", grund: "nur 1 statt 2 Lamports" }), "◎ Trinkgeld 0,002 SOL (sats: kein Kurs) · falsch: nur 1 statt 2 Lamports");
});

test("Verdrahtung: Zap sendet den Beleg (Standard privat), der Chat erkennt und prueft ihn", () => {
  const zap = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  assert.match(zap, /<input type="checkbox" id="zap-oeffentlich" \/>/, "nicht vorausgewaehlt");
  assert.match(zap, /await sendeTrinkgeldBeleg\(pool, appState\.signer!, \{\n\s+empfaenger: state\.recipientPubkey, signatur: beleg\.ref, lamports, an: ziel, kette: ketteAusRpc\(await solRpcUrl\(\)\),\n\s+\}, oeffentlich\);/);
  const kom = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  assert.match(kom, /: \(await alsTrinkgeld\(w\)\) \?\? \(await alsAdressAnfrage\(w\)\);/);
  assert.match(kom, /const p = await pruefeTrinkgeld\(t, ketteAusRpc\(await solRpcUrl\(\)\), solTransaktion\);/);
});
