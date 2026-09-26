/**
 * Abnahme 7.2 am lokalen Validator: Eine Offline-Ueberweisung mit Durable
 * Nonce ist nach mehr als zwei Minuten noch gueltig – laenger, als ein
 * normaler Blockhash lebt (rund 150 Bloecke).
 *
 * Laeuft nur mit einem lokalen Validator (`solana-test-validator`, Standard
 * http://127.0.0.1:8899, sonst SOLANA_LOKAL_RPC); sonst uebersprungen – in der
 * CI gibt es keinen. Dauert gut zwei Minuten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { NONCE_KONTO_BYTES, baueNonceKontoAnlegen, baueOfflineUeberweisung, leseNonceKonto, pruefeOfflineUeberweisung } from "../src/sol-offline.js";

const RPC = process.env.SOLANA_LOKAL_RPC ?? "http://127.0.0.1:8899";

async function validatorDa(): Promise<boolean> {
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("VALIDATOR: Offline-Ueberweisung mit Durable Nonce gilt nach mehr als zwei Minuten", { timeout: 600_000 }, async (t) => {
  if (!(await validatorDa())) {
    t.skip(`kein lokaler Validator unter ${RPC}`);
    return;
  }
  const c = new Connection(RPC, "confirmed");
  const zahler = Keypair.generate();
  const ziel = Keypair.generate().publicKey;
  await c.confirmTransaction(await c.requestAirdrop(zahler.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");

  // 1. Online: Nonce-Konto anlegen und den Wert lesen.
  const nonceKonto = Keypair.generate();
  const miete = await c.getMinimumBalanceForRentExemption(NONCE_KONTO_BYTES);
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const anlegen = baueNonceKontoAnlegen({ zahler: zahler.publicKey.toBase58(), nonceKonto: nonceKonto.publicKey.toBase58(), mieteLamports: miete, blockhash });
  anlegen.sign(zahler, nonceKonto);
  await c.confirmTransaction(await c.sendRawTransaction(anlegen.serialize()), "confirmed");
  const konto = await c.getAccountInfo(nonceKonto.publicKey, "confirmed");
  assert.ok(konto);
  const stand = leseNonceKonto(new Uint8Array(konto.data));

  // 2. „Offline“: Ueberweisung bauen und signieren; zum Vergleich eine normale mit frischem Blockhash.
  const roh = (() => {
    const tx = baueOfflineUeberweisung({ von: zahler.publicKey.toBase58(), an: ziel.toBase58(), lamports: 1_000_000, nonceKonto: nonceKonto.publicKey.toBase58(), stand });
    tx.sign(zahler);
    return new Uint8Array(tx.serialize());
  })();
  assert.equal(pruefeOfflineUeberweisung(roh).ok, true);
  const normal = await c.getLatestBlockhash("confirmed");
  const vergleich = new Transaction({ feePayer: zahler.publicKey, blockhash: normal.blockhash, lastValidBlockHeight: normal.lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: zahler.publicKey, toPubkey: ziel, lamports: 1 }));
  vergleich.sign(zahler);

  // 3. Warten: mehr als zwei Minuten UND bis der normale Blockhash abgelaufen ist.
  const start = Date.now();
  while (Date.now() - start < 125_000 || (await c.isBlockhashValid(normal.blockhash, { commitment: "confirmed" })).value) {
    await warte(5_000);
  }
  await assert.rejects(c.sendRawTransaction(vergleich.serialize()), "die normale Transaktion ist abgelaufen");

  // 4. Einreichen – mit Vorabsimulation (kein skipPreflight).
  const sig = await c.sendRawTransaction(roh);
  await c.confirmTransaction({ signature: sig, nonceAccountPubkey: nonceKonto.publicKey, nonceValue: stand.nonce, minContextSlot: 0 }, "confirmed");
  assert.equal(await c.getBalance(ziel, "confirmed"), 1_000_000);

  // Der Wert ist verbraucht: dieselbe Transaktion ein zweites Mal geht nicht.
  const neu = leseNonceKonto(new Uint8Array((await c.getAccountInfo(nonceKonto.publicKey, "confirmed"))!.data));
  assert.notEqual(neu.nonce, stand.nonce);
  await assert.rejects(c.sendRawTransaction(roh));
});
