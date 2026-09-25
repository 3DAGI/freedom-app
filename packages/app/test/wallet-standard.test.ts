/**
 * Schritt 4.2c: externe Wallets ueber den Wallet Standard – Anmeldung in
 * beide Richtungen, nur Solana, Signieren mit richtiger Kette, Auswahl.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { type StandardWallet, alsAnbieter, ketteAusRpc, solanaWallets } from "../src/wallet-standard.js";

const ZIEL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb";

function ueberweisung(von: PublicKey): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: von, toPubkey: new PublicKey(ZIEL), lamports: 5_000 }));
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.feePayer = von;
  return tx;
}

/** Eine Test-Wallet nach dem Wallet Standard, die mit einem echten Schluessel signiert. */
function testWallet(name: string, kp: Keypair, opts: { chains?: string[]; senden?: boolean; signieren?: boolean; signaturLaenge?: number } = {}) {
  const log: Array<{ was: string; eingabe: unknown }> = [];
  const konto = { address: kp.publicKey.toBase58(), chains: opts.chains ?? ["solana:mainnet", "solana:devnet"] };
  const features: Record<string, unknown> = {
    "standard:connect": { version: "1.0.0", connect: async (eingabe?: unknown) => { log.push({ was: "connect", eingabe }); return { accounts: [konto] }; } },
  };
  if (opts.senden !== false) {
    features["solana:signAndSendTransaction"] = {
      version: "1.0.0",
      signAndSendTransaction: async (e: { transaction: Uint8Array; chain: string }) => {
        log.push({ was: "senden", eingabe: e });
        const tx = Transaction.from(e.transaction);
        tx.partialSign(kp);
        return [{ signature: tx.signature!.subarray(0, opts.signaturLaenge ?? 64) }];
      },
    };
  }
  if (opts.signieren !== false) {
    features["solana:signTransaction"] = {
      version: "1.0.0",
      signTransaction: async (e: { transaction: Uint8Array; chain: string }) => {
        log.push({ was: "signieren", eingabe: e });
        const tx = Transaction.from(e.transaction);
        tx.partialSign(kp);
        return [{ signedTransaction: Uint8Array.from(tx.serialize()) }];
      },
    };
  }
  const wallet: StandardWallet = { name, chains: konto.chains, features };
  return { wallet, log };
}

/** Wie `registerWallet()` aus dem Standard: anmelden und auf „app-ready“ lauschen. */
function melde(ziel: EventTarget, w: StandardWallet): void {
  const rueckruf = ({ register }: { register: (w: StandardWallet) => void }) => register(w);
  ziel.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: rueckruf }));
  ziel.addEventListener("wallet-standard:app-ready", (e) => rueckruf((e as CustomEvent).detail));
}

test("Anmeldung: schon geladene (app-ready) und spaete (register-wallet) Wallets, nur mit Solana", () => {
  const ziel = new EventTarget();
  const frueh = testWallet("Frueh", Keypair.generate()).wallet;
  ziel.addEventListener("wallet-standard:app-ready", (e) => (e as CustomEvent).detail.register(frueh));
  assert.deepEqual(solanaWallets(ziel).map((w) => w.name), ["Frueh"]);
  const spaet = testWallet("Spaet", Keypair.generate()).wallet;
  const nurEth: StandardWallet = { name: "NurEth", chains: ["ethereum:1"], features: { "standard:connect": {} } };
  const ohneSignatur: StandardWallet = { name: "Leer", chains: ["solana:mainnet"], features: { "standard:connect": {} } };
  for (const w of [spaet, nurEth, ohneSignatur]) {
    ziel.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: ({ register }: { register: (w: StandardWallet) => void }) => register(w) }));
  }
  // Eine kaputte Anmeldung stoert die anderen nicht
  ziel.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: () => { throw new Error("kaputt"); } }));
  assert.deepEqual(solanaWallets(ziel).map((w) => w.name), ["Frueh", "Spaet"]);
});

test("Kette aus dem RPC: Devnet und Testnet am Namen, sonst Mainnet", () => {
  assert.equal(ketteAusRpc("https://api.devnet.solana.com"), "solana:devnet");
  assert.equal(ketteAusRpc("https://api.testnet.solana.com"), "solana:testnet");
  assert.equal(ketteAusRpc("https://solana-rpc.publicnode.com"), "solana:mainnet");
});

