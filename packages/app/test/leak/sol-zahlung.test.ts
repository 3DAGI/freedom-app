/**
 * Leak-Szenario „SOL-Zahlung“ (Schritt 1.5): zwei Deposits mit dem echten
 * `lockDeposit()` aus `sol-htlc.ts` (so ruft ihn `startDeposit()` in
 * `tabs/waehrung.ts` auf), mitgeschnitten an einer Aufzeichnungs-RPC, dazu die
 * Ankuendigung per Nostr. Heute zahlt jede Einzahlung von derselben
 * Wallet-Adresse – Schritt 4.9 leitet je Zahlung eine frische ab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, type Transaction } from "@solana/web3.js";
import {
  LocalSigner, buildSolDepositOpen, generateKeypair, regelKeineSolAdresse, regelSolAdresseFrisch,
} from "@freedomstack/protocol";
import { lockDeposit } from "../../src/sol-htlc.js";
import { aufzeichnung, aufzeichnungsRpc } from "./aufzeichnung.js";

async function zweiDeposits() {
  const { connection, gesendet: transaktionen } = await aufzeichnungsRpc();
  const { pool, relay } = aufzeichnung();
  const walletKp = Keypair.generate();
  const wallet = {
    publicKey: walletKp.publicKey,
    async signTransaction(tx: unknown) { (tx as Transaction).partialSign(walletKp); return tx; },
  };
  const signer = new LocalSigner(generateKeypair().sk);
  const provider = generateKeypair().pk;
  const providerSol = Keypair.generate().publicKey.toBase58();
  const frist = Math.floor(Date.now() / 1000) + 7200;
  for (const n of [1, 2]) {
    await lockDeposit({
      connection: connection as never, wallet: wallet as never, providerSolAddress: providerSol,
      spendSwapId: `spend-${n}`, refundSwapId: `refund-${n}`, spendLamports: 1_000_000, refundLamports: 500_000,
      timelockUnix: frist,
    });
    await pool.publish(await signer.signEvent(buildSolDepositOpen({
      customerPubkey: signer.publicKey(), providerPubkey: provider, sessionId: `sitzung-${n}`,
      totalLamports: 1_500_000, spendSwapId: `spend-${n}`, refundSwapId: `refund-${n}`,
      spendLamports: 1_000_000, refundLamports: 500_000, timelockUnix: frist, maxLamportsPerKToken: 1000,
    })));
  }
  return { transaktionen, events: relay.gesendet, walletAdresse: walletKp.publicKey.toBase58() };
}

test("SOL-Zahlung: zwei Deposits gehen ueber die RPC, die Ankuendigungen ueber den Pool", async () => {
  const { transaktionen, events, walletAdresse } = await zweiDeposits();
  assert.equal(transaktionen.length, 2);
  assert.equal(events.length, 2);
  assert.ok(transaktionen.every((t) => t.feePayer === walletAdresse));
});

test("SOL-Zahlung: die Wallet-Adresse steht in keinem Nostr-Event", async () => {
  const { events, walletAdresse } = await zweiDeposits();
  assert.deepEqual(regelKeineSolAdresse(events, [walletAdresse]), []);
});

test("SOL-Zahlung: jede Zahlung von einer frischen Adresse", { todo: "Schritt 4.9" }, async () => {
  const { transaktionen } = await zweiDeposits();
  assert.deepEqual(regelSolAdresseFrisch(transaktionen.map((t) => t.feePayer)), []);
});

test("Verdrahtung: startDeposit() sperrt mit lockDeposit und kuendigt mit buildSolDepositOpen an", () => {
  const w = readFileSync(new URL("../../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  // Seit 4.6c mit dem Signierer aus der Verbindung (auch Wallet-Standard-Wallets)
  assert.match(w, /await lockDeposit\(\{\s*connection: conn,\s*wallet: signer,/);
  assert.match(w, /signiere\(buildSolDepositOpen\(\{\s*customerPubkey: state\.keypair\.pk,/);
});
