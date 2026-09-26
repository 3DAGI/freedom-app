/**
 * Schritt 4.6f: Einloesen ueber einen Relayer in der App. Geprueft wird die
 * Auswahl (nie der LP), der Bau der Transaktion (besteht die Pruefung des
 * Relayers) und die Verdrahtung im Einloese-Ablauf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, Transaction } from "@solana/web3.js";
import { pruefeRelayAuftrag, MAX_ERSTATTUNG_LAMPORTS } from "@freedomstack/protocol";
import { GEBUEHR_PUFFER_LAMPORTS, baueRelayEinloesung, brauchtRelayer, waehleRelayer } from "../src/relay-einloesung.js";
import { HTLC_PROGRAM_ID, type WalletSigner } from "../src/sol-htlc.js";

const LP_SOL = Keypair.generate().publicKey.toBase58();
const angebot = (solAdresse: string, erstattungLamports: number, kette = "solana:devnet") => ({ solAdresse, erstattungLamports, kette });
const [r1, r2, r3] = [Keypair.generate(), Keypair.generate(), Keypair.generate()].map((k) => k.publicKey.toBase58());

test("Relayer nur ohne SOL fuer die Gebuehr", () => {
  assert.equal(brauchtRelayer(0), true);
  assert.equal(brauchtRelayer(GEBUEHR_PUFFER_LAMPORTS - 1), true);
  assert.equal(brauchtRelayer(GEBUEHR_PUFFER_LAMPORTS), false);
});

test("Auswahl: gleiche Kette, guenstigster zuerst, nie der LP, keine ueberhoehte Erstattung, je Schluessel das neueste", () => {
  const liste = waehleRelayer([
    { pubkey: "a".repeat(64), created_at: 1, angebot: angebot(r1, 20_000) },
    { pubkey: "a".repeat(64), created_at: 2, angebot: angebot(r1, 8_000) }, // neueres Angebot desselben Relayers
    { pubkey: "b".repeat(64), created_at: 1, angebot: angebot(r2, 12_000) },
    { pubkey: "c".repeat(64), created_at: 1, angebot: angebot(r3, 5_000, "solana:mainnet") }, // andere Kette
    { pubkey: "d".repeat(64), created_at: 1, angebot: angebot(LP_SOL, 1_000) }, // SOL-Konto des LP
    { pubkey: "e".repeat(64), created_at: 1, angebot: angebot(r3, 2_000) }, // Nostr-Schluessel des LP
    { pubkey: "f".repeat(64), created_at: 1, angebot: angebot(r3, MAX_ERSTATTUNG_LAMPORTS + 1) },
  ], { kette: "solana:devnet", lpPubkey: "e".repeat(64), lpSol: LP_SOL });
  assert.deepEqual(liste, [
    { pubkey: "a".repeat(64), solAdresse: r1, erstattungLamports: 8_000 },
    { pubkey: "b".repeat(64), solAdresse: r2, erstattungLamports: 12_000 },
  ]);
});

function wallet(k: Keypair, signiert = true): WalletSigner {
  return {
    publicKey: k.publicKey,
    async signTransaction(tx: unknown) {
      if (signiert) (tx as Transaction).partialSign(k);
      return tx;
    },
  };
}
const conn = { getLatestBlockhash: async () => ({ blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 1 }) };

test("Gebaute Einloesung besteht die Pruefung des Relayers: Einloesung + Erstattung, Relayer zahlt die Gebuehr", async () => {
  const kunde = Keypair.generate();
  const relayer = { pubkey: "a".repeat(64), solAdresse: r1, erstattungLamports: 10_000 };
  const roh = await baueRelayEinloesung({
    connection: conn as never, wallet: wallet(kunde), swapId: "swap-abc", preimage: new Uint8Array(32).fill(3), initiator: LP_SOL, relayer,
  });
  assert.deepEqual(pruefeRelayAuftrag(roh, { relayer: r1, programmId: HTLC_PROGRAM_ID, erstattungMin: 10_000 }), { ok: true, empfaenger: kunde.publicKey.toBase58(), erstattung: 10_000 });
  const tx = Transaction.from(roh);
  assert.equal(tx.feePayer?.toBase58(), r1);
  assert.equal(tx.signatures.find((s) => s.publicKey.toBase58() === r1)?.signature, null, "der Relayer signiert erst selbst");
});

test("Ohne Signatur der Wallet geht der Auftrag gar nicht erst raus", async () => {
  await assert.rejects(() => baueRelayEinloesung({
    connection: conn as never, wallet: wallet(Keypair.generate(), false), swapId: "swap-abc", preimage: new Uint8Array(32),
    initiator: LP_SOL, relayer: { pubkey: "a".repeat(64), solAdresse: r1, erstattungLamports: 10_000 },
  }), /unvollständig: Empfaenger hat nicht signiert/);
});

test("Verdrahtung (4.6f): ohne SOL ueber den Relayer, Auftrag versiegelt vom Wegwerf-Schluessel, nie der LP", () => {
  const w = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  assert.match(w, /brauchtRelayer\(guthaben\)\s*\? await einloesenUeberRelayer\(/);
  const f = w.slice(w.indexOf("async function einloesenUeberRelayer("), w.indexOf("/** Sicherung aller offenen Preimages"));
  assert.match(f, /waehleRelayer\(angebote, \{ kette: ketteAusRpc\(p\.rpcUrl\), lpPubkey: p\.swap\.lpPubkey, lpSol: p\.swap\.initiator \}\)/);
  assert.match(f, /mieteReicht\(/);
  assert.match(f, /claimAllowed\(p\.swap\.timelockUnix - 300\)/, "Frist mit Abstand fuer Relayer und Kette");
  assert.match(f, /new LocalSigner\(generateKeypair\(\)\.sk\)/);
  assert.match(f, /buildRelayAuftrag\(\{ tx: roh, kunde: einmal, relayerPk: k\.pubkey \}\)/);
  assert.match(f, /confirmationStatus === "confirmed"/, "erst die Kette gilt als Beleg");
  assert.doesNotMatch(f, /sendRawTransaction|skipPreflight/);
});