test("Signieren und senden: gebaute Transaktion, richtige Kette, Signatur base58", async () => {
  const kp = Keypair.generate();
  const { wallet, log } = testWallet("Test", kp);
  const a = alsAnbieter(wallet, async () => "solana:devnet");
  await assert.rejects(a.signAndSendTransaction!(ueberweisung(kp.publicKey)), /nicht verbunden/);
  const r = await a.connect({ onlyIfTrusted: true });
  assert.equal(r.publicKey.toBase58(), kp.publicKey.toBase58());
  assert.deepEqual(log[0], { was: "connect", eingabe: { silent: true } }, "still = silent");
  const tx = ueberweisung(kp.publicKey);
  const { signature } = await a.signAndSendTransaction!(tx);
  const gesendet = log[1].eingabe as { transaction: Uint8Array; chain: string };
  assert.equal(gesendet.chain, "solana:devnet");
  assert.deepEqual(Transaction.from(gesendet.transaction).instructions[0].data, tx.instructions[0].data);
  assert.match(signature, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
  // signTransaction: signierte Transaktion zurueck, gueltig
  const signiert = (await a.signTransaction!(ueberweisung(kp.publicKey))) as Transaction;
  assert.equal(signiert.verifySignatures(), true);
  // Kette, die die Wallet nicht kann; kaputte Signatur
  const nurMain = alsAnbieter(testWallet("Main", kp, { chains: ["solana:mainnet"] }).wallet, async () => "solana:devnet");
  await nurMain.connect();
  await assert.rejects(nurMain.signAndSendTransaction!(ueberweisung(kp.publicKey)), /unterstützt solana:devnet nicht/);
  const kurz = alsAnbieter(testWallet("Kurz", kp, { signaturLaenge: 10 }).wallet, async () => "solana:mainnet");
  await kurz.connect();
  await assert.rejects(kurz.signAndSendTransaction!(ueberweisung(kp.publicKey)), /keine gültige Signatur/);
});

test("Nur anbieten, was die Wallet kann", () => {
  const kp = Keypair.generate();
  const nurSenden = alsAnbieter(testWallet("S", kp, { signieren: false }).wallet, async () => "solana:mainnet");
  assert.equal(nurSenden.signTransaction, undefined);
  assert.equal(typeof nurSenden.signAndSendTransaction, "function");
  const nurSignieren = alsAnbieter(testWallet("T", kp, { senden: false }).wallet, async () => "solana:mainnet");
  assert.equal(nurSignieren.signAndSendTransaction, undefined);
  assert.equal(typeof nurSignieren.signTransaction, "function");
});

test("Verbinden: eine Wallet direkt, mehrere per Auswahl, still nur die gemerkte", async () => {
  const ziel = new EventTarget();
  const g = globalThis as unknown as { addEventListener: unknown; dispatchEvent: unknown };
  g.addEventListener = ziel.addEventListener.bind(ziel);
  g.dispatchEvent = ziel.dispatchEvent.bind(ziel);
  const { connectSolanaWallet } = await import("../src/solana-connect.js");
  const [k1, k2] = [Keypair.generate(), Keypair.generate()];
  melde(ziel, testWallet("Eins", k1).wallet); // geladen vor der App
  const c1 = await connectSolanaWallet({ userAgentOverride: "Desktop" });
  assert.equal(c1?.method, "standard");
  assert.equal(c1?.name, "Eins");
  assert.equal(c1?.pubkey, k1.publicKey.toBase58());
  melde(ziel, testWallet("Zwei", k2).wallet); // laedt spaeter
  let angeboten: string[] = [];
  const c2 = await connectSolanaWallet({ userAgentOverride: "Desktop", waehle: async (n) => { angeboten = n; return 1; } });
  assert.deepEqual(angeboten, ["Eins", "Zwei"]);
  assert.equal(c2?.pubkey, k2.publicKey.toBase58());
  assert.equal(await connectSolanaWallet({ userAgentOverride: "Desktop", waehle: async () => null }), null, "abgebrochen");
  const still = await connectSolanaWallet({ userAgentOverride: "Desktop", silent: true, gemerkt: "Zwei" });
  assert.equal(still?.name, "Zwei");
  assert.equal(await connectSolanaWallet({ userAgentOverride: "Desktop", silent: true, gemerkt: null }), null, "still ohne gemerkte Wallet: kein Popup");
});
